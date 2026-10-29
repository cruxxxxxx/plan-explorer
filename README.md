# plan-explorer

A Claude Code skill that turns a plan or code review into an interactive local **map**. The page shows sequence diagrams of what happens, issues pinned to the exact diagram steps where things go wrong, and API docs tied to the file tree. You explore it, mark anything up, and the agent refines it over rounds.

- **One file per plan, one command.** A plan folder holds only `plan.js` (`window.PLAN = {…}`), written by the agent. `node scripts/live.mjs <dir>` serves it with the engine at a stable localhost URL and keeps it live. No build, no dependencies. Mermaid loads from a CDN.
- **Context-aware.** `kind: "review"` shows findings with severity; `kind: "plan"` shows work (new / change / remove / risk / decision) in neutral tones, so a plan never reads like a bug report.
- **Explore page.** Flows with their issues or work inline, facet filters (area, kind, severity, category, status, origin), tooltips, and a side drawer for full issue and type context.
- **API page.** A folder and file tree, type pages (depends on / used by, members, issues in the file, flows), and a dependency graph that groups and folds by folder. Graphs support pinch zoom, pan and full screen.
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
examples/plan/        an implementation plan (work items)
examples/review/      a code review (findings with severity)
scripts/check.mjs     validate a plan.js
scripts/verify.sh     validate + render every diagram in headless Chrome
scripts/live.mjs      <dir> (serve + stream notes) | reply | status | stop
tests/                engine and live-bridge tests (headless Chrome)
```

## Tests

```sh
tests/run-engine-test.sh   # engine interactions: review example + plan example (work, API tree)
tests/live-test.sh         # live server: auth + guards, page ↔ agent round trip, restart, --exec
```

Both need Google Chrome and network access for the Mermaid CDN.
