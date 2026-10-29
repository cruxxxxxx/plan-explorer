#!/bin/bash
# Live bridge test: starts scripts/live.mjs on a copy of the example, checks the HTTP guards,
# then drives the page in headless Chrome while this script plays the agent (listen → reply → edit plan.js).
set -u
S="$(cd "$(dirname "$0")/.." && pwd)"
LIVE="$S/scripts/live.mjs"
tmp="$(mktemp -d)"
pids=()
cleanup() {
  for p in "${pids[@]}"; do kill "$p" 2>/dev/null; done
  rm -rf "$tmp"
}
trap cleanup EXIT
fails=0
check() {
  if [ "$2" = "$3" ]; then echo "PASS $1"; else echo "FAIL $1 :: got '$2' want '$3'"; fails=$((fails + 1)); fi
}

mkdir -p "$tmp/site" "$tmp/profile"
cp "$S/examples/plan.js" "$S/tests/live-page-test.js" "$tmp/site/"
sed 's|</body>|<pre id="results">pending</pre><script src="live-page-test.js"></script></body>|' "$S/engine/explorer.html" > "$tmp/site/index.html"

node "$LIVE" serve "$tmp/site" --port 0 > "$tmp/serve.log" 2>&1 &
pids+=($!)
for _ in $(seq 50); do [ -s "$tmp/site/.live/server.json" ] && break; sleep 0.1; done
port=$(node -e 'console.log(require(process.argv[1]).port)' "$tmp/site/.live/server.json")
token=$(node -e 'console.log(require(process.argv[1]).token)' "$tmp/site/.live/server.json")
base="http://127.0.0.1:$port"

# ── HTTP guards ──
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
check "static page served" "$(code "$base/")" 200
check "api needs token" "$(code "$base/live/hello")" 401
check "wrong token rejected" "$(code -H 'x-live-token: nope' "$base/live/hello")" 401
check "token accepted" "$(code -H "x-live-token: $token" "$base/live/hello")" 200
check "foreign Host rejected (DNS rebinding)" "$(code -H 'Host: evil.example:80' -H "x-live-token: $token" "$base/live/hello")" 403
check "foreign Origin rejected" "$(code -H 'Origin: http://evil.example' -H "x-live-token: $token" "$base/live/hello")" 403
check "dotfiles hidden (.live/server.json)" "$(code "$base/.live/server.json")" 404
check "path traversal blocked" "$(code --path-as-is "$base/../../etc/passwd")" 404
check "status: no listener yet" "$(node "$LIVE" status "$tmp/site" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).listener))')" false

# ── agent side: listen ──
node "$LIVE" listen "$tmp/site" > "$tmp/listen.log" 2>&1 &
pids+=($!)

# ── page side ──
node "$S/tests/cdp-run.mjs" "$base/?t=$token" "$tmp/profile" 45000 > "$tmp/results.txt" 2>&1 &
chrome=$!
pids+=($chrome)

for _ in $(seq 200); do grep -q '"type":"ask"' "$tmp/listen.log" 2>/dev/null && break; sleep 0.1; done
ask="$(grep '"type":"ask"' "$tmp/listen.log" | head -1)"
note=$(printf '%s' "$ask" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).noteId))')
check "listen emits the question" "$(printf '%s' "$ask" | grep -c 'why a materialized view')" 1
check "question carries element text" "$(printf '%s' "$ask" | grep -c 'local SQLite op log')" 1
check "status: listener alive" "$(node "$LIVE" status "$tmp/site" | grep -c '"listener": true')" 1
sleep 1
node "$LIVE" reply "$tmp/site" "$note" --status working "Checking the view code" > /dev/null
sleep 1.5
echo "Reads stay local: the view is rebuilt from the op log." | node "$LIVE" reply "$tmp/site" "$note" - > /dev/null
check "answer persisted" "$(grep -c 'Reads stay local' "$tmp/site/.live/answers.json")" 1
sleep 1
sed -i '' 's/version: 2,/version: 3,/; s/Every edit lands in a local SQLite op log first./LIVE-EDIT. Every edit lands in a local SQLite op log first./' "$tmp/site/plan.js"
check "plan-changed logged" "$(for _ in $(seq 30); do grep -q plan-changed "$tmp/serve.log" && break; sleep 0.1; done; grep -c plan-changed "$tmp/serve.log")" 1

wait "$chrome"
results="$(cat "$tmp/results.txt")"
echo "$results"
check "notes synced to .live/notes.json" "$(grep -c 'why a materialized view' "$tmp/site/.live/notes.json" 2>/dev/null)" 1
# ── exec adapter: any agent CLI; prompt on stdin, stdout is the reply ──
mkdir -p "$tmp/ex"
cp "$S/examples/plan.js" "$tmp/ex/"
cp "$S/engine/explorer.html" "$tmp/ex/index.html"
node "$LIVE" serve "$tmp/ex" --port 0 --exec 'grep -o "Question or comment: .*" | sed "s/^/ECHO /"' > "$tmp/ex.log" 2>&1 &
pids+=($!)
for _ in $(seq 50); do [ -s "$tmp/ex/.live/server.json" ] && break; sleep 0.1; done
eport=$(node -e 'console.log(require(process.argv[1]).port)' "$tmp/ex/.live/server.json")
etoken=$(node -e 'console.log(require(process.argv[1]).token)' "$tmp/ex/.live/server.json")
curl -s -X POST -H "x-live-token: $etoken" -H 'content-type: application/json' "http://127.0.0.1:$eport/live/ask" \
  -d '{"note":{"id":"n1","text":"why sqlite","where":"Local store","nid":"areas/local-store/summary/p0"}}' > /dev/null
for _ in $(seq 50); do grep -q '"done"' "$tmp/ex/.live/answers.json" 2>/dev/null && break; sleep 0.1; done
check "exec agent answers" "$(grep -c 'ECHO Question or comment: why sqlite' "$tmp/ex/.live/answers.json" 2>/dev/null)" 1

echo "$results" | grep -q '^PASS' || { echo "FAIL page produced no results"; fails=$((fails + 1)); }
echo "$results" | grep -q '^FAIL' && fails=$((fails + 1))
[ "$fails" = 0 ]
