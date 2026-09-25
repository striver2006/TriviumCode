#!/bin/bash
# M10b 第 1 步 zcode Hook 实测：不带 matcher 的一条（A）。
# 记下 stdin 负载与环境变量名；目标含 DENYME 就 exit 2，含 SLOWME 就挂起 20 秒（Hook 超时设 5 秒）。
# 只写本夹具目录下的 hook-probe/log/。
here="$(cd "$(dirname "$0")" && pwd)"
log="$here/log"
mkdir -p "$log"
stamp="$(date +%Y%m%dT%H%M%S)-$$"
payload="$(cat)"
printf '%s' "$payload" > "$log/A-$stamp.json"
{
  echo "tag=A time=$(date -u +%FT%TZ)"
  echo "--- env names"
  env | cut -d= -f1 | sort
  echo "--- session/project vars"
  env | grep -E '^(ZCODE|CLAUDE)[A-Z_]*(SESSION|PROJECT)[A-Z_]*=' || true
} > "$log/A-$stamp.env.txt"
if printf '%s' "$payload" | grep -q 'DENYME'; then
  echo "probe-deny: blocked by M10b hook A" >&2
  echo "decision=exit2" >> "$log/A-$stamp.env.txt"
  exit 2
fi
if printf '%s' "$payload" | grep -q 'SLOWME'; then
  echo "decision=sleep20" >> "$log/A-$stamp.env.txt"
  sleep 20
  echo "decision=woke" >> "$log/A-$stamp.env.txt"
  exit 0
fi
echo "decision=exit0" >> "$log/A-$stamp.env.txt"
exit 0
