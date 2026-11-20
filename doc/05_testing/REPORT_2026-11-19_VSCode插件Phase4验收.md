# VS Code 驾驶舱 Phase 4 本地验收

**截至 11 月 20 日，Phase 4 验收通过。GLM 续话须使用下文实测配置。** 当前 0.3.0 安装包 SHA-256 为 `50f5929c2028ecf2ae465996bc778fe3f2c0f30aa2fabfbc2c7549f09eccbe06`。Codex、Claude Code、Gemini、GLM 均已在真实 M1 会话中验证入口、续话和关闭后监控。GLM 的续话在 `split` 模式通过，默认模式两次未获回答。独立 Mac mini 已完成首次隔离安装、入口 B 与人工审批，甲窗批准前后的记录和画面均已回收。新包和旧包的审批按机器、运行编号和主题分别记录。

## 11 月 20 日当前交付

- [安装包](../../extension/trivium-cockpit-0.3.0.vsix) 为 103,307 字节。已逐字节对比包内和两个实际安装目录中的扩展代码、中文手册，并比对安装清单。[安装文件校验](evidence/vscode-phase4-20261120/package-integrity.json)
- Bob 在三个原夹具中完成目录信任确认或直接进入客户端。修复前，Codex 与 Claude 的入口、续话文字都停留在编辑框。单测入口时使用分离回车，Codex 产生运行号，但续话仍停在输入框。修复后的默认 `auto` 对这两家在发送文本之后单独发回车，入口与续话使用同一设置。Gemini 沿用一次提交。先用 15 秒就绪延迟对照回车行为，再将最终 VSIX 装入三个全新扩展目录，在未配置任何 `trivium.launch.*` 用户设置的 profile 中按默认 3 秒、`auto` 重测。[中文手册](../../extension/README.md)
- 每个新主题均在原信任目录准备独立计划。真实 Driver 通过 VS Code 集成终端接收入口 B，在本夹具用 wrapper 启动桩审核者。测试从驾驶舱再发一道乘法题，要求返回输入中未出现的 `P4NEXT1071`。看到回答后关闭终端，对照关闭前后两张运行卡、实际归档和审核者指纹；三家最终样本均通过。[逐次运行与归档](evidence/vscode-phase4-20261120/native-m1.json)

| 真实 Driver | 最终包完整成功 / 点火 | 最终包续话成功 / 尝试 | 关闭后 M3 原运行 | 当前结果 |
|---|---:|---:|---|---|
| Codex，实际 CLI 0.169.0-alpha.11.1，既有探针记录 0.167.0 | 1 / 1 | 1 / 1 | `20261119T161214Z`，Gemini、GLM 均为 `stub/0.0.0` | 通过 |
| Claude Code 2.1.328 | 1 / 2 | 1 / 2 | `20261119T161921Z`，Gemini、GLM 均为 `stub/0.0.0` | 复测通过。首轮入口已在原生客户端执行、续话已入队，在观察期限内未取得运行号和续话回读；复测简化焦点措辞并将入口观察期限从 4 分钟延至 8 分钟 |
| Gemini / Antigravity 1.5.12 | 1 / 1 | 1 / 1 | `20261119T161246Z`，GLM 为 `stub/0.0.0` | 通过 |
| GLM / 独立 ZCode CLI 0.17.1 | 1 / 4 | 1 / 3 | 选模后三次均保留同一运行卡，Gemini 均为 `stub/0.0.0` | 配置 `split` 并在入口回答后发送续话通过。默认模式 0/2；另一次点火发生在配置模型前。桌面内置 CLI 0.17.3 的两次启动失败在累计表计入。[选模前](evidence/vscode-phase4-20261120/glm-standalone.json) · [选模后三次真机实测](evidence/vscode-phase4-20261120/glm-after-model.json) |

**累计采样（含初次信任拦截、故障对照和复测）。** 下表按严格的独立回答标记或真实运行号计入口成功。Claude 的一次对照样本另有分行回答「P4ACK」和「437 加 38 的结果:475」，该次没有命中自动判据。[11 月 19 日原始矩阵](evidence/vscode-phase4-20261119/native-m1.json) · [后续逐次记录、真实归档指纹及汇总](evidence/vscode-phase4-20261120/native-m1.json)

| 载体 | 入口成功 / 点火 | 续话成功 / 尝试 | 实读 M3 次数 | 关闭后仍见原运行次数 |
|---|---:|---:|---:|---:|
| Codex | 3 / 5 | 2 / 4 | 5 | 3 |
| Claude Code | 2 / 6 | 2 / 5 | 5 | 2 |
| Gemini | 3 / 5 | 2 / 4 | 4 | 2 |
| GLM | 3 / 6 | 1 / 3 | 3 | 3 |

11 月 20 日 07:17（新加坡时间）补测独立 ZCode。官方 v3.18.2 源码打包时缺少 `@zcode/shared/dist`，在临时源码根运行 `mise exec -- pnpm exec tsc -b packages/shared --force`，再运行 `mise exec -- pnpm build:zcode --skip-build --base-url http://127.0.0.1/zcode/`，发行包校验通过。用 Node 24.14.0 启动解压后的 `bin/zcode.mjs`，仅在原 GLM 夹具登记实测路径和解释器。安装包点火后，真实 TUI 显示本次主题和入口文本，提交时提示 `Select a model before sending a message`。该次采样止于模型选择。Bob 随后完成登录和选模，后续实测见上表。[补充采样](evidence/vscode-phase4-20261120/glm-standalone.json)

独立 CLI 首次登录 BigModel 时报告系统凭据存储不可用。还原到发行包的模块解析环境实测，缺少与 JavaScript 包同版本的 `@napi-rs/keyring-darwin-arm64@2.1.2`。从本次源码安装目录补入解压后的 `runtime/zcode/agent/node_modules` 后，原 Node 解释器成功加载绑定，在 macOS 钥匙串写入、读回并删除了一条临时测试项。修复作用于本机解压目录，原发行压缩包仍需同一补件。Bob 选模后，真实终端显示 GLM-5.3 并回复了两道现场生成答案的算术题。[选模后的会话证据](evidence/vscode-phase4-20261120/glm-after-model.json)

| GLM 选模后实测 | 入口 B 的运行号 | 续话结果 | 关终端后 |
|---|---|---|---|
| 默认，发现运行即发 | `20261119T232920Z` | 显示 `Queue(1)`，队列中续话与旧入口文本相连。150 秒内未见答案 | M3，原编号可见 |
| `split`，见到入口回答后发 | `20261119T233429Z` | 23:34:40 UTC 读回 `P4ACK475`，23:34:45 读回 `P4NEXT1071` | M3，原编号可见 |
| 默认，见到入口回答后发 | `20261119T233705Z` | 续话文本留在 ZCode 输入框，150 秒内未见答案 | M3，原编号可见 |

三次均从打包的 0.3.0 新装启动。每次都复核归档的主题、运行号、GLM Driver、成功终态及唯一入选 Gemini 的桩指纹。原生 Bash 的一次性权限弹窗发生在夹具内，与驾驶舱最终人工审批分别记录。固定入口答复标记与续话标记分别由两道不同的算术题生成。[逐次回读](evidence/vscode-phase4-20261120/glm-after-model.json)

**GLM 使用方法（本机实测）**　在 VS Code 的工作区设置 JSON 中为 GLM 选择分开发送文本和回车。在驾驶舱选择 ZCode，执行前置链并点火。在 ZCode 核对命令及夹具路径，有需要时选 `Allow once`。等终端显示入口回答，再在驾驶舱底部输入续话并点「发送 ▸」。运行卡出现后可关闭终端，在 M3 按同一编号继续查看。实测采样对只打开 GLM 的临时窗口设 `trivium.launch.sendMode=split`。日常使用以下按载体覆盖配置可把相同的设置限定于 GLM。

```json
{
  "trivium.launch.carrierOverrides": {
    "glm": { "sendMode": "split" }
  }
}
```

在 `extension/` 中运行以下命令可用安装包重复采样。每次在原信任目录认领一个独立主题，保留已有的运行、归档和人工闸门。原生 Driver 使用已登录账号，审核者使用桩。

```sh
export VSCODE_EXECUTABLE_PATH='/Applications/Visual Studio Code.app/Contents/MacOS/Code'
export TRIVIUM_TEST_VSIX="$PWD/trivium-cockpit-0.3.0.vsix"
TRIVIUM_M1_FIXTURES=/tmp/trivium-m1-nLP5pU npm run real:m1 -- codex gemini
TRIVIUM_M1_FIXTURES=/tmp/trivium-m1-Btsg67 npm run real:m1 -- claude
TRIVIUM_M1_FIXTURES=/private/tmp/trivium-m1-rSWtkl TRIVIUM_M1_SEND_MODE=split TRIVIUM_M1_WAIT_FOR_ENTRY_REPLY=1 npm run real:m1 -- glm
```

| 当前包与回归 | 判定与证据 |
|---|---|
| 开发态与干净 VS Code 安装态入口 B | 开发态、安装态均用真实 Extension Host 和桩 Driver/审核者通过两窗点火、结果、续话、裁决与闸门。安装态回归两仓同秒得到 `20261119T160752Z`，各窗只见本仓主题。另一个运行 `20261119T160802Z` 在 running 时关闭终端，M3 继续显示原编号并收到故障桩的 failed 终态。[开发态](evidence/vscode-phase4-20261120/development.json) · [安装态](evidence/vscode-phase4-20261120/installed.json) |
| 长输出与手册 | 安装包 50,000 行、799,999 字节、100 次滚动，末屏 14 行，位置恢复，局部渲染及同步布局 P95 约 0.1 ms，最大约 0.2 ms。命令打开包内中文手册并读回标题。[安装态回读](evidence/vscode-phase4-20261120/installed.json) |
| 最终包的人工审批 | 交给 Bob 的安装态甲窗为 `/private/tmp/trivium-phase4-fvY6Aj/repo-0`，运行 `20261119T160524Z`，操作前为 awaiting_approval、审批 0 条。新加坡时间 00:13:19 读回同运行批准记录 1 条，闸门 approved，状态栏「自由编辑」。记录的 session_id 为空。[操作前回读](evidence/vscode-phase4-20261120/approval-before.json) · [操作前截图](evidence/vscode-phase4-20261120/approval-before.png) · [操作后回读](evidence/vscode-phase4-20261120/approval-after.json) · [操作后截图](evidence/vscode-phase4-20261120/approval-after.png) |
| 插件回归 | 在 `extension/` 运行 `npm run check` 为 182 个单元、83 个宿主集成通过。打包成功。安装态第一次并行回归已完成甲乙两窗裁决，第三个夹具的前置链观察超时，原甲窗以同一 profile 重新打开供批准。随后使用全新隔离目录重新执行完整 `npm run e2e` 通过。[选模后插件检查](../../extension/.vscode-test/phase4-20261119/check-glm-standalone.log) · [打包](../../extension/.vscode-test/phase4-20261119/package-native-fix.log) · [首次安装回归](../../extension/.vscode-test/phase4-20261119/installed-native-fix.log) · [完整复跑](../../extension/.vscode-test/phase4-20261119/installed-native-fix-retry.log) |
| 根仓回归 | 根目录 `npm run check` 最终退出 0，共 4,068 项，4,052 通过、16 跳过、0 失败。[独立机器验收后根仓复跑](../../extension/.vscode-test/phase4-20261119/root-macmini.log) |
| 真实启动冒烟 | 用开发仓原探针运行 `TRIVIUM_REAL=1 npm run real` 为 7 通过、1 失败，GLM 桌面入口提前退出。指定包含独立 ZCode 和实际 Node 路径的 `TRIVIUM_REAL_PROBE_FILE` 后重跑，8 项通过。覆盖四家终端存活 6 秒及四项真实闸门契约。四家实际收发详见上表。[独立入口冒烟日志](../../extension/.vscode-test/phase4-20261119/real-glm-standalone.log) [冒烟日志](../../extension/.vscode-test/phase4-20261119/real-native-fix.log) |
| 独立干净机器 | Mac mini 首次隔离安装通过，入口 B 走到人工批准并读回「自由编辑」。见下节。 |
| 历史工件 | 复核 `git diff --exit-code -- .reviews/VSCode插件Phase3/task.json` 退出 0，已与 Git 基线一致。 |

## 11 月 20 日独立 Mac mini 安装验收

通过 `ssh macmini` 在另一台物理 Mac（Macmini9,1，arm64，macOS 27.2.1）执行。开发机为 MacBook Pro。Mac mini 已安装 VS Code 1.134.0、Node 26.13.0 和 Git 2.54.0，已有日常 VS Code 用户数据。验收前其默认扩展目录中驾驶舱为 0 个，用户目录的常用 Trivium 运行时、核心 skill 和开发仓路径均不存在。新建用户数据目录、扩展目录和三个夹具仓，只安装本次 VSIX。此次覆盖独立机器上的干净插件首次安装；系统沿用已有 macOS 与开发工具。[环境及包内文件校验](evidence/vscode-phase4-20261120/macmini-environment.json)

- **安装与激活通过。** 传输前后 SHA-256 相同。隔离扩展列表只有 `triviumcode.trivium-cockpit@0.3.0`。通过命令面板激活安装包，并从包内手册读回「走通一次入口 B」。测试入口及命令见环境记录。首次传输漏带编译测试夹具的 Schema，脚本在安装前退出；补齐同一工作树的 `dist/test/skills` 后完整脚本退出 0。
- **入口 B 和双窗隔离通过。** 两个真实 Extension Host 分别在甲、乙仓完成前置链、点火、发现运行、查看意见、逐项裁决和闸门展示。两仓同秒运行号均为 `20261119T234657Z`，各窗只显示本仓主题。Driver 为交互替身，Gemini 与 GLM 均回读 `stub/0.0.0`。夹具关闭 VS Code 工作区信任提示并跳过厂商账号探活，四家真实账号的收发沿用上文实测。
- **M3 与长日志通过。** 第三个仓在 `20261119T234711Z` 仍为 running 时关闭终端，在 M3 收到同一运行的预设故障终态 failed。50,000 行、799,999 字节经 100 次滚动后末屏 14 行，位置恢复，局部渲染及同步布局 P95 约 0.2 ms，最大约 0.4 ms。[远端原始验收回读](evidence/vscode-phase4-20261120/macmini-installed.json)
- **人工审批通过。** 甲窗 `repo-0` 的主题为「入口B验收甲」，阶段 plan，运行 `20261119T234657Z`。交给 Bob 时为 `awaiting_approval`、0 条审批记录；11 月 20 日 07:49:21（新加坡时间）同一仓、主题、阶段及编号新增一条 `approved` 记录。回读时闸门为 `approved`，状态栏为「自由编辑」。随后回读乙仓的同编号闸门仍为 `awaiting_approval`。审批记录的 `session_id` 为空。[批准前截图](evidence/vscode-phase4-20261120/macmini-approval-before.png) · [批准后回读](evidence/vscode-phase4-20261120/macmini-approval-after.json) · [批准后截图](evidence/vscode-phase4-20261120/macmini-approval-after.png)

## 11 月 19 日首包与原始验收

2026-11-19，`feat/vscode-extension`，起点 `5ddf7459`，macOS 27.2.1 arm64，Node 25.2.1，VS Code 1.147.0。开始时 Git 工作树干净，wrapper 的 `status --json` 列出 141 个主题，开放闸门数为 0。开发仓无本次正式双审。范围为 [v2 计划 §6.4、§7](../08_project/2026-11-05-VSCode插件需求分析与开发计划-v2.md)。

原工作树已有 0.3.0 包、Phase 0～3 功能、独立组件测试和启动冒烟。旧 e2e 直接调用 CLI，允许 failed/cancelled 终态，只有 success 才验指纹；第二条只断言观察值为布尔值。旧终端冒烟只要求终端 6 秒内存活。以上均未作为四家 M1 接收输入的证据。

### 首包验收表

| 项目 | 判定 | 观察结果与证据 |
|---|---|---|
| 开发态入口 B，真实 Extension Host 与桩审核者 | 通过至审批前 | 两个窗口均通过前置链、点火、续话、运行发现、意见、逐项裁决、预览、落盘、闸门按钮断言；输入来自实际 Webview 与终端。两个真实 CLI worker 各自归档 Gemini、GLM 的 `stub/0.0.0`。[开发态回读](evidence/vscode-phase4-20261119/development.json) |
| 多窗口 / 多仓隔离 | 通过 | 两仓共享 run_root，安装态两窗同时产生 `20261119T153917Z`。甲、乙各自的运行卡、闸门与裁决都归属于自己的主题。窗口各自以本仓为第一个工作区目录。[安装态双窗回读](evidence/vscode-phase4-20261119/installed.json) |
| 长日志虚拟滚动 | 通过 | 直接向实际 Webview 输入 50,000 行、799,999 个 UTF-8 字节，100 次等距滚动；核验末行和卡片刷新后的位置。安装态末屏只渲染 14 行，更新可见文本加同步布局的 P95 约 0.1 ms，最大约 0.3 ms。测量不含 worker 文件 I/O、进程间传输和 GPU 绘制。宿主日志尾窗默认 65,536 字节，可配置。[输入和断言](../../extension/scripts/runE2E.mjs) |
| 安装、激活与手册 | 通过 | `npm run package` 先编译实际发包 bundle。以 CLI 安装至全新的 extensions-dir，列表只有 `triviumcode.trivium-cockpit@0.3.0`；两个全新 user-data-dir 启动时无开发扩展参数，命令激活成功。包内中文手册通过命令打开，实际读回「走通一次入口 B」。[中文手册](../../extension/README.md) |
| 安装包入口 B 与终端关闭 | 通过 | 关闭协同终端后 M3 仍能显示同一 run 的结果和闸门。甲窗审查计票为 0 通过、2 修改后通过、0 不通过，next_action 为 proceed，两条桩意见均已裁决，随后读回批准记录。乙窗验证到待审批。[闸门现场](evidence/vscode-phase4-20261119/approval-before.png) |
| 运行中关闭终端，原 run 继续监控 | 通过（安装包 + 故障桩） | 另一个临时仓让 Gemini 桩延迟 12 秒模拟超时。关闭终端前卡片为 running，切到 M3 时 status.json 仍为 running；随后同一编号 20261119T154306Z 的卡片变为 failed，与两侧桩指纹和真实归档相符。该项专验监控能收到关闭后的终态更新。[运行中关闭与终态回读](evidence/vscode-phase4-20261119/installed-live.json) |
| 最终人工审批与操作前后回读 | 通过（状态和记录） | 在甲窗交给 Bob 操作。主题「入口B验收甲」，运行 `20261119T153917Z`。操作前为 `awaiting_approval`、审批 0 条；操作后为 `approved`、同运行同阶段审批 1 条，登记时间 23:49:17（新加坡时间）。工作台显示「自由编辑」。审批记录的 session_id 为空，未登记操作者身份。[操作前](evidence/vscode-phase4-20261119/installed.json) · [操作后](evidence/vscode-phase4-20261119/approval-after.json) · [操作后工作台](evidence/vscode-phase4-20261119/approval-after.png) |
| 独立干净机器 | 未测 | 在同一台 Mac 上隔离安装目录、用户数据目录与测试仓，复用系统 VS Code、Node、Git 和本地构建的编排器。独立干净主机待提供。 |
| 根仓回归 | 通过 | 根目录两次 `npm run check` 均退出 0，最终复跑 4,068 项中 4,052 通过、16 跳过、0 失败。[最终日志](../../extension/.vscode-test/phase4-20261119/root-final.log) |
| 插件回归 | 通过 | 在 `extension/` 运行 `npm run check`，182 个单元测试、83 个真实 Extension Host 集成测试通过。 |
| 真机冒烟 / gate 对拍 | 失败 | `TRIVIUM_REAL=1 npm run real` 最终 7 通过、1 失败。Codex、Claude、Gemini 启动存活通过，GLM 的真实 TUI 在 6 秒内退出。另 4 项为真实 gate 输出形状、缺裁决失败形状、临时仓首写及修复，不含四家输入确认。 |

### 首批四家真实 M1

下表按真实窗口点火记尝试数。入口成功要求原生会话独立回读或对应真实 run，续话成功要求原生会话对第二条消息作出可区分的响应。界面显示「已注入」只证明宿主发送。前三个载体各有一项真实窗口信任选择，测试保留给操作者处理。计数为本轮实测，启动冒烟另计。[逐次记录](evidence/vscode-phase4-20261119/native-m1.json)

| 载体与版本 | 点火次数 | 已证实入口成功 | 续话尝试 / 成功 | 已证实 M1→M3 | 原 run 后续监控 | 判定 |
|---|---:|---:|---|---|---|---|
| Codex 0.167.0 | 1 | 0 | 0 / 0 | 1 次，关闭后实读 M3 | 未测，无 run_id | 阻塞，终端显示 Trust this folder |
| Claude Code 2.1.328 | 1 | 0 | 0 / 0 | 未测 | 未测，无 run_id | 阻塞，入口发送前出现信任提示 |
| Gemini / Antigravity 1.5.12 | 1 | 0 | 0 / 0 | 未测 | 未测，无 run_id | 阻塞，入口发送前出现信任提示 |
| GLM / ZCode 0.17.3 | 2 | 0 | 0 / 0 | 未测，交互进程未就绪 | 未测，无 run_id | 失败，两次点火均未建立可接收输入的会话 |

GLM 的第一次点火使用探针入口和 Node，PTY 诊断返回「无法定位 CLI ZCode Built-in Provider Config」。加上传自本机探针的两个 provider 文件路径后，相同入口在独立 PTY 明确报 `Cannot find package '@zcode/tui'` 并退出；驾驶舱再次点火也未就绪。整个过程只传递两个路径。官方文档提供单独构建含 TUI 发行包的方法，当前本机探针指向桌面包的脚本。[ZCode 官方仓库](https://github.com/zai-org/ZCode#zcode-命令行版)

复核时，`/Applications/ZCode.app/Contents/Info.plist` 的桌面版本为 3.19.0，`command -v zcode` 查无独立入口。官方 GitHub 的 `releases/tags/v3.19.0` 返回 HTTP 404，官网安装页面提供桌面安装包。现有 GLM 结论对应这台机器登记的 0.17.3 CLI。[官方安装说明](https://zcode.z.ai/cn/docs/install)

继续测试时，Codex 与 Gemini 对应的临时父目录为 `/tmp/trivium-m1-nLP5pU`，Claude 为 `/tmp/trivium-m1-Btsg67`。每个子目录以载体 ID 命名。由 Bob 确认具体夹具目录的原生权限后，可用 `TRIVIUM_M1_FIXTURES=<父目录> npm run real:m1 -- <载体ID>` 复用同一仓库。GLM 需先有经探针登记、可在交互终端启动到输入框的 ZCode 入口。

Bob 可分别在终端运行以下命令，核对原生提示中的夹具路径后决定是否信任该目录，随后退出客户端。每条命令只启动一家客户端。

```sh
(cd /tmp/trivium-m1-nLP5pU/codex && /opt/homebrew/bin/codex)
(cd /tmp/trivium-m1-Btsg67/claude && ~/.local/bin/claude)
(cd /tmp/trivium-m1-nLP5pU/gemini && ~/.local/bin/agy)
```

### 首包、复跑与日志

- 包为 [首包本机留存副本](../../extension/.vscode-test/phase4-20261119/trivium-cockpit-0.3.0-before-native-fix.vsix)，SHA-256 为 `cc32d6711a6e3973abdc67dd7f327fecf73796c06f18122a1a34be0b14ae165b`。已逐字节对比包内和实际安装的 JavaScript、中文手册，清单仅多出 VS Code 安装元数据。[安装文件校验](evidence/vscode-phase4-20261119/package-integrity.json)
- 在仓库根运行 `npm run check`。在 `extension/` 下运行 `npm run check`、`npm run e2e`、`npm run package`。本机各 VS Code 测试均设置 `VSCODE_EXECUTABLE_PATH="/Applications/Visual Studio Code.app/Contents/MacOS/Code"`。
- 安装包回归使用 `TRIVIUM_TEST_VSIX="$PWD/trivium-cockpit-0.3.0.vsix" TRIVIUM_KEEP_WINDOW=1 npm run e2e`。开发态与安装态均使用交互 Driver 替身、真实编排器和桩审核者。夹具预检显式跳过账号探活。真实 M1 另走 `npm run real:m1`，两类结果独立记账。
- 本机原始日志在 [运行日志目录](../../extension/.vscode-test/phase4-20261119/)，包括 `root-check.log`、`check-final.log`、`e2e-final.log`、`package-final.log`、`installed.log`、`installed-live.log`、`real-final.log` 及 `m1*.log`。独立保存的 JSON 与截图在 [验收证据目录](evidence/vscode-phase4-20261119/)。
- 初次执行原有 `npm run real` 刷新了开发仓历史 Phase 3 的 `task.json` 中三个时间戳。对比起点仅有 `updated_at` 与两条 `joint_checks[].at` 变化。测试现已改在临时副本调用 `gate --check`。11 月 20 日已确认该文件与 Git 基线一致。当前裁决台校验通过后仍保留起草时的缺口文字，最新状态以闸门区和「已落盘并通过闸门校验」结果为准。
