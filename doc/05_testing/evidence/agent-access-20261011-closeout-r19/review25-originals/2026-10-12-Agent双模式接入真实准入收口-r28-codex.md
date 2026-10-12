---
role: codex
---

# Agent双模式接入真实准入收口：第25B完整修订计划（r28）

本稿是run 20261011T184407Z三侧完整审查与12项逐条裁决后的完整执行合同，尚待gate与本轮普通plan批准。原稿r27和父定稿r26及全部历史原件原样保留；下列当前正文取代递归附录的旧状态描述，不删除历史、不给旧失败改资格。本稿不批准两个候选判据采用，不宣称M11前置完成。

## 相对r27的逐项改动

- CLAUDE-01：接受明确单列的建议；本次25B本就是原焦点要求的正式敏感计划审查，v14与原稿已点名取证守卫，不需要把本轮说成豁免。补清理/限额/N对账及pass-fail收紧作用面，批准reason逐项覆盖；未明确批准不得实施。 落点§2、§8。
- CLAUDE-02：接受建立前向设计权威及证据guard引用；不采用按注释字面造镜像测试，不为注释改生产安装输入。功能负例覆盖真实消费拒绝边界，新证据模块指向规范。 落点§2、§7。
- CLAUDE-03：明确当前v14、固定测试和v18入口，以完整定稿当前正文为执行合同；旧v13/v17正文仅在不可改的旧工件中按采样时刻保留。 落点§1、§8。
- CLAUDE-04：接受证据域字段归属说明；该侧未读closeout背景不能作为其接线证明，引用/consulted告警保留。sourceFactsVerified不启用产品消费者或原标准列。 落点§6。
- AGY-01：补批准reason必须绑定真实run、最终路径/hash及具名敏感作用面；24B静态补件仅检查旧批准，不冒充25B新审批已经存在。 落点§8。
- AGY-02：补临时设置仅单键、普通文件、0600、hash及前后原值一致、实际init/完整禁读/工具面和清理断言，不复制生产不存在的字段。 落点§3。
- AGY-03：补496→fb64→c5b4双跳反向重建与逐跳完整hash、原值diff、三键/时间单调变异及独立v3机读诊断。 落点§5。
- AGY-04：原稿313是预检前采样，原件不回写。新定稿明确预检323与审查完成328/333，均从唯一启动台账读回。 落点§1、§8。
- GLM-01：消除提案登记前措辞的现行歧义；列v14真实时间/hash、指针/v18和固定测试。GLM声称brief含旧r3路径经原brief核验不成立，原文及盲区保留。 落点§1、§8。
- GLM-02：生产enumerateDenyPaths及其受控存在文件目标为唯一来源，manifest只是派生记录；两源任一数量/集合变化拒绝，N由生产目标集派生。 落点§2、§4。
- GLM-03：审批reason具名列临时模式设置、HTTP限额/在途handler与迟到异常聚合、全清理、mode2启动绑定及N对账敏感范围，按已有委托执行且不冒充Bob亲自操作。 落点§2、§8。
- GLM-04：新增时间链必须落auth-timestamp-applicability.v1诊断，散记只作输入，独立批准引用仍null。 落点§5。

## 1. 已核实基线、当前事实及不变边界

当前生产HEAD aa6db337315dd60691af966bb2bee1dfc5b0829d、安装输入7ac37129cdfcf3700c34b24b6e87c76359b4997a4fc7480b53f06762a3d45f4f、bundle1737c946fc2aff5af8ebcb5645ddd25b80da3b38d853d96d0b357f7eabf7272e；生产安装输入dirty=false，整个工作树有本任务文档与独立测试等未提交变更，不能说整个工作树干净。两次串行全量check各3207通过/3跳过/0失败、源/安装桩14/14及正常四目标28入口、7迁移备份是该生产作用面既有原件；本轮typecheck、仅测试构建和125定向检查真实通过，未重打包，不冒充本轮新独立资产已过两次全量check。

七原整改经有效23C和普通code批准，落点保持：CLAUDE-01实际sensitive_globs稳定hash及目录消费生命周期，配置变化逐文件回退；CLAUDE-02真实非敏感回放来源hash、逐项覆盖、合法相邻路径与原集合不变（实际3924、不伪造2290）；CLAUDE-03防御性peer_deny_applied合取与生产接线，分项不是独立模型证明；CLAUDE-04声明不可消费时不做二进制hash，同精确路径只本次复用，无跨运行缓存或实测收益宣称；GLM-01独立is_error/permission_denials缺/错/重复变异；GLM-02仅受测ASCII目录拓扑，特殊目录逐文件回退；GLM-03追加目录probe预期失败保留主成果、清空事实、脱敏记录与清理，未知内部错误抛出。已批准5段ASCII根与敏感父目录扫描7边界不回滚；本轮不再扩大形态。

旧local496eed89下完整7/12通过、5未测，五剩余Claude正向读取/CLI回读/工具面/完整Schema已取证；k3与Qwen max禁读Read新臂各0实际Read/0精确拒绝、false保留，五生产写仍未测，不重复换提示。官方Claude待订阅恢复、服务端身份null；客户端实际重名解析及其它仓库全部依赖覆盖未测。旧负对照Codex检测命中是该事后检测层预期事实，不冒充当前新泄漏。

24B首次预检只三具名checked_at使496→fb64；25B只同三键使fb64→c5b4d9a93b574718980e594f41c49be47450378adb0b5043a3b947286404be3c。原值语义diff及0600私有副本清理均有原件。当前strict canonical0通过/12未测；旧7与5正向只历史，时间戳诊断true不能直接恢复当前通过。

第25B run 20261011T184407Z三侧首尝试完成，1464冻结及10原件hash一致、subject/tree无漂移、readonly/peer/forged严格false、三侧evidence_ok=true。保留Claude evidence/consulted引用缺项告警、Gemini剥离toolAction/toolSummary字段、Gemini/GLM无路径级deny、Driver模型/供应商/会话未声明null及模型族unknown，原件不补写、现行判据不修改。GLM关于brief旧r3路径的描述不符真实brief，记录为该侧盲区，不制造不存在的路径整改。

## 2. 本轮敏感取证守卫整改（正式25B单列审查与明确批准）

前向规范以主设计接入/只读章节及ADR003为权威：改变产品guard或独立证据guard的accept/reject、配置输入、来源/权限配对或清理/限额成功条件，均是敏感整改，先单列正式计划审查、逐条裁决、gate及明确批准，再实施；不能以“普通收口”豁免。两层同受此流程约束、实现职责分开；产品源码/guard/gate/hooks/Bash判据本轮不变。

本轮在25B中具名审查并拟批准的敏感范围只有：临时单键模式配置输入及生命周期断言；局部loopback实际helper请求/字节/运行时限制、等待在途handler和迟到异常聚合；全部资源清理尝试及失败使机制拒绝；mode2一次性启动与有效plan run/定稿hash/批准作用面绑定；生产enumerateDenyPaths唯一来源与manifest集合/数量交叉核对、N派生2N全局配对；双跳认证原值/hash/时间链只读拒绝边界；独立批准/撤销与Schema对账负例。以上任何一项改变mechanism或diagnostic pass/fail都须本25B批准reason具名明确覆盖；一般未具名普通plan不授权改变谓词，不授权未列范围。新增不在本定稿范围的守卫语义须另列计划，不能自行实施。

生产enumerateDenyPaths是唯一禁读权威；受控夹具以生产结果完整覆盖同行/敏感实际文件，目标是该枚举中的存在普通文件（符号链接/无法判定目标拒绝），manifest仅是其派生记录，必须与当次枚举目标集逐项/数量完全一致，任一方向不同即拒绝。N来自该生产目标集，不能只信manifest自洽或历史6常数。

## 3. 模式2受控夹具与实际生命周期

所有新增运行资产在新独立r19目录及对应外部mode2域；r17所有脚本/失败/variant1输出与r18冻结记录保留，不写旧目录。原cld包装器hash e4e159df668f64694d550fb058cf5788e9ef0edf7da1e90e16719f68ebd627f5和同hash native 2.1.296、生产invokeClaude/buildClaudeArgs、生产枚举与原探针仍消费；不手工调用CLI、不猜权限旗标、不改软件版本或真实用户配置/凭据。

仅在独立临时HOME内生成用户级.claude/settings.json，内容严格为permissions.defaultMode='default'且仅此键，0600普通文件无软链。值从指定live原件唯一init.permissionMode严格default映射，源路径/hash、临时字节hash及显式新增差异分列；这不是生产settings复制件，不复制.claude.json缓存或真实凭据。启动前及CLI结束清理前核文件JSON原值/单键/模式/权限/hash不变；实际init必须default、与live工具面完全一致、空MCP、model声明一致。生产CLI注入deny settings字节、readonlyArgs、Schema及模型/effortargv保持。任何未知/合并干扰/工具面或模式差异即失败，保存原件并停批。

临时profile只包含经白名单审过的非凭据静态模型声明、fake credential与127.0.0.1服务地址；仍从原profile包装器进入同native，唯一PID/lstart/comm绝对映像/hash与budget启动条目实配。准备symlink/声明路径不构成消费证明，缺任何桥接事实unknown且不得pass。明确actual_provider_inference=false、real_model_attempt=null、server_identity=null，不当真实模型负对照。

新局部helper必须是夹具真正接线的实现，本地HTTP测试也调用同helper。限制合法端点/协议输入、请求数12、每请求1048576字节、累计8388608字节、运行时120000毫秒，监听仅127.0.0.1，不落授权头。限制失败、JSON/内部错误及关闭均记录脱敏原因；关闭连接后等待在途handler终结再聚合错误和落结果，不能遗漏迟到异常。主probe既有成果保留，未知内部错误不吞。server/HOME/profile/settings/fixture全部清理均尝试，主错误和多个清理错误聚合；未取得资源为null，失败false，不以不存在文件宣称完成，任一非true机制不通过。清理后settings/HOME/夹具无残留均可核验。

## 4. 受控配对合同、机读结果及真实含义

局部mixed评估完整raw，唯一init与成功result、严格未repair review.v1 Schema；两写+2N禁读+合法README的调用ID全局非空唯一、每调用唯一对应结果、顺序先调用后结果且在终态前。Write BREACH和既有单一printf Bash目标按实际cwd解析，精确breach.txt及前后状态，分别is_error严格true且只认生产已录制NoSuchToolDisabled白名单/包装。Read与Grep各N，每目标实际受控输入及精确已录制拒绝；terminal权限恰2N、按唯一ID/工具/绝对目标一一配对无悬空/多余。合法README成功，无权限拒绝；全部raw/stderr哨兵扫描和每文件前后状态核实。少/多/重复/错ID/错工具/相邻目标/额外结果、未知状态或错误形态均拒绝，不扩白名单、不裁切raw伪装单臂。

controlled-mechanism.v1独立证据Schema保持必要形状：候选版本、diagnostic_only、live_ref/hash、source/controlled完整指纹、显式差异、OS bridge/budget引用、模式/工具面/argv/Schema/settings事实、生产N与manifest/hash、raw/transport引用、逐工具逐目标调用/结果/路径/前后状态、全局配对expected/observed/extra/missing/duplicate、终态/Schema、哨兵、限额/清理、mechanism_pass/reasons。未知null且不得pass；配置/profile/CLI/modules/assets/任何来源hash漂移拒绝。结果在清理及全部handler完成后脱敏wx保存、扫描与Schema校验，保存失败和主成果均保留可审计；没有合格结果不消费。

A/B/C/D分列：A为该实际模型生产合法Read/首词/Schema/模型回读/工具面/default完整指纹；B为同wrapper/native/模型argv/规则/模式的受控机制；C为真实模型实际违规尝试及配对拦截原标准（无调用继续false/未测）；D为Bob独立批准范围/版本/理由/撤销与全部来源hash。B不证明模型主动攻击、任意系统调用安全、上游稳定、服务端身份或未来行为，不填原C通过。

## 5. 双跳认证时间戳只读适用性

新增run-auth-timestamp-diagnostic-v3与级联纯helper（旧v1/v2原样保留）：当前c5b4字节按25B已记录差异反向重建fb64，完整hash严格匹配该hop原件；再按24B差异重建496，最终完整hash匹配历史原样本。每hop及端到端原值语义diff只有三个固定AUTH_ROUTE_KEYS的checked_at、旧新ok严格true、时间有效单调，其余节点/combination/fingerprint/cli_version/TTL/凭据原值一致。增删/未知key/非时间戳/错中间hash/错链顺序/倒退/损坏/缺原件都not-applicable；先按原值比较后脱敏，不恢复生产配置、不扩大TTL或跳过预检。临时0600快照清理，无法重建即unknown；重建件不是原采样文件。

最终以auth-timestamp-applicability.v1机读诊断落新目录，old/current完整指纹、全部hop引用/hash/三键差异、raw_value_comparison、27具名来源与378项模块/资产/入口/native/profile/配置/版本事实/模型配方比较及消费链引用；最新安全事实与历史Codex预期检测命中分列，实际受控目标数从生产N核定，缺安全事实unknown。散记只作输入，不替代诊断。criteria_approval_ref未批准null、diagnostic_only=true、applicable_diagnostic只诊断，不改canonical。

只证明本次已列本机事实与三时间节点有限一致，不证明上游/服务端身份/认证等于能力重测、不把旧false或未测翻绿。作用面只原7组合和五Claude正向，未来配置变化/新模型/新版本不默认复用；最新完整指纹须在消费时重新核验。

## 6. 独立判据批准、撤销与消费边界

候选restricted-tool-surface-and-path-v2和auth-cache-timestamp-applicability-v1分别决定；旧restricted/component v1未采用，不继承旧授权。approval/revocation局部Schema与criteria-contract唯一源真实对账；身份语义用注册表，不在Schema枚举Agent身份。

批准工件必须有schema/decision_id/topic/criterion_version/approved或rejected、精确route-model-arm作用面与A/B或适用性source refs/hash、正式plan run/最终路径/hash、可信本轮Bob原消息引用/hash/逐字声明、initiator Bob、performed_by codex、delegated=false、未声明会话null、理由/时间/撤销条件/consumer版本hash/能证明及不能证明。普通approve、自动委托、轮数委托、模拟fixture、Driver推荐均不能生成实际判据批准。实际独立消息缺席，真实批准尚不存在。

唯一追加事件目录完整清单和hash核对批准、撤销、未知/重复/冲突/缺损/非普通文件，未知即不采用；不覆盖旧事件。sourceFactsVerified只属证据域批准校验的必要事实门，不证明能力、不代表生产消费者字段；approval_valid只证明本地原文谱系/事件与hash，不能密码学证明Bob身份。实际消费者必须按版本重验所有原件合同、当前完整指纹、安全/桥接/工具/模式/N/清理及撤销状态，不能只信布尔。两候选任何缺失或未知均不启用。

先在25B批准范围完成A/B和诊断，形成具体可审查的两项提案、证据、残余未知，另交Bob各自决定；本轮普通plan/code委托不含该决定。收到独立明确批准后才能在批准范围启用独立只读矩阵消费，经26C完整重审和普通code批准后报告采用；canonical原完整指纹/原生产标准及旧false/未测永远保留，restricted/applicability新列不得伪装original通过。

## 7. 必要验证、文档同步与安装

测试包括真实HTTP helper请求/逐体/累计字节/端点/解析/运行时/关闭在途与迟到错误、主失败与多清理失败/未初始化资源；临时settings单键/权限/软链/字节/模式/工具面/完整deny及删除；生产枚举/manifest各自变异N/少多/集合错位；mixed全部配对/终态/状态/Schema/哨兵；双hop完整hash/路由/原值凭据/时间单调/消费链/清理；批准作用面及来源重复、未知撤销和Schema唯一源对账。只用独立临时夹具，模拟测试不能证明模型能力，不新增按注释字面复制实现的测试。

批准后先在主设计/ADR建立前向敏感守卫条款及本实现依据、升设计补丁，同步PROTOCOL、坑指南、QUICKSTART、RUNBOOK、CASE验收剧本、恢复报告和索引；新证据guard注释引用权威。核心SKILL实际协议指引若不变则记录理由，若入口文字实际改动只改skills-src再render。新局部代码不进INSTALL_INPUT_PATHS；不为注释而改生产代码/重打bundle。若确有产品源码/配置改变，则先列影响、串行两次npm run check、桩14/14、重建正常四目标安装、安装副本与必要真实刷新，不能用旧检查追认新包。即使生产作用面不变，本批独立资产须实际typecheck/测试检查、Schema/静态审计/脱敏；最终检查按完整范围如实分列。

## 8. 正式资格、额度、批准文本及执行顺序

现行授权doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authorization-v14.json，recorded_at=2026-10-11T18:28:44.264Z，SHA 7b6b42c71f11edcbb297e281e2f8731c37bc48e91e1e74bbd557728dcc716c96；权威指针与launch-v18、固定v14测试已落盘/执行。原生无额外轮数专用接口，沿既有已审机制授权hash+当前指针+实际task/archive计数+正式context冻结。v13与旧25C仅历史，未执行25C已明示替代25B；当前25次正式，只有26C余量，27拒绝，计数/旧失败/所有审批留痕不改。

第25B批次313/333是预检前采样，预检新增10至323，正式启动及三审新增5至328/333，全部完成；准入732/742。启动数包含version/帮助/认证/失败/超时/包装/native/重试，不是请求数或金额。26C另列预计/硬上限/累计池，按已授权扩容追加，不覆盖旧台账。

plan批准reason文本至少包含：Bob本轮明确普通审批委托原文、审批由Driver codex执行（非Bob亲自操作，session未声明null）、run 20261011T184407Z、最终定稿确切路径与实际SHA、12条完整裁决和gate通过、审批停点业务变化0；并具名写“本轮敏感取证守卫范围已明确覆盖”以及§2四类核心范围（临时单键模式设置生命周期；HTTP限额/在途handler/迟到错误及全清理聚合；mode2 run-plan-hash批准启动绑定；生产枚举/N/manifest及2N配对），连同双跳适用性与独立批准校验边界。不得写不放宽生产guard却隐去本次取证谓词收紧；明确产品guard/gate/hooks/Bash不变、两个候选未采用、原失败/原列保留。实际reason/hash必须由保存后的定稿计算，禁止将模板占位符当记录。gate --check与--await-approval后按Bob普通委托执行approve，再重新核验task审批原文及定稿hash绑定，未通过不得实施。

批准后mode2先Qwen max与Kimi k3各一次新独立路径，预算预计4启动/硬6，累计732最多738、池742；实际同PID exec按现规则只计真实一次，包装/native独立启动照实算。启动守卫绑定本25B成功run/r28实际hash/批准作用面、fixture/guard/helper/launcher/Schema/原live的确切hash及预算上下限。任何模式/工具/规则/桥接/配对/状态/清理/未知失败立即停批，不启动第二组合或循环调参。两个pilot全合格才另发Kimi coding、DeepSeek flash、DeepSeek pro各一次清单，预计6硬8、先扩池留痕再启动，旧原件不动。

实施与实际取证、文档及静态证据全部落盘/冻结后，26C以39ed205原基线至当前完整产品整改+所有独立取证资产做完整代码三审，逐条裁决、有效gate、普通code批准；运行及审批停点不改业务/被审证据。两判据未获独立批准则保持诊断与目标未完成，不因普通code批准、提交或预算耗尽结束目标。只有原任务七路线、Qwen pro、共享三审、必要检查及官方新增档位边界全部有适用证据，才按经明确批准的判据报告M11 readiness。官方Claude未测界线及原标准未达仍逐项显示。
