#!/bin/bash
# Engine self-tests in headless Chrome. Needs network (Mermaid CDN). Run after changing the engine.
#   static Mermaid lint (no browser), review example (findings, notes, filters, drawer, zoom, API),
#   plan example (work items, API tree), live bookkeeping (PLAN_AUTO: Changed tags, version, date).
set -u
S="$(cd "$(dirname "$0")/.." && pwd)"
chrome="$("$S/scripts/find-chrome.sh")" || { echo "FAIL Chrome not found (set CHROME)"; exit 1; }
run() {
  local plan="$1" test="$2" extra="${3:-}"
  local tmp
  tmp="$(mktemp -d)"
  mkdir -p "$tmp/site" "$tmp/profile"
  cp "$S/$plan" "$tmp/site/plan.js"
  [ -n "$extra" ] && printf '\n%s\n' "$extra" >> "$tmp/site/plan.js"
  cp "$S/tests/$test" "$tmp/site/"
  sed "s|</body>|<pre id=\"results\">pending</pre><script src=\"$test\"></script></body>|" "$S/engine/explorer.html" > "$tmp/site/index.html"
  "$chrome" --headless=new --disable-gpu --no-first-run \
    --user-data-dir="$tmp/profile" --virtual-time-budget=30000 --dump-dom "file://$tmp/site/index.html" 2>/dev/null \
    | sed -n '/<pre id="results">/,/<\/pre>/p' | sed 's/<[^>]*>//g'
  rm -rf "$tmp"
}
#   anchor-test: insert a message into a flow; anchored items and notes stay put, numeric steps shift.
#   compat-test and the legacy-plan runs: the old issues/work/openQuestions shape still renders, old nids land.
# What live.mjs appends to the plan.js it serves (from history.json: bookkeeping the agent no longer writes).
auto='window.PLAN_AUTO = { version: 4, updated: "2026-10-30", changed: ["areas/local-store/items/op-log-table", "areas/sync/flows/reconnect", "areas/sync", "api/sync-client/m/sync"] };'
# No PLAN_AUTO line (another static server): the engine fetches history.json. This stub answers that fetch.
hist='(() => { const f0 = window.fetch; window.fetch = (u, o) => (String(u).startsWith("history.json") ? Promise.resolve(new Response(JSON.stringify({ version: 7, updated: "2026-11-02", changed: ["areas/local-store/items/view-from-log"], changelog: [{ version: 7, date: "2026-11-02", what: "x" }] }))) : f0(u, o)); })();'
lint="$(node "$S/tests/check-test.mjs")"
out="$(echo "$lint"
run examples/review/plan.js interaction-test.js
run examples/plan/plan.js work-test.js
run examples/plan/plan.js anchor-test.js
run examples/plan/plan.js auto-test.js "$auto"
run tests/fixtures/legacy-plan.js work-test.js
run tests/fixtures/legacy-plan.js auto-test.js "$auto"
run tests/fixtures/legacy-review.js compat-test.js
run examples/plan/plan.js history-test.js "$hist")"
echo "$out"
echo "$out" | grep -q '^PASS' || { echo "no results (Mermaid offline?)"; exit 1; }
! echo "$out" | grep -q '^FAIL'
