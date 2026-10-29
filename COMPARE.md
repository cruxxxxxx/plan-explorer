# Track C: step anchors and one item model

Baseline: `main` @ 7751dc8 (engine 2.4.1). This branch: engine 2.5.0.

## What changed

- **Step anchors.** A `%% @name` line directly above a message names it. Items use `steps: ["name"]` alongside numbers. Mermaid treats the line as a comment: `verify.sh` renders all flows, and the migrated real plans render the same as the originals. Message nids use the anchor (`…/msg/@name`). A note saved on a numeric nid (`…/msg/3`) resolves to the anchor of that message. `check.mjs` reports unknown anchors, duplicate anchors and malformed anchor names as errors. It warns about an anchor that is not directly above a message, and about numeric steps in a flow that has anchors.
- **One item model.** `areas[].items[]` replaces `issues`, `work` and `openQuestions`:
  - `type`: `bug | risk | new | change | remove | decision | question`
  - `status`: `open → doing → done | dropped`
  - `severity`, `origin` and `category` apply to `bug` items in reviews.
  - The old lists still work as aliases:
    - `issues` items become `bug`. Their statuses `fixing/fixed/wontfix` map to `doing/done/dropped`, and their fields `cause/fix` map to `why/how`.
    - `work` items keep their type, and `todo` maps to `open`.
    - `openQuestions` items become `question`. `text` maps to `title`, and an item with an `answer` counts as done.
  - Display words stay in context. A bug shows `fixed` / `wontfix` and labels its fields "Cause" / "Fix". Work shows `todo` / `done`.
- **Notes survive the rename.** Old nids (`issues/…`, `work/…`, `questions/…`, `…/cause/…`, `…/fix/…`, `questions/<id>/answer`) resolve to `items/…` with `anchorState: "ok"`.
- **`scripts/migrate-plan.mjs <plan.js> [--out file] [--no-anchors]`.** It writes to stdout or `--out` and never edits in place unless you pass `--in-place`. It merges the old lists into `items`, renames fields in place and maps statuses. It also adds an anchor above every message an item is pinned to and rewrites the steps to use it. A summary of what it changed goes to stderr.

## Concepts an agent must learn (pinned items)

| | before | after |
|---|---|---|
| area content lists | 6 (`flows issues work sections options openQuestions`) | 4 (`flows items sections options`) |
| item shapes | 3 | 1 |
| item field slots (summed over shapes) | 38 (issue 18 + work 16 + question 4) | 21 (18 shared + 3 review-only) |
| distinct item field names | 24 | 21 |
| enum values (`type`, `status`, `severity`, `origin`) | 18 (2 status sets of 4, 5 work types, 3 severities, 2 origins) | 16 (7 types, 4 statuses, 3 severities, 2 origins) |
| step addressing | count message lines (fragile) | anchor name (number still allowed) |
| **total to learn** (shapes + field slots + enum values + anchor syntax) | **59** | **39 (−34%)** |

## Doc size (chars/4 ≈ tokens)

| file | before | after | Δ |
|---|---|---|---|
| SKILL.md | 16,911 chars ≈ 4,228 tok | 15,577 ≈ 3,894 | −334 tok (−7.9%) |
| reference/schema.md | 9,614 ≈ 2,404 | 9,079 ≈ 2,270 | −134 tok (−5.6%) |
| **both** | **≈ 6,632** | **≈ 6,164** | **−468 tok (−7.1%)** |
| SKILL.md item sections ("Context decides the shape" + "Issues" → "Items" + "Anchors") | 4,337 chars | 2,964 chars | −32% |
| schema.md item blocks (`issues` + `work` + `openQuestions` → `items`) | 2,256 chars | 1,643 chars | −27% |

The smaller documents also cover two things the old ones did not: anchors and migration.

## Anchor robustness

**Engine test** (`tests/anchor-test.js`, on `examples/plan`). The test inserts `U->>UI: opens a note` at the top of the `edit-offline` flow and re-renders:
- Three items with anchored steps (one on two steps) stay on `append op …` and `apply op`. The drawer now reports step 3, the message's new number.
- A probe item with `steps: [2]` moves from `append op …` to `types a sentence`, which is the silent re-pin this change fixes.
- A note on `…/msg/@append-op-insert` stays `ok`. A note saved as `…/msg/1` (pre-anchor) lands on the same message.

**Static demo.** One message was inserted at the top of every flow, and each pinned item was checked for whether it still points at the same message text:

| plan | pinned items | re-pinned (numeric, original) | re-pinned (migrated, anchored) |
|---|---|---|---|
| examples/review | 2 | 2 (2/2 steps) | 0 |
| examples/plan | 7 | 7 (10/10 steps) | 0 |
| phase4-review-plan | 41 | 41 (84/84 steps) | 0 |
| mix-unlocks-plan | 4 | 4 (8/8 steps) | 0 |

## Migration on the real plans

The originals in `~/Unity/dropbeat2-u66/Docs/*/plan.js` were read only. They were copied to scratch and verified byte-identical afterwards. `tests/migrate-test.sh <files>` migrated each copy, checked it with `check.mjs`, then rendered the original and the migrated copy in headless Chrome. The dump covered every Explore page (open and all statuses), every area, the API home and every type page, the roadmap, and every item's drawer, with step dots recorded by message position. The dumps were diffed.

| plan | converted | anchors | check | render diff |
|---|---|---|---|---|
| phase4-review-plan (review) | 43 issues → bug (cause→why 43, fix→how 43), 11 questions → question | 81 added, 84 steps anchored, 0 left numeric | ✓, 0 warnings | **identical**: 116 views, 324 step dots, 304 rows |
| mix-unlocks-plan (plan) | 4 work (todo→open 4), 8 questions → question | 7 added, 8 steps anchored | ✓ | **identical**: 45 views, 28 dots, 56 rows |
| examples/review (fixture) | 3 issues (fixed→done 1), 3 questions | 2 added | ✓ | identical: 20 views, 8 dots, 24 rows |
| examples/plan (fixture) | 8 work, 1 question | 8 added | ✓ | identical: 21 views, 32 dots, 40 rows |

**What the migration loses:**
- `//` comments inside the `PLAN` object; mix-unlocks and the review example have some. The migrator reports this, and the text before `window.PLAN` is kept.
- Hand formatting: the output is re-serialized, with multi-line strings as template literals and unquoted keys.
- No id collisions occurred. A collision between an issue id and a question id in the same area would be reported, not renamed.
- No field values are dropped.

## Questions folded into items: why

- **Engine:** −1 renderer (`questionItem`), −1 Explore block and −1 special case in `issueRef`. Questions reuse rows, the drawer, filters, search, `related` links, `rev` tags and notes.
- **New capability:** a question can be pinned to a diagram step. The review example pins "batch pushes?" to `@push`.
- **Docs:** `openQuestions` gets no separate schema block or field list. It is one more `type` value plus `answer`.
- **Counts:** questions are not counted in the open-item numbers, area pills or the sidebar. Open-item numbers on old plans are unchanged.

## Visible difference from main

Above the fold, headless screenshots of `#explore`, `#api` and the first area page (1400×1000) are **byte-identical to main** for both examples. They are saved under `scratchpad/compare/C-anchors/`.

The only visible changes are below the fold and come from folding questions into items:
- Open questions render as item rows under a "Questions" kicker, or under their flow when pinned, instead of the numbered "Open questions" list. They use an accent square dot and the tag "Question".
- Answered questions count as done, so the default **Open** filter hides them. They show under All or Done.

Issues and work render the same as on main.

## Trade-offs and risks

- **Inserting between an anchor and its message moves the anchor.** If a message is inserted between `%% @x` and the message it names, the anchor names the new message. The static demo first did exactly this by mistake. SKILL.md says "directly above"; a lint for "anchored message text changed" would need history.
- **Anchors are a new id namespace.** Renaming an anchor orphans the steps that use it (`check.mjs` errors) and moves notes on it to the quote fallback. Docs treat anchors as permanent, like ids.
- **Severity follows the type, not `kind`.** Severity colours `bug` items in either kind, so old plans that keep `issues` inside a plan render unchanged. A `risk` in a review loses severity colours, and `check.mjs` warns if one is set.
- **One status vocabulary (`open/doing/done/dropped`)** replaces the review words in the data. The page still shows `fixed` / `wontfix` for bugs, so readers see no change, but agents used to `fixed` will write it. It is accepted as an alias.
- **Field renames (`cause` → `why`, `fix` → `how`)** cut one concept pair. A bug's drawer still labels them "Cause" / "Fix", and the old names are still read.
- **Migration rewrites formatting and drops inner comments.** It never runs in place by default.
- **`options`, `sections`, `roadmap`, `replies` and `changelog` are unchanged.** Folding `options` into `decision` items would cost the pros/cons layout. That is a possible next step, not part of this change.

## Tests

- `tests/run-engine-test.sh`: **143 PASS, 0 FAIL**. It covers the review and plan examples, the new `anchor-test.js`, `work-test.js` on the legacy plan fixture, and the new `compat-test.js` on the legacy review fixture.
- `tests/live-test.sh`: **45 PASS, 0 FAIL**.
- `tests/migrate-test.sh` (new): **8 PASS** on the fixtures. On the two real plans, the same checks pass with identical renders.
