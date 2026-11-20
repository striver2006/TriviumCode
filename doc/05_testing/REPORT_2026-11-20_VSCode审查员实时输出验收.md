# VS Code 驾驶舱 E1 审查员 stdout 验收

分支 `feat/vscode-extension`，基线 `589525fd`，核心 1.3.7，插件 0.3.0。测试机为 macOS arm64、Apple M5、Node 25.2.1、VS Code 1.147.0。计划审第一次因 Gemini 连接失败而终止，第二次运行 `20261120T031519Z` 完成逐条裁决。性能阈值与采样分母见[编码前定稿](../../.reviews/E1-审查员stdout实时输出/plan/2026-11-20-E1-审查员stdout实时输出-r2-codex.md)。

## 最终安装包与核心

| 工件 | 核验路径 | SHA-256 |
|---|---|---|
| 核心 1.3.7 | `dist/e1/dual-critic/scripts/trivium.cjs` | `c81e544e0d76ccb9758b913c5286129779850da857b96cd77d95efc2d0fcd542` |
| 驾驶舱 0.3.0 | `extension/trivium-cockpit-0.3.0-e1.vsix` | `0169ea603e53e75c58a4ff3e8e8f93e17d975eb201fc61b3e72cc8148d308bee` |
| VSIX 内与两个用户目录内的插件代码 | `extension/dist/extension.js`（包内路径） | `b23378f9d7b9dbe92e1e65d9cde4840873835de6c9c62972995172e7b1c0fa28` |

核心的构建时间会进入 bundle。上表保留本次工作树构建的一份固定副本，供安装态、性能和生命周期逐字节对照。性能矩阵直接加载仓库 skills/dual-critic 下当时的同一份字节。报告中的早期样本保留其各自的构建哈希。正式双审通过项目原 wrapper 运行，wrapper 指向安装构建 b0ade00，归档中保留了该告警。代码审 `20261120T041914Z` 的计票为 0 通过、2 修改后通过、1 不通过，裁决件覆盖 20 项，闸门返回 proceed。[代码审逐条应答](../../.reviews/E1-审查员stdout实时输出/code/2026-11-20-E1-审查员stdout实时输出-response-codex.md)

## 最终包实测

安装态 `npm run e2e` 完成 Phase 4 回归和 E1 双窗口验收。两仓分别由 Codex 和 Claude 主攻，各启动三侧，同时使用两个全新用户目录和两个全新扩展目录。E1 运行编号为 20261120T050930Z，按仓、主题和 runDir 分开定位。六个厂商格式子进程先发唯一标记并等待，测试端在磁盘和对应卡片看到标记后关闭协同终端。M3 收到新输出后才允许该进程退出。每次写盘和每次消息/DOM 更新均检查了合成敏感标记，最终 SHA 与期望字节一致。[六组真实时间点、进程路径与哈希](evidence/vscode-stdout-e1-20261120/最终VSIX双工作区.json) · [原 Phase 4 安装态回归](evidence/vscode-stdout-e1-20261120/最终包Phase4回归.json)

下表时间均为 2026-11-20 UTC。每个退出闩锁由测试端在 M3 读到该侧第二个标记后释放。

| 工作区主攻 | 审核者 | 子进程产生 | 磁盘可见 | 驾驶舱可见 | M3 新标记可见 | 子进程退出 |
|---|---|---|---|---|---|---|
| codex | claude | 05:09:30.976 | 05:09:31.247 | 05:09:31.262 | 05:09:31.614 | 05:09:31.623 |
| codex | gemini | 05:09:30.982 | 05:09:31.265 | 05:09:31.279 | 05:09:31.617 | 05:09:31.648 |
| codex | glm | 05:09:30.982 | 05:09:31.284 | 05:09:31.306 | 05:09:31.622 | 05:09:31.641 |
| claude | codex | 05:09:30.982 | 05:09:31.247 | 05:09:31.256 | 05:09:31.608 | 05:09:31.619 |
| claude | gemini | 05:09:30.970 | 05:09:31.259 | 05:09:31.282 | 05:09:31.612 | 05:09:31.625 |
| claude | glm | 05:09:30.980 | 05:09:31.285 | 05:09:31.302 | 05:09:31.615 | 05:09:31.640 |

原始基线核心独立重跑 20261120T051013Z、20261120T051015Z。仅归一各轮生成的唯一标记后，六份 stdout 与最终包逐字节一致，六份 review.v2 深比较相等。逐侧 CLI 指纹、证据判定、工具与项目读取计数、解析回退和修复字段一致，入选集合、失败策略、轮次结论、闸门和裁决完整状态亦一致。[基线归档对照](evidence/vscode-stdout-e1-20261120/基线归档语义对照.json)

最终包的七项生命周期场景各执行一次。旧核心、磁盘故障、普通重试、实际超时、取消、作废重跑、隐藏与恢复的运行号依次为 `20261120T050136Z`、`20261120T050141Z`、`20261120T050146Z`、`20261120T050150Z`、`20261120T050157Z`、`20261120T050202Z`、`20261120T050207Z`。超时子进程在第一批后保持活动，直到计时器终止，保留 256 B 并标注 timeout。永久故障标明完整性未确认；短写、慢写恢复、普通重试、作废后重跑和取消分别核对文件及身份。[最终包生命周期](evidence/vscode-stdout-e1-20261120/最终包生命周期.json) · [各阶段实际尝试次数与运行号](evidence/vscode-stdout-e1-20261120/场景尝试索引.json)

两版均在隐藏期间继续产出，E1 的隐藏区间读取、定时器调度、消息与重绘为 0，恢复到下一批输出用时 41 ms。两版分别采了五个 60 秒空闲区间，E1 每段新增读取、定时器、stdout 消息和重绘均为 0，活动文件监听数为 0。下表内存为每个区间两个端点的较高值，再取五段中位数。[基线原始空闲计量](evidence/vscode-stdout-e1-20261120/基线空闲采样.json)

| 空闲样本 | 运行编号 | 宿主 CPU 秒/分钟 | 宿主 RSS KiB | 宿主物理写入 B/分钟 |
|---|---|---:|---:|---:|
| 基线 | 20261120T050241Z | 0.0022 | 94,240 | 0 |
| E1 | 20261120T050207Z | 0.0024 | 85,856 | 0 |

## 开发期安装态样本

从独立的用户目录和扩展目录安装 E1 VSIX，两个工作区共享运行根。以工件区的 worker PID 和进程参数核实加载仓库 `skills/dual-critic/scripts/trivium.cjs`。两个窗口的实际插件代码均与 VSIX 的 extension.js 哈希一致。终端 Driver 和厂商程序由可控子进程担任。夹具免账号探活，并将工具调用和工程文件读取的最低次数设为 0；正式核心的证据核验、重试、计票和归档按实际项目配置执行。

| 安装态初验 | 观测 |
|---|---|
| 两个工作区、每仓三侧 | 两个工作区同秒取得运行号 20261120T041523Z，分别以工作区、主题、runDir 和运行号定位 |
| Claude / Codex / Gemini / GLM | 六个子进程均在首个标记落盘、其卡片可见、M3 新标记可见三个停点保持运行，随后才收到退出放行 |
| 最终文件 | 分块中文字节、空行、分块凭据和无末尾换行均逐字节对照预期 SHA-256；每次写后读回文件，每次 Webview 消息和 DOM 更新检查合成标记 |
| 归档 | 两份运行归档均为 success。worker.log、各侧 stdout 及最终结论分别展示 |

每个子进程的发送、磁盘可见、界面可见、M3 可见与退出时间以 Unix 毫秒记录，另存 PID、绝对路径、字节数、哈希、归档路径及两端泄露检查。[四路径安装态初验](evidence/vscode-stdout-e1-20261120/四路径安装态初验.json)

代码审前复验的核心为 `skills/dual-critic/scripts/trivium.cjs`，SHA-256 为 `e440fdd1f6357a36453bd19f94aabe40a894a35baa69cbd10526efef4cd6d87d`。E1 包 `extension/trivium-cockpit-0.3.0-e1.vsix` 为 `06596f19cd107cee71b61ef39ca7a2dd58df8a1e94066b85c8943ce4d9720bab`。安装态 npm run e2e 完成原 Phase 4 链和两窗六侧退出闩锁，运行号 `20261120T041813Z`。历史 Phase 4 包和 GLM 续话包仍分别为 `50f5929c2028ecf2ae465996bc778fe3f2c0f30aa2fabfbc2c7549f09eccbe06`、`202ea8b9e044289d5a2616c1e3c6f353bdfad9098adc37c079237e83555b7c32`。[安装包四路径复验](evidence/vscode-stdout-e1-20261120/安装包四路径复验.json)

### 故障、兼容与生命周期

新插件配基线核心时，显示缺少实时记录。E1 在短写时持续补写，慢写时标为暂缓并恢复最终文件，永久写失败时标为完整性未确认。三种磁盘条件在同一三侧桩运行中注入，归档为 success。重试保留第一次尝试的描述和 stdout。超时的桩按原策略终止本侧，严格模式整轮 failed。取消后 worker 作中断封口。以上桩均以 `cli_version=stub/0.0.0` 单独记账。[故障与兼容记录](evidence/vscode-stdout-e1-20261120/故障与兼容初验.json)

隐藏期间产出第二段，重新点击驾驶舱标签后 51 ms 恢复最新尾部。终态后连续五个 60 秒区间均无 E1 文件读取、定时器调度及存活文件监听。[隐藏及空闲初验](evidence/vscode-stdout-e1-20261120/隐藏及空闲初验.json)

### 真实厂商 CLI

通过实际审查 worker 观察厂商 stdout 管道的数据事件，保存时间和字节数。Codex 0.169.0 在 `20261120T041318Z` 共输出 25 块、7,994 字节，派生后 1,928 ms 收到第一块，最后一块比 exit 早 3,614 ms。此项记录厂商行为，驾驶舱退出前可见的验证由安装态闩锁用例完成。[厂商计时原始记录](evidence/vscode-stdout-e1-20261120/实际CLI计时.json)

| 实际 CLI | 运行号 | 各次收到的块数 | 首块距派生 ms | 末块距退出 ms |
|---|---|---:|---:|---:|
| GLM 0.17.3 | 20261120T041136Z | 1 | 161,080 | 304 |
| Gemini 1.5.13 | 20261120T041136Z | 220 / 275 | 4,843 / 4,086 | 746 / 1,269 |
| Claude 2.1.328 | 20261120T041136Z | 4,484 | 426 | 283 |
| Codex 0.169.0 | 20261120T041318Z | 25 | 1,928 | 3,614 |

四家真实 CLI 的这组管道样本采自代码审前，记录了实际核心路径和 CLI 版本，采样时的 bundle SHA-256 未单独留存。真实账号配最终包的 UI 延迟未测。GLM 的 JSON 在这一轮直到退出前约 0.3 秒才整批到达，运行中的 161 秒没有可展示的 stdout。Gemini 发生两次实际调用。四家归档均成功。采样前两次三侧夹具的 Git 排除规则使冻结失败；Codex 单侧前两次因路线探针过期停在预检，第三次探针通过后遇到同一 Git 夹具问题，修正后两组均从正常编排入口执行。

## 性能对照

同机、三侧、相同桩和输出节奏，稀疏组每侧 60 × 256 B、250 ms 一批，持续组每侧 512 × 16 KiB、20 ms 一批。基线由 `git archive 589525fd` 构建，仅接入同一测试桩，在进程退出后按旧路径整份写入，安装 GLM 续话修复 VSIX。E1 安装包从文件按偏移读取。每个组合预热一次，然后交替顺序各跑五轮。worker 的 CPU 和峰值 RSS 取退出时的 resourceUsage；真实 Extension Host 由其日志核实 PID，以约 100 ms 周期采 ps 的 CPU 与 RSS。写入字节统计成功的内容文件和元数据写调用。消息接收与实际可见分别计时，DOM 标记须与各侧视口相交。每侧每轮稀疏预定 15 个标记、持续预定 21 个，缺失保留在分母中。

| 负载与版本 | 总耗时中位 ms | 核心 CPU 秒 | 核心峰值 KiB | 宿主 CPU 秒 | 宿主采样峰值 KiB |
|---|---:|---:|---:|---:|---:|
| 稀疏基线 | 15,764 | 0.260 | 109,104 | 0.07 | 200,720 |
| 稀疏 E1 | 15,767 | 0.321 | 110,416 | 0.30 | 202,080 |
| 持续基线 | 11,963 | 0.569 | 223,936 | 0.07 | 199,040 |
| 持续 E1 | 11,941 | 0.898 | 165,376 | 0.49 | 212,336 |

首轮目录事件漏报，稀疏组 P95 超过 1 秒，持续组每侧漏 19/21 个标记。按写、收件和 DOM 三段时间定位到宿主等待读取；改成监听已核实的内容文件、按侧去抖和短时缓存元数据，同负载复跑。五轮正式 E1 样本共 540 个标记，缺失为零。基线没有 stdout 运行卡，可见延迟无数值。所有轮次的 P95、成功写量和元数据开销见 CSV，完整的每个标记、写调用和 CPU/RSS 样本保存在压缩 JSON。[性能对照](evidence/vscode-stdout-e1-20261120/性能对照.csv) · [逐轮原始数据](evidence/vscode-stdout-e1-20261120/性能逐轮原始记录.json.gz) · [优化前后诊断轮](evidence/vscode-stdout-e1-20261120/优化前后诊断轮.json.gz)

按编码前阈值，五轮正式样本三侧各自 P95 的中位数，稀疏组均为 129 ms，持续组依次为 43、44、44 ms。每轮三侧实际内容写量分别为 46,080 B 和 25,165,824 B，与预期完全一致。状态元数据单侧单次最大 391 B，限额 16 KiB。两种负载的耗时、两进程 CPU、内存、写量和可见延迟均达标。每一轮的写入时间可由 worker.writes 核对，received 代表 Webview 实际收件，visible 代表标记进入可见视口；另用同一核心和包各跑一轮带探针的稀疏与持续负载，在真实宿主记录读调用完成时刻。108 个标记逐一满足产生 ≤ 落盘 ≤ 读取 ≤ 收件 ≤ 可见。该诊断轮单独保存，以免计时探针混入性能中位数。[五段原始计时](evidence/vscode-stdout-e1-20261120/标记五段计时.json.gz) [逐项判定](evidence/vscode-stdout-e1-20261120/性能判定.json)

## 构建与检查

根目录最终 `npm run check` 退出 0，共 4,077 项，4,061 通过、16 项由现有平台或条件跳过。首遍全量检查发现新增测试直接创建临时目录，定向复查另发现一次前缀不符；统一使用仓库 scratchDir 及规定的前缀后，10 项定向检查和整套检查通过。插件 `npm run check` 通过 185 项单元测试与 83 项真实宿主集成测试。独立命名的 `npm run package` 和最终安装态 `npm run e2e` 均退出 0。[检查记录与日志指纹](evidence/vscode-stdout-e1-20261120/构建与检查.json)

正式 verify 运行 `20261120T051557Z` 依次执行 typecheck、build 和 npm test，三条命令均退出 0，归档 success。结合最终安装态、完整输出与基线归档对照、两种负载和隐藏/空闲计量，本次 macOS 验收支持默认开启 E1。[正式 verify 正本](../../.reviews/E1-审查员stdout实时输出/verify/_meta/verify-20261120T051557Z.json)

## 复跑入口

本机在仓库根目录执行下列命令，需已安装 Git、Node、Python 3、unzip、tar 和 VS Code。首次检出分别在根目录和 extension 目录安装锁文件依赖（npm ci）。性能及生命周期探针使用 macOS 进程计量。测试输出保存在各脚本首行打印的临时目录。构建标识含时间戳，其他检查会重建工作树核心；用独立目录保存同一份验收字节。

```sh
npm run check
mkdir -p dist/e1
cp -R skills/dual-critic dist/e1/
export TRIVIUM_E1_ASSETS="$PWD/dist/e1/dual-critic"
cd extension
npm run check
npm run package -- --out trivium-cockpit-0.3.0-e1.vsix
export TRIVIUM_TEST_VSIX="$PWD/trivium-cockpit-0.3.0-e1.vsix"
export VSCODE_EXECUTABLE_PATH='/Applications/Visual Studio Code.app/Contents/MacOS/Code'
npm run e2e
node scripts/runStdoutPerf.mjs
TRIVIUM_PERF_TRACE=1 TRIVIUM_PERF_ROUNDS=0 TRIVIUM_PERF_VARIANT=e1 node scripts/runStdoutPerf.mjs
```

将下面的两个路径替换为上述四路径验收及性能脚本打印的目录。归档对照另编译一份没有接入新桩的 589525fd 原核心。故障仅注入隔离桩的工作进程。性能计数是成功写入的逻辑字节，隐藏和空闲样本另取操作系统为宿主累计的物理 I/O。

```sh
node scripts/summarizeStdoutPerf.mjs /tmp/tv-e1p-XXXXXX /tmp/e1-summary
node scripts/compareStdoutArchives.mjs /tmp/trivium-e1-host-XXXXXX/report.json
export TRIVIUM_BASELINE_ASSETS=/tmp/tv-e1p-XXXXXX/baseline/skills/dual-critic
node scripts/runStdoutLifecycle.mjs legacy fault retry timeout cancel voided hidden
TRIVIUM_TEST_VSIX="$PWD/trivium-cockpit-0.3.0-glm-relay.vsix" node scripts/runStdoutLifecycle.mjs idle-baseline
```

真实厂商采样使用本机可用账户及项目已配置的路线。在 extension 运行 `node scripts/runStdoutVendors.mjs codex claude`，由这两个 Driver 分别将其余三侧与 Codex 送入隔离仓的正式编排入口，输出文件只收集管道时间与字节计数。Windows 安装态、Windows NTFS ACL 和跨机性能未测。
