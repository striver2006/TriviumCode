#!/bin/sh
# M11 第 11 步 AC-23 验收夹具：小型被审项目 + trivium init。
# 用法：sh build-fixture.sh <目标目录>（目标目录必须在本会话 scratchpad 下且尚不存在）
set -eu
T="$1"
case "$T" in
  /private/tmp/claude-501/*/scratchpad/*) ;;
  *) echo "refuse: target not under scratchpad: $T" >&2; exit 2 ;;
esac
[ -e "$T" ] && { echo "refuse: target exists: $T" >&2; exit 2; }
NODE=/opt/homebrew/opt/node/bin/node
TV="$HOME/.claude/skills/dual-critic/scripts/trivium.cjs"

mkdir -p "$T/src" "$T/test"
cd "$T"
cat >package.json <<'EOF'
{
  "name": "ac23-fixture",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test test/" }
}
EOF
cat >README.md <<'EOF'
# ac23-fixture

A tiny calculator module used as the review subject for an acceptance run.
`src/calc.js` exports `add` and `sub`; `test/calc.test.js` covers them.
EOF
cat >src/calc.js <<'EOF'
export function add(a, b) {
  return a + b;
}

export function sub(a, b) {
  return a - b;
}
EOF
cat >test/calc.test.js <<'EOF'
import test from 'node:test';
import assert from 'node:assert/strict';
import { add, sub } from '../src/calc.js';

test('add', function () {
  assert.equal(add(2, 3), 5);
});

test('sub', function () {
  assert.equal(sub(5, 3), 2);
});
EOF
git init -q -b main
git add package.json README.md src/calc.js test/calc.test.js
git -c user.name=BobChen -c user.email=k_bo@163.com commit -q -m "chore(fixture): calc baseline"

"$NODE" "$TV" init >init.log 2>&1 || { cat init.log; exit 1; }
cat init.log
git status --short
