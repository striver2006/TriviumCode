#!/bin/sh
# M9 第 6 步验收夹具：可重复重建。
# 用法：sh build-fixture.sh <目标目录>
# 被审对象 = 本仓历史提交 3812f4c（作者 BobChen，2026-09-16 00:22:24 +0800）的 src/ + test/ 差异，
# 重放在其父提交 a8c7595 的工作树上；.reviews/ 与 .trivium/ 不导出，由 init 重新生成。
set -eu
SRC=/Users/chenzhenbo/Work/TriviumCode
T="$1"
BASE=a8c75954c38941c20259f6bc4c1127c0cffeed83
SUBJ=3812f4cf493a82d2a7c3386e6a721682f157ed49
NODE=/opt/homebrew/opt/node/bin/node
TV="$HOME/.claude/skills/dual-critic/scripts/trivium.cjs"

rm -rf "$T"
mkdir -p "$T"
git -C "$SRC" archive "$BASE" -- . ':!.reviews' ':!.trivium' | tar -x -C "$T"
cd "$T"
git init -q -b main
for f in $(ls -A); do [ "$f" = .git ] || git add -- "$f"; done
git -c user.name=BobChen -c user.email=k_bo@163.com commit -q -m "chore(fixture): baseline = parent tree of $SUBJ ($BASE)"

"$NODE" "$TV" init >init.log 2>&1 || { cat init.log; exit 1; }
# code 阶段超时对齐本仓（默认 1200s；M9 第 1～2 步的 codex 侧曾跑到 118m）
sed -i '' 's/^    code: 1200$/    code: 7200/' .trivium/config.yaml
git status --porcelain | awk '{print $2}' | while read -r p; do git add -- "$p"; done
git -c user.name=BobChen -c user.email=k_bo@163.com commit -q -m "chore(fixture): trivium init"

git -C "$SRC" diff "$BASE" "$SUBJ" -- src test | git apply
echo "== subject diff applied; git status:"
git status --short
echo "== diffstat vs HEAD:"
git diff --stat HEAD | tail -1
