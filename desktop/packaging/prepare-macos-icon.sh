#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
icon_source="$repo_root/assets/tether-app-s.png"
iconset="$repo_root/.runtime/desktop-candidate/tether-app.iconset"
icon_output="$repo_root/.runtime/desktop-candidate/tether-app.icns"

mkdir -p "$iconset"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$icon_source" --out "$iconset/icon_${size}x${size}.png" >/dev/null
  doubled=$((size * 2))
  sips -z "$doubled" "$doubled" "$icon_source" --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$iconset" -o "$icon_output"
