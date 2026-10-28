---
schema: trivium.review.v2
topic: QoderCN官方模型路由与回退阻断
stage: plan
role: glm
vendor: zcode
agent_cli: zcode/0.17.0
model_requested: GLM-5.3
model_effective: bigmodel-coding-plan/GLM-5.3
model_effective_source: trace
effort_requested: null
effort_effective: null
effort_effective_source: null
tier: null
tier_source: legacy
model_route: config_copy
run_id: 20261027T230515Z
rerun_index: 1
snapshot_hash: sha256:a43539ea12b0f9c3c9addcb0e0b8cdbea00cc0cb83dcee28f48f99acbc7346ec
blind: true
started_at: 2026-10-27T23:05:23.947Z
finished_at: 2026-10-27T23:12:52.788Z
duration_s: 306
tool_calls:
  read: 9
  grep: 5
  glob: 0
  run_command: 0
  project_reads: 13
evidence_ok: true
verdict: pass
findings_count:
  blocker: 0
  major: 0
  minor: 3
  nit: 0
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: unknown
access:
  requested_mode: standard
  profile: null
  launcher_requested: /Applications/ZCode.app/Contents/Resources/glm/zcode.cjs
  launcher_effective: /Applications/ZCode.app/Contents/Resources/glm/zcode.cjs
  wrapper_sha256: null
  configuration_sha256: null
  provider_declared: null
  provider_declared_source: null
  provider_effective: null
  provider_effective_source: null
family_comparisons:
  - left: codex
    right: glm
    status: unknown
    left_model: null
    right_model: bigmodel-coding-plan/GLM-5.3
    left_source: null
    right_source: trace
    reason: 左侧模型信息缺失
  - left: gemini
    right: glm
    status: different-family
    left_model: gemini-3.8-flash-high
    right_model: bigmodel-coding-plan/GLM-5.3
    left_source: envelope
    right_source: trace
    reason: 模型族不同：gemini / glm
  - left: glm
    right: claude
    status: different-family
    left_model: bigmodel-coding-plan/GLM-5.3
    right_model: claude-opus-5-5
    left_source: trace
    right_source: envelope
    reason: 模型族不同：glm / claude
override_reason: 左侧模型信息缺失
session_id: sess_d7f4ffac-7295-49f8-aa9b-f70cdc7335c0
---

# 计划审查：QoderCN官方模型路由与回退阻断

> Critic-B · 智谱 ZCode ｜ 回读模型 `bigmodel-coding-plan/GLM-5.3` ｜ 请求模型 `GLM-5.3`
> ｜ 运行 `20261027T230515Z`
> ｜ 本轮审核者 gemini、glm、claude

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

该计划忠实覆盖任务目标原文的全部要点（默认解析、显式覆盖、启动前拒绝、运行期回退中止判失败、请求/声明/回读三分离、Auto 仅作标签、真实适配器与 worker requested_routes 接线、不动用户全局配置），且与上游 P2 决策（doc/08_project/KimiCode与QoderCN双角色接入实施计划.md:56-58）逐条对得上。我亲自核实了仓库现状：计划 §2 的现状陈述准确（qoder-cn-model.ts 确实只消费人工 catalog、旧逻辑只扫 stderr、测试样本为合成三档不同值；run-protocol.ts:322-330 的 worker 五字段 frozen 比对与 registry.ts/config.ts 中 qoder-cn 的 L2 候选登记、开关关闭均属实）；§5 的 stdout/stderr 按行增量监听、发现违例立即 stopEarly、结束后含无换行尾部的全量复核，在 util/exec.ts:27,34,53,636-637,676 有现成机制支撑，机制依赖真实可行；退出 0 仍判失败有真实反例（证据文件 exit_code=0 且 stderr 含回退告警）。发现三条 minor 口径缺口：官方默认的两个来源如何合成单一 catalog 未写裁决规则；官方 Default 仅 Auto 的现实下 P2 完成态定义在 §6 与 §7/上游之间存在张力；身份未核实结论的计票地位未定义且与现有代码的缺回读即失败语义有分歧。三者均为实施时需澄清的口径，不构成返工级风险，故判通过。

**结论**：通过（`pass`）

## 审查意见（共 3 条：次要 3）

### GLM-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `被审计划 §3.3–§3.4` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | medium |

**问题**：「官方默认路由」（--list-models 的默认标记）与「已验证原生配置」（隔离根下实测的默认）是两个独立来源，计划要求三档绑定同一份已核实的官方原生默认，但没有写明两者都可得且不一致时如何裁决：取目录、取配置、还是冲突即阻断。现有 QoderNativeModelCatalog 的 source 是单选枚举、defaults 是单一表，实现时必须回答两份解析结果如何合成一份 catalog，这是留给实现的自由裁量。

**依据**：src/trivium/adapters/qoder-cn-model.ts:11-16（source 单选枚举、defaults 单表，无合成规则）；被审计划 §3.3/§3.4 的两处来源表述；doc/05_testing/evidence/kimi-qoder-cn-20261027-failure/qoder-cn-failure-2026-10-27T15-54-24-268Z-23e4a1e1.json 的 init 与 assistant 事件 model 字段实测为 Auto（隔离路线默认即 Auto 标签的实例）。

**建议**：在 §3.4 补一句裁决规则，例如：两来源同时可得时以隔离原生路线实测为准、目录标记仅作旁证，或两者不一致即按「默认不明」阻断，避免实现各自解释。

### GLM-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `被审计划 §6（macOS 真 CLI 判据）与 §3.4、§7` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | high |

**问题**：计划 §2 自引的官方文档说 CN 版 Default 仅 Auto；若取证结论确是官方默认只有 Auto 路由标签、无具体模型，按 §3.4「配置缺失且不能证明官方内置默认时失败」，三档默认解析将结构性不可得。§6 完成判据写「取得账号目录和默认正对照」，隐含正对照必须存在；而上游 P2（08_project 计划第 56 行「缺失时明确报配置缺失」）与 §7 把负结论加阻塞报告视为合法交付形态。官方仅 Auto 情形下 P2 的完成态是「必须取得具体默认」还是「机制交付加负结论取证即完成」两种读法并存，验收口径不唯一。

**依据**：被审计划 §2、§3.4、§6、§7 的相关表述；doc/08_project/KimiCode与QoderCN双角色接入实施计划.md:56-57；历史证据文件 default_source 段 model 为 auto 且 production_default_verified 为 false。

**建议**：在 §6 明确：若取证证实官方原生默认仅为 Auto 标签，完成判据是「回退阻断与显式覆盖机制交付，默认解析以负结论如实报告」还是保持该项阻塞待官方提供具体默认，二选一写死。

### GLM-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `被审计划 §4.3 与 §5.3–§5.4` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | medium |

**问题**：「身份未核实」（缺底层回读，保持 null/unknown）的审查结论在闸门计票中的地位未定义。§5.4 只规定失败审查内容不得进入有效结果与计票；§5.3 把缺回读定位为标注而非失败；而现状代码把缺回读也抛 QoderModelFallbackError 即判失败。P2 期间 criticEnabled 关闭使该路径在生产不可达，但 §4.3 已把证据对象接进 run.v3.requested_routes 与结果结构，未核实票算有效票、无效票还是告警需要在准入前有定义，宜在本计划一并写明，避免实现后再改判定语义。

**依据**：src/trivium/adapters/qoder-cn-model.ts:169-171（缺回读即抛 QoderModelFallbackError）；被审计划 §5.3「按身份未核实标注」、§5.4「失败审查内容不得进入有效结果/计票」、§4.3 证据对象接线。

**建议**：在 §5 补一行：身份未核实的运行结论按告警或无效票处理（或明确推迟到 P3 准入时定义并注明当前生产不可达），并与现有缺回读即失败的旧语义划清边界。

## 认为正确的部分

- §2 现状陈述经代码核实准确：qoder-cn-model.ts 只消费人工提供的 catalog，测试用 cn-default/cn-flash/cn-pro 合成样本，旧逻辑确实只扫 stderr（qoder-cn-model.ts:160），run-protocol.ts:325-326 的五字段 frozen 比对与计划陈述一致。
- §3.4 三档绑定同一份官方原生默认忠实于上游 P2 决策（08_project 计划第 57 行原文「default/flash/pro 使用同一已解析默认值」），且 §6 已列「默认三档同源」单元测试，与现有三档不同值的合成样本将一并修正。
- §5 的 stdout/stderr 按行增量监听、发现违例立即 stopEarly 杀进程树、结束后含无换行尾部的全量复核，在 util/exec.ts 已有 onStdoutLine/onStderrLine/stopEarly/killTree 与残留行 flush 的现成机制支撑，方案可行且与既有超时/取消纪律一致。
- §5.1 告警只从厂商信封/状态读取、不扫 assistant 正文的边界正确——现有测试中正文含「consider using path.join instead」的干扰样例正是这一误杀面，计划予以规避。
- §4.4 的 Schema 同步清单与 AGENTS.md 改动同步清单一致，run.v1/v2 只读契约不补写的处理正确。
- §5.4 厂商退出码与编排结论分离、exit 0 且违例仍判失败，有真实反例支撑（证据文件 exit_code 为 0 且 stderr 含 Model ... using ... instead 告警）。
- 隔离执行形态（--config-dir 隔离根加 --setting-sources user 加 --no-session-persistence）在历史证据 argv 中已被实测使用，计划沿用而非新造。
- 范围纪律清晰：不提前开放生产准入、保留既有 Kimi 工件与历史反例、未授权不提交推送。

## 未覆盖范围（本侧盲区）

- 本侧只读，未实测任何 CLI：qoderclicn 1.1.80 的 --list-models 输出形态、隔离根下的默认行为、1.1.80 回退文案是否与 1.1.79 反例一致均未验证，相关判断是基于计划陈述与历史证据的推理；计划声称的当前版本 1.1.80 也无法核实。
- 未通读主设计 §11 全文与 PROTOCOL 协议全文，schema 扩展涉及的契约面细节未逐条核对，仅核对了同步清单与仓库改动同步清单的一致性。
- 未读 adapters/ 目录其余适配器实现与 hooks.ts，§4.1 统一 wiredAdapter 表接线的可行性按 registry.ts 与 config.ts 现状推断。
- Windows 侧清理与 ACL 机制未核实，按计划声明列为未测。

## 实际查阅的项目文件

- `.reviews/QoderCN官方模型路由与回退阻断/plan/2026-10-28-QoderCN官方模型路由与回退阻断-codex.md`
- `src/trivium/adapters/qoder-cn-model.ts`
- `test/unit/qoder-cn-model.test.ts`
- `doc/05_testing/evidence/kimi-qoder-cn-20261027-failure/qoder-cn-failure-2026-10-27T15-54-24-268Z-23e4a1e1.json`
- `src/trivium/run-protocol.ts`
- `src/trivium/review.ts`
- `src/trivium/util/exec.ts`
- `src/trivium/types.ts`
- `src/trivium/agents/registry.ts`
- `doc/08_project/KimiCode与QoderCN双角色接入实施计划.md`
- `CLAUDE.md`
- `doc/02_design/README.md`
- `src/trivium/config.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":9,"grep":5,"glob":0,"run_command":0,"project_reads":13}

---

*本文档由 TriviumCode 编排器从 `glm` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
