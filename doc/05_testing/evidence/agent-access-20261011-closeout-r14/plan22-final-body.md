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
