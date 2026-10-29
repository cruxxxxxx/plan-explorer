#!/bin/bash
# Live server test: one command (live.mjs <dir>) starts the server and listens. Checks the HTTP guards
# and cookie auth, drives the page over DevTools while this script plays the agent, then the --exec adapter.
set -u
S="$(cd "$(dirname "$0")/.." && pwd)"
LIVE="$S/scripts/live.mjs"
tmp="$(mktemp -d)"
pids=()
cleanup() {
  for p in "${pids[@]}"; do kill "$p" 2>/dev/null; done
  node "$LIVE" stop "$tmp/site" > /dev/null 2>&1
  node "$LIVE" stop "$tmp/ex" > /dev/null 2>&1
  rm -rf "$tmp"
}
trap cleanup EXIT
fails=0
check() {
  if [ "$2" = "$3" ]; then echo "PASS $1"; else echo "FAIL $1 :: got '$2' want '$3'"; fails=$((fails + 1)); fi
}
field() { node -e 'console.log(require(process.argv[1])[process.argv[2]])' "$1" "$2"; }

# The plan folder holds only plan.js; the engine comes from the skill (here: engine + test harness).
mkdir -p "$tmp/site" "$tmp/profile"
cp "$S/examples/plan.js" "$S/tests/live-page-test.js" "$tmp/site/"
sed 's|</body>|<pre id="results">pending</pre><script src="live-page-test.js"></script></body>|' "$S/engine/explorer.html" > "$tmp/engine.html"
export PLAN_EXPLORER_ENGINE="$tmp/engine.html"

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
check "dotfiles hidden (.live/server.json)" "$(code "$base/.live/server.json")" 404
check "path traversal blocked" "$(code --path-as-is "$base/../../etc/passwd")" 404

# ── page ↔ agent round trip ──
node "$S/tests/cdp-run.mjs" "$base/?t=$token" "$tmp/profile" 45000 > "$tmp/results.txt" 2>&1 &
chrome=$!
pids+=($chrome)
for _ in $(seq 200); do grep -q '"type":"note"' "$tmp/listen.log" 2>/dev/null && break; sleep 0.1; done
ask="$(grep '"type":"note"' "$tmp/listen.log" | head -1)"
note=$(printf '%s' "$ask" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).noteId))')
check "saving a note sends it to the agent" "$(printf '%s' "$ask" | grep -c 'why a materialized view')" 1
check "note carries element text" "$(printf '%s' "$ask" | grep -c 'local SQLite op log')" 1
check "status: agent listening" "$(node "$LIVE" status "$tmp/site" | grep -c '"agent": "listening"')" 1
sleep 1
node "$LIVE" reply "$tmp/site" "$note" --status working "Checking the view code" > /dev/null
sleep 1.5
echo "Reads stay local: the view is rebuilt from the op log." | node "$LIVE" reply "$tmp/site" "$note" - > /dev/null
check "answer persisted" "$(grep -c 'Reads stay local' "$tmp/site/.live/answers.json")" 1
sleep 1
sed -i '' 's/version: 2,/version: 3,/; s/Every edit lands in a local SQLite op log first./LIVE-EDIT. Every edit lands in a local SQLite op log first./' "$tmp/site/plan.js"
wait "$chrome"
results="$(cat "$tmp/results.txt")"
echo "$results"
check "notes synced to .live/notes.json" "$(grep -c 'why a materialized view' "$tmp/site/.live/notes.json" 2>/dev/null)" 1
echo "$results" | grep -q '^PASS' || { echo "FAIL page produced no results"; fails=$((fails + 1)); }
echo "$results" | grep -q '^FAIL' && fails=$((fails + 1))

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
cp "$S/examples/plan.js" "$tmp/ex/"
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

[ "$fails" = 0 ]
