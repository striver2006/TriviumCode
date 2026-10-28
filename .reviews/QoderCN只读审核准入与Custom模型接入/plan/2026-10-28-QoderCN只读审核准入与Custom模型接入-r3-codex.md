# 续实施完整计划（r3）

2026-10-28；Driver codex；同主题入口A继续。用户在了解六项剩余工作后明确要求开始实施。原目标、焦点、固定审核者gemini/glm/claude及plan/code各3轮不变，不自动改版本、不提交推送、不修改用户全局原生配置。历史计划/审查/失败证据不覆盖。

## 相对r2的变化与现状

r2原计划仍是需求依据，本计划完整取代其未实施方案的执行细节。上一批仅交付诊断脚本、环境删除补丁和证据；代码审/verify通过不等于本任务完成。本批不得再次仅把计划接线列为剩余而停止可独立完成的代码工作。生产准入取决于真实矩阵，能力缺口仍如实阻塞。

最新证据：Custom单项加载有真实正响应、缺声明回退Auto退出0、错误key返回401；官方存在可见Bash命令rule拒绝、三目标两种路径共6个Read rule拒绝；精确Write许可/deny仍是mode审批拒绝，Grep/Glob空结果不计拒绝。其它执行入口/配置叠加和完整生命周期未测。官方P2与所有Kimi无关改动保留，Qoder生产开关继续关闭。

本次新增两项需计划三审确认的契约：完整替换环境；严格区分Custom路线执行核验与底层provider/model身份。底层未知可为null，本身不是失败；路线必要证据缺失、回退或不一致仍必须失败，绝不以标签自述代替。

## 1. 完整环境与凭据隔离

在util/exec.ts的RunOptions/run新增显式环境模式（merge/replace，缺省merge保持全部现有调用语义），replace从空环境构建，不在spawn时重新合并process.env。Qoder所有原生派生调用（版本、探针、模型执行、采集器）使用replace；不修改不需要该能力的worker/其它厂商派生行为。qoderChildEnv只返回允许系统、locale、证书路径、无认证/查询/非标准路径代理及私有HOME/config/tmp变量。未知父变量以及构造后新增变量均不继承。新增真实子进程反测“构造env之后新增父键”，必要的旧merge/undefined删除兼容回归。

仅复制原生必需auth普通文件，home0700、文件0600、私有tmp；拒绝符号链接/未知格式/Windows ACL未测。Custom在内存选择唯一记录并仅重加密该项，不复制整份customs或用户目录；内部编解码器按CLI实际字节和codec指纹绑定，只支持已辨识布局，未知版本/多候选/形状变化拒绝。运行前后核对源不变、清理及辅助进程身份。所有已知明文凭据在stdout/stderr/trace/error写盘前精确脱敏，命中失败且不回显；不能取得的内部明文单列扫描边界。

## 2. Custom生产模型路线与绑定

qoder-cn-model.ts保留官方单列解析不变，新增Custom声明解析和选择器：official:<标签>、custom:<provider>/<modelID>，裸官方兼容；裸provider/modelID仅在唯一已验证声明匹配时接受。非法段、重复、仅大小写差异、官方与Custom原生key冲突派生前拒绝。provider_id只是目录命名空间，可信供应商继续只由access.provider_*承载。

qoder-cn-native.ts（必要时新增厂商内部custom模块）负责原生最小加载、只读目录发现和绑定校验，诊断脚本复用生产实现。首个样本bailian/qwen3.8-flash-tp只作显式真实样本，不成为默认。probe保留native_default兼容官方，新增native_routes按路线独立存facts和prepared_at/TTL。doctor发现目录/可调用事实，不伪造只读准入。

NativeModelFacts当前形状追加可选binding_version=2、route_kind及非敏感route_descriptor，保存provider命名空间、modelID、原生key、显示名、来源/声明语义、配置/codec/隔离配方指纹；旧无version按既有P2全settings hash规则处理，不回写历史。v2只绑定影响该路线的确定性语义，源整份hash只作不变性审计；凭据源变化必须校验，指纹不包含密钥值或临时路径/时间。配置仅保存无密钥来源引用。

default/flash/pro用既有resolveConfiguredTier优先级，单次精确覆盖最高；缺显式配置仍走P2官方默认，用户全局Custom设置不使编排器静默转BYOK。adapter目录钩子返回规范选择；预检冻结全部非敏感请求/声明/配方，review及run-protocol按requested_routes确定性校验，worker不重选默认。篡改供应商命名空间、modelID、来源、配方、入口、配置失效、过期或缺事实均派生前失败。

## 3. 必要回读、轨迹及失败语义

请求原值、规范选择、原生key、配置声明、init/assistant标签、modelUsage计费key分别记录。底层model/provider只有可信独立来源时才写effective；声明或正文不能提升身份，未知保留null/unverified且模型族比较unknown。

Custom路线必要回读先建立明确版本化规则：唯一受绑定声明在隔离目录可见、原生实际选择标签/原生key与该声明一致、独立计费标签单列、成功终态且无任何回退/认证/执行错误；以同版本单项正控制、缺声明回退控制、错误凭据控制证明该最小配置实际被使用。不能证明的标签只记label，不伪造route_verified。若原生只做无实际使用证据的回显、无法消歧或缺必要事件，则即使exit0也失败，保留已实现接线而不启用该组合。必要路线回读与底层身份未知分别判定，避免把用户允许的null另设为绝对禁用条件；此规则由本轮计划审裁决后实施。

流式monitor覆盖stdout/stderr回退即早停且首因粘滞；结束后兜底扫描未换行尾部。无效模型、声明失效、错误key、运行期回退、缺init/成功result、原生is_error、断流/截断/启动失败/超时均保留原始code/signal与编排原因，0不覆盖失败。保持官方P2行为及Auto标签底层未知语义。

新增厂商事件解析器：init工具/配置可见面、tool_use id/name/input、同IDtool_result、system permission_denied reason=rule/mode、result终态及取消。拒绝按permission-rule/permission-mode/tool-unavailable/execution-error/unknown区分；只在实际事件齐备时填路径读取、搜索命中、写事件、工具次数及完整性，失败读取不计成功read_paths。未知执行入口或必要配对缺失不默认为安全。TraceCapability依据可启用组合的保守交集，rejectionRecorded不能凭脚本预期升级。

## 4. 只读配方与真实矩阵

候选审核只开放必需Read/Grep/Glob；配置源、MCP和插件加载显式隔离，动态加入生产枚举deny集合及本次home/auth/model缓存根，路径使用realpath并覆盖已知别名/相对/绝对形式。禁读集合由registry派生，不手写角色名单；配方hash含工具/拒绝/配置源/环境模式/权限位语义，排除本次临时路径。

先查Write精确路径模式问题，以同版本、同目标、同permission mode做单变量对照；不靠放宽所有写入制造新准入。按受测有效语法区分路径许可未命中、mode审批和显式deny。沿用可丢弃夹具的真实正向执行，再观察候选审核下Write/Edit/Bash、子代理、本地无害MCP、loopback网络及其它实际工具执行拒绝；工具不可见无法触发的必需格仍阻塞。官方/Custom各组合独立；每格180秒最多2次，第二次仅纠正明确调用错误，不无限换提示。

路径覆盖同行原稿/审查/裁决、新工件、敏感假canary和私有凭据假canary，Read/Grep/Glob逐项实际调用，目录/符号链接/路径别名分别验证。搜索空结果、未写文件、模型口头拒绝不等于执行拒绝。技能、user/project/local设置、项目Hook、插件、MCP做合成哨兵正负对照；不能由静态配置/空列表断言无额外执行能力，不接触真实敏感正文。

## 5. 生命周期、准入台账与生产接线

复用AbortSignal、TERM宽限KILL、ps lstart身份校验与凭据清理；对真实CLI补启动失败、自然成功/失败、超时、用户取消、强杀、worker失联回收和主/子/辅助进程退出。可控executable故障回归与原生实际证据分列；清理异常单列，不抹原始原因。不能触发/观察则未测，不杀身份不明进程，不遗留真实凭据。

完整验收生成本机.trivium/admission.local.json（不进Git），通用admission.v1只校形状、注册表校身份；记录平台、入口/版本/hash、路线/模型/源/配方、必需项状态、相对证据路径/hash及有效期。生产消费核证据存在/hash、绑定/TTL和全部必需项；缺失、篡改、失配均拒绝。doctor不生成完整准入结论，用户手写passed不能绕过必要证据一致性检查；本机记录不被描述为抗宿主篡改的安全边界。

registry仍为Agent差异唯一来源，只声明能力/条件启用；厂商adapter提供准入钩子，通用preflight/worker/adapter复用，不在通用模块写Qoder身份分支。即使没有合格组合，也完成台账校验和拒绝接线的代码/测试；全局开关保持关闭。仅在至少一个真实组合全部通过后，启用匹配组合并以Qoder加两家已准入审核者跑真实三审；该验证不替换本主题固定三家审查。Windows无证据仍未测并拒绝。

## 6. 测试、同步与交付边界

业务改码前将本次确定契约并入主设计拟交付节；新增可选字段同步types、当前v3/config/probe Schema、schemas/parse/gate/meta、report/render、协议、核心SKILL、AGENTS、registry-parity和证据索引。历史v1/v2及旧v3不回填；所有新字段要有真实消费方，不添加死Schema。改CLI措辞从skills-src渲染，不手改产物。

自动化重点是真实run环境替换、官方兼容/Custom选择与冲突、最小加载与脱敏、回退exit0失败、缺必要回读、生命周期清理及两进程requested_routes篡改；桩回归只证明编排逻辑，不能算native准入。先typecheck与定向测试，再重装实际运行副本，以固定gemini/glm/claude code审逐条裁决修复，最后正式verify。未提交未推送，版本不改。

最终按“代码已实施/真实已测通过/已确认失败/未测阻塞/生产启用”分别交付。必须完成能独立推进的环境、Custom路由/快照、轨迹/失败及准入拒绝代码；native不具备必需可观察能力时才保留对应组合阻塞。真实准入未完成不得写整体通过或提前跑伪生产三审。
