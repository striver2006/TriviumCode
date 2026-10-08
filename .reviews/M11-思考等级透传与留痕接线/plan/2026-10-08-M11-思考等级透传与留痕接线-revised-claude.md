---
schema: trivium.disposition.v1
topic: M11-思考等级透传与留痕接线
stage: plan
role: claude
kind: revised
run_id: 20261007T234735Z
addresses:
  - 2026-10-08-M11-思考等级透传与留痕接线-codex.md
  - 2026-10-08-M11-思考等级透传与留痕接线-gemini.md
  - 2026-10-08-M11-思考等级透传与留痕接线-glm.md
---

# 裁决：M11-思考等级透传与留痕接线 · 计划三审第 1 轮

> 被审对象：`plan/2026-10-08-M11-思考等级透传与留痕接线-claude.md`（原稿，起点 `c855dcee`）
> ｜ 运行：`20261007T234735Z`（12 分 59 秒）
> ｜ 结论：codex `approve-with-nits`（次要 2、吹毛求疵 1）｜ gemini `approve-with-nits`（吹毛求疵 1）｜ glm `approve-with-nits`（吹毛求疵 2）
> ｜ 共 6 条：接受 6、驳回 0、暂缓 0
> ｜ 修订后的计划：`plan/2026-10-08-M11-思考等级透传与留痕接线-r2-claude.md`

每条都回源码或仓库现状核过，事实全部成立。三侧对三个焦点（只取回读、厂商 profile 三处同值、拆闸干净与现役不变）都给了「成立」的结论，对 §6 第 3 条（探活不改）与第 6 条（`override_reason` 措辞不改、只登记）三侧均判可接受。无重合意见。核 GLM-01 时另查出 `tier-resolve.test.ts:175` 还有一处 `agentVendorProfile` 断言，一并补进清单。

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| CODEX-01 | codex | minor | 接受 | 属实：`review.ts:1782-1783` 正常侧持久化剥过的结构化结论，parse_fallback 侧持久化未剥原文；`gate.ts:1346-1350` 重试解析用当前安装的 bundle 与其 `ECHOED_ORCHESTRATOR_KEYS`。新五键进清单后若回滚到旧 bundle，新世代 parse_fallback 原文里审查员照抄的新键会被旧清单漏剥、撞 `review.v1` 根 `additionalProperties: false`，该轮退回 F 编号。不丢数据，但属于未登记的回滚代价 | r2 §5 新增一条：回滚到本步之前的 bundle 时，本步之后产生的 parse_fallback 原文在 `gate --check` 重试解析下可能整份判死，处置是按 `〈前缀〉-F〈n〉` 回退编号裁决；接受此代价，不改设计 |
| CODEX-02 | codex | minor | 接受 | 属实：F6 原文只有一对括号，「最后一对」今天取得对，但厂商在列表后追加括号说明时会取错，错误方向是把合法值硬拒 64，且 doctor 重跑不自愈 | r2 §2.4：`parseEffortLevels` 改取 `--effort` 行内**第一对**圆括号；对逗号分隔结果逐项做形状校验（小写字母开头、只含小写字母数字与连字符下划线、非空），任一项不合形状即 `null`（unknown，跳过校验并点名）——格式漂移导向「取不到」而不是「错枚举」。§3.1 K 组补「多括号对取第一对」「列表项不合形状」两格；§3.2 M14 之外补 M17「改回取最后一对」 |
| CODEX-03 | codex | nit | 接受 | 属实：`.gitignore` 忽略 `/dist/` 与 `skills/dual-critic/scripts/trivium.cjs`，`git archive` 导出的是旧源码，须在导出目录内现构建；产物是「旧源码 + 现行工具链」，不是历史构建 | r2 §3.4 改写为两步：归档导出后在导出目录内（`node_modules` 软链本仓）用 `scripts/build.mjs` 构建，再跑桩 `review`；写明「旧构建 = 旧源码 + 现行工具链」，sha256 断言只证明跑的是两份不同构建 |
| AGY-01 | gemini | nit | 接受 | 属实：`TierSource` 定义在 `adapters/base.ts:1860`，`types.ts` 只依赖 `agents/registry`、`build-stamp`、`status` 这类底层模块；`TierName` 本就在 `types.ts:945`。`CriticRequest` / `CriticRunMeta` 要引用 `TierSource`，留在 `base.ts` 会让 `types.ts` 反向依赖适配器层 | r2 §2.6：`TierSource` 上移到 `types.ts` 与 `TierName` 相邻并导出，`adapters/base.ts` 改为从 `types.ts` 导入并原样再导出（既有 `import { TierSource } from './adapters/base.js'` 的调用方不必改） |
| GLM-01 | glm | nit | 接受 | 属实：`preflight.ts:554` `originText` 只被过渡闸块内 :508、:519 引用，闸删后无引用、`noUnusedLocals` 会拦；`tier-resolve.test.ts` 的 `stageEffort` 断言有 :188、:195 两处，另有 :175 的 `agentVendorProfile` 断言（核意见时查出） | r2 §1.4 清单与 §2.7：`originText` 随闸删除；测试断言按 :175、:188、:195 三处计 |
| GLM-02 | glm | nit | 接受 | 属实：`types.ts:1909` `CriticResult.profile_requested` 注释写「`agents.〈id〉.profile`，codex 的 `-p`」，本步后来源是三层解析值；注释漂移 `tsc` 拦不住 | r2 §2.6：`CriticResult.profile_requested` 注释与 `CriticRequest` 侧同句式改为三层解析值 |

## 2. 对 §6 请审查员重点核各条的回应汇总

1. 回读只取回读：三侧均判成立（codex 补充「比原规格更强」，glm 补充 E 组「塞带后缀的 `model_effective` 也不冒充」那格的价值）。不改。
2. 缺席与 null：三侧均判两态不合流；glm 判旧字段 `effort` 条件写与 schema 只收 string 相容。不改。
3. 厂商 profile 三处同值与探活不改：三侧均判成立、可接受；glm 补「`--stage all` 逐阶段收集只属独立 preflight，`review` 是单阶段」口径正确。不改。
4. 拆闸干净：GLM-01 补两处遗漏（已接受）；永久判据与裸 slug 回落支三侧均判保留正确。
5. 现役不变：三侧均判 §2.8 与 §3.4 足够；CODEX-03 订正验收步骤的构建说法（已接受）。glm 另指出 agy 适配器在 `availability` / `run` 里仍经 `agentConfigOf` 取段，`agents.gemini` 缺段照旧响亮失败——删 `effortFor` 不丢这层保障，r2 §2.1 补记。
6. `override_reason` 措辞：三侧均判「不改、只登记」合适。不改。
