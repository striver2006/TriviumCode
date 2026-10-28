# Kimi Code 与 Qoder CN 双平台验收清单

日期：2026-10-27。负责人：Bob / Codex。状态：待执行，双角色接入尚未交付。

2026-10-28 追加：Kimi macOS 新根因工具与复跑命令见 [实验说明](../../scripts/acceptance/kimi-qoder-cn/README.md)、[本次报告](./REPORT_2026-10-28_KimiCode_macOS规则根因与只读准入.md)。它们不修改以下旧 probe / Windows 控制臂，不把本地受控机制结果填入真实路线准入列。两个开关仍关闭，Windows/其它客户端仍未测。

本清单分开记录能力前置和交付后验收。产品已登记两个 L2 Driver 并生成入口产物，但尚未完成本机安装、客户端调用和审核者安全准入；不能提前把后半部分填写为通过。macOS 当前结果见[前置取证报告](./REPORT_2026-10-27_KimiCode与QoderCN接入前置取证.md)。

## 1. Windows 能力取证（现在可复跑）

使用 Windows 原生 Node ≥ 18（建议 ≥ 22）、Git for Windows 和已经登录的两家官方 CLI。确认 Qoder 是 CN 产品，入口版本应明确显示 CN；国际版、IDE、插件不代替 CLI。不要更改全局供应商、模型或账号配置。

在含中文与空格的仓库路径准备本工作树及依赖。脚本只复制需要的原生认证文件到临时目录，先用当前用户 SID 收紧 Windows ACL；认证文件不存在、形状不支持或 ACL 设置失败即停止。Kimi 只接受当前已配置的官方 managed provider，Qoder 的 `auto` 是本次显式实验选择，不是已验证的生产默认模型。

在 PowerShell 中运行（把示例路径替换为本机实际路径）：

```powershell
Set-Location 'C:\验收 工作\TriviumCode'
node --version
git --version
& 'C:\实际路径\kimi.exe' --version
& 'C:\实际路径\qoderclicn.exe' --version
& .\scripts\acceptance\kimi-qoder-cn\windows.ps1 `
  -KimiExe 'C:\实际路径\kimi.exe' `
  -QoderCnExe 'C:\实际路径\qoderclicn.exe' `
  -OutputDirectory 'C:\验收 工作\Kimi Qoder证据\PowerShell'
```

在 Git Bash 中另跑一份独立证据：

```bash
cd '/c/验收 工作/TriviumCode'
bash scripts/acceptance/kimi-qoder-cn/git-bash.sh \
  '/c/实际路径/kimi.exe' '/c/实际路径/qoderclicn.exe' \
  '/c/验收 工作/Kimi Qoder证据/Git Bash'
```

若 PowerShell 执行策略不允许脚本，不修改全局执行策略；直接逐条运行以下 Node 命令，把 `open` 依次改成 `deny`、`tools`、`failure`、`cancel`，然后对另一家重复：

```powershell
node .\scripts\acceptance\kimi-qoder-cn\probe.mjs --agent kimi --bin 'C:\实际路径\kimi.exe' --case open --output 'C:\验收 工作\证据'
node .\scripts\acceptance\kimi-qoder-cn\probe.mjs --agent qoder-cn --bin 'C:\实际路径\qoderclicn.exe' --case open --output 'C:\验收 工作\证据'
```

Kimi 追加工具级禁读对照：`--agent kimi --case deny --rule-mode tool-deny`。每次 `open/deny/tools/failure` 至多 180 秒，`cancel` 为 1.5 秒超时触发，另有版本/配置校验及结束宽限。两份包装脚本均为 Windows **未测**，不得把 macOS 的语法检查当作 Windows 验收。

Kimi 规则定位新增 `--rule-mode none|allow-only|deny-only|allow-first|paths-only`，分别表示无自定义规则、仅三种读工具 allow、仅三种读工具 deny、allow 在前再 deny、仅路径 deny。旧 `paths` 和 `tool-deny` 形状保留。逐次指定一个值，结合实际调用判读；这些是根因对照，不能自动登记准入。JSON 记录生成的 `permission_rules`。Windows 新控制臂全部未测。

| 用例 | 必须核对 | 当前 Windows 状态 |
| --- | --- | --- |
| open | Read、Grep、Glob 实际调用、普通 canary、正确 cwd、中文空格路径 | 未测 |
| deny | 同行工件/敏感文件的 Read 实际拒绝；Grep/Glob 不泄漏；与能读出的对照逐项配对 | 未测 |
| tools | 有效工具面仅 Read/Grep/Glob；实际禁用工具调用被执行层拒绝及成功放开对照 | 未测 |
| failure | 不存在模型应拒绝；回退警告不能被当成功；请求与回读分开 | 未测 |
| cancel | 原生进程超时、派生进程树退出、无遗留配额进程、凭据副本清理 | 未测 |
| 扩展注入 | 项目/全局 Hook、MCP、插件、技能、子代理不能绕过隔离 | 未测 |
| 路径变体 | 相对/绝对路径、分隔符、大小写、符号链接/联接点、中文空格 | 未测 |

JSON 的 `待核验` 只表示采集完成；`admission` 始终为 false。`tools` 没有实际禁用工具调用时标“未测”。`cancel` 只自动记录超时与清理，`process_tree_exit_verified` 为 false；不能据此判整树退出通过。Bob 应用任务管理器或只读进程查询观察该次 CLI 的 PID、父 PID、创建时间及取消后的退出，避免回传完整命令行中的敏感值。不能用 PID 单独判定身份。

正常完成及可捕获信号下脚本清理临时根。强制断电、SIGKILL 或整个 Node 进程被系统强杀的异常清理仍未测；若发生，先停止同次 CLI 派生树，再由 Bob 检查系统临时目录中的 `trivium-native-probe-*`，只清理对应本次测试的临时目录，不触碰原生账号目录。

## 2. 五个 Driver 客户端（生产接入就绪后执行）

每个平台分别执行以下五行，不能跨客户端借用结果。当前十行全部“未测”：

| 客户端 | macOS | Windows | 身份证据 |
| --- | --- | --- | --- |
| Kimi 官方 CLI | 未测 | 未测 | 实际 exe/二进制、版本、会话 cwd |
| Kimi Code 桌面端 | 未测 | 未测 | 关于页、工作区、技能清单与实际会话 |
| VS Code Kimi Code 插件 | 未测 | 未测 | VS Code/插件版本及 Extension Host 实际调用日志 |
| Qoder CN 官方 CLI | 未测 | 未测 | CN 产品、原生入口、版本、原生路线 |
| Qoder CN 桌面端 | 未测 | 未测 | CN 关于页、工作区、技能清单与实际会话 |

逐客户端界面步骤：

1. 打开隔离验收项目（中文空格路径），记录当前工作区路径和客户端版本；不使用正在进行业务工作的会话。
2. 打开技能/命令清单，记录 `dual-run`、`dual-review-plan`、`dual-review-code`、`dual-review-bug`、`dual-approve`、`dual-status`、`dual-abandon` 七项。记录实际读取路径、同名项数量、来源和生效优先级；发现另一个 Agent 的同名入口则阻塞，不删除它来凑通过。
3. 用客户端实际显示的调用语法调用 status；记录正文含单引号、美元符、中文空格和 `--` 字面时的传参证据。不得凭文档猜每个 GUI 与 CLI 语法相同。
4. 在验收项目使用固定 `gemini,glm` 审核者完成真实预检；缺账号或模型则该项阻塞，不自行缩减集合。依次验 A/B/C/D：阶段认领、原稿、真实审查、逐条裁决、gate。run 与工件的 Driver 必须分别为 kimi 或 qoder-cn；不得自审。
5. B/C/D 的人工审批由 Bob 发起，截图并核对审批前停点和审批后恢复。A 通常无人工审批，只有达到最大轮次等实际触发条件才验对应停点，未触发的格子记未测，不能强造通过记录。另建可放弃的测试主题验 abandon。
6. 每项保存客户端界面与脱敏运行工件的关联。CLI 会话不能替代图形客户端。VS Code 必须在 Kimi 插件面板发起，并取得 Extension Host 内启动/调用/结果关联证据；集成终端启动 CLI 不算。

七技能 × 五客户端 × 两平台逐格登记“通过/失败/未测/阻塞”；任务入口的真实运行、身份、裁决、人工停点、恢复分别登记，不能只填一列总通过。

## 3. Bob 回传清单与核验

回传：版本与二进制 SHA-256、操作系统与 Node/Git 版本、两套终端证据 JSON、各调用退出码、五客户端七技能矩阵、GUI 截图、Extension Host 脱敏日志、原生进程树取消记录、凭据清理结果、对应 run/meta/裁决路径及哈希。

不要回传账号配置原件、认证文件、token、完整用户目录或厂商运行目录。证据脚本会做已知凭据逐值与模式脱敏；回传前仍检查邮箱、用户标识、业务文件内容和未知格式密钥。随机 canary 是专门生成的虚构内容，可以保留以核验泄漏。

Codex 收到后按脚本/二进制指纹、平台、请求与回读、调用↔结果关联、拒绝与正向对照、退出/取消/清理逐项复核。缺失证据保持 null/unknown/未测，不追加为历史通过。
