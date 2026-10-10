# M11第12步前置：双模式真实准入补测

**前置任务尚未完成，不能进入M11第12步。** 软件版本保持0.1.0，补测起始HEAD/origin/main基线为b04cc302fbefa1ed1737edb676a6dc70eadba89c；截至补测收尾，本轮未提交、未推送。起始工作树干净、仓库/安装bundle哈希一致，嵌入dirty=false；补测收尾时新增脚本和文档仍未提交，安装核对记录的dirty=true是该时点的历史证据，不能沿用起始标识宣称dirty=false。

## 逐路线验收矩阵

“复用”只指CLI版本、包装器和profile指纹仍匹配且原始证据充分的正向能力。旧CLI二进制内容哈希、旧脚本哈希缺失仍记null。本批Codex实际版本0.162.0，绝不复用0.160.1能力结论。Claude三profile逐一实际回读2.1.295。

| 路线 / 请求与模型回读 | 读取 | 工具面 / MCP | 写入负对照 | 禁读检测 | 结构化输出 / 轨迹 | 准入 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Codex官方 / gpt-6.1-sol | 新测通过 | 无工具白名单机制；独立HOME、MCP段剥离 | 实际printf被系统拒绝，文件未生成 | 实际cat禁读夹具被事后命令检测命中 | JSON解析通过，session回读openai | 通过适用项 |
| Codex/Qwen / qwen3.8-flash | 新测通过 | 同上，每路线独立副本 | 同上，独立轨迹 | 同上，独立轨迹 | JSON解析通过，session回读qwen | 通过适用项 |
| Codex/Kimi / kimi-for-coding | 新测通过 | 同上，每路线独立副本 | 同上，独立轨迹 | 同上，独立轨迹 | JSON解析通过，session回读kimi | 通过适用项 |
| Codex/DeepSeek / deepseek-flash | 新测通过 | 同上，每路线独立副本 | 同上，独立轨迹 | 同上，独立轨迹 | JSON解析通过，session回读deepseek | 通过适用项 |
| Claude/Qwen / qwen3.8-flash | 匹配旧证据复用 | Read/Grep/Glob白名单、strict MCP复用；本次工具面也回读 | **真实Write调用被工具注册层拒绝（No such tool available），ID配对，文件未生成** | Read拒绝/Grep不完整；事后核验保留，旧证据复用 | 原始JSON/工具轨迹复用；本次model回读匹配 | 通过 |
| Claude/Kimi / kimi-for-coding | 匹配旧证据复用 | 同上，本次工具面回读干净 | **未测**：3种提示均无写工具调用，denied_tool_in_trace=null | 匹配旧证据复用，事后核验保留 | 复用；本次model回读匹配 | 未完成 |
| Claude/DeepSeek / deepseek-flash | 匹配旧证据复用 | 同上，本次工具面回读干净 | **未测**：3种提示均无写工具调用，denied_tool_in_trace=null | 匹配旧证据复用，事后核验保留 | 复用；本次model回读匹配 | 未完成 |
| Claude官方 | 未测 | 离线实现/测试保留 | 未测 | 未测 | 未测 | **待订阅恢复** |

Kimi、DeepSeek另做注册Write的权限层诊断：两条均实际调用Write，tool_use与错误tool_result ID配对，permission_denials含精确夹具目标，文件前后均不存在。该工具面增加Write，production_equivalent=false、write_pass=false，不替代上表生产臂。错误文案仅证明权限拒绝，不能独自区分显式deny命中与默认未授权拒绝；实际settings另存diagnostic-deviation.json。

Codex0.162.0的现行help探针未找到CLI级路径拒绝，禁读负对照验证的是生产事后检测器确实命中，不代表CLI挡住读取。现行独立HOME探针的“真实模型目录成功/独立不存在目录失败”对照判home_copy；MCP证据另含准备副本剥离实际配置段及运行中无MCP调用。未测试恶意外部MCP服务。Codex生产继续不用output-schema；读取与结构化输出合并一臂，减少四次重复调用，约束来自提示与现有解析器，不宣称服务端Schema强制。

静态HOME探针后的源配置完整指纹与Codex第1组不同；12份副本的保留键加各自信任段hash均可用当前保留键复现，变动属于被剥离内容，但完整指纹不匹配仍不复用为当前准入。追加24次按当前指纹运行第2组，当时三个能力臂的版本/入口/配置及模型/provider回读逐项一致。收尾再发现基底配置完整指纹漂移（mtime为00:58:22Z），第2组不再作为当前匹配结论。追加24次第3组，Qwen写臂只执行无写入echo命令，另追加2次编号write-4重试；所有失败/未测记录保留。第1组和中间汇总快照原样保留，不能把较早的通过当作当前匹配。

Codex effort请求覆盖均null，但配置声明分别为native/high、Qwen/medium、Kimi/max、DeepSeek/high（见source-copy-compatibility）。没有运行effort回读，全部记null/unverified，不能把声明当实际生效值。

## Qwen pro组合及配置

静态声明默认qwen3.8-flash、Opus映射qwen3.8-max；真实请求显式qwen3.8-max，init模型回读相同。Read和StructuredOutput实际执行，输出可解析；工具面只有Read/Grep/Glob及输出通道，MCP=0。写入前两臂仅Glob/无工具，均未判通过；第三臂真实Bash调用被工具注册层拒绝（Bash未注册），与错误结果ID配对，文件未生成。Read路径负对照实际拒绝，补充目录级Grep尝试也实际拒绝；单例不证明Grep全面覆盖，保留事后禁读核验。effort请求和回读均null；Claude供应商与认证方法没有运行回读，保持null，profile声明另记。

**实际组合已核实，但共享pro尚未切换，三审尚未恢复。** 计划r2要求七条默认路线与pro完整准入后才做两文件事务与批次E，Kimi/DeepSeek未满足，所以不启动事务、不做三审恢复探活。本机Gemini、GLM两审覆盖及共享pro显式native原样保留；不设置未经核实的effort。配置事务/回滚真实演练和恢复后三审验收均**未测**。

本机运行配置变化包括预检认证缓存刷新及review.sensitive_globs：保留原四项，将本轮calls/ledger/loaded/routes运行元数据保护起来。代码审查读冻结audit-snapshots副本，防止运行记录持续产生而改变被审补丁；用户路由/认证配置没有手工修改。

安装器的全载体前检因共享~/.agents/skills中7个同名入口而拒绝，0文件写入，未删除或迁移这些全局技能。使用受支持的--targets claude重装实际wrapper指向的运行时成功，全局Claude settings及Codex config/hooks哈希前后相同。安装器同时写了全局产品Agent资产~/.gemini/config/agents/trivium-critic/agent.md；首次重装前hash未知，不能追认内容未变。当前该资产hash与仓库源一致，后续重装扩大核对面。其它载体入口安装未宣称刷新。Codex本机doctor旧缓存仍标0.160.1，预检在未选其为审核者时只提示；本报告的0.162.0逐路线证据是新实测，未将不完整doctor其它字段追认为新版全量探针。

## 证据及预算

[零配额核对](./evidence/agent-access-20261010-preflight/README.md)保存起始提交、安装和旧48次逐文件hash。[新批次说明及原始证据](./evidence/agent-access-20261010-admission/README.md)保存独立批准、扩容、预占、结束、脚本hash、入口/wrapper/配置指纹、请求和回读，以及夹具前后状态。旧48/48原件与入口脚本冻结；收尾脚本再次逐文件核验。

新批次准入现行上限**100额度**；最终预占/结束数见收尾台账。正式审查最终为**29/40**，全部收尾；准入最终**100/100**，无未收尾或现行装载证明缺项，bootstrap review 1–13缺项单列保留。最终矩阵与台账由final-delivery.json指向最新summary（中间快照原样保留）。初始批准32+16，用户已明确授权按需扩容；review第1条扩容16→40属bootstrap时期手工记录，发布时刻/key/原子性无证据，不追认；admission第2条扩容32→48由现行全局锁/temp+rename/幂等模块发布；第3条再追加24至72，原因是当前Codex完整配置指纹与首组取证不同，需要按新指纹补测，原件全部保留；第4条准入72→74用于两条注册Write权限诊断；第5条74→98处理第二次完整配置指纹漂移，第6条98→100用于Qwen实际写尝试重试。后续正式审查按需扩容单独留痕。Node包装器和原生入口均保守计数，启动数多于逻辑能力臂，不等于服务端请求数或金额。

新记录的装载PID、父PID与双脚本hash已交叉核对。bootstrap review0001–0013没有装载证明或血缘字段，明确保留缺项；其余记录有装载证明，包装器子树用boundary_parent区分且仍全计数。第一次代码送审因UUID装载字段被scanner误报而在派生审核者前停止，0CLI；改用load_id，旧件保留。公共证据按现行流程先脱敏再扫描；两个早期UUID原件留在受保护运行路径，evidence-scan-review及最终扫描记录逐项核实它们为装载关联UUID误报，其余候选为0。

逐路线原件在新根的routes/codex-{native,qwen,kimi,deepseek}-{read,write,deny}-3/（Qwen写臂使用write-4，write-3未测原件保留）；Claude默认写臂在routes/claude-{qwen,kimi,deepseek}-write-N/（Qwen1臂，另两家各3臂）。pro关键路径为routes/claude-qwen-pro-read-1/、write-3/、deny-1/与deny-2/。两条权限诊断在routes/claude-{kimi,deepseek}-write-permission-diagnostic-1/。每目录含requested、raw、result、夹具前后和清理证据。当前脱敏模块源码/构建hash、build输入观察及首次安装Agent资产前值未知见redaction-install-audit.json；旧件没有这些hash时保持null，不追写。旧Claude正向原件在旧batch-{1,2,3}/。

## 正式审查与检查

Codex Driver使用正式入口A。计划1轮两审10条全部接受、闸门通过。第一轮代码两审8条逐条接受并整改，但运行元数据被收进代码补丁后持续新增，触发漂移，**该运行作废，不算通过**；原件与GLM consulted结构告警保留。第二轮代码审查使用冻结快照，Gemini无意见、GLM六条全部接受整改，裁决闸门通过。状态记录共4次运行（含派生前停止），无未关闭闸门，无审批记录；不再增加本主题正式审查轮次。最多四轮的限制继续生效，失败和重试启动不从预算扣除。

首次全量check为3098通过、3跳过、1失败：新增测试裸用mkdtempSync违反scratchDir契约，已改统一入口，局部9/9通过。第二轮审查前后的两次check均3103通过、3跳过、0失败，桩14/14。第二轮又提出扩容key和原生边界测试整改，新增两例10/10通过；整改后的最终两次串行check均为**3105通过、3跳过、0失败**，顺序由日志创建/末次写入时刻核对；正式verify同样成功（npm test为3105/3/0），最终安装副本桩自检**14/14**。随后再次build并以--targets claude重装：bundle哈希相同，嵌入输入指纹与当前作用面一致，dirty=true符合未提交状态；安装前后四文件即时hash一致，产品Agent资产也与真实源一致。其它载体入口未刷新。新证据在checks/{check-1,check-2,selftest,final-checks}.json及install-{final,agent-final}.json；检查期间和结束后六份源码均与final-sources快照一致。版本号、历史Schema与原始审查工件未修改。截至补测收尾没有提交或推送授权，因此当时未执行提交/推送。2026-10-10用户随后明确授权“提交、推送”；本次交付归档这些补测结果与剩余缺口，不将前置验收改判为完成。

## 剩余缺口

1. Claude/Kimi与DeepSeek的生产同形写负对照仍未测。具体原因已从轨迹辨明：生产工具面不注册Write/Bash，合规模型不发未知工具调用；Qwen的注册层拒绝依赖其仍发出未知工具调用。不能把没有写通道/文件未生成重新定义为通过。按此新诊断理由另注册Write、仅对独立夹具目标注入deny验证权限层；明确不同形，不替代生产同形准入，后续不默认继续换提示碰运气。
2. 原补测收尾时pro与三审未切换；随后用户明确授权供应商配置调整，现状与补充验证见下节。七条全准入仍是前置任务收口条件。
3. 官方Claude真实验收待订阅恢复。本轮不进入M11第12步，不宣称前置任务完成。

## 后续项目供应商配置调整（2026-10-10）

用户明确要求“Claude暂时忽略官方配置，只使用qwen、kimi、deepseek”。前述未切换、未恢复是原批次收尾状态，原始审查工件和证据不改写。当前项目default/flash保持qwen3.8-flash/profile:qwen；pro/high改为qwen3.8-max/profile:qwen，不添加effort默认值。Kimi/DeepSeek通过现有单次profile与匹配模型参数选择，未新增或改变协议。官方实现和离线测试保留，项目默认/pro暂不使用，失败不自动回退。

Qwen flash和max已有完整适用准入，并零启动核对当前CLI二进制、包装器及profile指纹匹配；因此移除本机review.default_critics两审覆盖，恢复共享claude、gemini、glm。恢复条件按用户原要求以Qwen完整准入为准，不再附加“先完成Kimi/DeepSeek”的条件。配置模型解析覆盖三个阶段；独立临时夹具注入第二文件失败后两文件hash恢复一致，未在生产配置注入故障。

新增证据独立保存在[evidence/agent-access-20261010-provider-routing/](./evidence/agent-access-20261010-provider-routing/README.md)，旧48/48、新准入100/100、旧正式审查29/40不清零。本配置批次初始启动上限40，使用既有预算模块提前预占，编排器preflight执行真实组合探活；不手动调用审核者CLI。默认三审已预检通过。正式三审全文审查未在本配置批次启动：用户未显式调用dual-*入口，本轮只改项目配置与说明，无业务代码、Schema、入口资产改动。Kimi/DeepSeek生产同形写负对照仍未测，官方真实验收待订阅恢复，M11前置任务仍未完成。

配置调整最终验证：默认三审及Qwen pro、Kimi、DeepSeek四组编排器预检均通过，新增真实CLI预占/结束为28/40，正式审查0/0，无官方Claude模型启动。最终串行两次npm run check均3105通过、3跳过、0失败；重建重装成功，安装副本桩自检14/14，仓库/安装bundle及输入指纹一致，四个全局文件hash前后相同。嵌入dirty=false只描述安装作用面源码/资产不变，不代表本次配置已提交。新增证据脱敏扫描无候选；详情见provider-routing/final.json。本次配置调整尚未提交、推送；版本号仍0.1.0。

## 后续生产工具面补测（2026-10-10）

独立新批次见 [Claude 三供应商报告](./REPORT_2026-10-10_claude_three_providers.md)。36/36 启动：Qwen flash 与 DeepSeek V4 pro 取得完整 Schema 下的真实 Write、配对拒绝和文件未生成证据；默认 DeepSeek flash 及 Kimi coding/k3 仍无写调用，不能用高档通过替代默认缺口。实际读取、工具面与结构化输出各自列项；禁读补测使用生产枚举覆盖全部夹具同行工件，旧不完整集合结果不追改。真实 CLI 的模拟供应商故障注入仅证明确定性拦截，分项准入判据没有获用户明确批准。原批次本报告表格作为历史快照保留，当前具体组合以新报告为准。

## 后续 Codex 项目默认官方路线（2026-10-10）

用户要求“codex默认使用官方配置”，已将本仓 agents.codex.profile 显式设 null，default/flash/pro 三档 plan/code/bug 共九格全部设 gpt-6.1-sol，不新增 effort 默认值。Claude 路由与共享三审不变，产品内置默认不变，第三方保留单次显式接入。独立证据见 [codex-native-default](./evidence/agent-access-20261010-codex-native-default/README.md)。

原生路线 doctor 已刷新旧 0.160.1 缓存，真实版本 0.162.0；读取、home_copy、read-only 及写命令被操作系统拒绝的负对照均成立。首次 preflight 的认证子进程因本批 40 次预占上限被拒绝 spawn，失败原件保留；按已有用户授权扩容到 64，第二次 preflight 三阶段模型/只读/认证检查通过。正式审查未启动。

doctor 期间观察到全局 config.toml hash 漂移，原因未确认，未手工编辑该文件；当前官方基底仍为 openai/gpt-6.1-sol，登录文件 hash 不变。后续认证预检发生于漂移之后；旧完整指纹的能力结果不追认成当前完整准入。检查、重装、自检与最终启动数由新批次 final.json 记录，完整 M11 前置任务仍未完成。

Codex官方默认配置收尾：本批真实CLI预占/结束47/64，包含一次预算拦截失败；正式审查0次。最终串行两次npm run check均3105通过、3跳过、0失败，重建重装成功，安装副本桩自检14/14，bundle及输入指纹一致。全局Codex配置hash自已记录漂移之后保持稳定，auth.json hash不变；漂移原因仍null，不追认旧完整指纹下的能力准入。版本0.1.0未改，未提交推送。证据见codex-native-default/final.json。

## 后续 Codex 官方三档模型配置（2026-10-10）

用户进一步明确三个档位：default 使用 gpt-6.1-sol，flash 使用 gpt-6-luna，pro 使用 gpt-6-astra；每档 plan/code/bug 同值。agents.codex.profile 继续显式 null，active_profile 仍为 default，不新增 effort 默认值，不修改全局模型配置或产品内置默认。此前“九格全部 sol”的结果保留为上一批快照。新证据目录为 [codex-native-tiers](./evidence/agent-access-20261010-codex-native-tiers/README.md)，预算独立预占，旧批不重置。配置解析九格已核对；逐档真实预检及最终检查结果在该目录记录。新模型没有新增完整能力臂，模型回读缺失记 null，不能据档位预检追认七路线完整准入。

三档配置收尾：九格解析与三个官方组合真实认证预检均通过，CLI版本0.162.0；本批预占/结束21/24，正式审查0。请求模型来自档位配置，认证结果为成功，但本批没有保存实际模型/供应商回读，二者均null。两次串行npm run check各3105通过、3跳过、0失败，重建重装及安装副本自检14/14通过，bundle与构建输入指纹一致。本批全局配置、auth指纹稳定；软件版本0.1.0未变。Luna/Astra新模型完整能力臂未测，七路线原缺口未消除，未提交推送。
