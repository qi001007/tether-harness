#!/usr/bin/env bash
# Deploy the Hub from origin/main with a health gate.
# Preserves .env, the database, SSH keys and Caddy state. No reset/hard checkout.
set -euo pipefail

APP=/opt/tether/app
cd "$APP"

PREV=$(git rev-parse HEAD)
git fetch origin main
TARGET=$(git rev-parse origin/main)
if [ "$PREV" = "$TARGET" ]; then
  echo "[deploy] already at $TARGET"
else
  echo "[deploy] fast-forward $PREV -> $TARGET"
  git merge --ff-only "$TARGET"
fi

/opt/tether/app/.venv/bin/pip install -q -e .
systemctl restart tether-surface-mux
systemctl restart tether-hub

for i in $(seq 1 40); do
  if /opt/tether/app/.venv/bin/python - <<'PY'
import os, urllib.request
from pathlib import Path
try:
    token = ''
for line in Path('.env').read_text(encoding='utf-8').splitlines():
    if line.startswith('TETHER_ACCESS_TOKEN='):
        token = line.split('=', 1)[1].strip().strip('"').strip("'")
    if not token:
        raise SystemExit(1)
    req = urllib.request.Request('http://127.0.0.1:18890/api/state',
                                 headers={'Authorization': 'Bearer ' + token})
    with urllib.request.urlopen(req, timeout=3) as response:
        raise SystemExit(0 if response.status == 200 else 1)
except Exception:
    raise SystemExit(1)
PY
  then
    break
  fi
  sleep 1
done

if ! curl -fsS -m 3 http://127.0.0.1:18990/healthz >/dev/null; then
  echo "[deploy] FAILED: surface mux health check"
  echo "[deploy] previous commit: $PREV"
  exit 1
fi

echo "[deploy] health OK at $(git rev-parse --short HEAD)"
echo "[deploy] run: .venv/bin/python scripts/smoke_hub_surface.py"