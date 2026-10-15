# M11 Step 12：客户端启动链只读核定

2026-10-16，Asia/Singapore。本批已完成独立静态准备，**不具备可执行的新客户端启动方案**。厂商增量授权仍为 admission 0 / review 0；停在新启动、配置生效和故障注入之前。没有运行 setup、厂商 CLI、Hook、审批或恢复命令。

## 实际前置状态

见 [before-state.json](./before-state.json) 与最终 [after-state.json](./after-state.json)。采集命令、退出结果见 [validation.json](./validation.json)。读取来源及 SHA-256 随状态文件保存，未复制凭据、完整敏感命令行或环境变量值。

- 主仓库起点 `df9c6a2796bb14f78c9d1f4ea2812f70fc50fb5b`，工作树干净。此次仅新增本证据包并同步报告、矩阵。
- 原工程与 archive backup 各 141 文件；empty backup 18 文件；archive 141、empty 27 文件。逐文件集合、内容 hash、权限、大小均与各自记录相同。archive wrapper 为 755；empty 归档只有 README。
- 冻结操作包 18 文件、11 个运行时/资产锚点、外部索引均未变；两个新运行桶不存在。新 calls 仍为两组 init 请求/完成，无 Hook；client-authorization.json 不存在。
- setup 的 bundle/采集子进程退出码为 0，顶层终端 setup 退出码仍 null。此次没有重跑来补值。
- 累计台账 admission 838 / review 401；本步 43+28=71/80，分池剩余 1/8。当前授权增量仍 0/0。此读数仅适用于既有台账覆盖面。
- D 闭环、6.7 四 Hook 完成、8.2 终端 0→2→0、5.1 客户端 dry-run 通过沿用当前证据；不回退旧结论。5.2～5.5 客户端仍未测。容量修复、树外访问根因、B1、1.4、剧本 7/9/10、可选 9.6/11.7 的状态不变。

## 启动链与计数覆盖

以下“静态”指读取本机安装文件，不把它当动态执行证据。2.1.296 与 2.1.300 的 package.json、extension.js 和 native 指纹分别保存，压缩 JS 用字符 offset + 片段定位。没有运行 help/version。

| 边界 | 可证链路、来源 | 当前计数覆盖与池 | 原始记录及缺口 |
| :--- | :--- | :--- | :--- |
| VS Code → 扩展宿主 | package main=extension.js，activationEvents 含 onStartupFinished / onWebviewPanel；现有进程 PPID 链为辅助实测 | VS Code 本身不是厂商 CLI，不应算进厂商池；激活引发的厂商启动仍须逐个控制 | ps 仅 pid/ppid/lstart/comm；未启动/重载窗口，激活次数上限 null |
| 扩展 → SDK | 旧日志明确 `Spawning Claude with SDK query function`，cwd 为原工程、版本 2.1.296；两版源码均有 SDK options.cwd 和 query 路径 | **不受 runtime.mjs 的侧车覆盖**；Driver 启动池尚未被现行包声明，拟归 admission，待具名批准 | Z01 日志第 22、418 行对应两个历史启动事件；无对应启动台账不能记作 0 |
| SDK → 直接 native | 两版 spawnLocalProcess 均调用 Node child_process.spawn；默认 pathToClaudeCodeExecutable 为 bundled native | 若扩展宿主未加载预算包装，spawn 不计数；native 不因继承环境就受 Node monkey-patch 控制 | 当前 PID 63509、PPID 70588、lstart=2026-10-15 19:42:46，lsof cwd=原工程；与日志恢复时刻相符，但 log↔PID 没有直接 ID，关联仍为推断 |
| SDK → 可选启动包装器 → native | 两版 resolve binary：claudeProcessWrapper 有值则选该入口，executableArgs 首项为 native 路径；SDK **delete env.NODE_OPTIONS** | wrapper/native 是两个应分别审计的边界。现有 vendorOf 只识别具名 basename；自定义捕获包装器还可能漏识别 | 默认用户磁盘设置未设 wrapper；不等于已解析所有 profile/窗口 effective 配置。不能把设置 NODE_OPTIONS 当覆盖证明 |
| 扩展其他 native 入口 | 两版还有 Chrome MCP 入口；2.1.300 有 Python 环境并行启动/重启分支，其他辅助子命令与恢复路径未穷尽 | 现有侧车均不证明覆盖；health/help/version 类拟 admission；模型审查才 review。未分类入口必须拒绝，不借 review 余量 | source excerpts；运行条件与次数 null。不能断言一次打开恰好一个 native |
| Driver → 项目 Hook | 项目 settings 保留 PreToolUse 三项、Stop、SessionStart 原命令/顺序/超时；CLAUDE_PROJECT_DIR 由真实项目上下文提供 | shell 和本地 Hook 不是厂商 CLI；当前项目 Hook 不能倒过来限制先发生的 Driver 启动 | 两个新夹具只有配置静态证据；旧 5.1 的两个 Hook 0 与 toolu_3fb0ff3d5be3421980559972 日志保留，不能移作新夹具通过 |
| 项目 wrapper → runtime.mjs | 两夹具 wrapper 与获批 proposed-wrapper 完全相同，755；runtime 以 realpath(process.cwd()) 选具名夹具 | 本地采集入口；不消费厂商次数。不能用原会话 cd 或伪造 CLAUDE_PROJECT_DIR 绕过项目绑定 | runtime 要求 client 授权，目前缺失。未执行，实际 Hook 退出码 null |
| runtime → 安装 bundle → 后代厂商 | runtime 设置 cap-preload + budget-preload 后 spawn 固定 Node/安装 bundle；preload 在 spawn 之前 reserve，native 边界卸载 NODE_OPTIONS | **仅此支已设计为受控**；runtime 固定 pool=review，绝对 cap=当前 review 数。识别到厂商后代应在启动前拒绝 | setup 两组 load token/父子 PID/loaded mark 与实际 0 回执证明本地 init 装载，不证明所有客户端边界或 Hook 行为等价 |

进程快照还见另一个扩展 native，cwd 属其他项目，已隐藏具体路径。快照不是全机历史启动审计；不回填历史预算、不改历史授权。现有台账最后的 Claude/cld 记录早于本步，旧 VS Code 日志中的启动不能由台账数值解释。

## 当前入口不能直接使用的原因

1. `claudeCode.claudeProcessWrapper` 与 `claudeCode.environmentVariables` 的声明 scope 均为 `machine`。只写新夹具 `.vscode/settings.json` 没有依据能生效；未实际检验 effective 值，不能作为可用方案。
2. SDK 删除子环境的 NODE_OPTIONS。给 native 或 wrapper 的环境追加现有 preload，不会自动拦到父级扩展宿主的 spawn；在 wrapper 内预占最多控制下一跳，不能拦已经发生的 wrapper 启动，也不能限制扩展反复启动 wrapper。
3. 冻结 `common.mjs:verifyAnchors()` 要求 budget() 严格等于准备时 838/401；runtime、checkpoint、fixture-step 都使用该函数。**只要新启动正确入账，旧采集就会先拒绝**，即使所有归档完整。不能把这个拒绝当 5.2/5.3 通过，也不能改冻结快照或批准回执掩盖它。
4. 冻结 runtime 的客户端授权函数要求 vendor_increment=0/0，授权与准备 manifest 绑定；不能简单写一个“启动增量非零”的同名回执让旧包继续。
5. PID/PPID/时间窗只帮助事后关联，不能构成超额前拦截。没有原始记录不代表没有启动。当前安全启动量、未覆盖边界的硬上限均为 **null**。

因此本轮没有应用新配置，也没有放置 client-authorization。可行方向是**隔离 VS Code user-data 的 machine 设置 + 在实际父级启动边界预占 + 新版采集包**；这是待验证设计，不能宣称已满足全部约束。

## 已独立准备的最小动态取证提案

详见 [START_PROPOSAL.md](./START_PROPOSAL.md)、[configuration-proposal.json](./configuration-proposal.json) 与 [capture-only-entry.mjs](./capture-only-entry.mjs)。后者是未配置、未执行的捕获入口：只记安全元数据，永不启动 native，始终拒绝；不是健康 Driver。首次只考虑 archive，不同时开启 empty。

选择捕获入口的理由是先辨明 SDK 到包装器的真实 argv/cwd/版本。包装器启动本身仍须纳入批准的边界口径；包装器内部拒绝不能证明父级的超额前拦截。本轮已把这一缺口写为阻断项，所以**该提案仍不得执行**，也没有请求 Bob 现在批准一个“已验证安全”的数字。

全差异、配置不存在的备份事实、当前 Hook/wrapper 的独立内容备份见 [configuration-proposal.json](./configuration-proposal.json)。文件仅在证据目录；不触碰全局配置、不安装、不改 Hook、不改旧 wrapper。诊断对环境、启动路径与原行为的影响均列入提案。

## 后续最小验收批次

启动证据与采集等价性通过后，保持一个 archive 会话，分段提交六份既有精确 Bash 参数中的前五份，最后另开 empty 做第六份。详见 START_PROPOSAL，每段独立授权/证据停点，不将一次客户端启动误写成一次模型请求。

所有实际新 Hook/Driver/Git 退出码、native 启动量、等价性结论保持 null。本轮静态分析不把 5.2～5.5 改为通过。
