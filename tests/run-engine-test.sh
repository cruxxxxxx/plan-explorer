#!/bin/bash
# Engine self-tests in headless Chrome. Needs network (Mermaid CDN). Run after changing the engine.
#   review example (findings, notes, filters, drawer, zoom, API) and plan example (work items, API tree).
set -u
S="$(cd "$(dirname "$0")/.." && pwd)"
run() {
  local plan="$1" test="$2"
  local tmp
  tmp="$(mktemp -d)"
  mkdir -p "$tmp/site" "$tmp/profile"
  cp "$S/$plan" "$tmp/site/plan.js"
  cp "$S/tests/$test" "$tmp/site/"
  sed "s|</body>|<pre id=\"results\">pending</pre><script src=\"$test\"></script></body>|" "$S/engine/explorer.html" > "$tmp/site/index.html"
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --no-first-run \
    --user-data-dir="$tmp/profile" --virtual-time-budget=30000 --dump-dom "file://$tmp/site/index.html" 2>/dev/null \
    | sed -n '/<pre id="results">/,/<\/pre>/p' | sed 's/<[^>]*>//g'
  rm -rf "$tmp"
}
out="$(run examples/review/plan.js interaction-test.js; run examples/plan/plan.js work-test.js)"
echo "$out"
echo "$out" | grep -q '^PASS' || { echo "no results (Mermaid offline?)"; exit 1; }
! echo "$out" | grep -q '^FAIL'
