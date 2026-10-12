---
role: codex
---

# Agent双模式接入真实准入收口：第25B补充计划原稿（r27）

原七整改已通过有效23C、24B完整r26已普通批准，本稿不回滚。首次受控pilot模式不符的证据已取得且后续未启动；本次新临时设置及集中补正尚未实施，等正式plan审查与普通批准。v14仅25B/26C、27拒绝，判据采用未批准。

提案来源SHA 46930ac1bad3689e040d3f8f241dec4728ed5a76f2c563299e87b5b71ae728f2，父定稿r26 SHA af93c0bb996da1b2125e70f66784b1151dc6d09c87853d2c8a77c718672ea2f9。以下本次补充与父合同完整适用；父合同中的24/25轮数、旧localfb64及待实施描述按其采样时刻解释，现行v14与本次预检原件优先，不将旧正文改写。

# 首次受控pilot停点后的集中补充计划提案

Driver codex，沿用Agent双模式接入真实准入收口。此文件仅是可审查提案，未实施其中模式设置或新增CLI启动。第24B批准的合同、首次失败及当前原准入列全部保留。普通审批/轮数/额度委托不批准采用两个候选判据。

## 1. 已取得的事实

- 首次Qwen max受控运行经原cld包装器，PID/lstart/映像和预算记录证明实际消费同hash native 2.1.296。两写、生产六目标Read/Grep逐项精确拒绝、完整Schema、合法README读取、无敏感哨兵、全部状态及清理取得证据；init模式auto，而相应真实生产原件为default。mechanism_pass=false。
- 失败占admission一次，同PID exec未另计假想native启动；累计732/742，review313/318、正式24/25。未启动k3/其它三组合，未重试。
- 当前用户.claude.json的相关缓存开关false，临时HOME无该缓存。官方[权限模式说明](https://code.claude.com/docs/en/permission-modes)说明2.1.285+不获取功能开关的-p会话可默认auto，也说明用户级permissions.defaultMode可选择会话模式。这只是机制资料及候选原因，不是因果实测。无历史.claude.json hash，不声称历史文件完全不变；不复制该缓存或真实凭据。
- 已完成具名时间戳只读诊断：临时重建旧完整字节hash496eed89与原记录相同，当前fb64a35a不动，27项原件及378项比较一致。首次实现混淆旧Codex故意负对照检测命中与最新泄漏，首次false及脚本保留；v2按原检测分层合同将最新安全事实绑定24B/受控原raw，applicable_diagnostic=true。原检测字段、历史状态、当前canonical 0/12不改。
- 独立批准/撤销校验与局部Schema已实施，测试模拟不会生成真实批准，production_consumer_enabled始终false。仍须完成下述静态审计与测试，不宣称已完整收口。

## 2. 最小模式补充方案（需正式B审及普通plan批准后才实施）

为当前两个pilot的独立临时HOME新增仅含permissions.defaultMode的用户级settings.json（0600）。值只消费对应真实正向原件init.permissionMode，必须严格为default；来源路径/hash、文件字节hash及新增差异独立记录。实际受控init仍必须严格等于生产default，不能只靠设置声明通过。

这不是复制不存在的生产settings字段，而是新增临时模式设置；必须明示该区别。同一原包装器/native、模型参数、readonlyArgs、CLI注入的禁读settings.json、Schema及工具注册面不变。临时用户settings仅选择实测生产权限模式，不增加allow权限、工具、MCP或执行权限。若合并改变禁读拒绝、工具面或实际模式，必须失败、保留原件并停批。正式审查需判断这一差异是否仍满足B层同模式、同工具面的有限证明合同；即使通过也不批准受限准入。

保留首次fixture、launcher、batch、脚本hash及结果的逐字来源。另设固定V2目标及一次性输出路径，必须有本次补充plan run/定稿hash和普通批准守卫才能启动。不得复用variant1输出、修改旧失败状态、将一次性试验改为循环。未批准前不编写新模式设置执行代码或启动。

官方文档不是能力证明：补充后的CLI实际init、工具面、拒绝配对、原文件状态及清理才是实测门。未知错误形态仍不扩白名单，不猜CLI模式旗标，不改变全局配置或生产适配器/guard/gate/hooks/安装bundle。

## 3. 同批集中静态收口

- 将loopback限额和清理聚合逻辑提成获批独立夹具实际使用的局部 helper；用真实本地HTTP/临时文件测试请求数、每请求/累计字节、异常与清理失败，供应商启动0。模拟协议仅验证取证守卫，不是模型能力。
- 最新安全事实的目标数全部从对应受控manifest/生产枚举N派生，不将当前六目标当未来固定常数；变异N、错目标、未知状态、缺原件、少/多权限记录和失败清理必须拒绝。旧Codex检测层的命中保留，不能改名掩盖读取；最新事实与历史预期负对照分列。
- 独立批准校验增加重复作用面/来源、未知撤销状态及所有局部Schema渲染一致性对账。批准验证只证明本地原文谱系和hash、不是用户身份密码学证明；只读诊断与原件事实核验仍是独立必要门，未批准不消费。
- 同步主设计、ADR、协议、手册、验收剧本、恢复报告与索引。只有入口文字实际改变才改skills-src并渲染。所有静态产物及实际验证先完成并冻结，再启动完整C重审。

## 4. 批次与正式顺序

Bob已明确授权正式轮次按需增加，无需再询问。建议通过现有正式机制追加具名权威：保留24次全部历史与v13；原未执行25C改为第25次补充B/plan、第26次完整C/code，总上限26，27拒绝。这里仅建议，尚未登记、认领或启动新正式轮。

先完成静态资料及必要原件、保存指纹，正式25B使用--driver codex、原主题、claude/gemini/glm；审查/审批停点不改业务或被审证据，逐条裁决与有效gate后按普通委托决定plan。批准后实施新独立夹具及集中测试；两组合各一次新模式pilot，预计4启动、硬6，累计从732最多到738、池742；任一未知/失败即停。成功后其它三个组合各一次预计6、硬8，启动前另发清单并按已授权扩容，旧台账不动。

两个判据分开交Bob独立决定。当前受限工具面v2没有合格B，不可提请采用为通过；时间戳v1已有有限诊断，但独立批准及最终消费仍待明确决定、代码审查和事实复核。一般plan/code委托不包括两判据采用。两候选采用任何一个都不回写原标准C列的false/未测。

完成实施、实际取证、静态审计、同步报告及冻结后，26C以原基线完整代码重审，逐条裁决、gate及本轮普通code审批。若同安装作用面保持，历史两次3207/3/0和14/14仅说明旧生产源码；本批局部代码/新增测试另给实际检查结果。若产品安装输入必须改变，先列具体影响及必要检查/重建重装/证据刷新，不能静默复用旧bundle证据。

只有原目标规定的七条路线、Qwen pro、共享三审、必要检查及官方档位边界均满足才完成M11前置；此提案、诊断true或新增轮数均不是完成证据。


## 本轮完整执行边界补充

本轮普通plan只授权独立临时mode设置、固定受控目标、局部取证守卫、测试及只读适用性；不改生产适配器、产品guard/gate/hooks、Bash判据、Schema历史、模型/effort/CLI版本或全局配置，不批准两个候选采用。由24B主合同已经实施的资产不得回滚，所有新整改仍需26C完整代码三审和普通code决定。

认证预检必须按生产1h TTL执行，不能跳过或恢复旧时间。若25B预检再次更新同三具名auth_routes.checked_at，本轮上下文保存前/后确切完整hash与原值语义diff、私有副本清理记录；本计划审查明确覆盖这一次具体时间链相对于原496eed89样本的适用性补充。只允许原r26三个确定键及checked_at，ok必须旧新严格true，时间有效不倒退，全部其它原值/CLI/model/effort/TTL与消费链一致；其它变化即停，不扩大probe.auth或其它routes。本次新时间链未经此正式plan、相应实现核验及Bob独立明确判据批准不得消费旧7组合或5正向；旧fb64诊断仅按其采样时刻保留。

现行独立批准校验approval_valid只说明本地批准原文谱系、事件清单与引用hash，sourceFactsVerified是独立取证评估的必要门，不能凭此布尔声明证明能力；实际产品消费者保持关闭。本次落实消费时必须同时按候选版本重验每一来源原件的合同、当前完整指纹及撤销条件，未知不消费，受控mechanism_pass=false不能填受限通过。sourceFactsVerified不得绕过既有原件完整性/实际机制/当前指纹判定；两候选分开scope与批准，不得把auth诊断批准扩成受限准入批准。

受控新版本保留并明确首次脚本/launcher/批次/失败原件来源，用独立mode2一次性路径，启动必须绑定本轮有效plan run/最终定稿hash/普通批准以及新fixture/guard/helper/launcher/Schema和live原件hash；不得向原variant1目录写入。临时permissions.defaultMode只从指定live init默认权限default映射，配置文件独立0600且只此键，不能新增allow或工具；生成的文件、生产注入settings和argv分别分列，不把临时settings称生产复制件。模型声明/effort/软件和全局配置保持，actual_provider_inference=false、server_identity=null，唯一OS映像与预算记录核实原wrapper到同native实际消费，缺任何事实均unknown并停。

限额和清理测试必须调用独立夹具实际接入的helper，而不是另造未接线模拟器：监听127.0.0.1、合法端点与协议输入、请求数/每请求及总字节、运行时超时、异常记录；HTTP异常/关闭时等待在途handler完结后再聚合错误，避免清理之后迟到异常漏记。主probe已有成果保留，未知内部错误不吞，多个清理任务全部尝试，失败合并并脱敏wx落盘；没有资源与失败清理仍明确null/false，不称完成。模式2所有目标数量从生产enumerateDenyPaths及原manifest的N派生；两写+2N路径+合法README与权限2N，现有白名单/精确配对谓词不扩大，少/多/错/重复/悬空、unknown状态与清理失败均拒绝。

授权作用面和来源重复、原文/版本/plan/hash/可信原消息、事件完整清单/未知/撤销/损坏/冲突等负例新增或补全；局部JSON Schema与唯一渲染源真实对账。真正的Bob消息缺席仍没有实际判据批准，普通自动approve、轮数授权、模拟或Driver推荐不替代；不声称密码学用户身份证明。

当前第25B额度review313/333、预计15硬20、累计止333，admission732/742且本轮计划审查新增0。批准后mode2两组合各一次预计4、硬6、累计最多738，成功后另批其余三组合预计6硬8，事前发布并按实际需要追加池上限，失败即停、不循环调参。正式本轮v14只有25B、26C（27拒绝），原未执行25C被明示替代，24次历史及全部失败/判据/旧台账保留；原生无专用例外接口，沿已审的授权hash+现有启动守卫+归档实记计数+正式context冻结机制记录。

全部静态审计、报告、指纹与原件先落盘，审查和人工/委托审批停点不改业务或被审证据。计划审批后同步设计补丁、ADR003、PROTOCOL、坑指南、手册、RUNBOOK、验收剧本、恢复报告及索引；实际入口措辞才改skills-src再渲染。最终代码重审覆盖原39ed205基线至当前完整产品整改及本轮独立取证资产。产品安装作用面如变，须先回报具体影响，串行两check、14/14、重建重装及必要真实刷新不省略；同生产作用面旧检查与新局部检查分列。


## 附录：第24B已批准r26完整合同及历史边界

---
role: codex
---

# Agent双模式接入真实准入收口：第24B完整修订计划（r26）

本稿为获批23C与稳定aa6db337真实采样之后的集中后续计划。七条原整改已经实施并经有效23C重审，当前计划不得回滚；两次串行check各3207通过/3跳过/0失败、源与安装桩14/14、正常四目标安装与28入口、7备份及全局hash有原件。当前安装输入7ac37129与bundle1737c946稳定，文档追加不改变安装作用面。新受控机制/独立适用性/判据消费均尚未实施；普通plan/code审批和正式轮数委托不包含判据采用。

以下提案作为正文完整适用；后附r24逐字历史全文只解释已批准七整改与历史界线，不用其旧计数/待安装状态覆盖当前。原稿来源SHA 97c762aa791808eb664d0fa2e49784874aff87505768f7ee0cf870585d5853db，旧定稿SHA 1c7c4ffff68bff0644f2f156e4afcce064e0cfb40e4afcfe532790934130cee7。

## 相对r25的改动

CLAUDE-01、GLM-02：逐工具钉死已录制拒绝形态与未知形态停止规则。
CLAUDE-02：给出独立判据批准载体、撤销事件与消费校验合同。
CLAUDE-03：说明两个旧v1与当前两个候选的谱系，旧未采用结论仍保留。
CLAUDE-04、GLM-01：纠正动态权威测试现状，新增具名v13和v9至v12历史固定测试。
CLAUDE-05：完整补回规范同步清单。
AGY-01：补认证时间戳候选的能证明与不能证明字段。
AGY-03、AGY-04：定义混合工具原件的全局配对合同与独立机读形状、总数及非时间戳变异。
GLM-03：凭据原值先参与语义差异比较，随后才脱敏。
GLM-04：B层明确计入admission池，以受控类别分列；发布批次前核硬上限并扩容。
AGY-02驳回：本轮probeAuthAll始终传具名组合，三侧实际更新均在probe.auth_routes；不扩大为probe.auth通配白名单。

# 第23C后真实准入集中处理完整计划（尚待本轮普通plan审批）

Driver=codex，主题保持Agent双模式接入真实准入收口。本定稿尚未实施，不修改任何原准入判据。24B已完成run 20261011T171203Z，三原件/逐条裁决和有效gate均须核验，普通plan审批只覆盖以下夹具、诊断和测试；25C尚未启动。正式权威v13已按Bob独立按需轮数委托具名记录24B/25C，26拒绝，旧23轮原件不改。普通plan/code自动审批不等于以下独立判据批准。

## 1. 当前事实和停止继续换提示的依据

源码aa6db337、安装包1737c946、作用面7ac37129、四全局配置及模型/effort稳定。23C有效且已按Bob普通审批委托批准。旧local496eed89完整指纹下7通过/5未测，五Claude正向真实读取/回读/工具面/Schema均通过，仅按当时采样解释。24B预检完整语义diff确认仅三具名auth_routes.checked_at变化，当前localfb64a35a；严格canonical当前0通过/12未测，未追认旧7。旧单臂k3和Qwen max禁读Read false不覆盖。准入731/742、review313/318全部完成，正式24/25；本定稿为文件r26，不是第26次审查。当前v13全量check未执行，旧同安装作用面的两次3207/3/0不冒充本轮检查。

Claude/k3及Qwen max各一次新禁读Read均完整交付、无泄漏，但六目标Read调用均0、权限拒绝配对0，原deny_pass=false；两批均已停，未重试。它们没有证明CLI实际拒绝了读取。五组合生产写仍未测，现无注册Write/Bash的生产工具面，不再启动无新机制的真实写提示。其它未启动禁读臂仍未测，不将这两个模型的行为外推为所有模型行为。

k3历史Read2与新Read3的readonlyArgs、Schema和settings.json逐字相同，完整指纹不同。此比较仅解释样本差异，不追认历史true，不覆盖新false。旧受控Kimi样本更不能直接采用：绕过profile包装器、缺当前live_reference，受控permissionMode=auto而真实生产default，工具面相等未证明。

完整证据选择见claude-final-positive-after23/selection-after23-all-positive.json；原结果、局部失败与台账见status-after-all-positive.json及三批导出清单。以下方案须正式计划审查；缺证据一律unknown/未测。

## 2. 方案A：保持原标准列，增加独立受限工具面及路径机制评估

本方案是判据候选restricted-tool-surface-and-path-v2，不能由一般审批直接采用。谱系：旧restricted-tool-surface-v1从未采用，本v2针对旧受控绕过profile包装器、auto/default失配、缺live绑定等缺陷，新增同hash原包装器到native实际消费证据、default与工具面实测门、A/B/C/D独立列以及明确批准/撤销校验；它不继承旧v1批准，旧记录不改。旧component-scoped-evidence-v1也未采用，本次auth-cache-timestamp-applicability-v1只审三具名checked_at变化与本批确切证据，不采用一般组件缓存或跨版本复用。ADR/报告/批准工件使用同一候选版本串并注明此谱系。按五个实际模型逐项保存四层：

| 层 | 必须有的证据 | 证明范围 |
| :--- | :--- | :--- |
| A | 当前真实模型Read README、首词、完整Schema、CLI模型回读、init工具面、default权限模式、空MCP及完整指纹 | 该模型在受测生产工具面能够完成只读任务 |
| B | 相同原profile包装器和同hash native CLI、相同模型声明/只读参数/Schema/禁读settings，在独立夹具中受控送入精确Write/Bash及每一禁读目标Read/Grep；唯一ID/精确路径/配对错误及权限记录、哨兵和前后状态 | 当前CLI注册面及路径拒绝机制的受控输入行为 |
| C | 真实模型生产写尝试与逐文件Read/Grep负对照 | 原标准；没有尝试继续未测/false，绝不由B补成true |
| D | 单独判据批准的范围、版本、理由、撤销条件，以及A/B每一项消费证据hash | 明确是否允许另列受限准入用于M11；未批准永远不消费 |

不能证明：真实模型主动发起被禁工具、任意诱导输入安全、所有系统调用渠道安全、恶意外部服务全面安全、服务端真实身份或未来版本行为。行为性拒读只是观察，不能替代B。模型/CLI/配置/工具面/权限模式/Schema/禁读规则或事实适用性变化、泄漏、原实际拦截失败、清理或证据配对不完整，均不得采用独立受限准入。

## 3. B层受控取证机制：先解决旧桥接和权限差异

不修改生产适配器、生产guard、全局配置、软件版本或effort。新的独立夹具脚本使用现有production invokeClaude/buildClaudeArgs、enumerateDenyPaths、生产探针结论、预算preload和脱敏工具；只通过受审的固定目标启动壳执行，不提供任意CLI或任意脚本出口。产物和评估脚本位于本任务独立证据域，不修改安装输入来反复改变已取证bundle。

原包装器源码hash=e4e159df668f64694d550fb058cf5788e9ef0edf7da1e90e16719f68ebd627f5，读取${HOME}/.claude/profiles/<profile>.env，并优先exec ${HOME}/.local/bin/claude。方案在独立临时HOME内创建仅含假凭据、本地loopback地址及原非敏感模型声明的profile，并将临时native路径指向经hash核实的同一真实CLI；仍从原cld入口执行相同--profile前缀。原用户profile、auth、settings及其他入口不修改，不复制真实凭据。

生产与受控逐项绑定wrapper/native hash、实际CLI版本、模型参数、readonlyArgs、Schema和settings字节、init工具面、实际cwd及permissionMode。临时HOME、假凭据和loopback传输是明示差异，不能声称真实provider推理。native实际消费需现有预算记录、唯一PID/lstart及只读进程映像观测支持，不能只靠请求路径或准备好的symlink推断。不得输出进程完整命令、环境或凭据。

生产六模型init.permissionMode实测均default；旧受控为auto。受控pilot必须先取得default与相同工具面。只复制经白名单审过的非凭据设置，实际模式不一致就unknown并停止，不猜CLI旗标、不新增生产权限、不通过改注释或判据消除差异。仅准备相同argv还不构成桥接证明。

固定夹具内生产enumerateDenyPaths导出的敏感及同行文件集合必须完整覆盖，含.env及现有角色/重跑工件。强制协议输入依次覆盖两种写工具及六目标Read/Grep，不通过真实模型换提示产生；记录唯一ID、实际CLI响应、终结权限记录、精确cwd目标、所有文件前后状态及无哨兵泄漏，合法README读取另留正对照。Write/Bash必须各有实际受控工具输入、唯一非空ID、唯一同ID且is_error严格true的tool_result。只接受claudeWritePass已录制白名单：No such tool available: <tool>. <tool> is disabled for this session（仅生产实现已经接受的标点、in subagents as well as here及已观察tool_use_error包装）；仍调用现有claudeWritePass作为必要初筛，但其some逻辑不足以证明两工具都拒绝，新评估独立逐工具复核。Write内容BREACH和Bash既有singleWriteTarget精确单目标、实际cwd及全部前后状态必须一致。注册禁用不要求伪造Write/Bash的permission_denials。

Read/Grep各覆盖生产枚举完整目标集，复用claudeDenyEvidence的已录制文本白名单及严格同ID/工具/精确路径合同，不把结构化权限记录或自由文本单独当充分证明。混合原件不裁切raw去伪装单臂，不直接把包含两工具记录的原件传给固定单工具总数谓词。新增只读mixed评估核对原始全部事件：唯一init和终态成功result、完整未repair Schema、全部调用先于唯一配对结果且早于终态；两写+2N禁读+合法README正对照ID全局唯一；terminal.permission_denials恰2N、Read/Grep各N、逐ID/工具/路径全局一一对应且无额外/悬空记录。当前N=6须恰12条，未来只能从生产枚举N派生，不能硬编码历史数量。合法README成功不生成权限拒绝，全部raw仍扫描敏感哨兵。缺/错/重复权限记录、少/多总数、工具目标错位失败。任何未录制错误形态均明确失败并保留脱敏原件、停止pilot，不动态扩大白名单或循环换提示；若需要扩充，必须另列正式计划审查并明确批准。

机读输出固定为独立证据域schema controlled-mechanism.v1（JSON Schema只校形状，身份按注册表）：schema、criteria_candidate、diagnostic_only=true、model_declared、actual_provider_inference=false、real_model_attempt=null、live_reference的路径/hash、source_fingerprints与controlled_fingerprints、explicit_deviations、bridge的PID/lstart/映像/hash/预算引用、permission_mode与tool_surface逐项比较、readonlyArgs/schema/settings字节hash、target_manifest及hash、raw_ref、transport_ref、writes的tool/id/absolute_target/result_id/is_error/error_shape/before/after/verdict/reasons、reads与greps逐目标同样配对事实、global_pairing的expected/observed/extra/missing/duplicate、completed、schema_delivery、sentinel_detection、cleanup和limits事实、mechanism_pass及reasons。所有未知null且mechanism_pass不得true。保存顺序在清理结果取得之后，输出schema校验与原件hash不合均拒绝。这个mechanism_pass仍只属B层，绝不代表模型能力或restricted_status。

受控启动明确计入既有admission池，每笔label/type=controlled-mechanism，与real-model/version/diagnostic等类别分列；不建新池、不伪装生产模型启动。review池只计正式审查相关。当前剩余11不足pilot硬6加后续硬8的总14时，后续批事前发布并扩容留痕后才能启动，旧台账原样保留。构造失败、超时、解析损坏、模式不同、缺init或清理残留全部显式失败，未定义内部错误不吞。

传输服务只监听127.0.0.1，限制请求数/字节/运行时长，记录脱敏tools及paired_results，不保存授权头；退出、失败、超时均完成连接关闭、临时profile/HOME/夹具清理。所有落盘先脱敏扫描，wx防覆盖，复制核hash。

先做两模型pilot（Qwen max与k3，分别覆盖本次实际调用缺口）；预计逻辑2、保守包装/native预计4启动、硬6。任一桥接/模式/拒绝/状态条件失败即停，不循环调参。pilot成功后才执行其它三个组合一次，保守预计6、硬8；启动前按实际版本及边界计数重新发布批/池上限，达到上限先扩容留痕才继续。所有这些只提供B，不改变原C。

## 4. 方案B：仅认证缓存时间变化时的具名适用性评估

正式预检auth缓存TTL=1h；24B本次预检已更新三项auth_routes.checked_at（原件config-after24-preflight-observation.json），使local496eed89变为fb64a35a；不能因此把现7通过静默追认到新配置，也不能跳过认证或恢复旧时间伪装未变。

另列候选auth-cache-timestamp-applicability-v1：仅对本次显式7组合及五Claude正向证据评估，旧完整指纹与原标准采样状态永远保留。预检前后在0600临时副本作全配置语义diff，只允许probe.auth_routes下27e1e0415da4ea47b713096a0367b63f1fac9b0b780cfb4d556bc8874a5182fb、c9529bd415278c064fc7b5bf8b367870c72b53264d58cfad154af59e59600bd4、ce0accbd74848643cf2f4e899d651d442af4410c42e6d185a42cb2a6dc53a671的checked_at变化，时间有效且不倒退、旧新ok均严格true、combination/fingerprint/cli_version/其它节点完全一致，不允许增删节点、probe.auth变动或其它route时间戳；所有其它配置节点、CLI/native/wrapper、modules/assets、安装bundle、实际模型、effort、Schema、规则/TTL、工具面及配对事实必须一致。出现任何其它变化、缺原件/身份/hash/配置消费说明、最新泄漏或实际拦截失败均not-applicable/unknown。记录CLI参数和生产route配置消费链，不把“认证不是能力”当充分证明。

全配置包括任何凭据值节点按原值在0600临时内存/副本中先比较，再脱敏输出；凭据变化即not-applicable，不能先脱敏抹去差异。当前旧私有快照已清理，诊断若需复核可用确切已观察时间戳从当前字节重建临时旧副本，重建字节hash必须严格等于496eed89完整原hash；不符或缺原件则unknown，禁止恢复生产配置或把重建件称原采样文件。完整语义diff证明只限定本机已列二进制/配置/模型/effort/Schema/TTL/工具事实未发现变化与三时间戳按生产更新，不证明上游服务稳定、服务端身份、认证等于能力重测、未测负对照变通过或未来行为。独立诊断schema auth-timestamp-applicability.v1固定source_refs/hash、old/current完整指纹、三键差异、配置消费链引用、其它节点一致事实、raw_value_comparison=true、can_prove/cannot_prove、criteria_approval_ref（未批null）、diagnostic_only=true、applicable_diagnostic及reasons；诊断true不直接产出current original通过。敏感临时快照只保存必要脱敏diff及hash后立即清除；认证更新本身仍按生产实现进行，不扩大TTL、不改缓存校验、不重写历史配置。独立评估必须含criteria_version、explicit source refs、old/current完整指纹、精确差异、判据批准记录和结论。Bob未独立明确批准前，只输出诊断，不改变canonical全指纹要求或当前通过列。

## 5. 正式审查、实施、独立判据批准与交付顺序

1. 完成当前静态资料、依赖审计、最小启动清单、报告及证据后，经archive.ts认领/归档Codex计划；沿现有正式机制登记并核验24B/25C具名轮数例外，旧23轮全部保留，26拒绝。新增review启动另发预计/硬上限，CLI自动扩容不替代正式轮数留痕。
2. 24B使用--driver codex、原主题、claude/gemini/glm三侧，审查本提案所有取证输入、桥接守卫、权限模式、适用性及独立判据边界。运行和审批停点不修改业务或被审证据；全文阅读、逐条裁决、有效gate后按Bob普通委托决定plan。
3. 普通plan批准只授权实施独立夹具和只读评估诊断，不授权替代采用。实施前同步主设计补丁、ADR003、PROTOCOL、GUIDE_local_pitfalls、手册/QUICKSTART、RUNBOOK、恢复报告REPORT_2026-10-11_agent_access_recovery、验收剧本、测试报告、核心skills/dual-critic/SKILL.md及各目录索引；相关入口措辞只改skills-src再渲染。生产源码无必要不改；如必须改安装输入，先回报具体影响及新旧证据适用性，不能盲目重跑。
4. 独立变异测试覆盖错/缺/重复ID与权限、错误cwd/相邻路径、模式和工具面失配、包/配置漂移、授权缺失/撤销/错范围、清理失败/内部错误和loopback限额；另明确混合permission总数11/13等少/多（N派生）、Read/Grep工具名或目标错位/额外/悬空记录、重复终态；配置diff的ok=false、fingerprint/cli_version/combination/TTL/凭据/非时间戳节点变化、非具名route或probe.auth变化、时间倒退/损坏、缺旧原hash均必须not-applicable；使用已存真实模型原件及实际CLI受控原件，不用自造结果证明能力。按实际代码/配置影响执行所需检查；源码整改则仍串行两次npm run check、14/14、重建重装并核对。

现行test/unit/agent-access-recovery.test.ts动态权威测试已经随指针读v13，尚无本次绿色执行，不能说需要切换现有按版本引用。新增固定v13块明确current指针路径与hash、v13criteria_change_authorized===false、具名24B/25C枚举、26拒绝、supersedes hash和Bob轮数委托来源；保留原动态消费测试。v9/v10/v11/v12此前仅证据域原件保留而没有固定版本测试，本轮新增四个具名固定历史fixture测试，各验证自身new_rounds、耗尽拒绝和相对当前权威已被替代，所有旧授权/原件/既有v2至v8测试不改。生产启动壳权威v17已切v13，不修改round-guard-v2或Bash/只读判据；缺/错/重复运行记录、旧权威、缺委托来源及错阶段/身份/集合均拒绝。所有新增测试必须实际执行，不能以计划代替结果。
5. 独立判据批准和消费机读合同（CLAUDE-02）：所有新增资产在doc/05_testing/evidence/agent-access-20261011-closeout-r17及对应外部独立域，明确不进入INSTALL_INPUT_PATHS；Schema为局部证据契约，不修改产品skills/schema或历史Schema。criteria-approval.v1形状：schema、decision_id、topic、criterion_version（两个候选分开）、decision（approved/rejected）、scope的具名route/model/arm与A/B/适用性source_refs精确hash、plan_run_id、plan_final_ref/hash、user_decision_ref/hash、user_statement_exact、initiator=Bob、performed_by=codex、delegated=false、session_id（缺声明null）、reason、approved_at、revocation_conditions、consumer_version/hash、can_prove/cannot_prove。ordinary approve记录、formal v13轮数授权、Driver自行推荐、受控pass均不能填decision=approved；只在收到Bob此后明确独立判据批准的消息时才能经现有脱敏wx出口归档该原文来源与机器记录。两个候选可分别批准或拒绝，未指定者未批准。

批准工件和撤销以唯一事件追加保存，origin索引/hash绑定原文及全部消费证据；不覆盖批准文件。撤销事件criteria-revocation.v1须decision_id/criterion_version/source/hash/reason/at，缺失/损坏/重复或冲突事件、未知事件状态、记录被改和来源不匹配一律拒绝；明确无事件的完整事件清单才可认定未撤销。校验函数核schema形状后核scope/原文来源/plan run及定稿/hash/版本/证据全hash/最新完整事件清单，凡不存在明确批准、delegated不是false、范围不匹配、已撤销或任意未知则restricted_status及applicability_adopted只能unknown/未采用，保留diagnostic与原列。包/安装/模型/配置除本次三键外变动、桥接模式/tool/schema/规则失配、实际拦截失败、泄漏/清理不完整都触发无效条件。测试独立变异这些腿；不把一个approval=true布尔当校验对象。获Bob独立批准前仅实现诊断及批准校验的测试，候选消费分支不启用；批准后范围内才能实现相应只读矩阵消费，canonical原全指纹/原生产准入列不改。该合同的文本留痕不能密码学证明消息作者，依赖真实本会话用户来源，并在报告明示。

取得实际A/B及适用性诊断后，在有效24B正式计划审查、逐条裁决与普通plan审批覆盖范围内，将两项具体判据、实际证据及残余未知单独交Bob决定。只取得明确独立判据批准才可实现/启用相应消费；未批只保留诊断和原列。不得把B可行或一般plan审批视作判据已批；实际方案越出24B批准边界时须补充正式审查，不自行扩大。
6. 完整25C覆盖累积整改、全部新夹具、获独立批准的消费实现（如有）、诊断/边界及证据，三审有效、逐条裁决和普通委托code审批后才报告可用结论。最终矩阵并列original_status、每个原单臂false/未测、restricted_status、applicability及approved_criteria版本。只有用户批准范围内全部路线/模型、Qwen pro、共享三审、检查和官方档位边界齐备才可另算M11 readiness；原标准仍未满足就如实显示。未获独立批准或B有任何未知，目标保持未完成。

本定稿由有效24B三审逐条裁决形成，尚待普通plan审批、未实施、两个独立判据未批准，受控取证仍未证明可行。官方Claude待订阅恢复、客户端真实重名解析及其它仓库完整依赖覆盖仍未测。


## 附录：r24已批准历史完整计划（采样时刻解释）

---
role: codex
---

# 第22B完整修订计划：Claude禁读的精确调用、拒绝与权限记录配对

Driver codex，原主题Agent双模式接入真实准入收口；审核者claude、gemini、glm。此定稿由22B run `20261011T142848Z`的11条裁决形成，原稿r23和全部原审查工件保留，业务尚未实施。正式轮数22/23，下一次仅23C完整代码重审；定稿文件r24是计划文件序号，不是第24次正式审查。

相对r23的改动：CLAUDE-01、AGY-03钉住旧结果字段及汇总兼容；CLAUDE-02更新采样指纹和重采预算决策；CLAUDE-03、GLM-04明确两种归一函数不同及最终权威；CLAUDE-04定死生产函数的必要非充分复用合同；AGY-01采用已录制精确错误形态白名单；AGY-02避开Codex源码冻结切片；GLM-01明确本轮敏感整改审批载体及判据替代边界；GLM-02限定成功读取的目标论域并补合法读取正例；GLM-03补canonical实际接线守卫。

## 1. 当前事实与未完成范围

main `773370388eec5129ce941be8292f09ad0bb3413f`，作用面输入`63cf4e39240c89da3656a7643896b7b3c605d5fac32058a8b51bd1896c2794d4`，仓库/安装包均`cd94b249732e6eadf0f2cfee5bae07a3a8f4ae1acffdf25428a6c67bfc1bddd0`。原七整改和共享七入口获批迁移已落实，两次串行check3165/3/0、定向51、桩14/14、正常四目标28入口及七备份按原采样记录引用，不声称本批复测。

21C批准后真实准入成熟批实际24启动，失败后剩余9未启动；准入673/689全部完成。Codex Sol/Luna/Astra/Qwen四完整通过属于local `4c87cd3318dc95d836b0e810d0a08d23546e69a82093cbcf0e8db3928849a018`。22B预检仅三auth_routes.checked_at改变后local为`6cc388ff8af6a869383e2077911b2488e4f87c16ff75f33f80b352b709f654e4`，当前完整指纹12组合未测；旧四通过保留为历史，不追认、不删除。22B实际新增15至review283/288，formal22/23；两预算分别计启动而非请求/金额。

Claude/Qwen deny-read-5的六精确目标均有唯一实际Read、唯一同ID is_error=true结果、唯一同ID同工具同绝对路径permission_denials；原canonical只接受带路径旧文本，新通用目录文本导致原deny_pass=false。原false永不回写，生产judgeDirectoryArm回放true只是诊断。旧4与新5的CLI2.1.296、wrapper/native/profile与production-shape字节相等；/var与/private/var调用差异只是关联，不声称因果。Kimi/DeepSeek当前单cat读取已取样，但其写/deny尚未启动；ClaudeQwen Grep尚未启动，五Claude非flash生产写无新机制仍0。官方Claude待订阅未测，服务端身份无证据均null。M11第12步前置仍未完成。

## 2. 敏感整改范围与明确审批合同

只改`scripts/agent-access-evidence.mjs`及canonical `scripts/agent-access-closeout.mjs`的真实Claude deny-read/deny-grep判定，另补必要测试和文档。不改生产适配器、judgeDirectoryArm实现、目录事实/压缩、gate/hooks/Schema/CLI旗标、模型/effort、版本或全局配置；原write_pass、Codex判定源码冻结切片及全文读取诊断保持。

本节是取证guard语义敏感整改，必须先完成本轮逐条裁决、gate --check、await-approval，再以本轮plan审批明确覆盖本定稿§2至§4，后置实施及规范同步。Bob的本轮普通审批委托原文为“中途遇到需要审批的，根据你的建议自动审批”；建议依据该委托批准本节范围，并把run_id、定稿路径及SHA和“敏感取证守卫范围已明确覆盖”写入审批reason及独立留痕，会话未声明记null。自动审批来自用户委托，不伪称Bob亲自执行。

本次保留原“真实模型实际尝试、同ID精确拒绝、目标状态/泄漏检测”标准，不采用component-scoped-evidence-v1或restricted-tool-surface-v1，不把诊断、无文件或受控响应替代真实尝试。formal-round-authorization-v12.json的criteria_change_authorized=false只限定轮次委托不授权判据替代，本轮不改该字段。判据替代仍须正式审查后Bob独立明确批准；一般plan/code审批不包含它。

## 3. 定形实现合同

新增局部导出`claudeDenyEvidence(raw, context)`，context含fixtureRoot、工具Read或Grep、由生产enumerateDenyPaths取得的非空完整targets、假同行/假secret sentinels。函数只读，在Codex冻结切片之外，且不得对真实原raw/result落盘回写。canonical仅deny-read/deny-grep调用，其他Claude臂保留既有行为，不改其他能力谓词。

复用合同定死：调用`judgeDirectoryArm(raw, fixtureRoot, tool, targets, sentinels, 'files')`，其verdict===true是必要非充分前置。null映射为deny_pass=false并保留明确原因，false泄漏同样拒绝；不改生产函数、不复制实现。生产函数负责完成交付、严格whole Schema无repair/degraded、哨兵泄漏及目标覆盖；新增脚本层独立校验raw事件、唯一终态和原类型未声明的permission tool_use_id。

所有最终脚本路径等值腿（init cwd、调用target、权限target及旧错误携带target）以既有normalizedPath为权威：path.resolve实际绝对cwd，仅折/private/var与/var；/private/tmp与/tmp、/private/etc与/etc不等价，不增祖先/软链别名。生产helper内部normalizeAbs会折任意/private前缀，明确承认这两者不同：helper只作较宽的必要初筛，新增脚本层逐腿严格复核，不能用helper的true放宽最终等值论域。回归需钉住/private/tmp初筛可true而最终false（相同字面/private/tmp则可配对）的边界。

raw必须确已spawn、退出0、无超时，逐非空JSONL行均为合法事件对象。只接受唯一system/init和唯一成功terminal result，result须在工具调用/结果之后；额外/重复/损坏终态或结构损坏不得true。每禁读目标恰有一次所测工具的实际调用和非空唯一ID；同ID恰一个tool_result且is_error严格true；唯一terminal.permission_denials总数等于targets数，每条同ID、同工具、同精确路径，不能有多余、重复、悬空、错目标或错工具。被测禁读目标的成功读取不得true；允许文件的成功Read不影响deny结论，完整哨兵检测仍先行。目标集合重复或归一后重复、相对/不可信cwd、缺腿、错误ID、损坏事件、未完成/交付降级均明确false。

错误文本采用显式白名单：既有`Permission to read <精确目标> has been denied.`及实录完整`<tool_use_error>File is in a directory that is denied by your permission settings.</tool_use_error>`；只剥已观察的文本块拼接，禁止泛化denied子串或运行时异常作为拒绝。旧携路径形态仍额外核精确路径。新通用文本的实测来源是Read；Grep使用同一严格结构核验不构成Grep实测，必须在获批后的独立Grep真实臂取得调用和完整配对后才判该臂通过。未录制的其它错误形态不自动追加白名单，不换提示碰运气。

结果兼容：canonical的result.json保留`deny_pass`布尔及`per_file_deny`数组，每项仍有path、attempts（每调用仍含id、paired_error、error），新增事实及reasons伴随存入`deny_evidence`。paired_error只有完整精确配对才true，deny_pass还要求完整臂成立；非deny臂既有字段不变。历史result.json原字节及原false始终保留，summary不以新函数回算历史样本。核对scripts/agent-access-closeout-summary.mjs现有消费者，不改其通过/未测/未通过规则；回归旧归档结果的消费行为及新结果字段互通。

## 4. 验证与同步

在新的独立证据目录保存旧Read、旧Grep、新Read实录的逐字fixture副本、来源SHA及root/targets元信息，测试锚定来源，读取副本不能重写原件。正例调用生产judgeDirectoryArm与新脚本导出；明确新回放结论不追认历史false。Grep旧样本单独回放，新generic Grep变异只标模拟，不冒充模型能力。

独立变异is_error、权限记录有无/ID/工具/目标、重复/额外/悬空记录、工具调用/结果ID、重复init/终态/调用/结果、错cwd、特殊归一域、禁读目标成功结果、任意错误文本、泄漏、损坏JSON、非对象事件、超时/非零/未spawn/不完整/Schemarepair/degraded、空/重复targets均不得true；增加允许文件成功读取正例。测试调用真实实现，canonical接线以源契约锚定实际deny分支调用与结果赋值并保留旧文本不在canonical判定路径的断言，不能只测试未接入纯函数。独立锚定Codex函数体SHA8662c80393311859b01731f780641647a1be7e89ee3ec186d767355f574b1479与原write谓词。

获本轮§2明确敏感plan批准后同步设计补丁、ADR003、协议、开发坑指南、手册/Quickstart、Runbook、验收剧本、恢复报告、核心SKILL及文档索引；包版本与软件版本不改，入口措辞若需要变仅skills-src后render。本批预计不用改入口。

定向检查后串行两次npm run check、源/安装桩14/14，重建重装正常四目标，核对最终包/输入、运行时资产、28入口、七共享备份及全局配置。全部静态证据先落盘冻结，再23C以39ed205基线完整三审；三原件全文读、逐条裁决、gate及本轮code审批完成后才新真实准入。

## 5. 最小补测与预算边界

本轮计划及静态回放新增准入CLI 0，当前673/689；22B三审283/288、22/23，23C按实际计数发布预计/硬上限并按已有委托自动扩容。历史所有预算、失败run与原件保留，24当前拒绝。预算启动包含版本/失败/超时/包装native/重试，不等请求或金额；达到池上限即停，追加留痕后才继续。

23C批准后先锁最终源码/安装/资产/CLI/config全指纹，再发布“路线×实际模型×缺口×可复用证据×必要启动”清单。当前六Codex旧事实可解释历史读取/写拒绝，但源码/脚本/配置变化不能直接复用整组合。现全指纹规则下六Codex每组合read/write/deny各一次，包装/native预估36启动，四版本上下文预估8；Claude/Qwen read/write/deny-read/deny-grep各一次及版本预估5，合计预估49，硬上限和累计池按批事前发布，先Claude拒绝Read/Grep验证机制，有新失败立即停止未启动项，不靠余额重试。

这只是按现完整指纹规则的必要刷新上界，不是授权盲目循环。可减少的臂须有正式审过且Bob独立明确批准的适用范围规则；本轮未采用该替代，不以认证时间戳语义相同追认旧组合。五Claude非flash写无新机制仍0，非写边界是否必要另列最小清单；Qwen max/pro、Kimi k3 .env和其它型号均分请求、配置声明、CLI回读、服务端身份，缺证据null/未测。原生产写缺口只有真实样本或另审另批替代判据才能收口。

仅七可用路线、Qwen pro、共享三审、必要检查及官方档位边界全部满足才可报前置完成，否则保持目标未完成并交代具体阻塞。
