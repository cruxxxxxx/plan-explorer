#!/bin/bash
# Engine self-tests in headless Chrome. Needs network (Mermaid CDN). Run after changing the engine.
#   review example (findings, notes, filters, drawer, zoom, API) and plan example (work items, API tree).
set -u
S="$(cd "$(dirname "$0")/.." && pwd)"
chrome="$("$S/scripts/find-chrome.sh")" || { echo "FAIL Chrome not found (set CHROME)"; exit 1; }
run() {
  local plan="$1" test="$2"
  local tmp
  tmp="$(mktemp -d)"
  mkdir -p "$tmp/site" "$tmp/profile"
  cp "$S/$plan" "$tmp/site/plan.js"
  cp "$S/tests/$test" "$tmp/site/"
  sed "s|</body>|<pre id=\"results\">pending</pre><script src=\"$test\"></script></body>|" "$S/engine/explorer.html" > "$tmp/site/index.html"
  "$chrome" --headless=new --disable-gpu --no-first-run \
    --user-data-dir="$tmp/profile" --virtual-time-budget=30000 --dump-dom "file://$tmp/site/index.html" 2>/dev/null \
    | sed -n '/<pre id="results">/,/<\/pre>/p' | sed 's/<[^>]*>//g'
  rm -rf "$tmp"
}
#   anchor-test: insert a message into a flow; anchored items and notes stay put, numeric steps shift.
#   compat-test and the legacy-plan run: the old issues/work/openQuestions shape still renders, old nids land.
out="$(run examples/review/plan.js interaction-test.js
run examples/plan/plan.js work-test.js
run examples/plan/plan.js anchor-test.js
run tests/fixtures/legacy-plan.js work-test.js
run tests/fixtures/legacy-review.js compat-test.js)"
echo "$out"
echo "$out" | grep -q '^PASS' || { echo "no results (Mermaid offline?)"; exit 1; }
! echo "$out" | grep -q '^FAIL'
