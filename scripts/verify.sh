#!/bin/bash
# Verifies a plan folder: plan.js structure, then renders every flow with the skill's engine
# in headless Chrome and reports Mermaid errors. Never opens a visible window.
# Usage: verify.sh <plan-dir> [screenshot.png]
set -u
dir="${1:?usage: verify.sh <explorer-dir> [screenshot.png]}"
dir="$(cd "$dir" && pwd)"
here="$(cd "$(dirname "$0")" && pwd)"

node "$here/check.mjs" "$dir/plan.js" || exit 1

chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [ ! -x "$chrome" ]; then
  echo "! Chrome not found; skipped diagram render check"
  exit 0
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
profile="$tmp/profile"
mkdir -p "$tmp/site" "$profile"
cp "$dir/plan.js" "$tmp/site/plan.js"
cp "$here/../engine/explorer.html" "$tmp/site/index.html"
url="file://$tmp/site/index.html#explore"
dom="$("$chrome" --headless=new --disable-gpu --no-first-run --user-data-dir="$profile" \
  --virtual-time-budget=15000 --dump-dom "$url" 2>/dev/null)"

total=$(printf '%s' "$dom" | grep -o 'class="canvas[^"]*" data-flow="areas' | wc -l | tr -d ' ')
rendered=$(printf '%s' "$dom" | grep -o '<svg[^>]*aria-roledescription="sequence"' | wc -l | tr -d ' ')
# Anchor on rendered canvases (data-flow="areas/...") so the engine's own JS source never matches.
bad=$(printf '%s' "$dom" | grep -o 'data-flow="areas[^"]*"><div class="err">Diagram error: [^<]*' | sed -E 's/^data-flow="([^"]*)"><div class="err">Diagram error: /\1: /' || true)
offline=$(printf '%s' "$dom" | grep -c "data-flow=\"areas[^\"]*\"><div class=\"err\">Mermaid didn't load" || true)

if [ "$offline" != "0" ]; then
  echo "! Mermaid CDN didn't load (offline?); couldn't check diagrams"
elif [ -n "$bad" ]; then
  echo "✗ diagram errors:"
  printf '%s\n' "$bad" | sed 's/^/  /'
  exit 1
else
  echo "✓ flows rendered: $rendered/$total"
fi

if [ $# -ge 2 ]; then
  "$chrome" --headless=new --disable-gpu --no-first-run --user-data-dir="$profile" \
    --virtual-time-budget=15000 --window-size=1400,1000 --screenshot="$2" "file://$tmp/site/index.html" >/dev/null 2>&1
  echo "  screenshot: $2"
fi
