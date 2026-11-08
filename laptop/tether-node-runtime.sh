#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
BUNDLE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
PREFIX="${TETHER_NODE_PREFIX:-$HOME/.local/share/tether-node}"
ENV_FILE="${TETHER_NODE_ENV_FILE:-$PREFIX/node.env}"
SHOW_HELP=0
for arg in "$@"; do
  if [ "$arg" = "--help" ] || [ "$arg" = "-h" ]; then SHOW_HELP=1; fi
done

if [ -r "$ENV_FILE" ]; then
  set -a
  # node.env is written by install-node.sh with mode 600.
  . "$ENV_FILE"
  set +a
fi

RESOURCE_ROOT="$BUNDLE_ROOT/resources/tether-runtime"
SOURCE_ROOT="$BUNDLE_ROOT/tether-source"
PYTHON="$RESOURCE_ROOT/tether-python"
COMPONENTS="$RESOURCE_ROOT/components"
[ -x "$PYTHON" ] || { echo "bundled tether-python is missing: $PYTHON" >&2; exit 1; }
[ -d "$SOURCE_ROOT/tether/node" ] || { echo "bundled Tether Node sources are missing" >&2; exit 1; }

find_component() {
  local name="$1"
  local path
  path="$(find "$COMPONENTS/$name" \( -type f -o -type l \) -name "$2" -print -quit 2>/dev/null || true)"
  [ -n "$path" ] && [ -x "$path" ] || { echo "bundled component executable is missing: $name/$2" >&2; exit 1; }
  printf '%s\n' "$path"
}

export PYTHONPATH="$SOURCE_ROOT${PYTHONPATH:+:$PYTHONPATH}"
export TETHER_NODE_PREFIX="$PREFIX"
export TETHER_NODE_DATA_DIR="${TETHER_NODE_DATA_DIR:-$PREFIX}"
export TETHER_NODE_UPDATE_OWNER="${TETHER_NODE_UPDATE_OWNER:-bundle_installer}"
export TETHER_AGENTS_RUNTIME_DIR="$SOURCE_ROOT/tether/node/bin/agents-runtime"
export TETHER_HERDR_RUNTIME_DIR="$SOURCE_ROOT/tether/node/bin"
export TETHER_DSH_RUNTIME_DIR="$COMPONENTS/dsh"
export TETHER_NODEJS_EXE="$COMPONENTS/nodejs/bin/node"
export TETHER_MESHCENTRAL_ROOT="$COMPONENTS/meshcentral"
export TETHER_MESHAGENT_EXE="$(find "$COMPONENTS/meshagent/linux-x64" -type f -name 'meshagent_x86-64' -print -quit 2>/dev/null || true)"
export TETHER_SFTPGO_COMPONENT_DIR="$COMPONENTS/sftpgo"
export TETHER_CADDY="$(find_component caddy caddy)"
export TETHER_RCLONE="$(find_component rclone rclone)"
export TETHER_EASYTIER_CORE="$(find_component easytier easytier-core)"
export TETHER_EASYTIER_CLI="$(find_component easytier easytier-cli)"
export TETHER_SOFFICE_EXE="$COMPONENTS/libreoffice/opt/libreoffice26.8/program/soffice"
export TETHER_NATIVE_DSH_HOME="${TETHER_NATIVE_DSH_HOME:-$TETHER_NODE_DATA_DIR/dsh-home}"
export TETHER_AGENT_HOME="${TETHER_AGENT_HOME:-$TETHER_NODE_DATA_DIR/agents}"

if [ "$SHOW_HELP" != 1 ]; then
  [ -n "${TETHER_CONTROLLER:-}" ] || { echo "TETHER_CONTROLLER is missing; configure $ENV_FILE" >&2; exit 1; }
fi
[ -x "$TETHER_NODEJS_EXE" ] || { echo "bundled Node.js executable is missing" >&2; exit 1; }
[ -f "$TETHER_MESHCENTRAL_ROOT/meshcentral.js" ] || { echo "bundled MeshCentral package is missing" >&2; exit 1; }
[ -x "$TETHER_MESHAGENT_EXE" ] || { echo "bundled MeshAgent executable is missing" >&2; exit 1; }
[ -x "$TETHER_SOFFICE_EXE" ] || { echo "bundled LibreOffice executable is missing" >&2; exit 1; }

WORKSPACE="${TETHER_NODE_WORKSPACE:-$TETHER_NODE_DATA_DIR/workspace}"
WORKSPACES_ROOT="${TETHER_WORKSPACES_ROOT:-$TETHER_NODE_DATA_DIR/workspaces}"
DB="${TETHER_NODE_DB:-$TETHER_NODE_DATA_DIR/node.db}"
mkdir -p "$WORKSPACE" "$WORKSPACES_ROOT" "$TETHER_NODE_DATA_DIR"
exec "$PYTHON" -m tether.node.agent \
  --workspace "$WORKSPACE" --workspaces-root "$WORKSPACES_ROOT" \
  --agent "${TETHER_AGENT:-dsh}" --device "${TETHER_DEVICE:-$(hostname)}" \
  --controller "${TETHER_CONTROLLER:-}" --console-port "${TETHER_CONSOLE_PORT:-18894}" \
  --dsh-home "$TETHER_NATIVE_DSH_HOME" --db "$DB" "$@"
