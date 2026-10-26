# 相对上一轮的改动

- AGY-01、GLM-06：明确 vendor、label、模型族与 L2 登记边界。
- AGY-02、AGY-03、GLM-04：明确配置形状、内存合并、旧配置和显式选侧。
- GLM-01：默认模型在探针期绑定，增加 probe_default 请求来源，定义快照与漂移核对。
- AGY-04、GLM-03：定义单 Agent 多载体的可选扩展模型、分发与命令提示。
- AGY-05：补三阶段镜头具体侧重。
- GLM-02：拆分工具面裁剪与权限拒绝证据，坚持负对照要求。
- GLM-05、GLM-07：固定 Windows 真实审核者前置，补逐客户端界面步骤单。
- GLM-08：登记 Hook 已知误拦的标准操作出口。

以下保留完整计划并增加已裁定实施细则；§7 是对上文对应条款的细化，冲突处以 §7 为准。

# Kimi Code 与 Qoder CN 双角色接入计划

日期：2026-10-27（Asia/Singapore）  
Driver：codex；入口：dual-run / A；主题：KimiCode与QoderCN双角色接入。  
状态：第 1 轮审查后的完整实施计划；尚未实现或进行能力验收。

## 1. 目标、范围与当前事实

按用户完整任务目标增加 `kimi`、`qoder-cn`，归档后缀同 id，意见前缀为 `KIMI`、`QODER`。两家均可显式担任 Driver 和只读审核者，只支持官方原生路线。保留产品默认 Driver、默认审核者、审核者数量上限及禁止自审规则。既有配置、审查归档与运行契约兼容，禁止把请求值当作回读。

每个平台验收五个 Driver 入口：Kimi 官方 CLI、Kimi Code 桌面端、Kimi VS Code 插件、Qoder CN 官方 CLI、Qoder CN 桌面端。Qoder CN IDE、VS Code/JetBrains 插件、移动端不在范围内。两家审核者只能通过官方 CLI headless，由编排器发起。

本轮初始工作树干净；流水线 128 个主题没有未关闭闸门。S0.5 入选 `gemini,glm`，S0.6 全阶段预检通过；不擅自增减集合，计划审/代码审均最多 3 轮，无 allow-single。Driver 模型/供应商声明均 null；模型族未知告警不改变闸门。plan 已认领 codex。

本机只读版本核对：Kimi CLI 2.3.0（`~/.kimi-code/bin/kimi`），Qoder CN CLI 1.1.79（`~/.local/bin/qoderclicn`，帮助自称 Qoder CLI CN），Kimi Code 桌面端 1.1.1（`com.kimi.code.desktop`），Qoder CN 桌面端 0.4.11（`com.qodercn.app`），VS Code 1.143.1，`moonshot-ai.kimi-code` 插件 0.8.3。已安装不代表成功验收；CLI 身份、原生服务路线、模型仍须单独取证。

依据：主设计 §3.5、§5.1.1 七件套、§7.4.1、§8.2、§10、§11.1、§11.5/11.6、§16.2；`GUIDE_env_setup.md`、`GUIDE_codex_development.md`；当前源码 `agents/registry.ts`、`adapters/base.ts`、`adapters/index.ts` 与套件 overlay。

## 2. 能力取证前置与阻塞准则

先完成本计划审查、裁决和 gate proceed，再认领 code。实现期第一批只构建受控夹具取证装置及新探针，未有能力证据前不启用生产审核适配。帮助和官方文档是候选参数来源，不是能力结论。

官方资料（2026-10-27 查询）：

- https://moonshotai.github.io/kimi-code/en/customization/agents ：主 Agent 自定义文件、工具 allowlist、执行前再次检查。
- https://moonshotai.github.io/kimi-code/en/configuration/config-files ：独立 `KIMI_CODE_HOME`、default_model 与权限规则。
- https://moonshotai.github.io/kimi-code/en/customization/skills ：技能扫描、共享读取目录、调用方式。
- https://docs.qoder.cn/cli/permissions ：tools 与路径权限规则。
- https://docs.qoder.cn/cli/config-scope ：CN 用户根 `~/.qoder-cn`，项目根 `.qoder`。

资料与本机版本存在差异时以实测为准，记录差异，不把旧 kimi-cli 的 Python/YAML 实现当成本机 kimi-code 2.3.0。Qoder 文档出现 qodercn，而本机二进制为 qoderclicn，须记录真实可执行文件、版本与 hash，不推断是同一个入口。

### 2.1 受控夹具

在独立临时 Git 夹具建立普通源码、中文和空格路径、嵌套目录、同行原稿/裁决/元数据模拟件、`.env`、凭据样式文件及可用时符号链接。所有敏感内容均为随机哨兵，不读取真实秘密做负对照。夹具外另建受控 canary；既测精确路径也测目录、相对/绝对/规范化路径与搜索命中。记录初始/结束清单和 sha256。真实凭据仅用于认证，最小复制至 0600 隔离副本，目录 0700，不进入证据归档。

执行通过仓库适配/探针模块和 Node 子进程公共设施，不手工调用现有审核者 CLI，不启动新 Agent 对本计划/代码进行绕过编排器的审查。Node AbortSignal 管理时限与 SIGTERM→宽限→SIGKILL，Windows 走现有平台进程树机制；进程身份沿用启动时刻校验。

### 2.2 必须独立通过的能力矩阵

| 项目 | 正对照 | 负对照与通过要求 |
| --- | --- | --- |
| 读工具 | Read、Grep、Glob 实际读取普通 canary，含中文/空格路径 | 精确同行文件、目录子树、敏感文件、运行/凭据根不能返回内容或命中片段；搜索根不能绕开文件 deny |
| 写入 | 仅在可丢弃夹具放开的单独控制臂证明 Write/Edit 能写 canary | 按 §7.6 分离工具面裁剪与权限拒绝；须有对应机制的真实负对照及前后 hash，不能只凭无写入通过 |
| 执行工具 | 受控无害 Shell 动作与子代理/外部工具控制臂确认能力面 | 生产只提供必要 Read/Grep/Glob，Bash、Write、Edit、Agent/Swarm、MCP、网络及外部执行均关闭；口头拒绝不算限制证据 |
| 隔离 | 各自读己方任务和项目普通文件 | 不能读同行输出、另一侧运行目录；禁止借全局技能/项目插件/Hook 重新加载执行工具 |
| 轨迹 | 回读工具名、调用 id、参数、结果、cwd、路径及终态 | 非零退出、断流、缺结果、缺事件、截断必须保留并失败；不能从回答文本伪造读取记录 |
| 模型 | 本机目录/配置明确解析默认模型；显式覆盖实跑 | 请求、配置声明、模型回读分开；无回读 null/unknown；非官方/自定义 provider 拒绝 |
| 取消清理 | 正常退出清理临时凭据 | 超时、用户取消、启动失败、失联回收及异常退出均验证；等待进程树停止才清理，不误删用户根 |

正反对照按工具、路径形状、平台、版本、模型组合分别记录。实际能力不足、模型无法解析、权限不支持路径 deny、搜索泄漏、轨迹不能审计、无法隔离项目执行扩展时阻塞该侧，保持 fail-closed，不采用提示词只读降级。任何安全准入失败不得用另一侧成功替代。

### 2.3 候选调用形态（必须探针证实）

Kimi：`--agent-file` 指定自包含主 Agent，tools 只含 Read/Grep/Glob，subagents 空集合；独立 KIMI_CODE_HOME 下最小原生配置与拒绝规则，`--skills-dir` 指向空目录；`-p` + stream-json。不用 auto/yolo 绕过权限。核对权限规则是否真正覆盖三种读工具、顺序优先级、共享根/项目配置与插件的实际加载，不能仅凭 agent frontmatter 白名单推断路径隔离。

Qoder CN：独立 `--config-dir`，`--tools` 精确白名单，必要 allow 与禁读 deny，`--permission-mode dont_ask`，空 strict MCP 配置、受控 setting sources，`--no-session-persistence` 与 stream-json。禁止 bypass_permissions 和 dangerously-skip-permissions。实际 argv 以探针结论保存并消费，不把帮助声明当 verified。

模型默认解析只读取所需非敏感配置/目录项。Kimi 从 default_model 指向的原生 managed provider 条目解析；Qoder 从 CN 配置或实际目录的默认标记解析。具体来源/字段在探针后定稿，没有明确默认标记则报配置缺失，不填猜测的 auto/k3 等名称。default/flash/pro 各阶段使用同一解析值；显式 model 覆盖优先，仍验证官方目录/路线，不支持第三方 profile。默认模型变化须新探针及能力绑定，不能复用旧模型证据。

## 3. 实现落点与兼容契约

### 3.1 七件套与默认行为

1. `src/trivium/agents/registry.ts` 新增身份、vendor、CLI 名、前缀、后缀、显式可选开关、L2 与技能读取根/调用约定。`defaultSelected:false`；保持 DEFAULT_DRIVER 与既有默认集合、最大数量，新增项不导致默认 doctor 无条件调用未安装 CLI。
2. `adapters/kimi.ts`、`adapters/qoder-cn.ts` 与各自 trace/home 辅助模块；`adapters/index.ts` 单点接线。只在能力证据达标后启用；availability 必须绑定平台、可执行文件/版本/hash、模型、权限形状、隔离结论和有效期，未测平台不得沿用 Mac 结论。
3. `probes/kimi.ts`、`probes/qoder-cn.ts`；doctor 接入、原生认证探活、版本/目录、工具与路径负对照、截止时间/重跑提示均走当前协议。类型/schema 追加新 vendor 的形状；身份校验仍由注册表，schema 不枚举 id/意见前缀。
4. `skills/dual-critic/lenses.yaml` 新增两侧独立镜头，沿用动态选择，不能替代机械安全隔离。
5. `skills-src/carriers/` 新载体定义及必要契约/片段泛化，再 `npm run render` 统一生成全部入口。不手改生成物；四条任务入口和 approve/status/abandon 共七个入口全覆盖。
6. 三档模型路由接入已有配置解析。按 §7.3 新增通用可选默认解析契约并保持既有优先级；明确写入请求快照的已解析模型与来源，worker 必须核对同一值，不自行重解析为不同默认。不能在核心按 kimi/qoder-cn 分支。
7. `types.ts`、`config.v2.json`、配置默认/迁移与 probe 类型更新。新 Agent 配置为可选；旧四家配置不用补新段即可运行。旧 run/review/verify schema 保持只读兼容，新数据走现有 v3 形状扩展允许的字段，必要新增字段须对应 parse/meta/gate/协议对账。

### 3.2 安全、轨迹与清理

消费现有冻结生成的禁读矩阵，不手工维护角色名单；投影到各 CLI 权限规则前验证可表示性，无法编码即阻塞。权限清单不能删项以适应长度限制。副本不带用户 Hook、插件、MCP、共享技能与自定义命令；仍须验证实际客户端是否绕过副本回读真实 HOME。项目 AGENTS/规则自动加载对敏感读取与插件注入的影响也取证。

逐事件解析 tool call/result，去重、关联成功/拒绝、区分目录搜索参数与实际命中路径。模型字段必须是可追溯回读，CLI 参数回显只记请求。TraceCapability 与 commandExecution 按实际生产限制组合确定；rejectionRecorded 不得因猜测设 true，无法满足用户要求的拒绝/轨迹验收则不启用。

正常及异常结果保留执行退出码、timeout/cancelled、已采轨迹、覆盖率 null/0 区别。复用运行目录清扫与 scrub 接口，记录副本路径清理的结果，不修改/删除真实供应商账号根。清理失败显式报错并给出可复核路径；输出脱敏凭据与认证字段。

### 3.3 安装、卸载、查重

注册表登记客户端专属根与共享读取根；`src/install.ts`、entry-render、entry-collisions 通过描述符派生新目标，保留现有安装目标默认行为。只安装本次授权入口，不修改全局模型、账号、供应商配置；卸载只删除安装清单管理的文件，不删用户其它技能。

逐客户端实测：技能发现目录及优先级、七条命令唯一性、正文参数是否替换/原样转抄、带单引号/美元符/旗标正文、cwd（含中文空格）。Kimi CLI/桌面/插件可能不共享同一二进制或技能语义，分别记录，不能推导一致。跨客户端同名 dual-* 冲突先诊断，不能自动删除既有他家入口来让检查通过。若客户端实际不支持独立入口且会选错 Driver，报告阻塞并保持未验收。

## 4. 实施顺序与检查

P1：计划审，读取全部意见、逐条接受/驳回/暂缓并写理由落点；每轮产出完整下一版计划，gate 按 next_action 推进，人工停点立即停。

P2：认领 code；先把拟变更契约并入设计对应章节及协议（仅文档修订号按项目规则，不自动修改 package 产品版本），实现受控探针装置，执行 Mac 两家能力矩阵。能力未通过不得启用审核者。随后按已验证事实完成适配器、配置路由、注册和入口安装；修订计划中的具体事实必须回填证据。

P3：自动化测试、Mac 客户端验收和 Windows 待验收材料均可独立推进；安全阻塞项不跳过。代码审前完成应纳入 diff 的实现/文档/报告/脚本，并记录未测项。不把测试报告或审查件伪装成审核者产出。

P4：同一 `gemini,glm` 集合代码审，base HEAD（本轮不提交）。每轮写 response，逐条裁决，仅修接受项，gate 决定重审/继续/人工停点。不擅自批准或扩大轮次。

P5：`npm run check`、`doctor --selftest`、正式 `verify --topic`。必要构建后安装本次运行时和入口，取消指向仓库的 TRIVIUM_ASSET_ROOT，检查 wrapper 实际路径、版本/build 标记与 bundle sha256，确保验收基于本次产物。审后修代码必须按规则重审，不能以测试通过替代审查。

### 自动化测试清单

- 注册表/schema 全目录身份对账、两新增 id 的含连字符 argv 与归档名字解析、禁读矩阵/保护后缀、动态镜头。
- 默认集合和上限不变、禁止自审、新项仅显式选入、旧配置迁移/旧工件校验、未知身份/错误 vendor 拒绝。
- 三档默认解析一致、显式覆盖、无默认报错、非原生拒绝、模型未知不猜测、父子进程 requested_routes 精确交接。
- 入口渲染零漂移、七命令参数/Driver、一致性、技能重复/共享根/中文空格路径、安装幂等与卸载不伤用户文件。
- trace 分片/重复/截断/失败、读与搜索路径、拒绝事件、覆盖率、模型请求/回读分离、未知工具执行失败。
- 真实子进程桩夹具跑 preflight→review→gate→verify，断言 stub 指纹；归档 O_EXCL 防覆盖、锁与计数；启动失败/超时/取消/失联/清理回归。
- `npm run check` 全量、已有 selftest；桩结果仅证明编排，不算客户端能力验收。

## 5. 客户端验收与 Windows 交接

### 5.1 每个平台各五个 Driver

每入口记录产品身份/版本/可执行路径或 Extension Host、技能清单截图/日志与文件 hash；使用隔离测试仓库完成 A/B/C/D 任务入口、Driver 身份、逐条裁决、B/C/D 人工停点及用户实际批准后恢复、status/abandon。A 使用正常自动流程并验证适用的人审边界；受控状态机夹具可验证最大轮次分支但不能冒充真实客户端已触发。

人工审批必须由 Bob 发起；本次 dual-run 不是对其它验收主题的自动批准。需用户操作时提供已准备好的主题、命令、预期状态，继续其它独立验收，不擅自填写审批记录。L2 验收证明技能遵循停点，不宣称 Hook 拦截写入。

Kimi VS Code 必须保留本机插件版本、Extension Host 日志/进程链、插件内实际发送技能后的命令记录、cwd 与 task/run 元数据对应；仅 code --list-extensions、CLI 调用、静态源码或文件存在均不足以通过。桌面客户端同理须从对应 UI 发起，不能终端代跑后截图冒充。

### 5.2 Windows 材料

交付 Node 可复跑验收脚本与 PowerShell/Git Bash 启动说明（计划落点 `scripts/acceptance/kimi-qoder-cn/`），Windows 专用用例覆盖原生 executable/.cmd 调用、中文与空格路径、路径规范化、进程树取消、临时凭据 ACL/清理。禁止要求 Bob 上传认证文件或未脱敏全量日志。

每个 case 输出结构化 manifest：case_id、OS/架构、客户端/CLI 版本与 hash、路线证据、请求模型、生效模型及来源、工具参数/拒绝事件、退出码、超时/取消、前后 canary hash、脱敏轨迹 hash、截图索引、执行时间、结论与原因。pass/fail/未测 三态；缺字段为 null，不默认为通过。正反臂可独立复跑且使用新运行目录，保留失败工件。

Bob 回传后核验版本/产物 hash 与本次构建一致、证据完整、正反臂同一约束、截图/日志/run 对应，再逐项登记。若环境不同，重新探针，不合并 Mac 证据。未回传前完成可独立工作并交付材料，Windows 两家审核者和五个 Driver 逐项“未测”，整体需求尚未完成。

## 6. 文档与交付状态

同步主设计/系统设计说明书、需求说明书（边界映射）、PROTOCOL、AGENTS 契约说明、开发指南/本机坑、开发日志、使用/部署手册、测试报告、各目录 README 索引；中文交付文件不增加“稳定版”前缀。报告分别列实现、计划审/代码审、自动化、Mac 五个 Driver/两审核者、Windows 五个 Driver/两审核者、剩余阻塞，给出可核验证据路径。

完成判据是上述全部要求分别有证据，不以构建/桩/单端结果替代。外部客户端能力或账号阻塞时如实停在对应项，不能宣称双角色完成。未经另行授权不提交、不推送、不正式发布。


## 7. 第 1 轮裁定后的实施细则

### 7.1 注册身份与模型族

kimi 的 vendor 固定为 moonshot，qoder-cn 的 vendor 固定为 qoder-cn；label 分别为 Critic-E · Moonshot Kimi Code、Critic-F · Qoder CN。归档 id/前缀保持用户指定。新增 AgentVendor 类型与历史 VENDOR_MODEL_FAMILY 的完备项；Kimi 匹配已确证 kimi/k 系列，Qoder 名义族使用永不匹配规则并注明仅历史兼容，不把产品当模型家族。现役三态比较只消费实际模型标识；Auto、私有 ID 与无法确认的回读均 unknown。MODEL_FAMILY_RULES 已有 Kimi 规则，按真实返回格式规范化或补足，禁止凭空造 qoder 模型族。

两家均 guardLevel=L2、hookConfigTarget=null，不安装自称兜底的 Hook。instructionFiles 与 criticReadsInstructionFiles 须由客户端/审核者独立探针确认后登记，不能猜 AGENTS.md 兼容即有效。尚未取得对应证据时不宣称 Driver 可交付。

### 7.2 配置形状与旧项目

两支 AgentConfig 分别为 {vendor:'moonshot', bin?:string|null, tiers?:Partial<Record<TierName,{model:string}>>, default_tier?:TierName} 与 {vendor:'qoder-cn', ...相同字段}。vendor 必填，bin 省略/null 表示官方 CLI 发现；非空必须是可调用原生入口并核验身份。schema oneOf 以 vendor const 判别、additionalProperties:false；不接受 profile、readonly_enforcement:prompt-only、任意 permission 参数。首版没有已验收 effort 覆盖时不接受新侧 effort，不能静默忽略。共用 TierFields 如需类型兼容，校验仍收紧新侧实际支持字段。

defaultConfig 增加两份最小 {vendor} 段（bin 可省略）；不写猜测 profiles 模型。现有 loadCtx 从 defaultConfig 起逐源 mergeConfigLayer，旧项目文件缺新增键时运行时自然继承；这不是磁盘迁移，绝不重写存量 config.yaml/config.local.yaml。保持显式配置优先级、默认审核者集合和三侧上限不变。不放松 resolveCriticSelection 的缺段校验；直接传构造配置对象缺段仍报错，错误附最小配置示例。正式 loadCtx 的旧项目路径必须有集成回归。

使用手册给出最小 agents 片段、显式 --critics 与 doctor --only、默认模型解析来源及显式覆盖写法；缺模型时明确提示补官方默认/覆盖并重探，禁止静默挑目录第一项。doctor 未显式选新侧时，对未安装的新侧跳过并报告未测，不破坏旧项目全量 doctor。

### 7.3 动态默认模型契约

新增可选纯适配钩子 defaultModelFor(cfg): {kind:'resolved',model:string}|{kind:'missing',reason:string}。只消费已经落盘的 probe.cli.<cliName>.native_default，不读盘、不触发 CLI；未实现钩子的旧适配器行为不变。

探针保存 native_default 的 model、source（config/catalog-default）、解析来源非敏感指纹，以及平台、入口/hash、版本和能力证据绑定。Kimi 原生配置当前解析为 kimi-code/kimi-for-coding；此值只是本机观测，不写成内置常量。Qoder 当前保存模型 ID 对应自定义项，不能直接继承；官方目录虽列出 Auto，但仍需确认其默认语义和原生路线，不能按目录顺序猜。无法明确解析即 missing。

通过通用参数/调用层将纯钩子结果交给 resolveTier，基础选择优先级保持 cli.tier → profile 格子 → agent.default_tier → native_default；最终 cli.model 覆盖仍最高。显式无效引用/空格子不回退到默认。default/flash/pro 均没有专门模型值时用同一个 native_default；新增 profile 缺席问题按现有 active_profile 校验处理，并提供显式三档配置示例，不凭空复制旧侧 pro。

TierSource 追加 probe_default；run.v3 requested_routes.tier_source 与当前审查产物相关 schema、types、parse/meta/gate 与 PROTOCOL 同步。历史 v1/v2 文件及 schema 原样保留，不给旧件补写。worker 使用父进程冻结的实际请求模型与来源逐项核对，不重新选择。启动前的 availability/authProbe 核对当前官方配置/目录来源指纹和平台/版本/hash；默认值或来源变化时返回 fix:doctor，已测否定结论不得标成可自动修复。显式覆盖也必须有对应模型/平台能力证据，不能套用默认模型准入。

补测：默认缺失、配置漂移、来源改变而模型同名、版本/平台改变、命令行覆盖优先、默认三档一致、用户显式空值、取消/失败保留请求、worker 交接漂移拒绝。

### 7.4 多载体安装模型

仍为每家一个 AgentId，不按宿主复制身份。先逐载体取证；全部共用技能根、正文语义和调用写法时直接沿用现有单值模型。若不一致，采用注册表可选 driverCarriers 列表，元素包含 carrierKey、entrySkillRoot、entryInvocation、instructionFiles、extraReadRoots、argumentMode；现有单值为 CLI canonical fallback，旧四家字段不动。carrierKey 属载体键，不是新 AgentId。

渲染器载体源可显式引用 agent+carrierKey，产物落 entry/<agent>/<carrierKey>/<command>；单值旧路径不变。安装计划按描述符展开，物理根相同且内容相同去重，根相同而内容不同直接报冲突，不覆盖。CLI/Desktop/VS Code 额外根只在实测确认后登记；额外只读根不能擅自转成安装根。卸载与查重遍历同一计划，保持所有权判定和备份边界。

entryCommandOf 新增可选 carrierKey，未指定时使用 canonical fallback；未知实际宿主时消息同时列该 Agent 的合法调用写法并标明载体，不能假装知道当前 UI。入口正文按自身载体渲染精确语法，并显式 driver 同一 AgentId；无需修改 run.v3 的 driver 身份。参数正文按实际替换/转抄语义选择。无法获取独立技能加载证据或安全分发方案时阻塞该载体，不借别家根凑数。

instructionFiles 只注入实测读取的规则文件；同物理文件协议块去重，真实审核者是否读取规则与 Driver 分别判断。Kimi docs 当前宣称 /skill:<name> 及 KIMI_CODE_HOME/skills、共享 .agents/skills，均须在 CLI、桌面、Extension Host 各自核对，不能直接推广。

### 7.5 镜头

Kimi：plan 关注用户意图到步骤的歧义消除、默认行为可解释性、人工操作链可执行性；code 关注输入文本与参数的语义保持、提示/回读是否误导用户、交互状态衔接；bug 关注用户动作与实际执行的分离、最小反例与隐藏前提。

Qoder CN：plan 关注能力开关与落盘证据是否匹配、上线/禁用的可操作性、依赖装配顺序；code 关注控制面配置到真实子进程的绑定、观测信号是否足以审计、客户端与运行时版本一致性；bug 关注跨进程证据缺口、配置来源溯源、错误传播可定位性。镜头仅侧重，不声称真实意见不会重叠；保留现有 Jaccard 观测。

### 7.6 工具裁剪与权限拒绝的双证据

生产两家均仅提供必要读/搜索工具。裁剪臂必须拿到实际有效工具面回读、并证明执行分发也拒绝未提供工具：使用真实 CLI 的受控调用/事件注入接口（若官方有）或模型实际未知工具调用，配对成功的放开工具控制臂。只有清单没有 Write、或模型口头拒绝、或前后没改文件均不足以证明强制限制。若真实 CLI 无可触达的受控拒绝验证方式，则该项未测并阻塞启用；不以实现源码推理、SDK 桩或父层拦截替代客户端执行限制。

路径 deny 臂在 Read/Grep/Glob 实际可用的同一生产工具面执行，被禁路径须有真实拒绝事件/错误及不可泄漏 canary，目录搜索逐命中核查。Write/Edit/Bash/Agent/MCP 单独正反对照不接触真实敏感数据；可用的控制工具只在一次性隔离夹具开启，生产配置始终裁剪。

TraceCapability.rejectionRecorded 根据生产形态的真实事件决定。false 可如实记录，但不能用这一字段豁免用户要求的轨迹完整性与限制有效验收；若关键机制无法证明则仍阻塞。无调用的负臂结论为未测，不判通过。

### 7.7 Windows 前置与步骤材料

Driver 正式验收固定真实 gemini,glm 审核集合，需 Bob 的 Windows 机安装并登录对应官方客户端、Git for Windows、Node >=18，完成两侧 doctor 和相同集合 preflight。任一侧不足则 Driver 任务闭环未测，不自动减侧/用桩代替。新增 kimi/qoder-cn 审核者能力另行独立真实取证；禁止其审核自己。

交付五入口逐客户端步骤单：每个从打开隔离项目、查看完整七技能、输入准确调用、核参数/cwd/Driver，到查看裁决、人工审批停点与用户恢复、status/abandon，每步标 case_id、manifest 字段和截图索引。两家桌面端分别成单；VS Code 明确 Extension Host 日志/进程与实际插件消息对应。同时给 PowerShell/Git Bash 命令、回收/取消步骤、脱敏检查、证据打包脚本和失败重跑方式。

桩端到端仅列自动化测试，manifest 必须标 stub/0.0.0，不计五个真实 Driver 通过数。Windows 回传前各未执行格逐项未测；Bob 环境前置不足时报告具体缺项，继续其它独立工作。

### 7.8 维护与证据边界

新增后缀会自动进入 Hook 字面集。保留原命名，不用改名规避启发式；涉及误拦用结构化写工具和 git commit -F 标准出口，并登记到本机坑/维护文档，不修豁免。

本轮两份审查原件的路径级 deny 均为 false，使用现有配置准入的任务书禁读+事后轨迹核验，两侧 evidence_ok=true、drift=false。该既有审核集合的机制边界照实保留；它不降低本次新 Agent 的强制限制验收要求。GLM evidence/consulted 结构告警保留，未改他方审查件。

