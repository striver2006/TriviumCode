---
schema: trivium.review.v2
topic: QoderCN官方模型路由与回退阻断
stage: code
role: gemini
vendor: antigravity
agent_cli: agy/1.4.8
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
effort_requested: high
effort_effective: high
effort_effective_source: envelope
tier: null
tier_source: legacy
run_id: 20261027T235110Z
rerun_index: 2
snapshot_hash: sha256:d780bd232f999b20cba54a9938564b9ee2844e3c095d379b61650e2ee207b113
blind: true
started_at: 2026-10-27T23:51:19.919Z
finished_at: 2026-10-28T00:01:22.769Z
duration_s: 446
tool_calls:
  read: 49
  grep: 20
  glob: 1
  run_command: 0
  project_reads: 32
evidence_ok: true
verdict: pass
findings_count:
  blocker: 0
  major: 0
  minor: 0
  nit: 1
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: unknown
access:
  requested_mode: standard
  profile: null
  launcher_requested: /Users/chenzhenbo/.local/bin/agy
  launcher_effective: /Users/chenzhenbo/.local/bin/agy
  wrapper_sha256: null
  configuration_sha256: null
  provider_declared: null
  provider_declared_source: null
  provider_effective: null
  provider_effective_source: null
family_comparisons:
  - left: codex
    right: gemini
    status: unknown
    left_model: null
    right_model: gemini-3.8-flash-high
    left_source: null
    right_source: envelope
    reason: 左侧模型信息缺失
  - left: gemini
    right: glm
    status: different-family
    left_model: gemini-3.8-flash-high
    right_model: bigmodel-coding-plan/GLM-5.3
    left_source: envelope
    right_source: trace
    reason: 模型族不同：gemini / glm
  - left: gemini
    right: claude
    status: different-family
    left_model: gemini-3.8-flash-high
    right_model: claude-opus-5-5
    left_source: envelope
    right_source: envelope
    reason: 模型族不同：gemini / claude
override_reason: 左侧模型信息缺失
session_id: 95ed35e0-f27a-4ed2-a4ba-0d180429f0c9
---

# 代码审查：QoderCN官方模型路由与回退阻断

> Critic-A · Google Antigravity ｜ 回读模型 `gemini-3.8-flash-high` ｜ 请求模型 `gemini-3.8-flash-high`
> ｜ 运行 `20261027T235110Z` ｜ 第 2 轮
> ｜ 本轮审核者 gemini、glm、claude

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

本轮针对上一轮提出的 5 项审查意见（AGY-01 至 AGY-05）进行了完整且到位的修复；
正则表达式放宽后精准匹配真机 stderr 回退告警与 /model 提示尾句，在完整真机输出下早停阻断有效；
辅助进程清理已修正为读取 sameProcess 属性并安全忽略自然退出的进程，消除进程误杀与清理抛错异常；
parse.ts 与 render.ts 已对齐 native_model 透传白名单，探针已打通原生配置 config 来源归属；
preflight 通过 wiredAdapter 成功连通候选审查者的目录提取钩子，自动化集成测试全量通过；
经全面核对官方目录、配置来源、默认证据、请求/回读分离、回退告警与真实适配器接线，结论给予定稿通过。

**结论**：通过（`pass`）

## 审查意见（共 1 条：吹毛求疵 1）

### AGY-r2-01 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/preflight.ts:768` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | high |

**问题**：checkModelAgainstCatalog 中第 749 行已将 catalogModelsFor 改为通过 wiredAdapter(critic) 索引候选适配器，但第 768 行的 normalizeModelForCatalog 仍经由 realAdapters()[critic] 调用；对于 criticEnabled: false 的候选审查侧，若后续适配器实现该钩子将无法触发。

**依据**：src/trivium/preflight.ts:749 使用 wiredAdapter(critic)?.catalogModelsFor?.(cfg, vendorProfile)，而第 768 行调用为 const normalized = realAdapters()[critic]?.normalizeModelForCatalog?.(cfg, model) ?? model;。在 src/trivium/adapters/index.ts:69-76 中，realAdapters() 仅包含 criticEnabled: true 的正式审核者。当前 qoderCnAdapter 虽未定义 normalizeModelForCatalog（通过 ?? model 回退），但两处取表方式不对齐存在未来扩展不一致的维护隐患。

**建议**：将第 768 行的 realAdapters()[critic] 同步替换为 wiredAdapter(critic)，保持目录获取与模型归一取表口径一致。

## 认为正确的部分

- 完整采纳并修复了首轮 5 项审查意见（回退正则、sameProcess 属性判断、透传白名单、config 来源归属与 preflight 接线），真机 stderr 回退阻断在实际输出下成功生效
- 请求与交接快照严格保存官方目录、入口指纹与配置 hash，worker 侧执行确定性比对，防止运行时篡改或默认值漂移
- Auto 路由标签在回读中严格保持 null 底层身份与 unverified 来源，未知计费键独立保存在 usage_labels 中，不盲目推断模型别名
- 退出码为 0 的回退样本在真实适配器下被准确定位为失败（ok=false），原始退出码与执行失败事实完整保留

## 未覆盖范围（本侧盲区）

- Windows 平台下 Qoder CLI 进程启动与临时配置隔离路径处理（当前实现严格保持拒绝在 Windows 上复制认证）
- 消耗真实在线 Token 配额的持续模型推理（审查过程遵循只读约束，不发起在线计费请求）
- Qoder CLI 未来的生产只读审核准入安全矩阵（P2 阶段工具面为空，生产开关保持关闭）

## 实际查阅的项目文件

- `.reviews/QoderCN官方模型路由与回退阻断/code/2026-10-28-QoderCN官方模型路由与回退阻断-gemini.md`
- `.reviews/QoderCN官方模型路由与回退阻断/plan/2026-10-28-QoderCN官方模型路由与回退阻断-r2-codex.md`
- `src/trivium/adapters/qoder-cn-model.ts`
- `src/trivium/adapters/qoder-cn-native.ts`
- `src/trivium/adapters/qoder-cn.ts`
- `src/trivium/adapters/base.ts`
- `src/trivium/adapters/index.ts`
- `src/trivium/agents/registry.ts`
- `src/trivium/config.ts`
- `src/trivium/doctor.ts`
- `src/trivium/model-routing.ts`
- `src/trivium/parse.ts`
- `src/trivium/preflight.ts`
- `src/trivium/probes/qoder-cn.ts`
- `src/trivium/render.ts`
- `src/trivium/report.ts`
- `src/trivium/review.ts`
- `src/trivium/run-protocol.ts`
- `src/trivium/schemas.ts`
- `src/trivium/types.ts`
- `src/trivium/util/exec.ts`
- `src/trivium/util/fsx.ts`
- `skills/dual-critic/schema/run.v3.json`
- `test/unit/qoder-cn-model.test.ts`
- `test/unit/registry-parity.test.ts`
- `test/unit/parse-degrade.test.ts`
- `test/integration/qoder-cn-routing.test.ts`
- `test/contract/entry-render-parity.test.ts`
- `doc/05_testing/REPORT_2026-10-28_QoderCN官方模型路由与回退阻断.md`
- `doc/05_testing/evidence/qoder-cn-model-20261028/directory-2026-10-27T23-15-59-345Z-c54e0b.json`
- `doc/05_testing/evidence/qoder-cn-model-20261028/adapter-2026-10-27T23-49-02-198Z-dd6083.json`

> 编排器从工具轨迹中记录到的读取次数：{"read":49,"grep":20,"glob":1,"run_command":0,"project_reads":32}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
