# Agent双模式接入真实准入收口：第9次补测机制与证据边界计划（r13送审稿）

2026-10-11，Driver=codex，原主题不变。本稿是已完成七条整改及第8次有效代码重审之后的完整后续计划。末尾逐字附存r12历史全文，其中“未批准/未安装/总8”等仅属原采样时点；当前操作以本正文为准。原生产准入标准始终有效。本稿批准不等于采用任何替代判据。

## 1. 当前基线与七条已完成整改

main已提交并推送f63e339f938bd7bca1d5c22f19be101d626a7e66，本轮开始工作树干净。最终运行bundle848445c9609aa6758b9580e95b6aa5d614090d18487ec534d6e57bb80520474e，安装输入885a12a5d043d5e79c3d2736b25b7db8a64bb08d6a770ee7b779de46636602bc；embedded旧head/dirty是构建时采样，不能覆盖实际提交/清洁状态，也不为了改元数据盲目重建。此前两次串行check均3137通过/3跳过/0失败，桩14/14，四目标安装及28专用入口一致。共享七入口已按获批方案备份并可恢复迁移，备份保留；客户端实际发现和其他仓库完整依赖面仍未测。

| code-r2历史意见 | 当前已实现及验证 | 本轮保留要求 |
| :--- | :--- | :--- |
| CLAUDE-01 | 真实项目sensitive_globs排序去重JSON/SHA256绑定目录事实/消费，夹具替换前取值，配置/TTL/路线/入口失配逐文件回退 | 不借补测取消这些绑定 |
| CLAUDE-02 | 3924条真实非敏感回放、8根3908覆盖及24逐文件，来源/集合hash及相邻合法路径/原数组不变 | 2290只保留历史数量，不改fixture或旧件 |
| CLAUDE-03 | peer_deny_applied防御合取和生产接线注释已纠正 | 分项守卫不是模型能力证明 |
| CLAUDE-04 | 无可消费事实0次二进制读，同精确路径本次1次、不同2次、下一调用重读 | 不加跨运行缓存，性能收益未实测 |
| GLM-01 | is_error与permission_denials独立变异，缺/错/重复权限及配对负例 | 不放宽唯一ID和精确配对 |
| GLM-02 | 仅ASCII根1—5段、后代0—2级v2实测事实消费 | 中文/空格/逗号等目录前缀逐文件，特殊文件名不外推 |
| GLM-03 | 已定义外部/夹具失败保留主probe，清空目录事实、脱敏失败和清理；未知内部错误抛 | 不扩大catch吞内部错误 |

另经独立第7次计划审查批准，SENSITIVE_SCAN_MAX_PARENT_DEPTH=7，根0、父8未覆盖；.git/node_modules排除，目录软链不跟随，匹配软链自身照原glob；同行归档无此深度上限。第8次C/code run20261011T005041Z三家有效结构化审查、逐条裁决及本轮委托审批已完成。原subject_drift/readonly_breach/引用问题失败件均保留，不恢复资格。

## 2. 路线×实际模型×缺口×复用范围×必要新增启动

当前显式variant2共38臂，完整指纹全部兼容；矩阵6通过/6未测。以下是最小清单；“0”表示没有已核实新机制，不付费换提示，不将正确首词代替实际读取。

| 路线 | CLI实际模型 | 当前原标准缺口 | 可消费与历史适用范围 | 本计划初始必要新增准入启动 |
| :--- | :--- | :--- | :--- | :--- |
| Claude/Qwen flash | qwen3.8-flash | 无，正向/Write实际拒绝/Read及Grep六目标完整 | 当前全指纹证据；旧Grep超时单列 | 0 |
| Claude/Qwen max | qwen3.8-max | 原生产写未测 | 当前读/Schema/Read及Grep有效；没有旧实际写样本可补判 | 0；仅候选被独立批准且同形基准齐备才受控1臂 |
| Claude/Kimi coding | kimi-for-coding | 原生产写未测；Read .env未尝试，完整deny=false | 当前Grep六目标/Read同行五目标；旧FBB .env实际Read可作具名历史分项，当前缺口保留 | 0；候选受控1臂；Read新配方必须机制先行 |
| Claude/Kimi k3 | k3 | 原生产写未测 | 当前Read/Grep六目标实际精确拒绝已补齐 | 0；候选受控1臂 |
| Claude/DeepSeek flash | deepseek-flash | 原生产写未测 | 当前Read/Grep完整；无旧实际写样本 | 0；候选受控1臂 |
| Claude/DeepSeek pro | deepseek-v4-pro | 本次无Write/Bash实际调用，原写未测 | 旧FBB有实际Write配对拒绝，不能自动搬入当前完整指纹 | 0；作为新增候选范围单列受控1臂 |
| Codex官方Sol | gpt-6.1-sol，CLI high | 无 | 当前原标准通过；服务端身份null | 0 |
| Codex官方Luna | gpt-6-luna，CLI high | 本次无command_execution，写未测 | 旧FBB有实际写/OS拒绝/状态；当前口头拒绝及无文件不补判 | 0；有新机制再单列1臂，不属Claude候选 |
| Codex官方Astra | gpt-6-astra，CLI high | 无 | 当前原标准通过；服务端身份null | 0 |
| Codex/Qwen | qwen3.8-flash，CLI medium | 无 | 当前精确单cat README解析/完整输出及实际写拒绝通过 | 0 |
| Codex/Kimi | kimi-for-coding，CLI max | 无 | 当前原标准通过 | 0 |
| Codex/DeepSeek | deepseek-flash，CLI high | 无 | 当前精确单cat读取及实际写拒绝通过 | 0 |
| 官方Claude | null | 订阅未恢复，未测 | 不挪用profile证据 | 0，待订阅恢复 |

Codex deny表示事后实际读取命令检测有效，不冒充CLI禁读拦截。请求/配置声明/CLI回读/服务端身份分列，后者全部null；Claude provider/effort无回读为null，已有Codex effort回读不新增默认值。原H5/5/2、FBB6/5/1、新6/6/0各按采样保留。

## 3. 补测机制与保守实施范围

首先零CLI分析src/trivium/adapters/{claude,codex}.ts、probes/{claude,codex}.ts和scripts/agent-access-closeout.mjs的实际参数/取证配方。当前adapter未提供强制具体工具调用接口，仅是本仓事实，不外推厂商CLI没有任何机制。DeepSeek pro未注册Write仍曾产生越界Write，不能把未注册解释为不可能尝试。当前Kimi主动跳过.env、Luna主动拒绝且无命令必须分别解释。

如源码/已有help显示一个尚未验证的官方机制，先保存准确旗标来源、生产同形与其改变项、预期轨迹/配对及夹具、版本兼容和硬上限，再经现有doctor/adapter验证；不手工调用厂商CLI，不改工具注册/沙箱/权限/effort来制造“生产同形”。没有这样的机制则保持未测，禁止反复改提示。新增未获本轮计划覆盖的guard语义改动仍须独立正式资格及审批，不借本次重审预算实施。

业务正常整改限：test/unit/agent-access-recovery.test.ts历史总8案例改读不可变v3授权fixture并显式传入纯核验函数，实时读取壳单列核v4总10/9B/10C；历史7/8拒绝和旧guard hash保留。当前权威切换使原动态硬编码总8用例不再适用，本次尚未修改测试，不称当前全check通过。新增静态取证/适用性脚本及真正必要负例测试，不能改生产canonical原列的断言。BRIEF如需运行时深度披露，只在既有第8段追加本已有规范7/8边界，不增段、不扩域；实施前同步设计原型/协议/手册并以契约验证。

## 4. 有限组件证据适用范围候选（未采用准入）

旧FBB与当前848唯一精确build-stamp声明之外编译字节相同，规范化hash48db71dfdc76716b038b39904e513d9a2e2aedcbac07c880b4e3e216f74ba2ec；38对请求/CLI/profile/model/effort/入口/native/config/canonical/thin不变，完整指纹仅bundle资产项不同，Claude20 production-shape逐字相同。但安装输入不同，coreSKILL文档变化是否影响模型上下文不能由编译字节证明；本证据不得升级为全上下文相同。

拟实现独立只读适用性ledger（scripts/agent-access-applicability.mjs与必要测试），输入显式旧/新selection及各文件hash，不选择“最新成功”，不回退缺失臂。仅给有限具名分项：旧Kimi .env Read、DeepSeek pro Write、Luna写OS拒绝；原始完整bundle SHA和采样时刻永远并列。核原件完整hash/actual模型/唯一调用ID/实际cwd精确目标/拒绝/状态、CLI/native/入口/包装器/配置、生产规则/Schema/工具面/提示hash及TTL。TTL沿已有被消费事实类别规则，不随意把目录TTL套全部能力；若某类原无TTL，记录原无TTL及未知漂移，不宣称永续。

构建戳匹配须两个bundle各唯一精确声明、严格全量其余字节hash，任何额外差异拒绝；不能任意删注释/空白/版本字符串。缺component inventory或上下文资产消费证据、模型/规则/配置漂移、缺实际配对、最新泄漏/真正拦截失败等一律not-applicable/unknown。新无尝试可与历史样本并列，不能覆盖新采样。仅允许采样时刻机制证明的具名历史引用为正常文档行为；若用来补当前准入，必须另行明确批准“component-scoped-evidence-v1”，机器输出criteria_version/approval_record/source/current_full_fingerprint/differences/applicability/reasons/current_original_status；批准缺失永远不accepted，原write_pass/deny_pass及canonical全指纹要求保持。

当前证据不足证明全部模型上下文一致，候选可能无法消费；遇此结果不降低条件，也不因此准入。即使有限复用获批，也不能补四个根本没有实际写样本的Claude组合。

## 5. 受限工具面准入候选（未采用）与独立决策

将原四Claude范围与新增DeepSeek pro分开审查，五组合逐个评估，不扩至Luna/Kimi Read。保留三列：A生产真实注册工具面/只读argv/空MCP及正向Schema读取；B同完整当前指纹、同工具面/权限参数的受控精确Write输入、唯一ID对应CLI拒绝/cwd目标/前后状态；C实际模型生产写，继续原标准、无尝试未测。

采用候选的先决条件：A/B均当前有效实测，额外工具/缺init/受控配置不同形/缺配对/泄漏/清理失败均unknown或false；其他正向与完整禁读也须满足。实际Kimi .env缺口不能被写候选掩盖。B只由现有canonical受控传输/adapter执行、独立临时夹具、脱敏并扫描，不能将受控模型响应叫真实主动调用；不输出或改用户凭据/全局配置。预计五个受控逻辑臂，各Claude包装器/native按实际计2启动，共10；另当前工具面/版本刷新是否必要按指纹差异逐项列，发布批清单后才启动。

若Bob另行明确采用“restricted-tool-surface-v1”，独立评估ledger写restricted_admission而不改原production_write字段；matrix同时显示original_status及alternate_status，M11 readiness只有审批覆盖范围且A/B/其他项齐备才可按新标准另算，原标准仍显示未测/不满足。能证明受测生产曝光工具面与受控CLI拒绝，不能证明模型主动写、抗诱导、任意/未来渠道安全或服务端身份。撤销批准、任一CLI/配置/工具面/完整指纹变化即不消费alternate；保留所有证据并恢复仅原标准。

计划审查、逐条裁决、gate及一般委托plan审批后，提交具体审查修订后的两项独立选择给Bob：有限复用是否准入采用；受限工具面新状态是否计入M11前置。**本次总10轮授权和一般自动审批均不批准这两个判据**。取得另行明确答复前不实施判据消费、不补当前通过列、不宣布M11可进入。若均不批准，就完成获批普通整改及第10完整重审，同时保留准入阻塞；新机制真实样本可得则按原标准取证。

## 6. 正式机制、预算、冻结与审批

原生无专用轮数例外接口；沿用既有已审任务级current-authority壳。v4完整hash绑定用户独立“授权总10轮，先正式计划审查再代码重审”，v3pointer逐字另存，旧授权/launcher不改，新launch-v5仅切v4。task/archive已启动8次ID严格一致（含失败），9B/10C、Driver codex、Claude/Gemini/GLM固定；无allow-single，超过10/孤儿/不可读/重复/旧权威拒绝，13项零CLI核验已落盘。

第9批review103/108→具名扩容15至123；预计15硬20（通常preflight5+formal5），达到批/池上限先停再发布扩容。admission547/563，本次plan无新准入启动。未来准入候选五受控各2预计10，外加有依据的版本/工具面刷新另算；启动前发布确切argv路线/逻辑臂/包装与native/失败超时等、硬上限及累计池上限。预算不等金额、独立于formal10。旧976预算原件hash连续，O_EXCL新预占/结束，不清零覆盖。

全静态材料、脚本hash、报告与上下文落盘后resolve原用户焦点、preflight参数逐项同组，再正式第9B。运行中不改任何业务/被审证据，仅编排器及既有budget产生元数据；所有warning/progress原样播报。读三家全文，逐条裁决；接受均落点并archive唯一出口写完整r14定稿，gate0→await→按用户本轮自动审批委托approve（不含判据批准）。失效不得approve，不重写失败或删漂移文件。

## 7. 获批实施、完整复审与交付

普通整改和独立批准判据（如有）实施前先并入唯一设计规范、ADR003、协议、手册/剧本、测试报告及索引。入口措辞改skills-src后render；历史Schema/原审查/旧证据保留，归档仅archive.ts。业务版本/软件版本不自动变更，现有模型配置/effort保留。

按受影响范围定向测试，串行两次npm run check、桩14/14、最终build及四目标重装、运行副本/28入口/input/full指纹/事实消费核验；源码或资产改变时逐项重估当前38臂适用性，不盲目全量重跑、不用本候选绕正式审查只读与完整指纹。判据若未批只允许原标准结果。第10次C/code相对39ed20530d64a72f81f183095c6d9516632d0228完整diff覆盖七整改、深度、后续普通及候选实现、所有launcher/授权/ledger/tests/docs；静态审计和报告先落盘，settings≤131072、skipped0、真实目录facts与最终安装匹配才spawn。必须三家有效完整意见、逐条裁决及本轮委托code审批，旧审批不替代；失败保留且不擅自第11。

用户已授权自动提交/推送当前分支，逐文件暂存、Conventional中文及Edit by CZB，不跳hook、不amend/force，远程核hash。交付逐路线×实际模型矩阵、七整改及检查、有效本轮审查/审批、证据与启动账、配置/安装/未测/失败/阻塞；七条可用路线、Qwen pro、共享三审、必要检查和新增官方边界全部符合**已明确批准的标准**才报告可入M11第12步。官方Claude待订阅、client发现未测、服务端null不能隐藏。
