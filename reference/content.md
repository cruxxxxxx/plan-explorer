# Writing plan.js content

Read this before seeding a plan or restructuring one. The exact field shapes are in `schema.md`; diagram rules are in `diagrams.md`.

**Focus:** a map of a plan or a code review that the agent writes from the code. It shows what happens (flows), where it goes wrong or changes (items pinned to diagram steps), and what code is involved (API types, by file). The human explores it, marks it up, and the agent refines it over rounds. This is not a generic document annotator.

**Pages.** **Explore** is the home page: every area's flows with their items under them, plus options and sections, filtered by search, area, type, severity, category, status and origin. **API** has a folder tree and type pages, with a foldable dependency graph. **Roadmap** and **Notes** are the other two. Diagrams are interactive: hovering a step shows its items, a dot marks steps that have items, clicking a step opens the item in a side drawer, and clicking a participant opens its API type. Pinch or ⌘-scroll to zoom, drag to pan.

## Seed checklist

- `kind` first (see "Items");
- an overview: a 2–4 sentence summary, goals and non-goals;
- **3–6 areas**, each with a 1–2 sentence summary;
- **1–3 sequence flows per area.** Aim for many small flows, not a few big ones. This is the heart of the page. Set `actors` on each one, and put a `%% @name` anchor above every message an item is pinned to;
- `items`: findings or work, each with `flow`, anchored `steps` and `types`, plus `question`s for the user. Be generous with questions, because this is how exploration starts;
- `sections` only where prose is truly needed. Keep them short;
- `options` wherever there's a real choice. Include pros and cons, and set `pick` only once it's decided;
- `api`: the types the plan touches (see "API docs"), when the plan involves code;
- a rough `roadmap`, if it helps;
- `replies: {}` only for the offline fallback. `version`, `updated`, `rev` and `changelog` are not written by hand: the live server keeps them in `history.json` next to `plan.js` (see `live.md`, "Bookkeeping").

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

## Items: everything pinned to a flow

Findings, work, risks, decisions and questions are all **items** in `areas[].items`, with one shape:

| field | |
|---|---|
| `id`, `title` | descriptive kebab slug (`pause-skews-bridge`, never a tracker code like `KOREO-1`); the problem or change in plain words, no severity or branch |
| `type` | `bug` · `risk` · `new` · `change` · `remove` · `decision` · `question` |
| `status` | `open` → `doing` → `done`, or `dropped` (kept for the record, hidden by default) |
| `flow`, `steps` | the flow in this area where it happens, and the anchored steps on it (see "Anchors") |
| `types`, `where` | API type ids it touches; every `path:line` (types whose `source` is in `where` link automatically) |
| `summary` | one sentence: the user-visible symptom, or the change |
| `trigger`, `why`, `how` | exact reproduction · mechanism or current behaviour, naming fields, methods and values · concrete steps or fix, naming the methods to change |
| `impact`, `mitigation`, `verify` | what goes wrong, how badly and for whom · how it's prevented (risks) · the test that proves it / done when |
| `answer`, `related` | a question's answer (answered = done) · ids of items or API types, rendered as links; merged duplicates go here, not in the title |

**`PLAN.kind` sets the tone.**
- `"review"` (code review, audit, bug hunt: something that exists and may be wrong): items are `bug`s by default, sorted by severity, and take `severity` (`high | medium | low`, exactly one, never a range), `origin` (`pre-existing` on the base branch too, or `introduced` by this change; never write that into the title) and `category` (the subsystem **affected**, from the user's side: a Koreographer-callback bug that skews calibration is `Calibration`, not the library it lives in). The drawer labels `why`/`how` "Cause"/"Fix" and shows `fixed`/`wontfix` for done/dropped.
- `"plan"` (implementation plan, design, feature build): items use the neutral types, ordered by step, and **never take severity**. A plan full of red and amber dots reads like a bug report, which is a false alarm. A current problem the plan fixes is a `change` titled as the change (`Save an unlock the moment it is earned`), with the current behaviour and cause in `why`. Use `bug` in a plan only for something out of scope worth flagging. Things that might go wrong are `risk`s with `impact` and `mitigation`.
- Let the kind shape the rest too. A plan leans on `options`, questions and `roadmap`; a review leans on bugs and API types with `state: "changed"`.

Rules for every item:
- Each item stands alone: whoever picks it up never needs the transcript.
- **Link every item** so it sits on the diagram instead of in a list: `flow` (same area), anchored `steps`, `types`. Only done, dropped, `remove`, `decision` and `question` items may skip `flow`. If a finding has no flow to sit on, add the flow.
- `question`s are your questions for the user. Pin them to a step when they're about one. Questions are listed but not counted in open-item numbers.
- Findings never go in `sections`. Low-value nits can share one "Small cleanups" section as a bullet list; anything with a fix someone would schedule is an item.

Old plans with `issues`, `work` or `openQuestions` still render and still take notes (`cause`/`fix` read as `why`/`how`; `todo`, `fixing`, `fixed`, `wontfix` map to the four statuses). `node <skill>/scripts/migrate-plan.mjs <plan.js> --out <file>` converts one and anchors its steps; it never edits in place unless given `--in-place`.

## Anchors: pin steps by name

Put `%% @name` (lowercase kebab) on its own line **directly above** a message, and use the name in `steps`:

```
  U->>UI: types a sentence
  %% @append
  UI->>Log: append op
```

`steps: ["append"]`. Mermaid ignores the comment. Anchored steps, and notes on the message (nid `…/msg/@append`), stay on their message when messages are inserted or removed above. A number (`steps: [2]`: the 2nd message line; `participant`, `note` and `%%` lines don't count, a `<br>` inside a message is still one step) silently moves to whatever message is now 2nd. Anchor every pinned message, and treat anchor names like ids: permanent. `check.mjs` (and the live lint) flags unknown, duplicate and malformed anchors, an anchor that isn't directly above a message, and numbers in an anchored flow.

## API docs

`PLAN.api` holds the types the plan touches, so the page doubles as API docs. The API page has a left-hand tree built from each type's `source` directory and file, with a filter box. The right pane shows either the dependency graph (grouped by top-level folder, and folded by default above 18 types) or one type: its path, summary, **Depends on** / **Used by**, the members table (**Signatures** or **Full**), the items in its file, the flows it appears in, and a neighbourhood graph. `source` drives the tree, so set it on every type, including new ones (the planned path).

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
- Couple content by context, not by resource type. An item belongs under the flow where it happens, and a type is reached from the participant that uses it. Don't add an "Issues" section or a list of types per area.
- Don't repeat an item's summary in a section or caption. Link to it with `related` or `flow`/`steps`.
- Captions say what to notice in the diagram, not what the items say.
