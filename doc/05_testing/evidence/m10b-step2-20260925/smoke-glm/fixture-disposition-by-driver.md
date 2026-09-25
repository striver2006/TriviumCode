---
schema: trivium.disposition.v1
topic: 冒烟主题
stage: plan
role: glm
kind: revised
run_id: 20260925T053433Z
addresses:
  - 2026-09-25-冒烟主题-codex.md
  - 2026-09-25-冒烟主题-gemini.md
---

# 冒烟主题 · plan 阶段裁决与修订计划（Driver: glm）

## 背景速览

- run `20260925T053433Z`：codex（deepseek-flash）`approve-with-nits`，4 条次要；
  gemini（gemini-3.8-flash-high）`approve`，0 条。
- 用户焦点「看 it's 这一处的 $HOME 与 "双引号"」的结论：**双引号是正确且刻意的选择**，
  两侧独立实测一致——运行期展开 `$HOME`、防止带空格路径分词；改单引号会得到字面量
  `$HOME/.smoke-fixture`，与「跟随执行用户家目录」的意图相反。该行不返工；
  本裁决补齐的是它周围四个未决口径。
- gemini 侧无编号意见，无条目可入裁决表，此处显式记明、非静默忽略。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | minor | 接受 | 引号本身的结论与本侧一致：双引号正确、不改单引号。但 HOME 缺失（`set -u` 下脚本 exit 1）与 HOME 为空串（静默退化成 `/.smoke-fixture`）两个分支确实无人决策，验证判据会因环境而非改动变红。采纳「在计划里一次写死」：HOME 缺失或为空 → 脚本显式报错退出，不静默退化、不再留待审查定夺。 | 修订计划 §变更清单 2 与 §风险：补 HOME 缺失/空串的最终口径（显式报错退出） |
| CODEX-02 | codex | minor | 接受 | `$HOME` 下建目录是全计划唯一仓库外持久副作用：`git checkout`/`git clean` 清不掉、跨用户互不相认、无人认领；验证判据又依赖执行者 HOME 可写，失败时无法区分「改动坏了」与「环境不许」。采纳显式收尾与前置声明。 | 修订计划 §变更清单 2（脚本收尾清掉自建目录）、§3（环境前置与「叶子非目录」的期望结果） |
| CODEX-03 | codex | minor | 接受 | 实测成立：仓库无 package.json / type / engines，`node -e` 的 import 完全依赖 Node 模块语法探测，旧版或显式关闭探测即 SyntaxError，「可真实执行」的前提没被钉死。采纳最小方案：新增 `package.json`（`type:module` + `engines.node>=22`），验证命令显式 `--input-type=module`，不再依赖隐式探测。 | 修订计划 §变更清单 新增第 0 项；§3 验证命令改写 |
| CODEX-04 | codex | minor | 接受 | 「内联断言」若落地成打印布尔值，断言为假也以 0 退出，验证会退化为永远通过的橡皮图章；且 §不做的事 放弃了测试框架，没有第二道保险。采纳：断言用抛错手段（`node:assert`），失败必须非零退出，写成验收条件。 | 修订计划 §3：断言写法与退出语义写死为验收条件 |

## 修订后的计划（吸收全部接受项）

0. 新增最小 `package.json`：`{"type":"module","engines":{"node":">=22"}}`——
   把 ESM 形态与版本下限从「隐式探测」变成「显式声明」（CODEX-03）。
1. `src/math.js`：新增 `export function sub(a, b) { return a - b; }`，不动 `add`。
2. 新增 `scripts/env-check.sh`：
   - 首行 `#!/usr/bin/env bash`，第二行 `set -euo pipefail`；
   - HOME 缺失或为空 → 显式报错退出（`HOME 未设置或为空` 写 stderr、exit 1），
     不静默退化到根目录（CODEX-01）；
   - `PREFIX="$HOME/.smoke-fixture"`——双引号保留运行期展开，焦点结论，不返工；
   - `mkdir -p "$PREFIX"`，`echo ok`；
   - 收尾清掉自建目录（脚本对自己建的 `$PREFIX` 负责到底，不留仓库外残留）；
     若 `$PREFIX` 位置已存在同名非目录文件，视为环境前置不满足，报错退出，
     不计为改动失败（CODEX-02）。
3. 验证（真实执行）：
   - 断言命令显式 `--input-type=module`，用 `node:assert` 抛错式断言
     `add(2,3)===5` 与 `sub(5,3)===2`；**断言失败必须以非零码退出，这是验收条件**，
     不是「跑一下看看」（CODEX-03 / CODEX-04）；
   - `bash scripts/env-check.sh` 退出码 0；
   - 环境前置：执行者 HOME 已设置且可写；本机 Node v25.2.1 满足下限。

## 不做的事（不变）

- 不引入测试框架；不改 `.trivium/`、`AGENTS.md` 等流水线自身文件。

## 风险（更新）

- 原风险段唯一的问句（「若审查认为应单引号需先定夺」）已由两侧审查回答：
  不改单引号，问句撤下。
- 残余风险集中在环境前置（HOME 可写、Node ≥ 22），已在 §2 / §3 显式声明，失败可归因。
