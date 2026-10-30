# plan-explorer

A Claude Code skill that turns a plan or code review into an interactive local **map**. The page shows sequence diagrams of what happens, findings and work pinned to the exact diagram steps where they happen, and API docs tied to the file tree. You explore it, mark anything up, and the agent refines it over rounds.

- **One plan file, one command.** A plan folder holds `plan.js` (`window.PLAN = {…}`), written by the agent, and `history.json` (version, date, changed ids, changelog), written by the server. `node scripts/live.mjs <dir>` serves it with the engine at a stable localhost URL and keeps it live. No build, no dependencies. Mermaid loads from a CDN.
- **One item model.** Everything pinned to a flow is an item: `type` bug / risk / new / change / remove / decision / question, `status` open → doing → done | dropped. `kind: "review"` gives bugs severity; `kind: "plan"` keeps neutral tones, so a plan never reads like a bug report.
- **Step anchors.** `%% @name` above a message lets items use `steps: ["name"]`, so inserting a message never re-pins them, and notes on a message follow it.
- **Explore page.** Flows with their items inline, facet filters (area, type, severity, category, status, origin), tooltips, and a side drawer for full item and type context.
- **API page.** A folder and file tree, type pages (depends on / used by, members, items in the file, flows), and a dependency graph that groups and folds by folder. Graphs support pinch zoom, pan and full screen.
- **Notes anywhere, live.** Alt-click, note mode (`N`) or a text selection. Five marks: `?` `!` `+` `✓` `✗`. Saving a note sends it to the agent: a running session (Claude Code's Monitor) or any agent CLI (`--exec`). Replies appear under the note, and the page hot-reloads as the agent edits `plan.js`. Notes anchor to stable ids, with a quote fallback, so they survive rewrites. See `reference/live.md`.
- Swiss / Helvetica design, with light and dark modes.

## Install

```sh
git clone <this repo> ~/.claude/skills/plan-explorer
```

Claude Code picks it up as the `plan-explorer` skill. `SKILL.md` holds the agent's instructions. To view any plan folder by hand:

```sh
node ~/.claude/skills/plan-explorer/scripts/live.mjs path/to/plan-dir   # prints the URL, then streams notes
```

## Demo

```sh
node scripts/live.mjs examples/plan     # or examples/review
```

Open the `open` URL it prints (later visits can use the plain `url`). Alt-click anything to leave a note. Saved notes stream into that terminal as JSON lines (notes saved within 2 s share one line); answer one with the `reply` command printed in each line, or a batch with its `replies` command, and edit its `plan.js` to watch the page reload. The server tracks versions and tags changed items on its own, in `history.json` beside `plan.js` (commit it with the plan). Ctrl-C stops listening, and `node scripts/live.mjs stop examples/plan` stops the server.

## Layout

```
SKILL.md              agent instructions: the core loaded every session (seed, items, anchors, live loop, marks, replies)
engine/explorer.html  the renderer (served by live.mjs, never copied)
reference/            read on demand: content rules + item model, plan.js schema, diagram rules + lint, live protocol
examples/plan/        an implementation plan (work items, anchored steps)
examples/review/      a code review (bugs with severity, a pinned question)
scripts/check.mjs     validate a plan.js: ids, items, step anchors, static Mermaid lint (no browser)
scripts/migrate-plan.mjs  old issues/work/openQuestions → items, numeric steps → anchors (--out file)
scripts/verify.sh     validate + render every diagram in headless Chrome
scripts/find-chrome.sh  locate Chrome/Chromium ($CHROME wins)
scripts/live.mjs      <dir> (serve + stream notes) | reply | replies | log | status | stop
tests/                engine, live-bridge and migration tests (headless Chrome)
```

## Tests

```sh
tests/run-engine-test.sh   # Mermaid lint + anchor cases, engine interactions (review + plan examples),
                           #   step anchors, old plan shape, live bookkeeping tags, history.json
tests/live-test.sh         # live server: auth + guards, page ↔ agent round trip, slim and batched notes,
                           #   replies, bookkeeping rounds, history.json, lint events, restart, --exec
tests/migrate-test.sh      # migrate the legacy fixtures (or given plan files) and check they render the same
```

All need Chrome or Chromium (found automatically, or set `CHROME=/path`) and network access for the Mermaid CDN. `verify.sh` exits 2 when no browser is found. `node tests/check-test.mjs` runs the lint cases alone, without a browser.

Engine changes go in `engine/explorer.html`: bump `ENGINE_VERSION` and run the tests. Running servers pick the change up on their own, and open pages reload, because no project keeps a copy of the engine.
