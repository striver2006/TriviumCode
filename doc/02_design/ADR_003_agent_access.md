# ADR-003：编程工具身份与接入路线分离

日期：2026-10-09。状态：Accepted（用户批准开发计划）；实现与真实路线验收进行中。

2026-10-10补测：基线实现已在b04cc302提交；Codex0.162.0四路线及Claude/Qwen flash补齐适用准入。Claude/Kimi、DeepSeek三种写入提示均没有实际写工具尝试，仍未测。Qwen max组合已回读并取得Bash拒绝证据，当时共享pro与三审按该轮审查计划等待七条默认路线完整准入；不宣称前置任务完成。正式结果见2026-10-10准入报告，官方Claude继续待订阅恢复。

Claude 与 Codex 都可通过供应商配置运行其它模型，工具身份不能证明模型族。保持注册表 Agent 身份、归档与护栏；独立解析 native/profile、模型、effort，预检和运行消费同一结果。Claude 的 native 表示官方订阅/登录，profile 经cld加载配置；失败不自动切换。

能力探针绑定路线和指纹，认证按实际组合隔离。配置声明与运行回读分别记录，无回读记null。run.v3保留三态模型族比较；旧Schema和历史文件不改。同族或未知告警继续，不增加门禁。规范字段和错误顺序以主设计11.6为准。

profile入口取本机绝对配置路径，缺省才现场发现可执行包装器；路径、包装器哈希、配置哈希和该路线底层版本共同绑定，不借用最后一次探测的其它路线版本。原生Claude清理ANTHROPIC_*冲突变量，保留官方登录或OAuth令牌；Codex原生要求官方provider与订阅登录配置，第三方入口或API凭据明确拒绝，失败不切换、不修改全局配置。

代价：缺Driver声明时不能证明异构；新增路线必须重新验证只读能力。告警按原因聚合。模型别名可能被profile映射，不能静态断言其家族。

2026-10-10配置调整（用户明确授权）：Claude的项目default/flash使用Qwen flash，pro/high显式绑定Qwen max与profile:qwen，不配置effort默认值。Qwen两组合已有完整准入并核对当前入口/profile指纹，因此恢复共享Claude、Gemini、GLM三审；Kimi/DeepSeek的生产写负对照不阻塞Qwen启用，仍保留未测。Claude官方模式实现保留，其项目默认/pro暂不使用；失败不自动回退官方。显式选择Kimi/DeepSeek须同时传接入与匹配模型。

2026-10-10 Codex 项目默认接入（用户明确要求）：agents.codex.profile 显式 null，default/flash/pro 的 plan/code/bug 分别使用 gpt-6.1-sol、gpt-6-luna、gpt-6-astra。该仓库配置覆盖内置供应商默认，不修改产品内置默认或用户全局配置；其它供应商保留单次显式选择，失败不自动回退。
