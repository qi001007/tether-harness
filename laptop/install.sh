#!/usr/bin/env bash
# Fetch install-node.sh from the release or TETHER_ASSET_BASE and forward its arguments.
set -euo pipefail

ORIGIN="https://github.com/qi001007/tether-harness/releases/latest/download"
BASE="${TETHER_ASSET_BASE:-$ORIGIN}"
SCRIPT_NAME="install-node.sh"

say() { printf '[install] %s\n' "$*"; }
fail() { printf '[install] error: %s\n' "$*" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || fail "curl is required to fetch $SCRIPT_NAME"

workdir="$(mktemp -d 2>/dev/null || mktemp -d -t tether-install)"
trap 'rm -rf "$workdir"' EXIT

target="$workdir/$SCRIPT_NAME"
say "fetching $SCRIPT_NAME from $BASE"
# 先落盘再执行：不把未校验的字节直接喂给 shell。
curl -fsSL --retry 3 --retry-delay 2 -o "$target" "${BASE%/}/$SCRIPT_NAME" \
  || fail "could not fetch ${BASE%/}/$SCRIPT_NAME; set TETHER_ASSET_BASE to a reachable mirror"

[ -s "$target" ] || fail "$SCRIPT_NAME came back empty"
if [ -n "${TETHER_INSTALL_SHA256:-}" ]; then
  actual="$(sha256sum "$target" 2>/dev/null | cut -d' ' -f1 \
    || shasum -a 256 "$target" | cut -d' ' -f1)"
  [ "$actual" = "$TETHER_INSTALL_SHA256" ] || fail "sha256 mismatch: got $actual"
  say "sha256 verified"
fi

# install-node.sh 把 --base-url 当作「根下直接有 version.json 和 tether-node-<v>.zip
# 的镜像」，GitHub 的 latest/download 不满足这个形状。所以只有用户显式指了镜像才转发，
# 否则让 install-node.sh 用它自己的 GitHub 默认解析。
forward=()
if [ -n "${TETHER_ASSET_BASE:-}" ]; then
  forward=(--base-url "${BASE%/}")
fi

# 其余参数原样透传，包括 --archive/--version/--no-systemd/--install-only/--prefix，
# 以及用户自己给的 --base-url（argparse 后者覆盖前者，用户意图优先）。
bash "$target" "${forward[@]}" "$@"
