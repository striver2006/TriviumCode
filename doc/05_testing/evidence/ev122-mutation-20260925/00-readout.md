# EV-122 变异验证读数

- **日期**：2026-09-25
- **装置**：`scripts/mutation-check.mjs`，本目录 `run.mjs` 包装；规格 `mutation-spec.json`，原始输出 `mutation-output.txt`
- **套件**：`zcode-model-selection`、`zcode-carriers`（单元）与 `code-stage`（集成）三个
- **结果**：**10 / 10 咬住**（N1～N9 为计划 r2 §4.2 的九条；N10 为代码双审 r1 CODEX-01 补的防御分支）

| # | 变异 | 应红的用例 | 结果 |
| :-- | :--- | :--- | :--- |
| N1 | 产出条件去掉 `!attempted` | 纯函数「做了覆盖，即使带了成因」 | ✓ fail=1 |
| N2 | 比整串而非 modelId 段 | 纯函数「providerId 形态不同」「短名 vs 全限定」 | ✓ fail=2 |
| N3 | 回读为空时也产出 | 纯函数「没回读到」、`run()` 负格 | ✓ fail=2 |
| N4 | `run()` 不接线 | 副本源缺失那格 | ✓ fail=1 |
| N5 | 守卫不播报 | 守卫三格 | ✓ fail=3 |
| N6 | `review.ts` 不写进 run.json | 集成用例 | ✓ fail=1 |
| N7 | 接线第二参换成 `home.qualified` | 副本源缺失那格 | ✓ fail=1 |
| N8 | 守卫改按 `reason` 文案分句 | 守卫「按 cause 给排查指向」 | ✓ fail=2 |
| N9 | 限定失败出口 `cause` 填成 `source_missing` | 成因用例、`run()` 限定失败 | ✓ fail=2 |
| N10 | `unenforcedHint` 的 `default` 分支不返回空串 | 守卫「两值之外的 cause 不拼出 undefined」 | ✓ fail=1 |

`mutation-output.txt` 是第二次运行（加入 N10 后）的输出，覆盖了第一次（N1～N9，同样 9 / 9）。两次之间 N5、N8 的 fail 数分别由 2、1 升到 3、2，因为代码双审后守卫组多了一格用例，不是变异本身变了。

## 读输出时要注意的口径（代码双审 r1 GLM-F03 ③）

装置首行「✓ 工作树干净、基线全绿」里的**「工作树干净」指装置自己的哨兵不在**（上次运行已善终、没有残留变异），**不是** `git status` 意义上的干净。
装置刻意不用 git 判据（见 `scripts/mutation-check.mjs` 的 `SENTINEL` 注释）：它的典型场景就是一批未提交改动。

本次两轮变异的**基线都是跑变异时的工作树**，即 `d5c177c` 之上尚未提交的 EV-122 改动，不是 `HEAD`。「基线全绿」说的是这个工作树上三个套件全绿。
装置字样改为「无残留哨兵」留给下一个触碰该脚本的主题（登记在 BACKLOG EV-122 格的残余）。
