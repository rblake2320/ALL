#!/usr/bin/env bash
set -euo pipefail
mkdir -p "$HOME" /out/config
export XAUTHORITY="$HOME/.Xauthority"
touch "$XAUTHORITY"
Xvfb :99 -screen 0 1280x960x24 -nolisten tcp -ac >/out/xvfb.txt 2>&1 &
XVFB=$!
python -m http.server 4173 --bind 127.0.0.1 --directory /game >/out/http.txt 2>&1 &
SERVER=$!
cleanup() {
  mkdir -p /out/browser
  touch /out/browser/stop-browser
  if test -n "${BROWSER:-}"; then wait "$BROWSER" || true; fi
  kill "$SERVER" "$XVFB" 2>/dev/null || true
}
trap cleanup EXIT
for i in $(seq 1 60); do xdpyinfo >/dev/null 2>&1 && break; sleep 1; done
export NORTHCUA_MODEL=NorthCUA-Nano OPENAI_API_KEY=local-no-key NORTHCUA_BASE_URL=http://nano:8000/v1
northcua config init --directory /out/config --model NorthCUA-Nano --base-url http://nano:8000/v1 >/out/config-init.txt 2>&1
python /source/configure.py
northcua config validate --app-config /out/config/app.example.yaml >/out/config-validate.txt 2>&1
python - <<'PY' >/out/model-health.txt 2>&1
import time, urllib.request
for attempt in range(60):
    try:
        with urllib.request.urlopen('http://nano:8000/health',timeout=2) as response:
            assert response.status==200
        print('health 200'); break
    except Exception as exc:
        if attempt==59: raise
        time.sleep(2)
PY
if test -n "${W112_GOAL_ID:-}"; then
  python - <<'PY'
import json, os
from pathlib import Path
rows=json.loads(Path('/source/goals.json').read_text())
g=next(row for row in rows if row['id']==os.environ['W112_GOAL_ID'])
Path('/out/query.txt').write_text(g['goal'],encoding='utf-8')
Path('/out/setup.txt').write_text(g['setup'],encoding='utf-8')
PY
else
  printf '%s' 'You are testing only the Afterlife Lease game in this isolated window. Click New Game, choose the free starter home, and open Create your household. Stop when the character editor is visible. Do not open other applications or navigate away from the game.' >/out/query.txt
  printf '%s' menu >/out/setup.txt
fi
python /source/browser.py /out/browser "$(cat /out/setup.txt)" >/out/browser.txt 2>&1 &
BROWSER=$!
for i in $(seq 1 180); do
  test -f /out/browser/browser-ready.json && break
  kill -0 "$BROWSER" 2>/dev/null || { echo 'browser setup failed'; exit 2; }
  sleep 1
done
test -f /out/browser/browser-ready.json
set +e
timeout --signal=TERM 900 northcua local desktop run --app-config /out/config/app.example.yaml \
  --query "$(cat /out/query.txt)" \
  --max-steps "${W112_MAX_STEPS:-6}" --session-id "${W112_GOAL_ID:-w112-pilot}" >/out/actor.txt 2>&1
code=$?
set -e
echo "$code" >/out/actor.exit
touch /out/browser/stop-browser
exit "$code"
