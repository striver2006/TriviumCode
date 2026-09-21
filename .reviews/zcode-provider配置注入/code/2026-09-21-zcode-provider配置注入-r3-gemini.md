---
schema: trivium.review.v1
topic: zcode-provider配置注入
stage: code
role: gemini
vendor: antigravity
agent_cli: agy/1.2.7
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
run_id: 20260921T080553Z
rerun_index: 3
snapshot_hash: sha256:44f36cfcd10776a9f18560c09eef7e1f62036d981691f355e0658422e27f58b2
blind: true
started_at: 2026-09-21T08:05:54.204Z
finished_at: 2026-09-21T08:20:51.289Z
duration_s: 310
tool_calls:
  read: 36
  grep: 14
  glob: 2
  run_command: 0
  project_reads: 19
evidence_ok: true
verdict: approve-with-nits
findings_count:
  blocker: 0
  major: 0
  minor: 1
  nit: 2
degraded: false
parse_fallback: false
peer_deny: false
drift: false
consulted_unverified: true
joint_check:
  state: skipped-insufficient-sides
  effective_sides: 1
heterogeneous: true
session_id: 76b32bcf-8239-4209-8902-8c4d12360f0f
---

# 代码审查：zcode-provider配置注入

> Critic-A · Google Antigravity ｜ 模型 `gemini-3.8-flash-high`
> ｜ 运行 `20260921T080553Z` ｜ 第 3 轮
> ｜ 本轮审核者 codex、gemini

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

本轮 r2 裁决十三项落点全部到位，三处超出裁决表的附带处理与三处判据顺序调整均论证充分、逻辑成立且未制造新的误判误放；
环境变量清除语义全面覆盖了 invokeZcode 与 probeReadonlyFlags，消除了宿主环境变量穿透风险；
codex 侧模型档位（profile: qwen 与 slot: qwen3.8-flash）在家族和模型槽两个维度完全一致，EV-82 与 EV-83 的登记及达成边界真实准确；
本轮无 blocker 与 major 缺陷，仅存在 1 处新增可用性判据单测缺失（test-gap）与 2 处陈旧文案/测试标题不一致（nit），整体质量良好，建议 approve-with-nits。

**结论**：`approve-with-nits`

## 审查意见（共 3 条：次要 1 ｜ 吹毛求疵 2）

### AGY-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `test/unit/zcode-availability.test.ts:50` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | high |

**问题**：zcodeAdapter.availability() 新增了 p.provider_config?.builtin_file === null 布局判据并先于 readonly_flags.length === 0 判空，以防止将布局问题误报为「请升级 ZCode」，但 test/unit/zcode-availability.test.ts 未对这一新增分支及其优先级建立单测守卫。

**依据**：src/trivium/adapters/zcode.ts:433-435 新增了 if (p.provider_config?.builtin_file === null) return { ok: false, reason: ZCODE_PROVIDER_CONFIG_UNRESOLVED_HINT }，且注释明确要求先于旗标判空执行；但在 test/unit/zcode-availability.test.ts 中仅有 4 条针对 probed_at、entrypoint 与 --disallowed-tools 的用例，未覆盖 builtin_file === null 以及「builtin_file === null 且 readonly_flags 为空」时优先返回安装布局提示的断言。

**建议**：在 test/unit/zcode-availability.test.ts 中补充用例，断言 builtin_file === null 时返回 ZCODE_PROVIDER_CONFIG_UNRESOLVED_HINT，以及当两者同时触发时确保布局提示优先于旗标判空提示。

### AGY-02 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `test/unit/zcode-provider-env.test.ts:207` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | high |

**问题**：test/unit/zcode-provider-env.test.ts:207 用例标题遗留了 r1 阶段的「（不看退出码）」字样，与 r2 实现（收进 if (r.code !== 0) 门控）及相邻用例表述相悖。

**依据**：在 r2 中根据意见已将 provider_config_unresolved 严格收进 src/trivium/adapters/zcode.ts:312 的 if (r.code !== 0) 分支，且 test/unit/zcode-provider-env.test.ts:222 专门测试了 exit 0 门控；但 test/unit/zcode-provider-env.test.ts:207 的用例名仍为「内置文件不在 → 不注入，CLI 原话进 failureKind=provider_config_unresolved（不看退出码）」。用例内部假入口实际执行的是 process.exit(1)，若改为 exit 0 判定就会转为 'none'。

**建议**：更新该测试标题，删去「（不看退出码）」或改准为「退出码非 0 且 stderr 匹配」，消除与实际门控逻辑相悖的陈旧描述。

### AGY-03 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/zcode.ts:76` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：ZCODE_PROVIDER_CONFIG_UNRESOLVED_HINT 常量注释与设计文档正文仍称「三处同源」，遗漏了 doctor.ts 布局阻断的实际消费点（实为四处同源）。

**依据**：src/trivium/doctor.ts:512 已通过 blockers.push(ZCODE_PROVIDER_CONFIG_UNRESOLVED_HINT) 直接消费该常量，设计文档变更记录（doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md:3203）也正确记录了「探活 / availability() / run() / doctor 同源」；但 src/trivium/adapters/zcode.ts:76 的注释以及设计文档 §3.3（doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md:249）与 §11.3（line 2414）仍写着「三处同源：适配器探活详情、availability() 的不可用原因、critic.run() 的失败提示」，未将 doctor 列入。

**建议**：将 src/trivium/adapters/zcode.ts:76 及设计文档正文中的「三处同源」更正为「四处同源（探活、availability、run、doctor blocker）」。

## 认为正确的部分

- P-28～P-30 的落点全面彻底：zcodeProviderEnv 恒定返回两个配置键、缺的置 undefined，成功阻断宿主环境变量泄露到空 HOME 旗标探针，执行点 invokeZcode 与探针 probeReadonlyFlags 均获完整保护。
- probeReadonlyFlags 在 indeterminate 状态下不覆写 readonly_flags 且保留旧值，在后续模型调用中使用 probe.readonly_flags 替代 flags.accepted，有效防止了无只读参数裸跑真实模型调用的严重安全隐患。
- 三处判据顺序调整完全合理：availability() 布局优先于旗标判空避免了误导性升级排查；failureKind 收进 r.code !== 0 准确消除了退 0 诊断行误伤；doctor 布局与旗标 blocker 解绑 response_field 使得 --no-model-calls 下依然能精准阻断。
- 对 EV-82（0.16.9 config_copy 模型覆盖失效）保持了高度克制与严谨纪律，将其作为达成边界记录并禁止 glm 担任审核者，未在无计划双审的情况下擅自动用含凭据的个人配置。
- 对 CODEX-03 提出的 os.homedir() 路径口径问题，本轮如实记录 note 并将切换 os.userInfo().homedir 登记为 EV-83，避免了仓促改动导致多处用户目录口径撕裂。

## 未覆盖范围（本侧盲区）

- macOS 环境真实运行已安装的 /Applications/ZCode.app 0.16.9 验证（受限于只读无写与无终端执行环境，未在物理宿主机直接发起进程执行，依赖代码静态推演与留痕比对）。
- 宿主环境在 Linux 等非 macOS 系统下 ZCode 路径派生与应用包结构的异构变异（本流水线基线限定 macOS）。

## 实际查阅的项目文件

- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/02_design/LLD_orchestrator.md`
- `doc/05_testing/REPORT_2026-09-11_m0_probe.md`
- `doc/05_testing/evidence/zcode-provider-config-20260920/probe-outputs.md`
- `doc/05_testing/evidence/zcode-provider-config-20260920/r2-implementation-doctor-20260921.md`
- `doc/06_deployment/RUNBOOK_pipeline_ops.md`
- `doc/07_manuals/QUICKSTART.md`
- `doc/08_project/BACKLOG.md`
- `src/trivium/adapters/zcode.ts`
- `src/trivium/probes/zcode.ts`
- `src/trivium/doctor.ts`
- `src/trivium/types.ts`
- `src/trivium/util/exec.ts`
- `src/trivium/preflight.ts`
- `src/trivium/config.ts`
- `test/unit/zcode-provider-env.test.ts`
- `test/unit/zcode-availability.test.ts`
- `.trivium/config.yaml`
- `.reviews/zcode-provider配置注入/code/2026-09-20-zcode-provider配置注入-r2-gemini.md`
- `.reviews/zcode-provider配置注入/code/2026-09-20-zcode-provider配置注入-r2-response-claude.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":36,"grep":14,"glob":2,"run_command":0,"project_reads":19}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
