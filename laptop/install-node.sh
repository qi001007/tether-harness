#!/usr/bin/env bash
# One-shot Tether Node installer for Linux and macOS.
set -euo pipefail

VERSION="${TETHER_NODE_VERSION:-0.3.5}"
PREFIX="${TETHER_NODE_PREFIX:-$HOME/.local/share/tether-node}"
CONTROLLER="${TETHER_CONTROLLER:-}"
TOKEN="${TETHER_NODE_TOKEN:-}"
DEVICE="${TETHER_DEVICE:-$(hostname 2>/dev/null || echo tether-node)}"
CONSOLE_PORT="${TETHER_CONSOLE_PORT:-18894}"
ARCHIVE=""
CHECK_ONLY=0
INSTALL_ONLY=0
USER_TOKEN="${TETHER_USER_TOKEN:-}"
SYSTEMD=0
BASE_URL="${TETHER_ASSET_BASE:-}"
ALLOWED_ROOTS="${TETHER_ALLOWED_ROOTS:-}"
WORKSPACES_ROOT="${TETHER_WORKSPACES_ROOT:-}"
AGENT="${TETHER_AGENT:-dsh}"

usage() {
  cat <<'EOF'
Usage: install-node.sh [options]
  --controller URL   Hub WebSocket URL, for example wss://host/ws/node
  --token TOKEN      Node enrollment token
  --device NAME      Device id (default: hostname)
  --port PORT        Local console port (default: 18894)
  --archive PATH     Install from a local tether-node ZIP
  --version VERSION  Release version when downloading (default: 0.3.4)
  --prefix PATH      Install root (default: ~/.local/share/tether-node)
  --user-token TOKEN One-time account token used for first enrollment
  --base-url URL     Release mirror base (default: GitHub releases)
  --systemd          Install as a systemd service (requires root)
  --workspaces-root  Root for remote projects (default: PREFIX/workspace)
  --allowed-roots    Comma-separated writable roots for the file API
  --check            Check prerequisites only; do not install
  --install-only     Install and create the launcher, but do not start
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --controller) CONTROLLER="$2"; shift 2 ;;
    --token) TOKEN="$2"; shift 2 ;;
    --device) DEVICE="$2"; shift 2 ;;
    --port) CONSOLE_PORT="$2"; shift 2 ;;
    --archive) ARCHIVE="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    --prefix) PREFIX="$2"; shift 2 ;;
    --user-token) USER_TOKEN="$2"; shift 2 ;;
    --base-url) BASE_URL="$2"; shift 2 ;;
    --systemd) SYSTEMD=1; shift ;;
    --workspaces-root) WORKSPACES_ROOT="$2"; shift 2 ;;
    --allowed-roots) ALLOWED_ROOTS="$2"; shift 2 ;;
    --check) CHECK_ONLY=1; shift ;;
    --install-only) INSTALL_ONLY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

say() { printf '%s\n' "$*"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

if [ "$SYSTEMD" = 1 ]; then
  [ "$(id -u)" = 0 ] || fail "--systemd requires root"
  if [ -z "${TETHER_NODE_PREFIX:-}" ] && [ "$PREFIX" = "$HOME/.local/share/tether-node" ]; then
    PREFIX="/opt/tether-node"
  fi
fi
[ -n "$WORKSPACES_ROOT" ] || WORKSPACES_ROOT="$PREFIX/workspace"

command -v python3 >/dev/null 2>&1 || fail "python3 is required"
python3 - <<'PY' || exit 1
import sys
if sys.version_info < (3, 10):
    raise SystemExit("Tether Node requires Python 3.10 or newer; found " + sys.version.split()[0])
print("python " + sys.version.split()[0])
PY

if [ "$CHECK_ONLY" = 1 ]; then
  command -v curl >/dev/null 2>&1 || say "warning: curl is missing (needed only for --archive-free install)"
  python3 -m venv --help >/dev/null 2>&1 || say "warning: python3-venv is missing (install python3-venv)"
  say "check passed; install target: $PREFIX"
  exit 0
fi

command -v curl >/dev/null 2>&1 || { [ -n "$ARCHIVE" ] || fail "curl is required"; }
[ -n "$ARCHIVE" ] || [ -n "$CONTROLLER" ] || fail "--controller is required (or set TETHER_CONTROLLER)"
[ -n "$ARCHIVE" ] || [ -n "$TOKEN" ] || fail "--token is required (or set TETHER_NODE_TOKEN)"

mkdir -p "$PREFIX" "$HOME/.local/bin"
ZIP="$ARCHIVE"
if [ -z "$ZIP" ]; then
  ZIP="$PREFIX/tether-node-$VERSION.zip"
  if [ -n "$BASE_URL" ]; then
    ASSET_URL="${BASE_URL%/}/tether-node-$VERSION.zip"
  else
    ASSET_URL="https://github.com/qi001007/tether-harness/releases/download/v$VERSION/tether-node-$VERSION.zip"
  fi
  say "downloading tether-node $VERSION from $ASSET_URL ..."
  curl -fL --retry 2 -o "$ZIP" "$ASSET_URL"
fi
[ -f "$ZIP" ] || fail "archive not found: $ZIP"

say "extracting..."
python3 -m zipfile -e "$ZIP" "$PREFIX"
ROOT="$PREFIX/tether-node-$VERSION"
[ -f "$ROOT/pyproject.toml" ] || fail "unexpected archive layout: $ROOT/pyproject.toml is missing"

say "creating venv and installing dependencies..."
python3 -m venv "$PREFIX/venv"
"$PREFIX/venv/bin/python" -m pip install --upgrade pip >/dev/null
"$PREFIX/venv/bin/python" -m pip install -e "$ROOT"

mkdir -p "$PREFIX/workspace"
ENV_FILE="$PREFIX/node.env"
umask 077
{
  printf 'TETHER_CONTROLLER=%s\n' "$CONTROLLER"
  printf 'TETHER_NODE_TOKEN=%s\n' "$TOKEN"
  printf 'TETHER_DEVICE=%s\n' "$DEVICE"
  printf 'TETHER_CONSOLE_PORT=%s\n' "$CONSOLE_PORT"
  printf 'TETHER_AGENT=%s\n' "$AGENT"
  printf 'TETHER_WORKSPACES_ROOT=%s\n' "$WORKSPACES_ROOT"
  if [ -n "$USER_TOKEN" ]; then printf 'TETHER_USER_TOKEN=%s\n' "$USER_TOKEN"; fi
} > "$ENV_FILE"
chmod 600 "$ENV_FILE"

LAUNCHER="$PREFIX/tether-node"
cat > "$LAUNCHER" <<EOF
#!/usr/bin/env bash
set -euo pipefail
. "$ENV_FILE"
exec "$PREFIX/venv/bin/python" -m tether.node.agent \\
  --workspace "$PREFIX/workspace" --workspaces-root "\${TETHER_WORKSPACES_ROOT:-$PREFIX/workspace}" \\
  --agent "\${TETHER_AGENT}" --device "\${TETHER_DEVICE}" --controller "\${TETHER_CONTROLLER}" \\
  --console-port "\${TETHER_CONSOLE_PORT}" --db "$PREFIX/node.db"
EOF
chmod +x "$LAUNCHER"
ln -sf "$LAUNCHER" "$HOME/.local/bin/tether-node"

say "installed: $LAUNCHER"
say "env:       $ENV_FILE (mode 600)"
if [ "$SYSTEMD" = 1 ]; then
  mkdir -p "$WORKSPACES_ROOT"
  if [ ! -f "$PREFIX/policy.json" ]; then
    python3 - "$ALLOWED_ROOTS" "$WORKSPACES_ROOT" "$PREFIX/workspace" "$PREFIX/policy.json" <<'PY'
import json
import sys
extra = [part.strip() for part in sys.argv[1].split(',') if part.strip()]
roots = list(dict.fromkeys([sys.argv[2], sys.argv[3], *extra]))
with open(sys.argv[4], 'w', encoding='utf-8') as handle:
    json.dump({'mode': 'full', 'allowed_roots': roots}, handle, ensure_ascii=False)
PY
    chmod 600 "$PREFIX/policy.json"
  fi
  cat > /etc/systemd/system/tether-node.service <<EOF
[Unit]
Description=Tether Node (remote maintenance)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$PREFIX
EnvironmentFile=$ENV_FILE
ExecStart=$LAUNCHER
Restart=always
RestartSec=3
MemoryHigh=220M
MemoryMax=384M
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable tether-node >/dev/null 2>&1
  systemctl restart tether-node
  sleep 3
  systemctl is-active --quiet tether-node || fail "tether-node did not stay active"
  say "systemd:   tether-node active"
  exit 0
fi
if [ "$INSTALL_ONLY" = 1 ]; then
  say "install-only requested; start later with: $LAUNCHER"
else
  say "starting Tether Node..."
  exec "$LAUNCHER"
fi
