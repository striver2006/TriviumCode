# 相对上一轮的改动

- AGY-01：r2 D1；withQoderHome内在派生模型前合并req.deny_paths与临时根，若不能实证则阻塞；运行期凭据根不在freeze禁读集中，必须在临时根创建后补权限；其声称原生不支持路径拒绝不成立，P2/前置已有真实拒绝，仍需本轮逐工具重测。
- AGY-02：r2 D2；native_routes与adapter目录钩子；Custom斜杠标识必须单独解析且接入目录预检；不放宽官方目录正则。
- AGY-04：r2 D3；Qoder事件解析器及adapter结果映射；必须新增真实流式调用与结果关联解析；所引用runQoderCnWorker和行号与当前文件不符，不据此断言已存在该函数。
- AGY-05：r2 D4；adapter准入钩子/现有availability复用；通用三处防御只调用通用适配器钩子，不硬编码Agent。
- GLM-01：r2 D2；配置绑定v2和兼容分支；官方和Custom按独立语义源绑定；原始整份hash保留审计，旧facts维持原语义。
- GLM-02：r2 D4；probe.native_routes和项目本机准入文件；多路线存储和组合准入落点须先明确。
- GLM-03：r2 D2；官方MODEL单列解析保持原防线，Custom用独立声明解析。
- GLM-04：r2 D1/D2；确定性配方；配方hash不得含临时路径/mtime/本次时间；冻结事实原样传递。
- GLM-05：r2 D3；每格180秒最多2次；先最小对照，固定模型/提示词，每格限时限次，缺口不靠无限重试。
- GLM-06：r2 D5；registry与入口实测同步；按实际载体和隔离配方回填登记并复核身份注入，不能将CLI证据推广桌面。
- CLAUDE-01：r2 D2；label与effective独立；Custom请求标签回显不能冒充底层身份；可靠模型信封与必要路由回读标准先定义，缺必要证据阻塞。
- CLAUDE-02：r2 D1；env白名单；生产环境按白名单构建并绑定配方，父环境canary需反测。
- CLAUDE-03：r2 D2；access一致性；access.provider_*是供应商身份唯一事实源，native只保留目录命名空间不另写生效供应商。
- CLAUDE-04：r2 D4；机器准入不写静态registry或由doctor假产完整验收；本机证据生成和消费分开。
- CLAUDE-05：r2 D2；default/flash/pro显式Custom配置；保持P2默认官方来源，Custom必须显式选路，避免静默改变计费。
- CLAUDE-06：r2 D2；大小写/原生key冲突检测；Trivium内部区分不足以证明原生CLI消歧；冲突派生前拒绝。
- CLAUDE-07：r2 D2/D4；registry模型族规则仅据可信身份；不能用目录前缀推测生效族；可信回读模型与命名空间分离，不可确认时比较unknown。
- CLAUDE-08：r2 D5；当前v3扩展可选，缺字段为历史官方；保留v1/v2及parse/report/render全部同步。
- CLAUDE-09：r2 D1/D5；允许原生临时私有凭据落盘；输出归档前精确扫描已知key，命中脱敏并失败；未知密文不得伪称已扫明文。
- CLAUDE-10：r2 D3/D4；静态能力取全部可用组合的保守交集；组合细节写准入，不为过验收改分档。
- CLAUDE-11：r2 D5；注册表候选/Driver-only等注释需与最终实测状态同步。

## 修订决策（D1—D5，以下条款取代完整计划内对应的未决策措辞）

### D1 凭据与运行隔离

临时根创建后、模型进程派生前，由厂商适配器生成原生权限文件：现有生产deny枚举加本次临时HOME/认证/模型配置根及规范化路径。cwd分离本身不算隔离。逐工具真实拒绝配对未证实就阻塞。子进程只继承显式操作系统运行白名单（PATH、locale、系统临时目录、必要证书/无凭据代理；代理带认证时不继承），HOME/USERPROFILE和QODERCN_CONFIG_DIR指向隔离根；其余父环境默认不传，NODE_OPTIONS及厂商变量不继承。配方hash覆盖白名单键、权限位、文件/字段清单、工具及拒绝策略语义，不含临时绝对路径、时间/mtime；每次实际临时根单独留清理证据，不进入确定性hash。

密钥允许位于原生必需的私有临时文件与CLI缓存内，全部删除并核验；不进入项目/归档。若原生加密存储无法按字段最小加载，先证明其语义/所含模型范围，不能把不可解读的多模型凭据文件整体复制当白名单成功。生产stdout/stderr/trace/error归档前按本次已知明文密钥值精确扫描并替换，命中则编排失败；不向用户回显命中值。未能取得明文key时如实说明扫描范围，不能用格式脱敏代替已知值检查。

### D2 双路线身份契约

官方parseQoderCatalog正则不变，禁止斜杠。Custom另用经过本机验证的原生声明解析器，限定无空白/控制字符/路径遍历的provider与modelID；拒绝未知字段形状与重复/大小写歧义。Trivium内选择语法为 official:<官方标签> 和 custom:<provider>/<modelID>；保留裸官方标签旧写法，裸provider/modelID仅在唯一已验证Custom声明匹配时接收，不按字符串外观猜供应商。传原生CLI时使用声明的原生key；官方/Custom原生key相同或仅差大小写，一律派生前拒绝，除非未来取得目录隔离消歧证据后另行设计。预检catalog钩子返回可选的规范选择值而非放宽官方目录。

默认仍采用P2官方原生默认，用户settings指向Custom只作观察，不静默转BYOK。default/flash/pro三表均允许显式Custom选择，单次覆盖最高；Custom没有隐式通用默认。请求原值、规范选择、原生key、配置来源分别冻结。

NativeModelFacts新可选binding_version=2及route_kind/route_descriptor存路线与目录命名空间（provider_id为原生命名空间，不是已生效供应商）、modelID、来源语义与配方hash；provider声明/生效身份只由既有access.provider_*持有，native不复制第二份。若必要扩source枚举，仅追加native-config形态并对旧字段保留语义。新官方v2绑定只hash影响官方默认/认证选择的语义，Custom仅hash选中声明/来源（凭据变更以私有源指纹校验，不落密钥）；全局settings原始hash另作不变性审计而非v2准入条件。旧binding_version缺席维持P2整份settings绑定，不改历史件。

原生init.model/assistant.model先只记labels；它们若仅回显Custom key，不成为model_effective/provider_effective。需从已证明来源的供应商响应元数据或CLI独立事件获得必要route/model回读，与有效请求配对。modelUsage不明键仍仅是计费键。未知底层model/provider保持null/unverified；若不能取得本任务必要回读，Custom正对照与准入阻塞，不允许以unknown绕过。只有可信的底层modelID进入模型族比较，前缀命名空间分离仅作解析，不把配置声明提升为可信生效值；unknown比较不是通过。

### D3 原生验收与轨迹

先以固定模型和提示词跑最小单变量正负对照，每格180秒、最多2次；第二次只用于明确可修正的调用形态，仍失败保留缺口，不无限重试。工具裁剪观察和执行层拒绝是不同证据；此任务必需项仍按用户定义，需要真实调用与拒绝配对，未暴露/无法触发为阻塞。

新增Qoder事件解析：system init工具列表、assistant tool_use的id/name/input、user/tool_result的tool_use_id/is_error与错误、result终态，按实测关联。Read提取file_path/path，Glob/Grep提取搜索根与实际命中路径；失败读取不记成功read_paths，拒绝调用另留。未知事件/缺结果不可默认为成功，表外执行入口算失守。结果填tool_calls、read_paths、search_hit_paths、write_events和终态字段并经现有guard验证consulted/覆盖；确切字段名按已存在类型，不发明不存在的traceKind。适配器静态TraceCapability取已启用组合最保守交集，不按声明猜测；组合差异另存验收事实。

### D4 机器准入存储与接线

CommonProbe保留native_default作为官方兼容键，新增可选native_routes数组保存独立路线facts，各有prepared_at与来源/版本/配方绑定，独立TTL；路由钩子选择唯一事实。完整准入由验收脚本生成项目本机.trivium/admission.local.json，按通用admission.v1 Schema校形状，记录绑定、必需项状态、证据相对路径与hash；文件不进Git，证据/索引进Git。doctor只做目录与路由探针，不假造完整准入。记录缺失、篡改、证据缺失/hash变化、TTL/绑定失配全部拒绝。

registry只登记Agent身份及准入能力要求，厂商适配器持有校验与解释；通用preflight/worker调用同一个可选准入钩子，adapter.run再次校验。不在通用层出现qoder-cn身份分支。没有完成组合时不接通生产开关，不把未实现的台账写成既成事实；仍可交付真实阻塞证据和验证过的独立模型接入。只有全部准入证据到位才实施生产启用和真实Qoder+两家三审；三审需保存family_comparisons（unknown保持unknown）。

### D5 兼容与同步

仅扩当前v3可选字段；缺route_kind按历史official解释，仅binding_version=2使用新绑定，native_routes/准入记录缺席绝不隐式视为Custom或已准入。历史v1/v2与v3不回填。同步面逐项包含types、当前Schema、schemas/parse/gate/meta、report/render、协议、核心SKILL、AGENTS契约、registry-parity、配置事实与两进程测试、设计和README证据索引。若某分支因原生阻塞未实施，只同步已交付事实，不为凑清单加入未消费Schema。

按实测回填registry中criticReadsInstructionFiles、entrySkillRoot/ExtraReadRoots的适用载体与事实；CLI隔离证据不能翻绿桌面入口。复核身份声明注入与死件检查。修正四家/Driver-only等注释，使其与最终开关状态一致，不提前声称准入完成。

---

# 合入后的完整实施计划

# Qoder CN 只读审核准入与 Custom 模型接入计划

日期：2026-10-28；Driver：codex；入口 A；计划审与代码审固定 gemini、glm、claude，各最多 3 轮，不降级。版本不变，不提交、不推送。

## 目标与当前基线

完成用户任务目标中的 Custom/BYOK 原生接入、严格只读审核准入以及准入后的真实三审验证。三个工作包分别验收，部分通过不得写成整体完成。Windows 无返回证据为未测、不可启用；任一必需能力无法触发或观察则阻塞对应组合，不以桩、静态检查或口头拒绝替代。

初始工作树干净，HEAD 3425274f；已在 HEAD 中的 Kimi 工作及历史失败工件全部保留。现有 P2 使用隔离官方认证根和空工具面，支持官方目录、probe_default 与回退早停；registry 的 Qoder criticEnabled/driverEnabled 关闭，尚无审核准入。此次不扩大 Kimi、桌面或插件 Driver 的验收范围。

## 依据与待证事实

- 当前实现：qoder-cn.ts、qoder-cn-native.ts、qoder-cn-model.ts、probes/qoder-cn.ts、model-routing.ts、preflight.ts、review.ts、run-protocol.ts；现有模型单元/worker 集成与 P2 真机脚本继续作为回归基线。
- 主设计 §3.5、§10、§11.1、§11.5（Qoder P2）、§16.2，GUIDE_env_setup §四，协议与现有能力/凭据/临时目录工具为契约依据。先修订拟交付契约，再实施；实测事实测后回填，保留未测。
- 2026-10-28 官方 CN 文档 https://docs.qoder.cn/cli/custom-models 与 https://docs.qoder.cn/cli/models：Custom 由原生 /model 向导管理，--model 使用 modelID；不在 settings.json 手工编造 BYOK。https://docs.qoder.cn/cli/settings 与 CLI 帮助用于核实配置级联；工具/权限/Hook/MCP/插件文档必须与本机配对取证。
- 本机 Custom 文件位置、格式、凭据保护/依赖、目录输出、实际生效模型信封、工具拒绝及终态轨迹均未在本计划中断言已通过。首个真实样本是用户已有 bailian/qwen3.8-flash-tp，不成为通用默认，不为测试改动用户原生配置。

## 实施顺序

### 1. 原生机制与最小隔离发现

在一次性私有夹具中开展真实调查。先只输出目录名、配置键形状、文件类型/权限、必要字段是否存在与非敏感模型元数据；不整份打印含凭据配置、不输出密钥。读取本机 CLI 版本、入口真实路径/哈希、帮助，核查官方配置规则、原生 Custom 目录以及 keychain/环境/账号认证依赖。把用户已配置的样本作为来源，不新增/删除全局模型、不操作全局技能/Hook/插件。

确认最小加载集合后，仅将该模型必需的声明和凭据按字段白名单置入 0700 临时根/0600 文件，不复制整棵目录。路径拒绝覆盖该临时根，模型正文不可读取凭据；清理包括辅助进程重建与失败路径。未知格式、符号链接、不可分割的全局依赖、无法保证凭据隔离直接阻塞 Custom；禁止绕回用户全局运行。项目配置只保存无密钥来源引用与模型身份。敏感原文仅内存处理，不入运行 argv/日志/证据；错误消息经过脱敏，真实 key 另作不回显的输出扫描。

以官方纯认证根、Custom 最小根、缺声明根、错误凭据根作单变量对照，核验配置 sources 与环境叠加。记录实际读取哪些来源；不将声明等同生效。

### 2. 模型身份与请求冻结

沿用现有 native_model 可选契约，拟扩展 route_kind（official/custom）、provider 声明、modelID、显示名、非敏感配置来源/语义指纹、隔离配方指纹与配置声明；底层 provider/model 生效回读单列，无法可靠确认保持 null/unknown。官方标签不冒充 Custom 身份，供应商+modelID+来源共同消歧；同名/大小写歧义不得以首个匹配吞掉。目录来源不混合：官方目录只含官方，Custom 从已核实的原生声明派生。

default/flash/pro 继续通过 resolveConfiguredTier 与既有优先级选择；默认来自已验证声明而非固定样本。明确 Custom 请求语法/配置形状后同步 CLI USAGE、契约源与渲染资产，保留既有官方写法兼容。单次 --model 覆盖要保留原值和选择来源，不能静默映射到官方同名或 Auto。预检及 worker 对 requested_routes 与 native_model 的完整非敏感冻结值作确定性比对；worker 不重新解析默认，执行前验证来源/版本/配方未变。跨进程测试篡改供应商、来源、modelID、配方与配置失效，均须派生前拒绝。

模型正对照要求真实请求和可信信封回读，不使用 assistant 正文自述；无法提供必要回读则失败。无效模型、配置失效、认证错误、流中回退、同名混淆、缺标签、缺成功终态、退出0但原生失败分别保留原退出码与编排原因，回退即时停止且首因粘滞。原生警告、init/assistant/result 各通道按当前格式采集；不明 modelUsage 仍只作计费键。不得将请求值/配置声明复制成生效身份。

### 3. 只读权限与配置叠加真实验收

使用可丢弃仓库与唯一 canary，成对运行原生可执行控制臂和候选审核臂：Read、Glob、Grep；Write、Edit、Shell；子代理及其工具；本地无害 MCP；指向本地 loopback 的网络工具；其它在工具目录实际暴露的执行入口。控制臂只在隔离夹具允许无害行为，不接真实服务、不读取真实敏感路径。审核臂只开放读/搜所需最小工具；拒绝以调用 ID、真实调用参数、匹配执行层错误、目标前后状态配对，工具未暴露而无法触发拒绝的必需项仍未测/阻塞，不冒充拒绝证据。

路径覆盖同行原稿/审查/裁决及新产生文件、敏感夹具、临时凭据；覆盖 Read/Grep/Glob、目录列表、绝对/相对/双斜杠/符号链接与可见路径的绕过。生产禁读集合调用现有注册表派生枚举，不手写角色名单。对敏感凭据用假 canary 负对照，不能让模型触碰真实 key。共享 skills、project/user/local settings、CLAUDE/AGENTS 类上下文、SessionStart/PreToolUse Hook、插件和 MCP 各做有哨兵的正负对照，验证候选隔离配方不会额外加载执行能力；不能仅以 init 工具列表或静态配置断言生效隔离。

按实际轨迹形成 TraceCapability：读路径可提取性、调用与拒绝配对、终态/取消等。没有拒绝事件就不能把 rejectionRecorded 写 true。若轨迹不足以核验同行泄漏或写事件则保持准入阻塞；不得为通过而降低证据下限或把失败侧成功计票。

### 4. 生命周期与故障证据

复用 Node AbortSignal、进程组终止、ps lstart 身份核对与临时目录设施。覆盖准备/启动失败、自然成功、厂商失败、超时、用户取消、SIGTERM 不退出后强杀、worker 失联回收；核验主/子/辅助进程退出及凭据清理。每项分别记录原始 code/signal、spawned、停止原因、清理错误与残留；清理失败不覆盖原始模型/运行事实。真实 CLI 的必需生命周期项与可控 executable 故障注入分别标识，后者不算原生能力验收。未触发或无法观察项保持未测。不得杀全局/身份不明进程。

### 5. 准入绑定与生产接线

建立组合级准入事实：平台、CLI 版本/入口指纹、official/custom 路线、provider 声明/modelID/可信回读约束、原生来源与隔离配方、工具/路径/级联/生命周期各必需证据的完成状态及证据哈希。仅消费完整、匹配且新鲜的验收，来源/版本/模型变化即失效。注册表继续为 Agent 差异唯一来源；通用层消费能力与绑定，不新增散落 Agent 字面量。

在完整准入之前维持生产拒绝。若有组合全部通过，才将 Qoder 注册为可按条件选择的审核者，并在预检、worker、adapter 三处拒绝不匹配组合；不能因全局 criticEnabled=true 让未验收路线可用。默认三审配置不变。另建无害夹具，以 Qoder 加两家已准入审核者运行真实三审，保留真实覆盖/轨迹/模型/计票/gate 证据；这不替换本主题 gemini/glm/claude 的固定计划审/代码审。若无组合完成准入，不运行伪生产三审，报告整体阻塞及逐项缺口。

### 6. 同步、审查与正式 verify

同步主设计、协议、types/Schema 当前形状与身份二段校验、AGENTS 契约说明、核心 SKILL、必要入口源/渲染、注册表对账、开发日志、项目实施状态、测试报告/README 和不可覆盖证据索引；历史 v1/v2 与历史失败证据不重写。报告区分计划、实现、真机验收、代码审、自动化、生产启用、Windows；没有证据的格子写未测。

自动化覆盖官方兼容、Custom 歧义和失效、脱敏/白名单加载/全局 hash 不变、流回退退出0、缺回读、进程/清理以及真实两进程交接篡改；不降低既有契约断言。先跑类型检查与定向测试。代码按命令 A 固定三家送审，全文读取并逐条裁决、落实接受项，必要时依循环重审。最后必须执行 .trivium/bin/trivium verify --topic 本主题，保留失败产物和原始退出码。正式 verify 通过只说明配置命令通过，不能冲抵原生准入缺口。无法达到准入则交付已验证部分和阻塞事实，不宣称全流程目标完成。

## 收口判据

Custom 首个真实样本的最小隔离正对照、模型身份冻结/失败链路，候选 official/Custom 各实际准入组合的全部必需只读拒绝/隔离/轨迹/生命周期证据，组合绑定拒绝与真实三审链路，固定三家代码审逐条裁决及正式 verify 全部完成，方可判该平台组合完成。Windows 仍单列未测，未通过组合保持拒绝。若官方原生机制不具备必需可观察能力，明确报告阻塞，不替换验收定义。

