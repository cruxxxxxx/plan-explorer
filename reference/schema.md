# plan.js schema

`plan.js` is a plain script that runs before the engine:

```js
window.PLAN = { … };
```

Use template literals (backticks) for Mermaid sources. All text fields accept a small Markdown subset: `**bold**`, `*italic*`, `` `code` ``, `[link](url)`, blank-line paragraphs, and `- ` bullet lists. List-type fields (goals, pros, items, …) are inline Markdown only: no paragraphs or lists.

Ids must be lowercase kebab-case (`[a-z0-9-]`, no slashes) and unique within their list. **Never rename an id once the user has seen the page.** Notes are attached to it.

```js
window.PLAN = {
  id: "offline-sync",             // required. Keys browser storage and names the export file
  kind: "plan",                   // "plan" (work items, no severity) | "review" (findings with severity)
  title: "Offline sync for Notes",// required
  version: 3,                     // optional while live: the server tracks versions (reference/live.md, Bookkeeping)
  updated: "2026-10-28",          // optional while live: the server dates each change

  overview: {
    summary: "2–4 sentences. Markdown.",
    goals: ["inline md", …],
    nonGoals: ["inline md", …]
  },

  areas: [{
    id: "sync",                   // required
    title: "Sync protocol",       // required
    status: "draft",              // draft | exploring | settled
    rev: 3,                       // optional, any item: version it last changed in. Live pages tag changes on their own
    summary: "1–2 sentences. Markdown.",

    flows: [{                     // sequence diagrams: the main content
      id: "reconnect",
      title: "Reconnect",
      rev: 3,
      mermaid: `sequenceDiagram
  participant D as Device
  participant API as Sync API
  D->>API: push ops`,
      actors: { D: "sync-client", API: "sync-api" },  // participant id → api type id (tooltip, drawer, links)
      caption: "One line on what to notice. Markdown."
    }],

    issues: [{                    // kind "review": findings, sorted by severity, softly colour-coded
      id: "pause-skews-bridge",   // descriptive slug, never a tracker code
      title: "Post-seek bridge keeps running while paused",
      severity: "medium",         // high | medium | low
      category: "Song clock",     // subsystem affected, not the file/library it lives in
      where: ["Clock/SongClock.cs:145-168"],
      origin: "introduced",       // introduced | pre-existing
      flow: "reconnect",          // flow id in this area: listed under it, dotted on the diagram
      steps: [2],                 // 1-based message numbers in that flow (any arrow, incl. -->> and self-messages)
      types: ["song-clock"],      // optional api type ids; types whose source file is in `where` link automatically
      status: "open",             // open | fixing | fixed | wontfix
      summary: "One sentence: user-visible symptom. Markdown.",
      trigger: "Exact reproduction conditions.",
      cause: "Mechanism, naming fields, methods and values.",
      impact: "What breaks, how badly, for whom.",
      fix: "Concrete steps.",
      verify: "Test or check that proves it.",
      related: ["calibration-delay", "q-id", "api-type-id"],
      rev: 3
    }],

    work: [{                      // kind "plan": what gets built, pinned to flow steps. Neutral colours.
      id: "cursor-storage",       // descriptive slug, permanent
      title: "Store the cursor next to the op log",
      type: "change",             // new | change | remove | risk | decision
      status: "todo",             // todo | doing | done | dropped
      flow: "reconnect", steps: [3], types: ["sync-client"],
      where: ["src/sync/SyncClient.ts"],   // files to touch
      summary: "One sentence. Markdown.",
      why: "Current behaviour and why it changes (the cause, for fixes).",
      how: "Concrete approach.",
      impact: "Risks only: what goes wrong if it happens.",
      mitigation: "Risks only: how it's prevented.",
      verify: "Done when …",
      related: ["…"], rev: 3
    }],

    sections: [{ id: "cursor", title: "Cursors", rev: 3, body: "Markdown, short." }],

    options: [{
      id: "sqlite", title: "SQLite op log",
      pick: true,                 // set only once decided
      body: "optional Markdown",
      pros: ["inline md", …],
      cons: ["inline md", …],
      rev: 3
    }],

    openQuestions: [{
      id: "batching",
      text: "Claude's question for the user",
      answer: "optional: filled in once known",
      rev: 3
    }]
  }],

  api: {
    language: "C#",               // shown in the header; any language works for highlighting
    summary: "optional Markdown",
    types: [{
      id: "song-catalog",         // kebab-case, permanent
      name: "SongCatalog",        // shown as-is (monospace)
      kind: "class",              // class | struct | interface | enum | static | service | module | endpoint | …
      area: "audio",              // optional: Explore lists it under that area when searching
      state: "existing",          // existing | new | proposed | changed | removed
      source: "Assets/Scripts/SongCatalog.cs:12",  // drives the API tree (folder/file). Planned path for new types
      summary: "One line: what it's responsible for.",
      body: "Markdown, shown at Full detail.",
      dependsOn: ["leaderboard-service", "PerfHud"],  // type ids → edges; other names → outside nodes
      rev: 3,
      members: [{
        id: "load",               // kebab-case, permanent, unique within the type
        group: "Loading",         // optional subheading; consecutive members share it
        sig: "public static Song Load(string id)",   // verbatim for existing code
        doc: "One line.",
        state: "new",             // optional, same values as the type
        detail: "Markdown, Full only.",
        params: [{ name: "id", doc: "inline md" }],
        returns: "inline md",
        throws: "inline md",
        rev: 3
      }]
    }]
  },

  roadmap: [{ id: "m1", stage: "Local-first editing", summary: "optional md", items: ["inline md", …], rev: 3 }],

  replies: {                      // offline only: answers to exported notes, keyed by note id. Live answers win.
    "nmh3k2x9ab": { text: "Answer. Newlines OK, inline md.", version: 3 }
  },

  changelog: [{ version: 3, date: "2026-10-28", what: "inline md summary of the round" }]  // optional; live: `live.mjs log`
};
```

## Note targets (nids)

The engine gives every rendered element an id derived from the data:

| element | nid |
|---|---|
| title, summary paragraphs | `overview/title`, `overview/summary/p0` |
| goals and non-goals | `overview/goals/2`, `overview/nonGoals/0` |
| area (title and card) | `areas/<area>` |
| area summary | `areas/<area>/summary/p0` |
| section heading, paragraph, bullet | `areas/<area>/sections/<id>`, `…/p1`, `…/li0` |
| whole flow, caption | `areas/<area>/flows/<id>`, `…/caption/p0` |
| diagram message, actor, note | `…/flows/<id>/msg/<n>`, `…/actor/<participant id>`, `…/note/<n>` |
| option, its pros and cons | `areas/<area>/options/<id>`, `…/pros/0`, `…/cons/1` |
| issue title, summary, field paragraph | `areas/<area>/issues/<id>`, `…/summary/p0`, `…/fix/p0` (also `trigger`, `cause`, `impact`, `verify`) |
| work title, summary, field paragraph | `areas/<area>/work/<id>`, `…/summary/p0`, `…/how/p0` (also `why`, `impact`, `mitigation`, `verify`) |
| open question, answer | `areas/<area>/questions/<id>`, `…/answer` |
| roadmap stage, item | `roadmap/<id>`, `roadmap/<id>/<n>` |
| API type, summary, body | `api/<type>`, `api/<type>/summary`, `api/<type>/body/p0` |
| API member signature, doc, detail | `api/<type>/m/<member>`, `…/doc`, `…/detail/p0` |
| API param, returns, throws | `api/<type>/m/<member>/param/<name>`, `…/returns`, `…/throws` |
| dependency graph (whole), graph node | `api/graph` or `areas/<area>/api-graph`; a node shares its type's nid |

Paragraph, bullet and message indexes (`p0`, `li1`, `msg/3`) are positions. Inserting a paragraph or message shifts the ones after it. The engine recovers by searching for each note's saved quote, so this is fine, but prefer appending over inserting in the middle when it's easy.

## Notes export (`.live/notes.json`, or `<plan-id>-notes-<date>.json` from the Notes page)

Live pages keep `<dir>/.live/notes.json` current in this format. A page with no server can only export it by hand.

```json
{
  "format": "plan-explorer-notes",
  "engine": "2.5.0",
  "plan": "offline-sync",
  "title": "Offline sync for Notes",
  "planVersion": 2,
  "page": "/",
  "exportedAt": "2026-10-28T22:10:00.000Z",
  "counts": { "total": 4, "open": 3, "answered": 0, "resolved": 1, "orphaned": 0 },
  "notes": [{
    "id": "nmh3k2x9ab",
    "mark": "?",                          // "?" | "!" | "+" | "✓" | "✗" | null
    "markName": "Question",
    "status": "open",                     // open | answered (has a reply) | resolved (user closed it)
    "text": "why sqlite and not core data?",
    "where": "Local store › Summary › ¶1",// human label for the target
    "nid": "areas/local-store/summary/p0",// where it points now
    "originalNid": "areas/local-store/summary/p0",
    "anchorState": "ok",                  // ok | moved | changed | orphaned
    "kind": "text",                       // text = a selected phrase, element = a clicked element
    "quote": "local SQLite op log",       // the selected phrase, or the start of the element's text
    "prefix": "Every edit lands in a ",
    "suffix": " first. The UI reads",
    "reply": null,                        // Claude's current reply text, if any
    "created": "…", "updated": "…"
  }]
}
```

Live: reply with the note's `reply` command, or a batch's `replies` command (answers land in `.live/answers.json`). Offline only: add `replies[note.id]`. Never copy notes into plan.js.
