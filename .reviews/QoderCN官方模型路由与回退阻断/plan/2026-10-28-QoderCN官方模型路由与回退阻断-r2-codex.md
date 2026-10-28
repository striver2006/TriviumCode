# Qoder CN 官方模型路由与回退阻断完整计划 r2

日期：2026-10-28；Driver：codex；入口 A。相对首轮：采纳 AGY-01、AGY-02、AGY-03、AGY-04、AGY-05、GLM-01、GLM-02、GLM-03、CLAUDE-01、CLAUDE-02、CLAUDE-03、CLAUDE-04、CLAUDE-05、CLAUDE-06、CLAUDE-07、CLAUDE-08。明确路由归属、请求/声明决策、Schema 字段、探测生命周期和测试构建接缝。全部裁决见同目录 revised-codex 件。

## 1. 目标与边界

从官方 CN 实际模型目录/原生配置解析 default、flash、pro 的同源默认；有效显式覆盖优先，无效请求启动前失败；运行中回退立即停止并判失败，即使原始退出码为 0。请求、声明、回读独立；Auto 仅路由标签，底层身份为 null、通用来源 unverified。接入真实适配器及 worker requested_routes 对账，不修改用户全局设置。

本任务只实现既有双角色计划的 P2，不提前开放严格只读审核准入、Driver 开关、默认选侧或自审限制；不改既有 Kimi 工作。未授权 commit/push，不自动修改版本字段。生产候选侧保持关闭；自动化和真实客户端验收分开。

## 2. 依据与已知事实

官方 CN https://docs.qoder.cn/cli/models 的 Default 仅 Auto，具体可用列表以账号 --list-models 为准，不适用 Global 分级模型；https://docs.qoder.cn/cli/settings 明确用户、项目 .qoder/settings.json、本地 .qoder/settings.local.json、显式 settings 的优先级和目录信任影响。本机 qoderclicn 1.1.80 help 支持 list-models/config-dir/setting-sources/settings/model/stream-json/no-session-persistence。

本机用户声明 model.name 为 bailian/qwen3.8-flash-tp，是 Custom 候选，不继承为官方默认，只读取非敏感键/hash。旧 1.1.79 失败样本在 doc/05_testing/evidence/kimi-qoder-cn-20261027-failure/，无效模型回退 Auto 后 code=0。旧纯逻辑拒 Auto、只扫 stderr，无真实目录/适配器接线；合成测试不是目录证据。

继承已审双角色计划 r2 §7.3：native_default 作为 resolveTier 最末层，TierSource=probe_default；不新增适配器私有的档位系统。原计划及失败工件保留。

## 3. 官方事实准备与请求/声明决策

异步准备归探针：新厂商探针通过显式 doctor 侧或受控验收脚本执行受测 CN CLI 的 --list-models，保存已解析目录和 native_default 事实，运行期纯钩子只消费 cfg.probe 中已加载事实。doctor 未显式选该侧时维持候选侧未测/跳过；新探针只探路由，不能将 path_deny/只读能力标为已通过。

先取证实际输出再定严格解析器。列表须区分官方 Default/New 与 Custom，失败/空目录/歧义/截断/超时/不支持形态均拒绝。模型值来自受测输出，不硬编码官网示例，不按模型名猜官方性。保存原始输出 hash（取证）及规范化官方项集合+默认项的 hash（语义）；顺序、额度、当前可用提示不进入语义 hash。

配置解析支持顶层对象、字符串/转义、行/块注释（字符状态机剥除，不能用破坏 URL/字符串的正则）；拒绝尾逗号、不支持的环境引用与非字符串 model.name。只提取 model.name、来源类别和完整原始 bytes hash，凭据字段不输出/落交接。实际执行强制 --setting-sources user 与隔离配置，不消费项目/本地配置；原用户声明单列，Custom 声明不能被接受为官方默认。项目配置不参与该受控路线，不假装实现全部信任合并器。

默认来源规则：已验证的显式原生官方配置可以覆盖目录内置默认；必须验证配置值在同一官方目录。没有显式官方配置时，目录的默认路由项须与一次省略 --model 的隔离真机 init 回读一致，冲突/缺失则 native_default=missing。用户 Custom 声明不能构成这个显式原生配置；本次官方正对照使用单独隔离路线，保留其与用户声明不同的事实。

| 路线 | 原始 override | 实际 argv | native_model.declared | 用户设置 |
| --- | --- | --- | --- | --- |
| 官方内置默认已证实 | null | 显式 --model <已解析标签> | 官方目录默认标签及 source=catalog-default | 单独保存 observed_user_model，不继承 |
| 显式已验证原生配置 | null | 显式 --model <配置标签> | 原生配置声明及 source=config | 原始来源/hash 可审计 |
| profile/agent/CLI 显式选择 | 原始显式值及其 origin | 显式 --model <校验后请求> | 默认声明继续单独保存 | 不用请求反填声明 |
| 无效显式值 | 保留原值 | 不派生模型进程 | 保留可得声明 | 不改设置 |

model 请求始终是实际传 argv 的非空标签；原始 override 单列可 null；declared 是选定默认来源的声明，不是请求回显。effective 仅从原生回读取得。default/flash/pro 是 config.profiles 的表名而非 low/medium/high；pro 非内置表，不自动创建用户配置文件。三表无该侧显式值时复用同一 native_default。

## 4. 路由、冻结与适配器接线

新增可选纯 CriticAdapter.defaultModelFor(cfg) 钩子，返回 resolved(model+证据快照) 或 missing(reason)，只消费探针。通用调用层在 preflight/review 的 resolveTier 前取该钩子，传给 resolveTier 的 native-default 参数。顺序：cli.tier → profile 格子 → agent.default_tier → native_default，cli.model 最高；显式空格子/坏 tier 不落默认。复用现有 modelOverrides/--model-<id> 通路。native 默认选中时 tier=null、tier_source=probe_default，既有值行为不变。同步 slug 校验消费已加载的目录，catalogModelsFor 不触发异步 CLI。

真实 qoder-cn.ts 加入 wiredAdapter 表；身份知识由注册表、厂商逻辑由适配器持有，通用层不按具体 id 分支。production criticEnabled/driverEnabled 保持现状。availability 检查探针 TTL、平台、受测入口/版本/hash、配置指纹，缺失/陈旧事实提示重探；实测否定不标为可自动修复。worker 不重新 --list-models 或重新选择默认，只校验冻结事实及当前绑定入口/来源指纹，来源变更拒绝执行。

明确扩展当前契约（非可选）：CriticRequest、run.v3.requested_routes 每侧增加可选 `native_model`，包含原始 override/origin、请求标签、声明默认/source、用户观察声明、官方目录规范化 hash/原始 hash、配置 hash、入口 hash/版本/平台、探针时间与默认验证依据。对象只含非敏感字段。父进程在请求生成时构造一次，交接和元数据都保存该值。worker 用统一快照构造器作确定性字段比较（不依赖 JSON 对象插入顺序），旧侧无字段行为原样；该能力侧字段缺失/篡改/形状错误拒绝。取消和启动失败保留请求证据。

CriticResult 与 run.v3.results 同侧增加可选 `native_model` 运行证据，包含标签序列、fallback 首因、原始 code/signal、请求/声明快照，通用 model_effective 与 model_effective_source 仍沿用现有字段。具体模型回读来源 envelope，未知为 null+unverified，绝不写入表外 unknown/stream。parse/meta/gate/report/schemas 接线，Schema 只校形状；身份仍注册表校验，requested_routes 中必须是启用侧的生产规则保持不变。

同步 run.v3/review 当前 schema 的 native_model 和 probe_default 枚举、types、协议、核心技能契约、AGENTS 描述及 parity；v1/v2 历史 schema 原样不动。真实调用统一 exec.run + killTree + stopEarly，临时配置/认证 0600、目录0700，严格最小复制/finally 清理。Windows ACL 沿用既有机制，未实测不通过。

## 5. 运行判定

两路逐行分类：非 JSON 行是厂商文本，仅匹配有实证的模型回退句式；JSON 按 type/subtype 分层，仅从 system/init 的 model、assistant.message.model、result.modelUsage 的键取模型标签；assistant/user/tool_result 正文不扫描回退词。结构化 system/result 错误告警仅识别已证实字段/事件，未知格式不编造支持。modelUsage 为多个标签时逐一对照，不能只取末项。

首个回退/不一致是不可撤销状态；stdout/stderr 回调一发现就 stopEarly，结束后复核全量含末尾无换行，覆盖异步退出竞态。Auto 请求+Auto 标签允许，底层=null/unverified；Auto 请求后回读具体模型可保留该具体身份，不把动态路由的正常身份披露误判回退；有明确 fallback 告警则仍失败。精确模型请求回读 Auto/另一模型，或先变再恢复，失败。具体请求无任何可验证回读标签时失败但原因是未核实，不谎称已观察到回退。

合法 Auto 标签且无回退是可成功执行的路由，未知底层发告警；若未来 P3 准入允许该路线，默认身份 unknown 不独立使票无效，沿用已有模型族 unknown 告警继续规则。明确回退/精确请求未核实均 status=failed、review_json=null，不进入计票。当前生产准入关闭；路由机制成功不等于只读能力已准入。

厂商原始退出码/signal 与编排失败分列；code=0+回退仍 failed。未派生请求没有厂商退出码，提前杀的 signal 不覆盖回退首因。截断、取消、断流/超时/无最终结果沿用失败语义，底层身份不从请求或模型正文自报填充。

## 6. 验证、同步与完成标准

单元覆盖真实脱敏目录/配置最小样本，三表默认同源/显式覆盖优先/空值拒绝、Custom 排除、默认冲突、目录漂移/来源变而同名、JSONC 字符串/环境引用拒绝；覆盖多事件/双通道/分块/尾部/工具前后告警/先变再恢复/正文误杀面。

真实适配器 executable 夹具覆盖未派生无效值、退出0回退失败、实时停止进程树、原始退出码、信号/超时/取消、清理和未知回读。不能只测纯函数。

worker 两进程测试复用 test/fixtures/stub-agent-kit/overlay 的复制生产树方法：独立临时树中修改注册表仅启用该候选、使用同一 scripts/build.mjs 重打包，夹具里启动真实适配器（fake executable）并验证 requested_routes 全字段篡改拒绝；不引入生产环境变量注册表开关，不放宽 schemas.ts 的启用侧身份检查；对照生产注册表候选关闭、源树不变。

macOS 1.1.80 真 CLI：隔离最小官方认证目录取得目录、无 --model 的默认验证、三张表解析及默认路由正对照、至少一项有效具体模型正对照；无效显式请求在生产准备层未派生。另建单独受控取证臂直接调用真实 adapter 的底层 invoke 执行无效模型（只绕过脚本侧前置目录校验，不增加生产绕过旗标，不伪造目录为有效），验证当前真 CLI 回退由相同流检测/stopEarly 阻断并判失败。若没有触发回退或服务失败，这项保持未测/阻塞，不用旧重放顶替。增加 cwd 下 .qoder/settings.json、settings.local.json 指向不同模型的反向对照，证明 --setting-sources user 隔离有效。

Auto 默认若取证可靠，则“三表默认路由标签解析”可验收通过；底层具体默认身份仍 null/unverified，不把它写成具体模型验收。有效具体覆盖必须有真实标签正对照；不能取得则保留该项阻塞。目录/默认本身无法取证则机制可以交付，但对应验收不完成。Windows 所有真机项未测单列。

记录用户全局 settings 前后 hash 相同、临时认证删除，脱敏证据新增不覆盖历史。同步 qoder-cn-model.ts 模块注释/Auto 拒绝断言/单测，P2.1 关于实验 Auto 的措辞、P2 交付状态表，主设计§11/协议/开发日志/测试报告/README 索引。定向测试后同一三家代码多审、最多3轮，逐条裁决并只改接受项。通过后正式 verify 真实执行配置编译测试；失败如实报告，不宣称全流程完成。

## 7. 停止条件

目录、默认、有效覆盖或当前版本真机回退中止缺证据时按项阻塞，不硬编码、不猜底层、不使用用户 Custom 兜底。人工审核停点/审查中不写业务文件；轮次用尽或有效票不足按 gate 输出停下，不自行 approve。产物、测试、真实能力、生产准入、commit/push 分开报告。
