# 相对r15的修订（第11次B/plan，run20261011T031230Z）

- CLAUDE-01、AGY-01：实时读取壳及新v2纯核验切v5（历史10ID，11B/12C/拒13）；总10的9B/10C旧边界固定读取不可变v4并显式第5参。总6/7/8历史fixture与旧guard原件继续保留。当前check在计划期对动态v4断言失配只是静态推断，获批后执行定向与全check，不把未跑的检查说成已红实测。
- CLAUDE-02、AGY-02、GLM-01、GLM-03：launch-v7第1行误写launch-v6路径且尾注误写v5，原件不回改；在当前恢复报告追加具时刻勘误，明确11B实际走v7/旧guard/v5授权。新建launch-v8.mjs作为12C正式入口，首行准确、import round-guard-v2.mjs、记录v2 guard hash；quiet-launch-v6只委托v8。v5/v6/v7字节与历史收据均保留。
- CLAUDE-03：恢复报告及doc/05_testing/README.md、r3目录README核当前总12/v5/11B口径；旧总10句保留时点标记，逐句检查其他设计/协议/手册/测试文档中的现行指针。入口措辞不涉及skills-src时明确记“未触及”，若实际改命令入口才从源render。
- AGY-03：修改recipes后先串行两次check、build、node dist/install.cjs，formal-start-precheck-v2核inputs_match与install_matches_source及settings/事实/skip全部通过，再允许12C启动；不把此序列当成准入实测。
- GLM-02：四目标安装后另核七份共享重名目录仍缺席、备份逐文件内容一致；复现即停止安装/交付，记录时点并按现有获批恢复方案处理，来源未明仍标unknown。
- GLM-04：quiet-v6白名单在预算/子进程前判mode必须tv、首个子命令token必须恰为topic claim、topic resolve或preflight。claim需唯一--topic/--stage/--driver；resolve需唯一--stage与双短横线焦点分隔符；preflight需唯一--stage/--driver/--critics；值仍交产品CLI验证，其余旗标原样透传。全部review/probe/未知首token拒绝，正反例核0 spawn/0预算增量。
- GLM-05：BRIEF扩禁若未来提出，当前v5只允11/12，第13次先停并另向Bob取得正式轮数授权后再独立审；12C不扩大为扩禁评审。原禁读与准入判据不变。

本r16正文与以下具名修订共同组成完整当前计划；历史r14全文继续置于不编号附录。接受意见仅经本轮普通计划批准后实施，不包含准入判据批准。

# Agent双模式接入真实准入收口：第11次正式B/plan三项守卫整改计划

2026-10-11；同一主题，Driver codex，三审Claude/Gemini/GLM。用户独立授权总12轮：当前10次历史启动全部计数，第11次计划审查，第12次获批实施后相对39ed20530d64a72f81f183095c6d9516632d0228完整C/code重审。原生编排器没有专用例外接口，沿用任务级current-authority启动约束；v4原件与指针逐字保留，新v5 hash绑定、13项正反核验。旧失败、10C拒绝、原审查件均不恢复或覆盖。一般审批可按本轮用户委托执行，**不包含准入判据改变**。

## 现状与审查对象

main/origin f63e339f938bd7bca1d5c22f19be101d626a7e66。当前工作树有第9B/10C后未提交的报告、审查工件、静态证据及测试；没有把这些归零伪装干净。10C run20261011T024158Z三侧结构化交付有效、无漂移；Claude major1/minor2三条接受，逐条裁决和gate通过，但本轮code审批依委托建议已**拒绝**。本计划只针对三条新增守卫问题，不把“接受”当成实施批准。前轮七项源码整改、深度7与第9B已批准内容保持；r14全文作为历史附录供对账，采样时刻旧状态不能覆盖当前。

第10次源码/安装bundle cb6f4d17052a739f66c71d30fdb18c4c7999d3d6fbbf5fdcf263f4e5cefadd26，输入885a12a5d043d5e79c3d2736b25b7db8a64bb08d6a770ee7b779de46636602bc。此前两次串行check各3139通过/3跳过/0失败，源与安装doctor桩14/14，四目标正常安装、28专用入口。七共享同名入口迁移后再次出现一次，来源未知；再次备份迁移并核内容，现在七目录缺席。其他仓库顶层指令静态抽样未发现显式路径依赖，但非全量扫描；客户端实际重名解析仍未测。源码一旦改动，bundle及完整准入指纹重新评估，不沿用cb6的能力结论。

## 三项需要本轮批准的守卫整改

1. **CLAUDE-01，生产写臂启动守卫漏项。** `scripts/agent-access-recipes.mjs` 的Claude/write启动前拒绝集合由 qwen-pro、kimi、kimi-pro、deepseek 四项精确加上 `deepseek-pro`。五臂均在预算预占与CLI spawn前拒绝，Qwen flash写及五个读取臂保持可用；补定向正反测试。DeepSeek pro旧FBB真实Write证据只在其历史完整指纹下成立，不因守卫漏项恢复当前写准入。未证实新机制之前这五臂预算0，不换提示撞样本。该脚本是安装输入，实施后重新构建、安装及核全指纹。
2. **CLAUDE-02，纯核验函数隐式自认权威。** 保留旧`round-guard.mjs`与全部历史launcher字节。新增`round-guard-v2.mjs`，`assertFormalRoundCore`第5参必须显式且满足授权结构，缺失/null/错权威均拒绝；生产`assertFormalRound`只从当前唯一指针及hash读取并显式传第5参。历史合成测试显式固定历史authority仅证明纯计算，不能取得生产启动资格。实时负例覆盖v4旧权威、指针/hash漂移、缺失/孤儿/重复/不可读原件、错主题/阶段/Driver/三审集合/入口、重复旗标、11B后只12C及超12。旧v3/v4及失败件不改；新launcher才接v2。
3. **CLAUDE-03，摘要包装器允许误用正式审查。** 保留`quiet-launch-v5.mjs`和旧launcher原件，新增`quiet-launch-v6.mjs`，首行说明新launcher路径与沿革；机械白名单只容许`tv topic claim`、`tv topic resolve`、`tv preflight`的精确形态。`review --start/--wait/--status/--cancel`、probe、误传模式及未知命令均在spawn和预算计数前拒绝。正式start/wait/status直接走新launcher、保存完整原始输出并逐字播报警告/进度。测试断言允许三类操作、拒绝类子进程与预算增量均0。无Bash豁免，不更改产品只读判据。

## 同行BRIEF证据边界：本计划先澄清，扩guard另审

10C Claude确实通过一次根Grep收到持久化结果，随后Read该结果；252行Read内容去掉行号/制表符后与47345字节持久文件严格一致，含九个项目路径，其中两份是**他侧历史BRIEF**。生产`run.deny_paths`4290项与九路径交集为零：当前枚举禁止他侧原始review意见，而BRIEF不在既有禁读集合，因此`peer_artifact_read=false`与现有判据相容。Grep trace仅看预览文本，不能说明未读到持久结果全文。首版审计误读行前缀，原件保留并以v2/严格Read复核纠正；所有原trace/guard/审查运行状态不改。

第11次三审请判断这项风险是否要求另增整改。**本计划不申请把全部`_meta`视为禁读，也不据此追认10C无任何同行上下文暴露。** 如审查认定他侧BRIEF应列入禁读，先给出精确的生成时点、自己/Driver稿和合法diff边界、持久结果解析及测试方案，再经新的正式计划审查/明确审批；在获批前不动生产enumerateDenyPaths/readonly判据，也不倒改既有运行。若本轮审查提出可在本计划里具体化的新增条款，须先逐条裁决并明确普通plan审批覆盖范围，不能静默实施。

## 原标准、取证与预算

正式审查期间新增准入启动0。已发布第11次review独立批：历史128/138，具名扩容15至153；本批预计15、硬上限20、累计批止148，达到即停后发扩容记录。admission原547/563，本批0。版本/帮助/包装器/native/失败/超时/重试均计启动；旧976预算文件及所有历史账不清零。静态证据与报告必须在review start前全部落盘脱敏扫描，审查中冻结业务和被审证据，仅编排器/预算侧车运行元数据继续增长。

当前38臂新完整指纹未获全量准入；旧848的6通过/6未测只属旧快照。原生产写必须真实模型实际尝试、唯一调用ID、精确cwd目标、配对拦截、文件前后状态；权限诊断、受控响应及未生成文件不能替代。`component-scoped-evidence-v1`及`restricted-tool-surface-v1`仍是未采用候选，不能以本轮一般plan/code审批消费为当前通过。请求、配置声明、CLI回读、服务端身份分列，后者无原件为null；官方Claude待订阅恢复，未测。保持模型/effort/软件版本/用户全局配置。


## 第11次三审合入的实施约束

**测试与权威。** 当前指针v5已生效，获批后先把test/unit/agent-access-recovery.test.ts实时用例切至round-guard-v2，核10个历史ID、11B及模拟11后12C、13拒绝、缺第5参拒绝、v4旧权威拒绝；旧总10的9B/10C用例固定读不可变v4并显式第5参，原总6/7/8用例和旧guard hash不改。测试尚未实际重跑，静态失配不可称check实测失败。

**生产接线与沿革。** 新建launch-v8.mjs，准确注释调用路径与v7→v8、v5授权、v2守卫，正式12C的start/wait/status直接用v8；其调用收据中的round_guard_sha256必须对应round-guard-v2.mjs。新quiet-launch-v6只委托v8并在前置阶段实施白名单：mode=tv，首命令序列仅topic claim/topic resolve/preflight；claim唯一--topic/--stage/--driver，resolve唯一--stage及--正文分隔符，preflight唯一--stage/--driver/--critics；其余旗标和值由编排器原CLI校验，不能以白名单代替原CLI预检。review各子命令、probe及未知模式均拒绝，拒绝前不spawn/不计预算。旧launch-v7首行误写v6路径和v5保留尾注，字节与收据不动，恢复报告具时刻勘误并写11B实走v7。

**文档、安装与复审时序。** REPORT_2026-10-11_agent_access_recovery.md先追加当前总12/v5/11B时点段，旧总10段标历史；doc/05_testing/README.md及r3目录README同步当前句，并扫描主设计/协议/QUICKSTART/RUNBOOK/GUIDE/CASE/dual-critic说明/ADR的现行指针。此次任务级launcher不改变skills-src命令措辞；若实际发现入口措辞需要改，先改源再render。完成recipes与测试后串行两次npm run check，再build及node dist/install.cjs，formal-start-precheck-v2必须测inputs_match/install_matches_source=true、完整settings不越软线、目录事实实际消费与skipped=0，才启动12C。四目标安装后复核七份共享目录缺席与备份逐文件hash一致；重现即停并记录时点、按既有恢复方案处理，客户端发现仍未测。12C明确base39ed2053，审完整diff及本轮新守卫/文档。

**扩禁轮数。** 他侧历史BRIEF是输入件而非原始审查结论，当前4290项deny未包含它；本轮不扩生产enumerateDenyPaths/readonly语义，不将10C重判。若将来决定扩禁，v5最多12轮，第13次必须先获Bob独立轮数授权、正式计划审查及审批；不能搭12C便车。原生产写准入标准和两项未批准候选始终不变。

## 实施、复审及停止条件

第11次计划三家实际入选且运行有效、意见逐条裁决、gate通过后记录本轮普通委托plan审批；若失败、降级或审批拒绝即停，不实施。先同步必要设计、协议、手册、验收剧本、测试报告与目录索引，再实现三项限定守卫与定向负例。入口措辞若改则改skills-src再render。代码/配置变动后串行两次`npm run check`、源与安装桩14/14、重建、正常四目标安装及副本/指纹核对。第12次C/code用明确`--base 39ed20530d64a72f81f183095c6d9516632d0228`完整重审；三侧有效、逐条裁决与本轮普通委托code审批才交付。审查中及审批停点不改业务文件，不用旧审批补本轮。最终矩阵逐模型标未测/未通过；七路线、Qwen pro、三审/检查和新增官方档位边界不全满足时目标持续未完成。


不编号附录：r14历史全文（逐字保留；原采样状态不覆盖r16正文）

# 相对r13的修订（第9次B/plan，run20261011T020308Z）

- CLAUDE-01：9B三家有效不齐、作废、gate失败或无本轮审批立即停止，不实施、不启动10C。既有round-guard只校启动计数/参数，不机械校审批链；该停机是Driver操作纪律，另存正负情境说明，不冒充原生接口能力。
- CLAUDE-02：quiet-launch-v5.mjs明确纳入新增面。仅用于claim/resolve/preflight的输出摘要，调用后须全文读取completed.stdout并原样播报警告；禁止用于review --start/--wait/--status。本次9B实际通过start-round9→launch-v5，正式等待/状态直接launch-v5；旧包装器不删改。
- CLAUDE-03：计划普通批准后在REPORT_2026-10-11_agent_access_recovery.md追加具采样时间的当前段，明确总10/9B/10C、三审及判据未采用/矩阵/预算；旧总8句保留为历史，逐句核现行/历史归属。
- AGY-01：当前权威测试（原62行）改按v4八ID验证9B/10C/拒11及模拟pointer；历史总8测试（原105行）固定读不可变v3、显式assertFormalRoundCore，保留7/8历史正反边界与旧guard hash。
- AGY-02：未批准判据前所有适用性诊断脚本只落doc/05_testing/evidence/agent-access-20261011-closeout-r4/，不新增scripts生产输入，不为诊断改变848 bundle或INSTALL_INPUT_PATHS。
- AGY-03：第10次正式C/code resolve及start均必须显式--base 39ed20530d64a72f81f183095c6d9516632d0228，核返回base与补丁，不能默认HEAD漏掉已提交整改。
- GLM-01：9B已完成，不能伪造其事前settings测量。本轮实际trace为26960字节、skipped0且三工具压缩事实消费，另记事后核验；后续正式启动前独立检查安装/输入、按实际stage解析路线、生产完整枚举/facts消费/settings≤131072。既有code-only precheck路径与本次事前缺口明确保留，新增v2测量/新版本launcher后纳入10C，不回改launch-v5或旧记录。
- GLM-02：无论判据拒绝或未答复，仍实施r4内只读诊断ledger及必要负例，输出historical-mechanism-only、not-applicable或unknown，approval_record缺席时current_admission_accepted=false，不更改canonical原字段、不将其消费为M11准入。判据消费实现仅在独立明确批准后开展，10C范围写清实际分支。
- GLM-03：已用于审查的launch-v5原件保留hash与旧注释；后续新版本launcher首行标实际入口及沿革，不改旧launcher伪装修复历史。

当前r14是完整定稿：下面合入以上九项；旧r12全文仍作为不编号历史附录逐字保留。接受不等于实施，普通委托审批与判据采用分开。

# Agent双模式接入真实准入收口：第9次补测机制与证据边界计划（r14完整修订计划）

2026-10-11，Driver=codex，原主题不变。本稿是已完成七条整改及第8次有效代码重审之后的完整后续计划。末尾逐字附存r12历史全文，其中“未批准/未安装/总8”等仅属原采样时点；当前操作以r14正文及以上九项修订为准。原生产准入标准始终有效。本稿批准不等于采用任何替代判据。

## 1. 当前基线与七条已完成整改

main已提交并推送f63e339f938bd7bca1d5c22f19be101d626a7e66，本轮开始工作树干净。最终运行bundle848445c9609aa6758b9580e95b6aa5d614090d18487ec534d6e57bb80520474e，安装输入885a12a5d043d5e79c3d2736b25b7db8a64bb08d6a770ee7b779de46636602bc；embedded旧head/dirty是构建时采样，不能覆盖实际提交/清洁状态，也不为了改元数据盲目重建。此前两次串行check均3137通过/3跳过/0失败，桩14/14，四目标安装及28专用入口一致。共享七入口已按获批方案备份并可恢复迁移，备份保留；客户端实际发现和其他仓库完整依赖面仍未测。

| code-r2历史意见 | 当前已实现及验证 | 本轮保留要求 |
| :--- | :--- | :--- |
| CLAUDE-01 | 真实项目sensitive_globs排序去重JSON/SHA256绑定目录事实/消费，夹具替换前取值，配置/TTL/路线/入口失配逐文件回退 | 不借补测取消这些绑定 |
| CLAUDE-02 | 3924条真实非敏感回放、8根3908覆盖及24逐文件，来源/集合hash及相邻合法路径/原数组不变 | 2290只保留历史数量，不改fixture或旧件 |
| CLAUDE-03 | peer_deny_applied防御合取和生产接线注释已纠正 | 分项守卫不是模型能力证明 |
| CLAUDE-04 | 无可消费事实0次二进制读，同精确路径本次1次、不同2次、下一调用重读 | 不加跨运行缓存，性能收益未实测 |
| GLM-01 | is_error与permission_denials独立变异，缺/错/重复权限及配对负例 | 不放宽唯一ID和精确配对 |
| GLM-02 | 仅ASCII根1—5段、后代0—2级v2实测事实消费 | 中文/空格/逗号等目录前缀逐文件，特殊文件名不外推 |
| GLM-03 | 已定义外部/夹具失败保留主probe，清空目录事实、脱敏失败和清理；未知内部错误抛 | 不扩大catch吞内部错误 |

另经独立第7次计划审查批准，SENSITIVE_SCAN_MAX_PARENT_DEPTH=7，根0、父8未覆盖；.git/node_modules排除，目录软链不跟随，匹配软链自身照原glob；同行归档无此深度上限。第8次C/code run20261011T005041Z三家有效结构化审查、逐条裁决及本轮委托审批已完成。原subject_drift/readonly_breach/引用问题失败件均保留，不恢复资格。

## 2. 路线×实际模型×缺口×复用范围×必要新增启动

当前显式variant2共38臂，完整指纹全部兼容；矩阵6通过/6未测。以下是最小清单；“0”表示没有已核实新机制，不付费换提示，不将正确首词代替实际读取。

| 路线 | CLI实际模型 | 当前原标准缺口 | 可消费与历史适用范围 | 本计划初始必要新增准入启动 |
| :--- | :--- | :--- | :--- | :--- |
| Claude/Qwen flash | qwen3.8-flash | 无，正向/Write实际拒绝/Read及Grep六目标完整 | 当前全指纹证据；旧Grep超时单列 | 0 |
| Claude/Qwen max | qwen3.8-max | 原生产写未测 | 当前读/Schema/Read及Grep有效；没有旧实际写样本可补判 | 0；仅候选被独立批准且同形基准齐备才受控1臂 |
| Claude/Kimi coding | kimi-for-coding | 原生产写未测；Read .env未尝试，完整deny=false | 当前Grep六目标/Read同行五目标；旧FBB .env实际Read可作具名历史分项，当前缺口保留 | 0；候选受控1臂；Read新配方必须机制先行 |
| Claude/Kimi k3 | k3 | 原生产写未测 | 当前Read/Grep六目标实际精确拒绝已补齐 | 0；候选受控1臂 |
| Claude/DeepSeek flash | deepseek-flash | 原生产写未测 | 当前Read/Grep完整；无旧实际写样本 | 0；候选受控1臂 |
| Claude/DeepSeek pro | deepseek-v4-pro | 本次无Write/Bash实际调用，原写未测 | 旧FBB有实际Write配对拒绝，不能自动搬入当前完整指纹 | 0；作为新增候选范围单列受控1臂 |
| Codex官方Sol | gpt-6.1-sol，CLI high | 无 | 当前原标准通过；服务端身份null | 0 |
| Codex官方Luna | gpt-6-luna，CLI high | 本次无command_execution，写未测 | 旧FBB有实际写/OS拒绝/状态；当前口头拒绝及无文件不补判 | 0；有新机制再单列1臂，不属Claude候选 |
| Codex官方Astra | gpt-6-astra，CLI high | 无 | 当前原标准通过；服务端身份null | 0 |
| Codex/Qwen | qwen3.8-flash，CLI medium | 无 | 当前精确单cat README解析/完整输出及实际写拒绝通过 | 0 |
| Codex/Kimi | kimi-for-coding，CLI max | 无 | 当前原标准通过 | 0 |
| Codex/DeepSeek | deepseek-flash，CLI high | 无 | 当前精确单cat读取及实际写拒绝通过 | 0 |
| 官方Claude | null | 订阅未恢复，未测 | 不挪用profile证据 | 0，待订阅恢复 |

Codex deny表示事后实际读取命令检测有效，不冒充CLI禁读拦截。请求/配置声明/CLI回读/服务端身份分列，后者全部null；Claude provider/effort无回读为null，已有Codex effort回读不新增默认值。原H5/5/2、FBB6/5/1、新6/6/0各按采样保留。

## 3. 补测机制与保守实施范围

首先零CLI分析src/trivium/adapters/{claude,codex}.ts、probes/{claude,codex}.ts和scripts/agent-access-closeout.mjs的实际参数/取证配方。当前adapter未提供强制具体工具调用接口，仅是本仓事实，不外推厂商CLI没有任何机制。DeepSeek pro未注册Write仍曾产生越界Write，不能把未注册解释为不可能尝试。当前Kimi主动跳过.env、Luna主动拒绝且无命令必须分别解释。

如源码/已有help显示一个尚未验证的官方机制，先保存准确旗标来源、生产同形与其改变项、预期轨迹/配对及夹具、版本兼容和硬上限，再经现有doctor/adapter验证；不手工调用厂商CLI，不改工具注册/沙箱/权限/effort来制造“生产同形”。没有这样的机制则保持未测，禁止反复改提示。新增未获本轮计划覆盖的guard语义改动仍须独立正式资格及审批，不借本次重审预算实施。

业务正常整改限（AGY-01/GLM-02）：test/unit/agent-access-recovery.test.ts历史总8案例改读不可变v3授权fixture并显式传入纯核验函数，实时读取壳单列核v4总10/9B/10C；历史7/8拒绝和旧guard hash保留。原62行实时读取壳按v4八历史ID核9B/10C/拒11及v4模拟pointer，原105行总8案例固定读v3；当前权威切换使原动态硬编码总8用例不再适用，本次尚未修改测试，不称当前全check通过。新增r4静态取证/只读适用性诊断及必要负例无条件实施；未答复/拒绝时ledger不消费判据，输出具原因的历史机制/unknown/not-applicable且current_admission_accepted=false。只有判据独立批准后才实施采用层，不能改生产canonical原列的断言。BRIEF如需运行时深度披露，只在既有第8段追加本已有规范7/8边界，不增段、不扩域；实施前同步设计原型/协议/手册并以契约验证。

## 4. 有限组件证据适用范围候选（未采用准入）

旧FBB与当前848唯一精确build-stamp声明之外编译字节相同，规范化hash48db71dfdc76716b038b39904e513d9a2e2aedcbac07c880b4e3e216f74ba2ec；38对请求/CLI/profile/model/effort/入口/native/config/canonical/thin不变，完整指纹仅bundle资产项不同，Claude20 production-shape逐字相同。但安装输入不同，coreSKILL文档变化是否影响模型上下文不能由编译字节证明；本证据不得升级为全上下文相同。

拟实现独立只读适用性ledger（doc/05_testing/evidence/agent-access-20261011-closeout-r4/agent-access-applicability.mjs与必要测试），输入显式旧/新selection及各文件hash，不选择“最新成功”，不回退缺失臂。仅给有限具名分项：旧Kimi .env Read、DeepSeek pro Write、Luna写OS拒绝；原始完整bundle SHA和采样时刻永远并列。核原件完整hash/actual模型/唯一调用ID/实际cwd精确目标/拒绝/状态、CLI/native/入口/包装器/配置、生产规则/Schema/工具面/提示hash及TTL。TTL沿已有被消费事实类别规则，不随意把目录TTL套全部能力；若某类原无TTL，记录原无TTL及未知漂移，不宣称永续。

构建戳匹配须两个bundle各唯一精确声明、严格全量其余字节hash，任何额外差异拒绝；不能任意删注释/空白/版本字符串。缺component inventory或上下文资产消费证据、模型/规则/配置漂移、缺实际配对、最新泄漏/真正拦截失败等一律not-applicable/unknown。新无尝试可与历史样本并列，不能覆盖新采样。仅允许采样时刻机制证明的具名历史引用为正常文档行为；若用来补当前准入，必须另行明确批准“component-scoped-evidence-v1”，机器输出criteria_version/approval_record/source/current_full_fingerprint/differences/applicability/reasons/current_original_status；批准缺失永远不accepted，原write_pass/deny_pass及canonical全指纹要求保持。

当前证据不足证明全部模型上下文一致，候选可能无法消费；遇此结果不降低条件，也不因此准入。即使有限复用获批，也不能补四个根本没有实际写样本的Claude组合。

## 5. 受限工具面准入候选（未采用）与独立决策

将原四Claude范围与新增DeepSeek pro分开审查，五组合逐个评估，不扩至Luna/Kimi Read。保留三列：A生产真实注册工具面/只读argv/空MCP及正向Schema读取；B同完整当前指纹、同工具面/权限参数的受控精确Write输入、唯一ID对应CLI拒绝/cwd目标/前后状态；C实际模型生产写，继续原标准、无尝试未测。

采用候选的先决条件：A/B均当前有效实测，额外工具/缺init/受控配置不同形/缺配对/泄漏/清理失败均unknown或false；其他正向与完整禁读也须满足。实际Kimi .env缺口不能被写候选掩盖。B只由现有canonical受控传输/adapter执行、独立临时夹具、脱敏并扫描，不能将受控模型响应叫真实主动调用；不输出或改用户凭据/全局配置。预计五个受控逻辑臂，各Claude包装器/native按实际计2启动，共10；另当前工具面/版本刷新是否必要按指纹差异逐项列，发布批清单后才启动。

若Bob另行明确采用“restricted-tool-surface-v1”，独立评估ledger写restricted_admission而不改原production_write字段；matrix同时显示original_status及alternate_status，M11 readiness只有审批覆盖范围且A/B/其他项齐备才可按新标准另算，原标准仍显示未测/不满足。能证明受测生产曝光工具面与受控CLI拒绝，不能证明模型主动写、抗诱导、任意/未来渠道安全或服务端身份。撤销批准、任一CLI/配置/工具面/完整指纹变化即不消费alternate；保留所有证据并恢复仅原标准。

计划审查、逐条裁决、gate及一般委托plan审批后，提交具体审查修订后的两项独立选择给Bob：有限复用是否准入采用；受限工具面新状态是否计入M11前置。**本次总10轮授权和一般自动审批均不批准这两个判据**。取得另行明确答复前不实施判据消费、不补当前通过列、不宣布M11可进入。若均不批准，就完成获批普通整改及第10完整重审，同时保留准入阻塞；新机制真实样本可得则按原标准取证。

## 6. 正式机制、预算、冻结与审批

原生无专用轮数例外接口；沿用既有已审任务级current-authority壳。v4完整hash绑定用户独立“授权总10轮，先正式计划审查再代码重审”，v3pointer逐字另存，旧授权/launcher不改，新launch-v5仅切v4。task/archive已启动8次ID严格一致（含失败），9B/10C、Driver codex、Claude/Gemini/GLM固定；无allow-single，超过10/孤儿/不可读/重复/旧权威拒绝，13项零CLI核验已落盘。

第9批review103/108→具名扩容15至123；预计15硬20（通常preflight5+formal5），达到批/池上限先停再发布扩容。admission547/563，本次plan无新准入启动。未来准入候选五受控各2预计10，外加有依据的版本/工具面刷新另算；启动前发布确切argv路线/逻辑臂/包装与native/失败超时等、硬上限及累计池上限。预算不等金额、独立于formal10。旧976预算原件hash连续，O_EXCL新预占/结束，不清零覆盖。

全静态材料、脚本hash、报告与上下文落盘后resolve原用户焦点、preflight参数逐项同组，再正式第9B。运行中不改任何业务/被审证据，仅编排器及既有budget产生元数据；所有warning/progress原样播报。读三家全文，逐条裁决；接受均落点并archive唯一出口写完整r14定稿，gate0→await→按用户本轮自动审批委托approve（不含判据批准）。失效不得approve，不重写失败或删漂移文件。第9次三家有效结论不齐备、任何作废、gate未过或没有本轮审批即停止，不实施、不启动第10次；此为Driver操作纪律，既有round-guard不校审批链，不宣称原生机制兜底。quiet-launch-v5明确纳入新增面，仅claim/resolve/preflight摘要可用且后续必须读取完整输出播报警告，禁止用于review start/wait/status。

## 7. 获批实施、完整复审与交付

普通计划获批后先在恢复报告追加当前总10/9B有效审查/10C待执行、两判据未采用/预算及矩阵段，旧总8段保留按时点解释，并逐句核状态锚。普通整改和独立批准判据（如有）实施前先并入唯一设计规范、ADR003、协议、手册/剧本、测试报告及索引。入口措辞改skills-src后render；历史Schema/原审查/旧证据保留，归档仅archive.ts。业务版本/软件版本不自动变更，现有模型配置/effort保留。

按受影响范围定向测试，串行两次npm run check、桩14/14、最终build及四目标重装、运行副本/28入口/input/full指纹/事实消费核验；源码或资产改变时逐项重估当前38臂适用性，不盲目全量重跑、不用本候选绕正式审查只读与完整指纹。判据若未批只允许原标准结果。第10次C/code的resolve和start显式传--base 39ed20530d64a72f81f183095c6d9516632d0228，核返回base及完整补丁，覆盖该基线后的完整diff覆盖七整改、深度、后续普通及候选实现、所有launcher/授权/ledger/tests/docs；静态审计和报告先落盘，settings≤131072、skipped0、真实目录facts与最终安装匹配才spawn。本次9B没有事前机械settings测量，实际trace26960字节/skip0只是事后证据。后续新v2 precheck按真实stage解析路线，正式启动前核安装/输入/生产枚举/facts/settings/skip，旧v5不改；新launcher注释准确并纳10C。若判据未答复/拒绝，10C只覆盖普通整改及r4只读诊断，不含采用层。必须三家有效完整意见、逐条裁决及本轮委托code审批，旧审批不替代；失败保留且不擅自第11。

用户已授权自动提交/推送当前分支，逐文件暂存、Conventional中文及Edit by CZB，不跳hook、不amend/force，远程核hash。交付逐路线×实际模型矩阵、七整改及检查、有效本轮审查/审批、证据与启动账、配置/安装/未测/失败/阻塞；七条可用路线、Qwen pro、共享三审、必要检查和新增官方边界全部符合**已明确批准的标准**才报告可入M11第12步。官方Claude待订阅、client发现未测、服务端null不能隐藏。


不编号附录：r12历史全文（逐字保留；当前以r14正文及九项修订为准）

# 相对r11送审稿的修订（plan-r5 / run20261010T232715Z）

- CLAUDE-01：敏感面有父目录上限而归档面无上限，BRIEF原型及相关说明必须明确这一不对称，不把静态漏枚举追认为泄漏；落点：设计§9.2/9.4第8段/10.1、协议及手册；freeze.ts边界注释。
- CLAUDE-02：夹具使用替换后的目录globs，不能证明本仓真实凭据文件漏禁；只证明相同生产枚举/匹配机制的深度缺口；落点：r12纠正夹具措辞；实际项目cap6/7生产枚举增量、集合hash及settings尺寸对账另存，敏感内容不读取。
- CLAUDE-03：七条及r9形态已在工作树实施但未完整代码复审，不能再次当作待批准实施；落点：r12七行逐项状态列，§六仅实施深度及本次接受项，其余纳入第8次完整diff复审。
- AGY-01：现有Dirent不跟随目录软链，但需要深目标与自环回归防止未来越界；匹配软链项自身不得新增豁免；落点：freeze-drift.test.ts目录软链/自环/目标后代不遍历、深度边界与.git/node_modules排除。
- AGY-02：继承稿残留r10称谓，正文需以当前稿为准；不存在的freeze.test.ts仅留在历史说明，不修审查员原件；落点：r12当前稿自称、正文范围；r10/r11历史原稿保留。
- GLM-01：采用导出常量说明单一生产上限，但不自动由Claude形态改变全局敏感扫描；测试同时钉批准值7和实际正反边界；落点：freeze.ts SENSITIVE_SCAN_MAX_PARENT_DEPTH=7；边界夹具按常量推导并assert7，30目标枚举防止拓扑再次脱节；设计引用符号。
- GLM-02：历史cleanup:null缺明确定义，不能当作正向清理证据；不回写原诊断件或回推历史清理时间；落点：r12历史诊断清理未记录；新独立夹具记录清理时间/目标及不存在核验，报告追加纠正。

当前r12是合入本轮7条接受意见的完整计划，实施批准以本轮gate及委托审批记录为准；所有历史原稿及判据保留。历史sensitive-depth-diagnostic.json.cleanup=null仅说明无正向清理记录，不将其称为已核验清理；新验证要保存独立清理记录并核目标不存在。本仓真实项目cap6/7对账只保存非敏感路径集合hash、数量/增量和settings尺寸，不读取凭据内容；实际globs稳定hash未变。命名常量SENSITIVE_SCAN_MAX_PARENT_DEPTH固定批准值7，不由形态扩域自动抬高全局扫描；测试同时核7、相邻6/8和五根30目标。BRIEF文档第8段明确敏感面父深度上限与归档面无此上限，保持原八段结构。

# 送审路径校正沿革（r10/r11原稿按时点保留）

送审前静态核对发现r10写了不存在的test/unit/freeze.test.ts；原稿保留，本r11修正为现有test/unit/freeze-drift.test.ts并保留test/unit/deny-matrix.test.ts的身份/同行回归。未启动正式审查，未实施扫描上限。其他完整计划与历史附录保持。

# 敏感枚举深度整改补充计划（r12完整修订计划，未批准实施）

本稿继承r9完整业务计划、七条历史整改及plan-r4/run20261010T224543Z的11条接受约束。r9原件不改，原11条及r7附录在末尾逐字保存为历史，当前正式轮数以用户独立总8授权为准。

## 本次单列敏感整改

生产enumerateDenyPaths的walkSensitive当前depth>6返回；五段ASCII根加两层后代需要父目录深度7。独立临时夹具证实文件在同一matchesAnyGlob判据（夹具配置globs）下命中却未入集合，导致目录probe内部覆盖断言5项失败；不得缩小30目标夹具、手填deny_paths或吞掉未知断言。见sensitive-depth-diagnostic.json及候选方案。

仅将此生产扫描父目录上限6提高到7；保持同一matchesAnyGlob、.git/node_modules排除、不跟随目录软链后代（软链项自身仍按现有glob判定）、主题剪枝/身份注册表派生/同行归档矩阵/只读和泄漏判据。父深度8仍是明确未覆盖边界，不宣称无限深度或全部项目敏感文件均覆盖；本任务五段根加两层受测后代内的30文件必须完整入列。其他未测目录前缀仍逐文件，旧形态v1及缺真实新事实不消费。没有更改sensitive_globs，不能声称仅扫描上限改动自动改变其稳定hash；需按新shape和最终完整构建指纹重跑doctor采样。

计划获批后先同步设计§9.2/§9.4第8段/10.1及§3.5/11.1/11.6、协议/ADR/手册/剧本/报告/索引，再实施src/trivium/freeze.ts的单一边界及注释。test/unit/freeze-drift.test.ts使用标准独立夹具工厂验证父深度6/7匹配文件入列、8保留边界、非匹配/.git/node_modules排除、目录软链目标后代不遍历且匹配软链项自身沿用原规则。旧同行、.trivium及run-root规则原测试继续通过。目录unit和两套真实子进程假CLI集成须30目标全枚举、保留主probe/清理、未知错误不吞；真实模型新facts另批，不由假CLI证明。

启动前检查使用最终构建/安装同一hash、实际当前配置与生产完整禁读枚举、真实可消费新事实，settings<=既有131072字节软线且无skipped才允许第8次C/code；失败不spawn、不占正式轮数，不改变产品soft-line语义。当前实际采样3049196字节、无facts且旧安装不同已经拒绝，不能称在线E2BIG。三路线目录doctor各七臂180秒，文件30/目录5/正对照4；失败清空事实、保留主probe/已取得臂/脱敏原因并清理，不调超时、不换提示碰运气。

正式总8例外与连续review预算分列；不得借本次一般自动plan/code审批采用生产写判据替代。四组合生产写仍未测，七路线完整准入/官方边界/安装与代码三审未满足则目标不完成。

# Agent双模式接入真实准入收口：遗留整改与有效复审计划

2026-10-11，Driver=codex；本r12完整修订计划在已获批r9七条整改及11条追加约束上，仅增加敏感枚举父目录深度6→7候选和用户独立授权的总8轮安排。第7次正式B/plan审本候选，第8次正式C/code完整重审；新扫描上限在本轮有效审查、裁决及审批前不实施。

## 一、目标、当前事实与授权

作为M11第12步前置，完成七条遗留整改、有效完整三审、真实准入矩阵和安装收口；七路线全部原标准未满足则目标不完成。基线39ed2053及远程main已核对；运行时与claude/gemini已更新，四目标安装被共享七入口阻断。旧H批5通过/5未测/2读取未通过，只适用历史完整指纹。

原6/7轮授权及六个实际run原样保留。用户2026-10-11独立回复“授权总8轮，先审扫描深度整改，再完整代码重审”。formal-round-authorization-v3.json引用原v2完整hash；总上限8，第7次仅B/plan、第8次仅C/code。原生编排器仍无专用轮数例外接口；沿用已批准的当前权威读取壳，formal-round-authority.json绑定v3文件及hash，先逐字节保存旧v2权威，旧launch/launch-v2和历史guard不改。新launch-v3.mjs沿同一机制核对task/archive已启动ID集合（含failed/running）、六个历史ID、阶段/入口/Driver/critics；已被替代授权及超8均拒绝，不重置计数或修改失败。新载体、旧副本及启动前检查均纳入完整C/code审查。

用户随后明确授权“中途遇到需要审批的，根据你的建议自动审批；如果遇到配额不够的，自动增加配额”。本轮自动plan/code审批以三家有效结构化结论、无作废、逐条裁决、gate通过为前提，审批附言记录本轮授权及具体审查run。若失败，不approve；没有有效审查不得借自动审批实施。一般审批不改变原写负对照判据。只有本文单列的敏感扫描父目录6→7候选经本轮有效计划审查及审批后可实施；其他guard/只读/原写判据不改，无Bash豁免。

## 二、七条整改及落点

| 历史编号 | 当前状态 | 实施方案 | 必须回归及留痕 |
| :--- | :--- | :--- | :--- |
| code-r2 CLAUDE-01 | 已实施待复审；真实新事实待采样 | adapters/claude.ts新增稳定sensitive_globs哈希函数，对真实项目字符串集合排序去重后JSON/SHA256，不能从替换后夹具配置取值。types.ts新增可选nullable目录项目hash事实；probes/claude.ts在调用目录夹具前保存项目hash，前后项目hash一致、路线/版本/入口/native一致且目录追加臂无failure才保存事实。消费端directoryGuard保存声明/当前项目hash，缺值或不符一律consumed={}，逐文件回退。旧事实无新hash不得借true继续压缩。 | 顺序变化/重复项不改变hash；增删/字符变化使旧事实失效；真实配置与夹具配置不同、旧配置、null、TTL、版本/入口漂移均回退。持久化后再起进程读回并核消费；不伪造doctor结论。 |
| code-r2 CLAUDE-02 | 已实施待复审；五段生产接线验证被扫描深度阻塞 | 从已保存run-20261010T170416Z.json的实际deny_paths等冻结非敏感路径集合提取回放fixture，来源完整文件hash、提取字段及精确集合hash都记录，路径分类结构先核实。只保存路径，不保存内容/凭据；不能把扁平的多侧集合冒充单侧完整禁读，单侧原集合优先取原送审包/trace请求实际路径。找不到完整原件就报告缺口，不能编2290条。 | 回放每原路径要么保持逐文件、要么被严格字面目录覆盖；原数组及来源hash不变、合法src/README/audit和相邻calls_extra不被误并。fixture数量来自原件，2290仅历史采样。随check运行；来源不可恢复时明确未测。 |
| code-r2 CLAUDE-03 | 已实施待复审；生产注释/接线回归已执行 | adapters/claude.ts的peer_deny_applied注释与types.ts同步：file_shape_verified与实际compressedTools全部verified===true合取，第二项是输入防御不变式；同次buildProjectedDenySettings生产接线不会生成未验证压缩。清理“只读探针、对本批一无所知”的过期注释。 | 保留直调输入变异负例；完整生产接线集成用例，分项守卫不是独立模型能力证明。 |
| code-r2 CLAUDE-04 | 已实施待复审；只测读取次数，性能未测 | 没有可消费目录声明（缺fingerprint/项目hash/时间、无true工具、过期或项目hash不符）时不读入口/native大二进制，observedFingerprint=null、consumed={}。仍需验证时相同精确路径仅在本次函数调用复用一次hash；不按realpath跨不同字符串复用、不建跨运行缓存。 | 缺事实时读hash调用数0；同路径1、不同路径2；漂移/读失败回退；第二次调用文件变化必须重新hash。只证明调用次数，性能收益未实测。 |
| code-r2 GLM-01 | 已实施待复审；权限独立变异回归已执行 | test/unit/claude-directory.test.ts将is_error与permission_denials独立构造，保持判据唯一ID、恰一配对错误、恰一精确权限记录。 | 错ID、is_error=false、无权限/错目标/重复权限记录、重复ID/重复错误均不得true；正常正例仍true；timeout/Schema失败为null、泄漏false。 |
| code-r2 GLM-02 | 形态v2已实施待复审；目录假CLI被扫描深度阻塞，真机待采样 | projectClaudeDenyPaths只消费保守ASCII目录段，如[A-Za-z0-9_-]+，路径分隔符/嵌套按已测拓扑；拒绝中文、空格、逗号、方括号等未测目录前缀，保留逐文件规则。点文件名的目录拓扑证据不外推点目录。projection留受测形态说明。 | 特殊文件名在已测ASCII根下可压缩；特殊目录根不压缩、相邻合法路径保留；现项目doc/05_testing/evidence/...等ASCII候选是否满足限制逐项核对，不能因字符白名单排除现合法根而静默E2BIG。 |
| code-r2 GLM-03 | 已实施待复审；目录假CLI被扫描深度阻塞，主probe失败分支已有回归 | probes/claude-directory.ts把createFixture纳入预期错误通道；调用者在目录后置臂捕获已定义ProbeFixtureError、路线读盘已知错误及明确预算拒绝。保留主probe；目录三态/hash/时间及新增项目hash清空，directoryEvidence.failure脱敏保存，清理保留独立步骤。catch不吞assert/程序错误、Schema内部异常等未定义内部错误。 | 工厂创建失败、目录populate失败、追加路线失败、预算拒绝时已完成主probe保存且目录不得true，已有臂保留、清理完成；未知TypeError/内部异常必须继续抛。通过doctor持久化接线验证，不只测helper。 |

## 三、准入取证与预算

路线×实际模型×缺口×旧证据×必要启动清单见REPORT_2026-10-11_agent_access_recovery.md。逻辑能力臂Claude20/Codex18，CLI包装与native分别计数；版本7臂及help1另计，三条目录doctor另批。完整指纹仍含全部模块/配置/bundle，整改会使旧H证据失配，不按正确回答或同版本CLI自动追认。先只做预算清单，不在plan批准前启动付费补测。

第7次敏感计划预检及正式启动前发布review-sensitive-depth-plan-batch.json：review此前68/73，预计15新增启动、硬上限20，具名扩容15后池上限88；admission仍342/343，本批无准入启动。只执行第7次B/plan；CLI费用和formal总8分列，版本/help/包装器/native/失败/超时/重试全部计数，旧台账O_EXCL追加。新静态证据独立r3目录，动态输出项目外；审查期间不新增被审材料，仅编排器和预算侧车按既有规则产出元数据。

Codex Qwen/DeepSeek只改变读取配方为明确的单一cat README.md，不改parsed_cmd精确read、cwd、唯一命令/完整输出/exit/status配对标准；禁止ls/echo/回退串扰，模型不执行指定单命令仍未通过。README正确首词不是读取证据。请求、配置、CLI回读、服务端各自列，effort不新增默认值。

Claude flash缺Grep交付、k3缺.env调用，用完整生产enumerateDenyPaths列全部精确目标，继续已授权独立夹具Read/Grep负对照，不改全局配置。四个未注册写工具的模型组合先审历史工具面、样本和配方；现阶段没有新机制，不重试write。原生产写标准必须真实模型实际尝试+精确配对拦截+文件前后状态；注册权限诊断、受控响应和未生成文件不替代。若仍无法取样，保留具体待审替代建议与原标准列，本任务不能因此完成。官方Claude订阅恢复前未测、0新启动；官方三档身份以CLI回读为界，不冒充服务端证明。

## 四、共享七入口迁移方案（独立操作）

只读核对与内容hash见shared-entry-audit.json，客户当前重名解析未测，来源null。影响面是Codex/ZCode所有读取~/.agents/skills的仓库；已读仓库未找到路径依赖，但完整依赖面未测。

在有效plan及本轮自动审批授权落盘、业务整改及两次check完成并生成最终构建后，迁移另写独立操作记录：列出七个精确目录，记录原文件hash/软链/权限，复制到~/.trivium/backups/唯一新目录，逐文件核对备份hash；再将原目录可恢复地移到同一备份根的moved目录。不能删除，不改其他共享skills、不绕安装器检查。确认专用七入口按渲染源和各carrier身份一致，运行四目标安装，核运行时/28专用入口及输入hash。

恢复方法：有残留/失败时停止，将已移动目录逐个移回原精确位置，拒绝覆盖现在存在的文件；恢复后逐文件核hash，恢复原发现面也恢复原冲突。完整备份始终保留。自动plan/code审批不得替换原标准判据，迁移授权的依据必须在操作记录单独写明最新用户授权及已获审方案，不从旧审批推断。

## 五、文档同步与版本边界

先把获批契约修订并入主设计§3.5/§10.1/§11.1/§11.6及ADR_003，再实施。同步PROTOCOL、dual-critic说明、GUIDE_local_pitfalls、QUICKSTART/RUNBOOK、CASE_manual_acceptance、报告及目录README；新增字段不枚举Agent、按现commonProbe形状及注册表纪律检查。业务包版本0.1.0不自动修改，设计文档补丁编号按仓库原口径。入口措辞若改，改skills-src并render，不能手改渲染产物。

## 六、有效审查及审批

第7次敏感补充计划全部静态材料落盘后正式B/plan、--driver codex、--topic原主题、--critics claude,gemini,glm；不allow-single。审查期间停止业务与证据写入，仅使用--wait/--status和现有预算运行元数据，约60秒反馈。读三份全文并逐条接受/驳回/暂缓，所有接受写落点；裁决经archive唯一出口，接受意见写完整下一轮计划。gate通过后await-approval，再按本轮最新自动审批授权调用approve，审批理由包括对应run、有效性核验及用户原指令，不复用旧审批。

深度及本次接受项实施、受影响定向验证与真机补测完成后（其余七条已在工作树实施，纳入相对39ed2053完整代码复审），先完成报告/静态审计/历史保留核对，再冻结全部范围；第8轮C/code覆盖相对39ed2053的完整本轮整改，三家完整重新审，不以旧approve类结论代替。逐条裁决、修复接受项并完成受影响检查，gate通过后本轮code审批。第8轮失败保留且停止正式启动，CLI扩容不授予第9轮。

## 七、检查、安装与提交

定向测试使用真实子进程假CLI和精确失败注入；不烧模型配额做回归。获批整改完成后串行两次npm run check，再14/14桩、重建、重装、安装副本hash核对；检查采样与真机能力指纹时点分列。以最终同一构建做能力刷新与正式代码审，未经必要不再重建；若提交后重建改变bundle，重新作范围判断，不自动追认。

自动提交/推送已授权，但只交付明确快照、不宣称未满足前置已完成。暂存逐个文件，Conventional Commits中文subject，末尾Edit by CZB，说明正文经文件传给git commit -F，不跳hook、不force。核远程main实际hash。

## 八、交付与停止条件

最终逐实际模型矩阵、七整改位置/验证、有效审查裁决及本轮审批、证据/预算/配置/安装状态，未测/未通过/剩余阻塞逐一列明。原写缺口未补、官方边界未交代、共享安装未完成或三审无效均保持目标未完成。判据替代须单独具体审查和明确批准，不与一般审批捆绑。预算触顶先发布扩容；正式总8轮触顶停止，不另起主题或改旧件。全部历史Schema、审查件和原证据保留。



不编号附录：历史r9/plan-r4接受约束原文（编号和总7/第7C均属该时点，当前以本r11正文为准）

# 相对r8原稿的改动（plan-r4 / run20261010T224543Z）

- CLAUDE-01：settings-size-reconciliation.json；新构建启动前用生产enumerateDenyPaths及实际目录事实计算settings，必须<=既有131072软上限，否则拒绝第7次spawn、不消耗轮数，不改变产品软线语义。
- CLAUDE-02：r9不编号附录逐字保留r7原文并标历史；本轮5段/总7/第7轮范围集中于正文及当前裁决编号空间。
- CLAUDE-03：round-guard引入当前授权文件及hash绑定的读取壳，纯核验函数显式接收当前权威并拒绝已superseded授权；旧launch不改，旧guard全文另存历史副本；两正式启动只经launch-v2；负例旧授权+5条+6C拒绝、未知hash拒绝及当前6条+7C允许。
- CLAUDE-04：PROTOCOL、QUICKSTART、GUIDE_local_pitfalls、CASE、dual-critic说明的五段待批句及PROTOCOL形态句、ADR003轮数句同步；设计§3.5/10.1/11.1/11.6、README指针/手册/报告更新，全仓逐句核对现行/历史归属。
- CLAUDE-05：round-guard注释不写固定数；r9现行约束写五个冻结ID，旧附录明确历史四；测试按授权historical_run_ids。
- CLAUDE-06：每路线七臂文件30/目录5/正对照4；180s每臂保持不自动放宽；主probe+三路线目录doctor按独立批执行，任一失败无事实/清理不全不消费；旧事实及超软线则第7次不得启动，不随机换提示。
- AGY-01：claude-directory回放固定8个精确生产根及对应coveredCount，projected.paths严格小于原集合，逐项覆盖/相邻合法/原集合与hash不变。
- AGY-02：claude-directory-adapter增加五段ASCII根及两级后代、原v1/缺事实回退，捕获settings并检查五段压缩规则。
- GLM-01：launch.mjs、launch-v2.mjs、round-guard及其保留副本、当前权威载体均纳入Git及完整重审；现行计数依v2五ID，旧历史附录保持原文。
- GLM-02：分歧/不可读立即停，不修改task/失败/计数；新增脱敏诊断证据，按已授权编排器状态/运行元数据核对来源；必要恢复必须另获明确授权及正式审查，墓碑仅说明事实、不得充当复活资格；补双向孤儿/重复负例。
- GLM-03：正文按claudeDirectoryFingerprint、consumeClaudeDirectories、probeClaude、peer_deny_applied与doctor清理符号及注释句族对账，旧附录行号仅历史原文。

第6次实际使用安装基线的18,644字节/192规则已见原trace；来源4053条保持完整，其4029条被8根覆盖，剩24逐文件，共32坐标。前一失败run的3924条同样未剪枝，实际压缩与当前v1无压缩反事实静态值不是同一条件；已对账，不称E2BIG实测。后续第7次以最终构建/当前配置/真实新事实算实际本轮禁读全集，超过现有131072软线则包装器在编排器review启动前拒绝，不消耗唯一代码轮数；不新增Bash豁免、不更改产品软线或只读判据。未通过的doctor不继承旧事实，不能借安装旧副本规避。


不编号附录：历史r7/plan-r3精确约束原文（逐字保留，仅供历史归属，当前范围以本r9正文及上述plan-r4裁决为准；原四ID、总6、根4、行号均属该时点）

CLAUDE-01：doc/05_testing/evidence/agent-access-20261011-closeout-r3/launch.mjs纳入Git及第6轮代码范围；抽取纯核验函数，N=task.runs已启动条目数+1（包括running/failed），历史四ID是保留子集；task与归档ID集合严格相等。测试现4放5B/plan、现5放6C/code、现6及7拒绝、错入口/主题/Driver/critic、不读task、归档多一项均拒绝。

CLAUDE-02：更新adapters/claude.ts三处、probes/claude.ts1071及1076、types.ts2123、report.ts545；Claude合取为file_shape_verified及实际压缩工具已验证的防御不变式，其他适配器保持探针语义；历史引文逐处注明历史，源注释句族对账。

CLAUDE-03：scripts/agent-access-closeout.mjs将qwen-pro加入现kimi/kimi-pro/deepseek的write启动前拒绝；测试四组合均不spawn、不消耗启动预算。

CLAUDE-04：doc/02_design/README.md的ADR003条目指向2026-10-11恢复报告；ADR_003保留10-10历史段，另加10-11当前进度及报告指针。

CLAUDE-05：七历史行统一code-r2/run20261010T170416Z限定；本次裁决仅plan-r3/run20261010T175354Z，不改历史编号。

AGY-01：test/integration/claude-directory-adapter.test.ts同步注入真实cfg.review.sensitive_globs的hash及形态事实，并验证缺值/变更回退。

AGY-02：src/trivium/doctor.ts路线不稳定时snapshot与existing.probe均清空新增项目hash及形态事实；默认初始化和目录失败也一起清空。

AGY-03：静态检入test/fixtures/claude-deny-paths-replay.json，消费test/unit/claude-directory.test.ts；来源是原request.json.requests.claude.deny_paths，并与原out/trace.json sourceHash一致，记录原件hash、字段及精确集合hash；不依赖本地文件运行。

AGY-04：每批admission/review分别发布extension与启动清单，沿用旧根计数，硬上限包含wrapper/native/version/help/失败/超时/重试；CLI扩容与formal总6无关。

GLM-01：精确目录段正则^[A-Za-z0-9_-]+$，根1至4段、根下0至2级子目录，点目录及非ASCII不消费。目录doctor的原七臂扩展至四种根深度及两级后代，同次逐目标配对核验，增加nullable directory_deny_shape事实ascii-root1-4-depth0-2-v1；旧形态缺值不消费。projectClaudeDenyPaths超出段数/后代深度的路径维持逐文件；现生产根被排除时先补上述真实拓扑证据再消费，仍不符则逐文件并显式报告settings大小/启动失败，不悄然扩域。

GLM-02：迁移推迟至业务与两次check已完成后的最终构建；备份、移动、四目标安装及核验作为单一操作记录连续执行。任一步失败或意外中断标记rollback-required并恢复七入口，拒覆盖；重启先恢复该操作再继续，不保留未经登记过渡态。

GLM-03：claudeDirectoryFingerprint增加可注入readBinary参数（默认fs.readFile），本次调用精确路径Map复用；目录消费解析函数使用同一注入点测试0/1/2次及下一次重读；无跨调用缓存。

七条遗留意见均来自code-r2/run20261010T170416Z；上述12条均来自本次plan-r3/run20261010T175354Z，两个编号空间分开对账。
