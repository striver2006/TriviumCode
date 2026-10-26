#!/usr/bin/env bash
# 在 Git Bash 中用原生 Node 调原生 CLI；不经 bash 执行厂商入口。
set -u
if [ "$#" -ne 3 ]; then
  echo '用法：bash git-bash.sh /c/路径/kimi.exe /c/路径/qoderclicn.exe /c/证据目录' >&2
  exit 64
fi
task_script_dir=$(cd -- "$(dirname -- "$0")" && pwd)
task_failed=0
for task_agent in kimi qoder-cn; do
  if [ "$task_agent" = kimi ]; then task_bin=$1; else task_bin=$2; fi
  task_native_bin=$(cygpath -w -- "$task_bin") || exit 1
  task_native_out=$(cygpath -w -- "$3") || exit 1
  task_native_script=$(cygpath -w -- "$task_script_dir/probe.mjs") || exit 1
  for task_arm in open deny tools failure cancel; do
    MSYS_NO_PATHCONV=1 node "$task_native_script" --agent "$task_agent" --bin "$task_native_bin" --case "$task_arm" --output "$task_native_out" || task_failed=1
  done
done
echo '采集结束；零退出不代表通过或准入，须回传 JSON 逐项核验。'
exit "$task_failed"
