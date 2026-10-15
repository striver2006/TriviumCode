# M11 Step 12：父级预算零厂商实验与v2采集候选

2026-10-16，Asia/Singapore。当前授权：仅零厂商独立准备，厂商增量 admission 0 / review 0。**本轮准备完成；真实父级控制仍未验证，安全启动上限 null。** 不启动客户端、不使配置生效、不修改冻结包。

## 核对结果与父级入口

[before-state.json](./before-state.json) 与 [after-state.json](./after-state.json)核对原工程、两份备份、archive/empty、外部索引、旧 calls、运行时锚点、冻结18文件、完整旧setup包及上一轮只读包；真实预算 ledger 的文件集合、字节hash、权限、大小也保持一致。现有未提交报告/矩阵及上一轮新增证据均保留，未提交推送。

本次新读 [parent-entry-static.json](./parent-entry-static.json)保存本机源码hash与字符offset：

| 层次 | 当前可证事实 | 结论 |
| :--- | :--- | :--- |
| VS Code 创建扩展宿主 | desktop.main.js 的 `_start()` 合并 shell/debug env 后调用 `N$n(n)`；该函数删除 DEBUG、NODE_OPTIONS、VSCODE_NODE_OPTIONS、LD_PRELOAD、DYLD_INSERT_LIBRARIES。随后显式构造 inspect 等 execArgv | 普通环境变量注入不能证明扩展宿主已加载侧车 |
| 扩展宿主内 SDK | 2.1.296/2.1.300 的 spawnLocalProcess 都进入 Node child_process.spawn，调用原始spawn之前是所需的**逻辑父级计数点**；SDK另清除子环境NODE_OPTIONS | 子环境清理不撤销一个已经安装到父进程的patch，但“已经安装”必须有实际证据 |
| 调试启动分支 | 本机源码有 inspect-brk 分支；查找调试端口失败可返回0并退回普通参数 | 未实际验证暂停早于扩展激活、加载回执、所有宿主覆盖或端口失败行为；不是已验证的安全启动入口 |
| 用户包装器内部 | 包装器进程开始后才能记录自身，最多控制下一跳native | 不能替代前一个spawn的预占；wrapper/native需分别覆盖 |
| 其他入口 | exec/execFile/fork、辅助CLI、重启、原生后代、其它宿主或既存函数引用 | 实际覆盖未验证，不能据本地allowlist测试宣称全覆盖 |

**当前阻断原因是加载与覆盖证据缺失，不是预算算法实验失败。** 在“不启动客户端、不修改生效配置/厂商安装文件”的本轮边界内，没有获得真实扩展宿主的事前加载回执。没有连接调试器、开启调试端口、重载窗口或执行厂商help/version。没有给出绕过环境清理的启动命令。

## 已实际执行的本地实验

[local-budget-results.json](./local-budget-results.json)：15项全部通过。实验启动独立Node父进程，子程序只允许本包 `mock-native.cjs` / `mock-wrapper.cjs`，并验证文件指纹和真实cwd；原始输出必须含 `m11-local-only/0.0.0` 指纹。`local-lab/` 下的 approval/ledger 是显式标注的实验数据，不是真实厂商授权或台账。

- 零额度拒绝，首次允许后第二次拒绝。
- 八个父进程并发争用三个槽：恰好3个替身进入、5个在原始spawn之前拒绝；子入口检查预占文件已存在。
- ENOENT真实启动失败仍占一个槽，后续尝试拒绝，不退款。
- 分池额度不得借用、总上限独立生效。
- 未知命令/错误cwd/指纹变化均在spawn之前拒绝；exec、execSync、execFile、execFileSync、spawnSync、fork六种旁路拒绝。
- wrapper→native消耗两个实验槽；只给一个槽时native未启动。
- ESM导出的spawn同步覆盖；删除子环境NODE_OPTIONS后，已加载的父级patch仍生效。
- 退出7、stderr及SIGTERM真实进程结果保存一致。

门禁本身硬编码为**本地实验专用**：限定当前 `local-lab` 根和实验哨兵、精确允许两个本地脚本/固定Node与故意不存在的本地可执行路径；无真实厂商路线。它复用现有budget core预占实现，但不调用真实预算根、不改生产core/preload。不能把它安装到VS Code后宣称可用。

[budget-binding-results.json](./budget-binding-results.json)：10项全部通过。用合成结构验证新admission预占逐项绑定、历史预占不变、未知/重复启动拒绝、review不增长，以及未激活状态先拒绝。合成回执路径没有创建文件；这些测试不证明真实回执来源。

本轮合计25项本地行为检查通过。定向文档/语法/脱敏/矩阵结果见 [validation.json](./validation.json)。没有执行真实Hook等价性测试，也没有执行候选runtime、checkpoint、故障注入或恢复程序。

## v2候选与完整差异

最终版本以 [candidate-manifest.json](./candidate-manifest.json)、[candidate-diffs-final.json](./candidate-diffs-final.json)及 [candidate-final.patch](./candidate-final.patch)为准。首次生成的candidate-diffs.json/candidate.patch仅保留开发快照，不用于部署。全部候选仅保存在本证据目录。

| 文件 | 改动与目的 |
| :--- | :--- |
| common.mjs / budget-binding.mjs | 拆开不可变文件锚点和新会话预算绑定。历史reserved集合/hash必须原样保留；admission每个新增预占必须与具名授权、确切index/hash及真实父级spawn回执逐项对应；累计数相同但内容变化也拒绝。review仍零增量，继续受本步分池和总上限约束 |
| deployment.json | 发布为enabled=false、实际父级覆盖null。未来必须先提供真实隔离宿主的覆盖证据；本地实验不能填true |
| runtime.mjs | 仅保留五个既有Hook，init不可调用；新路径授权/记录目录；核对真实cwd与Hook输入cwd/session；安装bundle及旧cap/preload不变。采集层拒绝独立记录并退出75，不冒充生产Hook的完整性退出2；有效回执保留stdout/stderr/code/signal |
| checkpoint.mjs | 同步新授权/预算绑定/新calls目录和新wrapper期望hash；加cwd对应核对。仍只给结构性读数，acceptance_pass为null |
| fixture-step.mjs | 同步新基线及记录目录，故障注入要求单独s5-fault-v2授权和allowed_actions；还要求真实健康/采集等价性确认及恢复后通过回执，不能仅凭structurally_ready注入。恢复保留原“已发生本批操作且当前内容确属本批”检查，不因预算漂移阻止已授权恢复 |
| proposed-wrapper.sh | 仅拟改两个新夹具的wrapper目标为v2 runtime；没有复制到夹具，候选文件无执行权限 |
| ledger-baseline.json | 只读记录当前真实reserved集合及hash，838/401；不是允许新增启动的授权 |

[activation-diff.json](./activation-diff.json)包含两份**当前已setup wrapper**的完整独立备份、hash和权限、拟替换全文及hash。Hook配置差异=[]，全局配置差异=[]，冻结包差异=[]。没有写 client-authorization.json、fault-authorization.json、launch-binding.json 或真实父级启动回执；只有明确标为not-authorized/template_only且未知字段null的模板。

**重要前置依赖：** runtime要求 `client-binding-archive.json` / `client-binding-empty.json` 的真实session/cwd。SessionStart可能早于外部采集到session id；本轮未解决这段首事件绑定的竞态，不能靠预填或伪造session绕过。v2是可审阅候选，不是健康启动已验证的包。首次客户端方案必须同时解决安全采样与首事件绑定，保持Hook全集。

本轮只做候选语法、纯预算绑定及独立Node门禁实验。v2的真实输出/退出/信号等价性、SessionStart/Stop生命周期、副作用、完整SDK进程树覆盖均**未测**。尤其本地mock门禁的退出/信号检查不等于v2 runtime等价性测试。

## 下一停点与恢复方案

1. 当前不启动。需要一个在扩展执行之前可核验的父级加载方案，并明确实际全部启动路线；无法核验则继续阻断，上限null。扩大预算不能解决漏覆盖。
2. 首事件session绑定和父级加载解决后，以新证据给出分池绝对上限、每个边界的reserve/spawn/完成回执、失败即停方案，再提交具名启动/配置生效批准。旧setup批准不延伸至此。
3. 配置生效前，由Bob检查两个夹具wrapper仍等于activation-diff中before hash；仅这两个wrapper可替换为候选after。任何漂移都停止。保护工件注入仅Bob系统终端执行；本轮没有可立即执行的注入命令。
4. 如未来仅应用wrapper后需要回退，先停止并核对新会话PID+lstart/cwd，确认现场wrapper严格等于该次批准after hash，再从activation-diff中具名独立备份恢复原字节和755权限；核验Hook配置、全树及外部索引。遇到未知内容不覆盖。新调用记录、失败工件全部保留，不回写旧包。
5. 若未来已做缺件/改件，先用同一新版fixture-step的对应恢复分支恢复本批目标，再处理wrapper回退；原工程/备份不动，不能用旧脚本补恢复凭证。

本轮无需恢复，未执行恢复。5.2～5.5客户端状态不变，M11尚未完成。真实累计预算仍838/401，本步71/80，当前允许增量仍0/0。
