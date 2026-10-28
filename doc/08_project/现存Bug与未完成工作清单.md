# 现存 Bug 与未完成工作清单

适用产品：1.3.2。表头核对日期：2026-10-27（各条目的状态以条目内日期为准）。本文是单独可读的残余清单；旧 [BACKLOG](./BACKLOG.md)、LLD、ADR 和测试原件保留，原 EV 编号不变。

本轮检查了代码结构、CLI、安装路径、现有登记、测试与发布包；下表历史缺陷未逐项重新动态复现，不把历史复现说成本轮复现。自动化通过不代表每条缺陷已修复。“待办/触发式”沿用历史决定，不自动授权修复或付费模型补测；修复前仍核对原项的范围与触发条件。

## 1. 部署前优先阅读

2026-10-28 Qoder续批：Custom候选接线、语义绑定/精确目录、组合台账与worker冻结、replace环境/凭据租约已实现；必要运行标签与modelUsage只作一致性，底层未知null。05:55 Write/Bash与直接Grep/Glob规则拒绝已取证；06:20最小面仍缺危险工具真实分发拒绝，项目Hook正控制成立但排除证据不足。无合格生产组合，真实三审、失联/整树/配置技能插件完整矩阵、Windows继续阻塞，见[报告](../05_testing/REPORT_2026-10-28_QoderCN只读审核准入与Custom模型接入.md)。

历史04:47批次（不描述当前实现）：当时补得可见Bash命令规则拒绝、同行/.env/私有HOME哨兵的两种路径形式共6条Read规则拒绝；Write仍mode审批拒绝、搜索空结果不算拒绝。固定三家代码审及正式verify已通过（4132通过、9跳过），不能替代上述完整准入缺口。当时删除补丁尚未覆盖构造后新增父键；续批现已实现replace。

2026-10-27 新接入前置：Kimi Code 与 Qoder CN 双角色任务已完成计划双审，生产接入未实现。Kimi 2.3.0 受控非交互调用的路径/工具级禁读未生效；Qoder CN 1.1.79 无效模型会回退 auto 并退 0。两家禁用工具执行分发、五客户端 Driver 与 Windows 真实验收仍有未测项。当前发布支持范围不增加，见[前置取证报告](../05_testing/REPORT_2026-10-27_KimiCode与QoderCN接入前置取证.md)与[验收清单](../05_testing/CASE_KimiCode与QoderCN双平台验收.md)。这些是新接入阻塞，不改写旧 EV 或历史准入状态。

| 编号/性质 | 现象、影响及当前处理 |
| --- | --- |
| EV-243 / 可用性缺陷 | Claude 会话内拉起 kimi/deepseek 等第三方路线曾间歇性挂到 180 秒；终端同形调用可返回。会话变量继承仅为嫌疑，根因未证实。本轮未复现；生产使用这些路线前先核对该项。 |
| EV-96/99/100/102/219 / 检测缺陷 | 命令写入分析对表外动词、特殊重定向和引号目标存在漏报或归因错误；不应将启发式核验当完整 shell 沙箱。 |
| EV-98 / 检测误报 | 内联代码或样例中的命令字符串可能触发失守告警；EV-223 已缓解无漂移时的阻断，但写判据误报未消失。 |
| EV-63/108/183 / 工件边界 | 损坏 front-matter、未登记运行骨架及写侧时间窗仍有识别/锚定边界；不要修改历史审查工件。 |
| EV-203 / 认证缓存边界 | ZCode 认证指纹读盘失败折成 null，窄条件下可能误命中缓存。本机认证异常时保存错误并核查，不把旧缓存视为当前成功。 |
| EV-236 / 大文件与脱敏 | 新 request 补丁已去重；32 MiB 扫描上限及大证据递归膨胀仍需管理。送审前按运维规矩处理大型原始证据，不抑制扫描告警。 |
| 发版-01 / 平台边界 | Windows 原生支持已于 1.1.0 交付（Git for Windows 硬前置；进程身份/树取消/终止、cmd 入口 wrapper、路径归一、四家 CLI 探针、安装升级卸载与 zip 发布包；残余见 §3「Windows 移植残余」）。Linux、WSL 仍未验收——不能把解压或 CJS 能启动当完整平台通过。 |
| ~~发版-02 / 复盘数据缺口~~ | **已解决（2026-10-22，EV-250，主设计 v1.3.172）**：`gate --check` 在 `warn` 放行共同驳回时按 `run_id` 覆盖写入 `disputes[]`（编号与分组位置），`hard` 阻断不记；`report` 无条件列出明细，旧主题有标记无明细时如实写「没有留下明细」。残余：`disputed` 只增不减，某轮争议撤回后 `status` 仍显示有争议项（见 BACKLOG EV-250）。原记：`task.json.disputes[]` 只有定义、初始化与读取，未找到生产写入点。 |

## 2. 原编号的未完成项

以下 55 项从历史首条状态及补充裁决逐项整理；部分完成只列剩余内容。EV-132 的摘要已实现、EV-159 两形态分别已修/决定不修、EV-177 三项已完成，不误列为待修。

| 编号 | 当前性质 | 剩余问题或工作 |
| --- | --- | --- |
| EV-14 | 部分完成/残余 | 已完成结构对账，仍缺跨表和同表多行的语义状态一致性检查。 |
| EV-28 | 部分完成/残余 | 路径键名及覆盖率已补；仍待下一次改 agy 探针时补 Grep 通道真实探测臂。 |
| EV-31 | 待办/触发式 | 对账判据依赖属性访问形态，解构赋值会漏。 |
| EV-37 | 待办/触发式 | `redactUnder` 面下的二进制仍是「永不收工」的残留成因，EV-32 只登记了超大日志那一格。 |
| EV-45 | 待办/触发式 | `PROSE_EXCEPTIONS` 的豁免颗粒度是「文件 + token」，不是那一处命中。 |
| EV-51 | 待办/触发式 | deny 规则方言还有两格没测出来。 |
| EV-63 | 待办/触发式 | `isReviewArtifact` 对「front-matter 被剥掉或改坏的审查件」判 false，按原稿放行。 |
| EV-65 | 待办/触发式 | 「谁算原稿」有两份实现，一致靠复制品维持、无对账。 |
| EV-69 | 待办/触发式 | `GateCheckInput.driver` 仍是可选参数，而它现在是作者身份契约的一半。 |
| EV-75 | 待办/触发式 | StructuredOutput 误报已修；仍缺同一探针臂的工具面核对，以及写失守逐侧留痕语义。 |
| EV-78 | 待办/触发式 | Grep 输出格式没有探针事实格，解析器建在两份样本上。 |
| EV-80 | 待办/触发式 | `checkReviewIntegrity` 的「evidence 引用但未列入 consulted」把两类非文件引用报成告警。 |
| EV-83 | 待办/触发式 | `os.homedir()` 的「用户目录」口径在 HOME 被重定向的会话里会整体跑偏。 |
| EV-85 | 待办/触发式 | 布局判据没按 CLI 版本门控，纪律 1 的形态。 |
| EV-86 | 待办/触发式 | 旗标结论「冻结」不可见：判过与没判过的轮次，结论文件长得一样。 |
| EV-91 | 待办/触发式 | `model_override_applied` 只有 zcode 一家产出，其余三家的作答落点待定。 |
| EV-95 | 部分完成/残余 | 已按执行能力约束任务书措辞；效果层再出现“推理冒充实测”时继续处理，不能仅凭文案保证输出。 |
| EV-96 | 待办/触发式 | 表外动词的写入：写面零留痕，读面留假读取。 |
| EV-98 | 部分完成/残余 | 失守停点文案及误报阻断代价已缓解；内联脚本/样例字符串的命令写判据仍会误报。 |
| EV-99 | 待办/触发式 | zsh 的 fd 变量重定向 `{var}>f` 在写判据文法之外，是静默写通道。 |
| EV-100 | 待办/触发式 | 写动词的目标位被尾部重定向抢走排除位，写入目标冒充读取。 |
| EV-102 | 待办/触发式 | 引号内含空白或段分隔符的写入目标彻底静默（写面三档全空）。 |
| EV-104 | 待办/触发式 | agy 探针的 `json_schema_ok` 臂同样喂自造迷你 schema，与 EV-74 结案前的 claude 侧同一个病。 |
| EV-108 | 待办/触发式 | 提交锚的剩余边界两格：只剩写侧，锚②够不着。 |
| EV-121 | 待办/触发式 | 包内有两条不经三个落点键的路径。 |
| EV-130 | 部分完成/残余 | 默认 Codex 模型已由 max 换为 flash；新项目仍依赖本机 qwen profile 与额度，不跟随个人 CLI 默认模型。 |
| EV-141 | 待办/触发式 | 审批时的工作树摘要没有开关、预算不可配置，每轮扫两到三次工作树。 |
| EV-163 | 待办/触发式 | 到期整删的工作进程一半对「终态而工作进程仍活」照删。 |
| EV-168 | 待办/触发式 | worker 存活期间的自身子进程退出盲区：`liveTrees` 只跟踪直接子进程，对孙辈无感知。 |
| EV-171 | 待办/触发式 | 门面指针对账只守已知站点：清单之外按旧习惯新写的带版本号指针测试看不见。 |
| EV-174 | 待办/触发式 | 遗留锁回收仍可能挪走活锁的剩余格。 |
| EV-178 | 待办/触发式 | 语法修不好的回退形态：结论 JSON 缺逗号或括号。 |
| EV-179 | 待办/触发式 | codex 侧 `--output-schema` 按 provider 实测决定是否接。 |
| EV-180 | 待办/触发式 | 降低「漂移比不了」的成因：让送审快照的 tree 在审查期间被清理之后仍比得了。 |
| EV-181 | 待办/触发式 | 运行留痕读不出时，七处拒绝文案不报原因。 |
| EV-182 | 待办/触发式 | 提交锚在运行清单不可读 / 已丢失时的收尾文案，没有与 EV-148 的三档成因统一。 |
| EV-183 | 待办/触发式 | 未登记的运行骨架被删除时，没有任何锚会拦。 |
| EV-184 | 待办/触发式 | 为 codex 接命令前缀禁止规则（不是白名单）。 |
| EV-185 | 待办/触发式 | `--context` 的绝对路径与家目录写法（`~/…`、`$HOME/…`、`${HOME}/…`）在必读清单里被静默丢掉。 |
| EV-186 | 待办/触发式 | `listOwnHistory` 写死收 claude 的裁决件后缀。 |
| EV-187 | 待办/触发式 | agy 侧的命令执行能力声明对账的是仓库资产，运行期生效的是安装副本。 |
| EV-189 | 待办/触发式 | zcode 侧子代理会话不在核验面。 |
| EV-190 | 待办/触发式 | zcode 侧非 MCP 的表外内置工具没有分类。 |
| EV-191 | 部分完成/残余 | 任务书已点名禁用执行型 MCP；通道未硬关闭，重现后仍可能失守并增加重跑成本。 |
| EV-192 | 待办/触发式 | 名单外 MCP 工具要不要在任务书里提。 |
| EV-203 | 待办/触发式 | zcode 认证探活的指纹读不了时折成 null，在一个窄格里会命中缓存、跳过探活且无提示。 |
| EV-206 | 待办/触发式 | 审批与 `gate --check` 在闸门迁移已生效之后才删收工阻断计数目录，删不掉会把已生效的操作报成失败。 |
| EV-213 | 待办/触发式 | `clampGoal` 按 UTF-16 单元 `slice` 截到 200，可能切在代理对中间、留下孤立代理项。 |
| EV-219 | 待办/触发式 | 带 `!` 后缀的重定向拼写，判据取的写入点与 bash / sh / dash 实际写的不一致。 |
| EV-235 | 待办/触发式 | 新客户端启动的父级预算计数控制未实现，剧本 5.2～5.5 真实会话内负对照因此未触发。 |
| EV-236 | 部分完成/残余 | 冻结补丁已去重、已清理特定旧大包；大文件省略正文 A1 仍暂缓，超过 32 MiB 的文件仍可能跳过脱敏扫描。 |
| EV-237 | 待办/触发式 | 夹具旧 Hook 拷贝已删除；Codex 是否读取项目级 Hook 仍未核实，保持 L2。 |
| EV-242 | 待办/触发式 | 七组合的旧通过绑定旧 CLI/完整指纹；当前指纹下未重取，不得写成当前原标准通过。 |
| EV-243 | 待办/触发式 | 从 Claude Code 会话里拉起的第三方 claude 路线间歇性挂满 180 秒。 |
| EV-244 | 待办/触发式 | 受控取证夹具 ps 日期格式依赖 locale；控制器已用 LC_ALL=C 绕开，底层夹具守卫未改。 |

每条的原始复现、对应源码和触发式决定按同号查询 [BACKLOG](./BACKLOG.md)。EV-75/95/98/130/191/236 等标题仍保留初始问题，因此本清单以其后补充的剩余范围为准。

## 3. 验收缺口与后续交付

| 工作 | 当前状态 | 完成条件 |
| --- | --- | --- |
| Windows 原生移植 | 1.1.0 已实现并本机验收（win32 + Node 24 + Git for Windows）；残余见下「Windows 移植残余」 | 已交付：PowerShell/WMI 进程身份（UTC ISO）、父链后代组员判定、taskkill 树杀 + 取消标记优雅收尾、`.cmd` 入口 wrapper、sh 定位器（verify/Hook 走 Git Bash）、四家 CLI win32 探针候选、zip 发布包。残余：见 §3.1 |
| 另一台 Mac 与 Intel Mac | 本轮未测 | 在目标主机执行部署手册并保存版本、入口、探针、正式任务和护栏证据；不要复制本机 probe |
| Node 18/22 运行矩阵 | 构建 target=node18，开发测试 ≥22；本轮具体运行版本见发布报告 | 分版本真实执行安装、自检及正式 CLI 任务；不能只据编译 target 判通过 |
| Apple 签名、公证和自带 Node | 未实现 | 如需独立 App/一键系统安装，另定签名、运行时分发、更新与回退策略 |
| 新客户端父级预算 | EV-235 未实现 | 新客户端实际启动前父级预算控制与真实客户端负对照；不以替身测试代替 |
| Codex 项目 Hook | EV-237 未核 | 真实客户端事件或相应官方支持证据；未核前维持 L2 |
| 七组合当前原标准证据 | EV-242 未测 | 取得独立授权后按完整当前指纹重取，不沿用旧 7 通过 |
| 五个受限 Claude 组合 | 已按 restricted-admission-v1 单独准入；真实模型写尝试未测/不可取样 | 始终带受限判据、指纹与用户决定引用；不得改成原标准通过 |
| 官方 Claude 路线及 Antigravity 主攻全矩阵 | 历史有订阅/真载体未测面 | 根据当次账号、预算及原 CASE 实跑，不由本版桩自检补齐 |
| 源码全面多模型复审 | 本轮未启动 | 仅在用户显式调用正式审查入口时执行，不因发布整理自动启动 |

M11 第 12 步已有用户具名的组合证据达成边界；M12 已完成计划内修复及追加项。这些事实不抹除上述未测内容，也不重新打开已经由用户决定关闭/不修的条目。

### 3.1 Windows 移植残余（1.1.0 已实现面之外的待办）

已交付面见 §3「Windows 原生移植」行；以下为如实登记的残余，均不阻断主链路（编排、审查、闸门、取消、清扫、安装、发布在 win32 已可跑通；单测+契约 2184 例全绿，跳过均带理由）：

0. **claude 第三方网关与只读不变量（1.2.0 已修，Windows 线）**：`--restricted` 按官方语义忽略 user/project/local settings 文件（含 CC Switch 写入的网关 env 段），回落官方端点即报「未登录」。2026-10-19 在 win32 + claude 2.1.302 + CC Switch（api.kimi.com）实测定通道：进程变量形态可用但被编排器按隔离剥掉、`.cmd` 包装器撞垫片参数限制、managed settings 的 env 段不被采用——**`--settings` 内联可用**（受限模式仍生效）。1.2.0 落地为 `agents.claude.settings_env_source: user_settings`：路线解析时读用户级 settings.json 的 env 段、并入每次调用的 `--settings` 载荷（与 deny 规则共存），键值不落留痕（指纹仅 sha256、commandLine 逐值替换）。本仓 Windows 线 config 已开启；官方登录机器 env 段为空即无操作。macOS 线（1.0.0 基线）不带此能力。**2026-10-25 起（EV-256，随 1.3.2）通道改为子进程环境变量注入**：内联载荷让键值出现在进程命令行里（第 14 条），2026-10-24 实测受限模式认进程环境变量；上文「进程变量形态被编排器按隔离剥掉」的问题由「先清父进程路线变量、再注入提取出的网关键」的固定次序解决，`--settings` 只剩 deny 规则。**同日起（EV-257，随 1.3.2）**「键值不落留痕」收窄为凭据类键：模型名键（`ANTHROPIC_MODEL`、`ANTHROPIC_DEFAULT_*_MODEL[_NAME]` 等）的值是模型名（claude 按它们解析出 `init.model`；原写「网关回报的模型名」不准，EV-258 订正），不再逐值替换，回读记真名；带 `[1m]` 一类上下文窗口后缀的模型名键随 EV-258 一并豁免。
1. **POSIX 专属语义用例**：权限位（0600/0500/0000）、活体进程组信号/SIGTERM 阶梯/僵尸/ps 形态、shebang 假 CLI / PATH 垫片 / ps 故障注入这几族用例在 win32 整文件跳过（文件头 `WIN_FILE_SKIP` 注释带理由）；Windows 等价语义由 `test/unit/platform-win.test.ts` 等承接。逐文件做 win32 等价改写是后续工作。
2. **zcode HOME 隔离夹具族**：六个 zcode 隔离/副本测试文件的夹具按 POSIX `env HOME` 写死，win32 需 USERPROFILE 一并适配后解除跳过。
3. **厂商 CLI 无跨进程优雅取消**（结构性）：Windows 信号模型下 SIGTERM 即 TerminateProcess，软步只有 WM_CLOSE；我方凭据抹除由 worker 的 `cancel.requested` 标记路径保障，厂商 CLI 自行收尾不承诺。
4. **`.cmd` 垫片装法的 CLI**：`run()` 对 `.cmd/.bat` 经 `cmd.exe /d /s /c` 间接执行，参数含 cmd 元字符（`^&|<>%!`、内嵌引号）不在支持面；原生 `.exe`（探针候选序优先）无此限制。
5. **agy 的 pty 依赖**：win32 显式拒绝 pty 模式。2026-10-19 实测（agy 1.4.2）：Windows 管道下 stdout 不丢、headless 读哨兵命中、`pty_required=false`——免 pty 可用，探针无 blocker；预检 `--critics claude,gemini` 整体通过（Windows 线双侧双审可用组合为 claude+gemini）。
6. **集成测试的 win32 残余**：shebang 假 CLI 机制（`#!node` 脚本经 PATH/直接 exec，win32 的 CreateProcess 不认）与活体 POSIX 信号语义两族的集成文件在 win32 整文件跳过（`WIN_FILE_SKIP` 带理由）；另有零星路径形态差异（如 bug 阶段归档扫描）逐文件适配中。核心链路的集成覆盖由 access-v3（含取消标记优雅收尾）、selftest 14/14、release-package（隔离安装/升级/卸载/出包）在 win32 真实跑通。**首批（1.2.3）**：verify（20/20）、init（30/30）常驻解除；freeze 落盘域断言。**第二批（1.2.4）**：hooks（116+2）、preflight（65/65，修正 CODEX_HOME 环境泄漏）。**第三批（1.2.5）**：run-meta-cancel（8+1）、freeze-drift（21+1，**挖出并修复真缺陷：related 漂移比对域在 win32 全落 unrelated**）、lock（51/51——ps 桩补 win32 PowerShell 拦截 + 枚举缓存测试重置，EV-153 活锁/跨进程家族全数救活）、retention（25+2，活 CLI 进程组用例经 SH+taskkill 真跑通）、worktree-summary（21/21，照抄命令经 SH）、credential-scrub（22/22，**挖出并修复真缺陷：codex/zcode 抹除报告域随平台换形**，连带 unscannableDeleted 三格归一）。**第四批（1.2.6，集成层）**：集成失败 72→30——修复**生产缺陷：winProcessCreation 缓存命中但 pid 缺席时 0ms 即 null**（TTL 快照拍在派生前，新生进程对身份判定不可见；缺席先强制重枚举一次）；worker-detach/run-protocol/lock-cross-process/unverifiable-start 四文件的场景脚本模块定位改 file:// URL（win32 ESM 不认盘符路径）；killAll/活组夹具接 SH+taskkill；「不符值」按平台形态化。unverifiable-start 14/14、lock-cross-process 单跑 7/7、run-protocol 42+7 跳、worker-detach 14+7 跳（进程组语义族按用例跳过，等价改写待后续）。**第五批（1.2.7）**：集成失败 30→19——stub-agent-kit 8/8（overlay hashTree 键域归一 + 假 agy CLI 写 .cmd + tsc 取 .cmd 垫片）；scrub-output-text 7/8（sh 换 SH）；plan-final-recheck 8/8（**修复生产缺陷：resolvePlanFinal 的 path 在 win32 出反斜杠**，进告警正文与测试比对；另根治夹具的 CODEX_HOME 环境泄漏——fixture.ts 的 cli() 缺省隔离 codex 夹具家，与 entry-scan-home 同形）。剩余 19 条长尾：lock-cross-process 并发负载下 3 条（单跑全绿）、run-dir-collision 2（秒窗对齐时序）、override-source-start 2（~ 折叠路径比对）、scratch-cleanup 2（POSIX TMPDIR/chmod 语义）、worktree-hash-cleanup / shared-root-start / scrub T7 各 1——各需独立排查，登记后续批次。**第六批（1.2.8，全量回归基建与两处真缺陷，2026-10-21，见[报告](../05_testing/REPORT_2026-10-21_win_full_suite_hang.md)）**：实测**全量 `npm test` 在本机满载下挂死**——主跑进程 65 分钟零新子进程，最后活动是 unit lock.test.ts EV-153 U3 的持锁桩，整机冻结而非单文件卡住；单跑 lock-cross-process 7/7（21 s）、带超时复跑 55 分钟未复现、代码层逐段核查（acquireLock 有界、枚举 15 s 兜底、桩路径全部有界）未找到无界等待——**挂死根因未定位，登记待查**。同场挖出并修复五件：① `process.kill(-pid)` 在 win32 抛 ESRCH 且进程存活（实测），lock U3 收尾每跑必漏一个 holder——改经生产同款 `winTaskkillTree` 收尾；② 常驻测试桩无自毁——被外部强杀的运行留下无人回收的孤儿（实测单机累积 77 个 `trivium-ev175-test`/`trivium-ev153` 残留，全部来自被杀的历史运行；Windows 子进程不随父进程死），`spawnMarked`/U3 桩加 10 分钟自毁兜底；③ `enumerateWinProcesses({fresh:true})` 会搭在飞旧枚举（1.2.6 的强制重枚举在并发下静默失效）——终版判据是**启程时刻**：在飞趟启程不早于本次请求即搭（两形态并发取值共享一趟，缺省时序），更早启程的等它落地后自起一趟；④ **真缺陷（时序探针定位）：`--start` 派生后补写身份的 `patchStatus` 会把已完成的终态碾压回 `running`**——桩侧 worker ~1.3 s 即完成，`--start` 的记录若落在其后（满载下枚举变慢即可触发，不依赖③），`--wait` 按「running + 进程已退」误判 `worker_lost（pid_gone）`，归档已是 success 仍被判失败——修法：身份字段照补、`phase` 已终态不再改回（`isTerminal` 护栏）；⑤ 满载偶发：lock.test「不可解析但刚写下」用例的 2 s 判龄窗口被冷枚举跑穿——夹具先暖进程身份缓存。另 `npm test`/`test:unit` 经 `scripts/run-tests.mjs` 加 `--test-timeout=600000`（按 `--help` 探测，Node < 20.3 退回原样）——今后挂死以带名字的红收场，不再无声冻结；定点调试仍按 AGENTS.md 直接 `node --test`。**第六批验证**：全量 2893 例通过 2858 / 失败 13 / 跳过 22（~6 分钟无挂死）——被碾压竞态打挂的十余族全部回绿；剩余 13 条全落在长尾家族（对照本条开头登记的 19 条基线，handoff-dedupe / heartbeat-threshold / run-protocol 窗口计时各 1 为本轮新登记的同族负载时序），仍按「各需独立排查」处置。
7. **chmod 权限位降级**：凭据副本的 0600 在 NTFS 只映射只读位，隔离靠运行根在用户目录下的目录边界；已接受的限制，不是待办。
8. **codex 的只读沙箱在 Windows 不拦截（上游缺口，1.2.0 实测登记；1.2.1 起可显式降级放行）**：win32 + codex 0.163.0（CC Switch 网关、qwen 模型载体）下，只读负对照真实执行且 `-s read-only` 中写命令报告写入成功——探针按 fail-closed 清空 readonly_flags、该侧判不可用，这是编排器的正确行为，不是误报。1.2.1 新增 `agents.codex.readonly_enforcement: prompt-only`（本仓 Windows 线 config 已开启）：负对照失败时保留旗标、记 `readonly_enforced: false`，预检以降级注记放行——补偿控制是 BRIEF 只读措辞 + 事后轨迹/漂移核验（全开不动），防线从「事前阻止」换为「事后必查」。**1.2.1 实测 Windows 线 `--critics claude,codex` 预检整体通过（含降级注记）**。OS 级只读可用的平台不应开启；claude 侧不受影响（只读走 `--restricted` + `--settings` deny，已验证）。另注：codex 原生路线判据拒绝基底第三方 provider 的静默使用，CC Switch 布局经 `~/.codex/ccswitch.config.toml`（仅一行 `model_provider` 声明、无凭据）+ `agents.codex.profile: ccswitch` 显式选择。
9. **zcode（glm 审核者）在 Windows 已可用（2026-10-20 闭合）**：D: 盘装法经 `agents.glm.entry` 指路（config.local.yaml）；`~/.zcode/cli/config.json` 按注册表真实规则收敛为最小自定义 provider（id 不得带 `builtin:`/`account:` 前缀、`source: custom`、`kind: anthropic`、options.apiKey+baseURL、`model.main` 用 `自定义id/模型名` 字符串；凭据与端点实测 200）后，探针全绿——headless 哨兵命中、只读旗标（`--mode plan` + `--disallowed-tools Write,Edit,MultiEdit,ApplyPatch,Bash`）、home_copy 隔离、零 blocker。残余：**带桌面环境变量的裸终端 headless 仍报 Model creation failed**（`configSourceEnv:false`，zcode CLI 0.16.9 的装配问题，不影响编排器的隔离拉起形态）；glm 作为 Driver 的轮次本就不能入选审核者（不审自己的变更）。
10. **隔离环境的 APPDATA/LOCALAPPDATA 残余通道（1.2.2 审查 CLAUDE-11 登记）**：win32 隔离重定向了 USERPROFILE 并删 HOMEDRIVE/HOMEPATH，但未动 APPDATA/LOCALAPPDATA——第三方工具按 %APPDATA% 回退时写穿到宿主（污染面，非凭据泄漏面）。重定向可能破坏厂商 CLI 既有行为，评估后再动，不盲改。
11. **Windows 一键安装脚本（1.2.9 交付）**：发布包新增 `一键安装.cmd`（后端 `scripts/quick-install.mjs`，模板与清单在 `scripts/release-launchers.mjs`、由契约测试 `release-cmd-template.test.ts` 同源对账），链路为 Git 前置检测 → 安装前检查（复用安装器判定，只读）→ 安装（与 安装.cmd 同一命令、参数透传、子进程剥离 TRIVIUM_ASSET_ROOT）→ 装后版本核对 → `doctor --selftest` 14 步零配额自检；退出码 0/1/2/3 分层。**连带修复 .cmd 模板两处历史缺陷**：① 版本闸门失效——`node -e` 检查后不判 errorlevel，历史包里 Node<18 仍会继续跑安装器；② node 不在 PATH 时报两次系统级 9009 裸错且双击窗口瞬逝——补 `where node` 指引与按 `%cmdcmdline%` 判定的条件 pause。**边界**：本项是脚本级串联，§3「签名、公证和自带 Node」那条登记的一键**系统**安装（签名、运行时分发、更新与回退策略）不在本项范围、仍未实现；一键链路本身未做异机真实验收（§3 的异机未测口径不变），首次异机使用按部署手册 §1a 的前置清单人工核对一遍。
12. **预检自动校准的 doctor 时限（EV-251）在 Windows 上的实现（1.3.0 双平台统一时补）**：macOS 线的实现依赖进程组、`/bin/ps` 与 SIGTERM。1.3.0 起 win32 走父链：段内登记组时多记派生时刻，组长退出后按「父 pid 等于组号、创建不早于派生时刻」认孤儿后代、同号判复用，结束时树杀组长或逐个树杀孤儿直接子进程；信号只接 Ctrl+C / Ctrl+Break；台账加记启动时刻识别 pid 复用；给用户的终端重跑命令改 `.\.trivium\bin\trivium.cmd`。macOS 上只有类型检查与纯函数用例（`win-section-snapshot.test.ts`）覆盖，依赖 POSIX 进程组的用例在 win32 上带理由跳过。**2026-10-24 Windows 实测（30 s 档，零配额）**：到点退 76、`deadline` 段完整（reason=deadline、四段状态如实：1 段 in_progress / 3 段 not_started、launches 计数与提示逐段给出）、`residue` 为空、进程表无本次拉起的 CLI 残留（按父链核对，现场仅 ChatGPT 桌面应用与 ZCode 桌面程序自己的 codex.exe/ZCode.exe）、台账 `doctor-temp-<pid>.json` 无残留；重跑命令 `.\.trivium\bin\trivium.cmd` 形态在 PowerShell 里复制即执行成功。**2026-10-24 Windows 实测（60 s 档，用户批准，真实探针中途到点）**：退 76、agy 段 in_progress（拉起 13 次子进程、如实提示配额已花）、其余三段 not_started；进程表跑前后快照比对**零残留**；台账与探针临时目录无残留；`residue` 一条「进程组 33808 的组长已退出、组号已被别的进程复用，没有对它发信号」——**win32 的 pid 复用判定路径真实触发并被正确处置**（判复用跳过、不误杀），正是本条 win32 实现要验证的分支。第 12 条实测收口（BACKLOG EV-253 残余①闭合）。
13. **合并后 Windows 全量回归（1.3.0，2026-10-24 在 Windows 开发机实跑，读数与修复见下）**：双平台统一首跑（`npm run check`，20 逻辑核满并发）3090 用例 / 3075 过 / **15 红** / 42 跳过——11 格为**确定性缺陷**（按根因修复或带理由跳过，见下），4 格为负载底噪（同第 6 条的长尾族）。用例总数对 macOS 读数 3974 的差额 884 例是 `WIN_FILE_SKIP` 整文件早退的 POSIX 专属集成文件（1.1.0 既有设计，非回归）。**确定性缺陷 11 格的根因与处置**（产品修复 4 + 测试修复 4 + 平台语义跳过 3）：
    - **产品①（修，治 4 格）**：`repoId` 的输入形态分裂——产品 `projectRoot` 取 `git rev-parse --show-toplevel` 的**正斜杠**形态，测试与外部按 Node 习惯持**反斜杠**，同一仓库两种字符串哈希出两个运行目录桶，测试按自己拼的桶名读产品写的 `request.json`/运行目录即 ENOENT、预置的「被占窗口」预占不冲突（`handoff-dedupe`、`run-dir-collision` I1/I2、`scrub-output-text` T7 四格同根因）。修法：`repoId` 内 `path.normalize` 归一（win32 上桶名从正斜杠哈希变反斜杠哈希，旧桶留到 retention 过期；POSIX 零变化），`retention.test.ts` 加纯函数回归锚。
    - **产品②（修，治 1 格）**：Windows 取消标记遗留——`--cancel` 写下的 `cancel.requested` 不随运行清除，`review --worker` 人工重启同一 run 时，watcher 按 mtime 判新旧的 15 s 回退窗口在慢机器上不够（从上轮取消到重启不足 15 s），陈旧标记被当新标记、重启的 worker 不跑业务一律以 143 收场（`access-v3` 最后一格 143≠69）。修法：`workerMain` 在装 watcher 前物理清除遗留标记（此后写入的新标记不受影响）。
    - **产品③（修，治 1 格）**：Windows 桩 `hang_cli` 的 `sleepS` 语义写错——`setInterval` 永不退出，而 POSIX 侧 `sleep N` 睡完即退，`sleepS` 造「CLI 自然结束」的用例（`task-unreadable-refusal` I11）在 win32 全程挂死（262 s 仍 running）。修法：`setTimeout`（到点无 keep-alive 句柄自然退出，与 POSIX 同形）。
    - **产品④（修，0 格但每次可执行都报错）**：`init` 生成的 `.cmd` wrapper 注释是 UTF-8 中文，cmd.exe 按系统代码页（GBK）解析时字节错位把注释行拆出伪命令——每次执行报 `'shell' 不是内部或外部命令`（功能不坏、退出码正确，但 PATH 上若有同名可执行文件会真的执行它）。修法：`.cmd` 注释改 ASCII 英文（sh 形态照中文），`platform-win.test.ts` 加「.cmd 全文只含 ASCII」回归锚。
    - **产品⑤（修，预检误拦）**：codex 模型目录的**相对路径**（CC Switch 写的 `model_catalog_json = "cc-switch-model-catalog.json"`）原样进 `-c` 覆盖参数时 codex 按**进程 cwd** 解析（编排器 cwd ≠ CODEX_HOME）而 os error 2、目录采集失败，预检回落基底目录把 profile 档位的模型全部误拦（qwen 档位整组退 64）。修法：`expandHome` 对相对路径按 `codexHome()` 归一（与 codex 自读 config.toml 时按家目录解析的语义一致，绝对路径实测通过）。**注意本机现状**：修复后预检仍退 64——CC Switch 当前活动网关是 kimi 系（目录文件内容已是 kimi/k3），qwen 档位不在当前目录属**如实拦截**，网关与档位如何对齐由用户定（切回 qwen 网关或改档位）。
    - **产品⑥（修，治底噪族）**：`winProcessCreation` 第一趟枚举失败（PowerShell 在子进程风暴下偶发退出非 0 / 空输出）直接判 null，`--cancel` / 心跳 / 失联判定随机「判不了」（每轮全量换批红格的主要构成）。修法：失败路径加一趟 fresh 重试，持续失败仍 null、「判不了」语义不变。
    - **测试①（修，治 2 格）**：`override-source-start` 夹具只设 `HOME`——win32 的 `os.homedir()` 读 `USERPROFILE`，子进程的家还是真实的，`~/` 展示与隔离两前提都不成立。修法：IS_WIN 时补设 `USERPROFILE`。
    - **测试②（修，治 1 格）**：`scratch-cleanup` SC1 只设 `TMPDIR`——win32 的 `os.tmpdir()` 只认 `TMP`/`TEMP`，子用例全建到真实临时目录。修法：child 与 runChild 三键齐设；「相对路径 TMPDIR」半格在 win32 结构上测不到（os.tmpdir 对 TEMP/TMP 做 path.resolve 恒绝对），仅 POSIX 断言。
    - **测试③（跳，1 格）**：SC3「删不掉逐行告警」——NTFS + Node 24 的 POSIX 删除语义下无可靠「删不掉」构造（实测只读目录、目录内只读文件、父目录只读、被打开句柄四形态全部删除成功），`skipOnWin` 带理由。
    - **测试④（跳，1 格）**：`worktree-hash-cleanup` D1——锁的构造双重依赖 POSIX（过滤器沿 PPID 用 MSYS `ps` 找原生 worker 命令行，MSYS ps 只见 MSYS 进程；chmod 500 只读目录在 NTFS 同样锁不住），`skipOnWin` 带理由；「删不掉不判 failed」容错路径本体由 POSIX 侧守住。
    - **测试⑤（加固）**：`lock-cross-process` 时序窗口（满载下 node 冷启动 + import 秒级抖动）——pidFile 等待 5 s→50 s、起跑屏障 leadMs 700 ms→5 s；两格「恰一个赢家」断言改**互斥本质形式**（持锁区间两两不重叠 + 输家全 70 + 释放后无残留，两平台同判据：win32 上晚于赢家持有期到达的进程先后合法获取第二个 ok，互斥未破但「恰一个」恒红）。`retention` U14 组长树杀后加 1 s 进程表稳定等待（间歇红）。
    **修复后读数与底噪归因**：安静环境 20 并发两轮 6 红 / 13 红（红格集合逐轮不重叠、单跑全绿或同文件换格红）、并发降到 6 时 3 红——与本条第 6 条登记的 1.2.8「13 红长尾」同族同量级，**「两次全绿」在本机从未达成过**（1.2.8 基线亦为 13 红），剩余红格全部归因负载底噪族（PowerShell 枚举/子进程风暴下的时序漂移），登记待查同第 6 条口径。**需回 macOS 复跑的改动**：产品①③④⑥与测试①②⑤均在两平台共享路径或纯 win32 分支内，macOS 行为零变化由 `repoId` 归一的 POSIX 幂等与 `.cmd`/`USERPROFILE`/`TMP` 键的 IS_WIN 条件保证，但**惯例上 macOS 侧应全量复跑一次确认**（本机跑不了 macOS 全量）。**2026-10-24 macOS 复跑完成**：在 `fa09ce3c`（1.3.1）上前台串行全量两次，均 3975 用例 / 3965 过 / 0 红 / 10 跳过、退出码 0（对合并后基线 3974 / 3964 / 0 / 10 恰多本次新增的 `repoId` 回归锚 1 例，POSIX 上走条件断言分支、通过）；`lock-cross-process` 七格与 `retention` 全绿；跳过 10 例为 8 例「只在 Windows 上跑」加 2 例基线即有的不可达分支。读数见 [`evidence/macos-unify-20261024/`](../05_testing/evidence/macos-unify-20261024/) 的 `check-1.txt`、`check-2.txt`。第 13 条两平台实测收口。
14. **claude 网关凭据经命令行传递（1.2.0 起，2026-10-24 后台安全审查登记；2026-10-25 已修，BACKLOG EV-256 done，随 1.3.2 发版）**：**闭合（2026-10-25，主题 `网关凭据改环境变量注入`）**：按方案 A 改为子进程环境变量注入——新增唯一注入函数 `claudeInvocationEnv`（`adapters/claude-route.ts`：先展开 `claudeRouteEnv` 的清除补丁、再展开提取出的网关键，同名键网关值胜出、父进程独有的 `ANTHROPIC_*` 仍被清除），两条执行出口各调一次：`invokeClaude`（审查调用、预检探活、目录臂、准入 / 收口脚本）与探针 `routeInvocation`（execProbe 各臂、项目记忆两臂、verbose 阴性对照）；删除 `mergeSettingsEnv` 与 argv 构造器上的 `settingsEnv` 入参，`--settings` 只装 deny 规则，「某一臂仍内联」在类型层写不出来。`--version` / `--help` 不带网关 env（修复前后相同）；指纹组成与 `settingsEnvSha256` 不变；`scrubGatewayEnv` 对 stdout / stderr / commandLine 的脱敏保留。回归锚 `test/integration/claude-gateway-env.test.ts`（跨平台，假 CLI 记每次 spawn 的 argv 与环境；开启 / 未开启 / env 段为空三态，覆盖审查调用、探活、探针各臂、目录臂）与单测 G1–G3；变异 15 条全部咬住（「某一臂仍走内联」4 条、「出口或某一臂漏注」4 条、「注入次序颠倒」2 条、审查与探针两侧输出脱敏 3 条、键集外溢与未开启零变化各 1 条）；本机零配额对拍：未开启时新旧构建四组调用逐条相同，开启时基线进程表 94 行里 89 行带网关值、新构建 95 行零命中。报告 [`REPORT_2026-10-25_gateway_env_injection.md`](../05_testing/REPORT_2026-10-25_gateway_env_injection.md)。**如实登记的边界**：①profile 路线与网关同开时，包装器 source profile 的 `export` 会覆盖同名注入值（修复前网关胜出，修复后 profile 胜出），profile 只覆盖部分键时可能出现端点与令牌混配的 401——结构推理、未实测，只登记不改码（部署手册 §1a 有排障指引）；②暴露面从「本机全部进程可见的命令行」缩到「子进程环境块」，同用户进程仍可读（POSIX `/proc/〈pid〉/environ` 仅属主可读；Windows 无便捷的跨进程环境读取）；③**Windows 真实网关形态已验（2026-10-25，用户在 Windows 开发机执行，CC Switch 网关、claude 2.1.302、构建 `514eaca`）**：`doctor --only claude` ok、零 blocker，注记为「经子进程环境变量注入（12 键…）」，只读旗标与目录臂三工具均为 true、`readonly_breach` 为 false；预检探活退 0；进程表采样 314 次、19 个 claude 进程零命中；落盘扫描里凭据键零命中，命中的三个模型名键是探针合法记录的网关模型名。边界：采样窗口 420 s 短于约 10 分钟的 doctor，目录臂尾段约 3 分钟未采样；随后补做的真实审查一步（claude 作审核者，`b6cf09fa`）：claude 侧正常交卷，进程表与落盘零命中（该次运行因验收输出写进工作树被判漂移作废，与本条无关）。判读见 [`evidence/gateway-env-injection-20261025/windows-readout.md`](../05_testing/evidence/gateway-env-injection-20261025/windows-readout.md)，清单 [`windows-acceptance.md`](../05_testing/evidence/gateway-env-injection-20261025/windows-acceptance.md)。**EV-257 补记（2026-10-25）**：那次真实审查的审查文档里 `model_effective` 是占位符 `<redacted-env>`、来源却记 `envelope`——网关回报的模型名与模型名键同值（EV-258 订正：`init.model` 是 CLI 按模型名键解析出的配置值，所以恒与键值相同），被逐值脱敏吞掉却仍像回读成功；已由 BACKLOG EV-257 修复（模型名键不再逐值替换、凭据类键不放松，带脱敏痕迹的回读一律记 null 与 `unverified`），报告 [`REPORT_2026-10-25_gateway_readback_model.md`](../05_testing/REPORT_2026-10-25_gateway_readback_model.md)。上文「探针合法记录的网关模型名」一句不准：claude 探针不写 `models`，那三处命中更可能来自本机层给 claude 配的模型 slug（与网关回报名相同）。**原稿（2026-10-24 登记时）**：开了 `settings_env_source: user_settings` 时，`~/.claude/settings.json` env 段里的网关凭据被合进 `--settings` 的内联 JSON，出现在 claude 子进程的命令行里，本机能列进程命令行的其他进程看得到（日志与留痕里的命令行已脱敏，进程表里的没有）。缺省关闭，只在显式开启的机器上存在。改走环境变量或 0600 临时文件能否保住 `--restricted` 下的只读不变量要用真实 claude 实测（动用凭据、花配额），本次不改。**2026-10-24 方案已出**（[方案与实测计划](../05_testing/evidence/win-unify-20261024/gateway-credential-plan.md)）：两形态对比——A 经子进程环境变量（暴露面最小、无落盘；生死判据是 `--restricted` 是否忽略进程 env 形式的 `ANTHROPIC_*`，未实测）；B `--settings` 指向 0600 临时文件（生死判据是 `--restricted` 是否忽略命令行显式给的 settings 文件；且 0600 在 NTFS 权限位降级、硬杀有残留清扫问题，见第 7 条）。推荐 A、备选 B、都失败则维持现状。**2026-10-24 实测（用户批准，真实 claude + `--restricted`，各一次探活级调用，读数见 [实测输出](../05_testing/evidence/win-unify-20261024/gateway-credential-test.txt)）**：三形态**全部生效**——对照（内联 `--settings`）exit 0 正常回复；**A（子进程 env 注入）exit 0 正常回复，且只读不变量保持**（`--restricted --strict-mcp-config --tools Read,Grep,Glob` 下要求写文件，被工具面拒绝、标记文件未写出）；B（`--settings` 0600 临时文件）exit 0 正常回复。另两项实测事实：①显式 `--model <完整模型 ID>` 不经 CC Switch 的别名映射会被网关拒（400 Invalid model）——调用须靠 env 的 `ANTHROPIC_MODEL` 默认或用别名；②本机 claude 与 codex 走**不同网关**（claude=阿里 token-plan qwen 系、codex=Kimi 官方），网关对齐要分开看。**结论：A 形态可行且全面占优，定为替换方向**；实施（改 `invokeClaude` 调用链、停用 `mergeSettingsEnv` 的 env 段）属改调用链，待用户指示是否走 /dual-run。同次审查的另一条（`.cmd` 垫片参数经 cmd.exe 重解析可注入）已于 1.3.0 改为含元字符即拒绝拉起（2026-10-24 Windows 实测：本机四家 CLI 全走原生 `.exe`/`.cjs` 入口、无一经垫片，拦截未误伤）。
15. **claude 探针首跑引导的写回让 CLI 升级后与全新安装首跑 doctor 必判「路线变化」（1.1.1 起 Windows 线引入、1.3.0 合并后两平台都有；2026-10-24 macOS 复跑发现；2026-10-24 已修，BACKLOG EV-254 done）**：**闭合（2026-10-24，主题 `claude首跑路线误判`）**：首跑引导改用配置副本，不再写回调用方的 `opts.config`（契约：`probeClaude` 不改调用方传入的配置），doctor 比对逻辑不变、只加语义边界注释；报告 [`REPORT_2026-10-24_claude_first_run_route.md`](../05_testing/REPORT_2026-10-24_claude_first_run_route.md)。2026-10-25 真实 CLI 验收两格（盘上记 2.1.309 的升级格、无结论且未配 bin 的全新安装格）均首跑退 0、零 blocker、native 按 2.1.310 登记。**补登的触发面（本条原稿只写了升级，已补）**：盘上没有 claude 结论——全新安装、或新建 `.trivium/` 的项目——同样首跑必退 69；变的不只 `version`，缺省配置未配 `agents.claude.bin` 时入口 `nativeBin` 也从空变成本次实测值，所以「比对时钉住探测前版本」修不了这一面（零配额核验见 [`evidence/claude-first-run-route-20261024/`](../05_testing/evidence/claude-first-run-route-20261024/)）。**修复后的语义边界**：比对只判探测期间现读环境的几项变没变——profile 包装器路径与内容、profile 文件、开了 `settings_env_source` 时的网关 env 摘要；入口与版本是本次探针自己的测量值，由登记按快照重算，不算「探测期间的变化」。三条如实登记的边界（修复前后相同，不是本次新开的口子）：①探测中途 CLI 自升级路线比对看不见，目录臂窗口内的目录指纹能让目录事实作废，落盘的是探测开头测的旧版本、下一次预检的版本核对会拦下；②native 入口来自内存配置，进程内不重读 `config.yaml`；③缺省 native 配置（未配 bin、未开网关 env）下比对恒判稳定，这条 blocker 对该形态不会触发，剩下的保护是目录指纹与下一次预检的版本 / 入口核对（回归锚 N4 钉住）。**Windows 残余**：回归锚与兄弟套件一样只在非 win32 运行（shebang 假 CLI），Windows 侧没有这条行为的自动回归；待下次在 Windows 机器上 claude 升级后或新项目首跑 `doctor --only claude` 时复核：应退 0、无该 blocker、`routes` 按新版本登记。**原稿（2026-10-24 登记时）**：`probes/claude.ts` 在目录臂之前有一段首跑引导（`0e44120a`，治全新安装时盘上没有 `entrypoint`、目录臂拿 null bin 去 spawn），做法是把本次新探针直接写回 `opts.config.probe.cli.claude`；`doctor.ts` 的路线稳定性比对却用同一个 `opts.config` 在探测前后各算一次指纹，而指纹含 `version`——探测前取盘上旧结论的版本，探测后取刚写回的新版本。于是**只要 claude CLI 自上次探测以来升过级、且探测走到了目录臂（解析出模型、只读旗标非空），首跑必判「Claude 路线在探测期间发生变化」**：退 69，删除该路线的 `routes` 登记、根结论 `readonly_flags` 清空，本机 claude 作审核者随即不就绪，主探针与 7 臂目录取证花掉的配额白费；盘上版本已在这次失败落盘时更新，所以再跑一次即通过。**2026-10-24 实测**：本机 claude 当天 07:47 由 2.1.309 自升级到 2.1.310，`doctor --only claude` 首跑 212 s 后退 69（[首跑留痕](../05_testing/evidence/macos-unify-20261024/doctor-only-claude-run1.json)），重跑 224 s 后退 0、零 blocker；零配额复现（拿已编译的 `resolveClaudeRoute` 照写回前后各算一次 native 指纹）：版本不变时 stable=true，2.1.309→2.1.310 时 stable=false。Windows 侧当晚 claude 版本没变，所以没撞到。**波及 EV-251**：预检发现入选侧 CLI 版本与探针记录不一致即判失败并给出校准调用（`preflight.ts` 的 `checkCliVersions`），自动校准那一轮 doctor 对 claude 会撞上本条、退 69，claude 侧仍不就绪，要再手工跑一次 doctor。**修法方向（待定）**：首跑引导改写一份配置副本、不动 `opts.config`，让稳定性比对前后取同一版本来源；或比对时显式排除本次探测自身带来的版本变化。改的是 doctor 判据与探针调用链，按 M11 分档走 `/dual-run`、由用户发起；回归锚要用注入版本变化的单测——本机盘上已是新版本，真实探针在下次 CLI 升级之前再也走不到这条路径。

16. **`--cancel` 判不了身份时的手工出路提示仍教 `ps` / `kill` 写法（2026-10-27，1.3.2 发版收口登记；同日已修，BACKLOG EV-261 done，同日 Windows 已复核）**：`run-protocol.ts` 的 `manualCancelWayOut`（EV-175 入口格与 EV-176 未确认格共用）教「`ps -p <pid> -o command=` 核对、`kill -TERM -<pid>` 按组结束」，`manualKillWayOut`（EV-176 发过信号后判不了）教「`kill -KILL -<pid>`」——均为 POSIX 终端写法。win32 默认终端 PowerShell / cmd 里照抄不可执行（`ps` / `kill` 在 PowerShell 只是 Get-Process / Stop-Process 的别名，不带这些参数形态；负 pid 进程组语义不存在）；Git Bash 里可用但提示未指明须在其中执行。不影响判定与自动收尾（发信号、回收锁与闸门都由编排器自己做），只影响极端情况下人工出路的可操作性。改法方向：按平台换提示文案（PowerShell `Get-CimInstance Win32_Process -Filter "ProcessId=<pid>"` 核对命令行、`taskkill /PID <pid> /T /F` 按树结束），见 BACKLOG EV-261。**修复（2026-10-27）**：按平台给命令，win32 上是上述 `Get-CimInstance` 与 `taskkill /PID N /T /F`，「取不到启动时刻」的括注改为「进程枚举未返回」；POSIX 一侧逐字不变；同一批报错里的 SIGTERM / SIGKILL 措辞在 win32 上未动。
17. **1.3.2 Windows 发版全量（2026-10-27，构建 `bd5c0635` 即标签 `v1.3.2`）新登记的四条（BACKLOG EV-259～EV-262；EV-259、261、262 当天已修、Windows 已复核；EV-260 同日已修（2026-10-27，主题 `Windows原子写重试`）：`writeAtomic` 拆出 `renameOverwriting`，win32 三码有界重试（6 次、总睡眠 ≤775 ms）、耗尽清 tmp 抛原始错误、POSIX 逐字不变；`lock.ts` 回收改名不重试、`review.ts`/`doctor-deadline.ts` 同口径；PowerShell 按柄实测两场景通过，报告与证据见 BACKLOG 行）**：同一构建在 Windows 上跑了两次全量。第一次在先前的 Windows 环境里跑（标签移动前那次全量与打包都在 `D:\Work\TriviumCode`）：3117 例 3069 过、5 红、43 跳过，5 红按报错形态判为第 13 条的负载底噪，相关文件单跑全过；这次的日志没入库。第二次在 `C:\Work\TriviumCode`，Node v22.23.2：3117 例 3067 过、6 红、1 取消、43 跳过；有 4 格单跑通过，另外两个文件单跑仍红。由此新登记四条：
    - **EV-259，测试侧缺陷，两处**：
      - `grep-hits` T13 的物理根少写了盘符，只在仓库位于 D 盘时绿；
      - `scratch-cleanup` SC2 / SC5 按原样比对子进程 `node --test` 的输出。Node 22 及更早，输出不是终端时缺省用 TAP 报告器，会转义反斜杠。
    - **EV-260，产品缺陷，偶发**：`writeAtomic` 在 win32 上 rename 失败不重试，`--start` 偶发报「内部错误：EPERM … rename … status.json」。
    - **EV-261，提示文案**：`--cancel` 判不了时给的手工出路，在 Windows 上教的是 `ps -p` / `kill`，即上面第 16 条。
    - **EV-262，测试时限**：`release-package` 用例的两个时限在负载下偏紧，两次全量各以不同形态超时。

    发布包不受影响：包从干净的 `bd5c0635` 打出，解压后一键安装真实跑 14 步自检，14/14 通过。判读见[《发布检查报告》](../05_testing/发布检查报告.md) 1.3.2 一节。

## 4. 已接受的结构性限制

- 就地审查、有限命令文本检测，不做强隔离；Git 对象库、改名副本、解释器间接访问等不承诺全面封锁（EV-16/19、ADR-001/002）。
- L2 审批期间业务改动不由 Hook 保证拦截；审批前工作树摘要只告知、不改变审批结论（EV-132）。
- 已知 Bash Hook 字面误拦是明确接受的取舍；不得借发布清理给 commit 加豁免。
- 模型请求、配置声明、生效回读和服务端身份分开记录；缺证据保留 null/unknown，不用“未变化”代替实际拒绝尝试。
- 凭据清扫与到期删除不是全盘后台服务；仍活或判不清的进程、超大/二进制和保留面存在残余，按运维手册处理。

## 5. 本轮已处理的发布问题

- 安装前检查脚本改用 `fileURLToPath(import.meta.url)` 定位，去掉 Node 18 不具备的 `import.meta.dirname`；Node 18 真运行仍须按矩阵验证。
- 修正卸载输出：config 仍在且 wrapper 缺失时 Hook 会阻断，不能误导为自动 no-op。
- 版本号、锁文件与 CLI 统一为产品版本，增加发布包版本/构建输入一致性检查。
- 修复 win32 上带目录段 glob 整体失配（1.1.1）：`matchesAnyGlob` 匹配前未把 `path.relative` 的反斜杠归一到 `/` 域，缺省 `sensitive_globs` 的 `**/*.pem`、`**/.env*` 等在 Windows 上命不中嵌套文件，敏感文件漏出禁读集与 peer_leak 机器核验；根级 `**/*-<id>.md` 靠 `[^/]*` 吃掉反斜杠侥幸仍命中，1.1.0 移植批单测因此全绿，由 doctor 目录探针的 fail-closed 自检（「生产禁读枚举漏目录夹具」）暴露。修复为匹配输入侧单点归一，deny 矩阵补带目录段回归锚点；同批把锁文件版本对齐产品版本。
- 修复 claude 探针段的首跑引导（1.1.1）：目录追加臂按 config 重建路线（`resolveClaudeRoute` 读盘上 `probe.cli.claude.entrypoint`），而该值要等本段成功落盘后才存在——没有历史探针结论的机器（全新安装）首跑时目录臂拿 null bin 去 spawn，直接 TypeError（「The "file" argument must be of type string」），探针段整段崩掉、entrypoint 永远落不了盘，死锁在首跑。此前 macOS 机器靠既有结论掩盖了这条路径。修复为目录臂解析路线前把本段新鲜探针对象同步进内存 config。
- 修复 codex 隔离副本缺模型目录引用件（1.2.1）：基底 config 的 `model_catalog_json` 以裸文件名引用 CODEX_HOME 下的目录文件（CC Switch 布局），`prepareCodexHome` 的 `rewriteHomePaths` 只追 `~/` 前缀追不到它——副本缺件时 codex 以裸 ENOENT（os error 2）当场死掉且不报路径，探活与审查全灭（win32 实测定位：全量副本活、最小副本死、补目录件即活）。修复为副本准备时解析该键并拷入引用件（机器配置数据，不含凭据）。
- 双审第 1 轮修复批次（1.2.2，`.reviews/Windows原生移植/code/`）：availability 空旗标 fail-closed（CLAUDE-01）、取消旗标基线前移 15 s + 陈旧留痕（CLAUDE-02≡CODEX-03a）、进程枚举失败兜底加显式龄期上限（CLAUDE-03）、verbose 阴性对照线程化网关 env（CLAUDE-04）、catalogRef 收裸文件名（CLAUDE-05）、探针臂逐值脱敏与运行路径对称（CLAUDE-06）、异平台身份记录判 unverifiable（CLAUDE-08≡CODEX-02）、发布脚本补 windowsHide（CLAUDE-09）、init 对含 % 路径显式拒绝生成 .cmd（CODEX-04）、zcode 五文件虚报等价注释改写（CODEX-01）、需求说明书补 1.2.x 行为承诺并升 1.2.2（CODEX-05）、§7.1 三段口径修正（CODEX-06/07、CLAUDE-10）。
- 修正首页、手册及 gate 注释中的“档位未实现”“作废侧重跑未实现”等过时说明；旧历史原文与证据保留。
- 新增预构建包，包含安装器运行时读取的 carriers、核心资产和全部入口；文件清单、依赖许可和校验值随包交付。
