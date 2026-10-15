# 待批准步骤与最小预算提案（当前不可执行）

本文件是完整停点说明，不是启动批准。仅有本轮只读/本地准备授权；厂商增量 0/0。以下所有动态实际结果为 null。

## 预算判定

| 操作 | 拟归属 | 计划数量/硬限 | 现在可执行性 |
| :--- | :--- | :--- | :--- |
| 静态读取、证据落盘、脚本语法检查 | 非厂商 | 本轮厂商启动 0 | 已执行 |
| D0 捕获入口实验 | 拟 admission，仍需明确 wrapper 计数口径 | 希望只放一次 wrapper、native=0；**可验证的父级硬上限 null** | 不可执行 |
| H1 archive 健康会话 | 拟 admission | 直接 native 路线至少 1；wrapper→native 路线至少 2 个边界；完整上限 null | 不可执行 |
| S2～S5 同一 archive 会话的四次工具对照 | 同会话工具请求不等于新 CLI 启动 | 要求新增 CLI=0；恢复/重启仍算新启动 | H1 和逐段授权之前不可执行 |
| E1 empty 新会话 | 拟 admission | 直接 native 至少 1，wrapper 路线至少 2；完整上限 null | 不提前开启 |
| 任何 review/doctor/preflight、help/version/额外探测 | review 或 admission 依具名功能 | 本批 0 | 禁止 |

若使用 wrapper→native，两新会话的主链**至少 4 个启动边界**，不含重启、辅助进程和 D0；这只是结构下界，绝非预算申请上限。现有 admission 只余 1，review 余 8 不能跨池使用。当前授权 0 又严于剩余 1；不能用“80 总额尚余 9”启动。

本轮没有给出一个虚假的“安全硬限”。D0 的目标 1 也没有父级预占保证，故暂不请求启动批准。若后续找到可证明的父级控制，提案必须重新给出：分池绝对 cap、绑定时的累计读数、max attempts、超额拒绝发生在 spawn 前的本地证据、未覆盖路线为拒绝；上限/路径/版本任一未知时保持不启动。

## D0：最小动态取证设计

目标仅是确认 SDK→启动包装器的真实 cwd、argv 结构、native 路径/指纹及 NODE_OPTIONS 状态。入口是本包 capture-only-entry.sh → 固定 Node → capture-only-entry.mjs。最后一级只记脱敏元数据并退出 2，永不调用 native。**该 2 是诊断预设拒绝，不是场景 5 的完整性拒绝。** 没有模型请求、项目 Hook 或健康会话结论。

候选配置全部差异见 configuration-proposal.json。拟在全新 `diagnostic-isolation/user-data/User/settings.json` 写 machine 设置，仅复制本机 2.1.296 扩展到专用 extensions 目录；不使用现有窗口、不恢复旧会话、不修改全局用户设置。隔离配置可能缺少原窗口环境，因此只能作为辅助实验，不代替原配置集成验收。当前没有创建这个隔离目录、配置或授权；候选 .sh 仍为 644。

**执行前必须同时解决的阻断项：**

1. 在扩展宿主真正调用 spawn/execFile/其他实际启动 API **之前**加具名预算预占控制；所有 wrapper、native、辅助 CLI、恢复和重启分支均有映射。不修改厂商扩展产物来伪装原集成。不把入口内部 `wx`、PID 监控、事件后记账视作事前拦截。
2. 用非厂商本地替身验证一次允许、第二次拒绝、并发拒绝、未知入口拒绝及失败预占不回收；还须验证该控制真实加载到隔离扩展宿主。后一点目前没有可执行的零厂商验证路径，仍为 null，不能靠配置字符串推断。
3. 根据已验证边界明确 Driver/包装器归属池、硬限和历史漏覆盖处理政策；不回填或重置当前累计台账。允许一次包装器不等于允许 native 或模型请求。
4. 复核当前文件 hash、模式、真实 cwd、扩展版本/加载来源。对比原进程 lstart，不能误关闭 PID 已复用或属于其他项目的进程。

阻断项全部解除且 Bob 具名批准后，才可在用户系统终端做以下步骤；**现在不得复制执行 launch 命令**：

1. 把隔离目录“原先不存在”的事实及完整候选内容保存为独立恢复基线；当前已在 configuration-proposal.json 保存不存在状态、所需文件和原 Hook/wrapper 独立备份。激活前再次确认路径不存在，拒绝覆盖已有内容。
2. 按 configuration-proposal.json 的目标路径和内容创建隔离 user-data，复制具名扩展而不更新/重装原扩展，校验 package/extension/native 指纹；仅候选 entry.sh 改 755。此步属于新配置生效授权，不包含在旧 setup 中。
3. 发布**新目录的新** capture-only-authorization，绑定本包指纹、父级预占测试证据、归属池/绝对 cap、一次尝试、真实用户原话。不伪造 `parent_pre_spawn_gate_verified=true`。
4. 仅使用以下候选 argv；先把已验证的父级控制应用到此隔离实例。没有父级控制时，不存在可以直接执行的完整命令：

```text
/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code
--new-window
--user-data-dir /Users/chenzhenbo/Work/trivium-m11-step12-zero-20261015-01/client-start-readonly-20261016-01/diagnostic-isolation/user-data
--extensions-dir /Users/chenzhenbo/Work/trivium-m11-step12-zero-20261015-01/client-start-readonly-20261016-01/diagnostic-isolation/extensions
/Users/chenzhenbo/Work/trivium-m11-step12-zero-20261015-01/s5-client-plan-20261016-01/archive
```

5. 只打开 archive 新项目的一次 Claude 面板，不发送消息、不登录/探测、不点重试。面板打开前若扩展已请求启动，计为本次尝试并停止，不再打开一次。原始证据必须包含父级 reserve、真实启动 PID/PPID/lstart、wrapper observation、扩展原始行号及实际完成状态。wrapper 未回读时不再试。
6. 任何未预期启动、超额尝试、cwd/版本/指纹不符、身份/网络请求前置、自动恢复或日志缺失，立即停止。只关闭新隔离窗口；终止进程前核对 PID+lstart+cwd，不动原会话。保留隔离目录和原始日志，关闭后将整个新隔离根改名为带时间的保留现场目录（目标原先不存在），原全局配置/夹具不需要恢复。不删除历史证据、不扩预算后重试。

动态捕获成功只解决入口实参，不证明 native 数量、健康前置或 Hook 等价性。下一停点仍在 H1 之前。

## H1 之前的新采集版本要求

冻结包保持原样。以下必须在新版本准备完整源码差异、备份、独立授权和零厂商检查后再批准生效，本轮未生成可部署的 runtime v2：

- 将 `verifyAnchors` 的“准备时绝对预算相等”拆为不可变文件指纹和**新批次授权的已计启动基线/边界**；不能改旧 preparation.budget_before。累计 budget 必须与新 Driver reserve/launch 严格对账，不只检查小于上限。
- Hook 子进程仍应为零厂商增量；Driver 启动授权与 Hook 零增量授权分开，保留旧 cap/preload 和安装 bundle 指纹。review cap 不得因新会话而放宽。
- runtime 的 client 授权路径、新调用记录目录、checkpoint 与 fixture-step 统一指向新版本。只拷一个 runtime 不够；旧脚本均有严格旧预算校验，不能继续执行旧 checkpoint/fixture-step。
- 新 wrapper 仅绑定两个具名真实 cwd；所有 Hook 命令、顺序、timeout 完全不变。备份当前已 setup wrapper，变更后的完整差异与恢复命令交 Bob；原工程及旧 wrapper 不改。
- 采集保持 stdin 原字节、stdout/stderr、退出码、signal；分别记录父/子 PID、load token 和 tool_use_id（缺失为 null）。收集层拒绝应使用独立原因字段，不伪装生产 Hook 拒绝。
- 对相同输入在新夹具上比较原安装 bundle 与候选采集路径的结果/输出/hash/权限和副作用；本地对照不能替代真实客户端，SessionStart/Stop 的任何副作用需独立核对。此对照目前**未测**；新增本地执行也必须先明确其受保护路径副作用范围。

## H1 及 S2～E1：精确分段协议

现有 client-requests.json 六份 Bash input 可原样复用，实际执行授权和证据存入新版本。没有真实提交；Git 工具退出码与 Hook 退出码分开。将以下标签用于唯一请求，并保留完整 `tool_use` 与 `tool_result` 原始记录。

```text
archive command:
GIT_INDEX_FILE=/Users/chenzhenbo/Work/trivium-m11-step12-zero-20261015-01/s5-client-plan-20261016-01/archive.index git -c core.quotePath=false --no-optional-locks commit --dry-run

empty command:
GIT_INDEX_FILE=/Users/chenzhenbo/Work/trivium-m11-step12-zero-20261015-01/s5-client-plan-20261016-01/empty.index git -c core.quotePath=false --no-optional-locks commit --dry-run
```

| 段 | description（精确值） | 用户终端状态与所需结论 | 预算/停点 |
| :--- | :--- | :--- | :--- |
| H1 archive | M11-S5N01 baseline dry-run | 真实新 cwd/session；SessionStart、Stop 正常；pre-bash=0、pre-commit=0，真实 dispatch/结果与采集回执一致。验证采集等价性；只证明健康前置，不补 5.2～5.5 | 启动上限未核定，不执行；成功回收后再批 S2 |
| S2 缺件 5.2 | M11-S5N01 missing dry-run | Bob 在系统终端将已备份且记录在案的目标移至独立保留位；pre-bash=0、pre-commit=2，输出含缺失相对路径和 run_id；不得发生 Git dispatch，Git exit=null | 同会话新增 CLI 硬目标 0；异常先恢复、停止 |
| S3 恢复 5.4 | M11-S5N01 restored-missing dry-run | Bob 恢复原字节与权限；两个 Hook 0，有 Git dispatch/result；完整树恢复 | 本段单次；失败不做改件 |
| S4 改件 5.3 | M11-S5N01 changed dry-run | Bob 仅追加既有计划的固定注释；pre-commit=2，并报记录 hash/现 hash；pre-bash=0，无 Git dispatch | 同会话新增 CLI 0；异常先恢复 |
| S5 恢复 5.4 | M11-S5N01 restored-changed dry-run | Bob 从独立备份恢复字节/权限；两个 Hook 0、真实 dispatch/result；完整树恢复 | 不自动开 empty |
| E1 空仓 5.5 | M11-S5N01 empty dry-run | 独立 empty 新会话、新启动计数/健康前置；归档只有 README；两个 Hook 0，真实 Git 结果。空仓无提交时 Git 可非 0，不能因此判 Hook 拒绝 | 另批启动预算；上限 null，当前不执行 |

故障目标与恢复内容已经独立备份，读数在 configuration-proposal.json：

- 缺件：`.reviews/m11-s12-capacity/plan/2026-10-12-m11-s12-capacity-r2-gemini.md`。
- 改件：`.reviews/m11-s12-capacity/plan/2026-10-12-m11-s12-capacity-r2-glm.md`。
- run_id：`20261012T154021Z`。
- 改件后缀严格为 `\n<!-- M11 S5 isolated content-change control 20261016-01 -->\n`。

**本轮未发布故障注入的可执行命令。** 旧 fixture-step 是冻结的不可用预算基线，不能把它当下一轮命令；新版本生成后，Bob 的精确命令须连同该版本 hash 再提供。当前两份完整备份与当前目标逐字节一致；恢复必须校验“现场确为本批缺件/改件”，遇到未知变更不覆盖。

每段保留：前后全树（含 .git）集合/hash/mode/bytes、独立索引 hash/存在性、安装 runtime 与扩展指纹、预算两池 reserve/launch/loaded 记录、session/cwd/channel、唯一 tool_use_id、Hook 输入原字节 hash、每个 Hook 的父子 PID/完成码/stdout/stderr、扩展完成事件。没有直接 tool_use_id 时，只有唯一请求+同会话同 cwd+无并发的时间窗才可辅助关联；不能编造 PID 或事件连接。失败后也要先落盘证据，不因判红丢弃实际退出码。

原始 Hook 执行顺序以客户端事实为准；不根据配置数组的先后声称两 Hook 串行。任一包装器、预算、cwd、缺授权或待裁决错误均使本段无效。客户端没有 dispatch 时 Git 退出码必须 null；健康 dry-run 的 Git 1 需查看实际输出，不能推断通过原因。
