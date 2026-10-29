#!/bin/bash
# Engine self-test: drives explorer.html against examples/plan.js in headless Chrome.
# Run after changing the engine. Needs network (Mermaid CDN).
set -u
S="$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/site" "$tmp/profile"
cp "$S/examples/plan.js" "$S/tests/interaction-test.js" "$tmp/site/"
sed 's|</body>|<pre id="results">pending</pre><script src="interaction-test.js"></script></body>|' "$S/engine/explorer.html" > "$tmp/site/index.html"
out="$("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --no-first-run \
  --user-data-dir="$tmp/profile" --virtual-time-budget=30000 --dump-dom "file://$tmp/site/index.html" 2>/dev/null \
  | sed -n '/<pre id="results">/,/<\/pre>/p' | sed 's/<[^>]*>//g')"
echo "$out"
echo "$out" | grep -q '^PASS' || { echo "no results (Mermaid offline?)"; exit 1; }
! echo "$out" | grep -q '^FAIL'
