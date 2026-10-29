#!/bin/bash
# Prints the path of a Chrome/Chromium binary, or exits 1. $CHROME wins when set.
for c in "${CHROME:-}" \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "/Applications/Chromium.app/Contents/MacOS/Chromium" \
  "$(command -v google-chrome 2>/dev/null)" "$(command -v google-chrome-stable 2>/dev/null)" \
  "$(command -v chromium 2>/dev/null)" "$(command -v chromium-browser 2>/dev/null)"; do
  if [ -n "$c" ] && [ -x "$c" ]; then
    echo "$c"
    exit 0
  fi
done
exit 1
