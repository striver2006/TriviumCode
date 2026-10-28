# Qoder CN 官方模型路由与回退阻断实施计划

日期：2026-10-28。Driver：codex。入口：dual-run（A）。本计划尚未通过审查，不代表实现或准入完成。

## 1. 目标与范围

基于官方 CN 模型目录与原生配置解析 default、flash、pro，支持有效显式覆盖，启动前拒绝无效模型，运行中发现回退立即停止并判失败（包括厂商退出 0）。请求、配置声明、回读独立记录；Auto 只是一种路由标签，底层身份无证据时为 null/unknown。接入真实适配器及 requested_routes/worker 交接校验，不修改用户全局配置。

本任务对应既有双角色计划 P2；不提前开放 Qoder 的生产审核者准入、Driver 开关，不改变既有缺省 Driver/审核者，不把本任务当成 P3 严格只读能力验收。保留开工前的 Kimi 改动、证据及其他主题工件。未授权提交、推送。

## 2. 已核实的现状与官方依据

- 当前 `qoderclicn --version` 为 1.1.80；help 提供 `--list-models`、`--model`、`--config-dir`、`--setting-sources`、`--settings`、`--no-session-persistence`、`stream-json`。官方网页的命令名已写成 qodercn，不凭网页名字替换本机受测入口。
- 官方 CN [模型说明](https://docs.qoder.cn/cli/models) 明确 Default 仅 Auto，具体模型和权限以当前账号 `--list-models` 为准；不得搬用 Global 的分级模型，不从模型名猜 default/flash/pro。
- 官方 CN [配置顺序](https://docs.qoder.cn/cli/settings) 为内置、用户、项目 `.qoder/settings.json`、本地 `.qoder/settings.local.json`、显式 settings；目录信任影响项目配置加载。支持注释和环境引用，解析不支持的形态必须报错，不能静默忽略。
- 本机用户 settings 的非敏感 `model.name` 为 `bailian/qwen3.8-flash-tp`，不能把它冒充官方原生默认。只读取必要非敏感键及 SHA256，不复制完整设置或输出凭据。原生官方隔离路线与现有用户声明必须分开记录。
- `qoder-cn-model.ts` 目前只消费人工提供的 catalog，测试中的 cn-default/cn-flash 是合成样本；没有真实目录获取/解析和适配器。旧逻辑拒绝 Auto 默认并只扫 stderr，不能满足本任务。
- 已有真实反例 `doc/05_testing/evidence/kimi-qoder-cn-20261027-failure/qoder-cn-failure-2026-10-27T15-54-24-268Z-23e4a1e1.json`：无效模型告警后回退 auto、执行且退出 0。保留该样本，不覆盖。
- `review.ts` 写 requested_routes，`run-protocol.ts/rebuildContext` 重建时对比 model/effort/tier/tier_source/access；新增官方路由来源也必须冻结和逐项对账。

## 3. 官方目录、原生配置与三档默认解析

1. 增加 Qoder CN 目录/配置加载模块（放在厂商适配区域），实际执行受测 CN CLI 的 `--list-models`，在隔离临时配置根中只复制官方认证最小材料。记录时间、CLI 路径/版本/指纹、命令、原始退出码、目录输出 hash 与解析器版本；失败、空目录、歧义、截断/超时均不回退到手写模型清单。
2. 先对当前版本输出取证再实现严格解析器：保留官方默认路由项与具体模型项的类别，Custom/BYOK 不混入官方可用目录。模型名从真实输出取得，不硬编码官网示例名，不按名字推断官方性；输出不足以区分官方和 Custom 则阻断，不猜。
3. 原生配置解析只提取 `model.name` 及必要来源链；用户/项目/本地/显式值分别留来源与 hash，遇不支持的 JSONC/环境替换或信任语义拒绝并说明。执行路线明确使用隔离 settings + `--setting-sources user`，不暗中合并项目设置/用户 BYOK/MCP/Hook；记录原用户声明与隔离执行声明的差别。用户配置指定 Custom 时不得静默把它当官方，需明确拒绝继承；本次官方正对照使用单独隔离原生路线。
4. 官方没有 Trivium 的 default/flash/pro 三套默认，三档都绑定同一份已核实的官方原生默认；来源写“官方默认路由”或“已验证原生配置”，不能为省事填三个模型。Auto 可以作为 requested/declared 的标签，不能进入 model_effective 底层身份。配置缺失且不能证明官方内置默认时失败。
5. 显式 model 覆盖优先，必须来自本次官方目录。保留原始 override（可为 null）、实际发出的请求标签、配置声明默认、来源/指纹，三者不互相补写。无效值在模型进程启动前失败；有合法覆盖时仍保存配置声明，声明读取失败不装作已获取。

## 4. 冻结与真实适配器接线

1. 增加真实 `qoder-cn.ts` 适配器并纳入统一 wiredAdapter 表；注册表身份字面只留登记处，通用编排使用能力/可选钩子，不按 id 写分支。保持 `criticEnabled` 关闭，真实适配器可由受控测试/取证直接执行；生产选侧仍拒绝未准入侧。
2. 在适配器层提供准备原生路由的钩子，preflight/review 共用；冻结包含目录来源、CLI 版本/指纹、目录/配置 hash、默认声明、原始 override、请求标签、route kind 的快照。default/flash/pro 档位表与现有 low/medium/high effort 档位概念保持分离，不新增同名混淆。
3. `CriticRequest`、交接、run.v3.requested_routes 与结果增加可选原生模型证据对象。启动前写 requested_routes，worker 对请求和冻结记录逐项比对，缺失、替换、类型错误均拒绝；worker 不重新选择默认。执行前核验绑定的入口/配置/目录指纹，目录或配置变化失效后要求重新准备，不隐式刷新成另一组合。
4. 配置/探针事实只保存所需非敏感字段与 hash，不将完整用户设置或认证落到交接。run.v1/v2 只读契约不改、不补写。若扩展 Schema，同步 types/schemas/parse/gate/meta/report、协议、核心技能契约、AGENTS 与全目录 parity；报告可显示请求/声明/回读各自来源与未知值。
5. 真实调用使用既有 exec.run 与 killTree/stopEarly，不引入 shell 命令拼装；临时配置 0600、目录 0700，finally 清理认证副本，取消/超时/启动失败都覆盖。Windows 清理及 ACL 使用既有机制；无 Windows 实机不声称通过。

## 5. 运行期检测与结果判定

1. stdout/stderr 双通道按行增量监听，依赖 exec 的分块拼接；识别原生文本告警及原生结构化错误/状态事件。告警只从厂商信封/状态读取，不能从 assistant 正文或工具返回的任意文本中匹配“fallback”就误杀。
2. 识别已观察到的 `Model ... is not available ... using ... instead`，以及有实证/契约支持的 fallback 事件；保存首个违例作为不可撤销状态，发现后立刻 stopEarly 杀进程树。结束后再核对完整捕获（含无换行尾部），防退出竞态。不得只取最后一个模型值而掩盖中途变化。
3. Auto 请求且回读 Auto：只证明标签保持；底层 effective=null、source=unknown。不把 Auto 自身视为回退。显式具体模型变成 Auto、不同具体模型或明确 fallback 告警：失败；即便末尾又回到请求模型仍失败。缺底层回读不伪造成功身份，按身份未核实标注；如不能证明精确覆盖生效则该项精确模型验收保持未通过。
4. 厂商原始 code/signal 与编排结论分离：code=0 且违例仍为失败，失败审查内容不得进入有效结果/计票；提前杀导致的 signal 不覆盖回退原因。启动前无效模型保留请求证据和“未派生”，不能捏造厂商非零退出。
5. 输出截断、断流、取消、超时及无最终结果按已有失败路径留痕，缺回读保持 null/unknown。执行层失败与模型身份未知分开，不以模型正文的自报身份作证。

## 6. 验证与完成判据

- 单元：真实脱敏目录格式/配置最小样本解析，默认三档同源，合法覆盖与无效值，Auto 标签/具体身份分离，目录缺失/格式漂移/Custom 污染/来源指纹变化、配置优先级和不支持形态拒绝。
- 真实适配器子进程测试：用可控 executable 作为边界夹具，覆盖 stdout/stderr 告警、分块/无换行尾部、告警在工具前/后、模型先变后恢复、退出 0、启动失败、超时、取消、认证清理；验证确实调用真实适配器，不能只测纯函数。
- 跨进程 worker：实际两个进程，冻结请求与交接一致时执行、任一字段改变在派生前拒绝；测试可在隔离夹具启用候选侧，不能修改生产注册表开关或借桩结果冒充 Qoder 真机验收。
- macOS 真 CLI：隔离官方认证目录，取得账号目录和默认正对照；default/flash/pro 解析证据；至少一个真实有效显式具体模型正对照；无效请求启动前拒绝；保留历史退出 0 反例并通过真实适配器重放/受控故障测试证明编排失败。真实服务若拒绝可用模型/无可得有效覆盖，则报告该项阻塞，不制造通过。
- 所有真 CLI 调用受明确时限、取消和证据脱敏约束；记录运行前后用户全局 settings hash 相同及临时认证目录已删。只读能力另属 P3，Windows 未测单列。
- 同步主设计 §11、协议、开发日志、实施计划 P2、测试报告和 README 索引，区分实现/自动化/真机状态。版本字段不自动修改。
- 定向验证后进入代码多审（同一 gemini,glm,claude；最多 3 轮），逐条裁决并按接受项改码。通过后 `.trivium/bin/trivium verify --topic QoderCN官方模型路由与回退阻断` 真实执行配置的编译测试。任何失败如实保留，不宣称全流程完成。

## 7. 风险与停止条件

官方目录/配置的当前格式、权限与回读能力是需要取证的事实。无法取得目录、官方性不足、默认不明、有效覆盖没有正对照时保持对应阻塞；不能用手写清单、Auto 底层猜测或用户 BYOK 配置兜底。本计划只允许交付受控路由接线，生产严格只读准入开关继续关闭。评审轮数用尽或有效票不足按编排器立人工停点；审查中/人工停点不写业务文件。
