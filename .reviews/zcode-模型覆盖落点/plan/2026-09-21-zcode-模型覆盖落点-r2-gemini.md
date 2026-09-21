---
schema: trivium.review.v1
topic: zcode-模型覆盖落点
stage: plan
role: gemini
vendor: antigravity
agent_cli: agy/1.2.7
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
run_id: 20260921T111833Z
rerun_index: 2
snapshot_hash: sha256:44a386a03e0d09fa5b07c551c1e877f0e3916ec4684a9857dac9a64b8cbf4b19
blind: true
started_at: 2026-09-21T11:18:33.997Z
finished_at: 2026-09-21T11:43:34.077Z
duration_s: 245
tool_calls:
  read: 23
  grep: 26
  glob: 2
  run_command: 0
  project_reads: 4
evidence_ok: true
verdict: approve-with-nits
findings_count:
  blocker: 0
  major: 0
  minor: 1
  nit: 1
degraded: true
parse_fallback: false
peer_deny: false
drift: false
joint_check:
  state: skipped-insufficient-sides
  effective_sides: 1
heterogeneous: true
session_id: 35a54a65-ea58-44e2-be36-ec57adf90f43
---

# 计划审查：zcode-模型覆盖落点

> Critic-A · Google Antigravity ｜ 模型 `gemini-3.8-flash-high`
> ｜ 运行 `20260921T111833Z` ｜ 第 2 轮
> ｜ 本轮审核者 codex、gemini

> ⚠️ **本次为降级轮次**：有入选审核者未能完成，本结论不构成本轮预期的完整多审。实际完成情况见抬头的审核者清单与 run 元数据的 `degraded_reason`。
>
> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

1. 核心注意项：§4.2 验证判据若选用 GLM-5.3 会重蹈 E1 覆辙（因其恰好是首选模型），必须强制指定次选模型（如 GLM-5.3-Flash）才能确凿区分「导入成功」与「回落兜底」。
2. §1.3 根因改判完全成立：逆向代码证实 fpe 只要探测到个人配置文件存在便短路返回、跳过 importLegacy；r1 注入个人变量恰好构成了屏蔽导入的阻断因。
3. 包内链条无隐藏读取路径：CLI 在 --prompt 模式下恒定传入 standalone，Pqa 校验只要模型前缀规范（provider/model）即放行，命令行无额外模型配置渠道。
4. 路线 L 架构干净闭环：由于 HOME 隔离，CLI 自行写出的 v2 文件稳定落在沙箱内部，已被现有清扫集合严密兜底，凭据面收敛至单文件。
5. 实施清单取舍合理：撤除 r1 中不成熟的个人配置注入与模型拆分，保留覆写裁决、清扫规则与安全警示，方向完全正确。

**结论**：`approve-with-nits`

## 审查意见（共 2 条：次要 1 ｜ 吹毛求疵 1）

### AGY-r2-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `.reviews/zcode-模型覆盖落点/plan/2026-09-21-zcode-模型覆盖落点-r2-claude.md:§4.2` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | high |

**问题**：§4.2 的端到端真实调用验证允许使用「GLM-5.3 或 GLM-5.3-Flash」，使用首位模型 GLM-5.3 无法可靠区分模型覆盖生效与回落兜底（重蹈 E1 证据置信度低的覆辙）。

**依据**：查阅 ~/.zcode/cli/config.json 与 zcode.cjs 内置注册表发现，bigmodel-coding-plan 的首个模型就是 GLM-5.3，第二个才是 GLM-5.3-Flash。若在 §4.2 验证中仍使用默认的 GLM-5.3，一旦 model.main 导入失效回落到首选模型（V4i），输出表现与生效完全相同，存在假阳性盲区。

**建议**：在 §4.2 验收判据中强制指定非首选模型（如 GLM-5.3-Flash）进行真实调用验证，且必须断言实际模型名称与请求的次选模型精确吻合，方可通过。

### AGY-r2-02 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/zcode.ts:400` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：zcodeProviderEnv 的 personalOverride 参数类型与契约需要彻底固化，避免测试或调用方意外传入非 null 导致重新走入 EV-81 困境。

**依据**：src/trivium/adapters/zcode.ts:400 中 zcodeProviderEnv 接收 personalOverride 参数。在路线 L 中，临时个人配置已不再生成，生产链路 invokeZcode 恒定需要屏蔽个人配置文件以防穿透。

**建议**：在 §3.1 改造 invokeZcode 时，将传入 zcodeProviderEnv 的 personalOverride 显式锁定为 null，并在单元测试中固定该预期。

## 认为正确的部分

- §1.3 对 NodePersonalProviderConfigRepository（zcode.cjs:15231）加载短路逻辑的逆向判断准确无误，证实 EV-81 注入个人配置正是阻止 importLegacy 执行的根因。
- 路线 L 摒弃个人配置副本、仅靠 cli/config.json 单文件副本与 legacy 导入生效，从根本上消除了对桌面端私有 Schema（Pqa、provider_config.json）格式演进的脆弱依赖。
- 确认 CLI 模式下 standalone 恒定有效，且在 HOME 隔离下 CLI 自生成的 v2 文件必然限定于沙箱内，被现有的 ZCODE_CREDENTIAL_CARRIERS 集合完整清扫。
- r1 实施资产的裁剪与保留方案合理，保留了模型覆写裁决、名称截断与三件套凭据清扫，彻底撤除了有安全与漂移隐患的个人配置构造链。

## 未覆盖范围（本侧盲区）

- 未发起消耗远端 API 配额的真实 ZCode CLI LLM 交互（由开发阶段在实施完成后依据 §4.2 运行）。
- 未评估未来 ZCode 彻底剥离 legacy 导入时（即完全移除 importLegacy 函数）的长远升级方案（超出本次路线 L 修复论域）。

## 实际查阅的项目文件

- `CLAUDE.md`
- `.reviews/zcode-模型覆盖落点/plan/2026-09-21-zcode-模型覆盖落点-r2-claude.md`
- `.reviews/zcode-模型覆盖落点/plan/2026-09-21-zcode-模型覆盖落点-gemini.md`
- `.reviews/zcode-模型覆盖落点/plan/2026-09-21-zcode-模型覆盖落点-revised-claude.md`
- `src/trivium/adapters/zcode.ts`
- `src/trivium/probes/zcode.ts`
- `test/unit/zcode-model-selection.test.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":23,"grep":26,"glob":2,"run_command":0,"project_reads":4}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
