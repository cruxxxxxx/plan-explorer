---
name: plan-explorer
description: Builds a live, interactive local "map" of a plan or code review. It has sequence diagrams, findings and work pinned to diagram steps, and API docs tied to the file tree. The user marks up anything on the page, and each note streams to the agent, who answers and edits the plan while the page hot-reloads. Use when the user asks for a plan explorer, review map or interactive plan page, wants to "explore" or "map out" a plan, design or review, wants sequence diagrams of a plan, or wants to answer or pick up notes from one of these pages (including a *-notes-*.json).
---

# Plan Explorer

A plan is a folder holding `plan.js` (`window.PLAN = { … }`), which you write from the code: flows (sequence diagrams), items pinned to diagram steps, and API types by file. `node <skill>/scripts/live.mjs <dir>` serves it with the skill's engine, streams the user's notes to you, and hot-reloads the page when you edit `plan.js`.

**Read on demand** (paths relative to this file):
- `reference/content.md`: before seeding or restructuring. `kind`, items, anchors, API docs, writing rules.
- `reference/diagrams.md`: before writing or reshaping flows.
- `reference/schema.md`: when unsure of a field's shape or a note's `nid`.
- `reference/live.md`: live-loop details, `--exec`, a `*-notes-*.json` file (offline fallback), or anything misbehaving.
- `examples/plan/plan.js`, `examples/review/plan.js`: small plans to copy the shape from.

## Rules

- Local files only; never Artifacts. Don't open the page or drive a browser; give the user the URL.
- Write only `<dir>/plan.js`. Engine or server changes are a separate, explicit request (then run the `tests/`).
- **Ids are permanent**, and so are anchor names. Notes attach to them. Never rename or reuse one; to restructure, add new ids and delete old ones.
- Stay high level: diagram participants are systems, modules or people, not methods, unless the user asks.
- **Technical facts only**, in `plan.js` and in replies: no process narration ("I checked", reviewers, how it was found), no verdict lead-ins or hedging. One fact per sentence, naming the component, condition and consequence.

**Items.** Everything pinned to a flow goes in `areas[].items`: `type` `bug|risk|new|change|remove|decision|question`, `status` `open|doing|done|dropped`, `flow`, `steps`, `types`. `kind: "review"` → bugs with `severity`; `kind: "plan"` → never severity. Pin steps by name: `%% @name` directly above the message, `steps: ["name"]`. Old `issues`/`work`/`openQuestions` still render; `scripts/migrate-plan.mjs` converts them.

## 1 · Seed

1. Skim the user's idea, docs and code at architecture level. Read `reference/content.md` and `reference/diagrams.md`.
2. Folder: `<project>/Docs/<slug>-plan/` unless the user says otherwise. `slug` is `PLAN.id`.
3. Write `plan.js`: `kind`, an overview, 3–6 areas with 1–3 small flows each (with `actors`), items pinned by `flow`/anchored `steps`/`types`, options, generous `question` items, `api` types when code is involved. No `version`, `rev` or `changelog`.
4. `node <skill>/scripts/check.mjs <dir>/plan.js`. Fix every ✗; treat "not linked to a flow" as work. Then run `<skill>/scripts/verify.sh <dir>` once (headless Chrome; needs network, so disable the sandbox if Chrome can't reach the CDN).
5. Go live (§2). Give the user the `open` URL from the `ready` line (later visits can use `url`), and say in one or two lines what the plan holds.

## 2 · Live

Run with the Monitor tool, `timeout_ms` at the maximum, description "plan notes": `node <skill>/scripts/live.mjs <dir>`. When it expires, run it again; the server keeps running.

Lines it prints:
- `{"type":"ready",url,open}`.
- `{"type":"note",noteId,mark,text,where,nid,quote,target?,pending?,reply}`: one note. `pending` notes were saved while nothing listened.
- `{"type":"notes",notes:[…],replies}`: notes saved within 2 s of each other (no per-note `reply`). Handle them all in one turn.
- `{"type":"check",ok:false,errors}`: your last edit broke `plan.js`, a diagram or an anchor. Fix it; `ok:true` follows.

Act on each note's mark:

| mark | meaning | what you do |
|---|---|---|
| `?` | question | Answer it. If the answer changes the plan, change the plan too. |
| `!` | concern | Address it in the content (flow, item, section or option) and say what changed, or say why not. |
| `+` | idea | Fold it in (option, flow step, section) or say why not. |
| `✓` | agree | Lock it in: `pick: true`, area `status: "settled"`, a question's `answer`, or an item's `status`. |
| `✗` | cut | Remove or shrink the target, and say what went. |
| none | plain note | Context. Reply optional. |

**Reply** with the note's `reply` command, text on stdin (`<reply> <<'EOF' … EOF`). For a batch, use its one `replies` command:

```
<replies> <<'EOF'
--- <noteId>
answer
--- <noteId>
answer
EOF
```

An empty answer marks a plain note "seen". For slow work, send the same command with `--status working` first. Keep replies short and factual, then say in one terminal line what you did.

**Bookkeeping is automatic.** The server diffs each save, tags changed items "Changed", starts a new version after a 30-minute gap, and writes it all to `<dir>/history.json` (commit it with `plan.js`; never edit it). Optionally, `live.mjs log <dir> "what changed"` adds a changelog entry.

**Checks.** While live, the listener lints every edit (structure, anchors, Mermaid) and reports only failures. Run `verify.sh` only after structural diagram changes (new flows, participants or blocks) or when the page shows "Diagram error".

`<dir>/.live/notes.json` holds every note with its `anchorState` (`ok`, `moved`, `changed`, `orphaned`). `live.mjs status <dir>` shows the server, version, changed ids and pending notes; `stop <dir>` shuts it down. To skip the approval prompt per reply, the user can allow `Bash(node <skill>/scripts/live.mjs:*)`.

## 3 · Direct edits and offline

For a chat request such as "add a flow for X", edit `plan.js`. While live, the check runs on its own; otherwise run `check.mjs`. For a `*-notes-*.json` file or a page opened from a file, follow "Offline fallback" in `reference/live.md`.
