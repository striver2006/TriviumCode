# TriviumCode 驾驶舱（VS Code 插件）

在 VS Code 中选择主攻助手和审核者，把任务送入主攻助手的交互终端，并在驾驶舱查看审查进度、意见和运行记录。

## 安装与首次使用

1. **安装驾驶舱。** 在 VS Code 1.85 或更高版本打开左侧「扩展」，搜索 `@id:triviumcode.trivium-cockpit`，选择「TriviumCode 驾驶舱」并点「安装」。离线安装时，在「扩展」视图右上角点「… → 从 VSIX 安装…」，选择收到的 `.vsix` 文件。
2. **准备项目。** 在本机安装 TriviumCode 核心，进入要审查的 Git 仓库执行 `init`，再按实际选用的 CLI 运行 `doctor` 探测。如果这台机器已经为该项目完成初始化和探测，可直接打开项目。安装命令和各平台的探测示例见[《TriviumCode 部署手册》第 2–4 节](https://gitcode.com/czb99/TriviumCode/blob/f156027b8adb5f1ef81f491dd2c86f7e16c2fb05/doc/06_deployment/部署手册.md)。
3. **打开驾驶舱。** 在独立的 VS Code 窗口中打开项目根目录，点左侧「Trivium → 环境健康」核对所选 CLI。从菜单「查看 → 命令面板」打开命令面板（macOS 快捷键 `⌘⇧P`，Windows 和 Linux 快捷键 `Ctrl+Shift+P`），运行「打开 Trivium 驾驶舱」，即可选择主攻助手（Driver）、审核者和任务入口。需要离线查阅本文时，在命令面板运行「打开 Trivium 驾驶舱使用手册」。

## 点火前选择 Driver 模型和思考强度

在「装配」选择 Driver，再用旁边两个下拉框选模型和思考强度。两项起初都显示「沿用 CLI 默认」。只想改一项时，将另一项留在默认位置。更换 Driver 会重新读取它的模型目录，选择模型后会显示该模型支持的强度。

| Driver | 如何选择 |
| --- | --- |
| Codex | 从当前工作区的可见模型中选择。若 CLI 能确定默认模型的强度列表，也可只选强度。 |
| Claude Code | 按当前供应商显示名称和 CLI 别名选择，强度取该模型与当前 CLI 都支持的值。 |
| Antigravity | 直接选择带 Low、Medium、High 等标记的模型变体。该变体决定本次强度。 |
| ZCode | 独立交互发行版 3.18.2 由原生供应商配置决定模型和强度。驾驶舱按实际解析到的交互程序显示能力。 |

选好后点击「① 执行前置链」，再点「② 确认主题并点火」。改动任一选择后需重新预检。如果同一 Driver、主题和入口已有终端，启动配置相同时可以复用。发生冲突时，选「保留原会话」继续原来的工作，或选「保留原终端并另开会话」把新任务交给新配置。两个选择都会保留旧终端。

预设保存这两项选择。旧预设按 CLI 默认加载，已失效的选项会标出，重新选择后即可预检。「高级 → 档位」继续配置审核者。点火结果显示本次请求，实际采用的模型和强度以原生会话回读为准。

## 走通一次入口 B

1. 在「装配」选择 Driver，点选参与的审查者，选择「B · 计划双审」。输入审查焦点，可填写显式主题。入口 B 审查已有计划，请选择已由该 Driver 认领并归档计划原稿的主题。
2. 点击「① 执行前置链（resolve → preflight）」。检查解析主题和逐步结果；失败时先处理该步显示的原因。确认后点击「② 确认主题并点火」。Driver 会话在命名终端中打开；如 CLI 询问工作区权限，请在该终端确认。
3. 在终端核对入口和焦点已被 CLI 接收。续话时在驾驶舱底部输入第二条消息，点一次「发送 ▸」。ZCode 默认分开发送文字和回车。若入口仍在处理中，驾驶舱暂存续话，等原会话的轮次结束后自动提交。可从终端查看 GLM 对第二条消息的回答。驾驶舱将该终端的 ZCode 运行日志放在 VS Code 本次扩展宿主的日志目录中，用于识别轮次。首次使用若遇到原生工具权限弹窗，请先核对夹具或项目路径及具体命令。Codex、Claude Code 的默认提交方式也为分开发送，Antigravity 一次提交。若显式配置了 `trivium.launch.sendMode`，驾驶舱使用所选模式；`trivium.launch.carrierOverrides` 中的同名设置优先。
4. 在「运行监控」核对主题、阶段、运行编号和各侧状态。在各审核者名下查看本次尝试的 stdout。展开「worker.log 尾部」滚动查看日志窗口；其输入大小由 `trivium.monitor.logTailBytes` 控制。点击审查正文或意见位置查看结果。「运行历史」可回放归档轮次。
5. 需要关闭协同终端时，先确认运行卡已出现并记下编号，再点终端的垃圾桶。驾驶舱切换到「M3 外部驾驶舱（纯监控）」，可用原编号继续看各侧新增的 stdout、进度和归档。隐藏终端面板会保留会话。M3 中需要续话时，须回到可用的 Driver 会话。
6. 闸门显示「裁决未齐」时点「进入裁决台（FR-8）」。逐项选择接受、驳回或暂缓，填写理由，为接受项填写落实位置。点击「生成预览」，核对内容、作者和文件名，再点「预览确认后落盘」。入口 B 每轮还需要 Driver 独立输出下一版完整计划。若报 `missing_next_plan`，回到 Driver 会话完成定稿，然后在驾驶舱「刷新」复核。若终端已关闭，需先恢复该 Driver 会话。
7. 当闸门显示「等待人工审批」，由项目审批人核对主题、轮次、计票、警告和工作树摘要，再亲自点击「批准」，或填写理由后拒绝。点击后查看动作结果和工作树摘要。「放弃…」需要二次确认。审查中和等待审批期间保留业务文件原状。

TriviumCode「主攻 + 多审」双审流水线的 VS Code 前端。**集成面两条 + 一个写例外 + 一个只读查询**：

- **CLI**：`.trivium/bin/trivium --json` + 退出码协议（含 FR-9 的 approve/abandon 审批动作——点击经宿主直发，不经过任何模型上下文）；
- **文件面**：只读 watcher（state.json / status.json / worker.log / 逐侧 stdout / `.reviews/**`）；
- **唯一写例外（FR-8）**：裁决件经**预览确认后**的新建与写回（`.reviews/<主题>/<阶段>/` 下 `trivium.disposition.v1` 契约件；防覆盖与正确性由编排器 `gate --check` 兜底）；
- **只读 git 查询（FR-9 提示性摘要）**：`git status --porcelain -z`（纯只读；权威口径以 approve 输出的 worktree_summary 为准）。

不复制编排器业务逻辑，阶段循环始终由终端里的 Driver 会话（入口 skill）驱动。

## 查看审核者的实时输出

运行卡按主题、运行编号、审核者和尝试号显示已脱敏的标准输出。厂商 CLI 可能集中在收尾时才写出数据。「等待该侧输出」表示核心已经建立输出文件。旧核心或旧运行缺少实时记录时，卡片会注明，仍可查看 worker.log 和归档结论。审核者的输出（包括 JSON 事件）和最终审查意见分别显示。

面板跟随文件尾部，使用 `trivium.monitor.logTailBytes` 配置窗口，默认每侧 64 KiB，上限 256 KiB。「最近输出」表明较早的字节已退出显示窗口。切回驾驶舱时会补读尾部。正常封口后可以点击「查看完整 stdout」。遇到暂缓、超时、中止或输出截断时请留意该侧提示；写入恢复与完整性未确认会分别显示。文件与本次运行一起保存在运行目录，清理运行目录后仍可通过「运行历史」查看归档意见。

需要按旧方式运行时，可在本次 worker 继承的环境中设置 `TRIVIUM_LIVE_STDOUT=0`。新文件在 POSIX 系统按 0600 创建；Windows 文件访问权限取决于运行目录的 NTFS ACL，本轮 Windows 安装态未测。

## 功能

- **环境健康面板**（Activity Bar「Trivium」）：读取 `.trivium/config.local.yaml`
  探针结论展示四家 Agent 可用性 / 版本 / 入口；未 init 的工作区给出引导。
- **装配表单**：Driver 单选 / 审查者多选（探针驱动、自动排除与 Driver 同身份项）、
  入口 A/B/C/D、`--max-rounds`、模型档位高级折叠、context 路径选择。
- **前置链**：`topic resolve → preflight → 主题确认 → topic claim`（入口 A/B），
  全部经 wrapper 调用；退出码 64/65/69/70 语义化展示。
- **M1 终端协同**：GLM 使用下文的主攻交互入口，其余 Driver 按探针入口拉起交互会话（命名终端、按
  `agent|topic|entry` 身份键复用），就绪延迟后注入入口命令；失败回退可复制命令条；
  输入框续话尽力中继；终端关闭自动降级为 M3 纯监控。
- **运行监控**：`state.json` 白名单发现 run → 运行目录 `status.json` watcher
  （阶段条、逐侧状态卡、30s 周期心跳失联重估）+ `worker.log` 尾随 +
  `--cancel` 中止按钮；侧完成即在 `.reviews/` 归档中列出审查正文入口。
- **审查意见结构化展示**（Phase 2，FR-6）：消费 `_meta/review-*.json`
  （review.v2，逐文件降级）→ 意见列表（按审查者分组、severity 分级、侧完成实时
  刷新）→ 行内批注（VS Code Comments；location 归一含逗号多区间、行号 fuzzy、
  快照一致性两层判据，漂移一律显式标注）→ Problems 面板（blocker/major→Error、
  minor→Warning、nit→Information）→ Diff 视图（**该轮冻结基线**对比当前文件；
  新增/删除/对象缺失降级明示）；同一文件多家意见分层合并、可逐家开关。
- **运行历史**（Phase 2，FR-7）：Activity Bar「运行历史」树——主题 → 运行两级
  （时间倒序、逐轮意见数与严重度分布、verdict）；完结运行以 `_meta/` 归档为
  第一事实源（不依赖可被轮转清理的 run_root）；点击任意运行回放该轮全部意见
  （批注/诊断/意见列表聚焦），状态栏可快捷切换回放轮次。

- **裁决台**（Phase 3，FR-8）：消费 `gate --check --json` 缺口清单 → 驾驶舱逐条
  「接受/驳回/暂缓 + 理由 + 落点」表单（首写/修复两形态：missing_disposition 首写
  建表含 fallback 期望集；既有件的 empty_reason/missing_action/缺裁编号进修复模式，
  合法行保留原文）→ 生成 `trivium.disposition.v1` 契约草稿（front-matter 七字段、
  addresses 派生自 `run-<runId>.json`.artifacts[]、role 取当轮 Driver 的 run 权威源）
  → **预览确认后落盘**（本插件对 `.reviews/` 的唯一写入；起草独占创建，修复原子
  替换 + 载入 hash 防并发覆盖）→ 落盘即自动重跑 gate 校验，不过即回修复模式闭环。
  三种裁决理由均须人工非空输入；缺口里的意见编号可点击定位到行内批注。
- **人工审批**（Phase 3，FR-9）：`state.json` 感知 `awaiting_approval` → 驾驶舱
  浮出闸门区：计票（gate 输出的 round_verdict 原样展示，与历史树 verdict 同源）+
  warnings 一等展示 + 工作树摘要（点击前为相对 HEAD 的提示性口径并明示盲区；
  批准后展示编排器权威 worktree_summary）+ 批准 / 拒绝（理由必填人工输入）/
  放弃（二次确认）三按钮。点击动作经宿主直发 CLI，不经过任何模型上下文；
  不自动审批、不倒计时。
- **保存防护与三色灯**（Phase 3，FR-10）：状态栏 🟢 自由编辑 / 🟡 闸门等待 /
  🔴 审查中锁闭。**API 边界如实声明**：VS Code 没有取消保存的 API（will-save
  挂起共享 1.5 秒预算），本插件承诺「事前预警（编辑期 modal）+ 事中警示（保存
  瞬间快照与 toast）+ 事后一键恢复（原子写回保存前内容，修改可 Ctrl+Z 找回）」，
  不承诺阻止写盘；`state.json` 不可读时按锁闭保守处理。`.reviews/`、`.trivium/`、
  `.vscode/` 不拦。
- **装配预设**（Phase 3，FR-11）：装配参数（Driver/审查者/入口/轮次/高级项）存为
  命名预设，双作用域（工作区级 workspaceState / 用户级 globalState，均不落仓库
  文件）；加载只回填装配参数，不覆盖正在输入的主题与正文；不写 `.trivium/` 任何
  yaml。

## 平台边界

GLM 主攻已在 macOS arm64、VS Code 1.147.0 和 TriviumCode 核心 1.3.7 上完成真实安装态验收，覆盖官方独立 ZCode CLI 点火、忙时与空闲续话，以及关闭终端后继续查看原运行。Windows 真机未测。

### 选择 GLM 主攻交互入口

在受信任的工作区打开「设置 (JSON)」。已安装官方独立命令时，在登录终端执行 `command -v zcode`，将输出的绝对路径填入设置。例如：

```json
{ "trivium.launch.glmInteractivePath": "/Users/bob/.local/bin/zcode" }
```

如果使用解压的发行包，在终端执行 `command -v node`，把实际 Node 和脚本的绝对路径分别填入。例如：

```json
{
  "trivium.launch.glmInteractivePath": "/Users/bob/Tools/ZCode CLI/bin/zcode.mjs",
  "trivium.launch.glmNodePath": "/Users/bob/.local/share/mise/installs/node/24.14.0/bin/node"
}
```

路径各占一个字段，可含空格。交互路径留空时优先查用户安装启动器、当前独立发行包，再查扩展宿主 PATH 与常用 bin 目录，最后尝试工作区探针。审核者默认使用同包的 Agent 脚本，桌面版仍支持后台审核。脚本解释器留空时先试探针登记的绝对 Node，再读工作区 wrapper。直接执行的官方 shell 启动器自行查找 node；GUI 终端提示找不到 node 时使用第二种配置。显式错误会在点火时指出设置名。

选择 ZCode 主攻，完成前置链并点火。驾驶舱显示实际选择的入口及脚本解释器。默认发送模式下，已识别的独立发行脚本及其官方包装命令首次发送会等待 ZCode 的启动完成日志，再按就绪延迟送入文字。自定义包装器使用设置的就绪延迟。若 120 秒内未读到事件，核对原生终端就绪后可点「重新注入」。在原生终端核对主题和 `/skill dual-run`，待运行卡出现后核对运行号。同主题、同入口点火时，若实际程序或启动配置变化，按冲突提示选择是否另开会话。后台健康行和审核者可用性来自核心探针。续话默认等待该会话的轮次结束，关终端后仍可在 M3 查看原运行。

若提示桌面脚本缺少 `@zcode/tui`，安装独立命令行发行版或将上述设置指向已解压的独立包。若出现目录信任、登录、模型选择或工具权限提示，请在原生界面核对并操作，输入未送达时再用「重新注入」。在 macOS arm64 的 3.18.2 源码发行包上，首次登录报告系统凭据存储不可用时，检查独立包的 `agent/node_modules` 是否含与 JS 包同版本的 keyring 原生绑定。该版本的实测与本机补件见仓库中的 `doc/05_testing/REPORT_2026-11-19_VSCode插件Phase4验收.md`。


## 开发

```bash
npm install          # 安装依赖
npm run check        # typecheck + 打包 + 单测 + 集成测试（vscode-tests 起真实 extension host）
npm run e2e          # 构建核心测试夹具及插件，两个隔离窗口执行入口 B，停在批准前
TRIVIUM_REAL=1 npm run real  # 四家启动存活与真实 gate 契约、临时仓裁决闭环
npm run real:m1      # 使用本机已探测的交互 CLI；须先完成根目录构建和 npm run e2e
npm run package      # vsce 打包 .vsix
```

开发前在仓库根目录和 `extension/` 分别安装依赖。可用 `VSCODE_EXECUTABLE_PATH` 指定本机 VS Code 主程序；缺省下载测试运行时。包安装回归可用
`TRIVIUM_TEST_VSIX="$PWD/trivium-cockpit-0.3.3.vsix" TRIVIUM_KEEP_WINDOW=1 npm run e2e`。
脚本打印临时仓、隔离 profile、审批前回读与截图的位置。保留的「入口B验收甲」窗口用于人工审批。

入口 A 真机专项在扩展目录运行。先完成核心构建，指定 VSCODE_EXECUTABLE_PATH 和 TRIVIUM_TEST_VSIX，保留本机已登记的 GLM 后台探针。命令为 `npm run real:glm-entry -- /绝对路径/zcode`，脚本模式为 `npm run real:glm-entry -- /发行目录/bin/zcode.mjs /绝对路径/node`。登录、选模和原生工具确认由操作者完成。
