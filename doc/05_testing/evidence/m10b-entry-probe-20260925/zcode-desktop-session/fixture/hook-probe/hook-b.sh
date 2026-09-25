#!/bin/bash
# M10b 第 1 步 zcode Hook 实测：matcher 为 "Edit|Write" 的一条（B）。只记录、一律放行。
# 用来看 ApplyPatch 会不会触发名为 Edit|Write 的 matcher（静态读到 ApplyPatch 的匹配别名是 Write、Edit）。
here="$(cd "$(dirname "$0")" && pwd)"
log="$here/log"
mkdir -p "$log"
stamp="$(date +%Y%m%dT%H%M%S)-$$"
cat > "$log/B-$stamp.json"
exit 0
