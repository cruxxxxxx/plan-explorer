#!/bin/bash
# Migration test: converts old-shape plans with scripts/migrate-plan.mjs (to a temp copy), validates the
# result, and checks that the migrated plan renders the same as the original in headless Chrome.
# Needs network (Mermaid CDN).
#   tests/migrate-test.sh                 the legacy fixtures
#   tests/migrate-test.sh a/plan.js …     any plan files (read only; copies are migrated)
set -u
S="$(cd "$(dirname "$0")/.." && pwd)"
chrome="$("$S/scripts/find-chrome.sh")" || { echo "FAIL Chrome not found (set CHROME)"; exit 1; }
dump() {
  local plan="$1" out="$2"
  local tmp
  tmp="$(mktemp -d)"
  mkdir -p "$tmp/site" "$tmp/profile"
  cp "$plan" "$tmp/site/plan.js"
  cp "$S/tests/render-dump.js" "$tmp/site/"
  sed "s|</body>|<pre id=\"results\">pending</pre><script src=\"render-dump.js\"></script></body>|" "$S/engine/explorer.html" > "$tmp/site/index.html"
  "$chrome" --headless=new --disable-gpu --no-first-run \
    --user-data-dir="$tmp/profile" --virtual-time-budget=180000 --dump-dom "file://$tmp/site/index.html" 2>/dev/null \
    | sed -n '/<pre id="results">/,/<\/pre>/p' | sed 's/<[^>]*>//g' > "$out"
  rm -rf "$tmp"
}
plans=("$@")
if [ ${#plans[@]} -eq 0 ]; then
  plans=("$S/tests/fixtures/legacy-review.js" "$S/tests/fixtures/legacy-plan.js")
fi
fail=0
work="$(mktemp -d)"
for p in "${plans[@]}"; do
  name="$(basename "$(dirname "$p")")-$(basename "$p" .js)"
  cp "$p" "$work/$name.orig.js"
  if ! node "$S/scripts/migrate-plan.mjs" "$work/$name.orig.js" --out "$work/$name.new.js" 2> "$work/$name.report"; then
    echo "FAIL $name: migrate-plan failed: $(cat "$work/$name.report")"
    fail=1
    continue
  fi
  cmp -s "$p" "$work/$name.orig.js" && echo "PASS $name: original untouched" || { echo "FAIL $name: original changed"; fail=1; }
  grep -q "items:" "$work/$name.new.js" && ! grep -qE '^\s+(issues|work|openQuestions):' "$work/$name.new.js" \
    && echo "PASS $name: migrated to items" || { echo "FAIL $name: old lists remain"; fail=1; }
  if node "$S/scripts/check.mjs" "$work/$name.new.js" > "$work/$name.check"; then
    echo "PASS $name: check.mjs ($(tail -1 "$work/$name.check"))"
  else
    echo "FAIL $name: check.mjs"; cat "$work/$name.check"; fail=1
  fi
  grep -q "old issues/work" "$work/$name.check" && { echo "FAIL $name: still warns about old lists"; fail=1; }
  dump "$work/$name.orig.js" "$work/$name.orig.txt"
  dump "$work/$name.new.js" "$work/$name.new.txt"
  if [ ! -s "$work/$name.orig.txt" ] || grep -q "FAIL exception" "$work/$name.orig.txt" "$work/$name.new.txt"; then
    echo "FAIL $name: render dump failed (Mermaid offline?)"; fail=1
  elif cmp -s "$work/$name.orig.txt" "$work/$name.new.txt"; then
    echo "PASS $name: renders the same ($(grep -c '^## ' "$work/$name.new.txt") views, $(grep -c '^dot ' "$work/$name.new.txt") step dots, $(grep -c '^row ' "$work/$name.new.txt") rows)"
  else
    echo "FAIL $name: render differs"; diff "$work/$name.orig.txt" "$work/$name.new.txt" | head -20; fail=1
  fi
  echo "     $(cat "$work/$name.report")" | sed "s|$work/||g"
done
rm -rf "$work"
exit $fail
