# VS Code 驾驶舱点火前选择 Driver 模型与思考强度

2026-11-25 在 macOS 27.2.1 arm64、VS Code 1.147.0 的扩展开发宿主执行。基线为 `feat/vscode-extension@237230af` 加本次工作树变更，核心 1.3.7，扩展 0.3.1。四家均从驾驶舱选择 Driver，完成前置检查，点击「点火」，由原生交互进程接收第一条任务。

## 四家原生会话

表中的「默认」表示该字段在表单中留空。终端参数由独立观察扩展从 VS Code 的终端启动选项和进程记录取得。每行的生效判断只覆盖该次采样。[逐次请求、终端参数、PID 与原生字段](evidence/vscode-driver-models-20261125/native-launches.json)

| Driver 与场景 | 用户请求的模型 / 强度 | 实际模型与强度启动参数 | 原生首轮回读 | 结论 |
| --- | --- | --- | --- | --- |
| Codex 0.169.0，默认 | 默认 / 默认 | `[]` | `turn_context` 记录 `gpt-6.2-astra / max` | CLI 默认已生效 |
| Codex，显式选择 | `gpt-6.1-sol / low` | `-m gpt-6.1-sol -c model_reasoning_effort=low` | `turn_context` 记录 `gpt-6.1-sol / low` | 两项已生效 |
| Codex，同主题改强度 | `gpt-6.1-sol / high` | `-m gpt-6.1-sol -c model_reasoning_effort=high` | 新终端显示 `GPT-6.1-Sol high`，首轮日志回读 `gpt-6.1-sol / high` | 两项已生效 |
| Claude Code 2.1.328 | `sonnet / low` | `--model sonnet --effort low` | 供应商菜单显示 `qwen3.8-flash (sonnet)`，首轮回答的 `message.model=qwen3.8-flash`、`effort=low` | 别名及强度已生效 |
| Antigravity 1.5.16 | `gemini-4-argon-low` / 默认 | `--model gemini-4-argon-low` | 原生状态栏显示 `auto · Gemini 4 Argon · low`，会话执行元数据中有相同模型变体 | 模型及其编码的强度已生效 |
| 独立 ZCode 3.18.2，TUI 0.17.1 | 默认 / 默认 | Node 的唯一参数是独立发行版的 `bin/zcode.mjs` | 首轮供应商 `bigmodel-coding-plan`，请求及回答模型 `GLM-5.3`，请求 `output_config.effort=max`、`thinking.type=enabled` | CLI 默认已生效 |

### 同主题仍有存活终端

选择 `high` 后，「点火」先变为不可用。重新预检再点火，界面列出旧会话的 `low` 和本次的 `high`。选择「保留原会话」后，该窗口的协同终端仍只有一个，驾驶舱仍为 M1。再次点火并选择「保留原终端并另开会话」后，两个终端分别保留 `low` 和 `high`。两份原生首轮记录各自包含对应的任务标记。宿主回归还检查了冲突提示发出之前的认领与注入调用次数，以及保留原会话后重发的命令。[装配控件](evidence/vscode-driver-models-20261125/装配.png) · [冲突选择](evidence/vscode-driver-models-20261125/同主题冲突.png)

最终工作树的隔离窗口中，`low` 和 `high` 的终端 PID 分别为 `56644` 和 `58982`。新任务的预检预览中「重新注入」不可用。点击保留后，界面恢复原任务的命令和重发按钮。两个终端的关闭事件都发生在验收窗口退出时。

### 能力数据与复现条件

- Codex 从本次交互入口的 `model/list` 读可见模型和逐模型 reasoning levels，并从同一工作区的 `config/read` 解析默认选择。旧入口可读 `debug models`。当前默认模型在目录中缺席时，选定一个可见模型即可查看它的强度。
- Claude Code 从当前入口的原生初始化菜单读取供应商别名与逐模型强度，再与本机 `--help` 接受的 `--effort` 值取交集。初始化查询没有用户任务。Antigravity 的 `models` 按完整变体返回条目，驾驶舱对这些条目只传 `--model`。
- ZCode 将工作区的 `trivium.launch.glmInteractivePath` 指向独立发行版脚本，并指定 Node 24.14.0。对同一脚本分别传 `--model GLM-5.3-Flash`、`--effort high`，两条命令各自返回退出码 1 及对应的 `Unknown option`。该入口的模型和强度均由原生供应商配置决定。验收从官方 v3.18.2 源码构建独立包，并在临时前缀补齐 arm64 的 keyring 绑定。[ZCode 发行源码与 CLI 参考](https://github.com/zai-org/ZCode/blob/v3.18.2/apps/zcode-cli/docs/usage/02-cli-reference.md)
- 使用独立 Git 工作区和 VS Code 用户数据，Codex、Claude、ZCode 使用临时原生配置。Antigravity 使用已有登录态。临时工作区的预检跳过审核者认证，审核者使用桩。验收请求使用可识别的首条消息标记，归档仅摘取必要字段。

## 自动化与 M3

| 检查 | 结果 |
| --- | --- |
| `npm --prefix extension run check` | 类型检查及构建通过，191 项单测、86 项真实 Extension Host 集成测试通过 |
| `npm run check` | 类型检查及构建通过，4,061 项通过，16 项由测试套件跳过，0 项失败 |
| 文档索引、版本指针、核心档位定向复跑 | 新报告登记后再次执行相应契约与跨进程档位用例，62 项通过 |
| 审核者档位 | 扩展前置链透传审核者的 `--profile`、`--tier-<审核者>` 和 Driver 声明。核心的跨 worker 档位用例核对入选侧收到的模型及档位来源。只填 `--driver-model` 时，原生终端模型参数为空 |
| 模型、预设与冻结 | 覆盖无覆盖参数、只选一项、逐模型无效组合、隐藏模型、旧预设恢复及新预设往返、预检后改回原值、入口在预检后变化，以及两种启动路径的真实子进程 argv |
| 终端复用 | 同键同配置复用。真实宿主验证 ZCode 原会话提前返回、冲突时认领和注入不增加，以及另开后关闭旧终端仍保留新会话 |
| `npm --prefix extension run e2e` | 双工作区独立运行在关终端后均进入 M3，各自显示本工作区的待审批卡。另一个慢夹具在运行中关终端，M3 跟踪至归档中的失败终态。两侧审核者指纹均为 `stub/0.0.0` |

## 未测与异常采样

- macOS 开发宿主之外的平台、商店安装包、新账号首次登录、其他供应商组合及其余目录选项未测。本次没有执行真实审核者付费审查。
- 首次使用空的 Antigravity 临时登录目录时未取得模型表。首次使用桌面配置的 ZCode 会话报告没有可用模型。上述两次没有首轮模型回读，记为未核实。表中 Antigravity 与 ZCode 的结果分别来自可用登录态和独立 CLI 的供应商配置。
- Codex 重复取证期间有启动了 `low` 参数、原生终端随后以退出码 1 结束的样本。该次没有首轮回读，原因未核实。逐次证据保留有回读的终端及其标识。
- 两个追加采样窗口在连接 VS Code 工作台时中断，点火未测。其中一个工作台主线程采样停在 macOS 钥匙串授权调用。调整夹具后，VS Code 使用正常的主目录和测试钥匙串，原生 Codex 仅通过工作区终端设置取得隔离配置，随后完成了上面的同主题复测。

## 改动文件

| 范围 | 工作树文件 |
| --- | --- |
| 装配、预检、预设 | [cockpitHtml.ts](../../extension/src/ui/cockpitHtml.ts)、[cockpit.ts](../../extension/src/ui/cockpit.ts)、[presetModel.ts](../../extension/src/presets/presetModel.ts) |
| 原生能力和终端 | [driverModels.ts](../../extension/src/launch/driverModels.ts)、[glmInteractive.ts](../../extension/src/launch/glmInteractive.ts)、[terminalRelay.ts](../../extension/src/launch/terminalRelay.ts) |
| 自动化 | [driverModels.test.ts](../../extension/test/unit/driverModels.test.ts)、[presetModel.test.ts](../../extension/test/unit/presetModel.test.ts)、[cockpitLifecycle.test.ts](../../extension/test/integration/cockpitLifecycle.test.ts)、[terminalRelay.test.ts](../../extension/test/integration/terminalRelay.test.ts) |
| 使用与开发 | [扩展说明](../../extension/README.md)、[扩展更新记录](../../extension/CHANGELOG.md)、[系统设计说明书](../02_design/系统设计说明书.md)、[使用手册](../07_manuals/使用手册.md)及其 [PDF](../07_manuals/使用手册.pdf)、[仓库维护记录](../08_project/README.md) |
| 验收 | 本报告、[测试目录](README.md)、[机读摘录](evidence/vscode-driver-models-20261125/native-launches.json)、[装配实拍](evidence/vscode-driver-models-20261125/装配.png)、[冲突实拍](evidence/vscode-driver-models-20261125/同主题冲突.png) |
