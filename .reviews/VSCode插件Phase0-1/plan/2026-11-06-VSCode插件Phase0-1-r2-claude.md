---
schema: trivium.review.v2
topic: VSCode插件Phase0-1
stage: plan
role: claude
vendor: anthropic
agent_cli: claude/2.1.318
model_requested: k3.1-pro
model_effective: k3.1-pro
model_effective_source: envelope
effort: high
effort_requested: high
effort_effective: null
effort_effective_source: unverified
tier: null
tier_source: profile
run_id: 20261105T170023Z
rerun_index: 2
snapshot_hash: sha256:c9e7c621fdd71a03a5410071e00109fa4fcb78b6d674718148ae03acd86ec2f8
blind: true
started_at: 2026-11-05T17:00:33.653Z
finished_at: 2026-11-05T17:25:52.316Z
duration_s: 1518
tool_calls:
  read: 22
  grep: 5
  glob: 3
  run_command: 0
  project_reads: 24
evidence_ok: true
verdict: pass-after-changes
findings_count:
  blocker: 1
  major: 6
  minor: 3
  nit: 0
degraded: false
parse_fallback: false
peer_deny: true
drift: false
readonly_verification: unavailable
heterogeneous: unknown
access:
  requested_mode: profile
  profile: kimi
  launcher_requested: /Users/chenzhenbo/.local/bin/cld
  launcher_effective: /Users/chenzhenbo/.local/bin/cld
  wrapper_sha256: e4e159df668f64694d550fb058cf5788e9ef0edf7da1e90e16719f68ebd627f5
  configuration_sha256: 302204616262eadfddb0f255aac8b9d2768d9db4ddf5a3bd5c5d84925f2c82b8
  provider_declared: kimi
  provider_declared_source: profile
  provider_effective: null
  provider_effective_source: null
family_comparisons:
  - left: glm
    right: claude
    status: unknown
    left_model: null
    right_model: k3.1-pro
    left_source: null
    right_source: envelope
    reason: 左侧模型信息缺失
  - left: claude
    right: gemini
    status: different-family
    left_model: k3.1-pro
    right_model: gemini-3.8-flash-high
    left_source: envelope
    right_source: envelope
    reason: 模型族不同：kimi / gemini
  - left: claude
    right: codex
    status: different-family
    left_model: k3.1-pro
    right_model: gpt-6.1-sol
    left_source: envelope
    right_source: trace
    reason: 模型族不同：kimi / gpt
override_reason: 左侧模型信息缺失
session_id: 057b0629-3f62-43e9-8293-2b414446d59e
---

# 计划审查：VSCode插件Phase0-1

> Critic-D · Anthropic Claude Code ｜ 回读模型 `k3.1-pro` ｜ 请求模型 `k3.1-pro`
> ｜ 运行 `20261105T170023Z` ｜ 第 2 轮
> ｜ 本轮审核者 claude、gemini、codex

> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

最危险的是 D1 把入口调用压缩成 `/` 与 `$` 两种前缀：ZCode 命令行实际要求 `/skill <名字>`，现方案会对该载体生成错误命令，正中本批核心 FR-5。
另有前置链与真实入口次序冲突、注入失败误判、历史闸门误发现、失联检测缺少定时器、侧完成正文无读取面等主要缺口。
总体架构、只读集成面与测试底座方向可行；按意见逐条修订后即可实施，无需推翻重做。

**结论**：修改后通过（`pass-after-changes`）

## 审查意见（共 10 条：阻断 1 ｜ 重要 6 ｜ 次要 3）

### CLAUDE-01 · 阻断（blocker）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `实施计划 §三 D1（entryCommand 推导链及防漂移单测）` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：入口调用被建模为 `<prefix><命令>`，且测试只断言 glm 的前缀为 `/`。但 ZCode 命令行模式的完整调用形态是 `/skill <名字>`，不是 `/dual-run`；按现计划实现的 FR-5 会向 zcode 终端注入无法按预期触发的命令，前缀单测还会错误地保持全绿。

**依据**：README.md:51 明确写着「ZCode 命令行使用 `/skill <名字>`」；src/trivium/agents/registry.ts:386-389 也区分 glm 桌面端 `/名字` 与命令行 `--prompt` 模式 `/skill 名字`。被审计划 D1 却只从渲染正文正则推导 `/$` 前缀，并把 glm 的期望固定为 `/`。

**建议**：把入口表示从「前缀」提升为「完整调用模板」，并按实际启动的宿主形态选择桌面端或命令行模式；ZCode CLI 覆盖 `/skill {name}`。防漂移测试应断言完整入口文本，而不只是首字符。

### CLAUDE-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `实施计划 §〇 FR-3 与 §二 launch/prechain.ts` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：统一的 resolve→claim→preflight 前置链会在命令 A 中过早写入主题认领。真实命令 A 要求 resolve→preflight 后，先把推导主题回显给用户确认，再 claim；插件按计划在确认前 claim，会把用户尚未认可的主题写进 task.json，随后注入的入口 skill 又重复执行同一套链路。

**依据**：skills/dual-run/SKILL.md:39-40 描述 S0.5 resolve，:71-84 描述 S0.6 preflight，:117-127 明确要求 topic_inferred 时先回显确认，之后才在 S0.8 claim。被审计划 FR-3 固定为 resolve→claim→preflight，未给主题确认或重复调用的归属作出安排。

**建议**：按入口分别定义前置链及副作用归属；命令 A 至少要把 claim 放到预检与推导主题确认之后。明确哪些步骤由插件执行、哪些留给终端入口 skill，避免重复认领与重复预检。

### CLAUDE-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `实施计划 §三 D3 auto 模式与 D8 真机注入探针` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：auto 以「30 秒内 state.json/run 目录无变化」推断注入失败，这个判据与注入是否成功没有必然关系。D8 选用的 dual-status 是只读查询，成功也不会创建 run；命令 B/C/D 在 Driver 准备原稿或根因材料期间同样可能长时间没有 run，导致成功注入被误报，并诱发重复注入。

**依据**：skills/dual-status/SKILL.md:11-20 只调用 `trivium status` 并明确其内容是闸门概览，不启动运行；skills/dual-review-plan/SKILL.md:46-58 要求先准备并回读原稿，之后才能 resolve 和启动评审。被审计划 D8 又明确将 dual-status 作为注入探针。

**建议**：不要把 run 出现与否当作通用注入回执；保留可观察的人工确认与重发入口，并将「成功但无 run」纳入矩阵预期。若要自动判失败，需要按入口定义独立、可证伪的成功判据。

### CLAUDE-04 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `实施计划 §三 D4 stateWatch run 发现` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：`state ≠ idle` 会把 approved、rejected、abandoned 等历史终态也全部当成待发现运行，且这些条目的 run_id 可以为 null。计划事实基线已经承认历史残留存在，因此当前过滤条件会在打开工作区或后续变更时把旧 run 重新推上看板，甚至扫描空 run_id。

**依据**：src/trivium/state.ts:37-53 定义 GateState 含 approved/rejected/abandoned，且 GateEntry.run_id 类型为 string|null；被审计划 §一.4 明确说历史样例含大量残留，D4 却仍使用 state≠idle 作为唯一筛选。

**建议**：把「活跃看板条目」与「历史条目」分开建模，使用具名的活跃状态集合、非空 run_id 和当前主题/阶段关联；历史终态不得因 watcher 事件自动进入当前运行看板，并补历史残留夹具。

### CLAUDE-05 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `实施计划 §三 D5 statusWatch 心跳失联判定` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：失联只在收到 status.json 事件时检查；真正的心跳停滞恰恰可能意味着此后再也没有文件事件，于是看板会永久保留最后一次运行快照，FR-4 的失联提示不会发生。验收中人为写入一个 stale heartbeat 的夹具覆盖不到这个无后续事件场景。

**依据**：src/trivium/status.ts:75-77 说明 heartbeat_at 用于失联判定，:133-137 显示它随每次写状态刷新；被审计划 D5 将检查限定为「对每次 status.json 事件」。其验收只写了「夹具伪造 stale heartbeat_at」，未规定无写入时的驱动机制。

**建议**：为每个被监控 run 增加独立于 watcher 的周期性失联重估，并覆盖「最后一次 running 快照后完全无写入」的测试；仍只提示失联，不自行判死。

### CLAUDE-06 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `实施计划 §二文件面与 §五 Phase 1「侧完成后可点开审查正文」` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：计划承诺单侧完成后即可打开审查正文，但给定的数据面只有 status.json 的 artifacts 链接；该字段按核心契约只在整个 run 到终态时填写。架构中也没有 run 目录逐侧输出或 .reviews 的 watcher/读取模块，因而该验收项缺少可实现的数据来源。

**依据**：src/trivium/status.ts:79-82 明确 artifacts 与 exit_code 都是「终态时填」；v2 计划 §2.2 G3（doc/08_project/2026-11-05-VSCode插件需求分析与开发计划-v2.md:52）则说明逐侧 CLI 退出后的原始输出在 runDir/<critic>/out/，运行期另有 status 与 worker.log。被审计划未把逐侧输出或 .reviews 纳入文件面。

**建议**：明确单侧完成时审查正文的权威路径、发现方式和打开时机，并纳入 watcher 与夹具；若本批只做整 run 终态后的正文打开，应收窄验收表述，避免承诺逐侧即时可读。

### CLAUDE-07 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `实施计划 §三 D2 终端命名与复用规则` |
| 类别 | concurrency ｜ 层次 plan |
| 置信度 | high |

**问题**：同名且未关闭就复用会把「同主题复用」扩大成「同 Driver 复用」。用户未显式给主题时，不同任务统一命名为 Trivium · <agent>；即使 resolve 已推导出不同主题，仍可能向上一任务的存活终端注入新命令，造成串话或重复执行。

**依据**：被审计划 D2 的命名仅在「用户显式给主题」时附加主题，复用只看同名未关闭；v2 计划 §4.1（doc/08_project/2026-11-05-VSCode插件需求分析与开发计划-v2.md:90）要求的是同一主题复用。src/trivium/topic-args.ts:762-789 表明 resolve 会返回主题及 topic_inferred，说明未显式给主题也有可区分的解析结果。

**建议**：复用键至少包含解析后的 topic、stage/入口与 Driver，并记录终端对应的会话状态；不要用显示名称充当身份。对忙碌、归属不明或主题不同的既有终端应新开或要求用户显式选择。

### CLAUDE-08 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `实施计划 §三 D1 carriers.ts 与防漂移测试` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | high |

**问题**：carriers.ts 新建了 agent→cliKey 和 skillRootCandidates 第二份事实表，但防漂移测试只覆盖入口前缀。注册表中的 cliName、entrySkillRoot 或 entryInvocation 后续变化时，健康面板与产物发现可能静默漂移，现有测试不会变红。

**依据**：src/trivium/agents/registry.ts:154-176 将 cliName 登记为探针键唯一来源，:224-233 将 entrySkillRoot 与 entryInvocation 登记在同一描述符中；被审计划 D1 承认 carriers.ts 是这些事实的镜像，却只安排四家产物前缀断言。

**建议**：为这张最小事实表增加与注册表/载体资产的机器对账，或在构建期生成只读契约供插件消费；对账应覆盖 cliKey、skill 根和完整调用模板，而非只覆盖前缀。

### CLAUDE-09 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `实施计划 §三 D10 N4 版本对齐` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | medium |

**问题**：`--version` 的数值版本与「首个发现的 schema 串」之间没有定义可比关系或映射表；首个发现依赖扫描顺序，也可能只覆盖 config 而漏掉 status。实现者只能再硬编码一份版本映射，或任意选择兼容/降级行为，N4 因而不是可执行决策。

**依据**：package.json:3 当前产品版本为 1.3.5，而 src/trivium/status.ts:59-61 的独立契约版本为 trivium.status.v1，两者本就不是同一命名空间。被审计划 D10 未给支持集合、发现顺序或失配判定规则。

**建议**：按插件实际消费的每类文件声明支持的 schema 集合，逐文件判定未知主版本并降级；CLI 数值版本作为诊断信息或显式兼容表输入，不要用任意的首个 schema 代替完整检查，并补新旧组合夹具。

### CLAUDE-10 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `实施计划 §三 D10 未 init 引导` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：引导链接写成 doc/07_manuals/部署手册.md，仓库中该位置不存在；实际部署手册在 doc/06_deployment/部署手册.md。按计划落地会得到失效的 UI 链接。

**依据**：README.md:13 将部署手册链接列为 doc/06_deployment/部署手册.md；doc/README.md:5 的当前文档入口也指向同一路径。被审计划 D10 使用 doc/07_manuals/部署手册.md。

**建议**：改为仓库实际的部署手册路径，并将该引导链接纳入静态存在性检查。

## 认为正确的部分

- 两条集成面、wrapper 与探针 entrypoint、零复制编排器业务逻辑的边界清晰，符合 v2 计划与仓库纪律。
- status.json 幂等渲染、未知侧状态原样展示、终态再以 --status 复核的方向正确。
- 真实 extension host、stubTrivium/miniRepo/fakeTui 与 TRIVIUM_STUB_CRITIC 桩指纹构成了较完整且零配额的测试底座。
- 范围排除项、全中文 UI、CSP、只读全局配置与敏感字段不进 UI 均有明确承诺。
- extension 独立 check 与主仓 npm run check 分离，同时把 S10 出口做成机械命令面的做法合理。

## 未覆盖范围（本侧盲区）

- 本侧只能静态阅读与检索，未执行构建、测试、vsce 打包或任何 CLI；四家交互终端、sendText 与 VS Code API 的运行时行为均未实机验证。
- 未覆盖 Windows 终端/路径行为、VS Code 测试运行时下载与干净机器安装。
- 未完整审阅全部适配器、run-protocol 的实现细节及 VS Code Webview 的全部安全攻击面。
- 被审对象尚为计划，无 extension 实现代码可供正确性或测试执行审查。

## 实际查阅的项目文件

- `.reviews/VSCode插件Phase0-1/plan/2026-11-06-VSCode插件Phase0-1-glm.md`
- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/08_project/README.md`
- `doc/08_project/2026-11-05-VSCode插件需求分析与开发计划-v2.md`
- `src/trivium/agents/registry.ts`
- `src/trivium/state.ts`
- `src/trivium/status.ts`
- `src/trivium/topic-args.ts`
- `src/trivium/cli.ts`
- `skills/dual-run/SKILL.md`
- `skills/dual-review-plan/SKILL.md`
- `skills/dual-status/SKILL.md`
- `skills/dual-critic/entry/codex/dual-run/SKILL.md`
- `skills/dual-critic/entry/codex/dual-review-plan/SKILL.md`
- `skills/dual-critic/entry/glm/dual-review-plan/SKILL.md`
- `package.json`
- `.gitignore`

> 编排器从工具轨迹中记录到的读取次数：{"read":22,"grep":5,"glob":3,"run_command":0,"project_reads":24}

---

*本文档由 TriviumCode 编排器从 `claude` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
