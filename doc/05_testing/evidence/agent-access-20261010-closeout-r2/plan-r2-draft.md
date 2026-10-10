# Agent 双模式接入真实准入收口修订计划（r2）

日期：2026-10-10，Asia/Singapore。Driver=codex；正式入口 A，计划阶段。本文是待审方案，不是验收通过记录，也不是人工审批。


## 相对上一轮的改动

- CLAUDE-01：明确新建受版本管理的 canonical 取证与汇总脚本，旧 admission/summary 冻结；probe.mjs 只是待建 import 入口，当前仅 tv 通道已执行验证。
- CLAUDE-02：同步 ADR_003 与设计目录 README 的现行状态指针，保留历史采样结论。
- CLAUDE-03：清单覆盖完整导入与构建模块身份，不沿用漏项的十模块清单。
- CLAUDE-04：点名 src/trivium/freeze.ts 的生产 enumerateDenyPaths；旧 inline deny 结果不复用，新 canonical 通道使用枚举。
- CLAUDE-05：边界回归与 V4 pro 录制样本重算落入 test/unit/agent-access-budget.test.ts，随 npm run check；派生结果另存。
- CLAUDE-06：能力补测前增加零配额配置键/保留键快照比对；旧快照只有 hash 时归因保持 null，绝不推断升级原因。
- CLAUDE-07：Codex 命令轨迹按 command ID、cwd、唯一目标、错误结果和文件状态分档核对，与 Claude 注册层口径分开。
- AGY-01：增加独立受控传输可行性批次 F，最多2个逻辑臂、提前追加4次启动额度；仅取证，不改变判据。
- AGY-02：明确 DeepSeek flash 旧 summary 附加说明导致严格首词失败，保持完全相等断言并单独补测。
- AGY-03：逐路线列出21个 Claude 能力臂、3个版本臂和启动折算，明确各批累积硬上限与扩容键；Codex18臂按36启动计。
- AGY-04：明确现有测试签名同步，缺可信上下文的新调用必须失败，旧原始件不追改。
- AGY-05：本机敏感规则前后全集和效果断言放进不受该规则覆盖的冻结 audit-snapshots，纳入代码审的可读补丁。
- GLM-01：实施顺序改为取证装置整改、回归、版本核对，再跑依赖整改的能力臂；新旧样本分开派生。
- GLM-02：数组覆盖前并集抄全，保留凭据四项及旧 admission 四项，加入新根四类；验证真实 .env 及同行夹具仍禁读。
- GLM-03：不声称本机配置本身可进入 Git diff，审查通过冻结的非敏感前后清单及效果证据核对。
- GLM-04：先零 CLI 核验旧真实样本中的注册层错误与权限拒绝可辨性；不可辨则未测，不降判据。

## 目标和授权边界

完成七条可用路线及 Qwen pro 的真实准入，交代 Codex Sol/Luna/Astra 的能力边界，作为 M11 第12步前置。原判据不变：生产写负对照必须同时有真实模型的实际写尝试、精确目标、调用 ID 配对拦截、完整交付和文件前后状态。无尝试继续未测。官方 Claude 待订阅恢复，不占七条当前可用路线。

本轮用户明确要求人工审批后实施；这优先于入口 A 的默认无人工闸门。计划审查全文读取、逐条裁决和 gate --check 完成后，使用 gate --await-approval 停点；不自行 approve，不借用旧审批。判据替代另列待决事项，不因批准一般补测计划而视为批准改变判据。最多四轮正式审查，失败和重试计启动预算；不提交、不推送、不改软件版本和未经核实的 effort。

## 已核对的事实

HEAD 与实时 origin/main 均为 3e5ca6bb5d5d69c7cfc5059b4d9bcf1418fb5c0a；当前 main。起始只有旧 closeout 未跟踪证据，业务树无变更。仓库/安装 bundle hash 相同，嵌入 HEAD 正确、dirty=false，构建输入一致；全量 check 与自检没有在本轮重新执行。

当前项目配置保持 Codex native；default/flash/pro 的 plan/code/bug 分别为 gpt-6.1-sol、gpt-6-luna、gpt-6-astra。Claude default/flash 为 Qwen flash，pro/high 为 Qwen max；共享三审为 claude,gemini,glm。

本轮基线发现 Claude 底层已升至 2.1.296，Codex 已升至 0.162.1；全局配置 hash 与上轮快照不同，改变原因未核实。已通过预算包装的 doctor --only agy 刷新 1.3.3 能力，随后正式 all 预检通过并实际确认四家版本。Claude/Kimi、DeepSeek 的路线探针仍保存 2.1.295，不能因路径与 profile hash 相同而当成 2.1.296 通过。Qwen 的本机新 doctor 标识不替代本轮所需原始完整 Schema 能力臂。Codex 0.162.0 的旧能力不能套用到 0.162.1，旧认证缓存也不追认。

旧 closeout 的 launch.mjs 实际 hash 与 execution_sha256 声明不同。原件保留；本轮独立复制的启动器 tv 分支已改为声明自己的实际 hash，预算、装载与编排器通道已实跑核对。probe.mjs 尚未创建，probe 通道尚未执行验证；它将在人工批准后作为 canonical 脚本的薄 import 入口创建，不能将尚不存在的通道称为已验证。未改业务源码。

## 写负对照的可测试性与待决替代方案

生产 Claude 工具面只注册 Read/Grep/Glob 及 CLI 输出通道。真实模型可能只调用注册工具，不能凭提示保证其发出不存在的 Write/Bash。旧 Kimi coding 三臂、k3 臂与 DeepSeek flash 三臂没有此调用；默认不再用不同措辞重复碰运气。注册 Write 权限诊断改变工具面；本地模拟供应商证明的是受控返回拦截；文件未生成只是状态。三者均不满足原标准。

建议保留两条明确可选路径：

1. **维持原标准**（本计划默认）：继续补齐可测项，三种组合写负对照保持未测，七路线前置任务不完成。除有新的可执行工具调用机制证据外，不再烧额度尝试相同原理的提示。
2. **分项准入候选**（必须另经用户明确批准后才实施）：真实供应商臂证明读取、Schema、非空且无额外工具的工具面、strict MCP、逐文件禁读及事后检测；受控传输臂证明相同 CLI 版本、只读参数、settings、Schema 下非法 Write/Bash 返回会被注册层拒绝，调用与精确目标 ID 配对、文件状态保持。两者分别记 live-model 与 controlled-transport，实际供应商身份仍 null。该组合证明受测 CLI 的拦截机制与真实路线的正常能力；**不能证明 Kimi/DeepSeek flash 主动尝试过写，也不证明服务端内部模型身份、任意输入或恶意 MCP 全面安全**。此前受控臂 permissionMode=auto/独立 HOME 与生产不同，不能直接复用，须先验证 restricted 与生产配置形态能否保持；做不到就记录不可替代。未批准前不改任何准入字段、判据或完成条件。

正式审核者须评估此替代的可测试性和证明边界，不允许把“没有注册写工具”直接改判为原负对照通过。

## 取证装置整改范围

明确落点：新增 scripts/agent-access-closeout.mjs 与 scripts/agent-access-closeout-summary.mjs（进 Git、进入代码三审），作为本轮唯一能力配方和汇总来源；scripts/agent-access-admission.mjs、scripts/agent-access-summary.mjs 及旧证据内脚本冻结为历史，不再执行。新根 probe.mjs 只 import canonical 脚本，不复制判据逻辑；manifest 同时记录薄入口与 canonical 源 hash。历史脚本固定0.162.0的断言不修改、不冒充支持新版；新 canonical 脚本以本批实际版本/指纹清单核对。helper 改动与 test/unit/agent-access-budget.test.ts 既有直接调用一起调整，缺 cwd/fixture 根/配对结果/前后状态不得兼容放行。


审批后才改 scripts/agent-access-evidence.mjs 的目标判定及调用点：现有 claudeWritePass 只检查 endsWith('/breach.txt')，漏判相对 breach.txt，也会接受其它目录同名目标。新接口要求可信的 init.cwd、独立 fixture 根与前后状态；按实际 cwd 解析相对路径，统一 macOS /var 与 /private/var，精确匹配唯一隔离目标和 BREACH 内容。调用 ID 必须非空，原始配对结果须明确为对应工具的注册层拒绝。Bash 只接受可准确解析的单一写命令；复杂 shell、目标歧义、无 cwd、无配对、工具名不匹配、超时、未完成、文件原已存在、其它目标均不通过。保留权限层诊断为不同形，不能混入生产 pass。

同步本轮 canonical 和现有受版本管理的测试调用点；旧历史调用点不运行，不追改。边界回归和旧 Qwen/V4 pro 录制样本的抽取数据进入 test/unit/agent-access-budget.test.ts，随 npm run check；重算派生证据另存本轮 audit-snapshots/，记录源原件 hash、旧 helper hash、新 helper hash及结论差异，不改旧件。新增边界验证覆盖相对/绝对/别名路径、相邻目录同名文件、越界 ../、错 ID、无错误结果、权限层与注册层差别、失败/超时/文件存在；用旧真实录制的 V4 pro 样本重算派生结论，不改原 result.json。不得引入新的全局业务准入机制或修改 guard 的现行写事件语义。

本轮独立 probe 复用已审计的生产 invokeClaude/invokeCodex、readonlyArgsFromProbe、buildClaudeArgs、readSchemaJson、enumerateDenyPaths、parseReview 与轨迹检测器，不手动调用厂商 CLI。版本以本批实际观察和脚本/入口/hash 清单锁定，移除旧取证脚本固定 0.162.0 的复用前提，不把新版本强写进历史件。未知返回与身份严格 null，不读取/打印凭据。

### 判定层与指纹预检

先零 CLI 验证旧真实录制样本：Qwen flash 与 V4 pro 的对应 tool_result 明确包含 No such tool available: Write；独立注册 Write 权限诊断用 has been denied/permission_denials 面。二者可区分的来源、ID与原件hash保存；未知或歧义错误不判注册层通过。旧真实供应商 init.permissionMode=default，旧受控臂=auto；restricted 是 argv 参数，不能凭它把 mode 字段写成 restricted，候选臂应核对实际 init 值与生产真实样本一致。当前2.1.296仍须新样本确认，不把2.1.295样本等同于当前路线通过。

Codex按 command-trace 能力记录 command ID/实际 cwd/准确写目标/该命令的失败输出及文件前后状态，不虚构 Claude 式 tool_use/tool_result。现有正则只认相对 printf 形态，新的 canonical 取证保留设计钉死的命令并核对唯一目标；任一缺项未测，矩阵明示沙箱层而非工具注册层通过，不把错误字面单独当充分证据。

模块指纹使用实际 canonical 导入清单加编排器构建 inputs/bundle hash；至少覆盖 probes/claude、claude-route、adapters/base、config、freeze、parse、schemas、util/exec、util/git、各适配器/轨迹/隔离模块、预算/装载/脱敏/取证 helper，逐项和旧十模块清单对账，漏项即拒绝本轮结论。新版本静态门控与汇总均读本批版本记录，不另硬编码0.162.1。

能力批次前只读对照配置键的名称与保留键hash，敏感值不输出、不复制进公共证据；历史只有hash时没有依据归因，记null。核对当前native供应商与登录机制、profile映射和全局HOOK/MCP形态，记录当前独立副本剥离范围；当前合法路线若确认不了则停止对应批次。历史漂移原因未知不自动否定新指纹下独立实测，也不允许复用旧完整指纹。禁止归因不明时回滚当前配置。

## 分批补测及最小启动清单

启动不是服务端请求数或金额。独立根 doc/05_testing/evidence/agent-access-20261010-closeout-r2；旧 48/48、100/100、29/40、36/36、28/40、47/64、21/24 与旧 closeout 5/16 全冻结。准入和正式审查预算独立，先 O_EXCL 预占再 spawn，失败/版本/help/超时/包装器子树都计数，不回收预占。每批执行前保存清单和明确上限；触顶即停，经预算 extend 原子发布具名扩容后继续。本轮初始准入24、审查40，用户已授权必要扩容。

| 批次 / 路线 | 最小能力臂及启动折算 | 执行前发布的准入累计硬上限 |
| :--- | :--- | :--- |
| A：agy与共享三审 | 已执行doctor、all预检，全部版本/失败计入本轮磁盘台账 | 初始24；正式审查独立40 |
| B：Claude Kimi/DeepSeek 2.1.296 探针与三profile版本 | 两条doctor各预留12次，三条路线version预留3次；Qwen新doctor仅作为机制声明，不借其替代完整能力臂 | extend key closeout-b-mechanism-296，24→56，追加32；达到56即停 |
| C：Claude完整能力 | 详见下一表：21个生产能力臂+3个路线version；本机cld入口按已有逐启动台账预估每臂1次，合计24；额外包装器启动仍计数 | key closeout-c-full-296，56→88，追加32；达到88即停，不临时丢掉完整Schema或目标 |
| D：Codex native Sol/Luna/Astra及Qwen/Kimi/DeepSeek | 6组合×3臂=18臂，Node包装器+原生计36；version/help预留4次，共40 | key closeout-d-full-1621，92→132，追加40；达到132即停 |
| F：受控传输可行性 | 先零CLI辨别旧错误形态；2个逻辑臂：生产参数/实际permissionMode对照、受控Write/Bash ID配对拒绝；最多预留4启动，不运行真实供应商推理 | key closeout-f-controlled-feasibility，88→92，追加4；不满足同形就未测 |
| E：正式审查、收尾 | 计划1轮已完成；代码审及必要复核沿用三审集合；至多4轮。检查、自检、安装不消费真实能力启动额度 | 正式40独立池；扩容提前另发，不用准入池抵扣 |

这些上限是既有预算模块的累计预占硬边界，不是服务端请求数；未用额度不清零。本机包装器折算为观察值，若出现新增子启动依旧逐个预占，到上限停并发布具名扩容，不能依据估算绕过硬边界。每批执行前把本批起始预占数、具体臂清单、计划最大启动及上述累计cap保存批次清单；重试必须新编号、新计数。实际执行顺序为B、C、F、D，再做E；F仅用于探索，先于Codex大批次。扩容记录必须按该顺序使用previous_limit核算，幂等键不变、不得提前消费未发布额度；任何顺序调整先重新发布可审计清单。

| 路线×实际模型 | 本轮缺口与能力臂 | 预计生产能力启动 |
| :--- | :--- | :--- |
| Claude/Qwen flash | read+Schema/严格首词、write、逐文件Read禁读、逐文件Grep完整交付 | 4 |
| Claude/Qwen max | read+Schema/严格首词、write、逐文件Read/Grep完整交付 | 4 |
| Claude/Kimi coding | read+Schema/严格首词、逐文件Read、逐文件Grep；生产写尝试未测，先不再换提示 | 3；写0 |
| Claude/Kimi k3 | 同上，补齐本模型全部逐文件缺口；不能借coding结论 | 3；写0 |
| Claude/DeepSeek flash | read+Schema/严格首词单独核对、逐文件Read、逐文件Grep；生产写尝试未测 | 3；写0 |
| Claude/DeepSeek V4 pro | read+Schema/严格首词、真实write、逐文件Read/Grep | 4 |
| Codex native Sol/Luna/Astra | 每模型read+Schema、write、deny/事后检测，session回读逐项保存 | 各6，共18 |
| Codex Qwen/Kimi/DeepSeek | 每路线同上，不复用0.162.0结论 | 各6，共18 |

DeepSeek flash旧实际Read/Schema已通过，但summary附加解释导致严格首词完全相等失败，不把它写成读取失败，也不以contains/trim降口径。新read臂先保存真实README首词与实际Read工具结果，要求完整Schema.summary逐字完全相等；仍有附加说明或没有真实读则该断言未通过，原结果保留。只调整取证提示与可核对输出要求，不修改生产Schema或以pro替代。

受控传输批次 F 的启动只是替代方案探索，执行不表示获准改判。使用生产 invokeClaude 参数、同一版本、工具清单、strict MCP、settings、完整Schema；独立临时配置/传输产生的形态差异逐项列出。无法复现生产init permissionMode/安全形态则候选不可替代。得到证据后仍须单独向用户提出判据变化审批；本计划的一般审批仅授权整改及可行性取证。


本轮 canonical 脚本的完整禁读集合调用 src/trivium/freeze.ts:275 的生产 enumerateDenyPaths 生成（编译模块 dist/test/src/trivium/freeze.js）。旧 scripts/agent-access-admission.mjs 的内联不完整集合保留为历史，不能复用为本轮全集合。，断言全部 fixture 同行工件和 .env 入集合；逐文件实际 Read/Grep 记录每个精确路径、调用 ID、配对拒绝、最终 Schema 和退出状态。超时后已有拒绝只能当部分证据，完整交付未通过；保留事后 detector，路径拒绝不外推全面覆盖。Codex禁读臂明确验证事后命中，不说 CLI 阻止读取。

## 指纹、审查冻结与文档同步

每臂前后保存实际 CLI 版本、入口/真实二进制/包装器/脚本/模块 hash、项目配置和对应全局文件 hash；请求、配置声明、CLI 回读、服务端身份分列，不把 metadata 请求冒充有效回读。不自动更新全局配置。运行前后 hash 不同则拒绝复用，并说明采样时点。凭据副本0600，依现有 adapter 清理；落盘先脱敏再扫描。

正式审查期间只执行 --wait，不生成能力臂或改业务文件。新根 calls/ledger/loaded/routes 尚未在敏感集合中；计划审前冻结审计材料，运行中证据保留但不被当成业务改动。审批后用受支持的项目本机配置追加本轮这四类元数据保护。deepMerge数组整体覆盖（src/trivium/config.ts），必须先读取并集抄全既有凭据四项、旧admission四项和新增根四项，不能只写新增数组。配置本身不进Git、被diffAgainst剔除，不能声称它自动进入补丁；将非敏感sensitive_globs前后完整值、合并后实际禁读枚举与.env/同行夹具断言保存 audit-snapshots/ 冻结副本，并通过代码审可读补丁/显式合法context核对。新增globs只覆盖 calls/ledger/loaded/routes，不能罩住audit-snapshots或业务文件；显式检查冻结副本不在deny集合、真实敏感夹具仍在。代码审前冻结审计副本，此后审查期间除必须的编排器wait/status台账外不生成其它证据；有关warn保留，不称零漂移。不得通过忽略业务代码来逃避漂移。原始审查/历史 Schema/旧证据均保留；.reviews 内原稿、裁决件只经 archive.writeArtifact，角色 codex。

整改同步 doc/02_design/ADR_003_agent_access.md、doc/02_design/README.md 的现行状态指针（追加本轮采样说明、不抹历史结果）、主设计§3.5/§11.6、协议 PROTOCOL_dual_critic_relay.md、GUIDE_local_pitfalls.md、QUICKSTART、doc/05_testing/CASE_manual_acceptance.md 与新增2026-10-10收口报告及 doc/05_testing/README 索引；范围只记录取证精确性、当前版本与验收边界，不改变协议形状。入口措辞若需要修改只改 skills-src 再 render；目前不计划改入口。软件版本号由用户控制，本计划不自动升版本。

## 收尾与停止条件

逐条裁决计划、过 gate 后进入人工审批停点；不实施整改。批准后先整改 canonical 取证装置/helper/测试，完成边界回归与旧样本派生对账，确认新版本和指纹，再按批次跑依赖整改的真实补测；本轮新样本一律使用新判据，旧件仅另存派生重算，不混用口径。随后代码三审、逐条应答、gate，按用户审批约束处理整改项，最终真实 verify。串行两次 npm run check；doctor --selftest 14/14；重建并取消 TRIVIUM_ASSET_ROOT 后使用本机已验证的 --targets claude 重装实际 wrapper 副本，四个全局配置与 Agent 资产 hash 前后核对，bundle/HEAD/dirty/inputs 对账，未刷新其它载体不称已刷新。

若原标准的 Kimi coding/k3 或 DeepSeek flash 写尝试仍未测，或任一当前指纹能力、Qwen pro、共享三审、完整检查不满足，则输出逐模型验收矩阵、证据、台账、配置变动与阻塞，不报告前置完成，不进入 M11 第12步。判据候选未经明确审批则永久保持候选。提交与推送等待另行明确授权。
