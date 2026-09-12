---
schema: trivium.disposition.v1
topic: 双审进度反馈
stage: plan
role: claude
kind: revised
run_id: 20260912T144811Z
addresses:
  - AGY-01
  - AGY-02
  - AGY-03
  - AGY-04
  - AGY-05
  - GLM-01
  - GLM-02
  - GLM-03
  - GLM-04
  - GLM-05
  - GLM-06
  - GLM-07
  - GLM-08
---

# 修订计划：让双审等待期间的进度及时反馈给用户

## 0. 裁决总览

13 条意见（gemini 5 ｜ glm 8）**全部接受**，无驳回、无暂缓。逐条核实后没有一条是误判——
两侧指认的行号、公式与文件归属我都回查了源码确认。

最要紧的三条：

1. **AGY-01 / GLM-03（默认值落点写错）** — 我把 `wait_timeout_s` 默认值的落点写成了
   `init.ts`，实际在 [config.ts:77](src/trivium/config.ts#L77) 的 `defaultConfig()`。
   `init.ts` 只 `import { defaultConfig }` 再序列化，本身没有 `540` 字面量。
   照原计划改会改不到真正的源头。
2. **GLM-01（7 处字面量静默漂移）** — 数字散在四个 skill 与设计文档里，契约测试不锁数字，
   改了配置不改文档不会红。这是本计划**自己制造**的漂移，不是既有问题。
3. **GLM-02（开场播报要的数据 `--start` 不返回）** — 我要求播报「两侧模型、预算时长」，
   但 `--start` 的 JSON 里根本没有这两项。义务与数据对不上。

两侧有三组重复指认，合并落点处理：AGY-02≡GLM-05（`pct` 分母语义）、
AGY-05≡GLM-06（`status` 为 null 的边界）、AGY-01≡GLM-03 后半（默认值落点）。

## 1. 逐条裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| AGY-01 | gemini | major | 接受 | 已回查：`grep -n wait_timeout_s src/trivium/config.ts` → 77 行；`init.ts` 无 `540`，只在 282 行调 `defaultConfig()`。原计划落点确实错了 | 本件 §2 修订 A：步骤 3 落点改为 `src/trivium/config.ts` 的 `defaultConfig()` |
| AGY-02 | gemini | minor | 接受 | 与 GLM-05 同一问题。`computeMaxWaits` 的分母含重试系数，`elapsed` 从 `started_at` 起算且重试不重置，`pct` 确会破 100% | 本件 §2 修订 B：`pct` 封顶 + 超限改文案（不改分母，理由见该节） |
| AGY-03 | gemini | minor | 接受 | 已回查 [run-protocol.ts:516](src/trivium/run-protocol.ts#L516)：`statusRun(ctx, runId)` 的 `ctx.config` 与 `s.stage` 都在手上，完全能构造 budget。我原以为拿不到，是没核 | 本件 §2 修订 C：`statusRun` 构造并传入 `ProgressBudget` |
| AGY-04 | gemini | nit | 接受 | `⌈0/180⌉ = 0`，会播报「第 0/32 次等待」；边界 180s 处也差一 | 本件 §2 修订 D：公式改 `⌊elapsed/waitTimeoutS⌋ + 1` |
| AGY-05 | gemini | nit | 接受 | 与 GLM-06 同一问题。[run-protocol.ts:501-509](src/trivium/run-protocol.ts#L501-L509) 确有 `last` 为 null 的兜底分支，而验收 1 字面要求「同时含」全部新字段，冲突 | 本件 §2 修订 E：定义 null 边界并写进验收 1 的例外 |
| GLM-01 | glm | minor | 接受 | 已回查：`600000` 在四个 skill 各一处，`540s` 在三个 review skill 各一处，设计文档 133/339/782/801/1413 共五处。契约测试确不含数字断言。改配置不改文档 = 静默漂移 | 本件 §2 修订 F：采纳「去数字化」建议，文档改为引用返回值；设计文档五处逐一核对 |
| GLM-02 | glm | minor | 接受 | 已回查 [cli.ts:342-352](src/trivium/cli.ts#L342-L352)：返回仅 `run_id`/`max_waits`/`wait_timeout_s`/`bash_timeout_ms`/`worker_pid`/`run_dir`。播报清单里的「两侧模型」「预算时长」无数据来源 | 本件 §2 修订 G：采纳增补字段方案（非降级清单），`--start` 增 `models` 与 `stage_timeout_s` |
| GLM-03 | glm | minor | 接受 | 已回查 [init.ts:279-281](src/trivium/init.ts#L279-L281)：config.yaml 已存在则 `report.skipped`，无条件不覆盖。「重跑 init」是错误指引 | 本件 §2 修订 A（落点）+ 修订 H（RUNBOOK 口径改「手工编辑」，R4 同步改写） |
| GLM-04 | glm | minor | 接受 | 已回查：`grep -rn bashTimeoutMs test/` 无任何命中；[run-protocol.test.ts:75](test/integration/run-protocol.test.ts#L75) 断言 `/阶段状态 running/`，会因 RunPhase 中文化变红。我影响面表猜错了方向 | 本件 §2 修订 I：影响面表更正 |
| GLM-05 | glm | minor | 接受 | 同 AGY-02。额外价值是点明了「超预算时刻恰是最需要解释的时刻」，这句促成我选了封顶+改文案而非换分母 | 同 AGY-02，本件 §2 修订 B |
| GLM-06 | glm | nit | 接受 | 同 AGY-05。`renderProgressBrief(s: RunStatus)` 在 `status` 为 null 时无从调用，属实 | 同 AGY-05，本件 §2 修订 E |
| GLM-07 | glm | nit | 接受 | 按 `computeMaxWaits` 复算：`⌈2700×2/540⌉+2 = 10+2 = 12`，我写的 11 是错的。这是计划里唯一量化的成本基数，错不得 | 本件 §2 修订 J：R1 改「原 12 次」并标注计算口径 |
| GLM-08 | glm | nit | 接受 | 理由成立且我此前没想到：无变化判定要 Driver 跨窗口记忆上次 sides，长会话压缩后不可靠。带着未决项进实施 = 现场发挥 | 本件 §2 修订 K：关闭 R3，明确不做无变化分支 |

## 2. 修订内容

原稿保留在同目录 `2026-09-12-双审进度反馈-claude.md`。本件只写改了什么、为什么。

### 修订 A · 默认值落点更正（AGY-01、GLM-03 后半）

步骤 3 原文「改两处：`.trivium/config.yaml` 与 `trivium init` 写出的默认配置（`init.ts`）」，
更正为：

- [.trivium/config.yaml](.trivium/config.yaml) 的 `review.wait_timeout_s`
- [src/trivium/config.ts](src/trivium/config.ts#L77) `defaultConfig()` 里的 `wait_timeout_s`

`init.ts` **不改**——它只 `import { defaultConfig }`（18 行）再序列化（282 行），
没有自己的默认值。`skills/dual-critic/scripts/trivium.cjs` 里那处 `540` 也不手改：
它是 `scripts/build.mjs` 的 esbuild 产物且在 `.gitignore` 里，`npm run build` 会重新生成。

### 修订 B · `pct` 语义拍板：保持单阶段分母 + 封顶 + 超限改文案（AGY-02、GLM-05）

两侧都给了二选一，我选**保持 `budget_s = stageTimeoutS`（不含重试）**，并补两条规则：

- `pct` 计算后对 100 取 `Math.min`，不显示三位数百分比；
- `elapsed_s > budget_s` 时，`progress_brief` 的时间段换成
  「**已超单次预算 · 重试收尾中（第 N 次尝试）**」，不再显示百分比。

**为什么不用与 `max_waits` 同源的含重试总预算**：分母若取 5400，绝大多数正常运行
（一侧 600~1000s 完成，无重试）会显示成 11%~18%。那个数字对用户没有指导意义——
他真正想知道的是「按正常情况还要多久」，而不是「距离最坏情况还有多远」。
重试是异常路径，此时用户需要的是一句解释，不是一个百分比。

**已知的不一致，有意保留**：`第 N/M 次等待` 的 M（`max_waits`）含重试预算，
`pct` 的分母不含。超预算时会出现「第 20/32 次等待 ｜ 已超单次预算」这种组合——
它读起来是自洽的（还有窗口余量，但已超出正常耗时），比两个都用最坏分母更有信息量。
此点写入设计文档的进度反馈小节，避免后人当 bug 修。

### 修订 C · `statusRun` 也吃 budget（AGY-03）

[run-protocol.ts:531](src/trivium/run-protocol.ts#L531) 的 `renderProgress(s)` 改为
传入 budget，数据来自 `ctx.config.review.timeout_s[s.stage]`、
`ctx.config.review.wait_timeout_s` 与 `computeMaxWaits(...)`。

于是 `/dual-status` 与 `trivium status` 手工自查时看到的期待值信息与自动等待循环一致。
D5（可选参数不破坏既有调用方）的动机仍然成立——参数保持可选——但**项目内**的两个
调用方都会传，「不传」只留给外部调用与单测。

### 修订 D · `waits_done` 公式（AGY-04）

`⌈elapsed / waitTimeoutS⌉` → `Math.floor(elapsed / waitTimeoutS) + 1`。
验收标准 2 增一条：`elapsed=0` 时 `waits_done === 1`；`elapsed=180, waitTimeoutS=180`
时 `waits_done === 2`。

### 修订 E · `status` 为 null 的边界（AGY-05、GLM-06）

步骤 1 补一段边界定义：

> `waitRun` 返回的 `status` 为 null（窗口用尽且全程无有效心跳）时：
> `progress_brief` 退化为与 `progress` 相同的启动提示句
> （「运行 <id> 仍在启动中（尚无有效心跳）」），
> `elapsed_s` / `budget_s` / `pct` / `waits_done` 置 `null`，`sides` 置 `{}`，
> `max_waits` 仍按配置给出。字段**始终存在**，只是取值为 null——
> 省略字段会让 Driver 分不清「没有」和「读不到」。

验收标准 1 相应加例外：「`status` 为 null 时新字段存在但取值为 null / `{}`」。

### 修订 F · 去数字化，消除 7 处字面量漂移（GLM-01）

采纳 GLM 的「更稳的做法」。步骤 4/5 的同步清单扩充：

**四个 skill**（[dual-review-plan:105-106](skills/dual-review-plan/SKILL.md#L105-L106)、
[dual-review-code:107-108](skills/dual-review-code/SKILL.md#L107-L108)、
[dual-review-bug:105-106](skills/dual-review-bug/SKILL.md#L105-L106)、
[dual-run:59](skills/dual-run/SKILL.md#L59)）：把「设为 `bash_timeout_ms`（600000）」
改成「设为 `--start` 返回的 `bash_timeout_ms`」，把「`--wait` 会等 540s」改成
「`--wait` 会等 `wait_timeout_s` 秒」。**文档此后不再重复任何具体数字。**

**设计文档五处**逐一处理：
- 133 行（Bash 工具超时上限 600000）：这是**平台事实**不是本项目配置，保留；
- 339 行 AD-03「默认 540s」：改为「默认 `wait_timeout_s`」；
- 782 行 `--timeout 540` 示例：改为 `--timeout <wait_timeout_s>`；
- 801 行「默认 540」：改为「默认见 `defaultConfig()`」；
- 1413 行配置示例 `wait_timeout_s: 540`：改为 `180`（示例应与默认值一致）。

验收标准增一条：`grep -rn "540s\|（600000）" skills/` 无命中。

### 修订 G · `--start` 增补播报所需字段（GLM-02）

[cli.ts:342-352](src/trivium/cli.ts#L342-L352) 的 `--start` JSON 输出增两个字段：

```jsonc
{
  "stage_timeout_s": 1500,
  "models": { "gemini": "gemini-3.1-pro-high", "glm": "GLM-5.3" }
}
```

两者 `startRun` 都已算好（模型经 profile 与 `--model-*` 覆盖路由后的**生效值**，
阶段超时来自 `cfg.review.timeout_s[stage]`），只是没往外吐。`StartOutcome`
同步加这两个字段。

**为什么不选「降级播报清单」**：开场播报的价值一半在「还要多久」，砍掉预算时长
等于砍掉一半。而让 skill 文档硬编码模型名会随 profile 与覆盖漂移成错误播报——
这正是修订 F 要消灭的那类问题，不能一边消灭一边制造。

### 修订 H · 升级指引口径（GLM-03 前半）

- R4 原文「需手动改或重跑 `init`」→「**只能手工编辑** `config.yaml` 的
  `review.wait_timeout_s`；`trivium init` 对已存在的 config.yaml 无条件跳过
  （[init.ts:279-281](src/trivium/init.ts#L279-L281)），重跑改不了它」。
- 步骤 5 的 RUNBOOK 条目按同一口径写，不得出现「重跑 init 可升级配置」。

### 修订 I · 影响面表更正（GLM-04）

| 原表述 | 更正为 |
| :--- | :--- |
| `run-protocol.test.ts`：若断言了 `bashTimeoutMs === 600000` 会红 | **删除此行**（全测试目录无 `bashTimeoutMs` 断言） |
| —— | **新增**：[run-protocol.test.ts:75](test/integration/run-protocol.test.ts#L75) 的 `assert.match(out.progress, /阶段状态 running/)` 会因 `RunPhase` 中文化变红，需改为 `/阶段状态 审查中/` |

`test/unit/status.test.ts` 一行保留（`renderProgress` 文案断言确会受影响）。

### 修订 J · R1 成本基数更正（GLM-07）

「code 阶段最坏 32 次 wait（原 11 次）」→「原 **12** 次，新增 20 次」。
并补一句计算口径：32/12 均按**本项目**的 `timeout_s` 覆盖值（plan 1500 / code 2700）计；
内置默认值（900/1200）下分别是 16/12 次。避免读者拿默认值对不上。

### 修订 K · 关闭 R3（GLM-08）

R3 的未决问题「状态无变化时是否只发更短一行」**定为不做**，理由写进 R3：

> 无变化判定要求 Driver 比对上一次的 sides 状态，而长会话上下文压缩后这份记忆不可靠；
> 「状态不变时不要补说明」已经抑制了噪音主体，brief 本身已是单行，再缩短是边际收益。
> 统一格式、不做分支——把判断留给实施现场，等于把它留给不确定。

计划不再携带未决项进入实施。

### 修订汇总：对方案步骤的净影响

| 步骤 | 变化 |
| :--- | :--- |
| 步骤 1 | 增 `pct` 封顶与超限文案（B）、`waits_done` 公式更正（D）、null 边界定义（E）、`--start` 增两字段（G） |
| 步骤 2 | 无变化 |
| 步骤 3 | 落点改 `config.ts`（A）；`statusRun` 传 budget（C） |
| 步骤 4 | 文档去数字化（F）；播报清单数据来源坐实（G） |
| 步骤 5 | 同步清单扩至设计文档五处（F）；RUNBOOK 口径更正（H） |
| §6 影响面 | 两行更正（I） |
| §7 验收 | 增 `waits_done` 边界、null 边界例外、`grep` 无命中三条 |
| §8 风险 | R1 基数更正（J）；R3 关闭（K）；R4 口径更正（H） |

不可逆决策 D1–D5 全部维持，无一条被两侧质疑。
