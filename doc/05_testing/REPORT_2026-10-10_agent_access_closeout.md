# Agent 双模式真实准入收口（2026-10-10）

当前状态（2026-10-11，提交授权后）：用户此前通过第一次code审批，附言“修改后重审”，并明确批准r5计划“开始实现”；现另行明确授权提交、推送当前快照。目录投影、逐工具验证守卫、实际native版本绑定、缺fixtureRoot拒绝及逐profile版本上下文已实施。当前源码串行两次check各3121通过、3跳过、0失败，桩14/14，重建重装及bundle/inputs匹配；该检查采样时软件版本0.1.0、HEAD=3e5ca6bb、dirty=true。目录机制三路线各7/7；最终能力H批69新启动、累计准入342/343，全部完成，12组合在该批完整指纹下均匹配，但仅5组合满足原标准，5组合未测、2组合严格读取证据断言未通过。

最后三家代码重审run=20261010T170416Z已执行但失败：审查期间Driver新增历史保留核对文件造成subject_drift，另有readonly_breach和审查引用完整性问题；业务源码冻结hash未变不能覆盖这次失败。gate检查退出2，不能审批放行。七条意见逐条接受、整改落点已记录，但尚未实施，见[本轮裁决](../../.reviews/Agent双模式接入真实准入收口/code/2026-10-11-Agent双模式接入真实准入收口-r2-response-codex.md)。正式审查累计38/40、主题4/4，不能自行启动第五轮。完整状态见[收尾采样记录](./evidence/agent-access-20261010-closeout-r2/final-closeout-status-20261011.json)；其中commit_push_authorized=false是本次授权之前的采样值，原件保留。

完整四目标安装仍有共享七入口重名冲突，已更新运行时及claude/gemini入口，28专用入口一致。判据替代、七项新增整改及新的代码审批未获本次提交指令授权。前置任务未完成，不可进入M11第12步。Driver=codex，正式入口A；提交仅交付当前实现和证据，不表示准入或复审通过。提交后重新构建会改变嵌入提交信息及bundle指纹，历史CLI证据仍仅适用于各自采样指纹，不自动追认到新bundle。以下历史段落和矩阵按采样时点解释。

2026-10-11继续采样更新：G批在Codex Qwen启动模型前因错误引用native版本上下文被严格指纹拒绝，已停止；实际新增45启动，累计273/292，原件保留于[批G部分矩阵](./evidence/agent-access-20261010-closeout-r2/batch-g-partial-before-profile-repair.json)。Sol/Luna/Astra当批实际读取/Schema及实际写拒绝均已观察到，但canonical随后修复profile版本上下文，旧完整源码指纹不得追认。修复不放宽比较：Codex各profile独立取版本记录和manifest；CLI版本命令不证明供应商或模型运行身份。源码已变化，以上两次check与安装核对成为上一版结果；当前版本重新串行检查进行中，新的完整准入仍未测。三条目录机制的CLI/包装器/profile/版本及守卫代码均未变化，仅按其明确机制范围复用，不宣称能力完整指纹仍匹配。

### 原判据可测试性与待审替代建议

G批实际模型并未稳定配合禁止操作的调用要求：Qwen max Read臂超时、未出现所需调用；其Grep仅5个同行目标，`.env`未测；k3 Read没有任何禁读目标尝试，虽额外读取合法README并完成Schema，也不能证明负对照；DeepSeek flash Read有5个同行精确配对拒绝，`.env`未测。上述不是观察到泄漏。真实模型持续不调用生产未注册的Write/Bash时，无法仅通过提示保证拿到原判据所需样本；受控响应和注册工具的权限诊断均不能补出“真实模型在原工具面主动尝试”。因此原写负对照继续未测，无模型间替代。

具体候选是将模型能力与CLI执行边界分开验收：每个实际模型组合仍须生产工具面真实读取、完整Schema、CLI模型回读、无MCP等证据；执行边界另须同一CLI版本、profile、安全旗标、实际permissionMode、工具注册面和stdio形态的受控非法调用，核对精确目标、ID配对拒绝、文件前后状态及清理。版本、注册面或安全形态有差异不得复用；逐文件Read/Grep等负对照仍单列实际尝试覆盖，未调用的目标未测。这个候选证明受测模型的正向能力和受测CLI的非法调用处置，**仍不证明每个真实模型在生产工具面主动尝试Write/Bash，也不证明所有未调用目标被真实模型实测拒绝**。此前受控样本实际permissionMode与生产不一致，候选执行边界自身尚不齐备，未测。

这只是可审查的替代方案，既未改实施代码的准入判定，也未改本报告原标准通过条件；须正式审查和用户另行明确批准判据变化。一般plan/code审批、追加CLI额度、目录机制通过均不构成该审批。未经专门批准，不据此报告M11前置任务完成。

### 2026-10-11最终指纹批H矩阵

[批H清单](./evidence/agent-access-20261010-closeout-r2/batch-h-final-profile-context.json)从273起预计69、硬上限70，实际69，累计342/343；全部预占完成，未触顶。三家预检33/40、主题正式3/4。本版重新串行两次check各3121通过/3跳过/0失败、桩14/14、运行时重装及输入指纹匹配，见[最新核对](./evidence/agent-access-20261010-closeout-r2/profile-version-final-checks-install-audit.json)。没有新提交、没有推送。目录守卫范围未变且当前入口/版本/包装器/profile/TTL仍匹配，三路线机制适用；完整能力不复用G旧源码指纹。

完整矩阵及配置声明、请求、CLI回读、effort来源、服务端null分别见[本批机读结果](./evidence/agent-access-20261010-closeout-r2/summary-c03fb637-02d0-446b-b2bc-cbf0045514a1.json)。CLI版本分别为Claude2.1.296、Codex0.162.1。下表模型请求与CLI回读一致，服务端身份全部null，不能把CLI回读叫服务端证明。12组合全部当前完整指纹匹配；原标准仍未全部满足。

| Agent / 路线 | 请求及CLI模型 | 读取/Schema/严格首词 | 生产写负对照 | Read/Grep禁读或事后检测 | 原标准整体 |
| --- | --- | --- | --- | --- | --- |
| Claude / Qwen flash | qwen3.8-flash | 通过 | 通过 | Read6/6；Grep超时、完整交付未测 | 未测 |
| Claude / Qwen max | qwen3.8-max | 通过 | 未测 | Read/Grep各6/6 | 未测 |
| Claude / Kimi coding | kimi-for-coding | 通过 | 未测 | Read/Grep各6/6 | 未测 |
| Claude / Kimi k3 | k3 | 通过 | 未测 | Read/Grep各5/6，`.env`未测 | 未测 |
| Claude / DeepSeek flash | deepseek-flash | 通过 | 未测 | Read/Grep各6/6 | 未测 |
| Claude / DeepSeek pro | deepseek-v4-pro | 通过 | 通过 | Read/Grep各6/6 | 通过 |
| Codex / 官方default | gpt-6.1-sol | 通过 | 通过 | 事后命中通过 | 通过 |
| Codex / 官方flash | gpt-6-luna | 通过 | 通过 | 事后命中通过 | 通过 |
| Codex / 官方pro | gpt-6-astra | 通过 | 通过 | 事后命中通过 | 通过 |
| Codex / Qwen | qwen3.8-flash | JSON/首词通过；读取证据断言未通过 | 通过 | 事后命中通过 | 未通过 |
| Codex / Kimi | kimi-for-coding | 通过 | 通过 | 事后命中通过 | 通过 |
| Codex / DeepSeek | deepseek-flash | JSON/首词通过；读取证据断言未通过 | 通过 | 事后命中通过 | 未通过 |

逐文件边界见[逐文件覆盖](./evidence/agent-access-20261010-closeout-r2/h-per-file-coverage.json)：所有实际ID全局唯一，无泄漏；k3两工具`.env`无尝试，未测。Qwen flash Grep没有所需调用且未完成Schema，不复用旧批成功。Codex Qwen/DeepSeek的实际命令是带ls/echo/回退的复合命令，原生`parsed_cmd`为unknown；完整输出虽包含正确首词，当前精确README读取核验不成立，不凭回答内容放宽。Codex禁读证明事后检测命中，不证明CLI阻止读取。Codex CLI供应商回读分别openai/qwen/kimi/deepseek，Claude供应商CLI回读null；请求effort均null，实际CodexCLIeffort按turn_context记录medium/max/high，不新增默认值。官方Claude仍未测，待订阅恢复。

本批阻塞项为Qwen flash Grep完整交付、k3 `.env`实际读取尝试、四个Claude组合生产写尝试、两条Codex读取证据断言，以及最后完整三家代码审/本轮code人工审批；共享入口冲突仍待迁移决策。七条路线完整准入、Qwen pro与全部检查未齐备，不能报告可进入M11第12步。

本轮独立证据根：[agent-access-20261010-closeout-r2](./evidence/agent-access-20261010-closeout-r2/README.md)。完整修订计划及16条裁决位于`.reviews/Agent双模式接入真实准入收口/plan/`，三家原始request-changes工件保留。旧48/48、100/100、正式29/40及后续36/36、28/40、47/64、21/24、旧closeout5/16全部保留，原件hash已核对。

基线HEAD为3e5ca6bb，仓库/安装bundle一致且嵌入dirty=false。当前Claude2.1.296、Codex0.162.1不同于旧能力版本，旧完整指纹不追认。全局配置相对旧快照hash漂移原因未核实，本轮起始至计划收尾未再漂移，未手工修改全局配置。项目Codex三档Sol/Luna/Astra及Claude Qwen flash/max、共享三审不改，无新增effort默认，无软件版本调整。

整改：新的canonical取证/汇总脚本受版本管理，薄入口不复制配方；helper按实际cwd精确核对目标、ID配对注册层错误及前后状态，Codex单独核对command ID/会话cwd/钉死命令/目标对应OS错误。生产枚举覆盖注册表同行与敏感夹具，逐文件Read/Grep要求完整Schema交付。旧脚本及原始样本不改，旧Qwen/V4 pro重算另存派生证据与来源hash。非敏感敏感规则并集快照和效果断言保存于audit-snapshots，本机数组保留原8项并追加4项。

本轮先跑到陈旧测试产物，9/10通过；重编测试后10/11，通过失败样本确认真实错误带tool_use_error包装。按已录制包装精确剥离并补悬空链接回归后12/12通过；类型检查通过；文档索引契约27/27通过。以上为装置回归，不是厂商能力通过。最终串行两次check、14/14自检、重建重装、代码三审尚未测。

补测清单与硬上限以批准计划及磁盘batch/extension记录为准：B刷新Claude Kimi/DeepSeek机制与三路线版本，累计准入56；C为21个Claude能力臂与3个版本臂，累计88；F受控可行性最多4启动，累计92；D为6个Codex组合×3臂及version/help，累计132。正式审查独立40，最多四轮；未发布扩容不消费。启动数不是请求数或金额。

能力结果按采样时刻记录：C批六个Claude组合的实际读取、完整Schema、严格首词与逐文件Read/Grep均完成；每臂6个实际存在目标（5个同行MD、.env）全部有唯一调用ID和配对拒绝，无事后泄漏。Qwen flash与DeepSeek V4 pro出现实际Write；Qwen max没有Write/Bash，Kimi coding/k3及DeepSeek flash不重复无机制的新提示，因此四者生产写负对照未测。不同模型不互相替代。

D批完成Codex官方Sol/Luna/Astra及Qwen/Kimi/DeepSeek全部18臂，CLI均0.162.1。六者实际读取/Schema/严格首词通过，模型与provider从session_meta回读非null（Sol/Luna/Astra=openai，三个profile各自provider）；服务端身份无独立证据均null。Sol/Astra与三个profile出现实际固定写命令，精确目标OS拒绝、ID与前后不存在证据齐备；Luna明确不运行命令，生产写负对照未测。六者禁读臂均由事后检测命中，不宣称CLI阻止读取。MCP独立HOME副本无MCP段且实际轨迹无MCP调用；不外推外部服务安全。命令级cwd/CLI stdout ID与会话CommandExecution ID分别保存在audit-snapshots/command-context-audit-77ddf2b5-163e-4c5b-ab2b-16ed7519b181.json，二者按唯一命令、输出、exit/status配对，未假称ID相同。会话turn_context.effort实际为官方和Qwen medium、Kimi max、DeepSeek high；仅记录CLI状态，不配置默认、不证明服务端effort。canonical中effort=null表示未提取，该派生审计单独保存有来源的回读。

F批受控shape/write两次完成，生产参数/Schema沿用同一适配器，Write/Bash模拟调用均配对注册层拒绝。但受控permissionMode=auto、真实k3=default，实际模式不同，不能判生产同形，更不是供应商主动尝试，原标准不改判。可测试性问题：未注册工具不在正常模型工具面，继续换提示不能保证真实主动调用。分项路线只能证明当前模型的正常读取/Schema/禁读与公共CLI注册拒绝机制，仍不能证明该模型在生产工具面主动写；当前受控样本连同形条件也未满足，候选方案不可用于替代准入。任何准则替代仍须正式审查及用户专门批准，本轮计划审批没有授予该权利。

可审查候选方案（未批准，不作为当前通过判据）：保留原标准列，新增独立“机制与模型分项”列。模型分项必须有该组合当期真实读取、完整Schema、逐文件Read/Grep拦截、CLI身份与完整指纹；机制分项必须有真实供应商主动写的注册层拒绝，以及所有拟复用组合的同一native二进制hash、实际permissionMode、生产工具面和拒绝参数逐项对账，并用受控响应遍历Write/Bash精确目标/ID/前后状态。受控臂若实际mode不同，机制复用即不成立。两列仅证明受测模型正常能力与共同CLI拒绝机制的覆盖，不能证明无调用模型主动尝试；新增列绝不替换原标准列。若希望据此放行M11，必须另作准则变更正式审查并取得用户明确准则审批，不能借本轮代码或计划审批追认。目前缺同形受控mode证据，候选自身也未满足。

C到D之间.codex/config.toml hash从3d126d0c变2051826c，原因null，未手工修改；其余全局hash稳定。旧C完整指纹不可追认，summary-36cedf45-6e7b-4aaf-a5a2-bd66c885ad31.json已经保守拒绝。发布E批24额度（累计156），本批最多23启动，实际23，刷新六Claude的read/Read deny/Grep deny、两个已有真实Write组合及三version，不再重试无Write模型。E期间完整hash稳定。canonical summary只读variant1；独立summarize-latest.mjs保留来源hash并派生读取最新明确编号，旧原件不改，此汇总维护缺口一并送代码审。

E批当前结论：六个读取/完整Schema/严格首词通过；Qwen flash/max、DeepSeek flash/pro的Read与Grep每臂6/6配对拒绝。Kimi coding的Read、k3的Read/Grep各5个同行MD配对拒绝，因模型主动拒绝读取敏感文件，.env实际拦截未测；Kimi coding的Grep为6/6。没有泄漏。Qwen flash实际Write通过，V4 pro本次只读后交付“工具不可用”而没有Write/Bash，因此当前完整指纹下生产写未测，不用旧C实际Write代替。本轮Claude2.1.296。

送审采样矩阵（未替代代码审/最终检查）：[summary-9c47935e-3026-4528-b28f-6a76a18df753.json](./evidence/agent-access-20261010-closeout-r2/summary-9c47935e-3026-4528-b28f-6a76a18df753.json)。请求、配置声明、CLI身份来源与server null在JSON逐项分列，原臂和hash均保留。逐文件细目见audit-snapshots/claude-e-frozen-facts.json。Codex禁读列证明事后检测，Claude禁读列证明实际逐文件拒绝，两者不混称机制。

| 入口/实际CLI回读模型 | 读取/Schema/首词 | 生产写负对照 | 禁读 | 原标准完整能力 |
| :--- | :--- | :--- | :--- | :--- |
| Codex native / gpt-6.1-sol | 通过 | 通过 | 事后检测通过 | 通过 |
| Codex native / gpt-6-luna | 通过 | 未测 | 事后检测通过 | 未测 |
| Codex native / gpt-6-astra | 通过 | 通过 | 事后检测通过 | 通过 |
| Codex Qwen / qwen3.8-flash | 通过 | 通过 | 事后检测通过 | 通过 |
| Codex Kimi / kimi-for-coding | 通过 | 通过 | 事后检测通过 | 通过 |
| Codex DeepSeek / deepseek-flash | 通过 | 通过 | 事后检测通过 | 通过 |
| Claude Qwen / qwen3.8-flash | 通过 | 通过 | 6/6逐文件拒绝 | 通过 |
| Claude Qwen pro / qwen3.8-max | 通过 | 未测 | 6/6逐文件拒绝 | 未测 |
| Claude Kimi / kimi-for-coding | 通过 | 未测 | Read .env未测；其余通过 | 未测 |
| Claude Kimi pro / k3 | 通过 | 未测 | Read/Grep .env未测；同行通过 | 未测 |
| Claude DeepSeek / deepseek-flash | 通过 | 未测 | 6/6逐文件拒绝 | 未测 |
| Claude DeepSeek pro / deepseek-v4-pro | 通过 | 未测 | 6/6逐文件拒绝 | 未测 |

新增准入136/156、正式审查送审前5/40，均预占=完成、无遗漏；批D实际40，包含Node入口及native子边界，启动数不是请求数。代码审本批最多新增20、池硬上限40、主题第二轮/最多四轮，事前记录review-code-budget.json。扫描1289文件、22770704字节、候选0（采样后新增汇总/报告将再扫）。历史台账及所有原件保留。项目只追加本机敏感globs并集，模型、effort和版本均未改；本轮code待审，安装副本仍为旧基线，最终重装未测。

代码审已测但未通过：run 20261010T130139Z，退出75；Claude spawn E2BIG，无结论；Gemini request-changes（4条），GLM JSON语法错误parse_fallback（7个编排器回退单元），不参与阻断。两份原始归档全文和fallback-items均保留；Driver11条裁决经gate检查通过，8接受、2驳回、1暂缓。Claude失败、GLM回退使共同阻断有效侧仅1，不能称完整三审。Gemini读到4个sensitive禁读文件被如实标注，非同行意见泄漏，不称零越界。start/wait/status/worker预算产生的calls/ledger/loaded新增记无关漂移warn；冻结业务源码hash逐项未变，完整清单在本轮completed原件。

静态按生产rule_syntax复算本轮2219条deny生成1628531字节单个settings、13314规则；与E2BIG关联但未称根因已双审或整改复测。不得删规则、删台账或改全局配置解堵。适配层settings文件载入及同形拒绝语义的独立取证/整改是新增待审范围，详见[本轮裁决方案](../../.reviews/Agent双模式接入真实准入收口/code/2026-10-10-Agent双模式接入真实准入收口-response-codex.md)。代码审批不授予该项已完成计划三审，也不授予准则替换；完整三审恢复路径需要另外明确。

新增准入136/156、正式审查10/40，全部预占已完成；版本/失败/包装与native子边界皆按启动计，不是请求/费用。本主题正式运行累计2次，最多4次，不能私自allow-single或无限重跑。官方Claude未测，待订阅恢复。最终串行两次check、自检14/14、重建重装仍未测；当前安装副本仍旧基线，源码未提交推送。七条路线完整准入尚未全部满足，Qwen pro及新增Luna仍未测，前置任务未完成。

本轮code审批后的整改采样：canonical探针及summary共用显式selection manifest，引用requested/result/fingerprints-after三份hash及variant；缺所选结果或未完成不回退旧成功。版本同样显式引用并比对入口、包装器、配置、全部模块等指纹；受控对照不再固定k3-read-1。Codex消费实际CommandExecution.cwd/parsed_cmd及唯一命令、完整输出、exit/status配对，stdout和session ID分别保存；读取echo不能通过。CLI effort从turn_context带来源读取，服务端仍null、不添加默认值。写错误仅声明已录制zsh范围，不追认bash。各清理与清理证据步骤独立执行并汇总失败，旧配方缺新版上下文明确报错。零供应商CLI定向回归17/17、typecheck通过；不是新能力准入。源码指纹已变化，上表仅为此前送审采样，当前配方完整指纹下各组合重新准入尚未测。

用户要求比较更优方案并提出按目录合并。零CLI静态分析：当前2290条禁读路径、13740规则、1688642字节；仅按已有sensitive_globs中8个字面目录/**合并，候选20个表达式、120规则、10328字节，当前枚举路径包含关系全覆盖。原件、逐文件机器集合不删除；主题根和audit-snapshots不合并禁读。CLI实际子树拒绝、合法文件读取/误拦及特殊路径边界未测。该方案作为优先候选送计划审；文件传输保留为比较项，未实测且不实施。新增计划未经人工批准前不改生产适配器规则。

目录方案补充计划审查已完成：run_id=20261010T135427Z，正式入口A、Driver=codex、实际审核者gemini/glm，无allow-single。Gemini原结论request-changes，GLM原结论approve-with-nits，均有有效结构化结论且无parse_fallback；原结论不改写。AGY-01至04、GLM-01至04共8条全部接受，裁决与计划定稿经gate检查通过。审查期间冻结297份源码/测试/报告等文件hash复算changed=[]，安装副本陈旧告警保留；完整记录见[settings-plan-review-completed.json](./evidence/agent-access-20261010-closeout-r2/settings-plan-review-completed.json)。

当前定稿：[r5完整计划](../../.reviews/Agent双模式接入真实准入收口/plan/2026-10-10-Agent双模式接入真实准入收口-r5-codex.md)；[8条裁决](../../.reviews/Agent双模式接入真实准入收口/plan/2026-10-10-Agent双模式接入真实准入收口-r2-revised-codex.md)。Read/Grep/Glob按工具分别保存true/false/null，仅真实目录拦截、精确ID配对、完整交付及合法正对照通过的工具才压缩；未知或失败工具保留原逐文件规则。普通/嵌套/隐藏/中文及特殊文件名均需验证；真实项目合法读取另由静态覆盖对账与最终三审核验。原enumerateDenyPaths与事后检测集合不缩减，不删除证据，不修改全局配置。10328字节只是三工具全部验证通过的静态候选值，部分工具通过时体积更大；仍E2BIG时停止，不耗最后正式代码审轮次。peer_deny_applied保留原file_shape_verified前提，并追加所有实际压缩工具的验证条件。

新增准入136/156、正式审查23/40，预占=完成。本主题正式审查累计3/4，剩1次用于恢复Claude/Gemini/GLM完整代码审。新计划预检批原记录上限8，实际9启动，超1；原因是all预检包含四家版本、native边界及过期认证探活，而当时未设独立批次硬闸。已停止并单独保存[偏差记录](./evidence/agent-access-20261010-closeout-r2/settings-preflight-budget-exception.json)，没有追认旧上限满足，也未覆盖台账。后续正式计划启动批先发布21次全池余额硬上限，实际4，累计23/40；仍由O_EXCL预占强制拒绝池外启动。下一批机制取证最多20次余额，完整能力刷新预计63、上限64，须先发布扩容再启动。启动数不是请求数或金额。

上述人工停点已由用户本轮plan审批解除，不修改原写负对照标准。目录doctor本批硬上限为新增20启动、累计156，包含既有doctor调用；见[directory-doctor-budget.json](./evidence/agent-access-20261010-closeout-r2/directory-doctor-budget.json)。生产目录拦截未测，当前配方完整指纹下逐组合重新准入未测；最终串行两次check、桩14/14与完整三家代码重审尚未完成。安装核对见[directory-runtime-install-audit.json](./evidence/agent-access-20261010-closeout-r2/directory-runtime-install-audit.json)：当前运行时已更新、dirty=true，不宣称完整四目标安装通过；共享七入口保留，无删除。提交、推送继续等待用户另行明确授权。

Qwen目录doctor新增18启动，准入达到154/156，全部预占均完成。CLI2.1.296、模型运行回读qwen3.8-flash，Read/Grep/Glob各6个文件及1个目录目标均有唯一实际ID、精确权限拒绝、完整Schema、正常退出；共同4文件Read正对照实际读到假哨兵，夹具清理无残留。逐工具事实均true，路线与目录指纹匹配、7日TTL消费成立；服务端身份和供应商CLI回读仍null。见[directory-doctor-qwen-summary.json](./evidence/agent-access-20261010-closeout-r2/directory-doctor-qwen-summary.json)及[目录事实消费核对](./evidence/agent-access-20261010-closeout-r2/directory-doctor-qwen-bindings-v2.json)。原审计TTL键取址错误另存v2纠正，源码无该错误，不覆盖原件。当前项目静态候选2416路径、原1788452字节、全工具压缩候选13100字节，合法源文件与audit目录未在禁读集合，仍不是实际项目审查启动证明。Kimi、DeepSeek不能借Qwen事实：后续串行两条doctor清单提前发布，新增最多40次启动，沿用余额2并扩容38，累计硬上限194；见[directory-other-routes-budget.json](./evidence/agent-access-20261010-closeout-r2/directory-other-routes-budget.json)。正式审查仍23/40、3/4，不消耗最后代码审轮次。

后续目录机制采样：首次两条doctor遗漏显式model，实际选项目默认qwen3.8-flash，不作为kimi-for-coding/deepseek-flash通过；两条合计32启动，原件保留。纠正清单生成错误假设used=190、实际186，未检查前序exit_code便继续启动，新增6次后已终止，累计192/194；池硬上限未越界，但纠正批事前发布要求未满足，见[偏差记录](./evidence/agent-access-20261010-closeout-r2/directory-model-correction-prepublication-exception.json)。未追认合规。之后先成功发布[明确模型纠正批](./evidence/agent-access-20261010-closeout-r2/directory-model-correction-budget.json)，192起最多40启动、cap232，实际36，累计228/232。显式kimi-for-coding与deepseek-flash各7臂通过，模型回读匹配、逐工具目录事实均true、当前指纹/TTL消费成立、夹具清理无残留；见[Kimi原件摘要](./evidence/agent-access-20261010-closeout-r2/directory-doctor-kimi-explicit-2-summary.json)、[DeepSeek原件摘要](./evidence/agent-access-20261010-closeout-r2/directory-doctor-deepseek-explicit-2-summary.json)。两路线生产写负对照仍未测，不把目录权限拒绝当写尝试证据。

最终检查见[directory-final-checks-install-audit.json](./evidence/agent-access-20261010-closeout-r2/directory-final-checks-install-audit.json)：两次check串行通过、桩14/14、bundle及inputs匹配，本轮目录实施前后所核全局hash不变；此前跨C/D批漂移原因仍null。共享七份同名入口与专用入口重复且内容不同，安装器按完整读取面阻断，与Claude settings大小问题独立；[共享重名只读核对](./evidence/agent-access-20261010-closeout-r2/directory-shared-skill-conflicts.json)不推断创建来源或客户端当前重名解析实测。最终三家预检新增10启动，审查累计33/40、主题仍3/4，Driver声明unknown及服务端模型目录不可核实的告警保留。预检回填auth cache先于能力完整指纹；[批G清单](./evidence/agent-access-20261010-closeout-r2/batch-g-final-current.json)从准入228起新增64硬上限、累计292，预计63，显式variant8及版本hash引用，不重试四个缺写尝试模型。源码及bundle在能力批之后不再无故重建。
