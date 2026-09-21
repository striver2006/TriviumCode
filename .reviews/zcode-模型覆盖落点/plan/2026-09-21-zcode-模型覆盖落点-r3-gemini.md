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
run_id: 20260921T114825Z
rerun_index: 3
snapshot_hash: sha256:44a386a03e0d09fa5b07c551c1e877f0e3916ec4684a9857dac9a64b8cbf4b19
blind: true
started_at: 2026-09-21T11:48:26.508Z
finished_at: 2026-09-21T12:00:00.489Z
duration_s: 347
tool_calls:
  read: 27
  grep: 15
  glob: 0
  run_command: 0
  project_reads: 15
evidence_ok: true
verdict: approve-with-nits
findings_count:
  blocker: 0
  major: 1
  minor: 1
  nit: 1
degraded: false
parse_fallback: false
peer_deny: false
drift: false
consulted_unverified: true
heterogeneous: true
session_id: 1aba5796-5e9b-4a10-b725-0f7501235778
---

# 计划审查：zcode-模型覆盖落点

> Critic-A · Google Antigravity ｜ 模型 `gemini-3.8-flash-high`
> ｜ 运行 `20260921T114825Z` ｜ 第 3 轮
> ｜ 本轮审核者 codex、gemini

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

1. §4.2 真实链路检验存在假阳性漏洞：若按计划默认使用 GLM-5.3 检验，CLI 导入失败回退到 provider 首个模型也会产出 GLM-5.3，使回归守卫失效；必须强制使用 GLM-5.3-Flash 验真。
2. §1.3 根因改判完全成立：逆向核实 CLI 源码确认 EV-81 注入宿主个人变量确实导致跳过 importLegacy；路线 L（切回 cli/config.json 且完全不注入个人变量）是根本性正解。
3. 路线 L 在凭据面和脱敏域上完全闭环：CLI 自动生成的 v2 文件严格受控在运行副本地 $HOME 内，脱敏三载体清单已完整覆盖，无任何凭据泄露或宿主污染风险。
4. 探针一致性完全闭合：审查子进程与 flag 探针均不注入个人变量，运行时行为彻底对齐。
5. 实施保留项与回滚项切分精准：精准移除了 r1 引入的 personal 路径预备逻辑与 schema 分支，保留了必要的回归守卫与多载体脱敏。
6. 参数接口设计建议微调：建议使用显式布尔开关替代 null/undefined 状态语义。整体批准实施。

**结论**：`approve-with-nits`

## 审查意见（共 3 条：重要 1 ｜ 次要 1 ｜ 吹毛求疵 1）

### AGY-r2-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `.reviews/zcode-模型覆盖落点/plan/2026-09-21-zcode-模型覆盖落点-r2-claude.md:270` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | high |

**问题**：§4.2 真实链路首跑检验存在严重假阳性盲区：若测试使用默认模型 GLM-5.3，当 legacy 导入解析失败回退到 provider 首个模型时，回读值同样为 GLM-5.3，导致校验守卫失效。

**依据**：查阅 src/trivium/config.ts:324 可见 glm 在 standard 档位的默认模型即为 GLM-5.3，且在 provider 配置的 models 列表中排在首位。计划 §4.2 仅规定「默认档位 GLM-5.3 或 GLM-5.3-Flash」，未强制要求非首位模型；一旦 Mqa 解析失败降级为首个模型，回读结果同样是 GLM-5.3，decideModelOverride 会误判为 applied: true，产生严重的回归盲区。

**建议**：在 §4.2 强制规定：真实链路验证必须显式指定非首位模型（如 --model-glm GLM-5.3-Flash 或 thrifty 档位）。只有当回读结果精确等于 GLM-5.3-Flash 且排除 GLM-5.3 时，才能判定模型覆盖真正生效。

### AGY-r2-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `.reviews/zcode-模型覆盖落点/plan/2026-09-21-zcode-模型覆盖落点-r2-claude.md:143` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | high |

**问题**：§2.3 计划将 zcodeProviderEnv 第三参数设计为 null/undefined 三态分歧，在不再接收路径字符串后语义冗余且易诱发空值陷阱。

**依据**：查阅 src/trivium/adapters/zcode.ts:167，原有实现为 options 可选对象。§2.3 计划将 zcodeProviderEnv 第三参数设为「三态：undefined（派生）/ null（显式不注入）」，但又说明不再接收 string。在 JS/TS 中去掉 string 后实际仅剩布尔二态，使用 null 作为 magic value 易在 null ?? fallback 表达式中引发混淆与维护风险。

**建议**：将参数显式定义为清晰的布尔选项（如 omitPersonalProviderConfig?: boolean），与 ZcodeInvokeOptions.omitPersonalProviderConfig 保持同构，消除 magic null 状态。

### AGY-r2-03 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `.reviews/zcode-模型覆盖落点/plan/2026-09-21-zcode-模型覆盖落点-r2-claude.md:131` |
| 类别 | scope-drift ｜ 层次 plan |
| 置信度 | high |

**问题**：§2.2 路线对比表中宣称路线 L「与桌面端解耦：桌面端改 v2 不影响审查」，该表述存在轻度夸大。

**依据**：查阅 src/trivium/probes/zcode.ts 中的 probeZcode 探测逻辑及附录 §1.1/EV-87 说明，尽管审查执行阶段不再读取宿主 v2 目录，但在启动前的 authProbe 与 preflight 探测中，仍然必须依赖宿主 ~/.zcode/v2/provider_config.json 探测凭据与提供商有效性。若宿主该文件损坏，流水线在 preflight 阶段依然会被阻断。

**建议**：在 §2.2 表格中修正限定为「审查执行期与桌面端解耦（preflight 探测仍依赖宿主，彻底解耦需等待 EV-87）」。

## 认为正确的部分

- §1.3 根因改判与逆向分析准确：结合 zcode.cjs 源码确认，当检测到 personalProviderConfig 存在时，CLI 判定配置已就绪并直接跳过 importLegacy()；EV-81 注入宿主文件确实是阻断 model.main 读取的唯一根因。
- 路线 L 架构方向完全正确：放弃 personal 副本，收敛至单一标准副本 cli/config.json，消除了宿主配置侵入，极大降低了系统复杂度。
- 运行目录与凭据脱敏域闭环安全：CLI 自动生成的 v2 文件由 HOME 引导，严格落在运行副本地内，不污染宿主；脱敏三载体列表完整覆盖了自动生成的文件，scrubZcodeHome 闭环可靠。
- 探针一致性完全对齐：probeReadonlyFlags 与 invokeZcode 均不注入个人变量，探针与审查运行时环境彻底一致。
- r1 成果取舍精准：正确回滚了 splitZcodeModel、prepareZcodePersonalConfig 以及 schema 扩展，同时保留了关键的 decideModelOverride 回归守卫与 3 载体脱敏列表。
- EV-90 闭环明确：在计划附录中清晰界定了 EV-90 的继承与完成标准。

## 未覆盖范围（本侧盲区）

- 因本审查员处于完全只读环境且无外部网络权限，未实际使用真实 GLM API Token 运行 CLI 执行端到端推理。
- 未对除 zcode 0.16.9 以外的历史或未来 CLI 版本的二进制字节码进行逆向验证。

## 实际查阅的项目文件

- `.reviews/zcode-模型覆盖落点/plan/2026-09-21-zcode-模型覆盖落点-gemini.md`
- `.reviews/zcode-模型覆盖落点/plan/2026-09-21-zcode-模型覆盖落点-r2-claude.md`
- `.reviews/zcode-模型覆盖落点/plan/2026-09-21-zcode-模型覆盖落点-revised-claude.md`
- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/05_testing/REPORT_2026-09-11_m0_probe.md`
- `doc/08_project/BACKLOG.md`
- `skills/dual-critic/schema/run.v2.json`
- `src/trivium/adapters/zcode.ts`
- `src/trivium/probes/zcode.ts`
- `src/trivium/scrub.ts`
- `src/trivium/types.ts`
- `test/unit/known-forms-parity.test.ts`
- `test/unit/zcode-model-selection.test.ts`
- `test/unit/zcode-provider-env.test.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":27,"grep":15,"glob":0,"run_command":0,"project_reads":15}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
