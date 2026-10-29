# Live bridge protocol

`scripts/live.mjs` is an optional localhost sidecar. It lets the page send questions to a coding agent and get answers back while the plan updates in place. It has no dependencies (Node ≥ 18) and is agent-agnostic. Anything that can read a stream of lines and run a command can be the agent.

```
page ──HTTP──▶ live.mjs serve ──.live/asks.jsonl──▶ live.mjs listen ──stdout JSONL──▶ agent
page ◀──SSE─── live.mjs serve ◀──POST /live/answer── live.mjs reply ◀──────────────── agent
page ◀──SSE─── live.mjs serve ◀──── watches plan.js ◀─────────────── agent edits plan.js
```

Without the sidecar (a `file://` page, or no token), the page works fully offline, and notes travel by JSON export as usual.

## Commands

| command | what it does |
|---|---|
| `node live.mjs serve <dir> [--port 4848] [--exec "<cmd>"]` | Serves `<dir>` on `127.0.0.1` and writes `.live/server.json` (`url`, `port`, `token`, `pid`). Prints one JSON line per event: `ready`, `ask`, `plan-changed`. |
| `node live.mjs listen <dir>` | The agent's inbox. It prints each still-pending question first (with `"pending": true`), then each new question, as one JSON line. While it runs, the page shows "agent listening". |
| `node live.mjs reply <dir> <noteId> [--status working\|done] [text \| -]` | Answers a question. `-` reads the text from stdin. `--status working` shows progress without closing the question. |
| `node live.mjs status <dir>` | Shows whether the server is running, its URL, whether a listener is alive, and the pending questions. |

## Ask event (one line of `listen` output)

```json
{
  "type": "ask", "at": 1793281200000,
  "noteId": "nmh3k2x9ab", "mark": "?", "markName": "Question",
  "text": "why a materialized view",
  "where": "Local store › Summary › ¶1", "nid": "areas/local-store/summary/p0",
  "kind": "element", "quote": "Every edit lands in…",
  "target": "full text of the element the note is on",
  "route": "#explore/local-store", "plan": "offline-sync", "planVersion": 2,
  "planFile": "/abs/path/plan.js",
  "reply": "node \"/abs/live.mjs\" reply \"/abs/dir\" nmh3k2x9ab -"
}
```

`reply` is the exact command that answers the question, so an agent needs no other instructions to close the loop.

## Adapters

- **Agent in a live session** (Claude Code): run `serve` in the background, then watch `listen` (Claude Code's Monitor tool turns each line into a message in the session). Answer with `reply`, and edit `plan.js` for revisions. Everything shows in the terminal. See SKILL.md §4.
- **Any agent CLI** (`--exec`): one process per question, run in `<dir>`. The prompt goes to stdin, and stdout streams back to the page as the reply. Environment: `PLAN_DIR`, `PLAN_FILE`, `PLAN_NOTE_ID`. Examples: `--exec "claude -p --allowedTools Read,Edit"`, `--exec "codex exec -"`, `--exec "ollama run qwen3"`, `--exec "llm -m <model>"`. An agent that can edit files can also revise `plan.js`, and the page reloads.
- **Anything else**: poll `.live/asks.jsonl` and `POST /live/answer` (below).

## HTTP API (page ↔ server)

Every `/live/*` call needs the token, as the `x-live-token` header or `?t=` (SSE only).

| route | body / response |
|---|---|
| `GET /live/hello` | `{ agent: "listening"\|"exec"\|"offline", pending: [noteId], answers: {noteId: answer}, notes: [raw notes] \| null }` |
| `GET /live/events` | SSE. `status` `{agent, pending}`, `answer` `{noteId, text, status, at, by}`, `plan` `{mtime}` |
| `PUT /live/notes` | `{ raw: [notes], export: <notes export JSON> }`. Writes `.live/notes-raw.json` and `.live/notes.json` (export format). |
| `POST /live/ask` | `{ note: <export-format note>, target, route, plan, planVersion }` |
| `POST /live/answer` | `{ noteId, text, status: "working"\|"done", by? }` |

## State (`<dir>/.live/`, git-ignored, mode 700)

`server.json` · `asks.jsonl` (append-only) · `answers.json` (latest per note) · `notes.json` (export format, always current) · `notes-raw.json` · `listener` (heartbeat).

A question is pending until it has a `done` answer newer than the ask. Asking the same note again re-opens it.

## Security

The agent behind the bridge can edit files and run tools, so the server accepts only:
- connections on `127.0.0.1`;
- a `Host` of `127.0.0.1:<port>` or `localhost:<port>`, which blocks DNS rebinding;
- no `Origin`, or our own;
- the random token on every API call.

Dotfiles (including `.live/`) and paths outside `<dir>` are never served. The token reaches the page in the URL once, is moved to sessionStorage, and is stripped from the address bar.
