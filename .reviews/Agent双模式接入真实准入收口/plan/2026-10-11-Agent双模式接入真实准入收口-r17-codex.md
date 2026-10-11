# 第13次正式B/plan：第12次代码三审六项整改与证据边界

主题：Agent双模式接入真实准入收口；Driver：codex；审核者：claude,gemini,glm。本原稿在plan阶段认领后由archive.ts归档。完整代码重审基线仍为39ed20530d64a72f81f183095c6d9516632d0228，包含累计全部源码、文档、脚本和证据变化。

## 1. 当前事实与授权

第12次C/code run=20261011T035044Z三侧有效、树hash一致，无subject_drift、readonly_breach、peer_artifact_read或forged_role_file；六项意见全部接受，gate检查0，但依Bob普通自动审批委托正式code记录rejected。有效审查、通过检查与代码获批分列，旧失败和各侧盲区不追认。现有r16获批计划已实施的七条历史整改及三项前轮守卫保留，本轮不回滚。

Bob现已独立明确授权“授权总14轮，先计划审查再代码重审（建议）”：同主题总14，仅第13次B/plan与第14次C/code。当前v6权威及hash指针、旧v5逐字节备份、12条task/archive一致性和17项零CLI正反核验已经落盘r6/formal-round13-authorization-verification.json。编排器无原生轮数例外接口，因此沿用经前轮审查的任务级追加约束，不改产品计数、不换主题、不删除失败。launch-v9仅从v8更新当前v6授权；六项整改尚未实施。此前提案将未来修复称v9，此处明确修订名称为launch-v10及quiet-launch-v7，v9用于本次13B，旧v8/v9/quiet-v6原件不可改写。

普通plan/code审批依Bob本轮委托由Driver按审查结果记录；该委托及本次轮数授权均不批准准入判据变化、不允许超过14轮。13B有效、逐条裁决、完整修订计划和gate检查后才批准实施；14C同样逐条裁决并决定code审批。review及审批停点冻结业务与被审静态证据，只允许既有编排器运行元数据。

## 2. 七条历史整改的保留要求

1. CLAUDE-01：实际项目sensitive_globs稳定hash绑定目录事实及消费；夹具替换配置不作项目证明，变更使旧事实失效，逐文件回退仍在。
2. CLAUDE-02：真实保存的非敏感禁读集合回放，核来源hash、逐项覆盖、邻接合法路径和原集合不变；2290只属历史采样，不伪造新数量。
3. CLAUDE-03：peer_deny_applied是分项防御不变式与生产接线结果，不能作独立模型能力证据。
4. CLAUDE-04：无可消费事实避免无用二进制hash，精确路径仅调用内复用，无跨运行缓存或未实测性能收益声明。
5. GLM-01：is_error与permission_denials独立变异，缺记录、错目标、重复均不能true。
6. GLM-02：压缩只消费实测保守ASCII五段目录拓扑事实，中文/空格/逗号未测目录前缀逐文件；特殊文件名不外推目录。
7. GLM-03：预期夹具/追加目录probe失败保存主probe、清空目录事实、脱敏失败与清理，未定义内部错不吞。敏感枚举父目录上限7及边界回归维持前轮批准范围。

这些要求以代码、原测试和旧证据为基线，旧848/cb6能力不自动追认当前c981。新增任务脚本输入指纹变化也需逐臂判断。

## 3. 本轮六项实施与直接验证

### 3.1 CLAUDE-01：v2生产轮数守卫直接回归

只补test/unit/agent-access-recovery.test.ts，不改round-guard-v2判据。当前v6正例13B、在完整13条一致集合上14C，15拒绝。直接调用assertFormalRoundCore覆盖错topic/driver/critics/entry/stage、重复各必需旗标、allow-single、缺失/null当前权威、task与archive集合不等、重复、孤儿、unreadable、缺历史ID；读取壳覆盖指针名/hash/topic漂移。旧v5固定fixture核11B/12C合法、13拒绝，旧v4/v3/v2等历史测试不以动态当前权威替换。两进程边界沿既有真实子进程规则，纯函数分支使用明确内存fixture即可，不烧CLI额度。

### 3.2 CLAUDE-03：本次token精确配对

新quiet-v7在spawn前用crypto.randomUUID生成本次token，将TRIVIUM_ACCESS_REQUEST_TOKEN显式交给新launch-v10；v10核UUID格式，直接启动时自行生成token，既有requested/completed同token以wx失败，不复用任何旧收据。先核token与已有路径，再执行会计/子进程；不得为重用token触发reserve或真实CLI。旧launcher不改。

摘要仅按本次label+token精确路径读取requested和completed，并核两件load_id、label、pool、mode、脚本与执行hash、requested_at和退出码/signal一致；requested_at不得早于摘要spawn时刻，primary_loaded必须true，记录缺失/不可读/错配即失败。摘要的子进程code仍为本次code；不得由JSON ok或历史成功替换。校验函数置于新quiet文件导出，真实main调用同函数。相同label两次启动各用自己的token，旧completed存在而本次没有时拒绝。

真实子进程验证使用独立scratchDir/HOME中的复制入口与假的Node产品边界，不调用厂商CLI、不改用户配置：相同label两次得到不同token/current evidence；旧成功+本次无completed、缺requested、字段错配、primary_loaded=false、code/signal错配、token重复均失败。必要依赖在临时副本中固定，生产默认路径/参数不为测试增加豁免；测试必须走main与生产导出校验，而非仅复制实现。预算文件和task前后hash/子进程标记证明无厂商启动。历史246条label唯一只说明旧采样未重现，不证明旧选择器可靠。

### 3.3 CLAUDE-02：采样数字

主设计v1.3.149明确4290为第10次C/code启动前采样，4298为第12次C/code启动前采样，引用各自恢复证据及时刻。不修改旧收据，不把数字当当前总数。

### 3.4 CLAUDE-04：正式code专属启动测量

新v10只有正式review --start --stage code调用formal-start-precheck-v2；plan仍执行当前权威、集合、阶段、审批链及编排器preflight，不以尚未实施计划的安装/目录settings测量阻断计划审查。旧v8/v9的plan/code测量保持历史行为。本次13B仍按v9作零CLI测量并落盘，范围变化只在本计划批准后实施。生产软线131072、只读判据、产品guard/gate/schema/适配器不变。

直接验证新生产stage分支：隔离子进程plan可到达假产品边界而无measurement，code必须调用测量，测量失败时0 product spawn/0 reserve/0正式run。通过code保存带时刻及完整指纹的测量后才启动，不以本地模拟当作模型能力。

### 3.5 GLM-01：precheck-v2测量入口

测试直接导入v2的measureCodeStart，保留v1历史测试。缺/未知stage在独立有效配置夹具拒绝；正确code和plan使用不同明确route覆盖真实resolveTier→probe→目录消费→enumerateDenyPaths→projection→结果字段链。夹具源和安装bundle、build inputs及探针目录事实按既有test/helpers方式构造，并隔离HOME；若需要稳定构造困难，拆出最小依赖注入的非生产默认工厂于新版本precheck-v3，v2原件不可改写，生产仍用真实依赖，直接测试生产工厂默认链至少一次。不得把新判据塞入测试辅助。校验安装/inputs/软线/skipped/目录事实/shape/deny负例保持；新增stage断言验证实际回读，不只测字符串壳。

### 3.6 GLM-02：quiet必需值拒绝

新quiet-v7白名单必需旗标值必须非空且不以--开头；topic claim的topic/stage/driver，resolve的stage（--后用户原文不解析），preflight的stage/driver/critics等沿原入口范围。重复必需旗标继续拒绝。产品parseArgs+flagString仍负责完整值语义。静态审计已证产品先拒绝再写state，原意见中错误认领推测不追认为实测；此项防止quiet无谓spawn/预算损耗。

缺值/--topic --driver/--stage --/重复值真实子进程负例断言0 child spawn、0预算变化、0任务变化。合法claim/resolve/preflight到达隔离假产品边界，正式review不能经quiet。不新增Bash豁免或任何厂商permission豁免。

## 4. 准入、预算与安装边界

路线×实际模型×缺口×复用×必要启动的最小清单见r5/post-round12-admission-matrix.md：当前c981十二组合完整准入均未测；旧848六通过六未测保留，旧H批五通过五未测二断言失败保留。Claude/Qwen flash完整Read/Grep结构化交付、Kimi k3对.env实际Read/Grep及配对拒绝、五个Claude非flash生产写臂、Codex Qwen/DeepSeek精确读取与Luna写均不能以正确回答、受控响应或工具权限诊断替代实际尝试。官方Sol/Astra等按完整指纹和影响逐臂判断，不盲目重跑。服务端身份缺证null，官方Claude订阅仍未恢复，Qwen pro和共享三审仍保留独立前置要求。

本13B批预计15审查CLI启动、硬上限20、批次到173即停，累计池由168扩至183已记录；当前153/183。准入547/563，本计划审查新增准入0。版本/帮助/失败/超时/包装器/native/重试照现规则计启动，达到上限先记录扩容再继续；自动CLI扩容不扩大14正式轮数。

禁读用生产enumerateDenyPaths覆盖同行工件和敏感夹具，事后检测保留。负对照只用独立临时夹具，写按实际cwd、精确目标、唯一调用ID、配对结果、前后文件状态。两项候选替代准入标准仍未批准，本次不采用；若未注册工具面持续无实际尝试，形成单独正式审查后的判据提案交Bob明确决定，一般plan/code审批不包含该决定。

四目标安装此前正常通过28独立入口；七共享入口已按既有批准迁移并有copied/moved各七份备份，当前不存在。r5只读其他仓依赖盘点为5仓共享runtime wrapper，客户端名称解析未测，共享入口再出现来源未知。本轮不新增迁移/删除，不修改全局配置、不绕安装冲突检查；若再出现则保留冲突并另报影响/恢复方案。

## 5. 执行、同步与完成条件

13B前静态核查源码/安装/CLI声明与回读/配置/脚本hash、轮数与预算、目录事实/settings、入口和备份，落r6并脱敏扫描；之后冻结至审查和审批结束。所有原件保留，archive.ts唯一归档。三侧原件全文读取，逐项接受/驳回/暂缓有理由及落点，接受合入完整r18；不把原稿直接当修订计划。

批准后实施新v10/quiet-v7及直接回归，必要时新precheck-v3，旧脚本不改。同步主设计、ADR003、PROTOCOL、GUIDE_local_pitfalls、CASE、RUNBOOK、QUICKSTART、恢复报告与r6索引；入口措辞若需改必须skills-src再render，目前无此需要。设计补丁按既有规范，package版本、模型配置、effort默认值和CLI版本均不自动变。

定向回归后串行两次npm run check、源及安装桩14/14、最终build/正常四目标install、28入口与七共享/备份/配置/完整指纹核验。14C前全部静态报告和证据落盘，显式base39ed全量重审，冻结业务/证据，不因预算自动跳过。审查与code审批有效后可按Bob授权提交推送当前main，按名暂存并核远端。

最终逐路线逐实际模型矩阵、七条整改落点/验证、有效审查/裁决/审批、台账/配置/安装/阻塞均交付；七可用路线、Qwen pro、共享三审及必要检查未全部真实准入前，目标不完成、不报告可进入M11第12步。超过14、新guard问题或准入判据改变必须保留停点，不能以自动普通审批覆盖。
