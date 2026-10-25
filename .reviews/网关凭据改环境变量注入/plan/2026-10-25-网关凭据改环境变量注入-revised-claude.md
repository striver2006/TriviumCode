---
schema: trivium.disposition.v1
topic: 网关凭据改环境变量注入
stage: plan
role: claude
kind: revised
run_id: 20261025T093105Z
addresses:
  - 2026-10-25-网关凭据改环境变量注入-codex.md
  - 2026-10-25-网关凭据改环境变量注入-gemini.md
  - 2026-10-25-网关凭据改环境变量注入-glm.md
---

# 裁决：网关凭据改环境变量注入 · 计划三审第 1 轮

> 被审对象：`plan/2026-10-25-网关凭据改环境变量注入-claude.md`（r1，基线 `40dbab4f`）。
> 评审循环第 1/3 轮：codex `pass-after-changes`（1 major、2 minor），gemini `pass`（零意见），glm `pass-after-changes`（1 major、2 minor）。
> 6 条：全部接受。合入后的计划见 `plan/2026-10-25-网关凭据改环境变量注入-r2-claude.md`。
> 裁决前核过的依据：`src/trivium/probes/claude.ts:82-91`（`routeInvocation` 把 `-p` 改写成 `--print`，CODEX-03 / GLM-02 成立）；`src/trivium/adapters/claude-route.ts:70-78`（native 路线不清 `CLAUDE_CODE_OAUTH_TOKEN`，CODEX-01 的宿主令牌落日志路径成立）；`src/trivium/util/exec.ts:488`（commandLine 只由入口与 argv 拼成，CODEX-02 成立）；对 doc/、`scripts/manual-supplement.md`、`skills-src/`、`README.md` 重新 grep「内联注入｜内联 JSON｜内联载荷｜mergeSettingsEnv｜settings_env_source」：`doc/01_requirements/稳定版需求说明书.md:61` 确为漏列的第三处（GLM-01 成立），除计划已列各处与历史报告 / 主设计变更记录外没有第四处。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| --- | --- | --- | --- | --- | --- |
| CODEX-01 | codex | major | 接受 | 属实：假 CLI 按计划会把继承来的全部 `ANTHROPIC_` / `CLAUDE_` 键连值写进日志，native 路线不清 `CLAUDE_CODE_OAUTH_TOKEN`，宿主若以该变量登录，零配额测试就会把真实令牌明文落进夹具目录（`TRIVIUM_KEEP_FIXTURES=1` 或被硬杀时还会留下）。两道都加：装置层先把宿主 `ANTHROPIC_` / `CLAUDE_` 前缀变量全部摘下保存、finally 原样恢复，只放合成假值；假 CLI 只对「夹具声明的键」记值，其余前缀键只记键名 | r2 §2.1 装置第 3 条「宿主变量隔离」与第 1 条假 CLI 记录口径；谓词里 `CLAUDE_` 前缀改为「恰等于」 |
| CODEX-02 | codex | minor | 接受 | 属实：argv 里没有网关值后 commandLine 无可替换之物，断言它含 `<redacted-env>` 会让正确实现红 | r2 §2.1 E1 额外断言：占位符只要求 stdout / stderr；commandLine 只断言不含任何网关值 |
| CODEX-03 | codex | minor | 接受 | 属实：`routeInvocation` 把 `-p` 改写成 `--print`，假 CLI 记的是最终 argv | r2 §2.1 E3 臂覆盖判据改为「含 `--print` 且无 `--verbose`」 |
| GLM-01 | glm | major | 接受 | 属实：需求说明书第 61 行写「网关配置经 `--settings` 内联载荷注入」，是正式需求承诺，修复后直接矛盾；已重跑对账 grep，无第四处 | r2 §4 文档交付补该处；收口前再跑一次同一组对账 grep 并把读数写进报告 |
| GLM-02 | glm | minor | 接受 | 判据错误与 CODEX-03 同一事实，一并改；三类按需 spawn 臂的前置写明，防止装置空转被误归因 | r2 §2.1 E3 判据；装置第 1 条补三个前置（`result` 事件使读探针 completed、受限记忆臂零 tool_use 且不含哨兵、`assetRoot` 传 `ASSET_ROOT`），并注明沿用 `claude-route-stability` 已能跑完各臂的假 CLI 形态 |
| GLM-03 | glm | minor | 接受 | 合理：同开时 profile 只覆盖部分键会出现「网关端点 + profile 令牌」一类混配，401 无线索可循；处置仍是只登记不改码，但登记句要把这一形态和排障第一步写全。wrapper 行为属外部实现、未实测，登记里如实标「推理、未实测」 | r2 §1.5 登记句；§4 部署手册 §1a 补同一句 |

## 无改动的部分

gemini 零意见。计划主体（唯一注入函数、两条出口、argv 构造器去网关通道、`--version` / `--help` 不动、指纹不改、变异 M1–M11、本机零配额验收与 Windows 验收清单）三侧都认为成立，不改。
