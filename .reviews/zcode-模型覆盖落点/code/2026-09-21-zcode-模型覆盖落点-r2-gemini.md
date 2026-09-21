---
schema: trivium.review.v1
topic: zcode-模型覆盖落点
stage: code
role: gemini
vendor: antigravity
agent_cli: agy/1.2.7
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
run_id: 20260921T132440Z
rerun_index: 2
snapshot_hash: sha256:21f2452802fa99741572984162421694cf22d4329b9b6b73c3cfda4b9856e4e1
blind: true
started_at: 2026-09-21T13:24:41.579Z
finished_at: 2026-09-21T13:42:37.393Z
duration_s: 379
tool_calls:
  read: 46
  grep: 15
  glob: 0
  run_command: 0
  project_reads: 22
evidence_ok: true
verdict: approve-with-nits
findings_count:
  blocker: 0
  major: 0
  minor: 2
  nit: 1
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: true
session_id: 5c0b121a-75ff-4dad-b737-eb9908e0a508
---

# 代码审查：zcode-模型覆盖落点

> Critic-A · Google Antigravity ｜ 模型 `gemini-3.8-flash-high`
> ｜ 运行 `20260921T132440Z` ｜ 第 2 轮
> ｜ 本轮审核者 codex、gemini

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

r1 应答件十一项落点逐条对账无误，flag 与 version 探针环境清键均与探针臂同形，三分判定严密无错归，白名单重建经真机验证可靠。
代码主干质量过硬，仅发现两处用例接线与落盘测试单侧化的测试咬合度细微缺口（AGY-01、AGY-02），不影响功能正确性。
整体质量优良，判定 approve-with-nits，可放行提交。

**结论**：`approve-with-nits`

## 审查意见（共 3 条：次要 2 ｜ 吹毛求疵 1）

### AGY-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/probes/zcode.ts:713` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | high |

**问题**：probeZcode 将只读参数透传给 probeModelOverride 的接线缺少单元/集成测试咬住，存在改动后接线脱落逃逸的风险

**依据**：查阅 src/trivium/probes/zcode.ts:713，probeZcode 调用了 probeModelOverride(entry, node, fx.root, { readonlyArgs: readonlyArgsFromProbe(probe.readonly_flags) })。查阅 test/unit/zcode-model-selection.test.ts:574-595，现有测试均是直接调用 probeModelOverride(..., { readonlyArgs: ... }) 验证参数透传；而在整个测试集中检索 probeZcode 调用，仅有 test/unit/preflight.test.ts:417 一处，且传入 entry 为 null，直接在行 601 返回，并未触达行 713。若将行 713 改为不传 readonlyArgs，全仓测试依然全部通过。

**建议**：在探针单元测试中补充通过合成入口驱动 probeZcode 真实路径的用例，断言 probeZcode 确实将 probe.readonly_flags 转换后的只读参数传入了探针臂中。

### AGY-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `test/integration/code-stage.test.ts:372-386` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | high |

**问题**：review.ts 组装 run.json 时 model_override_applied 字段的写入与落盘验证在集成测试中存在单侧化盲区，仅测了桩侧缺席，未测正向存在

**依据**：查阅 test/integration/code-stage.test.ts:372-386，该用例使用 STUB 运行，仅断言了未尝试覆盖时 'model_override_applied' in entry === false（锁住了 review.ts:1442 的条件展开逻辑）。但全仓没有任何集成测试或针对 review.ts 的测试验证当 r.model_override_applied 为 true/false/null 时，该字段能正确写入 run.json 且符合 run.v2.json schema 校验要求。若 review.ts:1444 字段键名发生手误，现有用例无法捕获。

**建议**：在集成测试或 run-meta 契约测试中补充包含真实/模拟 override 结果的用例，端到端咬住 model_override_applied 为 true/false/null 时在 run.json 中的落盘与 schema 校验。

### AGY-03 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `test/unit/zcode-model-selection.test.ts:372-382` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | medium |

**问题**：run() 正格用例中请求模型与日志生效模型的前缀相同，未在 run() 层面覆盖 P-31 异形 provider 前缀的判等场景

**依据**：查阅 test/unit/zcode-model-selection.test.ts:372-382，ok 用例中请求模型为 GLM-5.3-Flash（限定后为 bigmodel-coding-plan/GLM-5.3-Flash），回读生效模型同样为 bigmodel-coding-plan/GLM-5.3-Flash，两者的 provider 前缀完全一致。虽然 decideModelOverride 单测覆盖了 UUID 前缀情况，但若 run() 内部误用裸字符串判等，该正格测试依然会通过。

**建议**：在 runWithFakeEntry 的正格测试中增加一腿回读模型为不同 providerId 形态（如 84044858-fake/GLM-5.3-Flash）的测试，确保端到端流程咬住 zcodeModelTail 的尾部比对。

## 认为正确的部分

- r1 应答件十一项落点全部到位：probeReadonlyFlags 改为整包 spread，且与 probeZcodeEntry、probeModelOverride 三条探针路径同形清空三个目录键与两个凭据键，空 HOME 隔离与零配额前提得到坚实保障
- probeModelOverride 的三分判定（config_copy / global / null）逻辑清晰严密，崩溃、超时、配置定位失败、模型层无 v2 与正常五类形态归类准确，无任何未定论形态被误判为 global
- buildProbeCliConfig 采用白名单重建彻底切断 headers/token 等异形凭据进入副本的泄露路径，真实 0.16.9 CLI 判定 config_copy 实证了白名单字段充分满足 legacy 导入诉求
- decideModelOverride 抽成纯函数且仅比对 modelId 段，有效免疫了 providerId 别名与 UUID 并存带来的误报，guard 仅播报不阻断的防线设计恰当
- 设计文档 §21 v1.3.33 第八段、BACKLOG EV-82 关闭状态与结案判据、M0 P-28 补记机理与当前代码改动及实测完全一致

## 未覆盖范围（本侧盲区）

- 真实物理机在完全缺失 ZCode 应用环境下的底层系统回退行为（本轮为静态代码与合成夹具验证）
- 真实网络环境下调用非本地 Provider 时可能遇到的网络长时挂起或非标 HTTP 响应状态码

## 实际查阅的项目文件

- `.reviews/zcode-模型覆盖落点/code/2026-09-21-zcode-模型覆盖落点-response-claude.md`
- `.reviews/zcode-模型覆盖落点/code/2026-09-21-zcode-模型覆盖落点-gemini.md`
- `.reviews/zcode-模型覆盖落点/code/_meta/changes-20260921T132440Z.diff`
- `.reviews/zcode-模型覆盖落点/plan/2026-09-21-zcode-模型覆盖落点-r3-revised-claude.md`
- `src/trivium/probes/zcode.ts`
- `src/trivium/adapters/zcode.ts`
- `src/trivium/review.ts`
- `src/trivium/guard.ts`
- `src/trivium/types.ts`
- `skills/dual-critic/schema/run.v2.json`
- `test/unit/zcode-model-selection.test.ts`
- `test/unit/zcode-provider-env.test.ts`
- `test/integration/code-stage.test.ts`
- `test/unit/preflight.test.ts`
- `test/unit/known-forms-parity.test.ts`
- `test/helpers/fixture.ts`
- `CLAUDE.md`
- `AGENTS.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/05_testing/REPORT_2026-09-11_m0_probe.md`
- `doc/06_deployment/RUNBOOK_pipeline_ops.md`
- `doc/08_project/BACKLOG.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":46,"grep":15,"glob":0,"run_command":0,"project_reads":22}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
