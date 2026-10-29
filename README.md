# plan-explorer

A Claude Code skill that turns a plan or code review into an interactive local **map**. The page shows sequence diagrams of what happens, findings and work pinned to the exact diagram steps where they happen, and API docs tied to the file tree. You explore it, mark anything up, and the agent refines it over rounds.

- **One file per plan, one command.** A plan folder holds only `plan.js` (`window.PLAN = {…}`), written by the agent. `node scripts/live.mjs <dir>` serves it with the engine at a stable localhost URL and keeps it live. No build, no dependencies. Mermaid loads from a CDN.
- **One item model.** Everything pinned to a flow is an item: `type` bug / risk / new / change / remove / decision / question, `status` open → doing → done | dropped. `kind: "review"` gives bugs severity; `kind: "plan"` keeps neutral tones, so a plan never reads like a bug report.
- **Step anchors.** `%% @name` above a message lets items use `steps: ["name"]`, so inserting a message never re-pins them.
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

Open the `open` URL it prints (later visits can use the plain `url`). Alt-click anything to leave a note. Saved notes stream into that terminal as JSON lines; answer one with the `reply` command printed in each line, and edit its `plan.js` to watch the page reload. Ctrl-C stops listening, and `node scripts/live.mjs stop examples/plan` stops the server.

## Layout

```
SKILL.md              agent instructions (seed, refine from notes, live mode)
engine/explorer.html  the renderer (served by live.mjs, never copied)
reference/            plan.js schema, diagram rules, live bridge protocol
examples/plan/        an implementation plan (work items, anchored steps)
examples/review/      a code review (bugs with severity, a pinned question)
scripts/check.mjs     validate a plan.js (ids, flows, step anchors)
scripts/migrate-plan.mjs  old issues/work/openQuestions → items, numeric steps → anchors (--out file)
scripts/verify.sh     validate + render every diagram in headless Chrome
scripts/find-chrome.sh  locate Chrome/Chromium ($CHROME wins)
scripts/live.mjs      <dir> (serve + stream notes) | reply | status | stop
tests/                engine and live-bridge tests (headless Chrome)
```

## Tests

```sh
tests/run-engine-test.sh   # engine interactions: review + plan examples, step anchors, old plan shape
tests/migrate-test.sh      # migrate the legacy fixtures (or given plan files) and check they render the same
tests/live-test.sh         # live server: auth + guards, page ↔ agent round trip, restart, --exec
```

All need Chrome or Chromium (found automatically, or set `CHROME=/path`) and network access for the Mermaid CDN. `verify.sh` exits 2 when no browser is found.
