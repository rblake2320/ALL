#!/usr/bin/env bash
set -euo pipefail
mkdir -p "$HOME" /out/browser
export XAUTHORITY="$HOME/.Xauthority"
touch "$XAUTHORITY"
Xvfb :99 -screen 0 1280x960x24 -nolisten tcp -ac >/out/xvfb.txt 2>&1 &
XVFB=$!
python -m http.server 4173 --bind 127.0.0.1 --directory /game >/out/http.txt 2>&1 &
SERVER=$!
cleanup() {
  touch /out/browser/stop-browser
  if test -n "${BROWSER:-}"; then wait "$BROWSER" || true; fi
  kill "$SERVER" "$XVFB" 2>/dev/null || true
}
trap cleanup EXIT
for i in $(seq 1 30); do xdpyinfo >/dev/null 2>&1 && break; sleep 1; done
python /source/browser.py /out/browser starter >/out/browser.txt 2>&1 &
BROWSER=$!
for i in $(seq 1 180); do
  test -f /out/browser/browser-ready.json && break
  kill -0 "$BROWSER" 2>/dev/null || { tail -20 /out/browser.txt; exit 2; }
  sleep 1
done
test -f /out/browser/browser-ready.json
cat /out/browser/browser-ready.json
