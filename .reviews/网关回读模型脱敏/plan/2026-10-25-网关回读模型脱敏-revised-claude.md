---
schema: trivium.disposition.v1
topic: 网关回读模型脱敏
stage: plan
role: claude
kind: revised
run_id: 20261025T135958Z
addresses:
  - 2026-10-25-网关回读模型脱敏-codex.md
  - 2026-10-25-网关回读模型脱敏-gemini.md
  - 2026-10-25-网关回读模型脱敏-glm.md
---

# 裁决：网关回读模型脱敏 · 计划三审第 1 轮

> 被审对象：`plan/2026-10-25-网关回读模型脱敏-claude.md`（r1，基线 `66096574`）。
> 评审循环第 1/3 轮：codex `pass-after-changes`（1 minor），gemini `pass-after-changes`（1 minor、1 nit），glm `pass-after-changes`（3 minor、2 nit）。
> 共 8 条：6 条接受，2 条部分接受（记「接受」，未采纳的那一半在理由里写明）。合入后的计划见 `plan/2026-10-25-网关回读模型脱敏-r2-claude.md`。
> 裁决前核过的依据：`scripts/agent-access-restricted.mjs:36-40`（纯判定，读落盘 `result.json` 的 `trace.init.model` 与 `readback.model`，与请求模型不等即 `model-readback-mismatch`）；`scripts/probe-agent-access.mjs:17-50`（`--apply-claude-evidence` 一次性回填 2026-10-09 证据，审计文件存在即拒绝）；`scripts/agent-access-closeout-summary.mjs:57,74-75`（消费 closeout 产出的 `readback`）；`scripts/agent-access-summary.mjs:33-86`（codex 侧 `readback.modelEffective` 与 claude profile 路线的历史 `readback.model`，读既有证据）——GLM-02 列的三处属实，另有 `agent-access-summary.mjs` 一处同为读历史证据，一并列表；`src/trivium/adapters/claude-route.ts:34-48`（`extractSettingsEnv` 不改键名大小写）与 r1 的键名正则只收大写段（AGY-01 的前提据此核）；`src/trivium/secrets.ts:142-223`（裸值只有已知厂商形态规则能命中，`toml-bearer-token` 与 `generic-secret-assignment` 以赋值形态起头，GLM-01 成立）。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| --- | --- | --- | --- | --- | --- |
| CODEX-01 | codex | minor | 接受 | 属实：旧扫描脚本只按 `_MODEL(_NAME)?$` 后缀报 NOTE，计划判为凭据的伪模型键（如 `ANTHROPIC_AUTH_MODEL`）与模型名键里误填的令牌形态值，原值泄漏时只报 NOTE、最终仍 no leak。改为新写落盘扫描脚本：分类直接导入构建产物里的同一个豁免判定函数（不在脚本里另写一套口径），只有通过完整豁免条件的值报 NOTE；脚本带合成值自检模式，伪模型键与令牌形态值泄漏必须非零退出，自检在 macOS 上由我先跑、读数进证据目录 | r2 §3.2 第 ③ 条与新增「扫描器自检」段；§1.1 把豁免判定导出为单一函数 `gatewayScrubPlan` |
| AGY-01 | gemini | minor | 接受（部分） | 词表补 `PASS`、`PASSWD`、`PWD`：接受，是收紧。键名先转大写再匹配：**不采纳**——r1 的正则只收大写段、凭据词也按大写段比，小写或混写的键（`ANTHROPIC_model`、`ANTHROPIC_auth_model`）根本过不了正则，一律留在替换集，方向是 fail-closed：最坏结果是该键的模型名被替换、回读记 unverified，不会放过凭据。先转大写反而会把一批原本被替换的键放进豁免集，是放松，与任务目标「凭据类键一处都不能放松」相悖。在计划里写明「键名区分大小写、非全大写的键一律按凭据处理」，单测锁住 | r2 §1.1 词表与大小写说明；§2.1 S1 加小写 / 混写键全为假、`PASS` / `PWD` 段为假 |
| AGY-02 | gemini | nit | 接受（部分） | `hasRedactionMark` 先判 `typeof s === 'string'`：接受，零成本。全空白模型名记 unverified：**不采纳**——全空白不是脱敏痕迹，与本主题无关；改它会让未开启的机器在这一输入上行为变化，违反任务目标「未开启机器零变化」，且 CLI 不产出这种值，属于另立问题。`<redacted` 大小写不敏感：**不采纳**——占位符全由本仓 `secrets.ts` 与 `scrubGatewayEnv` 产出，形态固定；S7 逐一喂生产方的实际产出锁住识别，放宽匹配没有对应的生产方 | r2 §1.2 `hasRedactionMark` 的类型守卫 |
| GLM-01 | glm | minor | 接受 | 属实：守卫 2（值过 `redactSecrets`）对裸值只认已知厂商形态，非标准形态的凭据误填进模型名键时会被放行，r1 的「fail-closed」措辞夸大了。加正向形态约束（三条同时满足才豁免）：字符集与长度沿用 `claudeProfileMetadata` 的 `[\w./:+-]`、长度 1～128；最长连续字母数字段 ≤ 16（真实模型名由短段拼成，随机令牌是长连续段）；不是 UUID 形态。约束不满足照旧替换，代价只是该次回读记 unverified。如实写出剩余边界：由短段拼成、形似模型名的凭据填进模型名键仍会被放行，登记进主设计与报告 | r2 §1.1 守卫 4 与「剩余边界」段；§2.1 S4 加「非标准随机令牌」「UUID」两格；§2.3 变异加「去掉正向形态约束」 |
| GLM-02 | glm | minor | 接受 | 属实：脚本侧读取点不止两处。补全仓读取点表，src 与 scripts 分列，对不改的各写依据 | r2 §1.2 读取点表；§2.3 末尾与报告按表陈述 |
| GLM-04 | glm | minor | 接受 | 属实：`runAll` 对全部 `GATEWAY_VALUES`（含两个模型名键）断言不出现，E8 复用它会在错误方向上判红。E8～E10 不复用 `runAll`，各自直调；新增只含凭据键值的常量供「不出现」断言，`GATEWAY_VALUES` 原样留给 E1～E7 | r2 §2.2 装置说明 |
| GLM-03 | glm | nit | 接受 | 属实：`claude-route.ts:136-139` 注释是同类断言，r1 漏列 | r2 §1.3 表补该行，表头改为「已知落点 + 实施时整仓 grep 兜底」 |
| GLM-05 | glm | nit | 接受 | 合理：E1 / E7 断言不动，但文件头注释、E7 用例名与注释仍写着修复前的不变量，后来者会误读。承诺收窄为「不改断言」：允许只改文件头注释与 E7 的用例名、注释措辞，把凭据键与模型名键两类不变量分开写，注明模型名键的正向覆盖在 E8；用例名保留 `E7 开启：` 前缀以便与 EV-256 报告对得上 | r2 §2.2 首段 |
