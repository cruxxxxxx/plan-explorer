# Next (Track A + Track C) compared with main @ 7751dc8

This branch merges Track A, the lean pipeline (23e053a), with Track C, step anchors and one item model (eac306f). The engine is 3.0.0. Tokens are estimated as characters / 4.

## What the combination adds beyond A and C alone

- **History is committed.** The server keeps `version`, `updated`, `changed` and `changelog` in `<dir>/history.json`, next to `plan.js`, not in `.live/`. It never rewrites `plan.js`.
  - The served `plan.js` gets one appended line, `window.PLAN_AUTO`, built from `history.json`. Any other static server falls back to the engine fetching `history.json`. A `file://` page falls back to `PLAN.version` and `rev`.
  - `history.json` is served with the same token/cookie as every other plan file. An outside edit to it (a `git pull`, `live.mjs log`) hot-reloads open pages.
  - The server writes it only on a real change, so viewing a plan adds no file. The first write seeds the changelog from `PLAN.changelog`. A fresh clone (no `.live/`) takes its version and tags from `history.json`.
- **Server-side diffing understands items and anchors.** Every item list is keyed `areas/<a>/items/<id>`, whether it's `items` or a legacy list.
  - Items are fingerprinted as the engine reads them: `cause`/`fix`/`text` → `why`/`how`/`title`, and old status words map to the new ones.
  - Steps are fingerprinted as the message they point at, and flows without their `%% @name` lines.
  - Result: running `migrate-plan.mjs` under a live server tags **nothing**. That holds on both real plans and the fixtures. Inserting a message tags only the flow; anchored items stay untagged.
- **Lint plus anchors.** `check.mjs` keeps A's module shape and static Mermaid lint, and adds C's item model and anchor validation. `%% @name` lines are comments to the lint. Unknown, duplicate and malformed anchors are errors; misplaced anchors and numeric steps in anchored flows are warnings. The live listener reports all of them on each edit.
- **Slim notes keep anchor nids.** For example `…/msg/@append-op`; the live test covers this.

## Numbers

| | main | next |
|---|---|---|
| `SKILL.md` | 16,911 chars ≈ **4,228** tok | 6,169 ≈ **1,542** tok (−64%) |
| references | diagrams 653 + live 1,513 + schema 2,404 = 4,570 | content 2,520 + diagrams 1,102 + live 3,146 + schema 2,371 = 9,139 |
| SKILL + all references | 35,189 ≈ 8,797 | 42,723 ≈ 10,681 |
| live note loop reads | SKILL, plus schema "before writing plan.js": ≈ 6,632 | SKILL only: **≈ 1,542** (−77%) |
| seeding a plan reads | SKILL + schema + diagrams ≈ 7,285 | SKILL + content + diagrams ≈ 5,164 (−29%) |
| 3 notes saved within 2 s (review example) | 3 events, 1,913 B ≈ 478 tok | **1 event**, 1,063 B ≈ 263 tok (−45%) |
| a single note (element / text / message) | 735 / 671 / 507 B | 451 / 521 / 386 B |
| tool calls per 3-note round (each note changes the plan) | ≈ 12 (3 edits + 5 bookkeeping + verify + 3 replies) | **4** (3 edits + 1 `replies`) |
| concepts to learn for pinned items (shapes + field slots + enum values + anchor syntax) | 59 | **39** (−34%) |
| re-pinned items after inserting one message at the top of every flow | examples 9/9, phase4 41/41, mix 4/4 (numeric steps) | **0** after migration (anchored) |

The total reference size grew, because new features are documented: lint, bookkeeping, `history.json`, batching, `replies`, `log`, items, anchors and migration. What a session actually loads shrank. Next's events are about 75 B larger than Track A's 987 B: anchor nids and item titles in `where` are longer than `msg/3`.

## Real plans (copies only; originals byte-identical afterwards)

| plan | old shape: check | migrated: check | render (old vs migrated) | `verify.sh` migrated | live: migrate under the server |
|---|---|---|---|---|---|
| phase4-review-plan | ✓ (1 warning: old lists) | ✓, 0 warnings | identical: 116 views, 324 step dots, 304 rows | 25/25 flows | `PLAN_AUTO` stays `null`, no `history.json` |
| mix-unlocks-plan | ✓ (2 lint warnings + old lists) | ✓ (2 lint warnings: raw `<`/`>`) | identical: 45 views, 28 dots, 56 rows | 9/9 flows | `PLAN_AUTO` stays `null` |

## Rendered site

Screenshots were taken of `#explore`, `#api` and `#explore/<first area>` for both examples: a `file://` copy at 1400×1000, `--hide-scrollbars`, `--virtual-time-budget=8000`. They are in `scratchpad/compare/next/`. All six are **byte-identical** to `compare/main/` and to `compare/C-anchors/`.

## Tests

- `tests/run-engine-test.sh`: **213 PASS**.
  - 50 lint and anchor cases in `check-test.mjs`.
  - Interactions, anchors, legacy compatibility, and `PLAN_AUTO` tags on both the item-shaped plan and the legacy plan.
  - `history-test.js`: the engine fetches `history.json`.
- `tests/live-test.sh`: **85 PASS**.
  - `history.json`: written next to `plan.js` with mode 0644; auth; the changelog seed; `log`; `status`.
  - An outside `history.json` edit fires a reload event and changes the served `PLAN_AUTO`.
  - Migration tags nothing; an inserted message tags only the flow; the slim note keeps its anchor nid.
- `tests/migrate-test.sh`: **8 PASS** on the fixtures, and 8 PASS on copies of the two real plans.

## Trade-offs and risks

- **`history.json` is a second file the user commits.** If it's forgotten, a clone loses its version and tags, but still renders from `PLAN.version`.
  - The fingerprint snapshot (`.live/revs.json`) stays local. Edits made while no server runs are diffed against the last local snapshot. On a fresh clone they become the baseline, so they aren't tagged.
- **`log` and the server can both write `history.json`.** Each one reads the file just before its atomic write, so a lost entry needs two writes within milliseconds.
- **A `file://` page never sees `history.json`.** Chrome blocks `fetch` from `file://`, and the failed fetch is silent. It behaves like main.
- **Step fingerprints resolve to message text.** Editing the text of a message that an item is pinned to tags that item as well as the flow. That's intended: the item now points at something different.
- A's and C's other risks still apply: 2 s batching latency, heuristic rounds, a heuristic lint, anchors as a permanent namespace, and migration dropping inner comments.
