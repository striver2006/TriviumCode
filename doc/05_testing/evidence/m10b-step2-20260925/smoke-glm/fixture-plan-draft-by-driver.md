---
schema: trivium.plan.v1
topic: 冒烟主题
stage: plan
role: glm
kind: original
---

# 冒烟主题 · 计划原稿

## 背景与目标

`src/math.js` 目前只有 `add(a, b)`。本次补齐 `sub(a, b)`，并新增 `scripts/env-check.sh`
做环境自检。整体定位是流水线冒烟：改动小、可真实执行验证、留痕齐全。

## 变更清单

1. `src/math.js`：新增 `export function sub(a, b) { return a - b; }`，不动 `add`。
2. 新增 `scripts/env-check.sh`：
   - 首行 `#!/usr/bin/env bash`，第二行 `set -euo pipefail`；
   - 安装前缀写成 `PREFIX="$HOME/.smoke-fixture"`——it's 值得盯的一处：双引号里
     `$HOME` 会在运行期展开，这是刻意要的行为（跟随执行用户的家目录）；
   - `mkdir -p "$PREFIX"`，`echo ok` 后退出 0。
3. 验证：`node -e` 内联断言 `add(2,3)===5` 与 `sub(5,3)===2`；`bash scripts/env-check.sh`
   退出码为 0。

## 不做的事

- 不引入测试框架，`node -e` 内联断言足够。
- 不改 `.trivium/`、`AGENTS.md` 等流水线自身文件。

## 风险

- 唯一的语义敏感点是 `PREFIX` 那一行的引号选择：若审查认为应单引号（不展开），
  需先定夺语义再动。
