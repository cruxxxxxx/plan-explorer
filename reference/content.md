# Writing plan.js content

Read this before seeding a plan or restructuring one. The exact field shapes are in `schema.md`; diagram rules are in `diagrams.md`.

**Focus:** a map of a plan or a code review that the agent writes from the code. It shows what happens (flows), where it goes wrong (issues pinned to diagram steps), and what code is involved (API types, by file). The human explores it, marks it up, and the agent refines it over rounds. This is not a generic document annotator.

**Pages.** **Explore** is the home page: every area's flows with their issues under them, plus questions, options and sections, filtered by search, area tags, kind, severity, category, status and origin. **API** has a folder tree and type pages, with a foldable dependency graph. **Roadmap** and **Notes** are the other two. Diagrams are interactive: hovering a step shows a tooltip with its issues, a severity dot marks steps that have issues, clicking a step opens the issue in a side drawer, and clicking a participant opens its API type. Pinch or ⌘-scroll to zoom, drag to pan.

## Seed checklist

- an overview: a 2–4 sentence summary, goals and non-goals;
- **3–6 areas**, each with a 1–2 sentence summary;
- **1–3 sequence flows per area.** Aim for many small flows, not a few big ones. This is the heart of the page. Set `actors` on each one;
- `sections` only where prose is truly needed. Keep them short;
- `options` wherever there's a real choice. Include pros and cons, and set `pick` only once it's decided;
- `openQuestions`: your own questions for the user. Be generous, because this is how exploration starts;
- `api`: the types the plan touches (see "API docs"), when the plan involves code;
- `kind` (below). Reviews get `issues`, and plans get `work`. Either way, set `flow`, `steps` and `types` on each one;
- a rough `roadmap`, if it helps;
- `replies: {}` only for the offline fallback. `version`, `updated`, `rev` and `changelog` are optional: the live server tracks them (see `live.md`, "Bookkeeping").

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

## Context decides the shape: `kind`

Set `PLAN.kind` first, because it decides how everything pinned to a flow reads:

| `kind` | what it is | pinned items | how they read |
|---|---|---|---|
| `"review"` | code review, audit, bug hunt: something that exists and may be wrong | `areas[].issues` (findings) | severity high/medium/low, origin, open → fixed |
| `"plan"` | implementation plan, design, feature build: something to be made | `areas[].work` | type `new` · `change` · `remove` · `risk` · `decision`, status `todo` → `doing` → `done`. Neutral colours, no severity. |

- Never put severity on planned work. A plan full of red and amber dots reads like a bug report, which is a false alarm.
- Things that might go wrong in a plan are `work` items with `type: "risk"`, using `impact` and `mitigation`.
- A current problem that the plan fixes is work too. Title it as the change (`Save an unlock the moment it is earned`), and put the current behaviour and cause in `why`. Use `issues` in a plan only for a bug that's out of the plan's scope and still worth flagging.
- Fields for `work`: `title`, `type`, `status`, `flow`, `steps`, `types`, `where` (files to touch), `summary`, `why` (current behaviour, or the cause when the work fixes something), `how`, `impact`, `mitigation` (for risks), `verify` (done when), `related`. Work is ordered by where it happens in its flow.
- Let the kind shape the rest too. A plan leans on `options`, `openQuestions` and `roadmap`. A review leans on `issues` and API types `state: "changed"`.

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
