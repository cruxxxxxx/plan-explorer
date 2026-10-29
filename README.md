# plan-explorer

A Claude Code skill that turns a plan or code review into an interactive local **map**. The page shows sequence diagrams of what happens, issues pinned to the exact diagram steps where things go wrong, and API docs tied to the file tree. You explore it, mark anything up, and the agent refines it over rounds.

- **One engine, one data file.** `engine/explorer.html` renders a `plan.js` (`window.PLAN = {…}`) written by the agent. It opens from `file://`, with no build or server. Mermaid is the only dependency, loaded from a CDN.
- **Explore page.** Flows with their issues inline, facet filters (area, kind, severity, category, status, origin), tooltips, and a side drawer for full issue and type context.
- **API page.** A folder and file tree, type pages (depends on / used by, members, issues in the file, flows), and a dependency graph that groups and folds by folder. Graphs support pinch zoom, pan and full screen.
- **Notes anywhere.** Alt-click, note mode (`N`) or a text selection. Five marks: `?` `!` `+` `✓` `✗`. Notes anchor to stable ids, with a quote fallback, so they survive rewrites. Export as JSON for the agent to answer and fold in.
- **Live mode (optional).** `scripts/live.mjs` is a dependency-free localhost sidecar. Questions go from the page to a running agent session (or any agent CLI via `--exec`), answers stream back, and the page hot-reloads when `plan.js` changes. See `reference/live.md`.
- Swiss / Helvetica design, with light and dark modes.

## Install

```sh
git clone <this repo> ~/.claude/skills/plan-explorer
```

Claude Code picks it up as the `plan-explorer` skill. `SKILL.md` holds the agent's instructions.

## Layout

```
SKILL.md              agent instructions (seed, refine from notes, live mode)
engine/explorer.html  the renderer, copied verbatim next to each plan.js
reference/            plan.js schema, diagram rules, live bridge protocol
examples/plan.js      a complete small plan
scripts/check.mjs     validate a plan.js
scripts/verify.sh     validate + render every diagram in headless Chrome
scripts/live.mjs      live bridge: serve | listen | reply | status
tests/                engine and live-bridge tests (headless Chrome)
```

## Tests

```sh
tests/run-engine-test.sh   # engine interactions against examples/plan.js
tests/live-test.sh         # live bridge: HTTP guards, page ↔ agent round trip, --exec
```

Both need Google Chrome and network access for the Mermaid CDN.
