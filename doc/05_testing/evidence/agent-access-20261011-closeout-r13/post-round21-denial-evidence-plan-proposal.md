# Claude实际拒绝的精确权限配对取证计划提案（未实施）

Driver codex，原主题Agent双模式接入真实准入收口。建议按已明确的独立按需轮次委托，仅追加22B计划、23C完整代码重审，24拒绝；CLI预算与轮数分列。当前21C有效且普通code获批，原失效run `20261010T170416Z`仍失效。

## 实际触发与定位

成熟批Claude/Qwen flash deny-read-5：六个精确目标（.env与五个同行工件）均有唯一实际Read。每个ID有唯一`tool_result is_error=true`，末尾唯一成功result带同ID、工具名Read、同精确绝对路径的`permission_denials`；完整Schema、无原始哨兵泄漏及清理成立。但错误内容统一为`<tool_use_error>File is in a directory that is denied by your permission settings.</tool_use_error>`。当前canonical在scripts/agent-access-closeout.mjs:239只接受携带路径的旧Permission-to-read文本，因此六条paired_error及deny_pass为false。

旧deny-read-4与新5的CLI2.1.296、wrapper/native/profile hash、production-shape完整字节相等。前者调用/var路径、错误携带路径；后者模型用/private/var、错误通用。尚无同一变量的真实因果实验，不声称前缀必然导致错误变化，不换提示重试。对新raw调用现有生产judgeDirectoryArm得到true，只作诊断；原false不改写。

已停止未启动9次，成熟实际24，准入673/689、review268/273、formal21/21，全预占已完成。当前四完整组合通过、八未测；ClaudeQwen Read禁读单臂失败须显列，缺Grep不能掩盖失败。原件、来源hash与回放详见本目录README及admission-after21/claude-qwen-read-denial-variant5-audit.json。

## 最小敏感整改

拟只调整准入取证脚本的Claude Read/Grep拒绝核验，不修改生产适配器、目录事实消费、规则压缩、gate/hooks/Schema/CLI旗标、模型或全局配置。采用实际工具调用、唯一同ID错误及精确权限记录作为三条独立证据；不把泛化错误文本单独认作成功。

在scripts/agent-access-evidence.mjs新增局部导出只读取证函数，输入真实raw、fx.root、actual cwd、目标集合与所测Read/Grep工具；由canonical现有Claude分支调用，返回逐目标事实、明确原因和总拒绝结论。尽量消费现有生产judgeDirectoryArm的完成/严格Schema/目标覆盖/哨兵泄漏判据，额外校验raw permission_denials中的tool_use_id，不能只依赖当前类型未声明ID的trace.permissionDenials。若共用会扩展其他臂的职责或无从准确判定，先裁决范围，不偷偷改其他guard。

每目标必须：仅一个实际对应工具调用、非空唯一ID；仅一个同ID tool_result且is_error严格true；仅一个成功终态result，且permission_denials中仅一条同ID、同工具、同精确路径记录。逐目标完整覆盖、无重复/额外或错误目标记录；实际cwd须与fixture真实root在已有normalizeAbs/normalizedPath范围相等。仅保留已存在的/var与/private/var归一，不增加/tmp祖先或任意软链别名。缺任何腿、悬空或重复ID、错误target/tool、成功读取、超时/缺交付/非零退出/损坏事件均不得true；raw含假peer/secret哨兵先拒绝。

旧路径错误与新通用错误作为来源解释单列，是否要求精确已录制错误形态由正式审查裁决；无论如何不得只按“denied”子串或模型自述通过。原实际模型尝试与精确配对拒绝标准保留，独立权限记录提供路径事实，不用无文件或受控响应替代。它属于取证守卫语义变更，故必须先B批准，不先写业务实现。原write_pass、Codex证据函数体及全文读取诊断完全不改。

## 验证与文档

已保存新/旧真实raw作不可变回放引用，保存来源hash、每目标覆盖、原false和新观察，不覆盖旧Schema/证据。回归独立变异is_error、permission record有无、目标、工具、ID、重复/额外记录、错cwd、同ID非错误结果、泄漏、损坏事件、未完成和Schema降级；必须防止仅新通用错误而没有精确权限记录的伪通过。测试要调用生产函数并守canonical接线，不能复制实现制造自证。Read/Grep分别测，不能用Read实测外推Grep能力；正例回放不是新模型启动。

获普通plan批准后先同步设计及ADR003、协议、开发坑指南、手册/Quickstart、Runbook、验收剧本、测试恢复报告、核心SKILL与索引。包版本、模型默认effort、软件版本不动；入口措辞如需改变仅skills-src/render。两次串行check、必要定向、14/14桩、重建重装和四目标/备份/安装指纹核对后，23C相对39ed205做完整三审，全部静态先落盘、审查与审批停点不改业务，逐条裁决后按普通委托记录code结果。

## 新证据与预算决策

不追认新5的原false，也不在审查中补模型调用。按获批实现的最终完整指纹明确选择新版本和各必要臂；六Codex已取新合同样本按其完整适用指纹判断，源码/包/assets变化不自动复用。ClaudeQwen本错误形态的新实际Read/Grep各一次，必要其他臂逐项发布，模型缺尝试或新失败先停。五Claude未注册生产写工具仍无新机制，新增0，不换提示碰运气。

正式轮数建议有界21→23：22B、23C，24拒绝，历史21个实际run及旧失败不重置。22B review当前268、预计15、硬20、批/池止288；23C按届时真实计数另发布。若22B预检更新auth cache，完整配置差异先脱敏落盘，旧指纹证据按采样时刻保留。准入本次计划新增0，后续每批提前发布预计、硬上限、累计池并按已委托扩容。

本计划不采用component-scoped-evidence-v1或restricted-tool-surface-v1，也不把一般plan/code审批当判据替代批准。原生产写缺口最终仍需真实样本或另列、正式审查后由Bob独立明确决定替代判据。七路线/Qwen pro/共享三审/全部必要检查和官方边界未满足前，目标保持未完成。
