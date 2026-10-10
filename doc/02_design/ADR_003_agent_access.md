# ADR-003：编程工具身份与接入路线分离

日期：2026-10-09。状态：Accepted（用户批准开发计划）；实现与真实路线验收进行中。

2026-10-10补测：基线实现已在b04cc302提交；Codex0.162.0四路线及Claude/Qwen flash补齐适用准入。Claude/Kimi、DeepSeek三种写入提示均没有实际写工具尝试，仍未测。Qwen max组合已回读并取得Bash拒绝证据，当时共享pro与三审按该轮审查计划等待七条默认路线完整准入；不宣称前置任务完成。正式结果见2026-10-10准入报告，官方Claude继续待订阅恢复。

Claude 与 Codex 都可通过供应商配置运行其它模型，工具身份不能证明模型族。保持注册表 Agent 身份、归档与护栏；独立解析 native/profile、模型、effort，预检和运行消费同一结果。Claude 的 native 表示官方订阅/登录，profile 经cld加载配置；失败不自动切换。

能力探针绑定路线和指纹，认证按实际组合隔离。配置声明与运行回读分别记录，无回读记null。run.v3保留三态模型族比较；旧Schema和历史文件不改。同族或未知告警继续，不增加门禁。规范字段和错误顺序以主设计11.6为准。

profile入口取本机绝对配置路径，缺省才现场发现可执行包装器；路径、包装器哈希、配置哈希和该路线底层版本共同绑定，不借用最后一次探测的其它路线版本。原生Claude清理ANTHROPIC_*冲突变量，保留官方登录或OAuth令牌；Codex原生要求官方provider与订阅登录配置，第三方入口或API凭据明确拒绝，失败不切换、不修改全局配置。

代价：缺Driver声明时不能证明异构；新增路线必须重新验证只读能力。告警按原因聚合。模型别名可能被profile映射，不能静态断言其家族。

2026-10-10配置调整（用户明确授权）：Claude的项目default/flash使用Qwen flash，pro/high显式绑定Qwen max与profile:qwen，不配置effort默认值。Qwen两组合已有完整准入并核对当前入口/profile指纹，因此恢复共享Claude、Gemini、GLM三审；Kimi/DeepSeek的生产写负对照不阻塞Qwen启用，仍保留未测。Claude官方模式实现保留，其项目默认/pro暂不使用；失败不自动回退官方。显式选择Kimi/DeepSeek须同时传接入与匹配模型。

2026-10-10 Codex 项目默认接入（用户明确要求）：agents.codex.profile 显式 null，default/flash/pro 的 plan/code/bug 分别使用 gpt-6.1-sol、gpt-6-luna、gpt-6-astra。该仓库配置覆盖内置供应商默认，不修改产品内置默认或用户全局配置；其它供应商保留单次显式选择，失败不自动回退。

2026-10-10本轮收口：HEAD已为3e5ca6bb，以上“未切换”“未提交”表述属于各自采样时刻。当前Claude2.1.296与Codex0.162.1不同于旧能力版本；旧完整指纹不能追认。收口使用受版本管理的canonical取证/汇总脚本，相对写路径按实际cwd解析，精确匹配隔离目标、调用ID、注册层或沙箱层错误及文件前后状态；禁读使用生产枚举并逐文件取证。生产写尝试缺失保持未测，受控传输只证明受测CLI机制，不替代真实模型主动尝试。判据候选须另经正式审查与用户明确批准。当前采样与进度见[收口报告](../05_testing/REPORT_2026-10-10_agent_access_closeout.md)，不据本轮计划审批宣称M11前置完成。

本轮code整改的取证契约（原标准不变）：探针和汇总须共同使用显式批次selection manifest，固定variant及requested/result/fingerprints-after的hash；缺结果、未完成或指纹不符不得回退旧成功。版本证据亦显式引用并核对入口/包装器/配置/模块指纹。Codex实际读取须有CommandExecution.cwd、parsed_cmd精确README目标及唯一命令/完整输出/exit/status配对，不认单独echo；两种ID分列。CLI effort带来源记录，服务端null，不添加默认值。受控对照从同一manifest取当期真实臂并核对实际权限模式与工具面，缺值不判同形。独立清理与落盘失败仍执行其余清理；历史入口缺新版上下文明确报错，不重解释原件。

2026-10-11版本上下文纠正：同一Codex物理CLI不意味着native与profile配置指纹相同。能力批错误选择native版本记录时严格拒绝是正确行为；取证脚本增加仅供静态Codex版本臂的已登记profile上下文参数，各profile独立选择版本manifest。保持完整指纹比较，不掩掉profile配置差异；版本命令无供应商/模型实际调用证据时相应身份仍null。

2026-10-10补充计划已获本轮人工审批（开始实现）：优先采用严格字面目录投影，按Read/Grep/Glob独立实测后启用；未知/失败工具保留逐文件规则，原机器禁读集合和证据不删除。目录规则的真实能力目前未测，10.3KB只是三工具全可压缩时的静态估算。settings文件传输仍为未实施比较项。原写负对照标准、准则变更审批和M11完成条件均不变；实现后须恢复Claude/Gemini/GLM完整代码审。
