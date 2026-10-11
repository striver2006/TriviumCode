# 第10次三审后独立守卫整改提案（未审、未批准、未实施）

截至2026-10-11 03:02 UTC：正式10/10已用满。run20261011T024158Z三家结构化结论有效且无漂移，Claude提出major1/minor2；三条接受，gate0证明裁决齐备。依据本轮委托建议记录code rejected，未借一般审批扩r14第3节普通整改范围。这里是具体可审查方案，不是正式B原稿或轮数授权；正式认领和archive落稿只能在另行轮数授权后执行。七条历史整改及第9次计划审批保留。

建议独立授权总上限12：第11次B/plan审下面三个新增守卫事项和证据边界，第12次C/code相对39ed20530d64a72f81f183095c6d9516632d0228完整重审。沿现行current-authority壳新增授权v5和新launcher，逐字保存v4指针、全10个历史run（含失败、此次code拒绝）及审批；禁止重置计数、改失败状态、另起主题或自动第13次。正式三侧Claude/Gemini/GLM，Driver codex；有效11B、逐条裁决、本轮委托plan批准后才实施，之后完整12C与本轮委托code审批。

## CLAUDE-01：新DeepSeek pro写臂误调防线

拟改scripts/agent-access-recipes.mjs的assertProductionArm：仅在现有Claude/write拒绝集合追加deepseek-pro，保留原qwen-pro/kimi/kimi-pro/deepseek、Qwen flash合法写及各读取臂原行为。具体变化为集合从四项变五项。test/unit/agent-access-recovery.test.ts钉五个组合在进入CLI spawn/预算预占之前拒绝，正向核Qwen flash写及五个读取臂不被误拦；读配方仍单一cat，不改提示碰运气。

这是更保守的任务取证启动守卫，不改变真实写通过标准、生产工具注册、只读权限、目录facts、扫描深度、模型/effort或外部版本；仍按用户要求单列guard语义计划审查。没有新机制时五个写臂0启动，DeepSeek pro原有FBB实际写证据按历史保留，不恢复当前通过。未来有经验证的新机制须独立重新确定受影响启动范围，不能静默移除拒绝。

该scripts文件属于INSTALL_INPUT_PATHS，获批实施必改变安装输入和bundle；两次串行check、14桩、正常四目标重装及新完整指纹逐臂审计为必需，不承诺沿用cb6全量准入。

## CLAUDE-02：纯核验API不再隐式自认权威

旧round-guard.mjs及各历史launcher/prepare原件hash保持。新增任务级round-guard-v2.mjs：assertFormalRoundCore第5参必须显式且完整，undefined/null或不满足授权形状先拒绝，禁止current=authorization默认；真实assertFormalRound壳仍从当前唯一pointer+完整hash读权威，再显式传第5参。历史/合成断言显式传固定历史authority，只证明纯计算，不取得生产启动权限；新wrapper与未来正式launcher仅用新壳。

定向负例覆盖遗漏权威、旧被替代v4、pointer/hash漂移、当前10记录只允11B、批准后11记录只允12C、超12拒绝、重复/孤儿/不可读原件、错主题/Driver/审核者/入口/阶段及重复旗标。实时读取测试切新v5，同时把总10边界另固定为不可变v4历史fixture，原总6/7/8用例与原guard hash照常保留，不拿新轮数篡改旧正反结果。真实启动另核有效11B及当轮审批，不将纯core或计数当作审批链证明。

## CLAUDE-03：新摘要包装器限制使用范围

quiet-launch-v5、launch-v5/v6原件不改，明确它们分别委托哪个版本、历史用法及缺机械命令过滤的事实。新增quiet-launch-v6或具名新版本，首行写真实新launcher路径和沿革；只允许tv stage claim、topic resolve、preflight的精确子命令形态。review start/wait/status/cancel等及probe/未知命令全部在spawn与预算前拒绝，不能依赖隐藏大输出或旧版本任务资格。正式review直接新launcher，完整警告/进度仍须读原件原样播报。

正例核三种摘要操作，负例核review各操作/误传模式/未知版本及命令，断言拒绝时子进程和预算增量均0。摘要包装器不是审批或判据采用入口，不修改产品Bash启发式判据或加豁免。

## Grep持久结果与同行BRIEF边界：先诊断，不追认

10C Claude一次根目录Grep返回persisted-output，随后Read CLI工具结果文件；完整结果含外侧历史BRIEF的同一补丁片段、己方旧意见及Driver稿，本轮生产enumerateDenyPaths无命中。现行枚举禁他侧review意见原文，不禁brief；trace.grep.hits只由预览文本解析，未代表40.9KB持久结果全文。既有guard false不能外推为所有_meta工件隔离。

其后零CLI复核已落round10-grep-persisted-audit.json初版及-v2.json校正件、round10-grep-read-exact-verify.json：初版未剥Read每行编号与制表符，把路径误归普通，原件保留；v2核252行全部带编号，剥后47345字节与持久文件严格相等。实际模型收到九条文件路径（非九次工具调用），其中两条为他侧历史BRIEF，另含己方历史意见、Driver计划和diff；与本轮生产deny集合4290项交集为零。读取结果本身进入模型，不再只是“可能看到”。这两份BRIEF不是他侧审查意见原文，现行枚举也不禁brief，故现有run的guard=false与解析结果相容；但“同行工件完整覆盖”能否排除他侧BRIEF须在正式计划中明确边界，不能因本轮success就宣称全部_meta隔离。

第11次计划审查应同时审这一具名风险及三项守卫问题；原stderr/stdout/trace/review/run/guard不修改。如果未来需扩BRIEF禁读范围、核验持久结果全文或预置尚未生成工件，必须另列受影响生产guard语义、合法diff/己方/Driver输入边界与负例并获明确计划审批。本提案现阶段仅批准前的诊断，不预先实施该语义变化，不把历史运行改成失败或重获资格。

## 判据与取证保持原标准

component-scoped-evidence-v1与restricted-tool-surface-v1均未采用。本轮数提案不请求准入判据批准，自动普通plan/code审批不包含判据采用。当前候选仍缺模型上下文/配置消费和生产全路线受控桥接证据，建议不据此补当前通过列。原生产写继续要求真实模型实际尝试、唯一ID/精确cwd目标、配对拒绝、前后状态；受控响应/权限诊断/无文件不能替代。

零CLI完整矩阵诊断仍38臂旧hash绑定；旧848 6通过/6未测仅历史，cb6全量模型准入未测。旧配置语义差异无完整原件，为null；不主动调整用户配置。必要新启动见round10-scope-and-minimum-admission.md，各无新写机制臂0、官方Claude待订阅0。第11/12正式审查期间新准入0；CLIreview批次先按实际盘账发布预计15/硬20及扩容，当前review128/138、admission547/563，额度授权不代正式资格。

最终检查通过和代码审查有效/批准也不能单独证明M11前置完成。所有原未测、读取断言未通过、服务端null、外部入口复现来源unknown及客户端发现/其他仓库依赖未测均保留。获准后提交推送仅交付所批准变更，不宣称全量准入。
