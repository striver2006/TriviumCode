# 第12次代码三审后六项整改提案（未审、未批准、未实施）

截至2026-10-11 04:09 UTC：同主题正式审查12/12已用满。第12次C/code `20261011T035044Z` 三侧首尝试有效，源码树前后hash一致，`readonly_breach=false`、`peer_artifact_read=false`、`forged_role_file=false`；Gemini、GLM的consulted无法逐项与轨迹交叉核对。Claude四项、GLM两项意见均已在`r5-response-codex.md`逐条接受，`gate --check`退出0；依Bob的普通自动审批委托，本轮code正式记录**rejected**。这一结果保留全部已获批整改及历史失败/审批，不将“审查有效”冒充“代码获批”或真实准入通过。

本件是可审查的下一步方案，**不是**第13次B/plan原稿、轮数授权、业务实施或准入判据变更。原生编排器仍无专用轮数例外接口；当前v5权威总上限12，不改计数、不另起主题。若Bob独立授权总上限14，拟以同主题第13次B/plan审六项与证据边界，第14次C/code完整重审；使用新v6授权和新版任务级launcher，旧v5指针先逐字节备份，旧授权、v8/quiet-v6、12个历史run（含失败与12C拒绝）及审批记录不改。正式仍由`--driver codex`和Claude、Gemini、GLM三侧执行，代码审查显式基线`39ed20530d64a72f81f183095c6d9516632d0228`。13B有效、逐条裁决并依本轮委托批准后才实施；14C有效、逐条裁决并依本轮委托决定code审批。不得用CLI扩容代替轮数授权。

## 六项意见的实施边界

1. **CLAUDE-01，生产v2守卫直测不足。** `round-guard-v2.mjs`原件已有生产调用，优先补`test/unit/agent-access-recovery.test.ts`的实时v5/v2纯核验负例：错topic/driver/critics/entry/stage、重复必需旗标，归档与task运行集不等、重复、孤儿、unreadable、历史ID孤儿，11后只允12C与13拒绝；读壳测试保留pointer名/hash/主题漂移。固定v3/v4历史测试继续核旧边界，不用动态当前权威替代历史fixture。此项不调整现行守卫规则。
2. **CLAUDE-03，摘要入口按历史label选证据。** 新建`launch-v9.mjs`及`quiet-launch-v7.mjs`，保留v8/v6字节。摘要入口在spawn前生成符合UUID格式的本次load_id，经专用环境字段交给新launcher；launcher核格式并用`wx`落本次requested/completed，拒绝复用已有token。摘要入口只选择含该token的两件原件，核label、load_id、requested_at不早于本次spawn、配对字段和唯一性；缺本次completed即报失败，不能取旧成功。相同label连续两次成功各得自己的证据，旧completed存在但本次没有时拒绝。正式review仍直接走新launcher并显示完整原始输出。方案不得把独立本地文件未生成当作模型实际写尝试。
3. **CLAUDE-02，设计采样数字误读。** 主设计v1.3.149句标明4290是第10次C/code采样，第12次启动前测量4298，或去掉裸数字并链接具时刻恢复报告；旧采样和原件保持。文档索引随新增测试报告同步。
4. **CLAUDE-04，plan/code启动前测量范围。** 建议新版launcher仅在`--stage code`执行`formal-start-precheck-v2`的安装/目录事实/settings测量。正式plan继续核当前轮数/阶段/三审/审批链、preflight，不以尚未完成代码安装结果阻断计划审查；实现与主设计/协议/计划同句。旧v8真实12C仍按其原值保留。若13B审查主张plan也须测量，先在裁决与修订计划写明依据和测试，再实施，不用本提案预认。
5. **GLM-01，生产precheck-v2增量未测。** 定向测试直接导入v2测量入口，覆盖缺失/未知stage拒绝、正确code stage回读与结果字段，保留原软线、安装/输入/目录事实/skipped各负例；v1历史用例不删。与第1项同批零CLI回归。
6. **GLM-02，旗标样式必需值。** 新版quiet入口在spawn前拒绝其白名单必需旗标后的空值或以`--`开头的值，尤其`--topic --driver`及`--stage --`。零CLI静态复核见`post-round12-quiet-static-audit.md`：现行产品`parseArgs`+`flagString`会在状态写入前拒绝上述形态，原意见中“可能以--driver作主题成功认领”不符合当前源码；本整改要消除的是quiet层无谓spawn与预算消耗，产品CLI继续作为第二道校验。真实子进程负例核0 child spawn/0预算/0任务状态变动；正常claim/resolve/preflight正例继续。此项及第2/4项涉及任务级守卫语义，须第13次正式计划审查与普通计划审批后方可实施。

## 静态核验、安装和准入停点

计划审查前先核12条task/archive ID、v5当前指针与hash、旧v4/v3冻结件、最新CLI和安装/config/script/input指纹、共享七目录/备份，落独立r6证据目录、脱敏扫描与事前预算批次。13B/14C每批单列预计启动、硬上限、累计池上限；目前实盘准入547/563、正式审查CLI池153/168、正式轮数12/12。扩容仅按Bob已授权的CLI机制在批次记录后执行。审查中仅编排器元数据变动，审批停点不改业务文件；新`archive.ts`原稿/裁决不能手写到`.reviews`。

计划批准后先同步主设计、ADR003、PROTOCOL、QUICKSTART、RUNBOOK、GUIDE、CASE、恢复报告、测试报告与索引，必要时修改`skills-src`并render；本方案目前不改命令入口措辞、产品guard/schema/适配器或用户全局配置。定向零CLI测试、串行两次`npm run check`、源与安装桩14/14、最终build与正常四目标安装、28入口/七共享目录/备份/配置/完整指纹核对完成后才启14C。新增bundle或输入SHA须按逐臂适用性判断，旧848/cb6与当前c981指纹能力不自动追认。

原生产写准入必须有真实模型尝试、精确目标与唯一调用ID、配对拦截及文件前后状态；两项替代判据仍未采用。官方Claude订阅未恢复、服务端身份缺证、客户端重名解析未测以及当前逐模型真实准入未完成，均保留未测或null。本轮数提案**不**申请判据变更批准。若不授权新增正式轮数，保持12C拒绝、代码未交付、目标active，不自启13B，也不把已过检查/四目标安装当M11第12步前置完成。
