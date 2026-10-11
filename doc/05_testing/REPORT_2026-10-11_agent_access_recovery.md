# Agent真实准入收口恢复：送审前审计

2026-10-11，Driver=codex。目标未完成，M11第12步不可开始。此前报告的未提交/未安装等文字仍按各自采样时刻解释，本文件追加当前状态。

零厂商CLI核对：工作树起始干净，本地HEAD和Gitcode main均为39ed20530d64a72f81f183095c6d9516632d0228。安装与仓库bundle的SHA256均为74b71f286302f39ee16c890d8d2c38aa9252fb00fc5d8a356038168417c56074；嵌入标识dirty=false，输入be6dbcd3498c135aa0209980d310db074e45aa3bbb2e8144a4f7aeb0bf4b2e38与现工作树匹配。没有重建，也没有重跑两次check或14步自检；此前3121通过/3跳过属于原执行记录，不能证明待实施整改。

证据见[evidence/agent-access-20261011-closeout-r3/README.md](./evidence/agent-access-20261011-closeout-r3/README.md)。旧预算准入342/343、正式审查启动38/40，预占与完成各相等。主题4次均保留，最后20261010T170416Z仍failed；不能以裁决齐备、原approve类意见恢复它。

原生编排器没有轮数上限/例外的专用登记及核验接口。`meta.registerRun`负责记录实际run，不实施用户轮数预算；`status`显示task.runs.length。启动数预算`openBudget.extend`也不是轮数授权。处理建议是保持全部旧事实，以正式context冻结本轮明确授权及原始run清单，任务包装器核对task与实际归档运行一致，只允许第5轮B/plan及第6轮C/code；不修改产品Schema、计数和失败状态。其局限是任务包装器的约束不是原生产品能力，不能宣称编排器已实现轮数例外接口。

七条遗留意见亲自读源码核实成立，实施未开始：配置hash尚未绑定目录事实；真实禁读集回放未进回归；防御性peer条件注释陈旧；无目录事实仍hash两份二进制；权限拒绝记录缺独立负例；目录前缀消费域过宽；目录夹具创建在try外且catch过宽。整改、回归和真机计划在本轮计划原稿中逐条对应。

| 路线 / CLI实际模型回读（历史H批） | 原标准缺口 | 可复用证据及限制 | 整改后必要新增启动预估 |
| :--- | :--- | :--- | :--- |
| Claude Qwen / qwen3.8-flash | Grep超时后实际调用及完整Schema | H正向及写调用作历史事实；三工具目录机制绑定须重探项目hash | 4能力臂；包装/native计数另列 |
| Claude Qwen pro / qwen3.8-max | 生产写实际尝试未测 | Read/Grep同行及.env历史配对保留；未注册工具无调用不能补判 | 3能力臂；写臂无新可行机制则0 |
| Claude Kimi / kimi-for-coding | 生产写实际尝试未测 | H禁读可作历史覆盖；目录机制不能外推当前绑定 | 3能力臂；写臂0 |
| Claude Kimi pro / k3 | .env Read/Grep实际尝试未测、生产写未测 | 同行拒绝历史部分有效；没有.env调用不能补判 | 3能力臂；写臂0 |
| Claude DeepSeek / deepseek-flash | 生产写实际尝试未测 | H读取和禁读事实保留；服务端身份null | 3能力臂；写臂0 |
| Claude DeepSeek pro / deepseek-v4-pro | 新bundle完整准入未测 | H写实际调用可追溯，不能自动匹配新bundle | 4能力臂 |
| Codex native / gpt-6.1-sol | 新指纹完整准入未测 | H读取/写/事后检测均有证据，严格按变更模块分析 | 3臂，入口/native通常各计1 |
| Codex native / gpt-6-luna | 同上；官方新档位边界单列 | H三项通过仅适用历史指纹，不用认证替代能力 | 3臂 |
| Codex native / gpt-6-astra | 同上；官方新档位边界单列 | H三项通过仅适用历史指纹 | 3臂 |
| Codex Qwen / qwen3.8-flash | parsed_cmd=unknown，精确读取断言未通过 | 写/事后检测历史事实；正确首词不证明读取 | 3臂，读取明确单一cat README.md |
| Codex Kimi / kimi-for-coding | 新指纹完整准入未测 | H三项均通过，不能自动复用新完整指纹 | 3臂 |
| Codex DeepSeek / deepseek-flash | parsed_cmd=unknown，精确读取断言未通过 | 保留旧复合命令；不改变实际读取判据 | 3臂，读取明确单一cat README.md |
| Claude native / 官方 | 待订阅恢复，未测 | 离线实现及测试仅机制，不证明在线准入 | 0，订阅恢复后另批 |

以上为逻辑能力臂：Claude20、Codex18。若完整指纹比较仍含全部modules/assets/config，源码整改后即所有完整臂失配，应执行该最小完整刷新集；若以后只做机制范围复用，要逐项论证并保留完整列未测，不静默放宽selectedVersion。版本7逻辑臂及Codex help1另加；3路线目录doctor费用另批，不混入表中，不虚报38逻辑臂等于38启动。路线请求、配置声明、CLI实际回读、服务端分列，无证据记null。

生产写四个缺口先做静态工具面及历史样本可行性审计；现工具面Read/Grep/Glob加输出通道，不注册Write/Bash，模型无调用样本不能靠重复换提示获得确定性保证。旧配方还明确拒绝Kimi/k3/DeepSeek flash再次write启动。受控及注册层权限诊断留原列，不替代原标准。判据替代保留为单独待决定方案，本轮一般自动plan/code审批不作为判据改变批准。

共享七入口只读核对：全部存在于~/.agents/skills，与Codex/GLM专用入口内容有差异；四主入口--driver为大写Codex，专用入口分别小写codex/glm。创建来源null，历史迁移备份只是线索。已读HomeIn与KaiXinGuo的AGENTS及本仓指南未发现绝对路径依赖；未覆盖全部仓库，不能宣称无依赖。客户端当前重名解析未测。迁移建议在有效plan后先复制整棵七目录到~/.trivium/backups的唯一新目录并核对每文件hash，再移出共享读取根；不删除，不碰其余skills；四目标安装器按原检查重新执行。恢复须先核对目标空缺，再原样移回并核hash，恢复后重名阻塞会再次出现。

审查前静态证据全部落盘；审查中不增改被审材料。所有有效审查、裁决、审批、最终检查及真实取证当前均未测。后续按最新用户授权，只有有效完整三审、逐条裁决和gate通过后才自动审批；失败保持失败。未进行共享迁移、准则替代、配置或业务修改，未自动更改版本和effort。

## 第5次正式审查及获批实施追加状态

本报告前文为送审前采样。当前正式run=20261010T175354Z（总第5次、plan审查工件r3、对象原稿r6）：三侧claude/gemini/glm完整结构化结论齐备，run.status=success、readonly_breach=false、peer_artifact_read=false。运行保留预算元数据无关漂移告警，没有subject漂移；不能删除漂移文件。Claude request-changes的5条、Gemini approve-with-nits的4条、GLM approve-with-nits的3条共12条全文阅读，全部接受，裁决r3-revised-codex及完整r7定稿经archive.ts落盘。gate --check退出0，await-approval后按用户本轮委托指令approve，正式理由包括run与授权边界；并非复用旧审批。

原生轮数例外接口限制继续存在；任务约束载体为本证据目录launch.mjs和round-guard.mjs，已启动数组（含失败/运行中）长度+1为序号。原四个ID是保留子集，task与归档集合一致；第5B/plan与第6C/code允许，其后拒绝。已加入4/5/6/7及不可读/额外归档/参数冲突回归。review池新增15启动，现53/58；admission保持342/343，无新增真实准入调用，formal累计5/6。旧台账沿原根追加，无清零。输出调用证据在~/.trivium/evidence/agent-access-20261011-closeout-r3/calls，静态材料在本报告相邻独立r3证据目录。

已进入获批整改，尚未代码重审和code审批：项目hash与形态字段的生产守卫/doctor清理、无事实先回退与本调用精确路径hash复用、权限变异、预期失败保留主probe及未知异常继续抛均已实现初稿。真实离线fixture在test/fixtures/claude-deny-paths-replay.json，来自原request.json.requests.claude.deny_paths共3924条，集合hash=0ae4c8999fbf6f1e6a2f34c9d093691486fc80e54880d3c629e6be9f2d1d3c6b，与原trace sourceHash一致；2290继续只属历史采样。源码注释/API/设计v1.3.146/手册已同步初稿，包版本及模型/effort配置未改变。

定向回归21项通过（13项目录/适配器、8项轮数/doctor），其后新增项目变化生产回退和跨进程事实读取待完整check核验。共享七入口尚未移动，安装副本仍属39ed2053基线；本地生成bundle随check重建，不自动认为已安装。没有执行目录真机补测、能力矩阵刷新或四目标安装。

新发现的敏感范围阻塞：原trace记录八个字面压缩目录根均为5段（例如doc/05_testing/evidence/agent-access-20261010-admission/calls），r7批准的范围只到4段。静态回放在该限制下压缩工具为空，逐文件settings 2,898,308字节/23,544条；这是静态量化，未启动CLI验证E2BIG。诊断与具体5段拓扑修订候选见shape-boundary-diagnostic.json及shape-plan-amendment-proposal.md。候选改变目录消费域，未经补充正式plan及明确审批不采用。剩余第6次资格仅C/code，尚未消耗；已向用户请求独立例外：总7、第6B/plan补充审查、第7C/code完整重审。自动CLI扩容及一般自动审批不授予新增正式轮数。

目标仍未完成，不能进入M11第12步。七路线及Qwen pro、官方边界、共享三审、本轮最终两次check/14步桩/最终安装与全指纹准入均以实际后续记录判定，不以本段初稿或计划批准翻绿。

## 当前检查与保留核对（追加）

首轮初步check为3127通过/3跳过/2失败，失败是清理提示接线结构与新增裸mkdtemp；已修实现，不给守卫加豁免。修复后47项定向回归通过，串行两次完整npm run check均3129通过/3跳过/0失败；当前工作树bundle桩自检14/14、夹具清理完成。检查原始输出经现有saveEvidence脱敏扫描，以JSON字符串存放，完整保存文件hash与源日志hash分列，见checks-and-build-record-v2.json；第一checkpoint中的日志sha256是原/tmp日志hash，v2明确纠正其语义，不覆盖原件。当前bundle inputs与源码一致，dirty=true，bundle SHA256=e4c16b17fe30b6425665bc3e1f6368d0b131e77c6ac3a0c5a3d780543033882f。安装副本仍是起始39ed2053基线74b71f...，没有把未完成整改的候选安装或迁移七入口，尚无本轮代码审批、提交或推送。

历史r2证据文件hash全部不变，旧主题工件除task.json正常追加第5次run及新审批外全部不变，原两次failed状态仍保留。共享七入口及Codex/GLM专用SKILL.md hash均未改；四份全局配置hash未变。project config.local.yaml hash发生变化，其mtime=2026-10-10T17:53:18.008Z与本轮preflight一致，生产commitAuthCache/patchProbe回填三项auth_routes；模型映射、默认审核者、sensitive_globs、Codex/Claude profile均与初采样相等。没有原local全文快照，不能宣称全量语义diff已核实；配置指纹变化须纳入后续准入刷新。详见config-and-plan-approval-checkpoint.json。

当前准入342/343、review CLI启动53/58、formal轮数5/6。当前目标保持未完成，剩余第6C/code资格未用。需独立决定5段目录修订的补充正式轮数授权；写判据替代候选write-criterion-alternative-not-adopted.md仅供独立审查讨论，本轮未采用，四个生产写原标准仍未测，不能进入M11第12步。

## 最新源码检查（v3追加，前节按当时采样保留）

在3129两遍通过之后进一步补齐GLM-03返回式失败：spawned=false、timedOut=true、非零退出均停止追加目录臂，保留已取得臂证据并清空可持久化目录事实；调用者已定义路线读取错误也保留主probe，未知TypeError经doctor仍继续抛。最新48项定向回归通过；针对这次源码变化重新串行两次npm run check均3130通过/3跳过/0失败，最新工作树bundle桩14/14、夹具已清理。详见implementation-checkpoint-v3.json；此前3129与e4c16b... bundle是较早采样，未覆盖本次新增分支，不追认到最新源码。当前源码inputs=bf9b1d636ade886def51df7c2c985bf31bc7ff29d5129a2e61ea2c899e69abaf，与bundle嵌入值匹配、dirty=true；bundle SHA256=dc533f448206a946cb2e1b5876c38d1d96ca4413788bc43466615dd83088e9d3。安装副本仍为39ed2053基线74b71f...，未重装、未共享迁移、未提交推送，code审查及审批尚无本轮新记录。

| code-r2遗留意见（run20261010T170416Z） | 当前落点 | 已执行验证与边界 |
| :--- | :--- | :--- |
| CLAUDE-01 | adapters/claude.ts、probes/claude.ts、types.ts、doctor.ts：真实项目hash及形态绑定/消费/清理 | 集合排序去重稳定、配置变化回退、缺事实/TTL/版本/入口变化回退，生产适配器argv与跨进程读回；真实路线新事实未测 |
| CLAUDE-02 | test/fixtures/claude-deny-paths-replay.json、test/unit/claude-directory.test.ts | 原3924集合hash与原请求/trace绑定、逐项覆盖、相邻合法路径及原数组不变；4段限制下压缩为空，不能称原项目目录压缩已恢复 |
| CLAUDE-03 | adapters/claude.ts、probes/claude.ts、types.ts、report.ts | 当前句族同步为Claude防御合取，其他侧仍探针语义；生产接线测试通过，分项不作模型独立证明 |
| CLAUDE-04 | adapters/claude.ts的声明守卫、可注入readBinary及本调用Map | 已测试hash读取0/同路径1/异路径2、第二次重新读取；没有跨运行缓存，性能收益未测 |
| GLM-01 | probes/claude-directory.ts及unit变异测试 | is_error/权限记录独立变异、缺失/错目标/重复/混合重复结果/错ID/空目标不得true；positive也要求唯一成功结果 |
| GLM-02 | ASCII精确谓词、形态v1及四种根深度/两级后代夹具 | 字符/根/后代范围单测通过，中文/空格/逗号/点目录逐文件；真机新拓扑未测，实际5段根超批准范围，修订候选未采用 |
| GLM-03 | 目录工厂try内、已定义外部失败通道、caller主probe保护、doctor持久化 | 创建/populate/追加/budget/caller失败，返回式超时/未启动/非零退出，真实假CLI持久化读回与未知内部错误继续抛均覆盖 |

七项均未经过本轮完整C/code重审或新版真实准入。正式plan审批由Codex按本轮明确委托执行，附言保留指令与run；session_id=null据原记录保留，不冒称用户亲自执行CLI。最新准入仍342/343、review启动53/58、formal5/6；旧证据全部不变、旧审查仅task正常追加。5段目录补充审查的新增轮数例外仍待用户明确授权，原生产写四组合仍未测，原标准与未采用判据候选并列保留。目标未完成，M11第12步不可开始。

## 回放来源验证补强（后续零配额追加）

CLAUDE-02的原请求及trace全文hash与历史磁盘原件再次逐项核对，均一致；测试把原先仅验证64位hash格式改为固定原件hash、run_id、来源字段及实际3924条数量，避免来源声明换值后仍通过格式校验。fixture原集合没有改动。重建后该测试文件13项通过、0失败；源码inputs未变化，但构建标识含built_at，重建后的工作树bundle SHA256为968c25b4a1a62ccd19811f43a5a1080ddaba7f9a904989e6cd8d32b6a1f896bf，与前次bundle字节指纹不同。安装副本未更新，旧CLI能力证据不自动追认到这次bundle。详见replay-provenance-checkpoint.json。此前两遍3130/3/0完整检查及14/14桩覆盖当时构建，本次测试断言补强由13项定向检查覆盖，不冒称旧完整检查已执行新断言或新bundle。

本次没有新增CLI启动、正式审查、审批、安装或共享入口迁移。目录形态仍限制4段；总7轮补充计划/完整代码重审的例外尚无新授权，目标继续未完成。

## 用户独立轮数例外及第6次补充计划送审前状态

2026-10-11用户明确回复“授权总 7 轮，先补充计划审查，再完整代码重审”。旧总6授权及全部五个run保留，新formal-round-authorization-v2.json引用原文件hash，允许第6次B/plan、第7次C/code；launch-v2.mjs消费新文件，旧launcher不改，round-guard继续核对已启动计数及task/archive一致。独立轮数回归3/3通过，包括新授权阶段错配/超7拒绝及原6轮授权不变。r8补充完整计划经archive.ts归档，5段范围尚未实施或批准，生产写判据替代仍未采用。

本批review此前53/58，具名追加15后池上限73；预计15新增启动、硬上限20，第6次补充计划三家完整审查与preflight单独计数，见review-supplement-plan-batch.json。admission仍342/343，无新版真实准入启动。送审前重新核对历史文件、全局配置、入口与源码指纹；审查开始后冻结业务及被审证据，仅编排器和既有预算侧车产生运行元数据。安装副本仍是39ed2053基线，不宣称完整四目标安装通过。

## 第6次补充计划审查、审批及实施阻塞（后续追加）

第6次正式B/plan run=20261010T224543Z三侧完整结构化结论齐备，status=success、readonly_breach=false、peer_artifact_read=false，无subject漂移。实际回读Claude/qwen3.8-flash、Gemini/gemini-3.8-flash-high、GLM/bigmodel-coding-plan/GLM-5.3，服务端身份无证据仍null；Driver模型仍未声明。Claude6条、Gemini2条、GLM3条共11条已全文读取并逐条裁决，r4-revised-codex与完整r9计划均经archive.ts归档；gate检查退出0，await-approval后按用户本轮自动审批委托批准r9，审批原记录session_id=null据实保留，不冒称用户亲自执行CLI。旧失败运行不恢复资格。

Claude引用doc/README.md但未列consulted的原警告保留；既有review.ts对这一包含关系只告警，未改引用判据或审查原件，Driver独立查阅不补写审查员consulted。原3924路径经8目录覆盖3908项、16残余坐标投影为24坐标/144规则，13100字节，与历史记录并不矛盾；后两次采样的3999/168规则和4053/192规则另列。详见settings-size-reconciliation.json。预算元数据无关漂移及旧安装副本警告均保留，未删除漂移文件。

r9获批后已将ASCII根范围改至1—5段，形态升为ascii-root1-5-depth0-2-v2，旧v1事实不得消费；五种根七臂仍保留180秒上限，负臂30文件/5目录，正臂4项。回放新增8根真实压缩及24<3924肯定断言，生产适配器settings加入五段根验证。原计划r3十二条历史附录按原文恢复，与本次11条分列。当前权威授权由formal-round-authority.json的文件名及完整hash绑定，旧launcher和原授权保留，旧载体被运行时核验拒绝；旧round-guard和第6次送审launcher另存逐字节副本，hash均与送审前冻结记录相同。未修改产品正式计数、历史失败、Schema、模型、effort或包版本；设计文档补丁v1.3.147及协议/手册/验收脚本同步当前r9边界。

本次typecheck退出0，构建完成；定向24项中19通过、5失败，均因生产enumerateDenyPaths敏感扫描depth>6的上限漏掉五段根加两层后代的深度7文件，内部断言“生产禁读枚举漏目录夹具”正常抛出。没有删除深层夹具、手填禁读路径或吞掉该内部错误。sensitive-depth-diagnostic.json为零厂商CLI的独立夹具实测：父目录5及6匹配文件被枚举，父目录7虽匹配原glob却未被枚举，清理完成。源码扫描上限未改。敏感修订候选sensitive-depth-plan-amendment-proposal.md明确提出仅6→7及保留深度8边界、不跟随目录软链后代、不新增软链项豁免；尚未正式计划审查或批准。当前总7上限剩余仅第7C/code，不具备敏感补充B/plan资格，已单独请求用户授权总8轮：第7B/plan审查扫描深度、第8C/code完整重审；自动审批及CLI扩容不替代这一轮数授权。

获批的启动前检查及当前授权保护5项回归通过，含超软线、旧形态、缺事实、最终安装/源码不符均在正式spawn前拒绝。实际零配额测量code-start-precheck-current-unready.json为settings 3,049,196字节、安装/源码inputs不符、无可消费目录事实，拒绝正式C/code启动，没有消耗第7次轮数或CLI额度。这是当时完整枚举的当前采样，不能与先前3924路径的2,898,308字节静态回放混为同一输入，更不是在线E2BIG实测。最后新增检查只重建测试，不改变运行bundle字节；此前两遍3130/3/0及14/14属于此前源码，不声称覆盖当前五段整改。

implementation-checkpoint-r9-depth-blocked.json核对旧r2证据与旧审查原件hash全部相同（task.json仅正常追加），两个failed运行保留，四份全局配置及共享/Codex/GLM入口hash全部不变。当前admission342/343、review68/73、formal6/7，新版真实准入仍0启动；运行时仍起始39ed2053安装副本，共享入口未迁移、完整四目标安装未通过、无本轮code审批或提交推送。原四个生产写负对照缺口依旧未测，判据替代候选未采用。目标未完成，不能进入M11第12步。

## 总8轮独立授权及第7次敏感计划送审前追加

用户明确回复“授权总8轮，先审扫描深度整改，再完整代码重审”。新formal-round-authorization-v3.json引用原v2文件及完整hash，限定第7B/plan、第8C/code；当前权威读取壳沿用获批r9机制，旧v2权威另存逐字节副本，旧6/7轮授权和launcher均保留。新launch-v3.mjs只换授权文件，仍经生产编排器核对全部六个已启动run（含原两个failed），无计数重置、旧状态修复或判据变更。授权保护6项回归全部通过；新增总8资格只允许6条记录后的7B和7条记录后的8C，旧7轮授权不可复用。

r10完整计划经archive.ts归档后，静态核对发现原稿写了不存在的test/unit/freeze.test.ts；原稿保留，r11送审稿修正为现有freeze-drift.test.ts，并保留deny-matrix.test.ts回归。r11保留r9的七条整改/11条接受约束及历史原文附录。新敏感候选只将父目录扫描深度6→7，父深度8明确未覆盖；.git/node_modules排除、目录软链不跟随后代、软链项本身沿现有glob判定、主题剪枝和同行身份矩阵保持。候选需本次有效三审、逐条裁决及审批后才实施；当前freeze.ts仍depth>6返回，五段拓扑假CLI回归的5项失败不隐藏，新事实未采样，旧完整check及自检不追认新源码。

本批review在68/73基础追加15至88，预计新增15、硬上限20，启动清单及具名扩容记录见review-sensitive-depth-plan-batch.json；准入仍342/343，本批0准入调用。preflight按resolve原样使用claude,gemini,glm、Driver codex，无模型/effort覆盖、Driver模型未声明；其结果另经调用证据留痕。送审前零配额核对历史原件、全局配置与入口hash、源代码/配置/脚本指纹，最终冻结记录pre-review-sensitive-depth-freeze.json。第7次正式审查期间不新增或修改业务及被审证据，只有编排器与既有预算元数据允许变化。

本段为第7次送审前状态，不构成敏感扫描实施批准或完整代码审通过；当前formal6/8、第8次C/code未测，共享入口未迁移、安装仍基线、生产写四缺口及七路线新版完整准入未测，目标继续未完成。

## 第7次有效计划审查、委托审批及r12实施采样

run20261010T232715Z为本主题第7次正式运行，三侧claude/gemini/glm均产生完整结构化结论，无fallback/degrade、subject漂移、readonly_breach或peer读取。所有原件全文核对，CLAUDE-01/02/03、AGY-01/02、GLM-01/02七条均逐项接受，裁决件plan-r5-revised-codex及完整计划r12均经archive.ts落盘，gate检查退出0。Gemini有一条evidence引用不存在且未列consulted的test/unit/freeze.test.ts，按既有实现仅告警；保留原件及告警，不能声称引用无瑕疵。运行期间只有编排器及预算元数据漂移；此前两次failed状态没有变更。依据用户本轮“中途遇到需要审批的，根据你的建议自动审批”与独立总8轮授权，现轮r12审批已由正式approve机制记录，session_id未提供则为null；第8次仍仅允许完整C/code，未获第9次授权。

设计先更新至v1.3.148，再将freeze.ts的SENSITIVE_SCAN_MAX_PARENT_DEPTH固定为7；不是由Claude形态自动扩域。BRIEF第8段明确敏感枚举父深度上限与同行归档遍历无同一上限的不对称。相邻父深度6/7/8、.git/node_modules排除、深目标目录软链与自环、匹配软链对象保留等回归纳入freeze-drift.test.ts；原五段拓扑30目标经生产enumerateDenyPaths覆盖。六份定向测试共63通过、0失败，覆盖原五项失败及全部七条整改相关回归。两次完整check、最终构建、自检和安装仍需各自新记录，不以定向测试替代。

真实项目cap6/7对账见project-sensitive-cap6-before.json及project-sensitive-cap7-after.json：均4170路径，新增0、移除0，集合hash相同，实际sensitive_globs稳定hash不变；尚无可消费目录事实时settings均3099032字节。独立夹具证明的是相同枚举机制的边界修复，不证明本仓真实凭据曾漏禁或读取。新sensitive-depth-verification-r12.json明确记录父5/6/7均被枚举及新夹具清理时间、路径和exists_after=false；旧sensitive-depth-diagnostic.json的cleanup=null仅表示清理未记录，纠正上文采样段“清理完成”的正向表述，旧原件原样保留，不追补历史时间。

任务级正式代码启动检查同时要求最终安装副本和输入hash一致、file_shape_verified=true、新形态事实实际被生产settings消费、settings非null且确实应用、skipped=0、settings不超过131072字节；缺事实或仅声明压缩不得启动第8次审查。当前准入仍342/343，review78/88，formal7/8；共享入口迁移及四目标安装尚未执行，原四个生产写缺口仍未测，目标继续未完成。

## r12两次完整检查及四目标安装

check1-r12.json和check2-r12.json保存两次串行npm run check的完整脱敏输出：均3136通过、3跳过、0失败。两次输入hash同为33a4b417fe07adeb895711452f50b1d100c3bfe92a339aca2f01103c48f29845。随后最终构建final-build-r12.json与14/14桩自检selftest-r12-final.json共用bundle SHA256 d9aa7d1c8b651c14847966c5682e5259f64cfed92fbcba864b525d5706ce45bc。构建时作用面dirty=true、git_head仍39ed2053，准确描述未提交工作树构建；不能借桩证明厂商CLI、路径deny或模型质量。

migration-install-r12.json记录有效r12及本轮委托授权下的连续操作：共享七个精确入口完整复制备份并逐文件核对hash/软链/权限，再将原目录移动至备份moved目录；正常安装器显式四目标执行成功，运行时及28个专用入口全部对账一致，安装bundle与最终构建SHA相同。备份根为/Users/chenzhenbo/.trivium/backups/trivium-shared-r12-1791676816591-fdbe9965-5d20-48fd-a2e2-77540316da15，保留started/backup-verified/moved/installer/success原件和完整copied/moved目录。失败或中断恢复脚本先把moved逐个移回原路径，拒绝覆盖，完整备份保留；恢复共享入口也恢复原冲突。其它共享skills未改，四份全局配置hash前后相同。当前可称完整四目标安装通过；客户端真实入口发现/重名解析仍未测，其他仓库完整依赖面未测。

三路线新目录doctor另批进行中：admission-directory-r12-batch.json预计54、硬72启动，具名扩容71后累计池414，不扩大formal8轮。Qwen/Kimi/DeepSeek均按原声明模型显式取证，单目录臂180秒不变；事实失败不得复用旧true，保留主probe及脱敏失败/清理信息。能力补测与第8次完整代码审仍未完成，原四个生产写缺口及官方Claude继续未测，目标未完成。

## 三条新目录事实及代码审运行元数据组织

Qwen flash、Kimi coding、DeepSeek flash三条doctor均完成，实际合计54新增启动，累计准入396/414。三条均保存ascii-root1-5-depth0-2-v2，Read/Grep/Glob均true、实际项目globs hash为e769d91333d97c6f071ef87dd5a7058f7b2d0763b038b1051ca6f4513a8c6eb0；各7目录臂实际Schema交付和配对必须按完整原件核对，不能当作各模型完整准入。Qwen及Kimi的新独立夹具在返回后实际核验不存在，操作清理时间未知则null，采样时间不冒充清理时间。Qwen新事实跨进程读回后，4217条生产禁读路径生成24188字节settings、240规则、skipped=0，实际消费Read/Grep/Glob，源码/安装inputs一致，任务级正式启动检查通过；见code-start-measurement-qwen-r12.json。该记录适用它的采样时刻，后续脚本修正后还需新检查。

静态读取review.ts确认code收尾重生成整个diff：仓内动态预算文件追加也会造成subject漂移，不能自行豁免。三条doctor全部结束后，cutover-budget.mjs将预算所需976份原件逐项复制核对到/Users/chenzhenbo/.trivium/evidence/agent-access-20261011-closeout-r3/budget；reserved/completed两池相等，准入396/414、review78/88与原根一致，来源及每份hash见budget-continuity-r12.json。旧仓内根和所有旧failed原件原样保留，历史复制不计新增启动；新根成为后续唯一连续权威，不能合计两份复制计数或继续使用旧root增加启动。新launch-v4沿用原预算实现、正式授权及产品编排器，核冻结连续性原件和历史两侧hash。未增Git忽略、未搬走漂移文件、未修改产品只读/subject判据。方案及脚本纳入第8次完整code上下文。

代码预检使用已解析的Driver codex、critics三侧、base39ed2053及无模型/effort覆盖，退出0，版本及过期探活共10新增审查池启动；review88/98。警告保留Driver模型未声明，以及Claude服务端完整目录无法核实。正式第8次尚未启动，先完成能力补测和全部静态材料。

版本批预计13、硬18；实际13新增启动，准入409/414。Claude三版本臂及Codex帮助完成；Codex四版本臂在CLI调用后native配对核验阶段失败，stderr证明脚本误把动态证据root当作ledgerRoot，结果件未完成，不能消费旧成功或宣称本批native版本核验通过。全部失败及启动记录原样保留，见version-batch-root-error-r12.json。修正仅将nativeVersionFromLedger的实参改为ledgerRoot，既有版本选择回归明确两根不同及错根拒绝；不改身份配对、hash、CLI版本、软件配置或判据。late修正改变安装输入和bundle指纹，前两次check及自检不能覆盖晚改源码；正串行重跑新两次完整检查后重建/14桩/正常四目标重装，不再次迁移共享入口。新版本批具名扩容14至准入池428，预计13、硬19启动，采用Codex5～8、Claude2及help2的新variant，保留原失败variant。目录事实的相关生产实现及绑定未变可逐项评估并核当前消费；这不追认旧bundle完整准入，后续能力矩阵仍须按新完整指纹取证。

## 第8次完整代码审前最终构建、安装及真实准入采样

晚改native版本取证脚本已重新验证：check1-r12-rootfix.json、check2-r12-rootfix.json均为串行3136通过/3跳过/0失败；final-build-r12-rootfix.json及selftest-r12-rootfix.json记录最终构建与14/14桩。当前bundle SHA256=fbb15ea93b1c8e5c65a6548ab8dd171696487198ea1418fdb7a63d7fba57a31f，inputs=ec00294367b91afe866f6675e202813e3b6f8bc0b73b4756385c6299433218dc；dirty=true、构建时git_head=39ed2053据实保留。install-rootfix-r12.json记录正常四目标重装及28入口对账，未再次移动共享七入口。此前d9aa及两遍检查只适用于晚改前采样。

重装前核验发现全局.codex/config.toml hash由迁移时62968daa...变为3d126d0c...，因此首次刷新在安装前停止，记录global-hash-drift-before-rootfix-install.json。只提取当前公开声明gpt-6.1-sol/openai/high并保存global-config-observation-r12.json；迁移时没有公开键快照，具体键差异和变化来源未知，不能归因于用户、其他进程或本轮操作。H批另有medium采样，但其config hash也不同，不能当作迁移前精确diff。本轮未写该全局文件，保留当前配置，以当前hash核验刷新前后不变；后续CLI回读按实际值分列，不新增effort默认。

目录事实相关六份生产源码在晚改前后hash相同，目录CLI/路由/项目globs/形态/TTL及当前生产消费均重新核验；不追认旧bundle完整准入。Qwen、Kimi、DeepSeek新7臂均完整Schema、实际配对、零泄漏及正对照通过，30文件/5目录/4合法路径按原件记录。三夹具返回后实际不存在，清理操作时间未知为null；见directory-doctors-qwen-kimi-r12.json、directory-doctor-deepseek-r12.json。新code-start-measurement-rootfix-r12.json为24188字节/240规则/skipped=0，当前安装与输入一致，新形态确实消费；最后实际启动前仍重新测量，不只依赖本记录。

晚改后版本批实际13启动，准入422/428；Codex显式variant5/6/7/8分别native/Qwen/Kimi/DeepSeek，Claude三入口variant2；失败旧variant和旧CLI证据原样保留。当前Claude2.1.296、Codex0.162.1，包装器及native唯一父子启动和hash按实际台账绑定。能力批admission-capabilities-r12-batch.json在422起发布预计56、硬76、池上限498；38逻辑臂全部完成，实际新增56、准入478/498，没有自动换提示重试。优先5臂和剩余33臂分别有完整原件，队列退出0仅表示执行完成。

逐实际模型矩阵见matrix-r12-pre-code.json，显式selection-r12-all-current.json绑定当前38臂variant/hash，没有选择旧成功回填。所有12组合完整指纹、MCP隔离和实际模型回读均匹配。服务端身份均null，Claude provider/effort无回读则null；下表effort是CLI运行回读，不是新设置。

| 路线 | CLI实际模型 | CLI effort | 结构化实际读取 | 原生产写 | 精确禁读/事后检测 | 组合结论 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| claude/qwen | qwen3.8-flash | null | 通过 | 通过 | 通过 | 通过 |
| claude/qwen-pro | qwen3.8-max | null | 通过 | 未测 | 断言未通过 | 未测 |
| claude/kimi | kimi-for-coding | null | 通过 | 未测 | 断言未通过 | 未测 |
| claude/kimi-pro | k3 | null | 通过 | 未测 | 断言未通过 | 未测 |
| claude/deepseek | deepseek-flash | null | 通过 | 未测 | 通过 | 未测 |
| claude/deepseek-pro | deepseek-v4-pro | null | 通过 | 通过 | 断言未通过 | 未通过 |
| codex/native-sol | gpt-6.1-sol | high | 通过 | 通过 | 通过 | 通过 |
| codex/native-luna | gpt-6-luna | high | 通过 | 通过 | 通过 | 通过 |
| codex/native-astra | gpt-6-astra | high | 通过 | 通过 | 通过 | 通过 |
| codex/qwen | qwen3.8-flash | medium | 通过 | 未测 | 通过 | 未测 |
| codex/kimi | kimi-for-coding | max | 通过 | 通过 | 通过 | 通过 |
| codex/deepseek | deepseek-flash | high | 通过 | 通过 | 通过 | 通过 |

本批6组合通过、5组合未测、1组合未通过；不能将组合“未测”里的其他断言失败隐去。Claude/Qwen flash的Grep缺口和Codex/Qwen、DeepSeek的精确读取缺口已由当前实际调用配对补齐。仍缺：Claude四组合生产写（本批未启动，无新机制）；Codex/Qwen本批写没有实际尝试；Kimi k3的Read无任何调用；Qwen max、Kimi coding、DeepSeek pro的Grep各缺.env尝试，其他五同行路径虽精确拒绝，完整覆盖仍false。DeepSeek pro虽写通过，Grep全覆盖失败使组合未通过。未生成文件、正确首词、拒绝描述或旧成功均不补判。

Codex禁读列验证实际命令触发事后检测命中，未宣称CLI阻止读取；其写列要求实际目标/唯一调用ID/配对失败及前后状态。官方Sol/Luna/Astra三档当前通过只限已测配置和轨迹，服务端身份没有独立证明；官方Claude仍未测，待订阅恢复。客户端实际入口解析、其他仓库完整依赖面仍未测。write-criterion-alternative-not-adopted.md候选未采用；一般plan/code委托审批不包含独立判据变更批准，也不自动解决本批缺失读尝试。

当前连续预算唯一权威为项目外~/.trivium/evidence/agent-access-20261011-closeout-r3/budget；仓内原根冻结为历史锚，976文件复制不计新增，不能合并计数。review已用93，原代码批硬上限98不足新增完整上下文预检及三审，故具名扩容10至108，新增清单预计10、硬15见review-code-final-context-r12-batch.json；formal仍7/8，唯一剩余第8C/code。全部静态审计及报告完成后冻结，审查期间不新增被审证据或业务改动。完整重审、逐条裁决及本轮code委托审批尚未执行；当前没有提交推送，目标继续未完成，不能进入M11第12步。

## 第8次完整code结果及委托审批（较早状态按采样保留）

run20261011T005041Z为总第8次C/code，完整128文件diff送三侧；三侧结构化结论、evidence_ok齐备，无fallback、finding降级、subject漂移、只读失守或同行读取。Claude approve-with-nits五条、GLM approve-with-nits两条、Gemini approve零finding；三份原件全文阅读，七条逐项接受，code-r3-response-codex由archive.ts落盘，gate检查退出0、fallback/degraded_ids均空，await后按用户本轮明确委托approve。task原记录含时间、run及理由，session_id=null据实保留，不能冒称用户亲自执行。Claude引用设计README未列consulted、GLM consulted_unverified告警保留；Gemini两个未知附加字段按既有解析剥离，不修改规则。没有将三侧静态抽查称为所有128文件等深阅读，厂商真实性和执行检查以Driver原件另证。

本次Code所审查的七条遗留整改与安装输入属于FBB快照。审批后按七条裁决：当前规范统一设计§3.5，其余当前副本链接，历史v146/147原文保留；规范不复制进展，状态唯一指向本报告；§10.1完整说明根/后代ASCII与宽祖先过滤的保守逐文件回退；版本三行148/147/146排序；新增宽祖先+深后代单测，投影算法不改。第7轮裁决原文要求的是BRIEF原型，本轮采用Claude第二种建议明确设计原型与运行模板区别；纠正本报告前文“BRIEF第8段明确”措辞为“设计§9.4第8段原型明确”。当前brief.ts运行模板尚未显式渲染深度边界，未列深层匹配凭据不构成授权，现有清单外读取不能靠本次检测证明无泄漏。此运行模板披露留独立后续，不改变guard、扫描域、写标准或计数。

产品源码、配置判据及取证配方在code审批后未改；文档收敛涉及安装核心SKILL，安装输入和新bundle字节会变化，旧matrix-r12-pre-code仍只证明FBB采样。获批后重新串行两次check、14桩与正常四目标重装；后续post-code-fingerprint-r12-batch.json发布预计69、硬85、准入从478上限563。只有新全部指纹相匹配的版本与能力原件才填最新完整矩阵，旧失败、未测、原标准始终保留；不修改提示重试。目录事实按不变相关源码及原绑定核当前消费可单独复用，0新doctor；四个无机制Claude写及官方Claude0新启动。正式轮数已经8/8，没有第9次授权，CLI扩容不增加formal资格。当前goal未完成，M11第12步不可开始。

编排器自动生成的code/_meta/changes.diff含补丁原始上下文空格，git diff --check会把其字面上下文标为尾空白；该自动快照原样保留，不修审查工件。业务源码与文档的diff --check排除归档后通过，不据此宣称原始快照无空白。

## code裁决后最终检查、安装及七条整改核对

check1-r12-code-nits.json及check2-r12-code-nits.json为裁决落实后串行两遍完整检查，均3137通过、3跳过、0失败；共同安装输入SHA256为885a12a5d043d5e79c3d2736b25b7db8a64bb08d6a770ee7b779de46636602bc。随后final-build-r12-code-nits.json与selftest-r12-code-nits.json记录最终bundle SHA256 848445c9609aa6758b9580e95b6aa5d614090d18487ec534d6e57bb80520474e及桩14/14。install-code-nits-r12.json记录正常四目标安装成功，运行时、核心SKILL及28专用入口hash一致，安装期间四份全局文件hash前后相同；该陈述不抹去此前已记录的外部Codex配置hash变化。未再次移动共享入口，备份和恢复方案保留；实际客户端入口发现及其他仓库完整依赖面仍未测。

构建时git_head=39ed20530d64a72f81f183095c6d9516632d0228、dirty=true，不能表述为来自干净的新提交。后续提交不会自动改变这一历史构建标识；按现有build-stamp机制另核安装输入相等，不为更新时间戳重建并追认旧完整指纹。新真实准入以848445c9产物及本轮显式variant/hash取证，FBB原矩阵保留。

directory-fact-reuse-scope-code-nits.json逐文件核对六份生产目录相关源码与新doctor前后hash一致；生产consume同时核当前形态、TTL、实际项目globs稳定hash、路线/CLI及入口/native指纹，Read/Grep/Glob事实均实际消费。该采样完整枚举后的settings为26960字节、skipped=0，当前源码与安装输入相同。目录事实有限复用不代替新bundle的完整模型准入，未新增doctor启动。

| 上轮遗留编号 | 最终落点 | 验证结果及边界 |
| :--- | :--- | :--- |
| CLAUDE-01 | probes/claude.ts绑定真实项目globs；adapters/claude.ts消费；types.ts/doctor.ts存储及失效清理 | 排序去重稳定hash、配置变更/TTL/入口变化回退及跨进程接线通过；三路线新目录事实和当前生产消费有实际证据 |
| CLAUDE-02 | test/fixtures/claude-deny-paths-replay.json、claude-directory.test.ts | 来源请求/trace固定hash、3924原路径逐项覆盖、8根3908压缩、24投影坐标及邻接合法路径通过；原集合未改，2290仅历史采样 |
| CLAUDE-03 | adapters/claude.ts、probes/claude.ts、types.ts、report.ts | 生产接线与防御合取回归通过；只说明已验证工具不变式，分项守卫不是独立模型能力证明 |
| CLAUDE-04 | adapters/claude.ts声明守卫及调用内Map | 无有效事实二进制读取0次；同精确路径1次、异路径2次且下一调用重新读；无跨运行缓存，性能收益未测 |
| GLM-01 | probes/claude-directory.ts及unit独立变异 | is_error与permission_denials独立变异，缺权限、错目标/ID、重复调用/结果/权限及空目标均不得true；正向要求唯一成功配对 |
| GLM-02 | ascii-root1-5-depth0-2-v2投影/消费、七臂目录夹具及freeze父深度7边界 | 三真实路线Read/Grep/Glob均完成受测拓扑；中文、空格、逗号等目录前缀逐文件回退；宽祖先+深后代回退新增回归通过，特殊文件名不外推特殊目录 |
| GLM-03 | 目录工厂try内、已定义外部失败分类、caller主probe保护及doctor持久化 | 预期创建/追加/路线/budget失败、返回式未启动/超时/非零退出保留主probe、清空目录事实、脱敏与清理均覆盖；未定义内部错误继续抛 |

扫描深度整改是第7次有效计划明确批准的独立敏感项：父深度6→7，父深度8仍未覆盖，不随形态扩域；.git/node_modules排除与目录软链不跟随保持。运行BRIEF披露尚未加入的边界按第8次裁决如实保留，不能将目录事实或有限事后检测外推为全深度读取防护。

## 848445c9产物的最新完整矩阵与交付阻塞

本节对应matrix-r12-code-nits.json；canonical汇总脚本为summarize-r12-code-nits.mjs，显式selection-r12-post-code-all-current.json SHA256为311ea8e37119023616a9544ec39acdccb1392f9342a453c4a3763eb489e113ab，38臂均variant2。先完成13次版本/帮助启动，再完成38逻辑能力臂、56实际启动，共69新增；累计准入547/563、review103/108，预占和收尾均相等，没有未收尾启动，没有自动重试、换提示、增加doctor或新增formal。客户端版本本次实测Claude2.1.296、Codex0.162.1；入口、native、包装器、项目/全局配置、脚本及安装输入由各requested.json和fingerprints-after.json完整绑定，全部38臂指纹兼容。项目模型声明及sensitive_globs没有变更，effort来自各CLI回读，不增加默认值。

| 路线 | CLI实际模型 | CLI effort | 结构化实际读取 | 原生产写 | 精确禁读/事后检测 | 组合结论 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| claude/qwen | qwen3.8-flash | null | 通过 | 通过 | 通过 | 通过 |
| claude/qwen-pro | qwen3.8-max | null | 通过 | 未测 | 通过 | 未测 |
| claude/kimi | kimi-for-coding | null | 通过 | 未测 | 断言未通过 | 未测 |
| claude/kimi-pro | k3 | null | 通过 | 未测 | 通过 | 未测 |
| claude/deepseek | deepseek-flash | null | 通过 | 未测 | 通过 | 未测 |
| claude/deepseek-pro | deepseek-v4-pro | null | 通过 | 未测 | 通过 | 未测 |
| codex/native-sol | gpt-6.1-sol | high | 通过 | 通过 | 通过 | 通过 |
| codex/native-luna | gpt-6-luna | high | 通过 | 未测 | 通过 | 未测 |
| codex/native-astra | gpt-6-astra | high | 通过 | 通过 | 通过 | 通过 |
| codex/qwen | qwen3.8-flash | medium | 通过 | 通过 | 通过 | 通过 |
| codex/kimi | kimi-for-coding | max | 通过 | 通过 | 通过 | 通过 |
| codex/deepseek | deepseek-flash | high | 通过 | 通过 | 通过 | 通过 |

最新为6组合通过、6组合未测；未测组合里Kimi coding的Read完整覆盖断言false仍必须单列。实际Read/Grep对.env配对补齐的当前组合包括Qwen flash、Qwen max、Kimi k3、DeepSeek flash及DeepSeek pro；Kimi coding本次Grep六目标通过，Read另外五同行目标通过，但.env没有任何Read调用，完整Read断言未通过。Codex/Qwen与DeepSeek使用精确单一cat轨迹，读取和Schema均通过；新版Codex/Qwen写获得实际命令配对拒绝及前后状态。Claude/Qwen flash新版写仍有实际调用及配对拦截。

四个原无新机制Claude写不再启动，原标准列未测；DeepSeek pro此次写仅有Read及StructuredOutput，没有Write/Bash；官方Luna写没有command_execution，control.kind=indeterminate。后二者FBB采样写曾通过，旧原件和旧完整矩阵原样保留，不能将旧通过追认到848445c9列，也不能以本次未生成文件改判拦截成功。模型主动放弃调用与实际工具拦截是不同证据。本批所有服务端身份无独立证据仍null，请求、配置声明、CLI回读及provider来源在机读矩阵中分别保存；Claude provider/effort无回读仍null。Codex禁读列只证明实际命令被事后命中，不宣称CLI事前阻止读取。官方Sol/Astra只在当前受测配置通过，Luna现轮未测，官方Claude待订阅恢复。

当前必要后续见post-code-next-review-proposal.md：保持原写标准，先分析实际调用缺口的可行新机制；若需讨论受限工具面候选或旧证据有限复用，只能经新有效正式计划审查和Bob另行明确判据批准。旧write-criterion-alternative-not-adopted.md仍未采用，原四组合范围不静默扩大到新DeepSeek pro缺口，亦不能自动解决Kimi Read或Luna写缺口。已请求独立总10轮（9B/10C）授权，当前总8上限未改变；该请求不包括判据采用授权。七条可用路线、Qwen pro与新增官方边界尚未满足全部准入，goal保持未完成，M11第12步不可开始。提交推送只交付已获批整改和已完成证据，不构成前置任务完成。

提交前final-closeout-state-r12.json核对501个变更文件脱敏扫描零命中、历史旧证据hash零改变；旧审查中仅task正常追加及code/_meta/changes.diff正常最新指针变动，两个原failed状态不变。独立current-raw-evidence-cleanup-audit-r12核402个本批原件零命中、38夹具及隔离目录实际不存在，原cleanup和凭据清理原件保留；采样时刻不冒充历史清理操作时刻。其后只追加本段交付说明，不改变安装输入或新准入指纹。

完整暂存空白检查例外如实保留：原始changes*.diff有补丁上下文空白；已用于实际取证且hash被冻结的launch.mjs、launch-v2.mjs、launch-v2-plan-review-preserved.mjs、launch-v3.mjs、launch-v4.mjs有文件末尾空行。不为通过格式检查改写原件或放宽产品判据。业务src/scripts/test/skills及正式doc文档的暂存diff --check通过，不能将此表述成全部证据原件无空白。
