#!/bin/bash
# Live server test: one command (live.mjs <dir>) starts the server and listens. Checks the HTTP guards
# and cookie auth, drives the page over DevTools while this script plays the agent, then the --exec adapter.
set -u
S="$(cd "$(dirname "$0")/.." && pwd)"
LIVE="$S/scripts/live.mjs"
tmp="$(mktemp -d)/it's a dir"
mkdir -p "$tmp"
pids=()
cleanup() {
  for p in "${pids[@]}"; do kill "$p" 2>/dev/null; done
  node "$LIVE" stop "$tmp/site" > /dev/null 2>&1
  node "$LIVE" stop "$tmp/ex" > /dev/null 2>&1
  rm -rf "$(dirname "$tmp")"
}
trap cleanup EXIT
fails=0
check() {
  if [ "$2" = "$3" ]; then echo "PASS $1"; else echo "FAIL $1 :: got '$2' want '$3'"; fails=$((fails + 1)); fi
}
field() { node -e 'console.log(require(process.argv[1])[process.argv[2]])' "$1" "$2"; }

# The plan folder holds only plan.js; the engine comes from the skill (here: engine + test harness).
mkdir -p "$tmp/site" "$tmp/profile"
cp "$S/examples/review/plan.js" "$S/tests/live-page-test.js" "$tmp/site/"
sed 's|</body>|<pre id="results">pending</pre><script src="live-page-test.js"></script></body>|' "$S/engine/explorer.html" > "$tmp/engine.html"
export PLAN_EXPLORER_ENGINE="$tmp/engine.html"
# Lint plan.js half a second after an edit settles (default 3 s), so the check events below come quickly.
export PLAN_EXPLORER_CHECK_SETTLE_MS=500
js() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(eval(process.argv[1]))})' "$1"; }

check "status before start" "$(node "$LIVE" status "$tmp/site" | grep -c '"running": false')" 1
node "$LIVE" "$tmp/site" --port 0 > "$tmp/listen.log" 2>&1 &
pids+=($!)
for _ in $(seq 80); do grep -q '"ready"' "$tmp/listen.log" 2>/dev/null && break; sleep 0.1; done
port=$(field "$tmp/site/.live/server.json" port)
token=$(field "$tmp/site/.live/server.json" token)
base="http://127.0.0.1:$port"
check "one command prints the URL" "$(grep -c "\"open\":\"$base/?t=$token\"" "$tmp/listen.log")" 1
check "server runs detached" "$(node "$LIVE" status "$tmp/site" | grep -c '"running": true')" 1

# ── HTTP guards and auth ──
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
check "engine served at /" "$(curl -s "$base/" | grep -c 'live-page-test.js')" 1
check "api needs token" "$(code "$base/live/hello")" 401
check "wrong token rejected" "$(code -H 'x-live-token: nope' "$base/live/hello")" 401
check "token header accepted" "$(code -H "x-live-token: $token" "$base/live/hello")" 200
cookie="$(curl -s -D - -o /dev/null "$base/?t=$token" | grep -i '^set-cookie' | sed -E 's/^[^:]*: *([^;]*);.*/\1/' | tr -d '\r')"
check "first visit sets HttpOnly cookie" "$(curl -s -D - -o /dev/null "$base/?t=$token" | grep -ci 'set-cookie:.*HttpOnly; SameSite=Strict')" 1
check "cookie authenticates" "$(code -H "Cookie: $cookie" "$base/live/hello")" 200
check "no cookie without token" "$(curl -s -D - -o /dev/null "$base/" | grep -ci 'set-cookie')" 0
check "foreign Host rejected (DNS rebinding)" "$(code -H 'Host: evil.example:80' -H "Cookie: $cookie" "$base/live/hello")" 403
check "foreign Origin rejected" "$(code -H 'Origin: http://evil.example' -H "Cookie: $cookie" "$base/live/hello")" 403
check "dotfiles hidden (.live/server.json)" "$(code -H "Cookie: $cookie" "$base/.live/server.json")" 404
check "path traversal blocked" "$(code -H "Cookie: $cookie" --path-as-is "$base/../../etc/passwd")" 404
check "plan.js needs token" "$(code "$base/plan.js")" 401
check "plan.js with cookie" "$(code -H "Cookie: $cookie" "$base/plan.js")" 200
check "malformed URL is a 400, server survives" "$(code -H "Cookie: $cookie" "$base/%E0%A4%A")" 400
check "server still up after bad URL" "$(code -H "x-live-token: $token" "$base/live/hello")" 200
check "engine page has CSP" "$(curl -s -D - -o /dev/null "$base/" | grep -ci "content-security-policy:.*frame-ancestors 'none'")" 1
check "bad noteId rejected" "$(code -X POST -H "x-live-token: $token" -H 'content-type: application/json' --data '{"noteId":"a;rm -rf ~","status":"done","text":"x"}' "$base/live/answer")" 400
# Notes merge per id (newest wins) and deletions stick, whatever order clients write in.
put() { curl -s -X PUT -H "x-live-token: $token" -H 'content-type: application/json' --data "$1" "$base/live/notes"; }
put '{"raw":[{"id":"m1","text":"old","updated":"2026-01-01"},{"id":"m2","text":"keep","updated":"2026-01-01"}]}' > /dev/null
merged="$(put '{"raw":[{"id":"m1","text":"new","updated":"2026-02-01"}],"deleted":{"m2":"2026-02-01"}}')"
check "notes merge: newest wins" "$(printf '%s' "$merged" | grep -c '"text":"new"')" 1
check "notes merge: tombstone removes" "$(printf '%s' "$merged" | grep -c '"m2"')" 1
check "notes merge: deleted note gone from list" "$(printf '%s' "$merged" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).notes.map(n=>n.id).join(",")))')" "m1"
stale="$(put '{"raw":[{"id":"m1","text":"older","updated":"2026-01-15"},{"id":"m2","text":"zombie","updated":"2026-03-01"}]}')"
check "notes merge: stale write loses, deleted stays deleted" "$(printf '%s' "$stale" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.notes.map(n=>n.id+":"+n.text).join(","))})')" "m1:new"
put '{"raw":[],"deleted":{"m1":"2026-04-01"}}' > /dev/null

# ── page ↔ agent round trip ──
node "$S/tests/cdp-run.mjs" "$base/?t=$token" "$tmp/profile" 45000 > "$tmp/results.txt" 2>&1 &
chrome=$!
pids+=($chrome)
for _ in $(seq 200); do grep -q '"type":"note"' "$tmp/listen.log" 2>/dev/null && break; sleep 0.1; done
ask="$(grep '"type":"note"' "$tmp/listen.log" | head -1)"
note=$(printf '%s' "$ask" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).noteId))')
check "saving a note sends it to the agent" "$(printf '%s' "$ask" | grep -c 'why a materialized view')" 1
check "note carries element text" "$(printf '%s' "$ask" | grep -c 'local SQLite op log')" 1
check "slim note: no planFile, markName, at, plan" "$(printf '%s' "$ask" | js '["planFile","markName","at","plan","planVersion","kind"].filter(k => k in j).join(",")')" ""
check "slim note: keeps noteId, mark, text, where, nid, quote, reply" "$(printf '%s' "$ask" | js '["noteId","mark","text","where","nid","quote","reply"].every(k => k in j)')" true
check "slim note: element text not repeated when the quote has it" "$(printf '%s' "$ask" | js '"target" in j')" false
check "slim note under 600 bytes" "$(printf '%s' "$ask" | js 'Buffer.byteLength(JSON.stringify(j)) < 600')" true
check "served plan.js carries PLAN_AUTO baseline" "$(curl -s -H "Cookie: $cookie" "$base/plan.js" | grep -c 'window.PLAN_AUTO = {"version":2,"updated":null,"changed":\[\]}')" 1
check "status: agent listening" "$(node "$LIVE" status "$tmp/site" | grep -c '"agent": "listening"')" 1
sleep 1
node "$LIVE" reply "$tmp/site" "$note" --status working "Checking the view code" > /dev/null
sleep 1.5
# The note's own reply command must survive a folder path with spaces and quotes.
replycmd=$(printf '%s' "$ask" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).reply))')
echo "Reads stay local: the view is rebuilt from the op log." | sh -c "$replycmd" > /dev/null
check "answer persisted" "$(grep -c 'Reads stay local' "$tmp/site/.live/answers.json")" 1
sleep 1
sed 's/version: 2,/version: 3,/; s/Every edit lands in a local SQLite op log first./LIVE-EDIT. Every edit lands in a local SQLite op log first./' "$tmp/site/plan.js" > "$tmp/plan.next" && cat "$tmp/plan.next" > "$tmp/site/plan.js"
wait "$chrome"
results="$(cat "$tmp/results.txt")"
echo "$results"
check "notes synced to .live/notes.json" "$(grep -c 'why a materialized view' "$tmp/site/.live/notes.json" 2>/dev/null)" 1
echo "$results" | grep -q '^PASS' || { echo "FAIL page produced no results"; fails=$((fails + 1)); }
echo "$results" | grep -q '^FAIL' && fails=$((fails + 1))

# ── bookkeeping: the server diffs plan.js and tags what changed; the agent sets no rev ──
auto() { curl -s -H "Cookie: $cookie" "$base/plan.js" | sed -n 's/^;window.PLAN_AUTO = \(.*\);$/\1/p'; }
check "edit tags the changed item and bumps the version" "$(auto | js 'j.version + " " + j.changed.join(",")')" "3 areas/local-store"
check "updated date set by the server" "$(auto | js '/^\d{4}-\d\d-\d\d$/.test(j.updated)')" true
check "revs snapshot kept in .live" "$(test -f "$tmp/site/.live/revs.json" && echo yes)" yes
node -e 'const f=process.argv[1];const fs=require("fs");fs.writeFileSync(f,fs.readFileSync(f,"utf8").replace("Do we batch pushes, or stream ops one by one?","Do we batch pushes?"))' "$tmp/site/plan.js"
check "second edit in the same round adds to the tags, no new version" "$(auto | js 'j.version + " " + j.changed.sort().join(",")')" "3 areas/local-store,areas/sync/questions/batching"
node "$LIVE" log "$tmp/site" "Shortened the batching question" > /dev/null
check "log appends one changelog entry with the changed ids" "$(js 'j.length + " " + j[0].version + " " + j[0].changed.length' < "$tmp/site/.live/changelog.json")" "1 3 2"

# ── batching: notes saved together reach the agent as one line ──
ask() { curl -s -X POST -H "x-live-token: $token" -H 'content-type: application/json' "$base/live/ask" -d "$1" > /dev/null; }
ask '{"note":{"id":"b1","mark":"?","text":"first","where":"Overview","nid":"overview/title","quote":"Offline sync"},"target":"Offline sync: review"}'
ask '{"note":{"id":"b2","mark":"!","text":"second","where":"Overview","nid":"overview/summary/p0","kind":"text","quote":"op log"},"target":"Every edit lands in a local SQLite op log first. The UI reads from a materialized view that is rebuilt from the log on launch, so a crash between append and apply loses nothing; the log is the only source of truth and the view is a cache. This sentence pads the element past two hundred characters."}'
for _ in $(seq 60); do grep -q '"type":"notes"' "$tmp/listen.log" 2>/dev/null && break; sleep 0.1; done
batch="$(grep '"type":"notes"' "$tmp/listen.log" | tail -1)"
check "two notes within 2 s arrive as one line" "$(printf '%s' "$batch" | js 'j.notes.map(n => n.noteId).join(",")')" "b1,b2"
check "no separate note lines for a batch" "$(grep -c '"noteId":"b1"' "$tmp/listen.log")" 1
check "batch carries one replies command" "$(printf '%s' "$batch" | js 'j.replies.includes(" replies ")')" true
check "batched notes carry no per-note reply" "$(printf '%s' "$batch" | js 'j.notes.some(n => "reply" in n)')" false
check "text-note context truncated to 200 chars" "$(printf '%s' "$batch" | js 'j.notes[1].target.length')" 200
printf -- '--- b1\nAnswer one.\n\n--- b2\nAnswer two,\nover two lines.\n' | sh -c "$(printf '%s' "$batch" | js 'j.replies')" > /dev/null
check "replies answers every note in one command" "$(js '[j.b1.text, j.b2.text, j.b2.status].join("|")' < "$tmp/site/.live/answers.json")" "Answer one.|Answer two,
over two lines.|done"

# ── lint while live: a broken diagram is reported once, and its fix once ──
cp "$tmp/site/plan.js" "$tmp/plan.good"
sed 's/U->>UI: types a sentence/U->>UI: types a sentence; saves/' "$tmp/plan.good" > "$tmp/plan.bad" && cat "$tmp/plan.bad" > "$tmp/site/plan.js"
for _ in $(seq 60); do grep -q '"type":"check"' "$tmp/listen.log" 2>/dev/null && break; sleep 0.1; done
check "broken diagram reported on the stream" "$(grep '"type":"check"' "$tmp/listen.log" | head -1 | js 'j.ok + " " + /";"/.test(j.errors[0])')" "false true"
cat "$tmp/plan.good" > "$tmp/site/plan.js"
for _ in $(seq 60); do grep -q '"type":"check","ok":true' "$tmp/listen.log" 2>/dev/null && break; sleep 0.1; done
check "fix reported once" "$(grep -c '"type":"check"' "$tmp/listen.log")" 2

# ── restart keeps the URL and token ──
node "$LIVE" stop "$tmp/site" > /dev/null
sleep 0.5
node "$LIVE" "$tmp/site" > "$tmp/listen2.log" 2>&1 &
pids+=($!)
for _ in $(seq 80); do grep -q '"ready"' "$tmp/listen2.log" 2>/dev/null && break; sleep 0.1; done
check "restart reuses port" "$(field "$tmp/site/.live/server.json" port)" "$port"
check "restart reuses token (cookie still valid)" "$(code -H "Cookie: $cookie" "$base/live/hello")" 200

# ── exec adapter: any agent CLI; prompt on stdin, stdout is the reply ──
mkdir -p "$tmp/ex"
cp "$S/examples/review/plan.js" "$tmp/ex/"
node "$LIVE" "$tmp/ex" --port 0 --exec 'grep -o "Note: .*" | sed "s/^/ECHO /"' > "$tmp/ex.log" 2>&1 &
pids+=($!)
for _ in $(seq 80); do grep -q '"ready"' "$tmp/ex.log" 2>/dev/null && break; sleep 0.1; done
eport=$(field "$tmp/ex/.live/server.json" port)
etoken=$(field "$tmp/ex/.live/server.json" token)
curl -s -X POST -H "x-live-token: $etoken" -H 'content-type: application/json' "http://127.0.0.1:$eport/live/ask" \
  -d '{"note":{"id":"n1","text":"why sqlite","where":"Local store","nid":"areas/local-store/summary/p0"}}' > /dev/null
for _ in $(seq 60); do grep -q '"done"' "$tmp/ex/.live/answers.json" 2>/dev/null && break; sleep 0.1; done
check "exec agent answers" "$(grep -c 'ECHO Note: why sqlite' "$tmp/ex/.live/answers.json" 2>/dev/null)" 1
check "status: agent exec" "$(node "$LIVE" status "$tmp/ex" | grep -c '"agent": "exec"')" 1

# ── rounds: edits after a quiet gap get a new version and a fresh set of Changed tags ──
mkdir -p "$tmp/bk"
cp "$S/examples/plan/plan.js" "$tmp/bk/"
PLAN_EXPLORER_ROUND_GAP_MS=1000 node "$LIVE" serve "$tmp/bk" --port 0 > "$tmp/bk.log" 2>&1 &
pids+=($!)
for _ in $(seq 80); do grep -q '"ready"' "$tmp/bk.log" 2>/dev/null && break; sleep 0.1; done
bport=$(field "$tmp/bk/.live/server.json" port)
btoken=$(field "$tmp/bk/.live/server.json" token)
bauto() { curl -s -H "x-live-token: $btoken" "http://127.0.0.1:$bport/plan.js" | sed -n 's/^;window.PLAN_AUTO = \(.*\);$/\1/p'; }
bedit() { node -e 'const [f,a,b]=process.argv.slice(1);const fs=require("fs");fs.writeFileSync(f,fs.readFileSync(f,"utf8").replace(a,b))' "$tmp/bk/plan.js" "$1" "$2"; }
check "baseline: nothing tagged, version from plan.js" "$(bauto | js 'j.version + ":" + j.changed.length')" "1:0"
bedit 'Compact the op log on sync ack, or on a timer?' 'Compact the op log on sync ack?'
check "round 2: new question tagged" "$(bauto | js 'j.version + ":" + j.changed.join()')" "2:areas/local-store/questions/compaction"
bedit '"Ops not yet acked, oldest first."' '"Ops not yet acked, oldest first, at most 500."'
bedit '{ id: "m2", stage: "Sync"' '{ id: "m3", stage: "Conflicts", items: ["Three-way merge"] },
    { id: "m2", stage: "Sync"'
check "same round: member and new roadmap stage added" "$(bauto | js 'j.version + ":" + j.changed.sort().join()')" "2:api/op-log/m/unsynced,areas/local-store/questions/compaction,roadmap/m3"
bedit 'version: 1,' 'version: 1, rev: 9,'
check "bookkeeping-only edits change nothing" "$(bauto | js 'j.version + ":" + j.changed.length')" "2:3"
sleep 1.2
bedit '"Simple to inspect"' '"Simple to inspect with cat"'
check "after a quiet gap: round 3 tags only the new change" "$(bauto | js 'j.version + ":" + j.changed.join()')" "3:areas/local-store/options/files"
bedit 'version: 1,' 'version: 7,'
check "a higher plan.version set by hand wins" "$(bauto | js 'j.version')" 7

[ "$fails" = 0 ]
