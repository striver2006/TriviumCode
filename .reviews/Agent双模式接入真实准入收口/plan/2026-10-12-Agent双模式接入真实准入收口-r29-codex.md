---
role: codex
---

# Agent双模式接入真实准入收口：第26B集中补充计划原稿（r29）

本稿为新的完整当前执行合同，不递归追加旧稿。25B完整r28与23C获批七整改保留，旧采样与失败不回写。相对r28新增CLI inline defaultMode消费面与精确差异、有界显式逐跳认证谱系及v3候选/关闭消费者，其余N/mixed/HTTP/清理/普通与独立审批边界继承并在下文完整列出。新范围未经26B审查和本轮普通批准不得实施。父定稿SHA f6b92255f1182e63905ed837ddf9fb1262eb84bdd38b13e80e17292a4687a406，提案SHA 5146d01efb85dfbd1ec6789e08d184475ab34d801b461de5760800b6a0418008。

# 第26B集中计划：消费面、认证谱系与准入决策

Driver=codex，沿用Agent双模式接入真实准入收口。主设计#agent-access-evidence-guard-contract是敏感整改前向权威。本稿提出新范围，尚未实施；不把第25B普通批准扩成新输入面授权，不批准准入判据采用。

## 1. 已取得事实与剩余范围

生产main aa6db337315dd60691af966bb2bee1dfc5b0829d，输入7ac37129cdfcf3700c34b24b6e87c76359b4997a4fc7480b53f06762a3d45f4f，bundle1737c946fc2aff5af8ebcb5645ddd25b80da3b38d853d96d0b357f7eabf7272e。仅生产作用面dirty=false，整个工作树有本任务文档和独立测试变更。正常四目标28入口、七共享迁移备份、两次3207通过/3跳过/0失败及源/安装14步桩是该生产版本历史实测；本轮不能宣称这些检查验证尚未实施的新资产。

原七条整改经23C有效和本轮委托普通code批准：项目sensitive_globs稳定hash与目录事实/消费守卫；3924真实回放来源及覆盖/邻接/集合不变；peer_deny_applied防御性合取与生产接线；不可消费目录先逐文件回退、精确路径hash仅本调用复用；is_error/permission_denials独立缺错重复变异；受测ASCII五段根域、特殊目录逐文件规则；敏感父目录扫描七边界、预期追加probe失败保留主成果及清理、未知内部错误抛出。本轮保持落点，不再扩大目录、权限或Bash形态。

25B run20261011T184407Z有效，完整r28 SHA f6b92255f1182e63905ed837ddf9fb1262eb84bdd38b13e80e17292a4687a406，2026-10-11T19:00:55.073Z普通plan由Codex按Bob委托批准。r19的实际HTTP限额/在途handler和清理、生产N/manifest、mixed精确配对、临时mode2文件生命周期、双跳诊断及批准Schema测试保持。定向197、后续73、启动/生命周期120属于分别采样且部分重叠，不相加成唯一总数。

模式2 Qwen max一次实际CLI后停止：auto/default不符，其余禁读配对、两写禁用、完整Schema、状态、桥接和四清理通过。k3未启动，real_model_attempt=null，actual_provider_inference=false，服务端null。两次受控模式失败都保留；不得将B分项通过改原C。模式2归档与定位分别为r19/mode2-stop-export.json和mode2-readonly-diagnosis.json。--restricted实际存在，同hash native说明忽略用户settings，inline permissions仅deny；这是输入来源定位，没有因果差分试验。

当前local c5b4下strict canonical0通过/12未测，旧496下7完整通过/5未测及五Claude正向A保存。Qwen max/k3禁读Read原false、五Claude真实写原未测不翻绿。旧矩阵和所有失败Schema/工件/台账保留；旧审批不代替本26B审批。

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

本批确切来源清单至少含24B的496→fb64、25B的fb64→c5b4，以及26B正常preflight若实际更新的c5b4→新hash。零变化preflight另记，不伪造hop。新的hop必须来自生产preflight已落盘原值观察及完整hash、私有0600副本清理，并列每份路径/hash/具体三键差异。输入数组顺序、数量、来源唯一性和hash守卫可重复核验；未来未测/未列变更不自动授权消费。批准后只有明确manifest内完整事实诊断，普通plan不批准任何原矩阵复用。

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

本轮26B先从review328/333扩至348，预计15启动、硬20、累计止348；admission733/742且计划审查新增0。版本、帮助、认证、失败、超时、wrapper/native和重试都计启动，非请求数/金额；达到上限先停且追加扩容记录才能续。预检正常TTL，前后原值差异只提取三checked_at和hash，凭据不打印，私有快照删除。

普通plan批准由Codex按Bob本轮委托执行，reason绑定26B真实成功run/最终定稿路径/hash/全部裁决与gate，具名覆盖“CLI inline模式输入与原deny精确不变、mode3一次性启动绑定、1..32显式逐跳认证链与Schema/来源核验、restricted-tool-surface-and-path-v3版本及关闭消费者/独立批准边界”及继承HTTP/mixed/清理拒绝边界；session未声明null，不冒充Bob亲自操作。普通批准不采用两个候选。失败/未裁决/缺敏感作用面不批准。

批准后首批mode3 Qwen max与k3各一次，预计4、硬6，从733累计止739、池742；任一失败即停。两pilot完全合格才发布其余三组合预计6、硬9、累计止748，并先按已授权扩池至至少748。其它模型实际provider补测0，原失败不重试。27C另列预计/硬上限/池上限与冻结。独立判据采用须另向Bob一次性提交具体材料与分项决定，未经批准目标保持未完成。
