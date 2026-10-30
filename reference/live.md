# Live server protocol

`scripts/live.mjs` serves a plan folder (`plan.js`, plus the `history.json` it keeps there) with the skill's engine, and relays notes between the page and any agent. It has no dependencies (Node ≥ 18). Anything that can read a stream of lines and run a command can be the agent.

```
page ──save note──▶ server ──.live/asks.jsonl──▶ live.mjs <dir> ──stdout JSONL──▶ agent
page ◀────SSE───── server ◀──POST /live/answer── live.mjs reply ◀─────────────── agent
page ◀────SSE───── server ◀──── watches plan.js ◀───────────────── agent edits plan.js
```

## Commands

| command | what it does |
|---|---|
| `node live.mjs <dir> [--exec "<cmd>"]` | **The one command.** It starts the server in the background, or reuses it (and restarts it if `live.mjs` or the engine changed). It prints `{"type":"ready","url","open"}`, then the note stream (below): still-pending notes first (`"pending": true`), then new ones as they're saved. With `--exec`, it runs `<cmd>` per note instead of printing. Re-running it is safe: a newer listener takes over. When the Monitor expires, the page shows "no agent listening" until the command runs again. |
| `node live.mjs reply <dir> <noteId> [--status working\|done] [text \| -]` | Answers a note. `-` reads the text from stdin. An empty `done` reply marks the note "seen". |
| `node live.mjs replies <dir> [--status working] -` | Answers several notes in one command (`done` unless `--status working`). stdin is blocks that each start with a line `--- <noteId>` followed by the answer (any lines), or a JSON object `{"<noteId>": "answer"}`. Every batch line carries this command ready to run. |
| `node live.mjs log <dir> "what changed"` | Optional. Appends one entry `{version, date, what, changed: [ids]}` for the current round to `history.json`'s `changelog`. |
| `node live.mjs status <dir>` | Shows whether the server is running, its URL, the agent's state (`listening`, `exec` or `offline`), the current version, the ids changed in it, and the pending notes. |
| `node live.mjs stop <dir>` | Stops the server (asks it to exit, then waits until the port is free). |
| `node live.mjs serve <dir> [--port N]` | The server itself, in the foreground. `<dir>` starts this for you. |

**URL.** The port is derived from the folder path, in the range 47100–47899, so it stays stable across restarts. The first visit uses `open` (`url?t=<token>`). The server answers with an HttpOnly, SameSite=Strict cookie, and from then on the plain `url` works in that browser. The token persists in `.live/server.json`, so bookmarks survive restarts.

## Note stream (stdout, one JSON object per line)

**One note:**

```json
{"type":"note","noteId":"nmh3k2x9ab","mark":"?","text":"why a materialized view",
 "where":"Local store › Summary › ¶1","nid":"areas/local-store/summary/p0","quote":"Every edit lands in a local SQLite op log first. …",
 "reply":"node '/abs/live.mjs' reply '/abs/dir' 'nmh3k2x9ab' -"}
```

- Empty fields are left out (`mark` on a plain note, `quote`, …).
- `quote` is the selected phrase (a text note), or the first 160 characters of the element (an element note).
- `target` is the element's text, cut to 200 characters. It's sent only for text notes, where it adds context around the selection; for element notes the quote already is its start, and `nid` locates the rest in `plan.js`.
- `pending: true` marks a note saved while no agent was listening.
- `reply` is the exact command that answers the note, single-quoted for POSIX shells, so an agent needs no other instructions to close the loop.

The full ask (with `at`, `markName`, `kind`, the whole `target`, `plan`, `planVersion`, `planFile`) stays in `.live/asks.jsonl`. Note ids are `[A-Za-z0-9_-]{1,64}`. Editing a note sends it again under the same `noteId`, and the newest version wins.

**Several notes (batching).** The listener holds a note for 2 s (`PLAN_EXPLORER_BATCH_MS`). Every note saved in that window goes out on the same line, newest version per note id, so the agent takes one turn for the lot instead of one per note. A lone note still goes out as `type: "note"`, and pending notes at startup go out at once.

```json
{"type":"notes","notes":[{"noteId":"b1","mark":"?","text":"…","where":"…","nid":"…","quote":"…"},{"noteId":"b2","…":"…"}],
 "replies":"node '/abs/live.mjs' replies '/abs/dir' -"}
```

Notes in a batch carry no `reply` of their own; the one `replies` command answers any subset of them.

Answer a batch with its `replies` command:

```
node '/abs/live.mjs' replies '/abs/dir' - <<'EOF'
--- b1
Answer one.
--- b2
Answer two.
EOF
```

**Lint results.** In session mode the listener also lints `plan.js` (`check.mjs`: structure, items, step anchors, plus the static Mermaid lint) 3 s after each edit settles (`PLAN_EXPLORER_CHECK_SETTLE_MS`). It prints only failures, `{"type":"check","ok":false,"errors":["areas/sync/flows/reconnect line 5: \";\" in message text …"],"more":2}`, and `{"type":"check","ok":true}` once after a failure is fixed. A clean edit prints nothing.

Notes wait while the session is busy; the page shows them as queued. Saving or answering never blocks on the agent.

## Bookkeeping (version, date, Changed tags)

The agent doesn't maintain `version`, `updated`, `rev` or `changelog`. The server does, and it never rewrites `plan.js`:

1. When `plan.js` changes and runs, the server fingerprints every item the page can tag, keyed like the nids: `areas/<a>`, `areas/<a>/flows|items|sections|options/<id>`, `api/<t>`, `api/<t>/m/<m>`, `roadmap/<id>`. Containers are hashed without their children, and bookkeeping fields (`rev`, `version`, `updated`, `changelog`, `replies`) are ignored.
   - Items are hashed as the engine reads them: old `issues`/`work`/`openQuestions` entries key as `items/<id>`, `cause`/`fix`/`text` count as `why`/`how`/`title`, and old status words map to the four statuses. Running `migrate-plan.mjs` therefore tags nothing.
   - Steps are hashed as the message they point at, and flows without their `%% @name` lines. Adding anchors, or switching a step from a number to an anchor, isn't a change. Inserting a message tags the flow, and tags only the items whose numeric steps now point at a different message.
2. It diffs them against the last snapshot (`.live/revs.json`, a local cache). Changed and added items get the current round; deleted ones drop out. The first snapshot is the baseline, so nothing is tagged on first serve.
3. A **round** is a burst of edits. An edit more than 30 minutes (`PLAN_EXPLORER_ROUND_GAP_MS`) after the previous one opens a new round: version + 1. A higher `plan.version` set by hand, or a higher `version` in `history.json`, wins. `updated` is the date of the last change.
4. The result goes to **`<dir>/history.json`**, next to `plan.js`. Commit it with the plan, so version, date, tags and changelog travel with it. Don't edit it by hand.
   ```json
   { "version": 3, "updated": "2026-10-30", "changed": ["areas/sync/items/batching"],
     "changelog": [{ "version": 3, "date": "2026-10-30", "what": "…", "changed": ["…"] }] }
   ```
   The server writes it only when something changes, so viewing a plan adds no file. The first write seeds `changelog` from `PLAN.changelog`. `live.mjs log` appends to it. With no `.live/` (a fresh clone), the server takes `version` and `changed` from it as the baseline.
5. The served `plan.js` ends with `window.PLAN_AUTO = { version, updated, changed }` from `history.json` (`null` before the first change). The engine tags those items "Changed v<version>" and shows that version and date in the sidebar. An edit to `history.json` the server didn't make (a `git pull`, `log`) reloads open pages too.

Backward compatible: if the line is missing (another static server), the engine fetches `history.json` itself. With neither (a page opened from a file), it falls back to `PLAN.version`, and plans that set `rev` and `version` by hand still tag `rev === version` items.

## Notes file and anchors

`<dir>/.live/notes.json` always holds every note in export format (`reference/schema.md`): mark, text, `nid`, `quote`, `anchorState` and reply. Read it to review everything at once. `anchorState` is one of:
- `ok`: still on its target;
- `moved`: the quote was found elsewhere;
- `changed`: the element was rewritten;
- `orphaned`: the target is gone. Notes on deleted ids keep their quote, so nothing is lost, but renaming ids for tidiness strands the user's notes.

Use `quote` and `where` to see what the user pointed at.

## Offline fallback

A page opened from a file (an old copied `index.html`) has no server. Its notes are exported from the Notes page as `<plan-id>-notes-<date>.json`, usually into `~/Downloads`. Work through the notes whose `status` is `open` with the mark table in SKILL.md. Answer in `PLAN.replies[noteId] = { text, version }`. Without a server there is no automatic bookkeeping: bump `version`, set `rev` to it on what you change, and add a `changelog` entry. To get the user back online, run `live.mjs <dir>` and give them the URL.

## Adapters

- **Agent in a live session** (Claude Code): run `live.mjs <dir>` under the Monitor tool, which turns each line into a message in the session. Batching keeps that to one message per burst of notes. Answer with `reply` or `replies` and edit `plan.js`; the page reloads. Everything shows in the terminal. See SKILL.md §2.
- **Any agent CLI** (`--exec`): one process per note, run in `<dir>`. The prompt (the note plus the mark rules) goes to stdin, and stdout streams back to the page as the reply. Environment: `PLAN_DIR`, `PLAN_FILE`, `PLAN_NOTE_ID`. Examples: `--exec "claude -p --allowedTools Read,Edit"`, `--exec "codex exec -"`, `--exec "ollama run qwen3"`, `--exec "llm -m <model>"`.
- **Anything else**: tail `.live/asks.jsonl` and `POST /live/answer` (below).

## HTTP API (page ↔ server)

Every `/live/*` call needs the token: the cookie, the `x-live-token` header, or `?t=`.

| route | body / response |
|---|---|
| `GET /live/hello` | `{ pid, stamp, planMtime, agent: "listening"\|"exec"\|"offline", pending: [noteId], answers: {noteId: answer}, notes: [raw notes], deleted: {noteId: time} }` |
| `GET /live/events` | SSE. `status` `{agent, pending}`, `answer` `{noteId, text, status, at, by}`, `plan` `{mtime}` |
| `PUT /live/notes` | `{ raw: [notes], deleted: {noteId: time}, export }` → `{ notes, deleted }`. Merges per note id (newest `updated` wins) and keeps deletions as tombstones, so tabs and restarts never drop or resurrect notes. Writes `notes.json` only when the client already had the merged set; otherwise the client adopts the result and sends again. |
| `POST /live/stop` | Shuts the server down cleanly. |
| `POST /live/ask` | `{ note: <export-format note>, target, route, plan, planVersion }` |
| `POST /live/answer` | `{ noteId, text, status: "working"\|"done", by? }` |

## State (`<dir>/.live/`, git-ignored, mode 700)

`server.json` (port, token, pid, URLs) · `server.log` · `asks.jsonl` (append-only, full asks) · `answers.json` (latest per note) · `notes.json` (export format, always current) · `notes-raw.json` · `deleted.json` (tombstones) · `listener.json` (heartbeat, mode) · `revs.json` (bookkeeping cache: fingerprints, round per id, version, last change; the committed result is `../history.json`) · `spawn.lock` (while starting).

**Lifecycle.** A server is trusted only if it answers `/live/hello` with its token and the pid in `server.json`; a stale pid is never killed. Starts are serialized by `spawn.lock`. A server with no open page and no listener for 6 hours exits.

A question is pending until it has a `done` answer newer than the ask. Asking the same note again re-opens it.

## Security

The agent behind the bridge can edit files and run tools, so the server accepts only:
- connections on `127.0.0.1`;
- a `Host` of `127.0.0.1:<port>` or `localhost:<port>`, which blocks DNS rebinding;
- no `Origin`, or our own;
- the token (as a cookie, header or query) on every API call and every file except the engine page itself.

Responses carry `nosniff`, `Cross-Origin-Resource-Policy: same-origin`, `Referrer-Policy: no-referrer`, and the engine page a strict CSP (scripts only from itself and jsDelivr, where Mermaid is pinned with SRI; `connect-src 'self'`). Plan text and replies are untrusted: links render only for web, mail, in-page and relative targets. Dotfiles (including `.live/`) and paths outside `<dir>` are never served. The token reaches the page in the URL once. It becomes an HttpOnly cookie that page scripts can't read, and it's stripped from the address bar.
