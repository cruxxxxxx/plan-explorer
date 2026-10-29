---
name: plan-explorer
description: Builds and refines an interactive local "map" of a plan or code review. It has sequence diagrams, issues pinned to diagram steps, and API docs tied to the file tree, plus click-anywhere notes the user exports as JSON or sends live through a localhost bridge. Use when the user asks for a plan explorer, review map or interactive plan page, wants to "explore" or "map out" a plan, design or review, wants sequence diagrams of a plan, hands back a *-notes-*.json from one of these pages, or asks to go live with or answer questions from the page.
---

# Plan Explorer

**Focus:** a map of a plan or a code review that the agent writes from the code. It shows what happens (flows), where it goes wrong (issues pinned to diagram steps), and what code is involved (API types, by file). The human explores it, marks it up, and the agent refines it over rounds. This is not a generic document annotator.

A plan explorer is a folder with two files:

```
<dir>/index.html   ← the engine, copied verbatim from engine/explorer.html. Never edit it per project.
<dir>/plan.js      ← all the content: window.PLAN = { … }. This is the only file you write.
```

The engine renders `plan.js`. It handles the Swiss-style light and dark layout, Mermaid diagrams (pinch or ⌘-scroll to zoom, drag to pan, full screen), notes and export.

**Pages.** **Explore** is the home page: every area's flows with their issues listed under them, plus questions, options and sections, all filtered by search, area tags, kind, severity, category, status and origin. **API** has a folder tree on the left and a type page on the right, with a foldable dependency graph. **Roadmap** and **Notes** are the other two. Diagrams are interactive: hovering a step shows a tooltip with its linked issues, a severity dot marks steps that have issues, clicking a step opens the issue in a side drawer, and clicking a participant opens its API type. The user opens `index.html` from disk (`file://`) with no server and no build. Mermaid is the only dependency, loaded from the jsDelivr CDN.

Skill files, relative to this SKILL.md:
- `engine/explorer.html`: the engine.
- `reference/schema.md`: the full `plan.js` shape and the note-export format. **Read it before writing plan.js.**
- `reference/diagrams.md`: rules for good high-level sequence diagrams. **Read it before writing flows.**
- `examples/plan.js`: a complete small example.
- `scripts/verify.sh <dir>`: validates plan.js, then renders every flow in headless Chrome and reports Mermaid errors.
- `scripts/live.mjs`: the optional live bridge, so the page can ask questions and see the plan update in place. Protocol: `reference/live.md`.
- `tests/run-engine-test.sh` and `tests/live-test.sh`: engine and bridge self-tests. Run them only after changing the engine or the bridge.

## Hard rules

- Local files only. Never publish to claude.ai Artifacts.
- Edit `plan.js`, not `index.html`. Engine changes are a separate, explicit request. Make them in `engine/explorer.html`, bump `ENGINE_VERSION`, run the engine test, then re-copy the engine into projects.
- **Ids are permanent.** Notes attach to ids (`areas/<area>/sections/<id>/p0` …). Never rename or reuse an id. To restructure, add new ids and delete the old ones. Notes on deleted ids become "orphaned" and keep their quote, so nothing is lost, but renaming for tidiness breaks the user's notes.
- Stay high level. Actors in diagrams are systems, modules or people, not methods. Go down to classes and functions only when the user asks.
- Don't open the page or drive the browser. Give the user the path (`open <dir>/index.html`).

## Writing: technical facts only

Everything in `plan.js` (summaries, sections, captions, options, answers, replies, the changelog) states technical facts about the system and the plan. Nothing else.

- **No process narration.** Never describe how a fact was found: no reviewers, agents, "antagonist", verification passes, "compared line by line", "I checked" or "we found".
- **No verdicts or framing lead-ins** such as "X is a faithful move:", "Good news:", "In short," or "Overall,". Start with the fact itself.
- **No hedging, filler or recap.** No "it's worth noting" or "as mentioned above".
- One fact per sentence. Name the concrete thing: the component, field, condition and consequence.

Bad:
> The koreo split is a faithful move: the antagonist compared it line by line, and the delay invariant holds. Calibration has two old bugs, and the deleted post-seek guards leave one gap: the clock bridge keeps running while paused.

Good:
> The koreo split preserves the delay invariant.
> - Calibration: two pre-existing bugs (list them).
> - Removing the post-seek guards leaves the clock bridge running while paused.

This applies to replies too. Answer the question directly. Don't say what you looked at to get the answer.

## Issues (reviews, audits, bugs)

Findings go in `areas[].issues`, never in `sections`. The engine sorts them by severity, colours them softly (high / medium / low), and shows them on Explore under their flow. The severity pills on each area work as filter tabs. Clicking an issue opens its full context in the drawer, and every field can take notes.

**Labels**
- `id`: a descriptive kebab slug (`pause-skews-bridge`). Never a tracker code like `KOREO-1`, `ANT-6` or `X-2`. Reviewer or agent prefixes are process; they never appear in ids, titles or text.
- `title`: the problem in plain words (`Post-seek bridge keeps running while paused`). No code prefix, no severity, no branch.
- `category`: the subsystem that is **affected**, from the user's point of view (`Calibration`, `Song clock`, `Scoring`, `Scene flow`). Don't use the file or library the bug happens to live in. A Koreographer-callback bug that skews calibration is `Calibration`.
- `severity`: `high | medium | low`. Exactly one. Never a range like "medium-low".
- `origin`: `pre-existing` (also on the base branch) or `introduced` (new in this change). Use this field rather than writing "(present on cleanup-audit)" into the title.

**Context.** Each issue must stand alone, so someone who fixes it never needs the review transcript:
- `where`: every `path:line` involved.
- `summary`: one sentence giving the user-visible symptom.
- `trigger`: the exact conditions that reproduce it.
- `cause`: the mechanism, naming the fields, methods and values involved.
- `impact`: what goes wrong, how badly, and for whom.
- `fix`: concrete steps, naming the methods to change.
- `verify`: the test or manual check that proves the fix.
- `related`: ids of other issues, open questions or API types (rendered as links). Merged duplicates are listed here, not in the title.
- `status`: `open | fixing | fixed | wontfix`.

**Link every issue** so it appears on the diagrams instead of in a separate list:
- `flow`: the id of the flow in the same area where it happens. The issue is then listed under that flow.
- `steps`: 1-based message numbers in that flow (count `A->>B:` lines from the top, skipping `%%`). Each step gets a severity dot.
- `types`: API type ids it touches. Types whose `source` file appears in `where` are linked automatically.
Only fixed or wontfix issues, or issues with no fitting flow, may go without a flow. If an issue has no flow to sit on, consider adding the flow.

Low-value nits can share one `sections` entry ("Small cleanups") as a bullet list. Anything with a fix someone would schedule is an issue.

## API docs

`PLAN.api` holds the types the plan touches, so the page doubles as API docs. The API page has a left-hand tree built from each type's `source` directory and file, with a filter box. The right pane shows either the dependency graph (grouped by top-level folder, and folded by default above 18 types) or one type: its path, summary, **Depends on** / **Used by**, the members table (**Signatures** or **Full**), the issues in its file, the flows it appears in, and a neighbourhood graph. `source` drives the tree, so set it on every type, including new ones (the planned path).

**Retrieve or create**

1. **Existing code** (`state: "existing"`): get these from the source. Copy public signatures verbatim. Take `doc` from existing doc comments (XML doc, JSDoc, docstrings, OpenAPI) where they exist; otherwise write one factual line. Set `source: "path/File.ext:line"`.
2. **Planned changes:** `state: "new"` for proposed types or members, `"changed"` for existing ones with edits, `"removed"` for ones the plan deletes. Proposed signatures use the codebase's real conventions and types.
3. Include only types the plan touches, plus their direct dependencies. That's usually 5–40. For a big extraction, fan out Explore subagents, one per area, each returning type, signature and doc tuples.
4. Fill in detail in layers. Always give `summary` and every member's `sig` and `doc`. Add `body`, `detail`, `params`, `returns` and `throws` where they add information. Full detail is for decisions, not boilerplate.
5. `dependsOn` lists type ids (drawn as edges) or free names (drawn as rounded "outside" nodes).
6. **Couple it to the flows.** For each flow, set `actors: { <participant id>: <type id> }` for every participant that is a type. A participant whose label matches a type name is linked automatically.

The same rules apply: ids are permanent, and docs state technical facts only.

## Say it once

Every fact lives in one place. The page reaches it from elsewhere through links, tooltips and the drawer.
- Couple content by context, not by resource type. An issue belongs under the flow where it happens, and a type is reached from the participant that uses it. Don't add an "Issues" section or a list of types per area.
- Don't repeat an issue's summary in a section or caption. Link to it with `related` or `flow`/`steps`.
- Captions say what to notice in the diagram, not what the issues say.

## 1 · Seed a new explorer

1. Gather context: the user's idea, docs and the relevant code, skimmed at the level of architecture.
2. Pick the folder: `<project>/Docs/<slug>-explorer/` by default, or wherever the user says. `slug` is also `PLAN.id`, which keys browser storage, so keep it unique per plan.
3. `cp <skill>/engine/explorer.html <dir>/index.html`
4. Write `<dir>/plan.js` with `version: 1`:
   - an overview: a 2–4 sentence summary, goals and non-goals;
   - **3–6 areas**, each with a 1–2 sentence summary;
   - **1–3 sequence flows per area.** Aim for many small flows, not a few big ones. This is the heart of the page. Set `actors` on each one;
   - `sections` only where prose is truly needed. Keep them short;
   - `options` wherever there's a real choice. Include pros and cons, and set `pick` only once it's decided;
   - `openQuestions`: your own questions for the user. Be generous here, because this is how exploration starts;
   - `api`: the types the plan touches (see "API docs"), when the plan involves code;
   - for reviews: `issues` with `flow`, `steps` and `types` set;
   - a rough `roadmap`, if it helps;
   - `changelog: [{ version: 1, date, what: "First draft" }]`, plus `replies: {}`.
5. Run `<skill>/scripts/verify.sh <dir>`. It needs network for the Mermaid CDN; if the sandbox blocks Chrome's network, rerun it with the sandbox disabled. Fix every ✗. Treat "not linked to a flow" warnings as work to do.
6. Reply briefly: give the path, list what's in it, and say how to annotate: **N** toggles note mode, **Alt-click** notes anything, selecting text notes a phrase, and **Export JSON** is on the Notes page.

## 2 · Refine from exported notes

The user exports `<plan-id>-notes-<date>.json`. Usually it lands in `~/Downloads`; look for the newest `~/Downloads/<plan-id>-notes-*.json` unless they give a path. They may also paste the JSON. The format is in `reference/schema.md`. Each note has `mark`, `text`, `where`, `nid`, `quote` and `anchorState`.

Go through every note whose `status` is `open`. Skip `resolved` notes, and `answered` ones unless the user added more text since the reply.

| mark | meaning | what you do |
|---|---|---|
| `?` | question | Answer in `replies[id]`. If the answer changes the plan, change the plan too. |
| `!` | concern or risk | Address it in the content (a flow, section or option) and reply with what changed. If you disagree, say why. |
| `+` | idea | Fold it in, as an option, flow step or section, or reply with why not. |
| `✓` | agree | Lock it: set `pick: true` on options, `status: "settled"` on areas, or answer the open question. A reply is optional. |
| `✗` | cut | Remove or shrink the target. Reply saying what went. |
| none | plain note | Treat it as context. Reply if useful. |

`anchorState` tells you where the note now points:
- `ok`: still on its target.
- `moved`: the quote was found elsewhere.
- `changed`: the element still exists but its text was rewritten.
- `orphaned`: the target is gone.

Use `quote` and `where` to see what the user pointed at, even when the target no longer exists.

Then:
1. Bump `PLAN.version` and `updated`.
2. Set `rev: <new version>` on every item you added or changed (areas, flows, sections, options, questions, roadmap stages, API types and members). The page tags these as **Changed**.
3. Write `replies[noteId] = { text, version }` for each note you respond to. Replies show inline under the user's note.
4. Append a changelog entry that summarizes the round.
5. Run `verify.sh` and fix any errors.
6. In chat, give a short summary: what you answered, what changed, and any new open questions. Keep the detail in the page, not the chat. State facts only (see "Writing: technical facts only").

## 3 · Small direct edits

If the user asks for something like "add a flow for X" or "split area Y", edit `plan.js`, set `rev`, add a changelog line and run verify. Don't wait for an export.

## 4 · Live mode (questions from the page, answered in this session)

Use this when the user asks to go live, or wants to ask questions from the page. It's optional; export JSON (§2) always works.

1. Start the server in the background (Bash with `run_in_background`):
   `node <skill>/scripts/live.mjs serve <dir>`
   Then read `<dir>/.live/server.json` and give the user its `url`. The page must be opened at that `http://127.0.0.1` URL, not from `file://`. Don't open it yourself.
2. Watch for questions with the Monitor tool:
   `node <skill>/scripts/live.mjs listen <dir>`, with `timeout_ms` at the maximum and a description of "plan-explorer questions".
   When the monitor expires, re-arm it with the same command. The server keeps running, and questions asked in the meantime come out first (`"pending": true`).
3. For each `ask` line:
   - Answer briefly in the terminal so the user can follow along.
   - If it's a question, reply with the answer. If it asks for a change (`!`, `+`, `✗`, `✓`, or an explicit request), edit `plan.js` following the §2 mark table, and reply with one line saying what changed. The page reloads on its own.
   - Send the reply with the event's `reply` command (`… reply <dir> <noteId> -` with the text on stdin). For slow answers, send `--status working` first.
   - Live edits share one version per session: bump `version` on the first edit, then set `rev` to that version on everything you touch. Add one changelog entry when the session ends.
   - "Technical facts only" applies to replies.
4. Stop: TaskStop the monitor and the server. Notes stay in `<dir>/.live/notes.json` (export format), so §2 works on them without an export.

For agents without a live session, `serve --exec "<agent CLI>"` runs one process per question (see `reference/live.md`).

To skip the approval prompt on every reply, the user can allow `Bash(node <skill>/scripts/live.mjs:*)`.

