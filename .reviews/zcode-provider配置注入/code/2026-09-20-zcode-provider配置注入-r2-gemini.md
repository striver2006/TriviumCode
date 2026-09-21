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
run_id: 20260920T083936Z
rerun_index: 2
snapshot_hash: sha256:8515256583ef586e6aeeb588b1977860e91044cebc6562909c1ee0efa8fb158e
blind: true
started_at: 2026-09-20T08:39:36.946Z
finished_at: 2026-09-20T08:46:43.317Z
duration_s: 364
tool_calls:
  read: 36
  grep: 12
  glob: 1
  run_command: 0
  project_reads: 29
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 0
  major: 2
  minor: 3
  nit: 1
degraded: false
parse_fallback: false
peer_deny: false
drift: false
joint_check:
  state: skipped-insufficient-sides
  effective_sides: 1
heterogeneous: true
session_id: 50de6aba-f97b-4d0b-a1b7-8eee1b0f3b45
---

# 代码审查：zcode-provider配置注入

> Critic-A · Google Antigravity ｜ 模型 `gemini-3.8-flash-high`
> ｜ 运行 `20260920T083936Z` ｜ 第 2 轮
> ｜ 本轮审核者 codex、gemini

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

本次变更核心逻辑成立且实测依据详实，但存在两处主要缺陷需要修正：
1. failureKind 判定在未检查 r.code !== 0 的情况下无条件匹配宽泛的 /Built-in Provider Config/，可能在正常退出时产生误判阻断；
2. probeReadonlyFlags 未在 env 中将 ZCODE_PERSONAL_PROVIDER_CONFIG_FILE 置为 undefined，导致宿主环境变量泄漏时穿透空 HOME 触发真实模型调用；
此外存在 entry 软链解析缺失及 doctor --no-model-calls 下 blocker 漏报等次要问题，建议修改后再合入。

**结论**：`request-changes`

## 审查意见（共 6 条：重要 2 ｜ 次要 3 ｜ 吹毛求疵 1）

### AGY-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/zcode.ts:193` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：failureKind 判据未限定 r.code !== 0，且正则裸匹配 /Built-in Provider Config/；若子进程成功退出（code 0）但 stderr 含有该短语，或其它非零失败信息中提及该短语，均会被直接误判为 provider_config_unresolved，导致误报并误导排查方向。

**依据**：src/trivium/adapters/zcode.ts:73 将正则定为 /Built-in Provider Config/；而在 src/trivium/adapters/zcode.ts:193 中，let failureKind 判定直接在最外层执行 if (ZCODE_PROVIDER_CONFIG_UNRESOLVED_RE.test(r.stderr))，完全未校验 r.code !== 0。若 ZCode 正常执行退 0 时在 stderr 打出含该名词的诊断/加载行，或在其它异常（如 API key 无效）时输出该名词，均会被该分支直接拦截。test/unit/zcode-provider-env.test.ts:180-184 仅测了错误正例，未覆盖正常输出与 exit 0。

**建议**：将 provider_config_unresolved 判据移入 if (r.code !== 0) 分支内，并将正则表达式收紧，加入错误动词上下文（例如 /(?:无法定位|Cannot locate|Failed to (?:locate|load|find)).*Built-in Provider Config/i）。

### AGY-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/probes/zcode.ts:110-118` |
| 类别 | security ｜ 层次 code |
| 置信度 | high |

**问题**：probeReadonlyFlags 未在 env 中屏蔽宿主环境继承的 ZCODE_PERSONAL_PROVIDER_CONFIG_FILE；若当前执行环境包含该变量，子进程将被注入个人配置，导致 7 个候选旗标全部触发真实模型调用，击穿 P-30 的零配额防线。

**依据**：src/trivium/probes/zcode.ts:111 构造 providerEnv 时仅设置了 ZCODE_BUILTIN_PROVIDER_ENV，未设置 ZCODE_PERSONAL_PROVIDER_ENV。而在 src/trivium/util/exec.ts:110-114 中，run 会继承 process.env，仅在 key 的取值为 undefined 时才会 delete。doc/05_testing/REPORT_2026-09-11_m0_probe.md:301（P-30）已明确指出两份配置同时存在时空 HOME 无法阻断模型调用。

**建议**：在 probeReadonlyFlags 传给 run 的 env 对象中显式包含 [ZCODE_PERSONAL_PROVIDER_ENV]: undefined，确保子进程环境变量强制剔除该配置。

### AGY-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/zcode.ts:83-91` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：zcodeProviderConfigPaths 未对 entry 执行 realpath 解析，当 entry 为符号链接时派生的内置配置文件路径错误，导致存在性门控失效、漏注入环境变量。

**依据**：src/trivium/adapters/zcode.ts:88 使用 path.resolve(path.dirname(entry), '../config/provider/zcode-builtin.json')。若 entry 为符号链接（如 ~/.local/bin/zcode 指向 /Applications/ZCode.app/Contents/Resources/glm/zcode.cjs），path.dirname 会定位到 ~/.local/bin，推导出的 builtin 路径不存在，导致 src/trivium/adapters/zcode.ts:107 的 exists(p.builtin) 误判为不存在而不注入变量。

**建议**：在推导内置配置相对路径前，先对 entry 使用 fs.realpath / realpathSync 解析真实物理路径（若 ENOENT 则回退原路径）。

### AGY-04 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/zcode.ts:401-408` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | high |

**问题**：zcodeAdapter.availability() 与 critic.run() 未同步 provider_config 失败提示，在探针未跑通时依然将使用者错误引导至 ~/.zcode/cli/config.json 凭据排查。

**依据**：src/trivium/doctor.ts:503-506 在 response_field === null 处已追加 provider_config 引导，但 src/trivium/adapters/zcode.ts:405 的 availability() 在同一条件下仍写死「请确认 ~/.zcode/cli/config.json 存在」，在 preflight 中会产生误导；同时 src/trivium/adapters/zcode.ts:473-478 的 critic.run() 未对 provider_config_unresolved 分档给出引导性 hint。

**建议**：同步 availability() 的 reason 文案与 doctor.ts:505 一致，并在 critic.run() 中为 failureKind === 'provider_config_unresolved' 增加针对安装布局的提示。

### AGY-05 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/doctor.ts:501-507` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：doctor --only zcode --no-model-calls 场景下，缺失内置配置导致旗标全部 indeterminate 时，doctor 产生 0 blocker 误报通过，随后 preflight 依然失败。

**依据**：src/trivium/doctor.ts:501 为 else if (r.probe.response_field === null && !opts.skipModelCalls)。当传入 --no-model-calls 时该分支被跳过，即使 r.probe.provider_config?.builtin_file 为 null 且 readonly_flags 为空，doctor 也不会产出任何 blocker，而 doc/06_deployment/RUNBOOK_pipeline_ops.md:264 正是建议用户运行该命令。

**建议**：在 doctor.ts 中对 r.probe.provider_config?.builtin_file === null 或 r.probe.readonly_flags.length === 0 设置无条件 blocker，不被 skipModelCalls 旁路。

### AGY-06 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/types.ts:330` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | medium |

**问题**：types.ts 与设计文档标注 probe.provider_config 的消费方为 preflight 失败详情，与 preflight.ts 实际不消费该字段的现状存在契约漂移。

**依据**：src/trivium/types.ts:330 与 doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md:279 均声明该字段被 preflight 的失败详情消费，但检索 src/trivium/preflight.ts 全文，并未直接读取 probe.cli.zcode.provider_config 字段，preflight 详情实际来自 authProbe() 动态运行时返回值。

**建议**：更正 types.ts 与设计文档中的消费方描述，明确该字段仅作为 doctor 输出与结论落盘的快照，preflight 失败详情由 authProbe 动态生成。

## 认为正确的部分

- P-28～P-30 的机理定位准确透彻，查明了 ZCode 0.16.9 provider 配置先于参数解析定位的执行时序，以及空 HOME 挡不住自带默认模型的个人配置等真实踩坑事实。
- 新增纯函数 zcodeProviderConfigPaths 与存在性门控 zcodeProviderEnv，坚持只判文件有无而不读取个人配置内容（0600 含凭据），严格守住了 NFR-04 凭据安全红线。
- probeReadonlyFlags 引入 indeterminate 第三态，成功拦截了定位失败时参数未解析就退出导致的假阳性接受，修复了 2026-09-19 doctor 污染 readonly_flags 的历史遗留缺陷。
- test/unit/zcode-provider-env.test.ts 采用假入口模拟 CLI 的三种 stderr 行为，设计巧妙，在完全不消耗真实配额的情况下实现了对路径派生、门控和 flag probe 的断言覆盖。

## 未覆盖范围（本侧盲区）

- macOS 实际环境调用真实 /Applications/ZCode.app 运行 0.16.9 验证（本审查员为只读环境无终端执行工具，完全基于代码推演与历史实测日志进行逻辑审查）。
- 不同发行版或自定义安装路径下 ZCode 个人配置 ~/.zcode/v2/provider_config.json 的结构变异。

## 实际查阅的项目文件

- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/02_design/LLD_orchestrator.md`
- `doc/05_testing/README.md`
- `doc/05_testing/REPORT_2026-09-11_m0_probe.md`
- `doc/05_testing/evidence/zcode-provider-config-20260920/probe-outputs.md`
- `doc/06_deployment/RUNBOOK_pipeline_ops.md`
- `doc/07_manuals/QUICKSTART.md`
- `doc/08_project/BACKLOG.md`
- `src/trivium/adapters/zcode.ts`
- `src/trivium/adapters/claude-trace.ts`
- `src/trivium/config.ts`
- `src/trivium/doctor.ts`
- `src/trivium/probes/zcode.ts`
- `src/trivium/types.ts`
- `src/trivium/preflight.ts`
- `src/trivium/util/exec.ts`
- `src/trivium/util/fsx.ts`
- `test/unit/zcode-provider-env.test.ts`
- `test/unit/zcode-availability.test.ts`
- `test/unit/registry-parity.test.ts`
- `test/contract/disposition-role-assets.test.ts`
- `scripts/claude-admission-control.mjs`

> 编排器从工具轨迹中记录到的读取次数：{"read":36,"grep":12,"glob":1,"run_command":0,"project_reads":29}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
