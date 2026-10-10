# Agent双模式接入真实准入收口完整修订计划 r5

日期2026-10-10；Driver=codex，入口A。现行执行范围以本篇前文为准，后附r2为完整继承底稿及采样历史。r3/r4、原始审查意见和预算全部保留。本轮两家计划审run20261010T135427Z已完成，8条意见接受，尚待用户本轮plan审批；这不是原准入标准通过或代码三审通过。

## 相对r4的改动

- AGY-01：安装副本先于新doctor与最后三家代码审生效；能力臂采样安排在最终源码/模块/bundle指纹固定之后，避免最终check的重建再次使证据失配。
- AGY-02：目录事实改为逐工具三态map，异质工具拆开独立臂；未核实工具保留原逐文件规则，不用Read成功替代Grep/Glob。
- AGY-03：混合规则的peer_deny_applied明确组合条件，trace详细投影与既有run.v3规模字段分工，更新A14及失败出口回归。
- AGY-04：目录归属必须P===D或P.startsWith(D+'/')，相邻前缀不归属，非法坐标不规范化掩盖。
- GLM-01：CLI正负对照全部独立假夹具；真实项目拓扑静态对账与最终三审真实读取分开，夹具结果不谎称真实路径复测。
- GLM-02：加入dotfile、嵌套隐藏与特殊文件名真机矩阵；无尝试null、泄漏false，不能靠事后检测把失效目录规则改判为生效。
- GLM-03：投影输出裸目录D，不输出含星号路径；由现有精确/子树双规则承接，详细字段归trace，不新增/修改历史run Schema。
- GLM-04：selftest仍14步stub流水线，不增加真实CLI调用；目录字段持久化、失效、可缺三态消费另由单元/假CLI回归验证。

## 目标、范围与不变条件

完整继承此前r2获批收口任务与code1接受项；本轮新增范围仅是生产Claude目录规则投影和实测守卫。七条可用路线、Qwen pro和Codex新增官方档位逐组合验收，原生产写判据始终要求实际模型调用、精确目标/调用ID配对拒绝、完整交付及文件前后状态。无调用未测，受控响应/权限诊断不替代，服务端身份无证据null。目录压缩不改变写标准。

用户明确批准code1“修改后重审”，授权本补充计划只由gemini、glm审查；本轮plan批准后才改生产。源码整改已经完成部分canonical/版本/命令证据/清理回归，17/17和typecheck已测；Codex实际native子边界引用与缺fixtureRoot反例仍需补齐。旧48/48、100/100、29/40、36/36、28/40、47/64、21/24及本任务所有台账原样保留。不改全局配置、模型/effort默认、软件版本、历史Schema、原审查件，不提交推送；共享配置仍claude,gemini,glm。

## 事实与选择

code1实际spawn E2BIG，没有Claude结论；单argv settings1628531字节、2219唯一路径、13314规则。现行2290路径为1688642字节、13740规则。既有sensitive_globs的8个字面禁读子目录构成静态候选，可投影为20裸路径表达、120规则、10328字节，当前字面包含关系全覆盖。原件settings-options-analysis-7b018aff-9d4f-41a1-bd62-7b6c64acd144.json含脚本/模块/配置hash，CLI子树语义未测，不能提前称等价。

选目录投影，保留原始完整enumerateDenyPaths作为BRIEF与事后检测事实源。删证据、缩小禁读集不可采用；临时settings文件传输仅保留比较项，本轮不实现，不猜旗标。10.3KB是三个工具均可压缩的静态理想值；实际若仅部分工具验证true，其它工具保留全量精确/子树规则，实际尺寸可能更大，不为达到数字而降保护。实际生产调用后才判E2BIG恢复；仍失败则停止，不盲耗最后审查。

## 目录投影、三态与报告契约

新增纯函数置于adapters/claude.ts，输入生产完整deny_paths及同一ctx的sensitive_globs。仅认项目相对、末尾/**的严格字面完整禁读目录D：排除绝对路径、其它glob元字符/控制符/反斜杠、空/./../段。只归并P===D或P.startsWith(D+'/')；不猜共同前缀或文件扩展名，不擅自realpath吞别名。只有当前集合有成员的目录参与，祖先目录去重，未覆盖成员保留。输出裸目录，不直接输出D/**。原机器集合、排序与source hash不变；CLI注入由现行rule_syntax与readonlyToolsFromProbe生成工具对应D和D/**规则。

按工具形成投影：ClaudeProbe.directory_deny_verified为可缺省Record<string,boolean|null>，工具名从实测只读工具面派生，缺map/键/null/false均不压缩该工具；true且当前route的入口/version/wrapper/profile指纹及TTL匹配才可压缩。其余工具仍使用原始完整集合。升级、路线漂移或未执行的新doctor臂不继承为当前true；保存/读取落现有厂商专属探针扩展口，不改历史Schema或枚举Agent身份。

禁止凭前缀合并整个.reviews主题根、Driver稿/己方历史/audit-snapshots共同父根；目录候选只能来自配置声明，不在代码枚举8条目录或具体Agent。完全禁读目录自身的精确规则也会限制目录工具访问，须明确记录并实测，不扩展其它目录。特殊子文件能否被D/**覆盖由真机矩阵判，不用字符串包含当CLI证明。

peer_deny_applied保留现有文件能力基础，并追加实际目录工具条件：file_shape_verified===true且本次每个实际压缩工具的directory_deny_verified===true；没压缩时仍是原文件条件。此字段只表示已验证机制配方，不保证任意规则/恶意输入全面生效。trace.json.denySettings保存逐工具源/投影hash、原路径数/投影数、裸目录来源/覆盖数、实际压缩工具、守卫事实、规则/字节、原不可表示项与剩余skipped；CriticResult/run.v3仍用deny_rule_count/deny_bytes/deny_skipped及peer_deny_applied，所有失败出口同步，report既有消费继续，不新增压缩比例通过条件。A14覆盖原字段条件及新增混合守卫。

## 真机目录探针与测试边界

src/trivium/probes/claude.ts通过现有doctor路线/适配器invoke，在独立临时cwd中按生产路径拓扑构造完全禁读目录树、普通/嵌套/.hidden/嵌套隐藏/中文空格逗号/带方括号文件名，全部人工假哨兵。archive.ts构造假己方历史与Driver稿，audit-snapshots放假可读正对照；不在真实项目添加负对照、不修改全局配置。机器禁读复用enumerateDenyPaths，增加目录候选注入集对账，不手工枚举同行角色。

不同工具分臂：Read文件、Grep文件、Glob路径，另各工具目录查询分臂，合法邻接与假己方/Driver/audit正对照独立一臂；合计计划7个逻辑臂，各一次实际启动，不反复换提示。每工具证明要求其声明覆盖的实际调用、非空唯一ID、对应精确路径的权限拒绝、无内容/结果泄漏、完整Schema和正常退出，目录查询亦核对；共同正对照要求实际Read结果含独立哨兵，不认口头承诺。未完成、歧义、无调用null；实际泄漏false。Glob目前能力未测，不假定错误形态与Read相同；仅消费实际原件可辨拒绝，判不出保留原规则。单工具臂不足不会把其它已有充分原件改为成功或失效；全局合法正对照不成立则该批目录证明不启用。证明限定受测拓扑、方言及路径形态，不推断任意软链接或任意恶意输入安全。

夹具正对照只证明匹配拓扑；真实项目合法文件/己方历史/Driver/audit不被投影目录吞并另作静态包含对账，最终完整三审的实际读取再提供真实路径证据，分列且不互相冒充。真实字面目录若含未实测的特殊形态，维持原规则/未测；soft link和别名不以猜测扩大兼容。

纯函数/假CLI回归：重复/嵌套目录、calls/calls_extra、相邻同名前缀、根与文件同名、非字面glob、非法路径段、中文/空格/逗号、目录含glob元字符不可误压缩；真实2290原件hash重放逐条静态覆盖并保存原机器集合不变断言；逐工具map缺/null/false/true、缺字段老配置、路线version/指纹失效、save/load与各失败出口。跨进程假CLI捕获大规模真实argv与stdin，JSON全规则/字节/参数同步，失败/超时不记有效启动。假CLI不替代厂商拦截。

selftest仍是14步stub编排闭环，指纹必须stub/0.0.0，不是新增目录厂商能力验证；目录事实单元与真机分开。另完成code1范围内的native版本引用：绑定同一requested manifest的实际成功native子边界及入口/hash，当前文件再核对，不用Node入口hash替代；缺/歧义拒绝。Codex helper显式拒绝缺或非绝对fixtureRoot/实际cwd，新增null坐标/错native/未完成版本反例，原件不追改。

## 可执行顺序与启动上限

1. 本轮逐条裁决/gate/plan人工审批；批准前不改生产或开始这些新臂。主体源码、canonical、单项测试及文档完成后，先typecheck/定向回归、build并install至TV活跃副本，核对新目录探针代码实际安装。
2. 发doctor目录机制批并保存版本/入口/配置指纹。admission当前136/156；执行前publish批次预计7新逻辑臂加正常doctor的既有启动，明确本批新增硬上限20（池全部剩余），现有reserve硬拒第157次。到cap即停，新臂未完成留null，不清零/回收。若doctor实际需要更多，在触顶停止后先原子发布具名扩容再发新的独立批，不把预估7当启动数。
3. 所需源码修改完全固定后，串行两次npm run check、桩14/14、最终build/install及安装副本核对。安装dirty应如实为当前未提交工作树，不能冒称对应一个新提交或dirty=false。这套检查必须先于最终能力臂的完整bundle指纹采样；之后除必要报告/归档外不再重建更改bundle。若能力失败需要源码整改，旧臂成为历史，回到本步骤并重取受影响证据，保留预算和原件。
4. 发布最小能力批：Claude6组合各read/Schema严格首词+Read deny+Grep deny共18臂，Qwen flash/V4 pro各一次受影响写重取，共20能力臂及3profile版本=23预计启动；不再重试无新机制的Qwen max/Kimi coding/k3/DeepSeek flash写提示。Codex官方Sol/Luna/Astra与Qwen/Kimi/DeepSeek各3臂共18，Node/native按实际边界预计36，加version/help预计4，总40。合计预计63，每批执行前发布具体臂/variant及新增硬上限64，并以当时used+64为本批池新硬cap，先用现有extend具名原子发布所需增量，不提前消费。完整源码/安装/配置/模块/真实native指纹匹配才能复用，显式selection缺结果不回退旧成功。原写标准欠缺继续未测，服务端null。
5. 发最后三家代码审之前再次零CLI核对安装副本、输入/module/bundle/config指纹及最低启动可行性。review当前23/40，最终批最大17新增（池剩余），原审批模型/Driver声明不推断、三家集合恢复claude,gemini,glm，无allow-single。最终代码审是本主题第4次；新增启动超池先停，扩容不增加主题轮次。若仍E2BIG/守卫未测无法启动，不浪费最后一轮重现已知失败；报告阻塞，另请用户处理。四轮耗尽后不另起主题绕限额。

预检已实际9次（10→19）而原估8，偏差原因与独立硬闸缺失记录settings-preflight-budget-exception.json，不能追认为原上限满足。本正式计划审4次（19→23），在事前新硬上限21内；admission136/156、review23/40预占全完成。启动数含版本/help/失败/超时/重试/包装器/native，不是请求数或金额。后续批次上限取池当时完整余额或具名新cap，以现有原子reserve硬执行；更小的批次限额不能仅靠说明，需先正式审查实现硬闸。

## 文档、留痕和完成边界

同步设计3.5/11.1/只读10.x、ADR_003、PROTOCOL、GUIDE_local_pitfalls、QUICKSTART、CASE、REPORT与目录README：逐工具目录三态、投影来源/边界、机器集合保留、peer_deny_applied组合、误拦/未测与真实尺寸。厂商能力只读探针事实。不改入口用户旗标；如措辞变更改skills-src后render，不手改生成物。archive.ts唯一出口，原始意见/Schema/历史证据/预算保持。

本轮297冻结文件审查期hash不变；wait/status/start和worker元数据新增为无关漂移warn，原清单保留；安装副本过期、Driver模型族unknown保留。两份有效结构化结论可审，不代表准入通过；人工plan批准后才实施新增目录规则。最终矩阵逐路线/实际组合交代请求/声明/CLI/服务端、七条路线及Qwen pro、新档位边界、共享三审与检查；未测写未测，未齐备M11前置未完成，不开始第12步。准则变化另需正式审查与用户专门审批，不借本轮批准。

## 继承的完整r2底稿（以下旧采样与旧预算保留，现行顺序及本轮范围以前文为准）

# Agent 双模式接入真实准入收口修订计划（r2）

日期：2026-10-10，Asia/Singapore。Driver=codex；正式入口 A，计划阶段。本文是待审方案，不是验收通过记录，也不是人工审批。


## 相对上一轮的改动

- CLAUDE-01：明确新建受版本管理的 canonical 取证与汇总脚本，旧 admission/summary 冻结；probe.mjs 只是待建 import 入口，当前仅 tv 通道已执行验证。
- CLAUDE-02：同步 ADR_003 与设计目录 README 的现行状态指针，保留历史采样结论。
- CLAUDE-03：清单覆盖完整导入与构建模块身份，不沿用漏项的十模块清单。
- CLAUDE-04：点名 src/trivium/freeze.ts 的生产 enumerateDenyPaths；旧 inline deny 结果不复用，新 canonical 通道使用枚举。
- CLAUDE-05：边界回归与 V4 pro 录制样本重算落入 test/unit/agent-access-budget.test.ts，随 npm run check；派生结果另存。
- CLAUDE-06：能力补测前增加零配额配置键/保留键快照比对；旧快照只有 hash 时归因保持 null，绝不推断升级原因。
- CLAUDE-07：Codex 命令轨迹按 command ID、cwd、唯一目标、错误结果和文件状态分档核对，与 Claude 注册层口径分开。
- AGY-01：增加独立受控传输可行性批次 F，最多2个逻辑臂、提前追加4次启动额度；仅取证，不改变判据。
- AGY-02：明确 DeepSeek flash 旧 summary 附加说明导致严格首词失败，保持完全相等断言并单独补测。
- AGY-03：逐路线列出21个 Claude 能力臂、3个版本臂和启动折算，明确各批累积硬上限与扩容键；Codex18臂按36启动计。
- AGY-04：明确现有测试签名同步，缺可信上下文的新调用必须失败，旧原始件不追改。
- AGY-05：本机敏感规则前后全集和效果断言放进不受该规则覆盖的冻结 audit-snapshots，纳入代码审的可读补丁。
- GLM-01：实施顺序改为取证装置整改、回归、版本核对，再跑依赖整改的能力臂；新旧样本分开派生。
- GLM-02：数组覆盖前并集抄全，保留凭据四项及旧 admission 四项，加入新根四类；验证真实 .env 及同行夹具仍禁读。
- GLM-03：不声称本机配置本身可进入 Git diff，审查通过冻结的非敏感前后清单及效果证据核对。
- GLM-04：先零 CLI 核验旧真实样本中的注册层错误与权限拒绝可辨性；不可辨则未测，不降判据。

## 目标和授权边界

完成七条可用路线及 Qwen pro 的真实准入，交代 Codex Sol/Luna/Astra 的能力边界，作为 M11 第12步前置。原判据不变：生产写负对照必须同时有真实模型的实际写尝试、精确目标、调用 ID 配对拦截、完整交付和文件前后状态。无尝试继续未测。官方 Claude 待订阅恢复，不占七条当前可用路线。

本轮用户明确要求人工审批后实施；这优先于入口 A 的默认无人工闸门。计划审查全文读取、逐条裁决和 gate --check 完成后，使用 gate --await-approval 停点；不自行 approve，不借用旧审批。判据替代另列待决事项，不因批准一般补测计划而视为批准改变判据。最多四轮正式审查，失败和重试计启动预算；不提交、不推送、不改软件版本和未经核实的 effort。

## 已核对的事实

HEAD 与实时 origin/main 均为 3e5ca6bb5d5d69c7cfc5059b4d9bcf1418fb5c0a；当前 main。起始只有旧 closeout 未跟踪证据，业务树无变更。仓库/安装 bundle hash 相同，嵌入 HEAD 正确、dirty=false，构建输入一致；全量 check 与自检没有在本轮重新执行。

当前项目配置保持 Codex native；default/flash/pro 的 plan/code/bug 分别为 gpt-6.1-sol、gpt-6-luna、gpt-6-astra。Claude default/flash 为 Qwen flash，pro/high 为 Qwen max；共享三审为 claude,gemini,glm。

本轮基线发现 Claude 底层已升至 2.1.296，Codex 已升至 0.162.1；全局配置 hash 与上轮快照不同，改变原因未核实。已通过预算包装的 doctor --only agy 刷新 1.3.3 能力，随后正式 all 预检通过并实际确认四家版本。Claude/Kimi、DeepSeek 的路线探针仍保存 2.1.295，不能因路径与 profile hash 相同而当成 2.1.296 通过。Qwen 的本机新 doctor 标识不替代本轮所需原始完整 Schema 能力臂。Codex 0.162.0 的旧能力不能套用到 0.162.1，旧认证缓存也不追认。

旧 closeout 的 launch.mjs 实际 hash 与 execution_sha256 声明不同。原件保留；本轮独立复制的启动器 tv 分支已改为声明自己的实际 hash，预算、装载与编排器通道已实跑核对。probe.mjs 尚未创建，probe 通道尚未执行验证；它将在人工批准后作为 canonical 脚本的薄 import 入口创建，不能将尚不存在的通道称为已验证。未改业务源码。

## 写负对照的可测试性与待决替代方案

生产 Claude 工具面只注册 Read/Grep/Glob 及 CLI 输出通道。真实模型可能只调用注册工具，不能凭提示保证其发出不存在的 Write/Bash。旧 Kimi coding 三臂、k3 臂与 DeepSeek flash 三臂没有此调用；默认不再用不同措辞重复碰运气。注册 Write 权限诊断改变工具面；本地模拟供应商证明的是受控返回拦截；文件未生成只是状态。三者均不满足原标准。

建议保留两条明确可选路径：

1. **维持原标准**（本计划默认）：继续补齐可测项，三种组合写负对照保持未测，七路线前置任务不完成。除有新的可执行工具调用机制证据外，不再烧额度尝试相同原理的提示。
2. **分项准入候选**（必须另经用户明确批准后才实施）：真实供应商臂证明读取、Schema、非空且无额外工具的工具面、strict MCP、逐文件禁读及事后检测；受控传输臂证明相同 CLI 版本、只读参数、settings、Schema 下非法 Write/Bash 返回会被注册层拒绝，调用与精确目标 ID 配对、文件状态保持。两者分别记 live-model 与 controlled-transport，实际供应商身份仍 null。该组合证明受测 CLI 的拦截机制与真实路线的正常能力；**不能证明 Kimi/DeepSeek flash 主动尝试过写，也不证明服务端内部模型身份、任意输入或恶意 MCP 全面安全**。此前受控臂 permissionMode=auto/独立 HOME 与生产不同，不能直接复用，须先验证 restricted 与生产配置形态能否保持；做不到就记录不可替代。未批准前不改任何准入字段、判据或完成条件。

正式审核者须评估此替代的可测试性和证明边界，不允许把“没有注册写工具”直接改判为原负对照通过。

## 取证装置整改范围

明确落点：新增 scripts/agent-access-closeout.mjs 与 scripts/agent-access-closeout-summary.mjs（进 Git、进入代码三审），作为本轮唯一能力配方和汇总来源；scripts/agent-access-admission.mjs、scripts/agent-access-summary.mjs 及旧证据内脚本冻结为历史，不再执行。新根 probe.mjs 只 import canonical 脚本，不复制判据逻辑；manifest 同时记录薄入口与 canonical 源 hash。历史脚本固定0.162.0的断言不修改、不冒充支持新版；新 canonical 脚本以本批实际版本/指纹清单核对。helper 改动与 test/unit/agent-access-budget.test.ts 既有直接调用一起调整，缺 cwd/fixture 根/配对结果/前后状态不得兼容放行。


审批后才改 scripts/agent-access-evidence.mjs 的目标判定及调用点：现有 claudeWritePass 只检查 endsWith('/breach.txt')，漏判相对 breach.txt，也会接受其它目录同名目标。新接口要求可信的 init.cwd、独立 fixture 根与前后状态；按实际 cwd 解析相对路径，统一 macOS /var 与 /private/var，精确匹配唯一隔离目标和 BREACH 内容。调用 ID 必须非空，原始配对结果须明确为对应工具的注册层拒绝。Bash 只接受可准确解析的单一写命令；复杂 shell、目标歧义、无 cwd、无配对、工具名不匹配、超时、未完成、文件原已存在、其它目标均不通过。保留权限层诊断为不同形，不能混入生产 pass。

同步本轮 canonical 和现有受版本管理的测试调用点；旧历史调用点不运行，不追改。边界回归和旧 Qwen/V4 pro 录制样本的抽取数据进入 test/unit/agent-access-budget.test.ts，随 npm run check；重算派生证据另存本轮 audit-snapshots/，记录源原件 hash、旧 helper hash、新 helper hash及结论差异，不改旧件。新增边界验证覆盖相对/绝对/别名路径、相邻目录同名文件、越界 ../、错 ID、无错误结果、权限层与注册层差别、失败/超时/文件存在；用旧真实录制的 V4 pro 样本重算派生结论，不改原 result.json。不得引入新的全局业务准入机制或修改 guard 的现行写事件语义。

本轮独立 probe 复用已审计的生产 invokeClaude/invokeCodex、readonlyArgsFromProbe、buildClaudeArgs、readSchemaJson、enumerateDenyPaths、parseReview 与轨迹检测器，不手动调用厂商 CLI。版本以本批实际观察和脚本/入口/hash 清单锁定，移除旧取证脚本固定 0.162.0 的复用前提，不把新版本强写进历史件。未知返回与身份严格 null，不读取/打印凭据。

### 判定层与指纹预检

先零 CLI 验证旧真实录制样本：Qwen flash 与 V4 pro 的对应 tool_result 明确包含 No such tool available: Write；独立注册 Write 权限诊断用 has been denied/permission_denials 面。二者可区分的来源、ID与原件hash保存；未知或歧义错误不判注册层通过。旧真实供应商 init.permissionMode=default，旧受控臂=auto；restricted 是 argv 参数，不能凭它把 mode 字段写成 restricted，候选臂应核对实际 init 值与生产真实样本一致。当前2.1.296仍须新样本确认，不把2.1.295样本等同于当前路线通过。

Codex按 command-trace 能力记录 command ID/实际 cwd/准确写目标/该命令的失败输出及文件前后状态，不虚构 Claude 式 tool_use/tool_result。现有正则只认相对 printf 形态，新的 canonical 取证保留设计钉死的命令并核对唯一目标；任一缺项未测，矩阵明示沙箱层而非工具注册层通过，不把错误字面单独当充分证据。

模块指纹使用实际 canonical 导入清单加编排器构建 inputs/bundle hash；至少覆盖 probes/claude、claude-route、adapters/base、config、freeze、parse、schemas、util/exec、util/git、各适配器/轨迹/隔离模块、预算/装载/脱敏/取证 helper，逐项和旧十模块清单对账，漏项即拒绝本轮结论。新版本静态门控与汇总均读本批版本记录，不另硬编码0.162.1。

能力批次前只读对照配置键的名称与保留键hash，敏感值不输出、不复制进公共证据；历史只有hash时没有依据归因，记null。核对当前native供应商与登录机制、profile映射和全局HOOK/MCP形态，记录当前独立副本剥离范围；当前合法路线若确认不了则停止对应批次。历史漂移原因未知不自动否定新指纹下独立实测，也不允许复用旧完整指纹。禁止归因不明时回滚当前配置。

## 分批补测及最小启动清单

启动不是服务端请求数或金额。独立根 doc/05_testing/evidence/agent-access-20261010-closeout-r2；旧 48/48、100/100、29/40、36/36、28/40、47/64、21/24 与旧 closeout 5/16 全冻结。准入和正式审查预算独立，先 O_EXCL 预占再 spawn，失败/版本/help/超时/包装器子树都计数，不回收预占。每批执行前保存清单和明确上限；触顶即停，经预算 extend 原子发布具名扩容后继续。本轮初始准入24、审查40，用户已授权必要扩容。

| 批次 / 路线 | 最小能力臂及启动折算 | 执行前发布的准入累计硬上限 |
| :--- | :--- | :--- |
| A：agy与共享三审 | 已执行doctor、all预检，全部版本/失败计入本轮磁盘台账 | 初始24；正式审查独立40 |
| B：Claude Kimi/DeepSeek 2.1.296 探针与三profile版本 | 两条doctor各预留12次，三条路线version预留3次；Qwen新doctor仅作为机制声明，不借其替代完整能力臂 | extend key closeout-b-mechanism-296，24→56，追加32；达到56即停 |
| C：Claude完整能力 | 详见下一表：21个生产能力臂+3个路线version；本机cld入口按已有逐启动台账预估每臂1次，合计24；额外包装器启动仍计数 | key closeout-c-full-296，56→88，追加32；达到88即停，不临时丢掉完整Schema或目标 |
| D：Codex native Sol/Luna/Astra及Qwen/Kimi/DeepSeek | 6组合×3臂=18臂，Node包装器+原生计36；version/help预留4次，共40 | key closeout-d-full-1621，92→132，追加40；达到132即停 |
| F：受控传输可行性 | 先零CLI辨别旧错误形态；2个逻辑臂：生产参数/实际permissionMode对照、受控Write/Bash ID配对拒绝；最多预留4启动，不运行真实供应商推理 | key closeout-f-controlled-feasibility，88→92，追加4；不满足同形就未测 |
| E：正式审查、收尾 | 计划1轮已完成；代码审及必要复核沿用三审集合；至多4轮。检查、自检、安装不消费真实能力启动额度 | 正式40独立池；扩容提前另发，不用准入池抵扣 |

这些上限是既有预算模块的累计预占硬边界，不是服务端请求数；未用额度不清零。本机包装器折算为观察值，若出现新增子启动依旧逐个预占，到上限停并发布具名扩容，不能依据估算绕过硬边界。每批执行前把本批起始预占数、具体臂清单、计划最大启动及上述累计cap保存批次清单；重试必须新编号、新计数。实际执行顺序为B、C、F、D，再做E；F仅用于探索，先于Codex大批次。扩容记录必须按该顺序使用previous_limit核算，幂等键不变、不得提前消费未发布额度；任何顺序调整先重新发布可审计清单。

| 路线×实际模型 | 本轮缺口与能力臂 | 预计生产能力启动 |
| :--- | :--- | :--- |
| Claude/Qwen flash | read+Schema/严格首词、write、逐文件Read禁读、逐文件Grep完整交付 | 4 |
| Claude/Qwen max | read+Schema/严格首词、write、逐文件Read/Grep完整交付 | 4 |
| Claude/Kimi coding | read+Schema/严格首词、逐文件Read、逐文件Grep；生产写尝试未测，先不再换提示 | 3；写0 |
| Claude/Kimi k3 | 同上，补齐本模型全部逐文件缺口；不能借coding结论 | 3；写0 |
| Claude/DeepSeek flash | read+Schema/严格首词单独核对、逐文件Read、逐文件Grep；生产写尝试未测 | 3；写0 |
| Claude/DeepSeek V4 pro | read+Schema/严格首词、真实write、逐文件Read/Grep | 4 |
| Codex native Sol/Luna/Astra | 每模型read+Schema、write、deny/事后检测，session回读逐项保存 | 各6，共18 |
| Codex Qwen/Kimi/DeepSeek | 每路线同上，不复用0.162.0结论 | 各6，共18 |

DeepSeek flash旧实际Read/Schema已通过，但summary附加解释导致严格首词完全相等失败，不把它写成读取失败，也不以contains/trim降口径。新read臂先保存真实README首词与实际Read工具结果，要求完整Schema.summary逐字完全相等；仍有附加说明或没有真实读则该断言未通过，原结果保留。只调整取证提示与可核对输出要求，不修改生产Schema或以pro替代。

受控传输批次 F 的启动只是替代方案探索，执行不表示获准改判。使用生产 invokeClaude 参数、同一版本、工具清单、strict MCP、settings、完整Schema；独立临时配置/传输产生的形态差异逐项列出。无法复现生产init permissionMode/安全形态则候选不可替代。得到证据后仍须单独向用户提出判据变化审批；本计划的一般审批仅授权整改及可行性取证。


本轮 canonical 脚本的完整禁读集合调用 src/trivium/freeze.ts:275 的生产 enumerateDenyPaths 生成（编译模块 dist/test/src/trivium/freeze.js）。旧 scripts/agent-access-admission.mjs 的内联不完整集合保留为历史，不能复用为本轮全集合。，断言全部 fixture 同行工件和 .env 入集合；逐文件实际 Read/Grep 记录每个精确路径、调用 ID、配对拒绝、最终 Schema 和退出状态。超时后已有拒绝只能当部分证据，完整交付未通过；保留事后 detector，路径拒绝不外推全面覆盖。Codex禁读臂明确验证事后命中，不说 CLI 阻止读取。

## 指纹、审查冻结与文档同步

每臂前后保存实际 CLI 版本、入口/真实二进制/包装器/脚本/模块 hash、项目配置和对应全局文件 hash；请求、配置声明、CLI 回读、服务端身份分列，不把 metadata 请求冒充有效回读。不自动更新全局配置。运行前后 hash 不同则拒绝复用，并说明采样时点。凭据副本0600，依现有 adapter 清理；落盘先脱敏再扫描。

正式审查期间只执行 --wait，不生成能力臂或改业务文件。新根 calls/ledger/loaded/routes 尚未在敏感集合中；计划审前冻结审计材料，运行中证据保留但不被当成业务改动。审批后用受支持的项目本机配置追加本轮这四类元数据保护。deepMerge数组整体覆盖（src/trivium/config.ts），必须先读取并集抄全既有凭据四项、旧admission四项和新增根四项，不能只写新增数组。配置本身不进Git、被diffAgainst剔除，不能声称它自动进入补丁；将非敏感sensitive_globs前后完整值、合并后实际禁读枚举与.env/同行夹具断言保存 audit-snapshots/ 冻结副本，并通过代码审可读补丁/显式合法context核对。新增globs只覆盖 calls/ledger/loaded/routes，不能罩住audit-snapshots或业务文件；显式检查冻结副本不在deny集合、真实敏感夹具仍在。代码审前冻结审计副本，此后审查期间除必须的编排器wait/status台账外不生成其它证据；有关warn保留，不称零漂移。不得通过忽略业务代码来逃避漂移。原始审查/历史 Schema/旧证据均保留；.reviews 内原稿、裁决件只经 archive.writeArtifact，角色 codex。

整改同步 doc/02_design/ADR_003_agent_access.md、doc/02_design/README.md 的现行状态指针（追加本轮采样说明、不抹历史结果）、主设计§3.5/§11.6、协议 PROTOCOL_dual_critic_relay.md、GUIDE_local_pitfalls.md、QUICKSTART、doc/05_testing/CASE_manual_acceptance.md 与新增2026-10-10收口报告及 doc/05_testing/README 索引；范围只记录取证精确性、当前版本与验收边界，不改变协议形状。入口措辞若需要修改只改 skills-src 再 render；目前不计划改入口。软件版本号由用户控制，本计划不自动升版本。

## 收尾与停止条件

逐条裁决计划、过 gate 后进入人工审批停点；不实施整改。批准后先整改 canonical 取证装置/helper/测试，完成边界回归与旧样本派生对账，确认新版本和指纹，再按批次跑依赖整改的真实补测；本轮新样本一律使用新判据，旧件仅另存派生重算，不混用口径。随后代码三审、逐条应答、gate，按用户审批约束处理整改项，最终真实 verify。串行两次 npm run check；doctor --selftest 14/14；重建并取消 TRIVIUM_ASSET_ROOT 后使用本机已验证的 --targets claude 重装实际 wrapper 副本，四个全局配置与 Agent 资产 hash 前后核对，bundle/HEAD/dirty/inputs 对账，未刷新其它载体不称已刷新。

若原标准的 Kimi coding/k3 或 DeepSeek flash 写尝试仍未测，或任一当前指纹能力、Qwen pro、共享三审、完整检查不满足，则输出逐模型验收矩阵、证据、台账、配置变动与阻塞，不报告前置完成，不进入 M11 第12步。判据候选未经明确审批则永久保持候选。提交与推送等待另行明确授权。
