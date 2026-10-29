# plan.js schema

`plan.js` is a plain script that runs before the engine:

```js
window.PLAN = { … };
```

Use template literals (backticks) for Mermaid sources. All text fields accept a small Markdown subset: `**bold**`, `*italic*`, `` `code` ``, `[link](url)`, blank-line paragraphs, and `- ` bullet lists. List-type fields (goals, pros, roadmap items, …) are inline Markdown only: no paragraphs or lists.

Ids must be lowercase kebab-case (`[a-z0-9-]`, no slashes) and unique within their list (all of an area's items share one list). Step anchors (`%% @name`) follow the same rules, per flow. **Never rename an id or anchor once the user has seen the page.** Notes are attached to it.

```js
window.PLAN = {
  id: "offline-sync",             // required. Keys browser storage and names the export file
  kind: "plan",                   // "plan" (neutral work items) | "review" (bugs with severity)
  title: "Offline sync for Notes",// required
  version: 3,                     // integer. Bump once per refinement round
  updated: "2026-10-28",

  overview: {
    summary: "2–4 sentences. Markdown.",
    goals: ["inline md", …],
    nonGoals: ["inline md", …]
  },

  areas: [{
    id: "sync",                   // required
    title: "Sync protocol",       // required
    status: "draft",              // draft | exploring | settled
    rev: 3,                       // optional: version this was last changed in
    summary: "1–2 sentences. Markdown.",

    flows: [{                     // sequence diagrams: the main content
      id: "reconnect",
      title: "Reconnect",
      rev: 3,
      mermaid: `sequenceDiagram
  participant D as Device
  participant API as Sync API
  %% @push
  D->>API: push ops`,              // `%% @push` names the message below it (a step anchor)
      actors: { D: "sync-client", API: "sync-api" },  // participant id → api type id (tooltip, drawer, links)
      caption: "One line on what to notice. Markdown."
    }],

    items: [{                     // everything pinned to a flow: findings, work, risks, decisions, questions
      id: "cursor-storage",       // descriptive slug, never a tracker code. Permanent
      type: "change",             // bug | risk | new | change | remove | decision | question
      title: "Store the cursor next to the op log",
      status: "open",             // open | doing | done | dropped (a question with an answer is done)
      flow: "reconnect",          // flow id in this area: listed under it, dotted on the diagram
      steps: ["push"],            // anchor names in that flow; or 1-based message numbers (shift on insert)
      types: ["sync-client"],     // api type ids; types whose source file is in `where` link automatically
      where: ["src/sync/SyncClient.ts:61"],
      summary: "One sentence: the symptom, or the change. Markdown.",
      trigger: "Exact reproduction conditions.",
      why: "Mechanism or current behaviour, naming fields, methods and values.",
      how: "Concrete steps (the fix, for a bug).",
      impact: "What goes wrong, how badly, for whom.",
      mitigation: "Risks: how it's prevented.",
      verify: "Test or check that proves it / done when.",
      answer: "Questions: filled in once known.",
      related: ["other-item", "api-type-id"],
      rev: 3,
      // kind "review" only (type bug): severity colours the item, origin and category label it
      severity: "medium",         // high | medium | low
      origin: "introduced",       // introduced | pre-existing
      category: "Song clock"      // subsystem affected, not the file/library it lives in
    }],

    sections: [{ id: "cursor", title: "Cursors", rev: 3, body: "Markdown, short." }],

    options: [{
      id: "sqlite", title: "SQLite op log",
      pick: true,                 // set only once decided
      body: "optional Markdown",
      pros: ["inline md", …],
      cons: ["inline md", …],
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

  changelog: [{ version: 3, date: "2026-10-28", what: "inline md summary of the round" }]
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
| diagram message, actor, note | `…/flows/<id>/msg/@<anchor>` (or `msg/<n>`, 0-based, when unanchored), `…/actor/<participant id>`, `…/note/<n>` |
| option, its pros and cons | `areas/<area>/options/<id>`, `…/pros/0`, `…/cons/1` |
| item title, summary, field paragraph | `areas/<area>/items/<id>`, `…/summary/p0`, `…/how/p0` (any text field: `why`, `answer`, …) |
| roadmap stage, item | `roadmap/<id>`, `roadmap/<id>/<n>` |
| API type, summary, body | `api/<type>`, `api/<type>/summary`, `api/<type>/body/p0` |
| API member signature, doc, detail | `api/<type>/m/<member>`, `…/doc`, `…/detail/p0` |
| API param, returns, throws | `api/<type>/m/<member>/param/<name>`, `…/returns`, `…/throws` |
| dependency graph (whole), graph node | `api/graph` or `areas/<area>/api-graph`; a node shares its type's nid |

Paragraph, bullet and unanchored message indexes (`p0`, `li1`, `msg/3`) are positions; inserting one shifts the rest. The engine recovers by each note's saved quote, but anchored messages never shift. Notes saved on older nids (`issues/…`, `work/…`, `questions/…`, `cause`/`fix`, a numbered message that now has an anchor) resolve to the new ones.

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

Live: reply with the note's `reply` command (answers land in `.live/answers.json`). Offline only: add `replies[note.id]`. Never copy notes into plan.js.
