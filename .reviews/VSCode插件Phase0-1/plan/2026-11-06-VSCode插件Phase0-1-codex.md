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
run_id: 20261105T163451Z
rerun_index: 1
snapshot_hash: sha256:c9e7c621fdd71a03a5410071e00109fa4fcb78b6d674718148ae03acd86ec2f8
blind: true
started_at: 2026-11-05T16:35:01.504Z
finished_at: 2026-11-05T16:44:35.772Z
duration_s: 263
tool_calls:
  run_command: 20
  project_reads: 36
evidence_ok: true
verdict: reject
findings_count:
  blocker: 0
  major: 5
  minor: 2
  nit: 0
degraded: true
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
  configuration_sha256: b7f081fd87100c3b9fd6d649c3c0fd818ca0c90384869d66e1977b89909abe11
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
    status: unknown
    left_model: null
    right_model: gpt-6.1-sol
    left_source: null
    right_source: trace
    reason: 左侧模型信息缺失
  - left: gemini
    right: codex
    status: different-family
    left_model: gemini-3.8-flash-high
    right_model: gpt-6.1-sol
    left_source: envelope
    right_source: trace
    reason: 模型族不同：gemini / gpt
override_reason: 左侧模型信息缺失
session_id: 01a1ac90-526c-7e91-b6d1-2ea2e5a37ad6
---

# 计划审查：VSCode插件Phase0-1

> Critic-C · OpenAI Codex ｜ 回读模型 `gpt-6.1-sol` ｜ 请求模型 `gpt-6.1-sol`
> ｜ 运行 `20261105T163451Z`
> ｜ 本轮审核者 claude、gemini、codex

> ⚠️ **本次为降级轮次**：有入选审核者未能完成，本结论不构成本轮预期的完整多审。实际完成情况见抬头的审核者清单与 run 元数据的 `degraded_reason`。
>
> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **路径核验无结构化输入**：本侧读取路径只存在于命令文本里，措施 a 无通道可扫，禁读核验完全由措施 b（命令文本字面扫描）承担——已知形态必检，非完备。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

已核对原稿哈希，并结合需求基线、入口资产及运行协议审查。独立包与只读监控方向合理，但入口推导无法覆盖已登记的命令行调用形态，运行发现和心跳检测存在确定的时序遗漏；平台边界与注入验收方案也需补齐。建议修订后重新评审。

**结论**：不通过（`reject`）

## 审查意见（共 7 条：重要 5 ｜ 次要 2）

### CODEX-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `§三 D1，第 93～95 行；D2` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：用单字符前缀拼接命令无法表达 ZCode 命令行的 `/skill dual-run`。计划实际拉起的是交互 CLI，却从包含桌面端调用示例的正文推导 `/dual-run`，并将该结果固化为单测预期。测试通过仍可能无法正确加载入口 skill，影响本批核心交付。

**依据**：README.md:44～51 明确区分桌面端 `/dual-run` 与 ZCode 命令行 `/skill <名字>`；skills-src/carriers/glm.yaml 记载 `/skill 名字 参数` 的命令行展开方式；src/trivium/agents/registry.ts:386 附近说明当前 entryInvocation 按桌面端登记。实际读取的 skills/dual-critic/entry/glm/dual-run/SKILL.md 正文使用 `/dual-review-plan` 等引用，不能证明命令行调用语法。此为源码和资产对照结论，未运行真实 TUI。

**建议**：将调用形态建模为完整模板，明确区分桌面端与 CLI。重新确定符合单源约束的信息来源，并让测试断言完整调用及实际 skill 加载结果，不能只断言 `$` 或 `/`。

### CODEX-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `§三 D4，第 110～112 行` |
| 类别 | concurrency ｜ 层次 plan |
| 置信度 | high |

**问题**：run 发现仅由 state.json 变更触发，并要求扫描命中 status.json，但核心先公布 running 闸门，再创建状态文件。首次扫描可能找不到文件；计划没有重试或等待文件创建机制，随后可能直到审查结束才再次发现运行，失败运行还可能因回到 idle 被遗漏。

**依据**：src/trivium/review.ts:1323 在首批工件落盘前调用 setGateChecked 写入 running；src/trivium/run-protocol.ts:538 附近先完成 prepareRun，到 :633～645 才写交接包和初始 status.json；src/trivium/review.ts:2334 在结束时才同步完成或 idle 状态。对照原稿 D4 的事件驱动扫描，这是静态时序推理。

**建议**：规定未定位 run 的重试或创建监听机制，以及激活时的初始读取。增加真实顺序夹具：先发 running 事件，延迟创建 status.json，期间不再修改 state.json，仍须及时进入监控。

### CODEX-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `§三 D5，第 116 行；§五心跳验收` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：仅在 status.json 事件中检查心跳年龄，无法覆盖 worker 停止写文件的典型失联场景：最后一次事件时心跳仍新鲜，之后没有事件触发过期检查。现有验收通过主动写入 stale 时间戳触发事件，会掩盖该遗漏。

**依据**：src/trivium/run-protocol.ts:1368 附近通过定时器刷新心跳；src/trivium/status.ts:478 定义 30 秒周期，其 interpretStatus 通过当前时间计算年龄。原稿 D5 将检查放在文件事件处理内，第 203 行只要求夹具伪造 stale heartbeat_at。此为静态推理，未模拟进程失联。

**建议**：明确由独立定时器检查非终态运行的心跳年龄，终态停止失联检查。测试应先给新鲜快照，再完全停止文件更新，确认超时后出现提示。

### CODEX-04 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `§一第 7～8 项；§二 triviumCli.ts；§三 D2、D7` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：计划把本机 sh wrapper 的直接 spawn 方式当作通用调用路径，却未声明插件仅支持 macOS。Windows 原生环境不能直接执行该无扩展名 sh 文件，`.cmd` 入口、CLI 启动器及测试夹具也没有相应执行决策，实施后会需要补做平台适配。

**依据**：README.md:23 明确产品支持 Windows，并同时生成 sh 与 .cmd wrapper；src/trivium/init.ts:370～425 展示两种入口及 Windows 参数转发约束；src/trivium/util/platform.ts 的 resolvePosixShellSync 说明 Git for Windows 的 sh 不能假定在 PATH。原稿只规定 sh wrapper + spawn 和 stubTrivium.sh，未界定平台支持范围。未在 Windows 实测。

**建议**：先明确本批平台边界。若支持 Windows，补充 wrapper、CLI 启动器和夹具的执行方式及验收；若本批仅验收 macOS，应在范围、插件说明和验收矩阵中明确。

### CODEX-05 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `§三 D8，第 153～154 行` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | high |

**问题**：长正文完整性的验证对象与所选探针不匹配。dual-status 没有 S0.5 解析阶段，也不会保存 task goal；另一个直接启动 review --start 的桩测试绕过了终端注入。因此当前方案不能证明真实四家 TUI 收到的长正文与表单原文一致。

**依据**：skills/dual-status/SKILL.md 只要求执行 `.trivium/bin/trivium status` 并转述结果；skills/dual-critic/entry/glm/dual-run/SKILL.md 才定义 S0.5 的 topic resolve。原稿 D7 第 134 行的桩 e2e 从 review --start 起跑，D8 却要求比对 Driver S0.5 或 task.json goal。此为测试路径对照，未执行矩阵。

**建议**：分别定义通道传输测试与真实入口解析测试，为长正文指定能保留或回显完整输入的可核验结果。真实入口测试须从插件表单经终端注入到解析结果，不能由直接调用 review --start 替代。

### CODEX-06 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `§三 D3，第 106 行` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：30 秒内没有 state.json 或 run 目录变化，不能作为注入未成功的依据。入口 A 正常读仓、起草计划时尚未启动审查，完全可能超过 30 秒；此时提示切换模式并重发，会诱导用户向正在工作的 Driver 重复提交任务。

**依据**：skills/dual-critic/entry/glm/dual-run/SKILL.md 的阶段流程在起草计划之后才启动审查；src/trivium/cli.ts:1094～1105 的 topic claim 记录写入 task 元数据，不能充当 state.json 的注入确认。对照原稿 D3 的 30 秒观察条件，这是静态推理。

**建议**：将该条件展示为“尚未观察到审查启动”，与注入失败区分。重发前要求核对终端当前状态，并增加已成功注入但长时间起草的测试场景。

### CODEX-07 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `§三 D8，第 153 行` |
| 类别 | performance ｜ 层次 plan |
| 置信度 | high |

**问题**：将真实 Driver 会话中的 dual-status 注入探针称为“零配额”不准确。底层 status 查询是本地命令，但加载技能、调用工具和转述结果仍经过 Driver 模型；四家多次启动及续话矩阵的模型成本没有登记。

**依据**：skills/dual-status/SKILL.md 要求 Driver 执行 Bash 并转述输出；src/trivium/adapters/stub.ts:1～24、45 表明 TRIVIUM_STUB_CRITIC 替换的是审核者适配器，不能据此认定真实 Driver 会话免费。配额消耗为调用链推理，本轮未调用厂商模型，也未测量费用。

**建议**：将零配额承诺限定于假 TUI 和审核者桩测试；真实四家矩阵单独登记调用次数、预算和失败重试上限，避免把本地查询等同于整个交互免费。

## 认为正确的部分

- extension 独立 npm 包、不并入主仓 npm run check，并分别验证两套检查，符合任务边界。
- 复用 wrapper、探针绝对路径和现有 CLI，保持阶段循环由 Driver skill 驱动，可减少插件维护成本。
- 真实 extension host、假 TUI 与跨进程审核者桩分层验证，并核对 stub 指纹，方向正确。
- 保留命令条和人工粘贴兜底合理；Terminal.sendText 只提供向终端发送输入的能力，不能单凭调用成功证明 TUI 已处理。[VS Code API](https://code.visualstudio.com/api/references/vscode-api#Terminal)

## 未覆盖范围（本侧盲区）

- 未运行构建、安装、Electron、真实四家 TUI 或厂商模型调用；所有运行行为意见均来自静态契约和时序分析。
- 未验证 Windows 实机、远程 Extension Host、四家就绪时间与长正文实际传输行为。
- 未读取禁读的运行子树、其它审查员结论、本机探针或凭据文件；仅读取获准的项目共享配置。
- 尚无插件实现，未评估最终 Webview 消息校验、依赖锁定及 VSIX 内容。

## 实际查阅的项目文件

- `.reviews/VSCode插件Phase0-1/plan/2026-11-06-VSCode插件Phase0-1-glm.md`
- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/08_project/2026-11-05-VSCode插件需求分析与开发计划-v2.md`
- `package.json`
- `.gitignore`
- `.trivium/config.yaml`
- `src/trivium/agents/registry.ts`
- `src/trivium/init.ts`
- `src/trivium/util/platform.ts`
- `src/trivium/cli.ts`
- `src/trivium/config.ts`
- `src/trivium/state.ts`
- `src/trivium/topic.ts`
- `src/trivium/meta.ts`
- `src/trivium/driver-claim.ts`
- `src/trivium/status.ts`
- `src/trivium/run-files.ts`
- `src/trivium/run-protocol.ts`
- `src/trivium/review.ts`
- `src/trivium/verify.ts`
- `src/trivium/doctor.ts`
- `src/trivium/adapters/stub.ts`
- `skills-src/carriers/glm.yaml`
- `skills-src/carriers/gemini.yaml`
- `skills/dual-critic/entry/glm/dual-run/SKILL.md`
- `skills/dual-critic/entry/glm/dual-review-code/SKILL.md`
- `skills/dual-status/SKILL.md`

> 编排器从工具轨迹中记录到的读取次数：{"run_command":20,"project_reads":36}

---

*本文档由 TriviumCode 编排器从 `codex` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
