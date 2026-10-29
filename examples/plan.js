// Plan Explorer data. The engine (index.html) renders this; edit only this file.
// Schema: ~/.claude/skills/plan-explorer/reference/schema.md
window.PLAN = {
  id: "offline-sync",
  title: "Offline sync for Notes",
  version: 2,
  updated: "2026-10-28",

  overview: {
    summary: "Let the Notes app work fully offline and reconcile edits when the device reconnects.\n\nThe server stays the source of truth. Devices keep a local **operation log** and replay it on reconnect.",
    goals: [
      "Edit any note with no connection, with no visible difference",
      "Reconnect merges silently in the common case",
      "Conflicts are rare, visible, and never lose text"
    ],
    nonGoals: [
      "Real-time multiplayer cursors",
      "Peer-to-peer sync between devices"
    ]
  },

  areas: [
    {
      id: "local-store",
      title: "Local store",
      status: "exploring",
      summary: "Every edit lands in a local SQLite op log first. The UI reads from a materialized view, never from the network.",
      flows: [
        {
          id: "edit-offline",
          title: "Editing while offline",
          mermaid: `sequenceDiagram
  actor U as User
  participant UI as Editor UI
  participant Log as Op log
  participant View as Note view
  U->>UI: types a sentence
  UI->>Log: append op (insert, pos, text)
  Log->>View: apply op
  View-->>UI: re-render note
  Note over Log: ops queue until online`,
          actors: { Log: "op-log" },
          caption: "The editor never waits on anything slower than a local write."
        },
        {
          id: "cold-start",
          title: "Cold start",
          rev: 2,
          mermaid: `sequenceDiagram
  participant App
  participant Log as Op log
  participant View as Note view
  App->>View: load snapshot
  App->>Log: read unsynced ops
  loop each op
    Log->>View: apply op
  end
  View-->>App: ready`,
          caption: "Snapshot plus unsynced ops, so startup cost doesn't grow with history."
        }
      ],
      issues: [
        {
          id: "append-not-durable",
          title: "Append returns before the op is durable",
          severity: "high",
          category: "Local store",
          where: ["src/store/OpLog.ts:42-58"],
          origin: "introduced",
          flow: "edit-offline",
          steps: [2],
          summary: "A crash right after typing can lose the last edits.",
          trigger: "App killed within ~200 ms of a keystroke, before SQLite checkpoints the WAL.",
          cause: "`append` resolves after `INSERT`, but the connection runs `synchronous=OFF`.",
          impact: "Up to the last 200 ms of typing is lost; the UI showed it as saved.",
          fix: "Open the log connection with `synchronous=NORMAL`, and resolve `append` after the transaction commits.",
          verify: "OpLogTests: kill the worker mid-append, reopen, and assert every acked op is present.",
          related: ["compaction"]
        },
        {
          id: "compaction-unacked",
          title: "Compaction can drop ops the server hasn't acked",
          severity: "medium",
          category: "Sync",
          where: ["src/store/OpLog.ts:90", "src/sync/SyncClient.ts:61"],
          origin: "pre-existing",
          flow: "cold-start",
          steps: [2],
          summary: "A timer-driven compaction folds ops into the snapshot before a push is acked.",
          trigger: "Compaction timer fires while a push is in flight.",
          cause: "`compact(upTo)` takes the local head, not the acked cursor.",
          impact: "Those ops never reach the server; other devices miss the edits.",
          fix: "Pass `SyncClient.cursor` to `compact`, and drop the timer trigger.",
          verify: "SyncClientTests: delay the push ack, fire compaction, assert the ops are still pushed.",
          related: ["append-not-durable", "op-log"]
        },
        {
          id: "migration-log-noise",
          title: "Every launch logs a migration warning",
          severity: "low",
          category: "Local store",
          where: ["src/db/SqliteDb.ts:31"],
          status: "fixed",
          summary: "`migrate` warns when there is nothing to migrate.",
          fix: "Return early when no steps are pending."
        }
      ],
      sections: [
        {
          id: "op-format",
          title: "Op format",
          body: "Each op is `{ id, noteId, kind, pos, text, lamport }`.\n\n- `lamport` orders ops across devices\n- `id` is a ULID so ops dedupe on replay"
        }
      ],
      options: [
        {
          id: "sqlite",
          title: "SQLite op log",
          pick: true,
          pros: ["Already shipped on both platforms", "Transactions make append + apply atomic"],
          cons: ["Schema migrations on every app update"]
        },
        {
          id: "files",
          title: "Append-only files",
          pros: ["Dead simple", "Easy to inspect"],
          cons: ["Compaction is on us", "No atomic multi-file writes"]
        }
      ],
      openQuestions: [
        { id: "compaction", text: "When do we compact the op log: on sync, or on a timer?" },
        { id: "limits", text: "Is there a cap on unsynced ops before we warn the user?", answer: "Soft cap of 10k ops, then a banner." }
      ]
    },
    {
      id: "sync",
      title: "Sync protocol",
      status: "draft",
      rev: 2,
      summary: "On reconnect the device pushes its unsynced ops and pulls everything newer than its last cursor.",
      flows: [
        {
          id: "reconnect",
          title: "Reconnect",
          mermaid: `sequenceDiagram
  participant D as Device
  participant API as Sync API
  participant DB as Server DB
  D->>API: push ops since cursor
  API->>DB: write ops (dedupe by id)
  API-->>D: ack + new cursor
  D->>API: pull ops after cursor
  API-->>D: remote ops
  alt conflict
    D->>D: three-way merge
  else clean
    D->>D: apply remote ops
  end`,
          actors: { D: "sync-client", API: "sync-api" },
          caption: "Push first, then pull, so the server always has the device's view before answering."
        },
        {
          id: "conflict",
          title: "Conflict surfaced to user",
          rev: 2,
          mermaid: `sequenceDiagram
  participant D as Device
  participant UI as Editor UI
  actor U as User
  D->>UI: conflict on note 42
  UI->>U: show both versions
  U->>UI: keep mine / keep theirs / merge
  UI->>D: resolution op`
        }
      ],
      sections: [
        {
          id: "cursor",
          title: "Cursors",
          rev: 2,
          body: "The cursor is the server's highest op sequence the device has seen. It is stored next to the op log so both move together."
        }
      ],
      openQuestions: [
        { id: "batching", text: "Do we batch pushes, or stream ops one by one?", rev: 2 }
      ]
    },
    {
      id: "ux",
      title: "Offline UX",
      status: "settled",
      summary: "Users should barely notice they are offline. One quiet indicator, no modal dialogs.",
      sections: [
        {
          id: "indicator",
          title: "Status indicator",
          body: "A small cloud icon in the toolbar: solid when synced, outlined when offline, animated while syncing."
        }
      ]
    }
  ],

  api: {
    language: "TypeScript",
    summary: "Types the plan touches. **existing** = in the codebase today (signatures copied from source); **new** = proposed; **changed** = existing with proposed edits.",
    types: [
      {
        id: "op-log",
        name: "OpLog",
        kind: "class",
        area: "local-store",
        state: "new",
        source: "src/store/OpLog.ts",
        summary: "Append-only log of edit ops, persisted in SQLite.",
        body: "Single writer. All appends go through one transaction so `append` and the view update commit together.",
        dependsOn: ["sqlite-db", "Op"],
        members: [
          { id: "append", group: "Writing", sig: "append(op: Op): Promise<void>", doc: "Persists one op and applies it to the note view.", params: [{ name: "op", doc: "The edit op; `op.id` must be a fresh ULID." }], throws: "`QuotaError` when the local store is full." },
          { id: "unsynced", group: "Reading", sig: "unsynced(after?: Cursor): AsyncIterable<Op>", doc: "Ops not yet acked by the server, oldest first.", params: [{ name: "after", doc: "Skip ops at or before this cursor." }], returns: "Async stream; safe to iterate while appends continue." },
          { id: "compact", group: "Maintenance", sig: "compact(upTo: Cursor): Promise<number>", doc: "Folds acked ops into the snapshot.", detail: "Runs only after a successful push ack. Never touches unacked ops.", returns: "Number of ops removed." }
        ]
      },
      {
        id: "sqlite-db",
        name: "SqliteDb",
        kind: "class",
        area: "local-store",
        state: "existing",
        source: "src/db/SqliteDb.ts:14",
        summary: "Thin wrapper over the platform SQLite driver.",
        members: [
          { id: "tx", sig: "tx<T>(fn: (t: Tx) => Promise<T>): Promise<T>", doc: "Runs `fn` in one transaction; rolls back on throw." },
          { id: "migrate", sig: "migrate(steps: Migration[]): Promise<void>", doc: "Applies pending schema migrations in order." }
        ]
      },
      {
        id: "sync-client",
        name: "SyncClient",
        kind: "class",
        area: "sync",
        state: "changed",
        rev: 2,
        source: "src/sync/SyncClient.ts:8",
        summary: "Pushes local ops and pulls remote ops on reconnect.",
        dependsOn: ["op-log", "sync-api"],
        members: [
          { id: "sync", sig: "sync(): Promise<SyncResult>", doc: "Push then pull. One run at a time; concurrent calls share the promise." },
          { id: "cursor", sig: "readonly cursor: Cursor", doc: "Highest server sequence seen.", state: "new", rev: 2 },
          { id: "poll", sig: "startPolling(ms: number): void", doc: "Replaced by reconnect events.", state: "removed" }
        ]
      },
      {
        id: "sync-api",
        name: "Sync API",
        kind: "endpoint",
        area: "sync",
        state: "new",
        summary: "HTTP endpoints the device talks to.",
        members: [
          { id: "push", sig: "POST /v1/ops  { ops: Op[] } → { cursor }", doc: "Writes ops, dedupes by `id`, returns the new cursor." },
          { id: "pull", sig: "GET /v1/ops?after={cursor} → { ops: Op[], cursor }", doc: "Ops newer than `cursor`, max 500 per page." }
        ]
      }
    ]
  },

  roadmap: [
    { id: "m1", stage: "Local-first editing", items: ["Op log + materialized view", "Cold start from snapshot"] },
    { id: "m2", stage: "Sync", items: ["Push/pull API", "Cursor storage", "Three-way merge"] },
    { id: "m3", stage: "Polish", items: ["Conflict UI", "Status indicator"] }
  ],

  // Claude's replies to exported notes, keyed by note id.
  replies: {},

  changelog: [
    { version: 1, date: "2026-10-27", what: "First draft: three areas, three flows." },
    { version: 2, date: "2026-10-28", what: "Added cold-start and conflict flows. Clarified cursors." }
  ]
};
