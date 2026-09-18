---
schema: trivium.review.v1
topic: M9-ClaudeCode审核者接入
stage: plan
role: gemini
vendor: antigravity
agent_cli: agy/1.2.5
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
run_id: 20260917T140800Z
rerun_index: 1
snapshot_hash: sha256:e0acedd83a6764a17876f0571865ee9853b27ace57be9d43cd969a0ec5fc606e
blind: true
started_at: 2026-09-17T14:08:00.742Z
finished_at: 2026-09-17T14:23:07.273Z
duration_s: 322
tool_calls:
  read: 50
  grep: 24
  glob: 0
  run_command: 0
  project_reads: 32
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 1
  major: 1
  minor: 2
  nit: 0
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: true
session_id: b9f023a9-fec9-49e7-83f7-c4ff984f30eb
---

# 计划审查：M9-ClaudeCode审核者接入

> Critic-A · Google Antigravity ｜ 模型 `gemini-3.8-flash-high`
> ｜ 运行 `20260917T140800Z`
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

§0.3 的四条阻塞全数真实成立，分析精准扎实。
但当前计划存在两大关键断裂：
最危险的是 §6 对 --driver 的提前落地仅截留在选侧参数层，未接通 ReviewOptions、locateSubject、freeze、newRunMeta 与 cmdDoctor，导致 plan/bug 阶段原稿定位退 65、禁读判定失真且 run.json 留痕恒为 claude，造成审计造假与功能半残；
其次是 §5.2 Hook 判据语义修改在 M9 写死 DEFAULT_DRIVER，不仅使同名历史审查件失去防篡改不可变保护，更在验收非 claude Driver 时造成角色倒置与误拦。
四项提请裁定事项已逐条给出明确结论（夹具采路线 3，未启用 Driver 允许已登记但必须全链路透传，rejectionRecorded 无正向证据从严判 false，片段理由按实测写）。
建议将 --driver 执行链完整补齐后再推进实施。

**结论**：`request-changes`

## 审查意见（共 4 条：阻断 1 ｜ 重要 1 ｜ 次要 2）

### AGY-01 · 阻断（blocker）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §6 / §6.1` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：--driver 提前落地的范围过于狭窄，仅传进选侧函数，未贯通 ReviewOptions、runReview、locateSubject、freeze、newRunMeta 及 cmdDoctor，导致原稿定位失效、禁读清单判定失真及 run.json 留痕伪造。

**依据**：查阅 src/trivium/cli.ts:470/633、src/trivium/review.ts:466/610/650/755、src/trivium/meta.ts:237 及 src/trivium/topic.ts:80。计划 §6 仅把 driver 传给 resolveCriticSelection 与 locateSubjectReadOnly，但 ReviewOptions 接口根本没有 driver 字段；review.ts:610 调用 locateSubject 与 review.ts:650 调用 freeze 时均未传 driver，全部回落到 DEFAULT_DRIVER（claude）。这导致：1) plan/bug 阶段若指定非 claude Driver，locateSubject 找不到原稿必退 65；2) freeze 内 classifyArtifact 拿不到真实 driver 导致禁读清单分类失真；3) newRunMeta 未传 driver，run.json 骨架恒记录 driver: 'claude'，审计材料与实际输入不符，§6.1 承诺的「在 run.json 里如实标注」根本无法执行；4) cli.ts:633（cmdDoctor）同样漏传 driver。

**建议**：将 --driver 完整扩展至整个执行链路：扩展 ReviewOptions 接口并在 cli.ts（review --start 与 cmdDoctor）中透传；在 review.ts 内将 driver 显式传给 locateSubject、freeze 及 newRunMeta；使选侧、定位、禁读、审计留痕全链路持有同一个 Driver 事实。

### AGY-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §0.4 / §5.2` |
| 类别 | security ｜ 层次 plan |
| 置信度 | high |

**问题**：Hook 后缀集语义直接改为「ALL_AGENT_IDS 去掉当轮 Driver」且 M9 写死 DEFAULT_DRIVER，存在历史审查件防篡改穿透风险，并在非 claude Driver 验收场景下引发 Hook 判定倒置。

**依据**：查阅 src/trivium/hooks.ts:92/196/241/474 与 src/trivium/freeze.ts:194-203。freeze.ts 明确记载「后缀标识产出方，不携带产出角色」。若 Hook 判据纯粹排除当轮 Driver，当 claude 为 Driver 时，历史轮次中由 claude 作为审核者生成的审查件 ...-claude.md 将被 hasCriticRoleSuffix 判为 false，导致 immutableChangeReason 放弃对已提交审查件的不可变保护，破坏 P5 不可伪装原则。更严重的是，§5.2 称「M9 取 DEFAULT_DRIVER」，而在 §7.2 的验收剧本中使用 --driver codex --critics claude，Hook 却仍硬编码排除 claude，导致对真实的审核者产物 -claude.md 门户大开，反而对真实 Driver 产物 -codex.md 强行拦截，造成角色倒置。

**建议**：在设计层面明确承认纯词法检查无法区分「Driver 自身原稿」与「同名历史审查件」的边界并留痕记录；在 M9 阶段不要在 Hook 内部写死 DEFAULT_DRIVER，应使 Hook 能够感知当前执行环境/会话的实际 Driver（或在验收环境中保证 Driver 一致性），防止非默认 Driver 下发生拦截倒置。

### AGY-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §5.3` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | high |

**问题**：§5.3 裁定：critics.test.ts 夹具失效采纳路线 3，但需形成自适应的双向架构断言，防止死代码与覆盖退化。

**依据**：查阅 test/unit/critics.test.ts:132-138 与 src/trivium/critics.ts:128-134。M9 启用 claude 后，四家全部启用，pending 变为 undefined，第 133 行断言直接挂掉。计划提议路线 3 方向正确，但需注意保持测试有效性。

**建议**：采纳路线 3：当注册表全集均已启用时，断言 ALL_AGENT_IDS 全集 criticEnabled 均为 true；若未来引入未启用的第五家 Agent，用例自动恢复对「尚未启用」退 64 分支的执行与校验。

### AGY-04 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §4.3 / §11` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：§4.3 裁定：capability.rejectionRecorded 的声明必须以准入实测 P-b 为唯一准绳，无正向证据时一律保守声明为 false。

**依据**：查阅 src/trivium/guard.ts:395-405、src/trivium/doctor.ts:187-197 与 src/trivium/types.ts:511-517。rejectionRecorded === false 会使阴性只读结论降级为 unavailable；若缺乏实测证据贸然声明 true，将导致虚假的安全背书。

**建议**：在计划中钉死策略：第 1 步 P-b 实测若抓取到被拒写工具在事件流中的留痕，方可声明 rejectionRecorded: true；若未抓到或为空，一律按实声明 false 并记录降级说明，严禁默认设为 true。

## 认为正确的部分

- §0.3 的四条阻塞（B-1 缺少 --driver 支持导致当轮恒被判自审退 64、B-2 Hook 后缀集由 CRITICS 派生导致 Driver 自身产出被锁死、B-3 接入套件漏了 profiles 模型路由导致退 69、B-4 DEFAULT_MAX_CRITICS 已满三家）全部被源码严格证实，分析极其扎实深入，有力阻断了盲目实施带来的返工
- 敏锐指出了交底中 B-5（CLAUDE.md 已存在 MARKER_BEGIN 导致 init.ts 幂等跳过新身份片段追加）的落地缺陷，提出将审查员身份合并入同块标记的处置方案清晰优雅
- 第 1 步准入实测坚持「一行适配器代码都不写」、先验形态与安全边界（EV-41 prompt 载入形态、P-a CLAUDE.md 加载验证、P-b denied_tool_in_trace 补正向证据、P-c 模型 slug 回读）的纪律极其过硬
- 第 2 步将 EV-40 及 Grep 负对照升为机读布尔字段、第 3 步 EV-39 将黑名单收窄为厂商归属映射的设计方案，符合架构契约的演进方向

## 未覆盖范围（本侧盲区）

- 受审查员只读环境限制，未在真实命令行拉起 claude CLI 实跑 headless 与 stream-json（依赖第 1 步准入实测）
- CLAUDE.md.snippet 最终正文说明的具体措辞未做逐字定稿（需依赖 P-a 对 --restricted 下 CLAUDE.md 是否被加载的实机探测结论）
- 未评估未来第五家 Agent 引入时对其它周边生态（如非官方封装脚本）的潜在冲击

## 实际查阅的项目文件

- `.reviews/M9-ClaudeCode审核者接入/plan/2026-09-17-M9-ClaudeCode审核者接入-claude.md`
- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `src/trivium/critics.ts`
- `src/trivium/hooks.ts`
- `src/trivium/agents/registry.ts`
- `src/trivium/adapters/index.ts`
- `src/trivium/adapters/codex.ts`
- `src/trivium/adapters/base.ts`
- `src/trivium/probes/claude.ts`
- `src/trivium/config.ts`
- `src/trivium/cli.ts`
- `src/trivium/topic-args.ts`
- `src/trivium/review.ts`
- `src/trivium/freeze.ts`
- `src/trivium/topic.ts`
- `src/trivium/meta.ts`
- `src/trivium/schemas.ts`
- `src/trivium/guard.ts`
- `src/trivium/doctor.ts`
- `test/unit/registry-parity.test.ts`
- `test/unit/critics.test.ts`
- `test/unit/hooks.test.ts`
- `test/fixtures/stub-agent-kit/overlay.ts`
- `doc/08_project/BACKLOG.md`
- `doc/05_testing/REPORT_2026-09-14_m6_claude_probe.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":50,"grep":24,"glob":0,"run_command":0,"project_reads":32}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
