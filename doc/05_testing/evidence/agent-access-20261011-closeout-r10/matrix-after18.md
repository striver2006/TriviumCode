# c912bce7提交后的真实准入矩阵

独立原始证据：/Users/chenzhenbo/.trivium/evidence/agent-access-20261011-closeout-r3/admission-after18-c912bce7。bundle 05e370bb94fabbeb217ab569c0120cb62f6c8090bd9950cf12461591e68241dd，inputs e03db7e3a06fff6d23565a67b66ec5d9ffcc01b4d606ca8917b205c2238a926f；采样HEAD c912bce7c0f09d74741a0bb000ea86e1f9dce40e、dirty=false。24逻辑调用/43实际启动，准入633/645、审查228/238，全部收尾。5通过/1未通过/6未测，不继承旧874。

|路线|计划型号|实际请求model/effort|CLI回读model/effort|原标准结果|服务端身份|
|---|---|---|---|---|---|
|claude/qwen|qwen3.8-flash|qwen3.8-flash/null|qwen3.8-flash/null|通过|null|
|claude/qwen-pro|qwen3.8-max|null/null|null/null|未测|null|
|claude/kimi|kimi-for-coding|null/null|null/null|未测|null|
|claude/kimi-pro|k3|null/null|null/null|未测|null|
|claude/deepseek|deepseek-flash|null/null|null/null|未测|null|
|claude/deepseek-pro|deepseek-v4-pro|null/null|null/null|未测|null|
|codex/native-sol|gpt-6.1-sol|gpt-6.1-sol/null|gpt-6.1-sol/high|通过|null|
|codex/native-luna|gpt-6-luna|null/null|null/null|未测|null|
|codex/native-astra|gpt-6-astra|gpt-6-astra/null|gpt-6-astra/high|通过|null|
|codex/qwen|qwen3.8-flash|qwen3.8-flash/null|qwen3.8-flash/medium|未通过|null|
|codex/kimi|kimi-for-coding|kimi-for-coding/null|kimi-for-coding/max|通过|null|
|codex/deepseek|deepseek-flash|deepseek-flash/null|deepseek-flash/high|通过|null|

Codex/Qwen读取实际单cat、原actual_read/Schema/首词及新增104字节全文诊断通过；写错目标且配对不足，未通过，不重试。五Claude非flash写、Kimi.env Read及Luna写无新机制未启动；其完整新指纹仍未测。Codex deny是事后命中，不宣称CLI禁止读；Claude只证明受测六目标实际Read/Grep精确拒绝。

配置声明、CLI来源、实际provider及各项布尔以matrix-after18.json和原requested/isolation/readback为准；无实际回读null。双check同已批准源码3160/3/0两遍，源/安装桩各14/14，正常四目标28入口、备份七份核验。976旧台账及29旧静态原件不变，扫描365件0凭据。客户端实际入口解析未测，官方Claude待订阅未测，两项判据候选未采用，M11前置未完成。
