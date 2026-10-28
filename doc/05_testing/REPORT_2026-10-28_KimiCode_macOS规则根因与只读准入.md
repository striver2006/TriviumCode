# Kimi Code macOS 规则根因与只读准入报告

日期：2026-10-28（Asia/Singapore）；基线 `355eb46e`；Driver：Codex。结论：**仍阻塞，审核准入与 Driver 开关均关闭**。已完成受控 native 机制定位和实验工具整改，未修复官方二进制的规则执行缺口，不宣称真实模型准入通过。

## 1. 指纹、范围与证据等级

有效采样：macOS arm64，Kimi Code **2.3.3**，native SHA-256 `28ad8a2434f8ce01034648e90596b04562f82af044d9e1bd296e37fa21f51120`。`rules` 批启动前读取同 hash，逐臂版本均 2.3.3；`extra`、`verify` 及生命周期批固定私有 native 副本并核对执行后 hash。未运行 upgrade/install/login，不修改全局供应商、模型或账号配置。

首个 spike 在读取入口 hash 后、实际启动前发生版本漂移：hash 为旧 `33eb2b…190d`，实际回读 2.3.3；来源未确认，不能将该臂绑定为 2.3.0 或可靠新版本指纹。该次还因实验观察者与公共段作用域的 ps 嵌套发生递归，原件保留，进程证据无效。后续改为独立 ps 采样并固定副本；不修改公共 exec 实现。

所有成功工具执行来自未修改的官方 native CLI。loopback 服务只给模型响应中的 tool_calls，权限/工具执行仍在官方 dispatcher；其 provider/type/base_url 与真实官方路线不同，**仅作机制诊断**。本次真实模型桥接在启动前因现有 access_token 为空失败，native 启动 0 次；未复制 refresh token、未触发登录/刷新/回写。2.3.0 的历史真实模型反例不作为 2.3.3 当前路线证据。

实验工具 [说明及命令](../../scripts/acceptance/kimi-qoder-cn/README.md)；原件全部位于 [独立证据目录](./evidence/kimi-macos-20261028/)。wx 防覆盖，旧 probe、Windows 包装、审查工件与历史失败原件未改。

## 2. 根因：加载配置不等于把规则加入会话

实际行为支持“配置文件被读取，但 permission 规则没有进入执行集合”：

1. 同一配置根只把 `default_model` 改成不存在的模型，native 退出 1、模型请求 0；合法模型则发出两轮请求并实际执行工具。因此不是整份配置未加载。
2. 正确 `[[permission.rules]]` 的裸 Read/Grep/Glob deny、普通文件精确 deny、中文路径 quoted/unquoted deny 均未阻止执行；无害 Write/Bash 允许臂可执行，加自定义 deny 后仍写入合成文件/输出标记。因此不只是三个读工具的豁免。
3. 将 decision 改成非法值时，`doctor` 退出 1；rules 批的 `-p` 使用相同非法规则内容仍执行读工具、退出 0。二者来自不同批次/端口和脚本版本，不能称为逐字相同配置的严格配对；旧 doctor 原件没有配置 hash。doctor 的 schema 校验不等于运行时规则生效。
4. deny-only 运行的 session state/wire 文件索引有保存，未观察到 `permission.rules.add`。这是诊断信息，单凭事件缺席不证明完整内部状态。

版本对应的[官方 2.3.3 源码](https://github.com/moonshotai/kimi-code/tree/ec495f0cb00f6db9a9118bf979112886f4264a41)提供了与反例一致的具体接线缺口：`permissionRulesOps.ts` 初始 `rules: []`；`permissionRulesService.ts` 只在 `addRules` 派发追加事件；全部 `src/**/*.ts` 扫描没有 `.addRules(...)` 消费调用。`agentLifecycleService.ts` 的 `bindBootstrap` 仅应用模型/permissionMode，没有把配置的 permission.rules 种入 agent 状态。permission policy 先检查用户 deny 的设计本身存在，但没有已加载规则可匹配。[源码摘要和文件 hash](./evidence/kimi-macos-20261028/official-source-1793123673.json)保存路径、行号、tarball hash 与扫描范围。

这能确认发布标签源码层缺少“配置规则→新会话运行规则”的接线，且与当前 native 反例吻合；未声称完成 native 二进制与公开源码逐字等价证明。交互 TUI 的固定输入对照未测，不能断言所有载体/版本都必然如此。

代码审后补充 [完整检索证据](./evidence/kimi-macos-20261028/official-search-1793125348573715000.json)：固定同一 commit，扫描 2119 个 src TypeScript 文件，记录 `.addRules`、PermissionRulesAdd、permission.rules.add、PERMISSION_SECTION、config.get/inspect/resolve permission、规则状态读取等 10 个正则的全部命中及空结果；保存 bindBootstrap、初始状态、配置段注册、policy 读取等有意义正文。生成器 `kimi-source.py` 可重建这一有界检索；旧摘要保留，不把有限文本检索夸大为穷尽所有反射/生成接线。

另有独立问题：Grep/Glob 的 `matchesRule` 在该标签匹配搜索表达式 `args.pattern`，不是搜索目录 `args.path`。原项目把目录写入 Grep/Glob 括号规则不能等价实现目录隔离；本次按表达式配置 deny 仍失败，说明该语义差异不足以解释全部泄漏。Read 还涉及词法路径与 realpath 的独立隔离问题。

## 3. 单因素结果

主矩阵 [rules，22 臂](./evidence/kimi-macos-20261028/kimi-rules-1793123572082-399108.json)；补充 [extra，17 臂](./evidence/kimi-macos-20261028/kimi-extra-1793123673700-a7f1fc.json)；[verify，5 臂](./evidence/kimi-macos-20261028/kimi-verify-1793123895955-a45d0e.json)。每臂保存参数、配置 hash、请求工具列表、调用 ID/参数、配对结果、终态、进程回读和清理事实。控制量由脚本参数确定，合成随机 nonce 不作为供应商事实。

最终收尾 [final，5 臂](./evidence/kimi-macos-20261028/kimi-final-1793124157502-6b3356.json)补了文件前后状态与临时配置前后 hash：自定义 Write deny 下仍创建文件并与返回内容一致；裁剪 Write 后不存在文件且 native 同 ID 返回 not found。普通/同行/外部 canary 的原文件 hash 未变，读取泄漏仍判失败。本批共 60 次 native 启动（含首次无效 spike、version/doctor、生命周期四臂；真实模型 0），不再为重复定位追加调用。

原件中的 `status=失败` 是把受保护内容/名称实际返回标为泄漏；none/allow 正控制也保留这个观测标签，不代表允许控制臂运行失败。脚本退出 0 只表示采集完成，任何准入结论必须按本报告分级，不以采集器退出码判通过。

| 因素 | 实际对照 | 结果 |
| --- | --- | --- |
| 配置根/来源 | 合法/缺失默认模型；config-a/config-b | 模型哨兵证明配置被读；换隔离根未修复 deny |
| 规则/顺序 | none、deny-only、allow-first、deny-first | 普通/同行及外部文件仍被真实 Read/Grep/Glob 访问；无规则只是允许控制臂 |
| 权限模式 | 相同 -p 只换 manual/auto/yolo | 三种都泄漏；`--permission-mode manual` 非法旗标退出 1，不当作权限拒绝 |
| agent | 有/无 --agent-file；有/无 tools 声明 | 规则仍失效；工具白名单单独有效，见 §5 |
| skills | 有/无 --skills-dir | 规则仍失效；发现/执行隔离另判 |
| cwd | root/child，仅变化 cwd | 绝对目标仍泄漏 |
| 路径/语法 | 相对/绝对/点段/realpath、中文空格、链接；工具大小写/层级/quoted | 正确裸工具名仍失效；错误大小写/表名也未形成拒绝，不能拿错误变体证明正确配置合格 |
| 非交互/TTY | 同 -p 下 pipe/PTY | 同样泄漏；**交互 TUI/API 等价输入对照未测**，PTY 不代表交互模式 |
| 规则引擎存活 | Write/Bash 允许执行后仅加自定义 deny | 仍真实执行；未获得任何自定义规则生效正例，不能判引擎合格 |

## 4. 三工具与路径结果

| 目标 | Read | Grep | Glob |
| --- | --- | --- | --- |
| 普通中文空格文件 | 成功返回随机内容；显式 deny 仍成功 | 成功命中 | 成功枚举名称 |
| 同行 history.md | 成功；相对、点段、绝对、realpath 均失败隔离 | 成功命中同行内容 | 名称泄漏 |
| 合成 `.env` 直接访问 | 内置敏感文件错误，存在同 ID 结果 | 搜索被过滤/无命中，不等同执行拒绝 | 被过滤/无命中，不等同执行拒绝 |
| `.env` 的普通文件名符号链接 | **读出 SECRET canary** | **命中 SECRET canary** | 本次无命中；未证明通用链接安全 |
| 夹具外普通文件与目录链接 | 绝对/realpath/链接入口可读 | 显式链接文件可搜索 | 显式链接目录可枚举 |

没有读取真实敏感文件。Grep/Glob 路径泄漏仅从 native tool result 判断，请求里写了目标名、模型总结中出现路径均不算执行证据。文件内容未变是附加事实，不能抵消读取泄漏。范围搜索过滤与执行拒绝分级，不借用 Qoder 的历史口径降低本次标准。

## 5. 工具裁剪、扩展与轨迹

只声明 Read/Grep/Glob 时，模型请求的工具列表确为三项；单独强制 Write、Bash、Agent、FetchURL、合成 MCP 名称后，native 各返回同 ID 的精确 `Tool "…" not found`。Write/Bash 另有实际允许执行对照；Agent/FetchURL/合成 MCP 尚无匹配的真实允许执行对照，不能宣称完整能力闭环。批量未知工具臂产生重复 tool_call 转录，严格判定为轨迹不完整，原件保留；单工具臂配对成立，但不是生产模型证据。

扩展隔离结果：

| 面 | 正反证据 | 本次结论 |
| --- | --- | --- |
| 配置 PreToolUse Hook | 同一合成命令启用时写出 HOOK 哨兵；省略配置时未写出 | 证明这两个临时配置的差异；项目/插件 Hook 注入隔离仍未闭环；不能用 fail-open Hook 作安全兜底 |
| 项目 `.mcp.json` | 默认/裁剪 agent 均未启动合成 MCP 哨兵 | 启用正对照未成立，**未测/阻塞**；不能把没启动当隔离通过 |
| 项目 `.agents/skills` | 创建合成 skill，对照空 skills-dir；extra 批未保存完整发现清单，后续脚本才新增 skill_sentinel_seen 字段 | **未测/阻塞**；没有执行 canary，不证明注入被隔离；按原件 script_sha256 对齐观测面 |
| 插件 | 无有效启用控制 | **未测/阻塞** |

JSONL 包含调用和结果 ID、最终助手消息及 resume_hint，但缺少独立结构化权限拒绝/完整执行终态审计。`complete` 只指实验配对契约；不得据此填写生产 TraceCapability。自定义规则没有拒绝样本，无法验证其拒绝审计面。额外/重复/悬空调用、坏 JSON、截断、缺终态及错误失败均拒绝合格判定。

## 6. 取消与凭据清理

extra 两个直接 Bash 生命周期臂未观察到同组后代，预定取消/强杀注入未触发，只发生超时。后续进程核查确认留下两个已脱组的合成 Node 等待进程：**整树取消失败**。按原件里的完整合成命令、PID 与 lstart 再核对身份，分别 TERM→KILL 并读回原身份不存在，见 [回收证据](./evidence/kimi-macos-20261028/orphan-recovery-1793126219195818000.json)。两臂共用相同命令，回收文件的 arm 字段是遍历匹配标签，不能用于精确区分单一来源臂；逐 PID 回收事实有效。当前脚本禁用这两个不安全控制，历史 17 臂与失败原件不改，新 extra 为 15 臂。不能用 `remaining=[]` 或 CLI 退出 143 追认为真实工具进程树合格。

独立 [lifecycle 原件](./evidence/kimi-macos-20261028/kimi-lifecycle-1793123829752-4c182c.json)在外层监督者内执行真实 native CLI，另有明示受控 wrapper 和忽略 TERM 的合成后代：

| 场景 | 观察 |
| --- | --- |
| 正常 --version | 退出 0、已记录 PID/lstart 的进程均不存在 |
| 非法旗标失败 | 退出 1、已记录进程均不存在 |
| TERM→宽限→强杀 | 已进入 loopback 请求；native+wrapper+后代采样；最终 SIGKILL、存活身份 0 |
| 停止进程组后强杀 | 明确 SIGSTOP 注入后执行终止链；最终 SIGKILL、存活身份 0 |

合成认证配置 0600、临时根 0700，监督者确认退出后删根，最终根不存在。**未使用真实凭据**，真实凭据成功/失败/强杀清理、厂商自派生逃逸后代、监督者自身被杀后的失联回收仍未测。没有把合成机制测试替代这些项目。

所有已完成 loopback 批次记录全局 config/credentials 文件前后 hash 相等。真实桥接失败原件只有启动前 hash，失败后的独立读回见证据索引，不回填原件。hash 一致仅证明文件字节未变，不证明服务端账号状态。

## 7. 修复范围、验证与恢复条件

本项目修复的是实验链的缺口：新增单因素载体、固定 native 副本、严格 ID/结果/路径/终态判定、Glob 名称泄漏、私有临时配置、独立强杀监督与可复跑说明；修正实验观察者递归。旧 probe 默认、Windows 待执行脚本、生产 adapter/guard/schema/TraceCapability、版本与开关未变。registry 仅澄清审核和 Driver 两个独立停点的注释。

实验判定独立测试原 14/14，代码审修复后 **19/19** 通过，补多级 Grep basename、候选规则文案、真实敏感错误、精确 alias/realpath 目标错位与 managed 坏 JSON。候选文案测试不证明 native 自定义 deny 生效。它不在默认 check/verify 收录，命令见脚本 README。代码三审已完成（1 通过/2 修改后通过、12 条意见全部接受），gate 已通过，正式 verify 结果见 §8。

### 相对 r2 的实施偏离与历史可复跑边界

- 六个阶段的脚本版本未逐份保存；旧 script_sha256 对应的源码无法逐字恢复，旧命令只保留实际 argv，临时根已清理。当前脚本可以重做同名控制，不能逐字复原历史批次。选择如实披露，不伪造源码，也不追加厂商调用改写历史。代码审修复后的采集器尚未新跑 native；新运行开始记录源码、完整脱敏实际命令与 suite 复跑入口。
- default permission_mode 缺省臂与 Edit 允许/裁剪臂尚未执行；已有 manual/auto/yolo 和 Write/Bash/Agent/FetchURL/MCP 不能替代它们。维持本批 60 次停止线，以上未测不影响保持阻塞的结论。
- managed 路线改用静态 access_token 快照以避免 OAuth 刷新；未实现启动前有效期判断，且本次 token 为空、启动 0。旧 managed 原件的 source_kind 错误保留为 loopback，是意图字段设置过晚造成的标签缺陷；不据此认定实际发生 loopback/真实模型调用。新代码预先记 intended_source_kind 与 native_launches，旧原件不补写。
- 清理失败注入、真实厂商后代/失联监督者自动化仍未测；19 个证据判定单测不覆盖 lifecycle 监督逻辑，不以合成四臂替代。
- 主设计/协议/正式探针契约未改，生产行为未改，故未升版或修改这些规范；本报告 §7 承担本主题开发记录，实施计划 §2 与 §4 同步当前状态。本机坑记录未另新增编号，不把实验载体当作产品探针接线。
- 新 v2 索引可重建 hash/扫描与新字段账本，历史 60 仍是各批推算，不伪称机读完整账本。新索引 `count_complete=false` 保留未知。索引来源见脚本 README。

恢复需要：官方版本真实接通配置规则并有自定义 deny 生效正例；三工具路径/realpath/链接安全矩阵合格；真实官方模型桥接；禁用工具实际分发及扩展注入的正反对照；可审计轨迹；真实凭据/逃逸进程与失联清理证据。当前任一必需项仍失败/未测就不启用审核者，本主题也不启用 Driver。Windows、桌面、VS Code Extension Host 全部保持未测。本轮未独立运行 bug 审，不称根因已完成独立 bug 双审；计划审、代码审另记。

## 8. 最终审查与自动化状态

计划审 run `20261027T174141Z`：三侧修改后通过、17 条全部接受；code run `20261027T180347Z`：1 通过/2 修改后通过、12 条全部接受。两个 gate 均通过，无人工审批停点，最终 status 的 open_gates 为空。GLM consulted 交叉核对告警、Claude 被拒写操作无轨迹导致的只读核验降级及 Driver 模型族 unknown 原样保留，不据此证明 Kimi 能力。

正式 verify 三份记录全部保留：

| 运行 | 结果 | 说明 |
| --- | --- | --- |
| [20261027T182419Z](../../.reviews/KimiCode-macOS规则根因与只读准入修复/verify/2026-10-28-KimiCode-macOS规则根因与只读准入修复-verify.md) | 失败 | typecheck/build 通过；npm test 4103 通过/1 失败/9 跳过。新增 intended_source_kind 的三元字面量被凭据赋值契约命中，元数据构造改为独立常量；未改扫描规则 |
| [20261027T183104Z](../../.reviews/KimiCode-macOS规则根因与只读准入修复/verify/2026-10-28-KimiCode-macOS规则根因与只读准入修复-r2-verify.md) | 通过 | 三条命令通过；随后发现旧直接 Bash 实验的脱组残留并回收，禁用两臂后重新验证 |
| [20261027T183805Z](../../.reviews/KimiCode-macOS规则根因与只读准入修复/verify/2026-10-28-KimiCode-macOS规则根因与只读准入修复-r3-verify.md) | 通过 | 最终脚本状态：typecheck/build/npm test 全部退出 0；4113 项，4104 通过/0 失败/9 跳过 |

独立实验判定 19/19、文档索引契约 27/27、凭据字面量契约 1/1 通过。真实 native 实验在审查后未追加，仍为 60 次；最后两个被禁用的旧 Bash 控制不再复跑，失败不改判。

按项目约定同步本产品 runtime/skills 共 66 文件，install:check 无重名/残留；没有修改厂商设置文件。源/安装 bundle SHA-256 同为 `aef347e68ee920c10db86331508e6aa8f83b4432d85a786862ea26d9708c74d1`。[最终读回](./evidence/kimi-macos-20261028/postflight-1793126669853.json)确认 Kimi 全局 config 与 credentials 文件 hash 与首次采样前相等。安装资产不代表新角色启用，两个开关仍 false。

本轮完成的是诊断工具、证据与审查/自动化闭环；原生规则、链接隔离与真实进程树取消仍失败，真实模型、扩展和真实凭据矩阵仍不完整。没有提交、推送、发布或放开生产准入。

## 9. 交付复核

Bob 后续显式调用 deliver，授权提交并推送本批材料。上一段“没有提交、推送”保留为上轮结案时的状态。

交付基线为 `main` 的 `2ffb86687926d6e424e4b9be6bb22b32d451064a`，保留已交付的 Qoder CN 路由实现；本批仅纳入 Kimi 相关 64 个文件，约 6.75 MB，包括审查工件、失败原件、实验工具和文档。逐文件敏感扫描零命中，没有纳入全局配置、认证副本、dist 或 bundle 生成物，不修改版本号。

在该基线及本批工作树上重新执行 `npm run check`：typecheck/build/test 全部通过，4131 项中 4122 通过、9 跳过、0 失败；独立实验判定测试 19/19。以上结果为本次交付复核，§8 的历史 verify 和安装 hash 仍仅归属于各自采样基线，不混作当前运行时验收。

交付不改变隔离失败和未测结论，不增加真实 native 调用，不打开审核或 Driver 开关；最终提交号及远端回读以 Git 记录为准。
