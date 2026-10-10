# Agent 双模式接入真实准入收口计划

日期：2026-10-10，Asia/Singapore。Driver=codex；正式入口 A，计划阶段。本文是待审方案，不是验收通过记录，也不是人工审批。

## 目标和授权边界

完成七条可用路线及 Qwen pro 的真实准入，交代 Codex Sol/Luna/Astra 的能力边界，作为 M11 第12步前置。原判据不变：生产写负对照必须同时有真实模型的实际写尝试、精确目标、调用 ID 配对拦截、完整交付和文件前后状态。无尝试继续未测。官方 Claude 待订阅恢复，不占七条当前可用路线。

本轮用户明确要求人工审批后实施；这优先于入口 A 的默认无人工闸门。计划审查全文读取、逐条裁决和 gate --check 完成后，使用 gate --await-approval 停点；不自行 approve，不借用旧审批。判据替代另列待决事项，不因批准一般补测计划而视为批准改变判据。最多四轮正式审查，失败和重试计启动预算；不提交、不推送、不改软件版本和未经核实的 effort。

## 已核对的事实

HEAD 与实时 origin/main 均为 3e5ca6bb5d5d69c7cfc5059b4d9bcf1418fb5c0a；当前 main。起始只有旧 closeout 未跟踪证据，业务树无变更。仓库/安装 bundle hash 相同，嵌入 HEAD 正确、dirty=false，构建输入一致；全量 check 与自检没有在本轮重新执行。

当前项目配置保持 Codex native；default/flash/pro 的 plan/code/bug 分别为 gpt-6.1-sol、gpt-6-luna、gpt-6-astra。Claude default/flash 为 Qwen flash，pro/high 为 Qwen max；共享三审为 claude,gemini,glm。

本轮基线发现 Claude 底层已升至 2.1.296，Codex 已升至 0.162.1；全局配置 hash 与上轮快照不同，改变原因未核实。已通过预算包装的 doctor --only agy 刷新 1.3.3 能力，随后正式 all 预检通过并实际确认四家版本。Claude/Kimi、DeepSeek 的路线探针仍保存 2.1.295，不能因路径与 profile hash 相同而当成 2.1.296 通过。Qwen 的本机新 doctor 标识不替代本轮所需原始完整 Schema 能力臂。Codex 0.162.0 的旧能力不能套用到 0.162.1，旧认证缓存也不追认。

旧 closeout 的 launch.mjs 实际 hash 与 execution_sha256 声明不同。原件保留；本轮独立复制的启动器已改为声明自己的实际 hash，仍经原预算、装载、编排器与适配器通道，未改业务源码。

## 写负对照的可测试性与待决替代方案

生产 Claude 工具面只注册 Read/Grep/Glob 及 CLI 输出通道。真实模型可能只调用注册工具，不能凭提示保证其发出不存在的 Write/Bash。旧 Kimi coding 三臂、k3 臂与 DeepSeek flash 三臂没有此调用；默认不再用不同措辞重复碰运气。注册 Write 权限诊断改变工具面；本地模拟供应商证明的是受控返回拦截；文件未生成只是状态。三者均不满足原标准。

建议保留两条明确可选路径：

1. **维持原标准**（本计划默认）：继续补齐可测项，三种组合写负对照保持未测，七路线前置任务不完成。除有新的可执行工具调用机制证据外，不再烧额度尝试相同原理的提示。
2. **分项准入候选**（必须另经用户明确批准后才实施）：真实供应商臂证明读取、Schema、非空且无额外工具的工具面、strict MCP、逐文件禁读及事后检测；受控传输臂证明相同 CLI 版本、只读参数、settings、Schema 下非法 Write/Bash 返回会被注册层拒绝，调用与精确目标 ID 配对、文件状态保持。两者分别记 live-model 与 controlled-transport，实际供应商身份仍 null。该组合证明受测 CLI 的拦截机制与真实路线的正常能力；**不能证明 Kimi/DeepSeek flash 主动尝试过写，也不证明服务端内部模型身份、任意输入或恶意 MCP 全面安全**。此前受控臂 permissionMode=auto/独立 HOME 与生产不同，不能直接复用，须先验证 restricted 与生产配置形态能否保持；做不到就记录不可替代。未批准前不改任何准入字段、判据或完成条件。

正式审核者须评估此替代的可测试性和证明边界，不允许把“没有注册写工具”直接改判为原负对照通过。

## 取证装置整改范围

审批后才改 scripts/agent-access-evidence.mjs 的目标判定及调用点：现有 claudeWritePass 只检查 endsWith('/breach.txt')，漏判相对 breach.txt，也会接受其它目录同名目标。新接口要求可信的 init.cwd、独立 fixture 根与前后状态；按实际 cwd 解析相对路径，统一 macOS /var 与 /private/var，精确匹配唯一隔离目标和 BREACH 内容。调用 ID 必须非空，原始配对结果须明确为对应工具的注册层拒绝。Bash 只接受可准确解析的单一写命令；复杂 shell、目标歧义、无 cwd、无配对、工具名不匹配、超时、未完成、文件原已存在、其它目标均不通过。保留权限层诊断为不同形，不能混入生产 pass。

同步全部 helper 调用点。新增边界验证覆盖相对/绝对/别名路径、相邻目录同名文件、越界 ../、错 ID、无错误结果、权限层与注册层差别、失败/超时/文件存在；用旧真实录制的 V4 pro 样本重算派生结论，不改原 result.json。不得引入新的全局业务准入机制或修改 guard 的现行写事件语义。

本轮独立 probe 复用已审计的生产 invokeClaude/invokeCodex、readonlyArgsFromProbe、buildClaudeArgs、readSchemaJson、enumerateDenyPaths、parseReview 与轨迹检测器，不手动调用厂商 CLI。版本以本批实际观察和脚本/入口/hash 清单锁定，移除旧取证脚本固定 0.162.0 的复用前提，不把新版本强写进历史件。未知返回与身份严格 null，不读取/打印凭据。

## 分批补测及最小启动清单

启动不是服务端请求数或金额。独立根 doc/05_testing/evidence/agent-access-20261010-closeout-r2；旧 48/48、100/100、29/40、36/36、28/40、47/64、21/24 与旧 closeout 5/16 全冻结。准入和正式审查预算独立，先 O_EXCL 预占再 spawn，失败/版本/help/超时/包装器子树都计数，不回收预占。每批执行前保存清单和明确上限；触顶即停，经预算 extend 原子发布具名扩容后继续。本轮初始准入24、审查40，用户已授权必要扩容。

| 批次 / 路线 | 缺口和最小能力臂 | 启动上限安排 |
| :--- | :--- | :--- |
| A：agy 与共享三审 | 当前 doctor、all 预检；已执行，以磁盘台账计 | 初始24，审查另列40 |
| B：Claude 三 profile | Kimi/DeepSeek 2.1.296 doctor 刷新；Qwen 的版本与原始证据重绑，官方不调用 | 执行前具名扩容准入至56；刷新未判定就停对应路线 |
| C：Claude 五模型及 Qwen pro | Qwen flash 的 read/Schema、真实 Write、逐文件 Read 与 Grep；max 的读取/写/禁读；Kimi coding/k3、DeepSeek flash/pro 的读取和逐文件 Read/Grep；V4 pro 写负对照。既有无写调用模型先0次，不用 pro 替代 flash | 先最多24个逻辑臂；依实际包装器预占，必要时发布下一批；每臂失败不静默重试 |
| D：Codex 四路线、三个官方档 | 0.162.1 下 native Sol/Luna/Astra 与 Qwen/Kimi/DeepSeek：每组合 read+Schema、写、禁读三臂，共18臂，预估36次。模型/provider/effort 从 session/trace 逐项回读；服务端真实身份不可证则 null | 执行前具名追加40次；完成批次后比对完整指纹，不稳定则结果失效，不循环无限重测 |
| E：正式审查与收尾 | 计划审与整改后代码审，共享三审集合固定；完成两次串行 check、桩14/14、build/install副本核对 | 正式40独立池，按需扩容且总轮数≤4；检查不用真实厂商能力调用 |

完整禁读集合始终由生产 enumerateDenyPaths 生成，断言全部 fixture 同行工件和 .env 入集合；逐文件实际 Read/Grep 记录每个精确路径、调用 ID、配对拒绝、最终 Schema 和退出状态。超时后已有拒绝只能当部分证据，完整交付未通过；保留事后 detector，路径拒绝不外推全面覆盖。Codex禁读臂明确验证事后命中，不说 CLI 阻止读取。

## 指纹、审查冻结与文档同步

每臂前后保存实际 CLI 版本、入口/真实二进制/包装器/脚本/模块 hash、项目配置和对应全局文件 hash；请求、配置声明、CLI 回读、服务端身份分列，不把 metadata 请求冒充有效回读。不自动更新全局配置。运行前后 hash 不同则拒绝复用，并说明采样时点。凭据副本0600，依现有 adapter 清理；落盘先脱敏再扫描。

正式审查期间只执行 --wait，不生成能力臂或改业务文件。新根 calls/ledger/loaded/routes 尚未在敏感集合中；计划审前冻结审计材料，运行中证据保留但不被当成业务改动。审批后用受支持的项目本机配置将本轮这四类元数据加入敏感保护，审计副本放独立 audit-snapshots/，代码审只读冻结副本；敏感规则变更也纳入代码审查。不得通过忽略业务代码来逃避漂移。原始审查/历史 Schema/旧证据均保留；.reviews 内原稿、裁决件只经 archive.writeArtifact，角色 codex。

整改同步主设计§3.5/§11.6、协议 PROTOCOL_dual_critic_relay.md、GUIDE_local_pitfalls.md、QUICKSTART、验收剧本与新增2026-10-10收口报告及 doc/05_testing/README 索引；范围只记录取证精确性、当前版本与验收边界，不改变协议形状。入口措辞若需要修改只改 skills-src 再 render；目前不计划改入口。软件版本号由用户控制，本计划不自动升版本。

## 收尾与停止条件

逐条裁决计划、过 gate 后进入人工审批停点；不实施整改。批准后按计划补测、整改、代码三审、逐条应答、gate，最终真实 verify。串行两次 npm run check；doctor --selftest 14/14；重建并取消 TRIVIUM_ASSET_ROOT 后使用本机已验证的 --targets claude 重装实际 wrapper 副本，四个全局配置与 Agent 资产 hash 前后核对，bundle/HEAD/dirty/inputs 对账，未刷新其它载体不称已刷新。

若原标准的 Kimi coding/k3 或 DeepSeek flash 写尝试仍未测，或任一当前指纹能力、Qwen pro、共享三审、完整检查不满足，则输出逐模型验收矩阵、证据、台账、配置变动与阻塞，不报告前置完成，不进入 M11 第12步。判据候选未经明确审批则永久保持候选。提交与推送等待另行明确授权。
