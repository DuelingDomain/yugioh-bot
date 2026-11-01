#!/bin/sh
# Headless Chrome screenshot of a local page. Usage: sh shot.sh <page.html> <out.png> <width> <height>
# Each call uses its own throwaway profile, so several can run at once without touching the user's browser.
# Headless windows are at least 500px wide, so narrower widths load the page in an iframe of exactly <width>
# (the PNG is then 500px wide with the page at the left).
PAGE="$1"; OUT="$2"; W="$3"; H="$4"
PROFILE=$(mktemp -d "${TMPDIR:-/tmp}/shot-XXXXXX")
URL="file://$PAGE"; WIN="$W"
if [ "$W" -lt 500 ]; then
  WRAP="$PROFILE/wrap.html"
  printf '<body style="margin:0;background:#888"><iframe src="%s" style="display:block;border:0;width:%spx;height:%spx"></iframe></body>' "$URL" "$W" "$H" > "$WRAP"
  URL="file://$WRAP"; WIN=500
fi
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
  --user-data-dir="$PROFILE" --no-first-run --no-default-browser-check --allow-file-access-from-files --virtual-time-budget=4000 \
  --window-size="$WIN,$H" --screenshot="$OUT" "$URL" >/dev/null 2>&1
rm -rf "$PROFILE"
[ -f "$OUT" ] && echo "wrote $OUT" || echo "screenshot failed"
