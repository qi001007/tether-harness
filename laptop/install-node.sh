#!/usr/bin/env bash
# One-shot Tether Node installer for Linux and macOS.
set -euo pipefail

VERSION="${TETHER_NODE_VERSION:-latest}"
PREFIX="${TETHER_NODE_PREFIX:-$HOME/.local/share/tether-node}"
HUB_URL="${TETHER_HUB_URL:-https://8-220-198-26.sslip.io}"
CONTROLLER="${TETHER_CONTROLLER:-wss://8-220-198-26.sslip.io/ws/node}"
TOKEN="${TETHER_NODE_TOKEN:-}"
DEVICE="${TETHER_DEVICE:-$(hostname 2>/dev/null || echo tether-node)}"
CONSOLE_PORT="${TETHER_CONSOLE_PORT:-18894}"
ARCHIVE=""
RUNTIME_ARCHIVE=""
RUNTIME_SHA256=""
ROLLBACK=0
CHECK_ONLY=0
INSTALL_ONLY=0
USER_TOKEN="${TETHER_USER_TOKEN:-}"
SYSTEMD=0
NO_SYSTEMD=0
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
  --runtime-archive PATH Install a complete headless Linux runtime bundle
  --runtime-sha256 HEX  Required SHA-256 for --runtime-archive
  --rollback         Atomically switch to the previously installed runtime bundle
  --version VERSION  Release version when downloading (default: latest)
  --prefix PATH      Install root (default: ~/.local/share/tether-node)
  --user-token TOKEN One-time account token used for first enrollment
  --base-url URL     Release mirror base (default: GitHub releases)
  --systemd          Install as a systemd service (requires root)
  --no-systemd       Do not install a service, even when running as root
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
    --runtime-archive) RUNTIME_ARCHIVE="$2"; shift 2 ;;
    --runtime-sha256) RUNTIME_SHA256="$2"; shift 2 ;;
    --rollback) ROLLBACK=1; shift ;;
    --version) VERSION="$2"; shift 2 ;;
    --prefix) PREFIX="$2"; shift 2 ;;
    --user-token) USER_TOKEN="$2"; shift 2 ;;
    --base-url) BASE_URL="$2"; shift 2 ;;
    --systemd) SYSTEMD=1; shift ;;
    --no-systemd) NO_SYSTEMD=1; shift ;;
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

if [ "$SYSTEMD" = 0 ] && [ "$NO_SYSTEMD" = 0 ] && [ "$INSTALL_ONLY" != 1 ] && [ "$(id -u)" = 0 ] && [ "$(uname -s)" = "Linux" ]; then
  SYSTEMD=1
fi
if [ "$SYSTEMD" = 1 ]; then
  [ "$(id -u)" = 0 ] || fail "--systemd requires root"
  if [ -z "${TETHER_NODE_PREFIX:-}" ] && [ "$PREFIX" = "$HOME/.local/share/tether-node" ]; then
    PREFIX="/opt/tether-node"
  fi
fi
[ -n "$WORKSPACES_ROOT" ] || WORKSPACES_ROOT="$PREFIX/workspace"

if [ "$ROLLBACK" = 1 ]; then
  CURRENT="$PREFIX/current"
  PREVIOUS="$PREFIX/previous"
  [ -L "$CURRENT" ] && [ -L "$PREVIOUS" ] || fail "no previous runtime bundle is available under $PREFIX"
  CURRENT_TARGET="$(readlink "$CURRENT")"
  PREVIOUS_TARGET="$(readlink "$PREVIOUS")"
  [ -d "$PREFIX/$PREVIOUS_TARGET" ] || fail "previous runtime bundle is missing: $PREFIX/$PREVIOUS_TARGET"
  TEMP_LINK="$PREFIX/.current.rollback.$$"
  TEMP_PREVIOUS="$PREFIX/.previous.rollback.$$"
  ln -s "$PREVIOUS_TARGET" "$TEMP_LINK"
  ln -s "$CURRENT_TARGET" "$TEMP_PREVIOUS"
  mv -Tf "$TEMP_PREVIOUS" "$PREVIOUS"
  mv -Tf "$TEMP_LINK" "$CURRENT"
  if [ "$SYSTEMD" = 1 ]; then systemctl restart tether-node; fi
  say "runtime rolled back to: $PREVIOUS_TARGET"
  exit 0
fi

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
if [ -n "$ARCHIVE" ] && [ "$VERSION" = latest ]; then
  VERSION=$(basename "$ARCHIVE" | sed -n 's/^tether-node-\(.*\)\.zip$/\1/p')
  [ -n "$VERSION" ] || fail "could not derive version from archive name: $ARCHIVE"
fi
if [ "$VERSION" = latest ] && [ -z "$ARCHIVE" ] && [ -z "$RUNTIME_ARCHIVE" ]; then
  if [ -n "$BASE_URL" ]; then
    META_URL="${BASE_URL%/}/version.json"
    VERSION=$(curl -fsSL --retry 2 "$META_URL" | python3 -c 'import json,sys; node=json.load(sys.stdin)["components"]["node"]; print(node["version"] if isinstance(node,dict) else node)') \
      || fail "could not resolve latest node version from $META_URL"
  else
    META_URL="https://github.com/qi001007/tether-harness/releases/latest/download/tether-update.json"
    VERSION=$(curl -fsSL --retry 2 "$META_URL" | python3 -c 'import json,sys; print(json.load(sys.stdin)["components"]["node"]["version"])') \
      || fail "could not resolve latest node version from $META_URL"
  fi
  [ -n "$VERSION" ] && [ "$VERSION" != latest ] || fail "latest node version is empty"
  say "latest node version: $VERSION"
fi
[ -n "$ARCHIVE" ] || [ -n "$CONTROLLER" ] || fail "--controller is required (or set TETHER_CONTROLLER)"

RUNTIME_MODE=0
if [ -n "$RUNTIME_ARCHIVE" ]; then
  [ -z "$ARCHIVE" ] || fail "choose either --archive or --runtime-archive"
  [ -f "$RUNTIME_ARCHIVE" ] || fail "runtime archive not found: $RUNTIME_ARCHIVE"
  [[ "$RUNTIME_SHA256" =~ ^[0-9a-fA-F]{64}$ ]] || fail "--runtime-sha256 must be a 64-character SHA-256 digest"
  command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is required to verify the runtime bundle"
  ACTUAL_SHA256="$(sha256sum "$RUNTIME_ARCHIVE" | awk '{print $1}')"
  [ "${ACTUAL_SHA256,,}" = "${RUNTIME_SHA256,,}" ] || fail "runtime archive SHA-256 does not match"
  [ "$(uname -s)" = "Linux" ] || fail "the bundled runtime archive is Linux-only"
  mkdir -p "$PREFIX/releases"
  VERSION="$(python3 - "$RUNTIME_ARCHIVE" "$PREFIX/releases" <<'PY'
import json
import os
import posixpath
import re
import shutil
import sys
import tarfile
from pathlib import Path, PurePosixPath

archive = Path(sys.argv[1])
releases = Path(sys.argv[2]).resolve()
expected_top = "tether-node-runtime-"
with tarfile.open(archive, "r:gz") as bundle:
    members = bundle.getmembers()
    if not members:
        raise SystemExit("runtime archive is empty")
    top = members[0].name.split("/", 1)[0]
    if not top.startswith(expected_top):
        raise SystemExit("runtime archive has an unexpected top-level directory")
    manifest_member = bundle.getmember(top + "/runtime-manifest.json")
    if not manifest_member.isfile():
        raise SystemExit("runtime manifest is not a regular file")
    manifest_file = bundle.extractfile(manifest_member)
    if manifest_file is None:
        raise SystemExit("runtime manifest is not a regular file")
    manifest = json.load(manifest_file)
    version = manifest.get("version")
    if (manifest.get("schema") != 1 or manifest.get("platform") != "linux-x64"
            or manifest.get("entry") != "bin/tether-node"
            or manifest.get("python") != "resources/tether-runtime/tether-python"
            or not isinstance(version, str) or not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version)
            or top != "tether-node-runtime-" + version):
        raise SystemExit("runtime manifest is invalid or does not match this platform")
    target = releases / version
    if target.exists():
        raise SystemExit("runtime version already exists; refusing to replace it")
    staged = releases / (".installing-" + version + "-" + str(os.getpid()))
    if staged.exists():
        raise SystemExit("runtime staging path already exists")
    staged.mkdir(mode=0o700)
    normalized = []
    for member in members:
        name = member.name.rstrip("/")
        parts = PurePosixPath(name).parts
        if (not name or name.startswith("/") or "\\" in name or not parts
                or parts[0] != top or any(part in ("", ".", "..") for part in parts)):
            raise SystemExit("runtime archive contains an unsafe path")
        if not (member.isdir() or member.isfile() or member.issym() or member.islnk()):
            raise SystemExit("runtime archive contains an unsupported file type")
        if member.issym() or member.islnk():
            link = member.linkname
            base = posixpath.dirname(name) if member.issym() else ""
            resolved = posixpath.normpath(posixpath.join(base, link))
            if (link.startswith("/") or "\\" in link
                    or not (resolved == top or resolved.startswith(top + "/"))):
                raise SystemExit("runtime archive contains an unsafe link")
        normalized.append((member, Path(*parts[1:])))
    root = staged / top
    root.mkdir()
    for member, relative in normalized:
        if not relative.parts:
            continue
        destination = root.joinpath(*relative.parts)
        if member.isdir():
            destination.mkdir(parents=True, exist_ok=True)
        elif member.isfile():
            destination.parent.mkdir(parents=True, exist_ok=True)
            source = bundle.extractfile(member)
            if source is None:
                raise SystemExit("runtime archive contains an unreadable file")
            with source, destination.open("wb") as output:
                shutil.copyfileobj(source, output)
            destination.chmod(0o755 if member.mode & 0o111 else 0o644)
    for member, relative in normalized:
        if not (member.issym() or member.islnk()) or not relative.parts:
            continue
        destination = root.joinpath(*relative.parts)
        destination.parent.mkdir(parents=True, exist_ok=True)
        if member.issym():
            destination.symlink_to(member.linkname)
        else:
            source = root.joinpath(*PurePosixPath(member.linkname).parts)
            if not source.is_file():
                raise SystemExit("runtime hard link target is not a regular file")
            os.link(source, destination)
    required = [
        root / "bin/tether-node", root / "resources/tether-runtime/tether-python",
        root / "tether-source/tether/node/agent.py", root / "resources/tether-runtime/components/caddy",
        root / "resources/tether-runtime/components/easytier", root / "resources/tether-runtime/components/rclone",
        root / "resources/tether-runtime/components/sftpgo", root / "resources/tether-runtime/components/dsh",
    ]
    if any(not path.exists() for path in required):
        raise SystemExit("runtime archive is missing required Node or native components")
    (root / "bin/tether-node").chmod(0o755)
    (root / "resources/tether-runtime/tether-python").chmod(0o755)
    os.replace(root, target)
    staged.rmdir()
    print(version)
PY
)" || fail "could not verify or safely unpack the runtime bundle"
  ROOT="$PREFIX/releases/$VERSION"
  TETHER_NODE_PREFIX="$PREFIX" TETHER_NODE_DATA_DIR="$PREFIX" \
    TETHER_CONTROLLER="${CONTROLLER:-ws://127.0.0.1:1/ws/node}" \
    "$ROOT/bin/tether-node" --help >/dev/null 2>&1 \
    || fail "runtime bundle failed its isolated Node --help check; current runtime was not switched"
  CURRENT="$PREFIX/current"
  PREVIOUS="$PREFIX/previous"
  if [ -L "$CURRENT" ]; then
    OLD_TARGET="$(readlink "$CURRENT")"
    TEMP_PREVIOUS="$PREFIX/.previous.new.$$"
    ln -s "$OLD_TARGET" "$TEMP_PREVIOUS"
    mv -Tf "$TEMP_PREVIOUS" "$PREVIOUS"
  fi
  TEMP_CURRENT="$PREFIX/.current.new.$$"
  ln -s "releases/$VERSION" "$TEMP_CURRENT"
  mv -Tf "$TEMP_CURRENT" "$CURRENT"
  RUNTIME_MODE=1
else
  [ -z "$RUNTIME_SHA256" ] || fail "--runtime-sha256 requires --runtime-archive"
fi

mkdir -p "$PREFIX" "$HOME/.local/bin"
if [ "$RUNTIME_MODE" != 1 ]; then
  ZIP="$ARCHIVE"
  if [ -z "$ZIP" ]; then
    ZIP="$PREFIX/tether-node-$VERSION.zip"
    if [ -n "$BASE_URL" ]; then
      ASSET_URL="${BASE_URL%/}/tether-node-$VERSION.zip"
    else
      ASSET_URL="https://github.com/qi001007/tether-harness/releases/download/v$VERSION/tether-node-$VERSION.zip"
    fi
    say "downloading tether-node $VERSION from $ASSET_URL ..."
    DOWNLOAD_TMP=$(mktemp "${ZIP}.tmp.XXXXXX") || fail "could not create temporary archive beside $ZIP"
    trap 'if [ -n "${DOWNLOAD_TMP:-}" ]; then rm -f "$DOWNLOAD_TMP"; fi' EXIT
    DOWNLOAD_OK=0
    for ATTEMPT in 1 2 3; do
      if curl -fL -o "$DOWNLOAD_TMP" "$ASSET_URL"; then
        if python3 -m zipfile -t "$DOWNLOAD_TMP" >/dev/null 2>&1; then
          mv -f "$DOWNLOAD_TMP" "$ZIP" || fail "could not promote downloaded archive to $ZIP"
          DOWNLOAD_TMP=""
          DOWNLOAD_OK=1
          break
        fi
        say "download attempt $ATTEMPT/3 returned an invalid ZIP"
      else
        CURL_STATUS=$?
        say "download attempt $ATTEMPT/3 failed (curl exit $CURL_STATUS)"
        case "$CURL_STATUS" in
          18|56) ;;
          *) fail "download request failed (curl exit $CURL_STATUS): $ASSET_URL" ;;
        esac
      fi
      if [ "$ATTEMPT" -lt 3 ]; then sleep 1; fi
    done
    [ "$DOWNLOAD_OK" = 1 ] || fail "could not download a complete valid archive after 3 attempts: $ASSET_URL"
    trap - EXIT
  fi
  [ -f "$ZIP" ] || fail "archive not found: $ZIP"

  say "extracting..."
  python3 -m zipfile -e "$ZIP" "$PREFIX"
  ROOT="$PREFIX/tether-node-$VERSION"
  [ -f "$ROOT/pyproject.toml" ] || fail "unexpected archive layout: $ROOT/pyproject.toml is missing"
fi

if [ -z "$USER_TOKEN" ] && [ "$INSTALL_ONLY" != 1 ]; then
  if [ -r /dev/tty ]; then
    exec 3</dev/tty
    printf 'Tether 账号邮箱: ' >&2
    IFS= read -r EMAIL <&3
    printf '密码: ' >&2
    IFS= read -rs PASSWORD <&3
    printf '\n' >&2
    exec 3<&-
    [ -n "$EMAIL" ] && [ -n "$PASSWORD" ] || fail "邮箱或密码为空"
    USER_TOKEN=$(TETHER_EMAIL="$EMAIL" TETHER_PASSWORD="$PASSWORD" python3 - "$HUB_URL" <<'PY'
import json
import os
import sys
import urllib.request

url = sys.argv[1].rstrip('/') + '/api/auth/login'
body = json.dumps({'email': os.environ.get('TETHER_EMAIL', ''),
                   'password': os.environ.get('TETHER_PASSWORD', '')}).encode()
request = urllib.request.Request(url, data=body, headers={'Content-Type': 'application/json'})
try:
    with urllib.request.urlopen(request, timeout=30) as response:
        print(json.load(response).get('token', ''))
except Exception as error:
    print(str(error), file=sys.stderr)
PY
    ) || fail "登录失败：请检查账号密码或网络"
    [ -n "$USER_TOKEN" ] || fail "登录失败：没有拿到账号令牌"
    say "登录成功，正在注册设备…"
  else
    fail "非交互安装需要设置 TETHER_USER_TOKEN（一次性登录令牌）"
  fi
fi

if [ "$RUNTIME_MODE" != 1 ]; then
  say "creating venv and installing dependencies..."
  python3 -m venv "$PREFIX/venv"
  VENV_PY="$PREFIX/venv/bin/python"
  [ -x "$VENV_PY" ] || VENV_PY="$PREFIX/venv/Scripts/python.exe"
  [ -x "$VENV_PY" ] || fail "venv python not found under $PREFIX/venv"
  "$VENV_PY" -m pip install --upgrade pip >/dev/null
  "$VENV_PY" -m pip install -e "$ROOT"
fi

mkdir -p "$PREFIX/workspace"
ENV_FILE="$PREFIX/node.env"
if [ "$RUNTIME_MODE" = 1 ] && [ -f "$ENV_FILE" ]; then
  say "preserving existing Node identity and settings in $ENV_FILE"
else
  umask 077
  {
    printf 'TETHER_NODE_PREFIX=%s\n' "$PREFIX"
    printf 'TETHER_NODE_DATA_DIR=%s\n' "$PREFIX"
    printf 'TETHER_NODE_UPDATE_OWNER=%s\n' "$([ "$RUNTIME_MODE" = 1 ] && printf bundle_installer || printf node)"
    printf 'TETHER_CONTROLLER=%s\n' "$CONTROLLER"
    printf 'TETHER_NODE_TOKEN=%s\n' "$TOKEN"
    printf 'TETHER_DEVICE=%s\n' "$DEVICE"
    printf 'TETHER_CONSOLE_PORT=%s\n' "$CONSOLE_PORT"
    printf 'TETHER_AGENT=%s\n' "$AGENT"
    printf 'TETHER_WORKSPACES_ROOT=%s\n' "$WORKSPACES_ROOT"
    if [ -n "$USER_TOKEN" ]; then printf 'TETHER_USER_TOKEN=%s\n' "$USER_TOKEN"; fi
  } > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
fi

LAUNCHER="$PREFIX/tether-node"
if [ "$RUNTIME_MODE" = 1 ]; then
  cat > "$LAUNCHER" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export TETHER_NODE_PREFIX="$PREFIX"
export TETHER_NODE_DATA_DIR="$PREFIX"
export TETHER_NODE_ENV_FILE="$ENV_FILE"
exec "$PREFIX/current/bin/tether-node" "\$@"
EOF
else
  cat > "$LAUNCHER" <<EOF
#!/usr/bin/env bash
set -euo pipefail
. "$ENV_FILE"
exec "$VENV_PY" -m tether.node.agent \\
  --workspace "$PREFIX/workspace" --workspaces-root "\${TETHER_WORKSPACES_ROOT:-$PREFIX/workspace}" \\
  --agent "\${TETHER_AGENT}" --device "\${TETHER_DEVICE}" --controller "\${TETHER_CONTROLLER}" \\
  --console-port "\${TETHER_CONSOLE_PORT}" --db "$PREFIX/node.db"
EOF
fi
chmod +x "$LAUNCHER"
ln -sf "$LAUNCHER" "$HOME/.local/bin/tether-node"

say "installed: $LAUNCHER"
say "env:       $ENV_FILE (mode 600)"
if [ "$RUNTIME_MODE" = 1 ]; then
  say "runtime:   $PREFIX/current -> releases/$VERSION"
  say "rollback:  sudo bash laptop/install-node.sh --prefix $PREFIX --rollback --systemd"
fi
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
  if [ -n "$USER_TOKEN" ]; then
    for _ in $(seq 1 30); do
      [ -f "$PREFIX/device-token.json" ] && break
      sleep 1
    done
    if [ -f "$PREFIX/device-token.json" ]; then
      sed -i '/^TETHER_USER_TOKEN=/d' "$ENV_FILE"
      systemctl restart tether-node
      sleep 2
      say "enrolled:  device token saved; one-time login token removed"
    else
      say "warning: device token not saved yet; see: journalctl -u tether-node -n 50"
    fi
  fi
  say "done:      device $DEVICE is installed and running"
  say "manage:    systemctl status tether-node"
  exit 0
fi
if [ "$INSTALL_ONLY" = 1 ]; then
  say "install-only requested; start later with: $LAUNCHER"
else
  say "starting Tether Node..."
  exec "$LAUNCHER"
fi
