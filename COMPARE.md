# Track A (lean pipeline) compared with main @ 7751dc8

Tokens are estimated as characters / 4. Before = `main`, after = this branch.

## Instructions the agent loads

| file | before (chars ≈ tokens) | after (chars ≈ tokens) |
|---|---|---|
| `SKILL.md` | 16,911 ≈ **4,228** | 5,913 ≈ **1,478** |
| `reference/content.md` (new: kind, issues, work, API, writing rules, moved from SKILL.md) | n/a | 9,794 ≈ 2,449 |
| `reference/diagrams.md` (+ lint and "which check when") | 2,611 ≈ 653 | 4,110 ≈ 1,028 |
| `reference/live.md` (+ stream, batching, bookkeeping, notes file, offline fallback) | 6,053 ≈ 1,513 | 11,053 ≈ 2,763 |
| `reference/schema.md` | 9,614 ≈ 2,404 | 9,825 ≈ 2,456 |
| **SKILL.md + all references** | 35,189 ≈ **8,797** | 40,695 ≈ **10,174** |

What a session actually reads:

| session | before | after |
|---|---|---|
| live note loop (most sessions) | SKILL.md, which told the agent to read schema.md "before writing plan.js": ≈ 6,632 | SKILL.md only: **≈ 1,478** (−78%) |
| seed a new plan | SKILL + schema + diagrams: ≈ 7,285 | SKILL + content + diagrams: ≈ 4,955; schema.md (+2,456) only when unsure of a field |
| offline `*-notes-*.json` | SKILL.md: ≈ 4,228 | SKILL + live.md: ≈ 4,241 |

The total grew by about 1,400 tokens because the new features (lint, bookkeeping, batching, `replies`, `log`) are documented. No rule was deleted; everything removed from SKILL.md now lives in a reference file, and SKILL.md says when to read each one.

## Note events

Measured by running main's `live.mjs` and this branch's on the same three asks against `examples/review` (paths normalized to `~/.claude/skills/plan-explorer` and `~/Code/app/Docs/offline-sync-plan`):

| note | before | after |
|---|---|---|
| element note on a summary paragraph (`?`) | 735 B ≈ 182 tok | 451 B ≈ 111 tok |
| text selection in an issue's cause (`!`) | 671 B ≈ 166 tok | 514 B ≈ 127 tok |
| plain note on a diagram message | 507 B ≈ 126 tok | 317 B ≈ 79 tok |
| **all three, saved within 2 s** | 3 lines, 1,913 B ≈ 478 tok, **3 Monitor events** | **1 line**, 987 B ≈ 244 tok, **1 Monitor event** (−48%) |

Dropped: `at`, `markName`, `kind`, `plan`, `planVersion`, `planFile`, null and empty fields, and the `target` of element notes (the quote already is its first 160 characters). Text notes keep `target`, cut to 200 characters (it was up to 4,000). In a batch, one `replies` command replaces the per-note `reply` commands (≈ 120 B each). The examples have short paragraphs; on a 1,500-character paragraph an element note drops from about 2.3 KB (≈ 570 tok) to about 0.5 KB (≈ 120 tok). The full ask stays in `.live/asks.jsonl`.

## Agent work per note round

A burst of 3 notes, each of which changes the plan, in a session's first round:

| step | before | after |
|---|---|---|
| Monitor events / agent turns | 3 | 1 (batched) |
| content edits to `plan.js` | 3 | 3 |
| bump `version` and `updated` | 1 edit | 0 (server) |
| set `rev` on each changed item | 3 edits (or 3 extra fields folded into the content edits) | 0 (server diffs ids) |
| append a changelog entry | 1 edit | 0 (optional `live.mjs log`) |
| check the edit | `verify.sh` (a headless Chrome run, sandbox off) after structural edits; otherwise nothing | nothing: the listener lints each edit and prints a line only on failure. `verify.sh` only after structural diagram changes |
| reply commands | 3 | 1 (`replies`) |
| **tool calls** | **≈ 12** (3 content + 5 bookkeeping + 1 verify + 3 replies) | **4** (3 content + 1 replies) |

A single note: before ≈ 1 content edit + up to 3 bookkeeping edits + verify + 1 reply; after, 1 content edit + 1 reply.

## Trade-offs and risks

- **Latency.** Every note waits up to 2 s in the listener before the agent sees it. That's the price of batching (`PLAN_EXPLORER_BATCH_MS`).
- **Rounds are a heuristic.** A new version starts after a 30-minute quiet gap. One long sitting accumulates all its changes under one version, and a short break splits a logical round in two. A hand-set higher `plan.version` still wins.
- **History lives in `.live/`**, which is git-ignored. A committed `plan.js` no longer carries `version` or `changelog` unless the agent writes them. `log` output and the revision snapshot don't travel with the repo. A file:// copy shows the plan's own `version` and `rev` tags, not the server's.
- **The server runs `plan.js`** in a `vm` context on every save, to fingerprint items. That's the same trust level as `check.mjs` had (agent-written code), with a 1 s timeout, but it now happens automatically. `vm` isn't a security boundary. Served `plan.js` gets one appended line (`window.PLAN_AUTO = …`). HTTP auth, Host/Origin guards and CSP are unchanged.
- **The static lint is heuristic.** It was calibrated on the engine's pinned Mermaid: every Mermaid failure in the test set is caught, and valid syntax passes. It flags undeclared participants as errors even though Mermaid would draw them implicitly. Exotic syntax (quoted participant names, unusual block options) may need `verify.sh`. Non-sequence diagrams aren't linted.
- **Lint events can be transient.** If the agent pauses for more than 3 s mid-way through a multi-step edit, it may see a `check` failure followed by `ok:true`.
- **Less context in events.** Element notes no longer carry the element text past 160 characters. The agent reads `plan.js` by `nid`, which it does anyway to edit.
- **Batched notes carry no per-note `reply` command.** The agent uses `replies` (with `--status working` for slow work), or builds a `reply` command from the documented form.

## Rendered site

The screenshots of `#explore`, `#api` and the first area page for `examples/plan` and `examples/review` (file:// copy, 1400×1000, `--virtual-time-budget=8000`) are **byte-identical** to main's: `compare/A-lean/*.png`. Only live pages differ. Changed tags and the sidebar version come from the server when the plan doesn't set them.

## Tests

- `tests/run-engine-test.sh`: 130 PASS. That's 38 new static-lint cases (`tests/check-test.mjs`), a new `rev` back-compat check, and 7 new `PLAN_AUTO` engine checks (`tests/auto-test.js`).
- `tests/live-test.sh`: 69 PASS. New checks cover slim notes, the `PLAN_AUTO` baseline, the server-side diff, rounds after a gap, bookkeeping-only edits, `log`, batching, `replies`, and lint events.
