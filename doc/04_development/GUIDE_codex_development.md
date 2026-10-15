# Codex 开发与配置迁移

本仓自 2026-10-09 起以 Codex 作为日常开发会话的主攻方。产品仍是支持四家 Agent 的
「主攻 + 多审」编排器，内置缺省 Driver 保持不变。项目共享规则在根目录 `AGENTS.md`。

## 需求、设计与实现入口

- [PRD](../01_requirements/PRD_driver_dual_critic.md) 定义四条入口：全流程 A、计划审查 B、
  代码审查 C、根因审查 D。B / C / D 在逐条裁决后停在人工审批；A 继续编码、复审与真实编译测试。
  审查使用厂商编程 Agent，要求项目上下文、背靠背隔离、可核验的证据与完整留痕。
- [主设计](../02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md) 是实现依据；
  [LLD](../02_design/LLD_orchestrator.md) 提供模块与状态机导航。
  `cli.ts` 分发入口；`review.ts` / `run-protocol.ts` 冻结送审包并运行工作进程；
  适配器与探针处理厂商差异；`guard.ts` 判定证据、隔离与漂移；`gate.ts` 核裁决；
  `approval.ts` 处理用户审批；`archive.ts` 是归档写出口。Agent 身份与差异取注册表。
- 配置按内置默认 → `.trivium/config.yaml` → `.trivium/config.local.yaml` → 命令行合并。
  探针由 `doctor` 写入本机配置，不能手工编造能力结论。敏感实现的纪律见
  [环境与实现指南](./GUIDE_env_setup.md)。

## 本仓角色配置

本仓共享配置的 `review.default_critics` 为 `[claude, gemini, glm]`，Codex 主攻时三家参审。
正式 Codex 入口携带小写 `--driver codex`，产出使用 `-codex.md`、裁决件 `role: codex`。
工具身份与产品内置缺省 Driver 沿用注册表；供应商路线、模型与认证方式分别配置并留痕。

2026-10-10按用户要求，本仓 Codex 默认使用官方配置：`agents.codex.profile: null`，
default/flash/pro 各自的 plan/code/bug 分别为 `gpt-6.1-sol`、`gpt-6-luna`、`gpt-6-astra`，当时未新增 effort 默认值。
显式 null 覆盖产品内置供应商默认；本机官方配置与登录不修改。单次选择第三方时仍须同时指定
`--profile-codex <供应商>` 与对应 `--model-codex <模型>`。

2026-10-16 按用户要求补齐共享配置中的 Codex effort 分档：default 为 Sol medium、flash 为 Luna medium、
pro 为 Astra high，三个阶段一致。这样请求值不再继承本机基底的 `model_reasoning_effort: high`；
不修改用户全局配置，生效值仍为 `null` + `unverified`，配置请求不等于服务端回读。
这些档位只在 Codex 被选为审核者时生效，不改变当前主攻会话。

Gemini default 保持 `gemini-3.8-flash-high`，flash 各阶段引用新增的 medium 档（`model: gemini-3.8-flash-medium`），
pro 各阶段引用新增的 high 档（`model: gemini-4-argon-high`）。两个档位由模型名后缀承载强度，
不另传 effort，也不继承旧 Agent 阶段级 high。本次刷新 Antigravity 探针通过，CLI 为 1.3.6，
目录已列出 Argon 的 low/medium/high 三种后缀变体；Argon high 全阶段预检及实际探活通过（13 秒）后，
按用户要求切换 pro。通用 doctor 的读文件探针使用 Flash low，不代表 Argon 已完成模型专属的只读与真实审查验收，
这些验收仍未测，也不能只按模型代数判断强弱。
GLM 保持 default/pro 使用 `GLM-5.3`、flash 使用 `GLM-5.3-Flash`；
当前 ZCode 适配器没有 effort 控制入口，不新增该字段。

本批 Codex 三档均通过全阶段预检及新的组合探活；Gemini flash 的 medium 档与切换后的 pro Argon high 档
也均通过全阶段预检及实际探活。31 项档位解析测试与三档全阶段模型/effort/参数构造断言通过。
Argon 的实际模型与 effort 生效回读本次未取得，模型专属文件读取、只读及完整审查验收仍未测；
预检中的通用只读能力沿用 doctor 的 Flash low 探针，不能将其归为 Argon 的验收结果。

2026-10-09 初始预检中 Claude 官方路线返回组织停用错误，计划阶段曾临时采用 Gemini、GLM 两审。
代码阶段曾提前使用 Claude、Gemini、GLM 三审，完成标准复核后曾恢复本机临时两审覆盖，
既有记录保留。2026-10-10 Claude/Qwen flash、max 完整适用准入后，按用户要求切换
Claude pro 到 Qwen max 并恢复共享三审，当时 Claude default/flash 使用 Qwen flash。
Kimi/DeepSeek 各实际模型的未测项见[三供应商报告](../05_testing/REPORT_2026-10-10_claude_three_providers.md)，
不能把默认模型探活当作所有档位通过。

2026-10-16 按用户要求，共享配置恢复 Claude 官方路线：`agents.claude.profile: null`，
default 各阶段使用 `{ model: opus, effort: medium }`，flash 各阶段使用 `{ model: sonnet, effort: medium }`；
pro 保留 `{ tier: high }`，high 显式配置 `{ model: opus, effort: high, profile: null }`。
模型别名跟随 Claude CLI 解析，实际模型以运行回读为准；Claude 的 effort 当前没有生效值回读，
`effort_effective` 仍为 `null`、来源为 `unverified`，不能把请求值当作生效值。
本机配置继续保存入口路径和探针结论，不修改全局登录配置。
切换后须刷新官方路线探针并分别预检三个档位；预检不替代真实审查验收，未执行的验收仍为未测。
单次使用第三方时须同时指定 `--profile-claude <供应商>` 与对应 `--model-claude <模型>`；失败不自动切换供应商。

本次官方原生路线探针通过，首次不带 effort 的 Opus/Sonnet 全阶段预检均通过；对应探活会话的模型回读
分别为 `claude-opus-5-5`、`claude-sonnet-5-5`。首次 pro 使用 Fable 时探活失败（退出码 69），
会话返回 `Fable 5.1 requires usage credits`，没有成功的实际模型回读；随后按用户要求改为上述 Opus 分档。
调整后的 Opus medium（default）与 Opus high（pro）全阶段预检均通过，均执行了新的组合探活；
Sonnet medium（flash）也已通过全阶段预检及新的组合探活。这只证明请求组合可调用，
不证明服务端实际采用了指定 effort。三个档位的真实审查验收均未测。

旧主题的 Driver 由该阶段已有运行留痕优先判定，不能用修改配置来迁移历史作者。
已有他家工件的阶段不强行重新认领；新工作使用新主题或尚未被使用的阶段。

## 技能与运行时

Codex 的七个入口安装到 `$CODEX_HOME/skills/dual-*/`，未设该变量时为 `~/.codex/skills/`。
核心运行时仍位于 `~/.claude/skills/dual-critic/`：这是四家共用的资产根，
不表示当前 Driver 必须是 Claude Code。项目 `.trivium/bin/trivium` 指向已安装产物。

```bash
npm run build
node dist/install.cjs --targets codex
.trivium/bin/trivium --version
```

安装前取消指向工作树的 `TRIVIUM_ASSET_ROOT`。入口源在 `skills-src/`，需改入口时先改源再
`npm run render`，不要直接改仓库渲染产物或用户目录里的技能。

`~/.agents/skills` 是 Codex 与 ZCode 的共享读取面，不安装同名 `dual-*` 技能。
发现重复时先备份并移出技能读取根，再安装正式入口；保留备份供回退。
不要通过全文替换 `Claude` 为 `Codex` 来迁移技能：Agent id 必须为小写，
参数转抄、审核者清单、角色后缀与护栏文案都由渲染器统一生成。

## 本机 Codex 配置与护栏

`.codex/` 已被 Git 忽略，本机配置不随仓库提交。可在 `.codex/config.toml` 使用：

```toml
approval_policy = "on-request"
sandbox_mode = "workspace-write"
project_doc_max_bytes = 65536

[sandbox_workspace_write]
network_access = true
```

模型、登录、provider 与用户全局配置沿用用户选择。完整测试会创建子进程与临时 Git 仓库，
在受限沙箱里遇到 `spawn EPERM` 时申请运行检查命令的权限，不把这些错误误报为测试通过。

本仓集成仍为 **L2**，按 [QUICKSTART §5.2](../07_manuals/QUICKSTART.md#52-换一家-agent-主攻护栏等级-l1--l2)
执行人工审批停点与只读约束。当前 Codex 官方已支持项目 Hook，但现有 TriviumCode 的
结构化写入处理器读取文件路径，Codex `apply_patch` 事件提供的是 `tool_input.command` 补丁文本；
直接复制 Claude 的 Hook 配置不能形成等价的文件写入拦截。现有本机 Hook 未经真实载体验收，
不据其存在升级等级，也不代用户信任 Hook 或使用跳过信任的旗标。
来源：[官方 Hook 文档](https://learn.chatgpt.com/docs/hooks)、
[官方配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)。

## 验证与日常入口

```bash
.trivium/bin/trivium doctor --selftest
.trivium/bin/trivium status --json
npm run check
```

自检使用桩适配器、零厂商配额，验证编排闭环，不能证明真实审核者的模型可用性。
正式审查由用户在 Codex 会话中显式调用，例如：

```text
$dual-review-plan 重点检查并发与状态恢复 --topic 新主题
$dual-review-code 重点检查失败路径 --topic 新主题
```

入口先解析主题、预检，再发起审查；按原参数执行并逐条裁决。
审批只由用户显式调用 `$dual-approve` 发起。代码修改完成后先询问提交推送，
Conventional Commits 的中文 subject 与末尾 `Edit by CZB` 沿用个人规范。

## 迁移记录

- 2026-10-09：采用 Codex 主攻约定，本仓缺省审核者调整为 Claude Code / Antigravity / ZCode。
  同步正式 Codex 入口前保留本机技能备份；不改产品内置默认、历史审计工件、版本号与用户全局配置。
  本机重复技能及旧运行时备份位于 `~/.trivium/backups/codex-migration-20261009-1791532540263/`。
  Antigravity 1.3.2 能力已重新探测；Claude 组织停用时本机暂用两审，恢复方式见角色配置一节。
  验证结果：正式七个入口各在 Codex 技能清单出现一次、与仓库渲染产物逐字一致；
  文档索引与入口渲染契约 48 项通过，安装运行时自检 14/14 通过；
  本机两审集合的 `preflight --stage all --driver codex` 通过，未跳过认证。
