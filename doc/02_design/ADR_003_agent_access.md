# ADR-003：编程工具身份与接入路线分离

2026-10-12第27C普通批准采样：run20261011T212239Z三审有效、零漂移，三意见2暂缓1驳回，gate/await通过、停点业务摘要0；按Bob本轮明确委托由Codex批准code，session=null。两项准入判据仍未采用；新r22保存160份r21原件hash和具体27臂/4跳认证决策方案。下文26B阶段状态按当时采样解释，原false/未测、停止批次和官方Claude待订阅保持，M11前置未完成。

26B已有效审查并按Bob普通委托批准完整r30（SHA 9c457711d4146644d9dedd976cbdf854128283df0802ddf32ba6f4bc0cf75d5c），新CLI inline defaultMode/精确deny差异、有界1..32逐跳原值/hash及v3关闭消费者规范见[设计v1.3.158当前合同](./2026-09-10-Driver-DualCritic主攻双审流水线设计.md#agent-access-inline-mode3-contract)。旧v2/mode2正文按历史采样保留；v3/auth两项独立采用仍未批准，原标准false/未测不改。实施采样：Qwen max一次真实CLI取得default与受控机制事实，事后proof错误使首批停止；修正后只读复算通过，原停止保留，k3及其他组合未启动。27C预检正常刷新三项认证时间，4跳/27臂/378组件/91引用重验通过，当前6a2c6213 canonical0通过/12未测。r21实际消费者先核15依赖及独立批准，忽略调用方事实布尔值，再重验原件/完整指纹/scope；候选报告消费与产品准入分列，实际两个候选缺批准保持关闭，正向实际独立批准消费未测。准入734/742、review353/363全部完成，正式26/27，27C尚未启动，M11前置未完成。

日期：2026-10-09。状态：Accepted（用户批准开发计划）；实现与真实路线验收进行中。

前向敏感流程统一见[设计v1.3.157取证守卫规范](./2026-09-10-Driver-DualCritic主攻双审流水线设计.md#agent-access-evidence-guard-contract)：产品和独立证据层改变谓词均先正式计划与明确批准，普通审批委托不授权准入判据采用。25B已按委托批准r28具名临时模式/HTTP限额清理/N对账/启动绑定/双跳诊断范围，新增实施与实际取证待验证；旧原标准列保留，两个候选仍未采用。

2026-10-10补测：基线实现已在b04cc302提交；Codex0.162.0四路线及Claude/Qwen flash补齐适用准入。Claude/Kimi、DeepSeek三种写入提示均没有实际写工具尝试，仍未测。Qwen max组合已回读并取得Bash拒绝证据，当时共享pro与三审按该轮审查计划等待七条默认路线完整准入；不宣称前置任务完成。正式结果见2026-10-10准入报告，官方Claude继续待订阅恢复。

Claude 与 Codex 都可通过供应商配置运行其它模型，工具身份不能证明模型族。保持注册表 Agent 身份、归档与护栏；独立解析 native/profile、模型、effort，预检和运行消费同一结果。Claude 的 native 表示官方订阅/登录，profile 经cld加载配置；失败不自动切换。

能力探针绑定路线和指纹，认证按实际组合隔离。配置声明与运行回读分别记录，无回读记null。run.v3保留三态模型族比较；旧Schema和历史文件不改。同族或未知告警继续，不增加门禁。规范字段和错误顺序以主设计11.6为准。

profile入口取本机绝对配置路径，缺省才现场发现可执行包装器；路径、包装器哈希、配置哈希和该路线底层版本共同绑定，不借用最后一次探测的其它路线版本。原生Claude清理ANTHROPIC_*冲突变量，保留官方登录或OAuth令牌；Codex原生要求官方provider与订阅登录配置，第三方入口或API凭据明确拒绝，失败不切换、不修改全局配置。

代价：缺Driver声明时不能证明异构；新增路线必须重新验证只读能力。告警按原因聚合。模型别名可能被profile映射，不能静态断言其家族。

2026-10-10配置调整（用户明确授权）：Claude的项目default/flash使用Qwen flash，pro/high显式绑定Qwen max与profile:qwen，不配置effort默认值。Qwen两组合已有完整准入并核对当前入口/profile指纹，因此恢复共享Claude、Gemini、GLM三审；Kimi/DeepSeek的生产写负对照不阻塞Qwen启用，仍保留未测。Claude官方模式实现保留，其项目默认/pro暂不使用；失败不自动回退官方。显式选择Kimi/DeepSeek须同时传接入与匹配模型。

2026-10-10 Codex 项目默认接入（用户明确要求）：agents.codex.profile 显式 null，default/flash/pro 的 plan/code/bug 分别使用 gpt-6.1-sol、gpt-6-luna、gpt-6-astra。该仓库配置覆盖内置供应商默认，不修改产品内置默认或用户全局配置；其它供应商保留单次显式选择，失败不自动回退。

2026-10-10本轮收口：HEAD已为3e5ca6bb，以上“未切换”“未提交”表述属于各自采样时刻。当前Claude2.1.296与Codex0.162.1不同于旧能力版本；旧完整指纹不能追认。收口使用受版本管理的canonical取证/汇总脚本，相对写路径按实际cwd解析，精确匹配隔离目标、调用ID、注册层或沙箱层错误及文件前后状态；禁读使用生产枚举并逐文件取证。生产写尝试缺失保持未测，受控传输只证明受测CLI机制，不替代真实模型主动尝试。判据候选须另经正式审查与用户明确批准。当前采样与进度见[收口报告](../05_testing/REPORT_2026-10-10_agent_access_closeout.md)，不据本轮计划审批宣称M11前置完成。

本轮code整改的取证契约（原标准不变）：探针和汇总须共同使用显式批次selection manifest，固定variant及requested/result/fingerprints-after的hash；缺结果、未完成或指纹不符不得回退旧成功。版本证据亦显式引用并核对入口/包装器/配置/模块指纹。Codex实际读取须有CommandExecution.cwd、parsed_cmd精确README目标及唯一命令/完整输出/exit/status配对，不认单独echo；两种ID分列。CLI effort带来源记录，服务端null，不添加默认值。受控对照从同一manifest取当期真实臂并核对实际权限模式与工具面，缺值不判同形。独立清理与落盘失败仍执行其余清理；历史入口缺新版上下文明确报错，不重解释原件。

2026-10-11版本上下文纠正：同一Codex物理CLI不意味着native与profile配置指纹相同。能力批错误选择native版本记录时严格拒绝是正确行为；取证脚本增加仅供静态Codex版本臂的已登记profile上下文参数，各profile独立选择版本manifest。保持完整指纹比较，不掩掉profile配置差异；版本命令无供应商/模型实际调用证据时相应身份仍null。

2026-10-10补充计划已获本轮人工审批（开始实现）：优先采用严格字面目录投影，按Read/Grep/Glob独立实测后启用；未知/失败工具保留逐文件规则，原机器禁读集合和证据不删除。目录规则的真实能力目前未测，10.3KB只是三工具全可压缩时的静态估算。settings文件传输仍为未实施比较项。原写负对照标准、准则变更审批和M11完成条件均不变；实现后须恢复Claude/Gemini/GLM完整代码审。

历史plan-r3采样（旧总6授权已被新总7例外替代）：2026-10-11当前整改契约见设计v1.3.146及[恢复报告](../05_testing/REPORT_2026-10-11_agent_access_recovery.md)：plan-r3/run20261010T175354Z三审有效，12条接受并合入r7，依本轮委托授权批准。旧四轮记录保持；本轮最多6次。目录事实绑定真实项目sensitive_globs及实测ASCII拓扑、无事实先回退。原生产写负对照标准不变，M11前置仍未完成。上文10-10进度与报告指针均为历史采样。

当前整改契约见[主设计](./2026-09-10-Driver-DualCritic主攻双审流水线设计.md)与[恢复报告](../05_testing/REPORT_2026-10-11_agent_access_recovery.md)。历史plan-r4/run20261010T224543Z获批r9契约（当时总7轮）：目录形态为ascii-root1-5-depth0-2-v2，目录段^[A-Za-z0-9_-]+$、根1至5段、后代0至2级；仅真实新拓扑doctor通过且项目hash/时间/路线/版本/入口/native一致才消费，v1旧事实失效。五种根的七臂每工具文件30、目录5、共同正对照4，180秒每臂保持，失败保存主probe并清空目录事实。总7轮例外已独立授权，第6次补充计划已批准、第7次完整代码重审待执行；CLI额度与轮数分列。第7次启动前用最终构建、生产完整禁读枚举及实际可消费事实计算settings，超过既有131072字节软线则任务包装器拒绝正式启动，不删除禁读项、不改产品软线、不借旧安装绕过。原生产写四缺口仍未测，判据替代未采用，M11前置未完成。

当前决策补记（2026-10-11）：用户独立授权正式总12轮，第11次B/plan三侧有效、11条裁决与普通审批完成；第12次C/code只在三项任务级守卫整改及检查/安装后完整重审。新v2纯轮数核验不得省略当前权威参数，新v8正式入口与quiet-v6限定摘要入口；Claude非flash五个写臂无新机制时在spawn前拒绝。旧版本、失败与审查原件保留。此项不改原生产准入标准、产品只读判据或BRIEF禁读范围，两项替代判据仍未采用；当前运行与未测状态以[恢复报告](../05_testing/REPORT_2026-10-11_agent_access_recovery.md)为准。

当前目录事实与敏感枚举规范统一见[设计§3.5](2026-09-10-Driver-DualCritic主攻双审流水线设计.md#agent-access-directory-contract)：消费仅限受测ASCII形态、绑定实际项目及入口，失配回退逐文件。正式授权、实施、真实取证和未测状态见[恢复报告](../05_testing/REPORT_2026-10-11_agent_access_recovery.md)，不以本节历史计划采样替代当前验收。

较晚决策（第13B/r18获批）：独立总14只余14C；采用launch-v10唯一token、quiet-v7精确本次配对/必需值校验，REQUEST_TOKEN与既有LOAD_TOKEN/load_id/marks同一，preload/evidence辅助不改。正式code测量固定v2，取消任务级plan测量需在设计v1.3.150记录；未来新增plan须新launcher方案重评。旧v5测试改固定夹具、当前v6直接覆盖，旧运行与原准入判据保持。以上仅任务层决策，不表示当前路线准入或M11前置完成。


较晚采样（第14C后）：14C run20261011T070836Z有效、无漂移/现行guard违规，但普通code依委托拒绝，四意见裁决为两接受、一驳回、一暂缓。沿13B已批准范围，quiet-v8对完整摘要JSON应用既有脱敏/扫描，补包装器自身异常尾行防御，token、白名单、code/signal及证据选择语义保持；v6谱系hash补直测。旧quiet-v7/授权/原件不改，通用base/数值连续性guard不扩。当前正式14/14，第15完整C资格待Bob独立授权，未启动。判据候选未采用、准入缺口仍保留，详见r6/post-round14-wrapper-followup-proposal.md及恢复报告；两遍check/安装指纹须以新的补修采样分别留痕。

> 2026-10-11 第15次重审授权补记：用户独立授权“授权总15轮，仅追加完整代码重审（建议）”。当前权威 v7 保留 v6 原件及14次历史，仅开放15C，拒绝16次与新增计划审查。两项补修（quiet-v8完整摘要脱敏、v6 supersedes 原件hash直接断言）仍属13B已批准范围；v11只更新授权载体，不修改guard语义或准入判据。第14C普通code拒绝保持；第15C结果及新版完整指纹尚未取得，旧准入不自动迁移。

> 上述第15次补记为授权当时采样，保留历史原文；当前执行口径以恢复报告最新段与hash绑定的正式权威指针为准。2026-10-11用户随后独立回复“授权轮次可以按需增加，不必询问授权”，当前v8仅枚举有界16B/17C、保留15历史及v7谱系，18仍拒绝；未来批大小由发布核验与正式审查约定保证，v2守卫本身不核批大小。第15C已有效并按委托批准，第16B run20261011T093157Z五条裁决/r20及普通plan已批准，第17C尚待实施完成。新增诊断不改变原准入判据，判据变化仍须另行明确批准；旧874完整矩阵5通过/1未通过/6未测仅其原指纹采样，后续新任务书/新包未测。

> 第16B/r20获批取证契约（详见设计v1.3.152）：仅Codex/read使用无实际首词及无预设结论的对象Schema指引，单cat要求保留；Claude/write/deny的14份真实prompt固定hash回放。fixture-before/after在本臂新增readme_state（普通非软链文件、bytes/sha256/精确路径），result顶层read_content_diagnostic为固定诊断对象：kind=diagnostic-only、comparison=byte-exact/no-normalization、strict_content_match/reasons、前后状态、输出bytes/hash及两种ID。额外前后缀/尾换行、截断、缺证据、目标/cwd/ID错配、前后变化均不得诊断true，未定义读错误继续抛并清理。原配对函数/准入断言逐字保持，诊断不参与准入汇总，不改产品Schema、adapter/probe旗标或模型/effort/版本；新包检查、安装、17C及普通code批准后才做真实补测。


> 第19B/r22获批写合同取证（设计v1.3.153）：19B run20261011T113848Z有效，9意见逐条接受，完整r22修订及用户明确委托的普通plan批准已记录；20C尚待实施、检查与完整代码重审。仅生产Codex/write在独立临时夹具创建WRITE_CONTROL.json（O_EXCL、0600、真实非软链根），固定原目标/标记及未导出原BREACH字面，不改src探针命令。canonical唯一调用条件第六参接合同；旧五参14样本仅历史兼容，当前非目标逐项字节对账。提示仅单cat合同后从实际输出取command/cwd/target，逐字执行一次，不提供写命令或结果示例，不强迫工具、不循环换提示。新模块进入assets全指纹及版本重录。
>
> fixture-before/after保存合同普通文件状态、声明nonce、bytes/hash；result.write_contract_diagnostic只诊断：kind=diagnostic-only、严格全文字节/双身份、同session/turn与可信完成/启动时间及先读后写、实际cwd和原精确写配对。缺状态/来源不一致/改变/截断/增删尾部/非cat/head/jq/复合/重复ID/错目标/未完成/乱序均false列reasons，不参与原write_pass、准入汇总或产品Schema。未知错误直抛，脱敏failure留痕并走原凭据/夹具/scratch清理。原codexCommandEvidence函数体hash不变，真实实际尝试+配对拦截+文件状态标准不变；合同存在或全文声明不能替代调用。
>
> 六个Codex/write均需新机制与最终完整指纹的实际证据；首批Qwen/Luna各一次，仅同最终指纹可省重复；Sol/Astra/Kimi/DeepSeek各新写首次合计预计8包装/native启动另批发布。正式v10有界19B/20C，21当前拒绝；审查243/248、准入633/645为19B收尾采样。旧05矩阵5通过/1未通过/6未测及所有历史保留；19预检仅三个checked_at语义变化仍使全local指纹9270→9d166，当前完整指纹12组合均未测，不能继承。五个Claude非flash生产写仍无新机制、0启动；官方Claude待订阅、服务端身份null、客户端入口实际解析未测。component/restricted候选未采用，判据变化仍需独立明确批准，目标未完成。


> 第20C后同获批范围失败留痕补正（设计v1.3.154）：20C run20261011T122355Z有效，6条逐项2接受4暂缓，普通code按用户明确委托拒绝，业务摘要0；21C待完整重审。修正仅r22已批准“失败可见、未知错误上抛、任何步骤清理”：recordAdmissionFailure保留主异常，失败保存异常进入AggregateError，不额外直出原始错误、不覆盖wx原件；cleanupPreservingFailure让原cleanupAll继续全部清理，清理异常与主异常同时保留。fixture/scratch初始化进原try/finally；failure.json增加readme_after、合同阶段/创建状态与资源可用状态，创建途中未知记null；未取得scratch返回值的清理状态不冒称已删除。selection/版本资源前预检失败仅有既有调用完成失败侧车，不承诺failure.json。
>
> 本批不改变原codexCommandEvidence字节、写/读判据、目录消费/根形态、产品Schema、模型/effort/CLI版本、全局配置。ASCII后代目录加特殊文件名联合样本、/tmp等祖先别名、理由粒度细化与采样器合并均暂缓；前两项如需支持须另审守卫/探针语义，不将未测组合追认。五Claude非flash写继续0启动，当前新完整指纹12组合均未测。按独立按需委托发布v11仅21C，22仍拒绝；新v15只换权威文件名及首注释，guard/precheck不改。review起点253、预计15/硬20/累计止273，admission本批0保持633/645，旧台账/原权威/20C原件不改，普通审批不包含判据变化。


> 第22B获批Claude精确拒绝取证（设计v1.3.155）：22B run20261011T142848Z的11意见已裁决，gate通过并按Bob本轮明确委托审批r24定稿敏感范围；23C完整代码和新指纹准入尚待验证。canonical仅真实Claude deny-read/deny-grep调用claudeDenyEvidence：生产judgeDirectoryArm true为必要非充分初筛，脚本独立核合法事件、唯一init/成功终态、每目标唯一实际调用→同ID is_error=true结果→同ID同工具同精确路径权限记录及完整覆盖。最终路径仅折/private/var，生产helper较宽归一不扩大脚本域；已录制旧精确路径/新完整目录错误白名单之外拒绝，目标成功读取或raw哨兵泄漏拒绝，允许文件成功读取不误杀。
>
> result保持deny_pass/per_file_deny原字段，新增deny_evidence伴随事实；历史原false和原件不回算，summary判据不改。新目录文本Read回放及Grep模拟不是新模型能力，Grep仍须实际调用与完整配对。Codex冻结函数/原写标准、生产probe/adapter、Schema、版本/effort和全局配置保持。当前local6cc3下12组合完整未测，旧4c87四通过仅历史；准入673/689、review283/288、正式22/23，五Claude非flash写无新机制0启动，官方Claude待订阅。component/restricted判据替代未采用，仍须Bob独立明确批准；详见[设计契约](./2026-09-10-Driver-DualCritic主攻双审流水线设计.md#agent-access-directory-contract)，M11前置仍未完成。


## 第24B获批集中取证边界（2026-10-12）

旧restricted-tool-surface-v1及component-scoped-evidence-v1仍未采用。24B/r26获普通plan批准，新增候选restricted-tool-surface-and-path-v2纠正包装桥、权限模式及live绑定缺口；auth-cache-timestamp-applicability-v1只限本次三具名checked_at。先实现受控夹具和诊断，再取得Bob独立明确判据决定；普通审批与轮数授权不能替代，原标准列/单臂false保留。 完整规范见[设计v1.3.156](2026-09-10-Driver-DualCritic主攻双审流水线设计.md#agent-access-controlled-contract)；执行结果以恢复报告和r17证据为准，不能由剧本或计划宣称已测。
