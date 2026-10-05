#!/bin/sh
# 改前对照（计划 r2 §4.2）：在 b5f52ca 源码树上叠加本题新测试文件，只跑它。
# 预期 H1～H3 红在「调用返回后 10 秒子进程仍未退出」，H4 / H5 绿。
# 用法：sh before-fix.sh <工作目录的父目录>（放在会话 scratchpad 里；本脚本不删任何东西）
set -eu
REPO=$(cd "$(dirname "$0")/../../../.." && pwd)
PARENT=$1
WORK=$(mktemp -d "$PARENT/hdr-before-XXXXXX")
git -C "$REPO" archive b5f52ca | tar -x -C "$WORK"
ln -s "$REPO/node_modules" "$WORK/node_modules"
cp "$REPO/test/unit/codex-header-drain.test.ts" "$WORK/test/unit/"
cd "$WORK"
node scripts/build.mjs --with-tests > build.log 2>&1
echo "work=$WORK"
node --test dist/test/test/unit/codex-header-drain.test.js 2>&1 || echo "node-test-exit=$?"
