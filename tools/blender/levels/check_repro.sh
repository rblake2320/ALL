#!/usr/bin/env bash
# Reproducibility check for a level art kit (default: graveyard).
#  1. --verify: rebuild every model into a temp dir and compare bytes + manifest entries with public/ (exit 4 on diff)
#  2. two independent full builds into fresh --out dirs must be byte-identical to each other (GLBs + manifest)
# Usage: tools/blender/levels/check_repro.sh [level]   (BLENDER_PYTHON overrides the interpreter)
set -euo pipefail
LEVEL="${1:-graveyard}"
PY="${BLENDER_PYTHON:-/home/user/.venvs/blender/bin/python}"
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
B="$ROOT/tools/blender/levels/build_levels.py"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/al-lv-repro.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
echo "== verify $LEVEL against public/assets"
"$PY" "$B" --level "$LEVEL" --verify 2>&1 | grep -v CUEW | tail -3
echo "== two clean builds"
"$PY" "$B" --level "$LEVEL" --out "$TMP/a" 2>&1 | grep -v CUEW | tail -1
"$PY" "$B" --level "$LEVEL" --out "$TMP/b" 2>&1 | grep -v CUEW | tail -1
diff -r "$TMP/a/models" "$TMP/b/models"
cmp "$TMP/a/manifest.levels.json" "$TMP/b/manifest.levels.json"
diff -r "$TMP/a/models/levels/$LEVEL" "$ROOT/public/assets/models/levels/$LEVEL"
echo "OK: $LEVEL kit is byte-reproducible"
