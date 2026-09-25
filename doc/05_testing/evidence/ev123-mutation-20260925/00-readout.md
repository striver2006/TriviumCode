# EV-123 变异验证读数

- **日期**：2026-09-25
- **装置**：`scripts/mutation-check.mjs`，本目录 `run.mjs` 包装；规格 `mutation-spec.json`，原始输出 `mutation-output.txt`
- **套件**：`model-override-source`、`preflight`（单元），`codex-wiring`、`override-source-start`（集成）四个
- **结果**：**装置 12 / 12 咬住**；另有 P7 手工变异 3 / 3 咬住（理由见下）

## 装置跑的十二条

| # | 变异 | 应红的用例 | 结果 |
| :-- | :--- | :--- | :--- |
| P1 | 新检查恒不出项 | 「文件不在 ⇒ 一条 warn 项」「缺省用真实适配器表」 | ✓ fail=2 |
| P2 | 不看 `selected`，遍历全部适配器 | 「未入选 ⇒ 不出项」 | ✓ fail=1 |
| P3 | detail 用绝对路径 | 「路径以 `~/` 展示」 | ✓ fail=1 |
| P4 | `warnings` 不过滤 `warn` | 口径断言「warnings 恰是 warn 项的汇总」 | ✓ fail=5 |
| P5 | C5 不标 `warn` | 「现有 ⚠️ 项一律标 warn」「C5 与副本源各出一条」 | ✓ fail=2 |
| P5b | 探活已跳过不标 `warn` | 预检 `--json` 子进程 | ✓ fail=1 |
| P6 | `prepareZcodeHome` 缺省值另写路径 | 唯一出处·世界 B | ✓ fail=1 |
| P8 | 删掉预检 JSON 的 `warnings` | 预检 `--json` 子进程 | ✓ fail=1 |
| P9 | `startRun` 不调新检查 | `--start` 子进程「文件不在」「人读输出」 | ✓ fail=2 |
| P10 | 删掉 `--start` JSON 的 `warnings` | `--start` 子进程三条 JSON 用例 | ✓ fail=3 |
| P11 | `checkModelSlugs` 在 `unverifiable` 非空时不置 `warn` | slug 两条用例 | ✓ fail=2 |
| P12 | 桩忽略 `modelOverrideSource` 字段 | `--start` 子进程「文件不在」「人读输出」 | ✓ fail=2 |

`mutation-output.txt` 是代码双审 r1 修改之后的第二次运行（复查挪进 `startRun` 主 `try`；P9 的 `find` 行文与缩进未变，仍唯一命中），覆盖了第一次；两次十二条的 fail 数逐条相同。

P12 的用意是确认 `--start` 用例**真的穿过了桩注入链**，而不是碰巧绿：桩不实现该成员时，这两条必须红。

## P7：手工变异（装置验证不了）

`SKILL.md` 不进构建，装置闸 4 比的是 `dist/test/` 下的被测产物，没有对应产物可比（与 `mutation-check.mjs` 注释里 D1 / D2 的处境相同）。
所以 P7 用 Edit 手工改、跑 `dist/test/test/contract/skill-warnings-relay.test.js`、再改回：

| # | 变异 | 结果 |
| :-- | :--- | :--- |
| P7a | 删掉 dual-run 继承句里的「（含 `warnings` 的逐条转述）」 | ✓ 「dual-run：委托继承句点名了 warnings」红 |
| P7b | 把 dual-review-code 开场播报句改成不提 `warnings` | ✓ 「dual-review-code：开场播报约定了……」红 |
| P7c | 把 dual-run S0 的预检句改成不提 `warnings` | ✓ 「dual-run：预检步骤约定了……」红 |

P7a 与 P7b 同一次运行（fail=2），P7c 单独一次（fail=1）。恢复后契约用例 9 / 9 通过，`git diff --stat skills/` 与变异前一致。

## 读输出时要注意的口径

装置首行「✓ 工作树干净、基线全绿」里的**「工作树干净」指装置自己的哨兵不在**（上次运行已善终、没有残留变异），**不是** `git status` 意义上的干净。
本次基线是跑变异时的工作树，即 `b16f144` 之上尚未提交的 EV-123 改动，不是 `HEAD`。
