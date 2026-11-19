#!/usr/bin/env bash
set -euo pipefail
mkdir -p "$HOME"
export XAUTHORITY="$HOME/.Xauthority"
touch "$XAUTHORITY"
Xvfb :99 -screen 0 1280x960x24 -nolisten tcp -ac >/out/xvfb.txt 2>&1 &
XVFB=$!
trap 'kill "${DEMO:-$XVFB}" "$XVFB" 2>/dev/null || true' EXIT
northcua demo serve --directory /out/tutorial >/out/demo-server.txt 2>&1 &
DEMO=$!
for i in $(seq 1 60); do
  test -f /out/tutorial/app.example.yaml && break
  kill -0 "$DEMO" 2>/dev/null || exit 2
  sleep 1
done
python - <<'PY'
import yaml
from pathlib import Path
p=Path('/out/tutorial/app.example.yaml')
x=yaml.safe_load(p.read_text())
x.setdefault('web',{})['browser_executable_path']='/usr/bin/chromium'
p.write_text(yaml.safe_dump(x))
PY
northcua config validate --app-config /out/tutorial/app.example.yaml >/out/validate.txt 2>&1
set +e
timeout 120 northcua local web run --app-config /out/tutorial/app.example.yaml \
  --url http://127.0.0.1:8787/task/first-web \
  --query 'Task ID: first-web. Activate the button and verify the receipt.' \
  --session-id first-web --max-steps 6 --evaluate >/out/run.txt 2>&1
code=$?
set -e
echo "$code" >/out/run.exit
exit "$code"
