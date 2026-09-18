---
schema: trivium.review.v1
topic: M9-Driver旗标全链路与选侧收口
stage: code
role: gemini
vendor: antigravity
agent_cli: agy/1.2.6
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
run_id: 20260918T165302Z
rerun_index: 1
snapshot_hash: sha256:c972dd3b48f0656dc39272b34840ec2d76a49b4454b3bde17cdc5a19caadb79b
blind: true
started_at: 2026-09-18T16:53:03.054Z
finished_at: 2026-09-18T17:06:19.146Z
duration_s: 295
tool_calls:
  read: 31
  grep: 10
  glob: 2
  run_command: 0
  project_reads: 17
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 0
  major: 2
  minor: 1
  nit: 0
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: true
session_id: 17923a3f-aeeb-4b22-96b8-f5795ea9b5b3
---

# 代码审查：M9-Driver旗标全链路与选侧收口

> Critic-A · Google Antigravity ｜ 模型 `gemini-3.8-flash-high`
> ｜ 运行 `20260918T165302Z`
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

闸门区在 latestRunMeta 返回 null 时存在静默按缺省 Driver 校验工件的穿透路径，且留痕全损坏时未按计划点名硬失败；
T-11 未实现实际运行测试，仅用源码正则扫描代替执行，导致非缺省 Driver 下的闸门闭环（C4）缺乏运行时验证；
此外 driver-wiring.test.ts 遗漏了对 resolveRerunIndex 传参的守卫扫描；
积极方面，isReviewArtifact 的二值判据在两处同形函数中分流严格一致，旧 Driver 显式原稿逃生门有效；
latestRunMeta 直读时序已核对全部 65 份历史留痕，定宽时间戳保证成立，彻底解决了 r2 阻断的循环依赖；
交接协议运行期回落、EV-53 论域合一与 EV-54 override_reason 写点收口均实现良好。

**结论**：`request-changes`

## 审查意见（共 3 条：重要 2 ｜ 次要 1）

### AGY-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/cli.ts:770-818` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：latestRunMeta 为 null 时，cmdGate 在 --check-artifacts 路径下静默回落缺省 Driver 且不报错；且在全部 run 元数据损坏时未能按计划 §6.7 点名硬失败，而是与「未跑双审」混同

**依据**：查阅 src/trivium/cli.ts:770-818 与 src/trivium/meta.ts:369-387。在 cli.ts:771，latest 为 null 时 gateDriver 回落到 DEFAULT_DRIVER。紧接着在 --check-artifacts 分支（lines 781-818），代码完全没有检查 latest 是否为 null，直接以 roundCritics=undefined 与 gateDriver='claude' 调用 checkStageArtifacts 并直接返回结果；若某非缺省 Driver 主题的元数据缺失或损坏，该命令将静默按缺省 Driver 校验工件齐备性而不报留痕异常。此外，在 default 分支（lines 919-924），当 _meta 下存在 run-*.json 但全因损坏/格式错误导致 readRunMeta 返回 null 时，latestRunMeta 同样返回 null，此时报错仅为泛泛的「找不到运行元数据。请先跑一次双审」，偏离计划 r3 §6.7 明确承诺的「无 --run-id 但全部 readRunMeta 返回 null → 硬失败并点名」。

**建议**：在 cmdGate 进入各子分支前明确处理 latest 为 null 的场景：区分「目录为空或无 run-*.json 文件」与「存在文件但全部解析失败」，后者应点名具体损坏的 run_id 抛错硬失败；在 --check-artifacts 分支中不得在 latest 为 null 且未显式指定相关参数时静默以缺省 Driver 继续。

### AGY-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `test/unit/driver-wiring.test.ts:2167-2210` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | high |

**问题**：T-11 未建立真实进程/运行态闭环，核心完成判据 C4（非缺省 Driver 下裁决件未写出与定位）在整个测试集中缺乏实际运行验证

**依据**：查阅 .reviews/M9-Driver旗标全链路与选侧收口/plan/2026-09-19-M9-Driver旗标全链路与选侧收口-r3-claude.md §2.3 (C4) 与 §4.4 (T-11)。计划明确承诺在 gate-loop.test.ts 中测试非缺省 Driver 下 gate --check 定位 -revised-<真Driver>.md 并覆盖「审查件已落盘、裁决件未写出」一格。但在当前改动中，gate-loop.test.ts 未做任何修改，替代它的 test/unit/driver-wiring.test.ts:2167-2210 仅使用正则表达式扫描 src/trivium/cli.ts 源码中是否存在字符串。整个测试集中没有任何一处在非缺省 Driver（如 gemini、codex）留痕下实际调用过 cmdGate 或 trivium gate CLI，使得这一核心解法在真实执行路径上失去防护。

**建议**：补齐真实的闸门执行测试（可在 gate-loop.test.ts 或轻量 integration 夹具中）：在阶段目录准备非缺省 Driver 的 run.json 与审查工件，真实执行 gate --check 命令；先断言在裁决件未写出时准确报告缺失该 Driver 的 -revised 裁决件（而非缺省 Driver 裁决件或未跑双审），再落盘合规裁决件并断言校验通过。

### AGY-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `test/unit/driver-wiring.test.ts:2060-2140` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | high |

**问题**：driver-wiring.test.ts 的 TARGETS 清单遗漏了 resolveRerunIndex，未建立防止其在重构中再次漏传 driver 的调用链护栏

**依据**：查阅 .reviews/M9-Driver旗标全链路与选侧收口/plan/2026-09-19-M9-Driver旗标全链路与选侧收口-r3-claude.md §3.1 与 test/unit/driver-wiring.test.ts:2060-2140。计划 §3.1 专门指出步骤表此前漏掉了 resolveRerunIndex 的 driver 参数传递。虽然本次实现中 review.ts:641 与 cli.ts:778 均补传了该参数，但 driver-wiring.test.ts 的 TARGETS 扫描列表中列出了 9 个调用点，唯独未将这两处 resolveRerunIndex 纳入守卫，丧失了源码扫描用例对本处历史高频遗漏点的回归防护作用。

**建议**：在 driver-wiring.test.ts 的 TARGETS 数组中补入 review.ts 与 cli.ts 针对 resolveRerunIndex 的调用锚点与参数断言。

## 认为正确的部分

- isReviewArtifact 二值谓词在 topic.ts 的 locateSubject 与 topic-args.ts 的 locateSubjectReadOnly 中的硬拒与候选过滤分流逻辑严密对称，显式路径硬拒审查件、候选路径剔除审查件并准确定位真原稿。
- latestRunMeta 采用时间戳文件名倒序直读留痕，经核对历史全部 65 份 run-*.json 文件均严格符合定宽 UTC ISO 格式，以字典序即时序的确定性保证彻底消除了 r2 中由后缀反推引发的循环依赖。
- 交接协议在 rebuildContext 中增加了运行期防御，即使旧版本写出的交接文件缺少 options.driver 字段，也能从 run.json 中如实回填并输出警告，避免了跨版本静默退回缺省 Driver。
- EV-53 与 EV-54 的收口干净：selectableCritics 单一源头派生消除了模型覆盖白名单与报错文案的不一致；overrideReasonFor 共用派生保证了元数据与 front-matter 文案同值。

## 未覆盖范围（本侧盲区）

- 未实际启动包含 Antigravity / ZCode 真实 CLI 的在线双审端到端调用（受限于测试环境无外部联网与各厂商配额保护要求，主要依靠桩机制与静态分析）。
- 未覆盖 M10 范围内的 Driver 切换实际执行（如完整运行一次以 codex 为 Driver 的编写与提交流程）。
- 未覆盖 git commit hook 在真实提交动作下的底层拦截细节（本次审查主要聚焦 Driver 旗标链路与闸门判据收口）。

## 实际查阅的项目文件

- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/02_design/README.md`
- `src/trivium/cli.ts`
- `src/trivium/meta.ts`
- `src/trivium/critics.ts`
- `src/trivium/topic.ts`
- `src/trivium/topic-args.ts`
- `src/trivium/archive.ts`
- `src/trivium/review.ts`
- `src/trivium/run-protocol.ts`
- `src/trivium/gate.ts`
- `test/unit/driver-wiring.test.ts`
- `test/unit/topic.test.ts`
- `test/integration/gate-loop.test.ts`
- `.reviews/M9-Driver旗标全链路与选侧收口/plan/2026-09-19-M9-Driver旗标全链路与选侧收口-r3-claude.md`
- `.reviews/M9-Driver旗标全链路与选侧收口/plan/2026-09-19-M9-Driver旗标全链路与选侧收口-revised-claude.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":31,"grep":10,"glob":2,"run_command":0,"project_reads":17}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
