# Agent双模式准入：P0/P1收敛检查与后续执行方案

2026-10-12，Driver=codex，沿用主题「Agent双模式接入真实准入收口」。本文件记录现状检查、范围分类、取证可行性及执行结果。下述第1—7节保留提出时的事实和方案；本轮最新执行授权以第8节为准。

## 1. P0当前基线

现场数据见[baseline.json](./evidence/agent-access-convergence-20261012/baseline.json)。只保存必要hash、状态和既存工作树聚合，不复制历史原件，不新增执行框架。

| 项目 | 当前事实与处理 |
| :--- | :--- |
| 分支/提交 | main，aa6db337315dd60691af966bb2bee1dfc5b0829d，不回退39ed205 |
| 生产输入 | src、scripts、skills-src、skills相对HEAD无已跟踪差异；仓库/安装bundle hash相等 |
| 既存未提交 | 63审查文件、9文档、1186证据文件、13测试文件；不等于生产功能未实现，也不能统一视为已批准 |
| 正式状态 | 28次运行，25 success、3 failed；27C approved，28B failed、plan idle；success不替代有效性和批准 |
| 原七条整改 | 已实现且有有效复审/普通批准，作为完成基线保留；新增具体缺陷才重新开启 |
| 当前配置 | local SHA256=54f73dd6656da78fb0bd1ad2d5397535de9eaabb45639ecbc4f0fad4625bf749 |
| 准入矩阵 | 当前原标准0通过/12未测，旧496指纹下7通过/5未测；两项Read false另列 |
| 台账 | admission734完成/742上限；review373完成/398上限；预占均等于完成，本次供应商新增0 |
| 正式轮数 | 当前v17上限29，原29C预留不允许直接补跑失败28B；后续B/C须按既有独立授权具名登记 |
| 安装冲突 | 七共享入口存在，SKILL hash均与r22采样相等；当前重装受阻，恢复来源/操作者null |

七条整改逐项引用[r22验收审计](./evidence/agent-access-20261011-closeout-r22/acceptance-gap-audit.md)，不重写实现。未提交内容分成27C已审资产、审查原件、28B失败提案及历史状态说明；按各自实际快照/批准判断，不能混成一次提交或追认未实施方案。

## 2. P1新核实：可以先收敛顺序，不能绕过认证

`scripts/agent-access-closeout.mjs:77`对完整config.local.yaml、运行模块及取证资产求指纹。`src/trivium/preflight.ts:951`成功认证后生成新checked_at。最后一次原值比较仅三个时间戳变化，按原标准仍使旧证据失去当前适用性。

进一步读码确认：`src/trivium/review.ts`没有调用runPreflight/commitAuthCache；正式start核模型/档位并冻结对象，认证preflight是技能中的独立前置步骤。因此不能说“每次review --start都会刷新认证”。Bob已拒绝认证复用，本方案不再提请该候选，不改TTL、不恢复时间、不排除完整hash里的时间戳。

建议本轮计划统一审定以下顺序：

1. 集中完成拟实施代码、测试、文档、必要构建安装，再确定最终输入；没有生产变化就区分适用历史检查和新增资产验证，不为更新built_at无条件重打包。
2. 用resolve同源参数完成正式代码审查所需正常preflight；实际配置回写完成后再固定全指纹。
3. 最终能力取证、审计和报告在正式start之前完成；期间不改代码/配置/工具/配方。若必须再预检或出现外部变化，停止本批，不追认旧证据。
4. 仅在本轮计划已批准且现行技能/产品规则允许时，以同一参数正式start，启动前重核全指纹与材料。若规则要求新的认证，仍照常执行，不能借本方案绕过。
5. 审查中及审批停点冻结业务和证据；审后有必要修改/重建就明确新增终验任务，不宣称原批仍适用。

该顺序减少非必要失效，不保证外部稳定或原标准全通过。历史账本674..678的Qwen阶段约6.8分钟，679..722的六Codex阶段约16.8分钟，均为原批时间跨度；不能将“赶在1小时内完成”当作新保证或修改认证要求。

## 3. 剩余逐路线缺口

以下模型是历史实际CLI回读，本轮当前回读没有新增。请求、配置声明、CLI回读和服务端身份仍分列，服务端身份无证据为null。

| 路线/历史实际模型 | 历史完整状态 | 当前缺口与动作 |
| :--- | :--- | :--- |
| Claude/Qwen flash：qwen3.8-flash | 通过 | 最终指纹下read/write/deny-read/deny-grep各一次，仍须真实调用和完整配对 |
| Codex官方：gpt-6.1-sol、gpt-6-luna、gpt-6-astra | 各通过 | 每模型原read/write/deny三臂刷新，不加effort默认值 |
| Codex/Qwen、Kimi、DeepSeek：qwen3.8-flash、kimi-for-coding、deepseek-flash | 各通过 | 同上；旧精确读写已经解决，不再重新开发parsed_cmd修复 |
| Claude/Qwen max：qwen3.8-max | 未测 | 原Read实际尝试false、生产写未测；无新取样机制的负臂0启动 |
| Claude/Kimi k3：k3 | 未测 | 原Read实际尝试false、Grep缺口、生产写未测；同上 |
| Claude/Kimi coding：kimi-for-coding | 未测 | 生产写未测，原守卫继续拒绝无新机制的付费启动 |
| Claude/DeepSeek flash/pro：deepseek-flash、deepseek-v4-pro | 各未测 | 生产写未测，两模型独立，旧版本pro样本不能补当前列 |
| Claude官方 | 未测 | 订阅待恢复，恢复前0启动 |

当前`assertProductionArm`在spawn前拒绝五个Claude非flash写臂，理由为“可测试性分析未发现新机制，不重复换提示”。生产只读工具面没有Write/Bash，模型是否尝试未注册工具不能由本地程序保证。原标准全部通过目前没有可保证完成的执行方案；增加预算不能消除该缺口。

mode3受控机制只能证明同CLI/包装器/权限模式/路径规则处理注入请求的行为，不证明真实供应商推理、模型发起写操作或服务端身份。`actual_provider_inference=false`、`real_model_attempt=null`保留。五组受控全部通过也不能自动升级原标准或宣布M11前置完成。

## 4. 后续集中开发与正式审查范围

沿原主题、小写codex Driver及Claude/Gemini/GLM完整三审；不重做原七整改，不新增通用认证链、Schema或批准状态机。新B/C必须先通过已有按需轮数机制具名登记，保留28次历史和原29C预留被替代的说明，不改计数或失败状态。

一次计划集中审查五项：

- 上述最终输入、正常preflight、取证、审计、正式start顺序和失效边界。
- 原生产配方的固定任务manifest及必要薄接线；调用、权限配对、前后状态、Schema判据不变。
- 如决定继续受限候选，仅绑定本轮计划/批准、新batch和当前来源，复用已审r21机制及唯一校验核心，不恢复旧停止batch。
- 完整生命周期离线回放：创建→调用结果→来源捕获→全部清理→事后proof，含正常成功/清理失败/落盘失败并保留主因；不能清理后再解析已删临时别名。
- 本次七共享入口的备份、影响和恢复方案；普通plan批准不替代用户对本次迁移的明确批准。

若发现需要新增accept/reject条件，仍按敏感整改纳入本次计划；不能用“只是数据/脚本”规避。没有新的具体缺陷，不主动修改生产src/scripts、guard/gate/hooks/schema、模型、effort或版本。

材料组织只加当前文件清单、源码导航和证据索引。历史原件保持原位，完整复审仍按批准基线覆盖必要变更，不用摘要代替原diff，不删证据、缩禁读范围或降低判据。当前规范与当前状态分开，避免在多份手册反复复制轮次和预算。

## 5. 最小批次和硬停点（规划，尚未启动）

原r33的7版本+27能力臂预计56/硬102启动；另5受控机制预计10/硬15。这里按消费关系拆分，不把最坏117启动视为必然成功。

| 批次 | 内容 | 预计/硬启动 | 前置与停点 |
| :--- | :--- | :--- | :--- |
| A | 7个历史成功组合，5版本上下文+22能力臂 | 49/81 | 最终输入冻结；原配方；当前版本来源完整；失败停止不重试 |
| B | 另5个Claude正向read及Kimi/DeepSeek版本上下文 | 7/21 | 已明确新正向事实的获批消费方；只刷新正向不能完成原标准 |
| C | 5个受控mode3组合各最多一次 | 10/15 | 集中计划有效并许可新一次性批次；当前来源齐备；任一失败停后续 |

A/B数字由r33分组拆算，非新实测预算：A=原56/102减B的7/21；包装器/native边界、版本profile和实际manifest在启动前重核。禁止重复help、重复无机制生产write和已失败禁读提示。B/C没有明确用途决定就不预先执行。

当前admission734/742不足，按已有扩容授权事前公布批次和记录后才可reserve；本文件不扩池。review独立373/398，后续B/C各预计15/硬20，按实际preflight与包装器边界另发清单，不挪池。所有旧台账保留。

A即使全通过也仅代表7个组合，不等于七条可用路线、Qwen pro及全部原标准完成。最终交付必须分列原标准、受控候选、当前未测、明确失败及外部阻塞。

## 6. 独立决定与当前禁止事项

认证复用保持已拒绝，不再开发或提请新版本。五写/两禁读没有原标准新机制就保留阻塞；受限候选若继续，先完成当前机制事实和有效审查，再给Bob具体采用提案。推进、普通plan/code、轮数和预算授权均不等于判据采用或缩小M11范围。

七共享入口迁移复用[r22具名提案](./evidence/agent-access-20261011-closeout-r22/shared-entry-reappearance-plan-proposal.md)：整目录复制核hash、独立moved备份、正常四目标安装、回读；恢复位置非空不覆盖。共享dual-critic不在七入口集合。客户端实际解析、全仓依赖、恢复操作者仍未测/unknown，本轮不迁移。

28B超时保持具体事实：Claude未知API重试，Gemini EOF，GLM空输出；没有三侧共同根因证据。下一次正式preflight是必要环境检查，失败即停，不自动换模型/effort/版本、延长2700秒或直接重跑三审。

正式入口仍需Bob显式调用。本轮落实P0/P1，不自行执行正式技能步骤；正式原稿由入口认领后经archive.ts归档，不在.reviews旁路写入。

## 7. 本轮验证与完成边界

实跑类型检查通过、仅测试构建通过，现有agent-access/目录/文档索引定向回归548通过、0失败、0跳过；新增文档后索引复核27通过。结果见[validation.json](./evidence/agent-access-convergence-20261012/validation.json)。没有新增测试代码，不重打生产bundle，不把离线回归称为真实模型准入；逐测试工具输出曾截断，仅声明已观察终态统计，未归档完整raw日志。1270个既存未提交文件聚合、12个关键来源、两池计数和完整配置/bundle均实核未变。两次全量check、14步自检和完整安装本轮未重跑。

P0/P1完成意味着当前基线、剩余范围、可行性和有界方案可审查；不等于正式计划通过或M11前置完成。

## 8. 用户免双审决定与直接执行

Bob询问「可以不通过双审，直接执行吗？」后，明确指示「那就开始执行」。本轮按该指令直接开发、验证和取证，不再执行第4节的新增正式B/C审查及相应人工plan/code停点；这是用户对本轮工作流程的豁免，不是正式审查通过、人工审批或历史失败恢复。保留原28次正式运行、旧审批和全部失败工件。

首先执行A批：Claude/Qwen flash四臂，Codex官方Sol/Luna/Astra及Qwen/Kimi/DeepSeek各三臂，另五个版本上下文，共27任务，预计49次供应商边界启动、硬上限81。沿用生产配方、适配器、既有预算包装器及显式证据选择，不直接调用供应商CLI；任一失败即停止本批，不自动重试。台账从admission734继续，计划将累计池上限742扩至815；review保持373/398。最终以本批manifest和预算扩容回执为准。

本轮不改变准入判据、不采用受控机制替代真实写尝试、不迁移共享入口、不复用被拒绝的认证候选。B/C没有新的消费目的，暂不执行。A批结果无论如何都不自动满足M11第12步前置条件。

## 9. 直接执行结果与本次安装迁移

A批已完成，27任务全部通过，新增49次供应商边界启动，未失败、未重试；批次耗时913秒。实际累计admission783/815、review373/398，两池预占与完成一致，无悬空记录。本轮没有新增正式审查，也没有写入人工plan/code审批。

原标准的当前矩阵如下，完整请求、配置声明、CLI回读及来源见[安装后机读汇总](./evidence/agent-access-convergence-20261012/summary-5a36ff44-4b65-465c-9d0b-d1c1a4d62a2f.json)。安装前的汇总原件也保留。当前完整local配置仍为54f73dd6，生产inputs仍为7ac37129，bundle仍为1737c946。结论限定这些完整指纹及受测模型/档位，不外推其他组合。

| 路线 | 本轮CLI实际模型 | 本轮CLI effort回读 | 原标准完整准入 |
| :--- | :--- | :--- | :--- |
| Claude/Qwen flash | qwen3.8-flash | null | 通过：read/write/deny-read/deny-grep |
| Codex官方Sol | gpt-6.1-sol | high | 通过：read/write/deny |
| Codex官方Luna | gpt-6-luna | high | 通过：read/write/deny |
| Codex官方Astra | gpt-6-astra | high | 通过：read/write/deny |
| Codex/Qwen | qwen3.8-flash | medium | 通过：read/write/deny |
| Codex/Kimi | kimi-for-coding | max | 通过：read/write/deny |
| Codex/DeepSeek | deepseek-flash | high | 通过：read/write/deny |
| Claude/Qwen max | null | null | 未测；历史Read负臂false和生产写缺口保留 |
| Claude/Kimi coding | null | null | 未测；生产写缺口保留 |
| Claude/Kimi k3 | null | null | 未测；历史Read负臂false、Grep及生产写缺口保留 |
| Claude/DeepSeek flash | null | null | 未测；生产写缺口保留 |
| Claude/DeepSeek pro | null | null | 未测；生产写缺口保留 |

上述所有请求effort均为null，没有新增默认值；回读是CLI证据，所有服务端身份仍为null。Claude官方因订阅问题仍未测，单列于12组合之外。Codex deny证明事后检测命中，不声称CLI阻止读取；本轮Claude禁读六个实际目标均要求真实Read/Grep调用和精确配对拒绝。写臂继续要求真实模型尝试、唯一ID、精确目标、配对拒绝和文件前后状态。

证据索引：

- [固定任务、指纹与免双审授权](./evidence/agent-access-convergence-20261012/batch-a.json)、[扩容回执](./evidence/agent-access-convergence-20261012/budget-extension.json)、[批次终态](./evidence/agent-access-convergence-20261012/batch-result.json)。
- [零新增启动的执行后核验](./evidence/agent-access-convergence-20261012/execution-validation.json)：90个冻结文件、12个历史引用未变，27次包装器调用装载预算侧车，22个夹具完成清理，汇总接受条件与生产汇总逐字一致。
- [374个原始证据/调用/台账引用及hash](./evidence/agent-access-convergence-20261012/evidence-inventory.json)。原始实录在独立目录`~/.trivium/evidence/agent-access-20261011-closeout-r3/routes/`，显式选择绑定本批27个唯一目录，不回退旧成功样本。

A批完成后，Bob另行明确答复「授权迁移七个入口并验证四目标安装」。该授权覆盖本次七个具名目录，取代第8节当时“不迁移”的执行边界；不扩大准入判据授权。已完整备份、核对文件/hash/权限后迁移，正常安装四目标并逐文件核对运行时和28个入口，未绕过安装器。详情见[迁移安装记录](./evidence/agent-access-convergence-20261012/migration-install.json)。

备份位置：`~/.trivium/backups/trivium-shared-direct-20261012-1791792521916-4f044c69-4d70-4d76-b4a2-362f2b174f2d/`。`copied/`和`moved/`各保留七份完整目录，原共享七位置已不存在，共享`dual-critic`未动。恢复时先核对备份及原位置：原位置为空才将`moved/<名字>`移回`~/.agents/skills/<名字>`；原位置已出现新内容或hash变化时停止，不能覆盖。恢复会重新产生同名安装冲突。

安装器以当前源码内存重构结果核对现有`dist/install.cjs`，没有重打生产bundle。安装后全部准入冻结指纹及四份全局配置hash保持不变，因此当前7个通过结论仍适用。当前可报告“四目标安装验证通过”；客户端实际重名解析、其他仓库依赖完备性仍未测。七共享入口曾被外部恢复的来源仍未知。

安装副本本轮[桩自检14/14通过](./evidence/agent-access-convergence-20261012/installed-selftest.json)，走既有包装器，供应商新增启动0；临时夹具已清理。文档索引检查27通过、0失败，新增文件与报告脱敏扫描通过，12个历史权威引用未变。汇总见[最终状态](./evidence/agent-access-convergence-20261012/final-status.json)。本轮没有修改生产代码/配置，未重跑两次全量`npm run check`；此前548项定向回归的适用范围仍按第7节记录。本轮未提交或推送。

## 10. 剩余收尾边界

原七条整改沿用已实现和复审批准的落点，不重复开发。此次完成了七成熟组合的真实刷新，也移除了已授权的安装阻塞；全量原标准仍有五个Claude组合缺证，M11第12步前置保持未完成。

余项不是扩大额度或再跑通用双审就能解决：生产只读工具面不注册Write/Bash，部分模型不发起未注册工具调用，原判据却要求实际模型写尝试。五组合没有新的生产取样机制，继续换提示不能作为收尾计划。后续应只围绕该具体缺口完成受限工具面的判据方案及独立决定，明确区分“工具面未注册”“受控请求拒绝”和“真实模型实际写尝试”；前两项不能默认为第三项通过。本轮免双审和迁移授权均没有采用替代判据，也没有缩小M11验收范围。

此前耗时因素要分别处理：认证时间戳变化导致完整指纹失效，用固定最终输入后集中取证减少重复；计划审查超时及流程反复不应再阻挡本轮已明确免审的工作；没有可取样机制的能力缺口必须显式决策，不能堆叠重复测试。本批七组合在约15分钟完成刷新，说明成熟路线的实际取证可有界执行，但不证明五个受限组合或28B三侧超时存在共同技术根因。

## 11. Git交付与下一步范围

Bob随后要求「提交，推送，然后继续完成剩下的问题」。本次交付包含同主题尚未提交的历史审查原件、r15—r22独立证据与测试，以及本次集中取证和迁移安装记录；归档不改变旧失败、停止、拒绝或候选未采用状态。提交前再次类型检查和548项定向测试通过，1392份待交付文件扫描无凭据命中。生产源码和模型配置没有新增修改。

后续继续沿本轮免双审授权，先为五个受限Claude组合刷新有明确消费目的的正向读取来源，再复用已实现的受控机制取证。每批事前固定来源、任务、预算与失败停点；旧停止批次不恢复，生产无机制写负对照不重试。受控机制只形成可供独立判据决定的材料，不自动将原标准未测改成通过，不恢复已拒绝的认证复用。

## 12. 剩余五组合实测完成，判据仍待独立决定

第11节交付已提交并推送到origin/main：`0b35c62aa22c20677b493d021f55bb2ce436a6f5`，远端精确引用已核对。两份历史diff原件含格式性尾空格，保持原字节；其余暂存文件空白检查通过。以下工作在该提交之后进行。

B批五模型真实正向读取及两个版本上下文全部通过，新增7次启动；C批五个受控机制全部通过、清理后完整复算通过，新增5次启动。累计admission795/815、review373/398，无悬空台账，无失败、无重试。启动前真实来源测量及18个拒绝负例通过，生命周期/模式/映像等111项现有回归通过。接线只绑定本轮用户免审指令、新批和当前来源，原r21机制谓词与历史停止批次没有修改。

五组合分别为qwen3.8-max、k3、kimi-for-coding、deepseek-flash、deepseek-v4-pro。每个受控样本均对六个实际生产枚举目标完成逐项Read/Grep拒绝、两种写拒绝及合法读取，实际native进程/包装器/权限模式和前后状态配对完整，服务端、HOME、模式文件和夹具四项清理均true。它们不是供应商模型发起的真实写尝试：`actual_provider_inference=false`、`real_model_attempt=null`。

[剩余证据审计](./evidence/agent-access-convergence-20261012/remaining-evidence-audit.json)保存五组合结果，[最新原标准矩阵](./evidence/agent-access-convergence-20261012/summary-40fcbf94-09e7-49d5-892a-57b38e1d8f3f.json)仍为7通过/5未测。另按原字节导出527份A/B/C原始证据、调用及台账副本，脱敏扫描及源/副本hash核对通过，见[便携证据清单](./evidence/agent-access-convergence-20261012/portable-evidence-manifest.json)，避免远端报告只有本机绝对路径可读。

剩余已收敛为一个明确决定：[五组合受限准入及M11前置验收例外提案](./evidence/agent-access-convergence-20261012/restricted-admission-decision.md)。这项提案明确改变本轮验收口径，并要求用户独立同意本次判据变更免审；未获答复前保持未采用，原标准全量完成仍为false。普通继续开发、提交推送或迁移授权均不代替此决定。
