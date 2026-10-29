---
name: plan-explorer
description: Builds a live, interactive local "map" of a plan or code review. It has sequence diagrams, issues pinned to diagram steps, and API docs tied to the file tree. The user marks up anything on the page, and each note streams to the agent, who answers and edits the plan while the page hot-reloads. Use when the user asks for a plan explorer, review map or interactive plan page, wants to "explore" or "map out" a plan, design or review, wants sequence diagrams of a plan, or wants to answer or pick up notes from one of these pages (including a *-notes-*.json).
---

# Plan Explorer

**Focus:** a map of a plan or a code review that the agent writes from the code. It shows what happens (flows), where it goes wrong (issues pinned to diagram steps), and what code is involved (API types, by file). The human explores it, marks it up, and the agent refines it over rounds. This is not a generic document annotator.

**Usage is one command; the effort goes into the data.** A plan is a folder that holds a single file, `plan.js` (`window.PLAN = { … }`). One command serves it with the skill's engine and keeps it live:

```
node <skill>/scripts/live.mjs <dir>
```

That command (re-)starts a background server for `<dir>`, prints the page URL, and then streams the user's notes as JSON lines. Every page is live:
- Saving a note sends it to you.
- Your reply appears under the note.
- Any edit to `plan.js` reloads the open page in place.
- Engine updates reach every page, because no project keeps a copy.

**Pages.** **Explore** is the home page: every area's flows with their issues under them, plus questions, options and sections, filtered by search, area tags, kind, severity, category, status and origin. **API** has a folder tree and type pages, with a foldable dependency graph. **Roadmap** and **Notes** are the other two. Diagrams are interactive: hovering a step shows a tooltip with its issues, a severity dot marks steps that have issues, clicking a step opens the issue in a side drawer, and clicking a participant opens its API type. Pinch or ⌘-scroll to zoom, drag to pan.

Skill files, relative to this SKILL.md:
- `reference/schema.md`: the full `plan.js` shape and the note format. **Read it before writing plan.js.**
- `reference/diagrams.md`: rules for good high-level sequence diagrams. **Read it before writing flows.**
- `examples/plan.js`: a complete small example.
- `scripts/live.mjs`: the server and the note stream. Protocol: `reference/live.md`.
- `scripts/verify.sh <dir>`: validates plan.js, then renders every flow in headless Chrome and reports Mermaid errors.
- `engine/explorer.html`: the renderer. It's served from here; never copy or edit it per project.
- `tests/run-engine-test.sh` and `tests/live-test.sh`: self-tests. Run them only after changing the engine or the server.

## Hard rules

- Local files only. Never publish to claude.ai Artifacts.
- Write only `plan.js`. Engine changes are a separate, explicit request. Make them in `engine/explorer.html`, bump `ENGINE_VERSION` and run both tests. Running servers pick the change up on their own.
- **Ids are permanent.** Notes attach to ids (`areas/<area>/sections/<id>/p0` …). Never rename or reuse an id. To restructure, add new ids and delete the old ones. Notes on deleted ids become "orphaned" and keep their quote, so nothing is lost, but renaming for tidiness breaks the user's notes.
- Stay high level. Actors in diagrams are systems, modules or people, not methods. Go down to classes and functions only when the user asks.
- Don't open the page or drive the browser. Give the user the URL.

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

## 1 · Seed

1. Gather context: the user's idea, docs and the relevant code, skimmed at the level of architecture.
2. Pick the folder: `<project>/Docs/<slug>-plan/` by default, or wherever the user says. `slug` is also `PLAN.id`, so keep it unique per plan.
3. Write `<dir>/plan.js` with `version: 1`:
   - an overview: a 2–4 sentence summary, goals and non-goals;
   - **3–6 areas**, each with a 1–2 sentence summary;
   - **1–3 sequence flows per area.** Aim for many small flows, not a few big ones. This is the heart of the page. Set `actors` on each one;
   - `sections` only where prose is truly needed. Keep them short;
   - `options` wherever there's a real choice. Include pros and cons, and set `pick` only once it's decided;
   - `openQuestions`: your own questions for the user. Be generous, because this is how exploration starts;
   - `api`: the types the plan touches (see "API docs"), when the plan involves code;
   - for reviews: `issues` with `flow`, `steps` and `types` set;
   - a rough `roadmap`, if it helps;
   - `changelog: [{ version: 1, date, what: "First draft" }]`, plus `replies: {}`.
4. Run `<skill>/scripts/verify.sh <dir>`. It needs network for the Mermaid CDN; if the sandbox blocks Chrome's network, rerun it with the sandbox disabled. Fix every ✗. Treat "not linked to a flow" warnings as work to do.
5. Go live (§2), and give the user the `open` URL from the `ready` line. The first visit sets a cookie, so after that the plain `url` works and can be bookmarked. Then list in one or two lines what's in the plan.

## 2 · Live: notes arrive while the user reads

Run the command with the Monitor tool, `timeout_ms` at the maximum, and the description "plan notes":

```
node <skill>/scripts/live.mjs <dir>
```

- The first line is `{"type":"ready","url","open"}`. Every line after it is a note: `{"type":"note", noteId, mark, text, where, nid, quote, target, reply, …}`. Notes saved while nothing was listening come first, with `"pending": true`.
- When the monitor expires, run the same command again. The server keeps running, and the page shows "no agent listening" in the gap.
- If the session is busy, notes wait. The page shows them as queued.

For each note:
1. Act on its mark:

   | mark | meaning | what you do |
   |---|---|---|
   | `?` | question | Answer it. If the answer changes the plan, change the plan too. |
   | `!` | concern or risk | Address it in the content (a flow, issue, section or option), and say what changed. If you disagree, say why. |
   | `+` | idea | Fold it in, as an option, flow step or section, or say why not. |
   | `✓` | agree | Lock it in: set `pick: true` on options, `status: "settled"` on areas, or answer the open question. |
   | `✗` | cut | Remove or shrink the target, and say what went. |
   | none | plain note | Treat it as context. A reply is optional. |

2. Reply with the note's `reply` command, passing the text on stdin (`<reply> <<'EOF' … EOF`).
   - A plain note that needs no answer still gets an empty reply (`echo "" | <reply>`). That marks it "seen".
   - For slow work, send `--status working` first.
   - Keep replies short and factual (see "Writing: technical facts only").
3. Briefly say in the terminal what you did, so the user can follow along there too.

**Versioning while live.** Bump `version` and `updated` once, on the first edit of a session. Set `rev` to that version on everything you add or change, because the page tags those as **Changed**. Run `verify.sh` after structural edits (new flows or diagram changes). Append one changelog entry per session.

`<dir>/.live/notes.json` always holds every note in export format: mark, text, `nid`, `quote`, `anchorState` and reply. Read it to review everything at once. `anchorState` is one of:
- `ok`: still on its target;
- `moved`: the quote was found elsewhere;
- `changed`: the element was rewritten;
- `orphaned`: the target is gone.

Use `quote` and `where` to see what the user pointed at.

`node <skill>/scripts/live.mjs status <dir>` shows the server, the agent and pending notes. `stop <dir>` shuts the server down.

To skip the approval prompt on every reply, the user can allow `Bash(node <skill>/scripts/live.mjs:*)`.

Agents without a live session use `--exec "<agent CLI>"`, which runs one process per note (see `reference/live.md`).

## 3 · Direct edits

If the user asks in chat for something like "add a flow for X" or "split area Y", edit `plan.js`, set `rev`, add a changelog line and run verify. Open pages reload on their own.

## 4 · Offline fallback

A page opened from a file (an old copied `index.html`) has no server. Its notes are exported from the Notes page as `<plan-id>-notes-<date>.json`, usually into `~/Downloads`. Work through the notes whose `status` is `open` with the §2 table. Answer in `PLAN.replies[noteId] = { text, version }`, bump `version`, set `rev`, and add a changelog entry. To get the user back online, run §2 and give them the URL.
