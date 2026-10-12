---
role: codex
---

# 第26B完整修订计划（r30）

本稿来自run20261011T200004Z正式三审和九项逐条裁决，等待普通plan批准。相对r29的改动逐项如下；1607冻结/10原件未变，subject/tree无漂移，readonly/peer/forged严格false，三侧evidence_ok=true。原稿r29与25B定稿及所有原件保留，不改变旧failed资格。

## 相对r29的逐项改动

- CLAUDE-01：接受启动数字/reason/hard9补正；扩容授权缺席定性不成立，Bob已有独立自动扩容原话。 落点§7、§8。
- CLAUDE-02：新增唯一v1.3.158当前锚及run/hash绑定同步，旧v2历史保持。 落点§6、§8。
- CLAUDE-03：新资产单一状态机与固定候选合同；历史原件不改，新旧事件裁决负例逐臂对账。 落点§5、§8。
- CLAUDE-04：第三跳具体路径/hash和删除私有副本后的原值证据分列，不宣称未执行重建成功。 落点§4、§8。
- AGY-01：最新b40e8a37取代当前基线措辞，旧c5采样不回写。 落点§1、§8。
- AGY-02：新Schema路径/const/模块/候选集明确，旧Schema保留。 落点§3、§4、§5、§8。
- AGY-03：当前343/348、事前328与预检338分列，27C须重新发布批次。 落点§7、§8。
- AGY-04：明确批准token数组和真实run/全路径/hash与批次/来源核验，不只信token。 落点§7、§8。
- GLM-01：32为本轮工程输入上界；超过停用，扩界或真实新锚须另正式审查批准。 落点§4、§8。

# 第26B完整当前执行合同：消费面、认证谱系与准入决策

Driver=codex，沿用Agent双模式接入真实准入收口。主设计#agent-access-evidence-guard-contract是敏感整改前向权威。本稿提出新范围，尚未实施；不把第25B普通批准扩成新输入面授权，不批准准入判据采用。

## 1. 已取得事实与剩余范围

生产main aa6db337315dd60691af966bb2bee1dfc5b0829d，输入7ac37129cdfcf3700c34b24b6e87c76359b4997a4fc7480b53f06762a3d45f4f，bundle1737c946fc2aff5af8ebcb5645ddd25b80da3b38d853d96d0b357f7eabf7272e。仅生产作用面dirty=false，整个工作树有本任务文档和独立测试变更。正常四目标28入口、七共享迁移备份、两次3207通过/3跳过/0失败及源/安装14步桩是该生产版本历史实测；本轮不能宣称这些检查验证尚未实施的新资产。

原七条整改经23C有效和本轮委托普通code批准：项目sensitive_globs稳定hash与目录事实/消费守卫；3924真实回放来源及覆盖/邻接/集合不变；peer_deny_applied防御性合取与生产接线；不可消费目录先逐文件回退、精确路径hash仅本调用复用；is_error/permission_denials独立缺错重复变异；受测ASCII五段根域、特殊目录逐文件规则；敏感父目录扫描七边界、预期追加probe失败保留主成果及清理、未知内部错误抛出。本轮保持落点，不再扩大目录、权限或Bash形态。

25B run20261011T184407Z有效，完整r28 SHA f6b92255f1182e63905ed837ddf9fb1262eb84bdd38b13e80e17292a4687a406，2026-10-11T19:00:55.073Z普通plan由Codex按Bob委托批准。r19的实际HTTP限额/在途handler和清理、生产N/manifest、mixed精确配对、临时mode2文件生命周期、双跳诊断及批准Schema测试保持。定向197、后续73、启动/生命周期120属于分别采样且部分重叠，不相加成唯一总数。

模式2 Qwen max一次实际CLI后停止：auto/default不符，其余禁读配对、两写禁用、完整Schema、状态、桥接和四清理通过。k3未启动，real_model_attempt=null，actual_provider_inference=false，服务端null。两次受控模式失败都保留；不得将B分项通过改原C。模式2归档与定位分别为r19/mode2-stop-export.json和mode2-readonly-diagnosis.json。--restricted实际存在，同hash native说明忽略用户settings，inline permissions仅deny；这是输入来源定位，没有因果差分试验。

26B预检后当前local b40e8a37f3e1b4fb0b7184d9764c919a8ac4030a5c090c22f612ba7480d20989下strict canonical0通过/12未测，旧496下7完整通过/5未测及五Claude正向A保存。Qwen max/k3禁读Read原false、五Claude真实写原未测不翻绿。旧矩阵和所有失败Schema/工件/台账保留；旧审批不代替本26B审批。

## 2. 路线×实际模型×缺口×可复用证据×必要新增启动

| 路线 | 实际CLI模型（历史原件） | 剩余原标准缺口 | 可复用事实与限制 | 批准后必要新增启动 |
| :--- | :--- | :--- | :--- | :--- |
| Claude/Qwen flash | qwen3.8-flash | 新local完整指纹适用性 | 旧496完整通过，含真实写及精确读拒绝 | 0；先完整原值谱系诊断，不自动判当前通过 |
| Codex官方三档 | gpt-6.1-sol、gpt-6-luna、gpt-6-astra | 同上、官方新增档位边界 | 各历史完整通过，effort未回读null | 0；同上 |
| Codex/Qwen、Kimi、DeepSeek | qwen3.8-flash、kimi-for-coding、deepseek-flash | 同上 | 各历史单一读取/拒绝/真实写/检测通过；旧unknown命令失败保留 | 0；同上 |
| Claude/Qwen max | qwen3.8-max | 禁读Read实际模型调用false；真实写未测；受控模式不符 | 正向A、历史路径事实及mode1/mode2失败，只能作分层事实 | 新mode3一次预计2、硬3；失败停止全部后续 |
| Claude/Kimi k3 | k3 | 禁读Read实际模型调用false；真实写未测；受控未测 | 正向A、0次Read拒绝原false | 前一组合全合格后一次预计2、硬3 |
| Claude/Kimi coding | kimi-for-coding | 真实写未测；受控未测 | 正向A和历史禁读事实 | 两pilot全合格后一次预计2、硬3 |
| Claude/DeepSeek flash、pro | deepseek-flash、deepseek-v4-pro | 各真实写未测；受控未测 | 各正向A和历史禁读事实；pro不代flash | 两pilot全合格后各一次预计2、硬3 |
| Claude官方 | null | 订阅不可用、未测 | 无官方在线模型准入证据 | 0，订阅恢复后另列批次 |

表中新增CLI均为受控机制B，不是实际provider/model调用C。请求/配置/实际CLI回读/服务端身份分列，无证据null。生产五写无可行工具面，继续0新增；不循环换提示、不注册生产Write/Bash。原标准采用实际模型尝试+唯一ID配对拒绝+精确目标状态，保持不变。

## 3. 正式敏感范围一：mode3实际消费面

保持生产invokeClaude/buildClaudeArgs、同hash包装器与native、--restricted/--strict-mcp-config/Read,Grep,Glob、空MCP、model/effort/Schema、完整生产enumerateDenyPaths。只在新独立fixture的CLI inline --settings中加入permissions.defaultMode='default'，值来自指定live实际唯一init；保持permissions.deny逐项及顺序完全相同，不新增allow/ask/工具、不改真实用户配置、不猜新CLI旗标、不复制用户缓存或凭据。生产适配器与真实配置不改。

这是与生产inline JSON不同的新受控输入，必须分列original/proposed JSON字节、hash、deny数组hash、精确唯一argv项、除该settings值之外argv逐项一致，明确改变的是CLI输入配置面。禁止继续宣称生产settings字节完全相同。旧临时单键用户文件仍保留生命周期检查，但明确它在restricted下不证明消费，不用其存在充当模式生效证据；mode3成败必须实际init严格default且工具/MCP/model与live一致，未知即拒绝。

新增纯构造/核验helper仅接受原生产settings形状permissions.deny和live default；损坏JSON、未知键、已有模式冲突、缺/空deny、重复或错规则、allow/ask、非default、丢失/变化任何deny项、错argv位置/多settings/其它argv差异均拒绝。只为独立受控fixture新增，不改变buildDenySettings产品合同。模式输入新证据Schema与实际guard/fixture/proof对账，禁止字段只落盘却不消费。

mode3使用新的独立r21执行域与外部一次性lease，不复用mode2输出。启动前绑定26B成功run/最终定稿完整hash/实际普通批准reason敏感作用面，所有fixture/helper/guard/launcher/Schema/proof/live原件/生产modules和完整配置hash。提前核对每个字段来源及精确路径，先零CLI负例。预算实际wrapper/native同PID只计一次，独立进程各计数；OS PID/lstart/absolute comm/native hash与真实启动账逐项配对。任何失败即停批，保存全部原件，k3及其余组合不启动；没有循环重试授权。

HTTPhelper继续实际接线：127.0.0.1、请求12、每请求1048576、累计8388608、运行时120000ms，等待在途handler/迟到异常，所有资源清理尝试及聚合。生产N、完整deny/目标manifest、两写+2N读+合法README、2N全局权限唯一精确配对、未repair Schema/终态/哨兵/前后状态严格保留，不能松动白名单或接受auto。原件脱敏wx保存并扫描、全部主成果与失败保留。无法证明新配置被消费或模式仍不符，不换第二配方，提交失败可行性和剩余决策材料。

## 4. 正式敏感范围二：有界、显式、逐跳认证谱系

替代r19固定两跳helper只在新独立模块，不修改旧v1/v2/v3或原诊断。新helper接受1至32个显式manifest hop（旧到新），不是无限循环或跨运行缓存。32是取证输入大小上限，不扩TTL、模型或语义范围；超过上限即拒绝，不能截断链。原三AUTH_ROUTE_KEYS固定、每跳完整config hash连续且无循环、ref必须存在普通文件并实际核hash、只checked_at原值严格ISO且递增、旧新ok严格true、其它所有配置原值含凭据不变。每跳先完整hash反向重建再用既有evaluateAuthTimestamp原值语义核验，最后端到端原496hash及最新完整hash严格一致。

本批确切来源清单至少含24B的496→fb64、25B的fb64→c5b4，以及26B已实测的c5b4→b40e8a37第三跳。零变化preflight另记，不伪造hop。新的hop必须来自生产preflight已落盘原值观察及完整hash、私有0600副本清理，并列每份路径/hash/具体三键差异。输入数组顺序、数量、来源唯一性和hash守卫可重复核验；未来未测/未列变更不自动授权消费。批准后只有明确manifest内完整事实诊断，普通plan不批准任何原矩阵复用。

负例：0/33hop、错顺序/断链/循环/重复ref、缺/损坏/软链来源、错中间或端点hash、丢/多/重复/未知route及键、倒退/无效时间、ok!=true、凭据/model/CLI/profile/模块/TTL任意原值变化、source refs/消费链/当前安全缺失；均not-applicable。已知预期输入错误脱敏常量记录，未知内部错误抛出；Buffer及时清零，私有文件清理，不落凭据。不把reconstructed称原样本。

27具名历史来源臂及所有生产模块/资产/入口/native/profile/config/版本、当前安全和消费者引用逐项核验，不只信previous diagnostic=true；新增chain Schema支持1..32长度、逐跳必要形状/完整hash引用与实现一致，历史Schema保留。applicable_diagnostic仅说明本机已列事实有限一致，不证明服务端、上游稳定或认证等于能力重测，criteria_approval_ref=null直到独立批准。

## 5. 两项独立判据的决策出口

本轮明确新增候选restricted-tool-surface-and-path-v3：v2要求生产settings字节相同，本次inline新增defaultMode与其不同，不能沿用v2含义。v3只允许本计划§3具名差异，原deny精确不变且实际mode同default，不能称生产settings同字节。v1/v2均未采用、旧Schema/validator原样保留；新独立v3 validator、consumer和形状契约从旧逻辑派生，仅准入候选版本换v3，重复/冲突/撤销/来源/未知拒绝不变，不开放其它版本。新版本与auth-cache-timestamp-applicability-v1各自决定。分别给Bob具体事实、作用面route/model/arm/source hash、正式plan、理由、能证明/不能证明、撤销条件和消费者hash；普通自动plan/code批准、CLI扩容和轮数委托均不包含采用。无Bob本轮另行明确原消息及引用hash就不生成实际criteria approved，不在消费者启用。

A生产正向、B受控机制、C真实模型原标准和D批准独立分列。受控B即使合格也不能证明模型主动尝试、不受控的任意调用安全、服务端身份或未来行为，原C false/未测保留。认证候选也不消除原C缺口。mode3失败时候选受限采用仍不具备推荐条件；有界谱系可以独立形成可审查认证提案，不因另一候选失败混批。

现有approval/revocation Schema与criteria-contract唯一源、完整追加事件清单/重复/冲突/未知/撤销/损坏/来源hash/sourceFactsVerified事实门保持，新增v3版本拒绝边界和对应负例明确属于本26B敏感范围。approval_valid仅本地授权原文谱系，不密码学证明Bob身份；actual consumer必须重验全部原件合同、当前完整指纹、scope、事件状态和全部实际模式/桥接/N/状态/安全。任一unknown不消费，不能只信布尔。普通plan仅准许实施v3候选诊断和关闭的消费者，不授予v3采用；不擅自把v2含义改掉。

## 6. 检查、文档、安装与完整代码重审

新资产全部独立，新模式与链语义获批后才实施；同步主设计补丁、ADR003、PROTOCOL、GUIDE_local_pitfalls、CASE、QUICKSTART、RUNBOOK、报告及索引。入口措辞如需变，改skills-src再render；当前入口和产品Schema不变则记理由，不为措辞无关的诊断重打包。原r17/r18及r19原件/脚本不改，r19 README仅追加关闭批次采样并保存更新前快照。

定向测试调用实际接线helper与消费者，覆盖输入消费/精确argv差异、32边界与全部谱系拒绝、实际HTTP/清理/N/mixed/批准事件。静态审计核完整安装输入、runtime/28入口/七备份、全部历史失败/台账、literal context禁读冲突与扫描；审查前全部落盘冻结。审查中和审批停点不改业务/被审证据。

最终27C须完整重审原39ed205基线至当前七整改/所有独立取证资产、文档与事实，再逐条裁决、gate、普通code决定。源码/配置产品作用面如变，串行两npm run check、14/14、重建正常四目标安装及实际副本/适用指纹与必要真实刷新；生产输入不变时明确历史生产检查与新独立资产检查的区别，不能宣称新资产已完成未执行检查。完整任务仍以所有七路线、Qwen pro、共享三审、必要检查和官方边界实证满足为完成，不以提交/诊断/预算耗尽为完成。

## 7. 正式资格、审批与分批额度

按Bob原消息“授权轮次可以按需增加，不必询问授权”沿已审权威登记v15，保留v14及25运行，把未执行26C明确替代为26B，新增27C，28拒绝。计数源仍task.runs与archive实际一致，不改旧failed。不宣称原生轮数接口存在。

26B事前328/333扩至348，预计15启动、硬20、累计止348；实际preflight10至338/348，正式三审5至343/348，全部已完成，无重试，现余5。admission733/742且本轮计划审查新增0。版本、帮助、认证、失败、超时、wrapper/native和重试都计启动，非请求数/金额；达到上限先停且追加扩容记录才能续。预检正常TTL，前后原值差异只提取三checked_at和hash，凭据不打印，私有快照删除。

普通plan批准由Codex按Bob本轮委托执行，reason绑定26B真实成功run/最终定稿路径/hash/全部裁决与gate，具名覆盖“CLI inline模式输入与原deny精确不变、mode3一次性启动绑定、1..32显式逐跳认证链与Schema/来源核验、restricted-tool-surface-and-path-v3版本及关闭消费者/独立批准边界”及继承HTTP/mixed/清理拒绝边界；session未声明null，不冒充Bob亲自操作。普通批准不采用两个候选。失败/未裁决/缺敏感作用面不批准。

批准后首批mode3 Qwen max与k3各一次，预计4、硬6，从733累计止739、池742；任一失败即停。两pilot完全合格才发布其余三组合预计6、硬9、累计止748，并先按已授权扩池至至少748。其它模型实际provider补测0，原失败不重试。27C另列预计/硬上限/池上限与冻结。独立判据采用须另向Bob一次性提交具体材料与分项决定，未经批准目标保持未完成。


## 8. 第26B九意见合入后的明确合同（优先于旧稿采样）

CLAUDE-01：接受本轮启动数字、后续硬上限与批准文本的机械绑定补正。Bob另有原消息“中途遇到需要审批的，根据你的建议自动审批；如果遇到配额不够的，自动增加配额。”，因此CLI池追加并非只由轮数委托推断；驳回“缺扩容授权”的定性，未篡改旧授权原件。本26B明确审并拟批准mode3首批预计4硬6、止739/池742，后续预计6硬9、最坏止748/池至少748（相对24B硬8明确改为9），事前清单和追加记录后方可生效；review本轮348及27C另批不混入HTTP请求限额。启动守卫必须读取实际批次的before/expected/hard/stop/pool及台账完成状态，reason同时具名数字，超限不启动。HTTP12/每体1048576/累计8388608/运行时120000完全不变。

CLAUDE-02：获批后同步新主设计v1.3.158，新增唯一当前正文锚agent-access-inline-mode3-contract，完整定义CLI消费差异、v3谓词及关闭消费者与独立采用门；原前向敏感流程锚agent-access-evidence-guard-contract继续管流程。旧v1.3.156/v2同版本串句及25B/mode2规范按历史采样保留，标明当前正文优先，不改旧工件、不让两个候选串并行为准。新sync-approved-contract.mjs绑定本26B成功run、最终r30确切hash及具名批准，再同步ADR003、PROTOCOL、手册、剧本、报告/index。实现注释及批准工件只引用新当前锚与restricted-tool-surface-and-path-v3，不为注释改产品bundle。

CLAUDE-03：旧r17/r19冻结校验器不改，仅历史。r21新criteria-validation-core.mjs是新资产唯一批准/撤销/冲突/未知状态机；criteria-contract.mjs是其形状和固定候选集唯一来源，仅restricted-tool-surface-and-path-v3与auth-cache-timestamp-applicability-v1，不从未经校验的批准工件扩大白名单。criteria-approval-validation-v3.mjs只为已hash绑定合同调用该core；消费者不复制状态机。新增可重复新旧对账：同事件语义按测试域唯一v2→v3版本映射，所有撤销/重复/未知/损坏/scope/来源/批准谱系负例裁决逐臂一致，错版本另断言拒绝；测试映射不改任何真实历史原件，不能让v2批准适用v3。

CLAUDE-04与AGY-01：当前完整配置为b40e8a37，以下确切三跳均以原值观察和完整hash核验，私有副本删除不丢已录旧/新值或端点hash；仍须新helper实际重建成功，记录并非重建成功证明。未来消费须当前配置再核，未列新变化不默认通过。

AGY-02：新资产均在r21，Schema固定为controlled-mechanism-mode3.v1.schema.json（根schema const controlled-mechanism-mode3.v1）和auth-timestamp-chain.v2.schema.json（根schema const auth-timestamp-chain.v2，hops min1/max32），继承原完整事实形状并增加inline输入/deny/argv差异必要字段和chain全部来源/端点hash；旧Schema原样。controlled-inline-mode.mjs、controlled-mechanism-mode3.mjs、controlled-fixture-mode3.mjs、mode3-launch-guard.mjs、mode3-launch-measurement.mjs、mode3-proof.mjs及launch-controlled-mode3.mjs分别实际接线，manifest包含各确切hash。auth-timestamp-chain-v2.mjs和run-auth-timestamp-diagnostic-v4.mjs使用新链Schema，旧v3不改。criteria-approval.v1与revocation.v1形状保持、new criteria-contract唯一导出和Schema真实对账；版本集合按CLAUDE-03固定。

AGY-03：预算以343/348审查完成采样为当前，328/333是事前、338是preflight后，旧描述保留在原稿。27C重新发布预计/硬上限/池限与追加记录，不把当前余5说成够一次完整新预检+三审，也不以探活成功代替准入。

AGY-04：mode3启动与批准共同使用精确token数组：["本轮敏感取证守卫范围已明确覆盖","CLI inline模式输入","原deny精确不变","mode3一次性启动绑定","1..32显式逐跳认证链","Schema/来源核验","restricted-tool-surface-and-path-v3","关闭消费者/独立批准边界","HTTP限额","全清理","生产枚举/N/manifest","review池348","首批预计4硬6止739池742","后批预计6硬9止748池至少748"]。真实批准reason须含全部token以及本26B真实run、最终r30相对全路径/完整hash，启动守卫实际复核完整批准来源/全局gate/事件及所有来源hash，不只核token。数字与已发布批次实际一致才允许启动，不依赖basename或模糊摘要。

GLM-01：32是本轮提出并经正式审查的工程输入规模上界，不是当前3跳实测能力或历史已批准数字。该上界防无限输入，输入必须全部显式核验；0/33拒绝，当前只3跳。超过32时停止使用此诊断、保持canonical未测，另单列敏感方案和正式批准才能扩界或以实际新能力原件重新锚定；禁止截断、换原点追认旧样本或隐含未来自动适用。

模式文件澄清：mode3仍实际创建25B已批单键0600用户文件并保留前后hash/权限/单键/清理检查；它被restricted忽略，存在与否不证明消费，缺生命周期事实依旧拒绝。新的CLI inline defaultMode映射单独判定，两个来源分列，不擅自删掉原清理谓词。

上述新范围仍未实施，普通plan须gate/await后按Bob委托明确批准。两个候选独立采用仍没有Bob原消息，实际criteria_approval_ref=null、消费者关闭，原C false/未测及旧失败永久保留。

### 本批确切时间链来源

- doc/05_testing/evidence/agent-access-20261011-closeout-r16/config-after24-preflight-observation.json SHA 69ccc29d78982dd87d6fd4c4015e3bcc831425bcb5074b8e3692655bd9986e3d；完整配置 496eed89fe1daf113196ea7a304831e47740432d3b9437f5850e56a1877249a7 → fb64a35a5ea1b3ebfe791435a32a715ca28cc5062fa794b330f1ac46f536a232；三具名checked_at旧新ISO原值已落盘，private_snapshot_removed=true。
- doc/05_testing/evidence/agent-access-20261011-closeout-r18/config-after25-preflight-observation.json SHA e8290067d99eb0549acaf181c73654499f6d1fc3c79c2b5cdb26c018097f661e；完整配置 fb64a35a5ea1b3ebfe791435a32a715ca28cc5062fa794b330f1ac46f536a232 → c5b4d9a93b574718980e594f41c49be47450378adb0b5043a3b947286404be3c；三具名checked_at旧新ISO原值已落盘，private_snapshot_removed=true。
- doc/05_testing/evidence/agent-access-20261011-closeout-r20/config-after26-preflight-observation.json SHA 552b41fd94923390d9483807d88a86577250daa8d1f37b116b2e0362201b3aef；完整配置 c5b4d9a93b574718980e594f41c49be47450378adb0b5043a3b947286404be3c → b40e8a37f3e1b4fb0b7184d9764c919a8ac4030a5c090c22f612ba7480d20989；三具名checked_at旧新ISO原值已落盘，private_snapshot_removed=true。
