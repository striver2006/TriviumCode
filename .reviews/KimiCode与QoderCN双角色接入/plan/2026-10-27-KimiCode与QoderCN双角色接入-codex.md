# Kimi Code 与 Qoder CN 双角色接入计划

日期：2026-10-27（Asia/Singapore）  
Driver：codex；入口：dual-run / A；主题：KimiCode与QoderCN双角色接入。  
状态：计划送审稿，尚未实现或进行能力验收。

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
| 写入 | 仅在可丢弃夹具放开的单独控制臂证明 Write/Edit 能写 canary | 同一动作在生产限制组合下实际被拒，前后 hash 不变；没有调用尝试不能记为拒绝有效 |
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
6. 三档模型路由接入已有配置解析。若纯配置表不能表达动态默认，新增通用可选适配解析契约并保持既有优先级；明确写入请求快照的已解析模型与来源，worker 必须核对同一值，不自行重解析为不同默认。不能在核心按 kimi/qoder-cn 分支。
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
