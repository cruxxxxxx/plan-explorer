# Live server protocol

`scripts/live.mjs` serves a plan folder (just `plan.js`) with the skill's engine, and relays notes between the page and any agent. It has no dependencies (Node ≥ 18). Anything that can read a stream of lines and run a command can be the agent.

```
page ──save note──▶ server ──.live/asks.jsonl──▶ live.mjs <dir> ──stdout JSONL──▶ agent
page ◀────SSE───── server ◀──POST /live/answer── live.mjs reply ◀─────────────── agent
page ◀────SSE───── server ◀──── watches plan.js ◀───────────────── agent edits plan.js
```

## Commands

| command | what it does |
|---|---|
| `node live.mjs <dir> [--exec "<cmd>"]` | **The one command.** It starts the server in the background, or reuses it (and restarts it if `live.mjs` or the engine changed). It prints `{"type":"ready","url","open"}`, then one JSON line per note: still-pending notes first (`"pending": true`), then new ones as they're saved. With `--exec`, it runs `<cmd>` per note instead of printing. Re-running it is safe: a newer listener takes over. |
| `node live.mjs reply <dir> <noteId> [--status working\|done] [text \| -]` | Answers a note. `-` reads the text from stdin. An empty `done` reply marks the note "seen". |
| `node live.mjs status <dir>` | Shows whether the server is running, its URL, the agent's state (`listening`, `exec` or `offline`) and the pending notes. |
| `node live.mjs stop <dir>` | Stops the server. |
| `node live.mjs serve <dir> [--port N]` | The server itself, in the foreground. `<dir>` starts this for you. |

**URL.** The port is derived from the folder path, in the range 47100–47899, so it stays stable across restarts. The first visit uses `open` (`url?t=<token>`). The server answers with an HttpOnly, SameSite=Strict cookie, and from then on the plain `url` works in that browser. The token persists in `.live/server.json`, so bookmarks survive restarts.

## Note event (one line of output)

```json
{
  "type": "note", "at": 1793281200000,
  "noteId": "nmh3k2x9ab", "mark": "?", "markName": "Question",
  "text": "why a materialized view",
  "where": "Local store › Summary › ¶1", "nid": "areas/local-store/summary/p0",
  "kind": "element", "quote": "Every edit lands in…",
  "target": "full text of the element the note is on",
  "plan": "offline-sync", "planVersion": 2,
  "planFile": "/abs/path/plan.js",
  "reply": "node \"/abs/live.mjs\" reply \"/abs/dir\" nmh3k2x9ab -"
}
```

`reply` is the exact command that answers the note, so an agent needs no other instructions to close the loop. Editing a note sends it again under the same `noteId`, and the newest version wins.

## Adapters

- **Agent in a live session** (Claude Code): run `live.mjs <dir>` under the Monitor tool, which turns each line into a message in the session. Answer with `reply` and edit `plan.js`; the page reloads. Everything shows in the terminal. See SKILL.md §2.
- **Any agent CLI** (`--exec`): one process per note, run in `<dir>`. The prompt (the note plus the mark rules) goes to stdin, and stdout streams back to the page as the reply. Environment: `PLAN_DIR`, `PLAN_FILE`, `PLAN_NOTE_ID`. Examples: `--exec "claude -p --allowedTools Read,Edit"`, `--exec "codex exec -"`, `--exec "ollama run qwen3"`, `--exec "llm -m <model>"`.
- **Anything else**: tail `.live/asks.jsonl` and `POST /live/answer` (below).

## HTTP API (page ↔ server)

Every `/live/*` call needs the token: the cookie, the `x-live-token` header, or `?t=`.

| route | body / response |
|---|---|
| `GET /live/hello` | `{ agent: "listening"\|"exec"\|"offline", pending: [noteId], answers: {noteId: answer}, notes: [raw notes] \| null }` |
| `GET /live/events` | SSE. `status` `{agent, pending}`, `answer` `{noteId, text, status, at, by}`, `plan` `{mtime}` |
| `PUT /live/notes` | `{ raw: [notes], export: <notes export JSON> }`. Writes `.live/notes-raw.json` and `.live/notes.json` (export format). |
| `POST /live/ask` | `{ note: <export-format note>, target, route, plan, planVersion }` |
| `POST /live/answer` | `{ noteId, text, status: "working"\|"done", by? }` |

## State (`<dir>/.live/`, git-ignored, mode 700)

`server.json` (port, token, pid, URLs) · `server.log` · `asks.jsonl` (append-only) · `answers.json` (latest per note) · `notes.json` (export format, always current) · `notes-raw.json` · `listener.json` (heartbeat, mode).

A question is pending until it has a `done` answer newer than the ask. Asking the same note again re-opens it.

## Security

The agent behind the bridge can edit files and run tools, so the server accepts only:
- connections on `127.0.0.1`;
- a `Host` of `127.0.0.1:<port>` or `localhost:<port>`, which blocks DNS rebinding;
- no `Origin`, or our own;
- the token (as a cookie, header or query) on every API call.

Dotfiles (including `.live/`) and paths outside `<dir>` are never served. The token reaches the page in the URL once. It becomes an HttpOnly cookie that page scripts can't read, and it's stripped from the address bar.
