#!/bin/sh
# AC-23 单次真实审查：sh run-one.sh <名称> <critic> [旗标…]
# 名称即主题后缀（主题 = ac23-<名称>），输出全部落在 $SP/out/<名称>/。
set -u
SP=/private/tmp/claude-501/-Users-chenzhenbo-Work-TriviumCode/d8a869f3-11f6-4327-a7a1-61c9337e76d1/scratchpad/ac23
NAME="$1"; CRITIC="$2"; shift 2
TOPIC="ac23-$NAME"
O="$SP/out/$NAME"
[ -e "$O" ] && { echo "refuse: $O exists (would mean a re-run; ask the user first)"; exit 2; }
mkdir -p "$O"
cd "$SP/fx" || exit 2
TV=./.trivium/bin/trivium
PLAN=".reviews/$TOPIC/plan/2026-10-08-$TOPIC-claude.md"
FOCUS='重点看除零处理的错误类型与两条新用例是否足以覆盖计划所述行为（AC-23 验收样本）'
echo "flags: --critics $CRITIC $*" >"$O/flags.txt"

$TV preflight --stage plan --driver claude --critics "$CRITIC" "$@" --json >"$O/preflight.json" 2>"$O/preflight.stderr"
pf=$?
echo "preflight exit=$pf"
[ "$pf" = 0 ] || { cat "$O/preflight.json" "$O/preflight.stderr"; exit 3; }

$TV review --start --entry B --stage plan --topic "$TOPIC" --driver claude --focus "$FOCUS" \
  --plan-file "$PLAN" --critics "$CRITIC" "$@" --json >"$O/start.json" 2>"$O/start.stderr"
st=$?
echo "start exit=$st"
[ "$st" = 0 ] || { cat "$O/start.json" "$O/start.stderr"; exit 4; }
RUN=$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(j.run_id||""))' "$O/start.json")
echo "run_id=$RUN"
echo "$RUN" >"$O/run_id.txt"
[ -n "$RUN" ] || exit 5

# 审查进行中采样厂商子进程参数（codex exec / agy），去重记录
(
  while [ ! -e "$O/.done" ]; do
    ps -ax -o pid,ppid,args | grep -E '[c]odex exec|[/ ]agy ' | grep -v grep >"$O/.ps-now" 2>/dev/null
    if [ -s "$O/.ps-now" ]; then
      while IFS= read -r line; do
        grep -qxF -- "$line" "$O/ps-seen.txt" 2>/dev/null || { echo "$line" >>"$O/ps-seen.txt"; echo "$(date -u +%H:%M:%SZ) $line" >>"$O/ps.txt"; }
      done <"$O/.ps-now"
    fi
    sleep 3
  done
) &
SAMPLER=$!

n=0
while :; do
  n=$((n+1))
  $TV review --wait "$RUN" --timeout 180 --json >"$O/wait-$n.json" 2>"$O/wait-$n.stderr"
  w=$?
  echo "wait#$n exit=$w"
  [ "$w" = 73 ] || break
  [ "$n" -ge 30 ] && { echo "max waits reached"; break; }
done
touch "$O/.done"
wait "$SAMPLER" 2>/dev/null
echo "final wait exit=$w"
$TV report --topic "$TOPIC" >"$O/report.txt" 2>&1
echo "report exit=$?"
