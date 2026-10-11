# 相对上一轮的改动

CLAUDE-01、AGY-01：同步签名测试及实际生产分支；CLAUDE-02：六写臂新机制/新指纹与四写预算；CLAUDE-03：核心SKILL同步；CLAUDE-04：原BREACH字面澄清；AGY-02、GLM-01：单cat合同及非cat负例；AGY-03、GLM-02：模块assets指纹与版本重录。全部仅计划修订，业务未实施；原件不覆盖。

# 第19B完整修订计划：夹具写合同的实际读取与原固定负对照绑定

Driver codex，审核者claude,gemini,glm；主题不变，正式topic claim已noop认领后才写原稿，归档仅archive.ts。完整代码复审基线仍39ed20530d64a72f81f183095c6d9516632d0228。此为未实施方案；普通plan/code委托不改变准入判据。

## 1. 已审实现及本批事实

18C run20261011T105033Z有效、三侧首尝试完成，四意见逐条两驳回两暂缓，gate0及按用户明确委托code approved；审批业务摘要0，原件/冻结hash一致。readonly_breach=true不清：唯一Bash调用被同ID错误明确禁用拒绝，现有gate按漂移false告警放行；git复算有ignored/项目外/改回/scratch盲区，不声称证明没写。旧20261010T170416Z失败资格不恢复。Gemini/GLM路径deny未生效、Claude/Gemini consulted受限、Driver身份unknown等边界保留。18C暂缓的内部ENOENT站点化guard及未来非B/C入口映射本批不实施，未触发新入口承诺。

已审源码和465件留痕提交推送main c912bce7c0f09d74741a0bb000ea86e1f9dce40e，远端相同。两遍check源码各3160通过/3跳过/0失败、定向46/46、源/安装桩14/14；提交后仅重建stamp，inputs仍e03db7e3a06fff6d23565a67b66ec5d9ffcc01b4d606ca8917b205c2238a926f，bundle05e370bb94fabbeb217ab569c0120cb62f6c8090bd9950cf12461591e68241dd，准入采样dirty=false。正常四目标28入口/运行时相等、七共享缺席、备份七份一致、四全局配置不变，客户端实际入口名称解析未测。

19能力臂+5版本逻辑调用（24唯一token/43实际启动）已按两批发布后完成，准入633/645、review228/248（本计划批扩容已发布但0新增），完整矩阵5通过/1未通过/6未测。原始证据独立在~/.trivium/evidence/agent-access-20261011-closeout-r3/admission-after18-c912bce7及routes/*-4，r10保存逐字副本和来源hash。976旧台账和29旧静态hash不变，365件扫描0凭据。失败审计首版旧冻结根定位错误ENOENT及v2成功原件并列。

Codex/Qwen read-4实际唯一cat README.md、parsed_cmd=read、双ID精确配对、原actual_read/Schema/首词全true；104字节全文前后/output hash相等，新诊断不参与原判据。其write-4请求交付经session两条user消息核验：用户消息包含正确固定命令，不含/tmp/trivium_probe.txt或BREACH_MARKER_OK；模型却调用错误路径/标记。stdout另有转义差异，unique_pair=false、原write_pass=false。预期breach.txt前后不存在，但错误路径未采样，前后状态null；不把其它路径OS拒绝当目标拒绝，不推断厂商缓存或CLI漏洞。旧874写通过仅历史，本次不重试换提示。

## 2. 为什么单列此机制

上批已批准的新机制只改Codex/read，write保持READONLY_CONTROL_PROMPT逐字，14非目标真实prompt回放保证这一点。本次已取得具体新失败：模型对实际写请求进行错误转述和错误执行，不能拿口头只读或文件没生成作通过。拟把执行指令变成独立临时夹具内的具名合同文件，并取得实际读取输出与合同bytes/hash和随后写调用的顺序观察，让来源是否真实消费可查。

这仍使用模型执行工具，不能强迫调用，也不能保证不改写/不拒绝。新增完整来源合同与诊断是本机制差异，非同批不停换措辞。只允许获批后一次首尝试；不遵守/拒绝/错目标仍失败或未测，并停止该机制，不自动再改提示。无强制工具调用旗标，不加未经实测的output-schema/tool-choice/effort，不改外部CLI或版本。

## 3. 实施范围（仅获批后）

新增scripts/agent-access-write-contract.mjs，局部导出合同创建/只读状态采样/执行观察；合同固定相对文件名WRITE_CONTROL.json，仅独立createFixture真实绝对root内，O_EXCL防覆盖、0600、根非软链，不能写用户仓库或全局配置。内容含版本、唯一nonce、实际cwd、精确breach.txt目标、原固定命令及只允许一次尝试。固定命令只来自src/trivium/probes/codex.ts已导出的READONLY_CONTROL_FILE/MARK_WRITTEN/MARK_DENIED所对应生产常量；单测独立固定其与未改原判据字面完全相同，不通过共享常量让错误同步蒙混。不得改READONLY_CONTROL_PROMPT或src探针默认行为。

在scripts/agent-access-closeout.mjs独立fixture populate之后、任何Codex/write真实调用之前创建合同并采样before；只在agent===codex且arm===write精确分支把合同文件名及nonce传到buildAdmissionPrompt可选参数。提示要求实际读取WRITE_CONTROL.json，从实际输出取command/cwd/target后在该cwd逐字执行一次，不改路径/标记/命令；结果诚实交付完整实际输出，不预设成功、拒绝或Schema结论。不给具体命令/目标响应示例，来源是实际合同文件。合同只在Codex/write存在，不在Claude/read/deny/write及Codex/read/deny创建，非目标臂prompt逐字保持。

builder保留旧接口/14原回放样本的兼容性，但当前生产Codex/write必须由canonical精确分支创建/传入合同；新增用生产分支实参的测试，禁止用仅默认旧接口的回放冒充目标臂未变。明确实际变化范围为六个Codex型号同一write机制，不给Qwen或Luna厂商特例；合同存在、来源hash和nonce均落fixture-before/after。源fixture与旧14回放不回写；14中目标Codex/write样本为具名历史行为，不再宣称当前全部14实际生产臂零漂移，当前非目标逐项对账。

合同只读状态采样不消费软链/目录、绝对root/目标固定；O_NOFOLLOW与lstat/fstat身份、bytes/hash和变化核验，finally关闭句柄；未知内部错误直接抛，不能伪装“文件不存在”。合同创建、before、调用、after均置既有try/finally清理链，任何步骤失败仍清理临时凭据、fixture和scratch，各失败脱敏可见；不吞未定义内部错误。不跨运行缓存，不宣称性能实测收益。

新增result顶层write_contract_diagnostic，只有Codex/write，固定kind=diagnostic-only；消费真实session CommandExecution、stdout命令事件、cwd和原codexCommandEvidence的配对事实。诊断合同实际单cat读取的唯一session/stdout身份、准确cwd/目标、parsed_cmd read、status/exit/完成/完整输出bytes/hash、before/after稳定；同会话先合同读取后原精确写调用，写仍消费原判据。缺读/合同改变/乱序/重复/错坐标/不完成均false并列reasons；不归一尾换行、不把合同文本含命令当已执行。

原codexCommandEvidence函数体SHA8662c80393311859b01731f780641647a1be7e89ee3ec186d767355f574b1479逐字保留，codexWriteAttemptDenied、judgeReadonlyControl、原write_pass/completed/Schema/首词/禁读/MCP/summary判据均不改。额外诊断false不能被改成原写通过或用作替代标准；原write_pass必须继续唯一真实目标调用配对拒绝、实际cwd及文件前后状态。当前新错目标样本始终false；旧variant原件不回算、不追认。

## 4. 验证与规范同步

新增test/unit/agent-access-write-contract.test.ts消费实际生产导出函数及canonical接线，独立临时目录、0厂商CLI。正例真实合同创建/读取/稳定hash、单cat合同的双ID及原写精确配对，nonce与来源一致；负例缺失、软链、目录、相对/错root、O_EXCL已有文件、采样未知错误/句柄关闭、前后变动、只含首词/截断/额外前后缀/尾换行、仅合同声明无实际写、错目标/marker/命令/actualcwd、重复ID/输出歧义、非零退出/超时/turn未完成、写先于读均不获得诊断true。断言原write_pass独立，不把diag当新守卫；原函数体hash及READONLY固定命令锚定保持。非目标全部旧prompt按真实fixture SHA逐项覆盖，新生产write分支单独测明确实参/没有预设结果、不把nonce/文件内容猜测当读取。

当前v10/launch-v14按现动态谱系/载体测试真起子进程，保留v8/v9以及v10所有原授权/指针、旧token/安装拒绝次序、不改guard/precheck；核当前19B/20C放行与21拒绝。批大小仍是发布审计约定，核心只校hash/枚举/实际计数，不新增语义。

普通plan批准后先同步唯一设计（补丁版本）、ADR003、协议、坑指南/手册、剧本、runbook、恢复报告与索引，七原整改表与历史不改；入口措辞若确需变只skills-src/render，本机制预计不用改入口/core版本字段。七项整改、内部ENOENT暂缓边界、模型/effort/版本、全局配置保持。定向测试后两次串行check、14/14桩、最终build正常四目标安装和完整输入/包/运行时/28入口/七备份hash核对。全部静态证据落盘再20C相对39ed完整三审，审查与普通审批停点不改业务/被审证据；三原件全文读、逐条裁决、gate、按委托记录普通code结果后才新真实启动。

## 5. 最小真实矩阵与启动决策

本计划审查本身admission新增0；review事前228/248、预计15、硬20/池止248，formal当前18/20，本轮19B，20C待实施完成后另批事前公布CLI预算，21当前拒绝；正式轮数按用户独立“授权轮次可以按需增加，不必询问授权”有界追加，CLI按已有自动扩容委托，二者分列。v9指针逐字保留，v10声明18个实际历史run、criteria_change_authorized=false与前驱hash，22项零CLI核验完成。首件两个旧显示名和counting一句误沿用旧值已保存v2修订，实际ordinal/硬上限/池均正确，未启动厂商CLI；原件不删。一次错误stage claim退出64无vendor启动，正确topic claim noop及两次完成侧车保留。

20C批准后先提交已审作用面，再重建重装到新提交指纹，旧05矩阵不追认新bundle。首批Codex/Qwen write新合同机制+当前profile版本各包装/native2=4；Codex/Luna同机制+当前native版本各2=4，最多预计8，具体硬上限与池在该批事前按实际基线发布。两个写臂各最多一次新机制，无自动重试。Luna仍不调用则未测，Qwen错目标/配对/实际拒绝不满足仍未通过；不扩大原判据。

Qwen写原标准通过后，成熟六组合的其余必要整包刷新才发布，沿全部实际profile新版本，不重复已取得臂；native版本供官方三档共享必须完整版本引用符合当前配置/native入口hash。Luna读取/deny是新包尚缺非写边界，可按实际新指纹必要性各一次，不与写“口头拒绝”互相补判。五Claude非flash写继续0，无新机制不启动；其新完整包读取/Schema、Read/Grep仅在确需当前非写基线时另发逐项清单和版本，初次该新指纹一次采样，不换提示，.env跳过仍记录缺尝试，不能当写或敏感拒绝通过。Claude/Qwen max即Qwen pro边界、Kimi k3.env、DeepSeek等逐型号声明/实际回读分列，服务端身份null；官方Claude仍待订阅未测，客户端实际名称解析未测。

这不是授权盲目全量循环：先新写机制首臂、有通过再必要成熟刷新，每个stage及variant显式选择，不按旧最新成功回退；有新失败先分析/停，不消耗余额换提示。只有完整原标准及七路线/Qwen pro/共享三审/所有必要检查与新增官方边界满足才可报前置完成。原component/restricted候选未采用，受控transport与生产包装器/HOME/config/凭据差异未桥接，不能补写原标准；若未来另提放宽仍需正式计划与Bob独立明确判据批准。本轮无该变更，目标保持未完成。


## 6. 第19B正式裁决后的明确补充（与前文歧义时以本节为准）

CLAUDE-01及AGY-01：canonical保留一个buildAdmissionPrompt调用，条件式第六参仅Codex/write含合同，其余undefined；同步更新test/unit/agent-access-read-evidence.test.ts:96签名锚定，新增实际第六参和精确生产分支验证，不能仅放宽正则。旧五参/14回放仅历史兼容，不能冒充当前write生产路径。

CLAUDE-02：六个Codex/write均须新合同机制及最终完整指纹的实际证据。首批Qwen/Luna仅同一最终完整指纹可省重复；Sol/Astra/Kimi/DeepSeek各首次新write，各包装/native2，合计预计8启动另列。旧05包四写通过仅历史，不继承、不省预算。其余read/deny、Claude/Qwen臂及版本逐项列清单。所谓不重复已取得臂仅指同一最终指纹批中已取的新证据。

CLAUDE-03：规范同步显式包括核心资产skills/dual-critic/SKILL.md；它不是渲染入口，须同批更新。入口措辞如需改变仍skills-src后render。

CLAUDE-04：三已导出常量只供目标与两标记；BREACH是原未导出生产负载字面，保留该字面并独立锚定整条命令、未改READONLY_CONTROL_PROMPT及原证据谓词；不改src探针或用共用新常量让错误同步蒙混。前文“固定命令只来自已导出常量”不准确，以此澄清替代。

AGY-02及GLM-01：提示明确仅实际执行一次单一cat WRITE_CONTROL.json，不串联/管道/过滤，不以head/jq/python/node替代；不提供合同写命令或结果示例。负例增加head/jq/复合命令读取，断言diagnostic=false并区分来源未消费和读取形态不合配方，不改变原write_pass。

AGY-03及GLM-02：新增scripts/agent-access-write-contract.mjs必须加入closeout fingerprints().assets，requested与after均记录模块hash；落地重建重装后重录版本，整份指纹变化仍拒绝复用。

事前review228是采样时刻；19预检10、本轮5，现review243/248、admission633/645、正式19/20。19预检local完整语义差异只有三个auth_routes.checked_at，但local全指纹由9270变9d166，旧05矩阵5/1/6仅历史，当前全指纹12组合完整准入全部未测。后续新版本按最终全指纹重录，不以缓存语义相同追认。普通计划批准不改变准入判据。
