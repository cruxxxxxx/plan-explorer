// Plan Explorer data: an implementation plan. Work items (areas[].items) are pinned to flow steps by anchor (%% @name).
// Schema: ~/.claude/skills/plan-explorer/reference/schema.md
window.PLAN = {
  id: "offline-sync-build",
  kind: "plan",
  title: "Offline sync for Notes",
  version: 1,
  updated: "2026-10-29",
  overview: {
    summary: `Notes works fully offline and reconciles edits on reconnect.

The server stays the source of truth. Each device keeps a local **op log** and replays it on reconnect.`,
    goals: [
      "Edit any note with no connection",
      "Reconnect merges silently in the common case",
      "Conflicts are rare, visible, and never lose text"
    ],
    nonGoals: ["Real-time multiplayer cursors", "Peer-to-peer sync"]
  },
  areas: [
    {
      id: "local-store",
      title: "Local store",
      status: "exploring",
      summary: "Every edit lands in a local SQLite op log first. The UI reads from a materialized view.",
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
  %% @append-op-insert
  UI->>Log: append op (insert, pos, text)
  %% @apply-op
  Log->>View: apply op
  %% @re-render-note
  View-->>UI: re-render note`,
          actors: { Log: "op-log" },
          caption: "The editor never waits on anything slower than a local write."
        },
        {
          id: "cold-start",
          title: "Cold start",
          mermaid: `sequenceDiagram
  participant App
  participant Log as Op log
  participant View as Note view
  %% @load-snapshot-note
  App->>View: load snapshot<br/>(note_view)
  %% @read-unsynced-ops
  App->>Log: read unsynced ops
  Log->>View: apply each op
  View-->>App: ready`,
          actors: { Log: "op-log" },
          caption: "Startup cost is the snapshot plus unsynced ops, not the whole history."
        }
      ],
      items: [
        {
          id: "op-log-table",
          type: "new",
          title: "Op log table and OpLog.append",
          flow: "edit-offline",
          steps: ["append-op-insert"],
          where: ["src/store/OpLog.ts", "src/db/migrations/004_op_log.sql"],
          summary: "Table `ops(id, note_id, kind, pos, text, lamport, synced)` and a single-writer `append`.",
          how: "`append` runs `INSERT` and the view update in one `SqliteDb.tx`.",
          verify: "OpLogTests: append 1k ops, reopen, all present in order."
        },
        {
          id: "append-durability",
          type: "risk",
          title: "Append must be durable before the UI shows it saved",
          flow: "edit-offline",
          steps: ["append-op-insert"],
          where: ["src/store/OpLog.ts"],
          impact: "With `synchronous=OFF`, a crash within ~200 ms of typing loses those ops.",
          mitigation: "Open the log connection with `synchronous=NORMAL`; resolve `append` after commit."
        },
        {
          id: "view-from-log",
          type: "change",
          title: "Note view reads from the materialized view",
          flow: "edit-offline",
          steps: ["apply-op", "re-render-note"],
          where: ["src/notes/NoteView.ts"],
          types: ["op-log"],
          how: "Replace the network fetch in `NoteView.load` with a read of `note_view`; subscribe to `OpLog` applies.",
          status: "doing"
        },
        {
          id: "snapshot-on-launch",
          type: "new",
          title: "Snapshot + unsynced replay on launch",
          flow: "cold-start",
          steps: ["load-snapshot-note", "read-unsynced-ops"],
          where: ["src/app/boot.ts"],
          how: "Load `note_view` as the snapshot, then `OpLog.unsynced()` and apply in lamport order.",
          verify: "Boot benchmark: 10k-op history starts in under 300 ms."
        },
        {
          id: "compaction",
          type: "question",
          title: "Compact the op log on sync ack, or on a timer?"
        }
      ],
      options: [
        {
          id: "sqlite",
          title: "SQLite op log",
          pick: true,
          pros: ["Shipped on both platforms", "Append + apply in one transaction"],
          cons: ["Schema migrations on app updates"]
        },
        {
          id: "files",
          title: "Append-only files",
          pros: ["Simple to inspect"],
          cons: ["Compaction is on us", "No atomic multi-file writes"]
        }
      ]
    },
    {
      id: "sync",
      title: "Sync protocol",
      status: "draft",
      summary: "On reconnect the device pushes unsynced ops, then pulls everything after its cursor.",
      flows: [
        {
          id: "reconnect",
          title: "Reconnect",
          mermaid: `sequenceDiagram
  participant D as Device
  participant API as Sync API
  participant DB as Server DB
  %% @push-ops-since
  D->>API: push ops since cursor
  API->>DB: write ops (dedupe by id)
  %% @ack-new-cursor
  API-->>D: ack + new cursor
  %% @pull-ops-after
  D->>API: pull ops after cursor
  API-->>D: remote ops
  D->>D: merge and apply`,
          actors: { D: "sync-client", API: "sync-api" },
          caption: "Push first, so the server has the device's view before answering the pull."
        }
      ],
      items: [
        {
          id: "push-pull-endpoints",
          type: "new",
          title: "POST /v1/ops and GET /v1/ops",
          flow: "reconnect",
          steps: ["push-ops-since", "pull-ops-after"],
          types: ["sync-api"],
          how: "Push dedupes by op `id`; pull pages 500 ops after `cursor`.",
          verify: "API contract tests for dedupe and paging."
        },
        {
          id: "cursor-storage",
          type: "change",
          title: "Store the cursor next to the op log",
          flow: "reconnect",
          steps: ["ack-new-cursor"],
          where: ["src/sync/SyncClient.ts"],
          how: "Write `cursor` in the same transaction that marks ops `synced`.",
          status: "done"
        },
        {
          id: "drop-polling",
          type: "remove",
          title: "Remove SyncClient.startPolling",
          where: ["src/sync/SyncClient.ts"],
          how: "Reconnect events replace the 30 s poll timer."
        },
        {
          id: "batch-pushes",
          type: "decision",
          title: "Push in batches of up to 500 ops",
          flow: "reconnect",
          steps: ["push-ops-since"],
          summary: "One request per batch; the cursor advances per acked batch."
        }
      ]
    }
  ],
  api: {
    language: "TypeScript",
    types: [
      {
        id: "op-log",
        name: "OpLog",
        kind: "class",
        area: "local-store",
        state: "new",
        source: "src/store/OpLog.ts",
        summary: "Append-only log of edit ops, persisted in SQLite.",
        dependsOn: ["sqlite-db"],
        members: [
          {
            id: "append",
            sig: "append(op: Op): Promise<void>",
            doc: "Persists one op and applies it to the note view."
          },
          {
            id: "unsynced",
            sig: "unsynced(after?: Cursor): AsyncIterable<Op>",
            doc: "Ops not yet acked, oldest first."
          }
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
          {
            id: "tx",
            sig: "tx<T>(fn: (t: Tx) => Promise<T>): Promise<T>",
            doc: "Runs `fn` in one transaction."
          }
        ]
      },
      {
        id: "sync-client",
        name: "SyncClient",
        kind: "class",
        area: "sync",
        state: "changed",
        source: "src/sync/SyncClient.ts:8",
        summary: "Pushes local ops and pulls remote ops on reconnect.",
        dependsOn: ["op-log", "sync-api"],
        members: [
          {
            id: "sync",
            sig: "sync(): Promise<SyncResult>",
            doc: "Push then pull; concurrent calls share one run."
          },
          {
            id: "poll",
            sig: "startPolling(ms: number): void",
            doc: "Replaced by reconnect events.",
            state: "removed"
          }
        ]
      },
      {
        id: "sync-api",
        name: "Sync API",
        kind: "endpoint",
        area: "sync",
        state: "new",
        source: "server/routes/ops.ts",
        summary: "HTTP endpoints the device talks to.",
        members: [
          {
            id: "push",
            sig: "POST /v1/ops  { ops: Op[] } → { cursor }",
            doc: "Writes ops, dedupes by `id`."
          },
          {
            id: "pull",
            sig: "GET /v1/ops?after={cursor} → { ops: Op[], cursor }",
            doc: "Ops after `cursor`, 500 per page."
          }
        ]
      }
    ]
  },
  roadmap: [
    {
      id: "m1",
      stage: "Local-first editing",
      items: ["Op log + materialized view", "Cold start from snapshot"]
    },
    {
      id: "m2",
      stage: "Sync",
      items: ["Push/pull API", "Cursor storage"]
    }
  ],
  replies: {},
  changelog: [
    { version: 1, date: "2026-10-29", what: "First draft." }
  ]
};
