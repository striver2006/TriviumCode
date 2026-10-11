# 第16次正式B/plan：Codex/Qwen实际读取失败的取证补强

主题Agent双模式接入真实准入收口；Driver codex；审核者claude,gemini,glm。plan阶段已通过既有编排器认领；原稿由archive.ts唯一出口归档。代码完整重审基线保持39ed20530d64a72f81f183095c6d9516632d0228。

## 1. 当前状态与独立按需轮数委托

第15C run20261011T083951Z有效，三侧首尝试完成、subject及工作树无漂移、现行readonly/peer/forged均false，六条逐项裁决、gate0、按用户普通审批委托记录code approved。结构引用告警和Driver身份unknown保留，全部旧失败/拒绝原件不重写。七项历史整改及13B获批六项、14C范围内摘要脱敏与授权谱系测试保留；本轮不扩进15C暂缓的可选接口建议。

准入首批19能力臂/5版本逻辑调用实际43启动，5通过（Claude/Qwen flash、Codex Sol/Astra/Kimi coding/DeepSeek flash）、1未通过（Codex/Qwen flash）、6未测。当前bundle874e41604f533c16abd7ac4baca30ecb944492433260094f090d6747faee824b，inputs41128b5ee579a158f6a04e4f35d3d8ee0d13ac7f0ffcf32d2f0c708d905441a9，HEAD f63e339f938bd7bca1d5c22f19be101d626a7e66、dirty=true。CLI Claude2.1.296/Codex0.162.1，全局及模型/effort配置未变。r7矩阵、原件精确选择/hash、批后台账/清理审计是本轮来源，不把旧H或848结果用于当前列。

用户独立明确回复“授权轮次可以按需增加，不必询问授权”。保留旧v7权威及所有15记录，当前v8仅追加16B/17C有界批；launch-v12仅更换授权文件与说明，v2 guard/precheck语义不变。22项零CLI核验包含历史集合、谱系、16B/17C正例及18/错参数/缺权威/缺原件负例。以后确需新正式轮时可依这项独立委托追加有界权威，不能直接无限放行或清零。普通plan/code审批按已有委托逐轮决定；**准入判据变化仍必须另行明确批准**。

## 2. 本批真实失败的证据与范围

Codex/Qwen read-3实际执行ls/echo/cat复合命令，parsed_cmd=unknown；唯一session命令ID call_ad7c1cf03dec45c99feedc06与stdout item_1在实际fixture cwd配对，完整工具stdout包含README正文。现行单read节点精确断言false；最终findings三字符串造成finding_unaddressable，summary非首词。写与禁读事后检测等其余项通过，不能抵销这三项失败。原运行未采集README全文before/after hash；模型叙述README35字节与源码104字节不符，不作为文件事实。r7/codex-qwen-read3-diagnostic.json保存原件hash及仅诊断的正文对照。

本轮目标：使后续证据具有调用前后全文绑定，去除取证任务书中泄露实际首词和预设成功结论的干扰，为一次明确新机制的读取补测建立可复核条件。保持生产adapter、读取/写/禁读/MCP准入判据；不把unknown命令晋升read，不以完整正文代替单read，不补写旧采样，不对最终JSON做修复、归一或合成通过。

## 3. 拟实施落点和验证

### 3.1 调用前后的文件状态

`scripts/agent-access-evidence.mjs`新增局部纯辅助：以实际绝对fixtureRoot内README精确路径采集存在、类型/软链、bytes与sha256；缺文件显式null字段，读取/权限/未定义内部错误不能伪装不存在或被吞。合法常规文件只读采样；不跟随未知软链消费为可信正文。不存在、非文件、软链或不可信绝对坐标均不能用于诊断true。

`scripts/agent-access-closeout.mjs`在夹具填充完成、调用前记录README状态（fixture-before新字段），调用后再采集（fixture-after新字段），与实际fixtureRoot、原request及原命令证据绑定。确保finally既有凭据清理、夹具清理、scratch清理和脱敏证据落盘依序完成；已定义外部失败记录脱敏，不新增吞未定义错误。只扩新运行文件字段，历史JSON/schema及既有路径不改。前后bytes/hash不一致、缺失或无可信状态时诊断false/unknown。

### 3.2 仅诊断的完整内容核对

同脚本增加单cat完整输出诊断：消费生产`codexCommandEvidence`已建立的唯一session/stdout配对和实际cwd，核真实原CommandExecution的status/exit及全量stdout，核同调用前后README bytes/hash，输出`read_content_diagnostic`及失败理由。不得仅查首词子串。正例为唯一合法单cat和完整正文一致；复合命令、parsed_cmd unknown、管道/重定向/替换/回退均不当成准入正例，原current actual_read判据函数逐字保留。复合命令可以保存诊断元数据说明输出含正文，但独立标注不满足单read，不增加candidate通过列。

验证至少覆盖：完整单cat/准确cwd/唯一ID/完整输出/前后状态正例；缺全文、只有首词、截断、额外前缀、前后变化、缺before或after、重复session或stdout ID、错cwd/目标、非零退出、超时、turn未完成、unknown复合、软链、不可信路径负例。跨session/stdout身份不混同，必须对全量输出/exit/status配对。测试消费生产导出函数，不复制实现来测试；局部采样用独立临时文件，结束清理，0厂商CLI。

### 3.3 明确取证任务书，保留单cat要求

`scripts/agent-access-recipes.mjs`及closeout的read臂任务书：实际单一cat README.md不变；summary须从实际输出取首词。移除把真实SENTINEL首词嵌入输出示例的行为，改为只说明字段结构/类型及无意见findings为空数组，不预设approve结论。例子中不填实际首词、不要求机械照抄占位summary；读取失败需诚实完整JSON及可寻址对象findings，不能生成字符串数组。不得要求将失败改approve、屏蔽实际block、删意见或生成伪读轨迹。

Claude既有已测任务书不改；write和deny臂既有任务书不改；只对Codex真实读取臂引入这套任务级修订。四组合Codex同臂使用同一个新机制，不给Qwen加厂商特例。现model/provider/effort及CLI版本保持。真实补测最多一次首尝试；失败保留原件，不在同批换提示/自动重试。若原标准仍不能满足，形成下一具体机制或独立判据提案，不由Driver升级通过。

不加入output-schema旗标。codex.ts EV-124旧实测已表明Qwen兼容端点两次忽略schema；本轮不将help/退出0当遵守证明。正式adapter/probe接线、其它provider能力或新旗标若确需做，须另列正式计划和实际能力取证，不在本范围顺手加入。

定向回归断言生产read任务书无实际首词、无预设approve、有完整对象Schema指引与单cat要求；write/deny/Claude字节行为保持。实测交付仍由现parseReview和strict_first_word判定，不手工修改其输出。

### 3.4 授权数据升级的测试谱系

`test/unit/agent-access-recovery.test.ts`把当前v7测试转为具名固定历史v7夹具、纯Core核验原15C/16拒绝与实际v6原件hash；保留原v6/v5/v4全部历史测试。新增当前v8读取壳+生产guard直测16B/17C、18拒绝、指针完整hash/topic/文件名、supersedes实际v7字节hash、错参数/集合/重复/缺历史/权威负例。授权文件升级是用户明确独立委托的审计输入变化，不更改round-guard-v2或precheck-v2函数。此刻未更新业务测试，旧双遍3153/3/0不冒充覆盖v8新数据；零CLI22项已单独落盘。

## 4. 历史整改、安装与未测边界

保留七项落点及验证（报告现有逐项表）：实际项目globs hash绑定与逐文件回退、真实3924路径不可变来源回放、peer_deny分项不变式、调用内精确路径hash复用、拒绝字段独立变异与唯一配对、实测ASCII五段拓扑/父目录7深度边界、预期失败保主probe清空目录事实及未知错误继续抛。特殊目录未测回退、不宣称性能实测收益、不把分项守卫当独立模型能力。

五Claude非flash生产写、Kimi coding.env实际Read及Luna实际写缺口无新机制不启动；原未测仍在。Kimi k3.env既有历史Read/Grep实际配对不能直接补当前完整指纹。官方Claude订阅未恢复，实际客户端技能名解析未测，服务端身份null。现正常四目标安装28独立入口及七备份核对通过，共享入口不存在；不增加迁移/删除、不改用户全局配置，共享冲突重现就停，不绕安装器。

两项第9B已审的component/restricted仅判据候选，未独立批准、未采用。原生产写必须实际模型调用、精确目标/唯一ID配对拒绝和前后状态；控制样本/注册诊断/未生成文件都不能替代。本计划和普通批准不改变上述标准，不能解除其余未测。

## 5. 审查、执行与最小真实预算

16B前完成静态审核与配置/脚本/安装/旧台账hash核验，完整报告和证据落盘；review及审批停点冻结，编排器只产生既有元数据。三原件全文读取、逐项裁决，接受合入完整r20；gate核验后依明确委托记录普通plan结果，才实施。本16B review事前193/213，预计10、硬20/池止213；admission590/602本批0。所有版本/帮助/超时/失败/包装器/native/重试计启动；扩容先发布再启动。

实施后同步设计补丁、ADR003、协议、手册/坑指南、验收剧本/运行手册、测试报告和索引；入口措辞若改变只改skills-src并render，本轮预计不需改入口。先定向验证，再串行两遍npm run check、桩14/14、最终重建正常四目标重装，安装输入/完整指纹核验。新包不追认874旧完整准入。

17C相对39ed全量三审，不只看任务小补丁，计划完成及静态结果先冻结；逐项裁决/gate及本轮普通code批准后才真实补测。17C和准入的具体预算在各自启动前另发布，CLI额度按既有委托自动扩容，正式轮数按新独立委托有界增量。

条件最小下一准入：Codex/Qwen读取新机制首臂预计包装器/native2启动，先取得完整Schema/单read/全文状态及身份；若通过再按完整指纹影响评估成熟5组合必要刷新，不能拿新首臂直接宣布全部路线通过。当前同指纹版本证据有全局/入口/脚本/模块hash差异时需新版本调用，列入批数；预计首臂加专属版本最多4启动，不含必要doctor（如版本/入口事实过期，先明确它的用途及启动数）。任何新包刷新范围按消费inventory具体判断，不盲目全量；无可消费component授权则完整矩阵新包列保持未测。

最终仍须七路线、Qwen pro、共享三审、官方档位边界与所有必要检查满足才能进入M11第12步。本轮最多关闭Codex读取机制问题，不能因code审查/安装/测试通过、额度耗尽或提交推送报告目标完成。
