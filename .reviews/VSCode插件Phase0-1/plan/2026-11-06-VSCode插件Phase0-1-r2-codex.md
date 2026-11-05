---
schema: trivium.review.v2
topic: VSCode插件Phase0-1
stage: plan
role: codex
vendor: openai
agent_cli: codex/0.166.0
model_requested: gpt-6.1-sol
model_effective: gpt-6.1-sol
model_effective_source: trace
effort: high
effort_requested: high
effort_effective: null
effort_effective_source: unverified
tier: null
tier_source: profile
model_route: config_copy
run_id: 20261105T170023Z
rerun_index: 2
snapshot_hash: sha256:c9e7c621fdd71a03a5410071e00109fa4fcb78b6d674718148ae03acd86ec2f8
blind: true
started_at: 2026-11-05T17:00:33.653Z
finished_at: 2026-11-05T17:25:52.316Z
duration_s: 202
tool_calls:
  run_command: 26
  project_reads: 29
evidence_ok: true
verdict: reject
findings_count:
  blocker: 0
  major: 6
  minor: 2
  nit: 0
degraded: false
parse_fallback: false
peer_deny: false
drift: false
readonly_verification: unavailable
path_verification: unavailable
heterogeneous: unknown
access:
  requested_mode: native
  profile: null
  launcher_requested: /opt/homebrew/bin/codex
  launcher_effective: /opt/homebrew/bin/codex
  wrapper_sha256: null
  configuration_sha256: 159c9e2cff1fa3a527487bfc83473387b35f5a0de36ef7014bad96c646e274fe
  provider_declared: openai
  provider_declared_source: config
  provider_effective: openai
  provider_effective_source: trace
family_comparisons:
  - left: glm
    right: codex
    status: unknown
    left_model: null
    right_model: gpt-6.1-sol
    left_source: null
    right_source: trace
    reason: 左侧模型信息缺失
  - left: claude
    right: codex
    status: different-family
    left_model: k3.1-pro
    right_model: gpt-6.1-sol
    left_source: envelope
    right_source: trace
    reason: 模型族不同：kimi / gpt
  - left: gemini
    right: codex
    status: different-family
    left_model: gemini-3.8-flash-high
    right_model: gpt-6.1-sol
    left_source: envelope
    right_source: trace
    reason: 模型族不同：gemini / gpt
override_reason: 左侧模型信息缺失
session_id: 01a1aca7-b33d-7a51-adef-ca0048c30bd3
---

# 计划审查：VSCode插件Phase0-1

> Critic-C · OpenAI Codex ｜ 回读模型 `gpt-6.1-sol` ｜ 请求模型 `gpt-6.1-sol`
> ｜ 运行 `20261105T170023Z` ｜ 第 2 轮
> ｜ 本轮审核者 claude、gemini、codex

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **路径核验无结构化输入**：本侧读取路径只存在于命令文本里，措施 a 无通道可扫，禁读核验完全由措施 b（命令文本字面扫描）承担——已知形态必检，非完备。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

已核对原稿哈希，并结合需求基线、入口资产、运行时序及测试桩协议重新审查。独立包与只读监控方向合理，但入口调用模板、运行发现、心跳检查及零配额测试方案存在会导致返工的问题，建议修订后重新评审。

**结论**：不通过（`reject`）

## 审查意见（共 8 条：重要 6 ｜ 次要 2）

### CODEX-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `§三 D1、D2` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：单字符前缀模型无法表达 ZCode 命令行的 `/skill dual-run`。计划拉起交互 CLI，却根据正文中的桌面端示例推导 `/dual-run`，并将其固化为单测预期，不能保证实际加载入口 skill。

**依据**：README.md「四条正式入口」明确区分 ZCode 桌面端与命令行写法；skills-src/carriers/glm.yaml 记载 `/skill 名字 参数` 的 CLI 展开方式；src/trivium/agents/registry.ts:386～389 明确当前 entryInvocation 登记的是桌面端形态。实际读取的 skills/dual-critic/entry/glm/dual-run/SKILL.md 正文引用不能证明 CLI 调用语法。以上为本轮静态对照，未运行真实 TUI。

**建议**：把调用形态建模为完整模板，明确桌面端与 CLI 的区别，确定符合单源约束的信息来源；测试应验证完整调用和实际 skill 加载结果。

### CODEX-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `§三 D4` |
| 类别 | concurrency ｜ 层次 plan |
| 置信度 | high |

**问题**：run 发现由 state.json 变更触发，却要求 status.json 已存在。核心先公布 running 闸门、后创建状态文件，首次扫描可能落空；计划未规定重试机制，可能直到结束才发现运行，失败运行还可能因回到 idle 被遗漏。

**依据**：src/trivium/review.ts:1323 先调用 setGateChecked 写 running，随后才写工件；src/trivium/run-protocol.ts:539 调用 prepareRun，到 :645 才写初始 status.json；src/trivium/review.ts:2334 在完成时将失败运行置 idle。与原稿 D4 的事件扫描流程对照可得上述窗口，属于静态时序推理。

**建议**：规定未定位 run 的重试或文件创建监听机制，并明确激活时初始读取。增加先写 running、延迟创建 status.json、期间不再改 state.json 的发现测试。

### CODEX-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `§三 D5；§五心跳失联验收` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：仅在 status.json 事件中检查心跳年龄，无法发现文件完全停止更新的典型失联场景。最后一次事件时心跳仍新鲜，此后没有事件触发过期检查；主动写入 stale 时间戳的验收会掩盖该遗漏。

**依据**：原稿 D5 将心跳检查放在每次文件事件处理中；src/trivium/run-protocol.ts:1367 用定时器刷新心跳；src/trivium/status.ts:478、548～573 定义周期并依据当前时间计算失联。上述结论为静态推理，未模拟进程失联。

**建议**：明确独立定时检查非终态运行的心跳年龄。测试先提供新鲜快照，再完全停止文件更新，验证超过阈值后出现提示；终态停止失联检查。

### CODEX-04 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `§一第7～8项；§二 triviumCli.ts；§三 D2、D7` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：计划将本机 sh wrapper 的 spawn 方式作为通用路径，但没有声明本批仅支持 macOS。Windows 原生环境下的 wrapper、CLI 启动器和 shell 测试夹具没有对应执行决策，实施后需要补做平台适配。

**依据**：README.md「安装与首次启用」声明支持 Windows；src/trivium/init.ts:370～425 分别生成 sh 和 .cmd wrapper；src/trivium/util/platform.ts:363～382 说明 Git for Windows 的 sh 不能假定在 PATH。Node 官方也要求 Windows 批处理经命令解释器执行：[子进程文档](https://nodejs.org/api/child_process.html#spawning-bat-and-cmd-files-on-windows)。本轮未在 Windows 实测。

**建议**：先明确本批平台边界。支持 Windows 则补充 wrapper、CLI 启动器和夹具的执行方式与验收；仅支持 macOS 则在范围、说明和验收中明确。

### CODEX-05 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `§三 D7、D8` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | high |

**问题**：长正文完整性检查与测试路径不匹配：dual-status 没有 S0.5 解析阶段，也不保存 task goal；直接启动 review --start 的桩 e2e 又绕过终端注入。因此现有方案无法证明真实四家 TUI 收到的长正文与表单原文一致。

**依据**：skills/dual-status/SKILL.md 只要求执行 status 并转述结果；skills/dual-critic/entry/glm/dual-run/SKILL.md 才定义 S0.5 topic resolve。原稿 D7 从 review --start 起跑，D8 却要求检查 Driver S0.5 或 task.json goal。以上为本轮测试路径对照，未执行矩阵。

**建议**：为通道传输与真实入口解析分别指定可核验结果。长正文验收须覆盖从插件表单经终端注入到解析结果的完整路径，不能由直接调用 review --start 替代。

### CODEX-08 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `§三 D7：桩全流程 e2e` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：计划指定的 TRIVIUM_STUB_CRITIC=1 不会启用桩。该值会被解析为数字并视为未注入，适配器工厂随后返回真实适配器；测试可能失败，或在环境可用时实际消耗审核者配额。结束后检查桩指纹无法事前阻止该成本。

**依据**：src/trivium/adapters/stub.ts:269～279 要求环境变量解析结果是对象，数字 1 返回 null；:822～827 在无有效桩配置时返回真实适配器。src/trivium/review.ts:810 调用该工厂；test/helpers/fixture.ts:195 和 src/trivium/selftest.ts:95 附近均使用按审核者配置的 JSON 对象。以上为本轮源码核对，未启动任何审查进程。

**建议**：改用覆盖实际入选审核者集合的合法 JSON 桩配置，并在启动真实子进程前检查注入配置完整有效；保留结束后的逐侧桩指纹断言。

### CODEX-06 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `§三 D3` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：30 秒没有 state.json 或 run 目录变化，不能证明注入失败。入口 A 正常读仓、起草计划可能超过该时间，此时建议切换模式并重发会诱导用户重复提交正在处理的任务。

**依据**：skills/dual-critic/entry/glm/dual-run/SKILL.md 的流程在解析、预检、认领和起草之后才启动审查；src/trivium/cli.ts:1094 附近的 topic claim 写的是 task 元数据，不能提供 state.json 注入确认。此为静态调用链推理。

**建议**：将提示表述为尚未观察到审查启动，与注入失败区分；重发前引导核对终端状态，并覆盖成功注入但长时间起草的场景。

### CODEX-07 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `§三 D8` |
| 类别 | performance ｜ 层次 plan |
| 置信度 | high |

**问题**：真实 Driver 会话中的 dual-status 探针不能承诺零配额。底层 status 查询是本地操作，但技能加载、工具调用及结果转述仍经过 Driver 模型；四家多次启动、长文及续话矩阵没有登记预算和重试上限。

**依据**：skills/dual-status/SKILL.md 要求 Driver 执行命令并转述输出；src/trivium/adapters/stub.ts 的 resolveAdapters 只替换审核者适配器，未替换终端里的真实 Driver。配额影响为调用链推理，本轮未调用厂商模型或测量费用。

**建议**：将零配额承诺限定于假 TUI 和完整审核者桩测试；真实四家矩阵单独登记调用次数、预算及失败重试上限。

## 认为正确的部分

- extension 独立 npm 包、不并入主仓 npm run check，并分别验证两套检查，符合任务边界。
- 复用 wrapper、探针绝对路径及现有 CLI，将阶段循环留给 Driver skill，可减少插件维护成本。
- 真实 extension host、假 TUI 和跨进程桩分层验证，并检查桩指纹，方向正确。
- 保留可复制命令条作为注入兜底合理；Terminal.sendText 只向终端 stdin 写入文本，不提供 TUI 已处理的确认：[VS Code API](https://code.visualstudio.com/api/references/vscode-api#Terminal)。

## 未覆盖范围（本侧盲区）

- 未运行构建、安装、Electron、真实四家 TUI 或厂商模型调用；行为问题均来自静态契约和时序分析。
- 未验证 Windows 实机、远程 Extension Host、真实就绪时间、长正文传输成功率或实际费用。
- 尚无插件实现，未评估最终依赖锁定、Webview 消息校验、VSIX 内容及卸载恢复行为。
- 已读取本人上轮审查件；未读取其他审查员产出、禁读运行子树、本机探针或凭据文件。

## 实际查阅的项目文件

- `.reviews/VSCode插件Phase0-1/plan/2026-11-06-VSCode插件Phase0-1-glm.md`
- `.reviews/VSCode插件Phase0-1/plan/2026-11-06-VSCode插件Phase0-1-codex.md`
- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/08_project/README.md`
- `doc/08_project/2026-11-05-VSCode插件需求分析与开发计划-v2.md`
- `package.json`
- `.gitignore`
- `src/trivium/agents/registry.ts`
- `src/trivium/cli.ts`
- `src/trivium/driver-claim.ts`
- `src/trivium/init.ts`
- `src/trivium/util/platform.ts`
- `src/trivium/review.ts`
- `src/trivium/run-protocol.ts`
- `src/trivium/status.ts`
- `src/trivium/verify.ts`
- `src/trivium/adapters/stub.ts`
- `src/trivium/selftest.ts`
- `test/helpers/fixture.ts`
- `skills-src/carriers/glm.yaml`
- `skills/dual-status/SKILL.md`
- `skills/dual-critic/entry/glm/dual-run/SKILL.md`
- `skills/dual-critic/entry/glm/dual-review-code/SKILL.md`
- `skills/dual-critic/entry/codex/dual-run/SKILL.md`

> 编排器从工具轨迹中记录到的读取次数：{"run_command":26,"project_reads":29}

---

*本文档由 TriviumCode 编排器从 `codex` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
