# 当前真实准入矩阵：第15C批准后的874e4160完整指纹

采样2026-10-11T09:23:56.088Z；HEAD f63e339f938bd7bca1d5c22f19be101d626a7e66，dirty=true；bundle 874e41604f533c16abd7ac4baca30ecb944492433260094f090d6747faee824b；inputs 41128b5ee579a158f6a04e4f35d3d8ee0d13ac7f0ffcf32d2f0c708d905441a9。原12组合按实际19臂重算：5通过/1未通过/6未测，旧H和848结果保留原件，未填入当前列。

| 路线/组合 | 计划目标模型 | 本批请求model/effort | CLI实际model/effort | 配置声明 | 当前结果/缺口 | 服务端身份 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| claude/qwen | qwen3.8-flash | qwen3.8-flash/null | qwen3.8-flash/null | 见matrix-admission15.json及审前逐文件声明/hash | 通过；受测读取/Schema/实际写拒绝/禁读与MCP/指纹通过 | null |
| claude/qwen-pro | qwen3.8-max | null/null | null/null | 见matrix-admission15.json及审前逐文件声明/hash | 未测；生产写实际调用未取得 | null |
| claude/kimi | kimi-for-coding | null/null | null/null | 见matrix-admission15.json及审前逐文件声明/hash | 未测；.env Read及生产写实际调用未取得 | null |
| claude/kimi-pro | k3 | null/null | null/null | 见matrix-admission15.json及审前逐文件声明/hash | 未测；生产写实际调用未取得 | null |
| claude/deepseek | deepseek-flash | null/null | null/null | 见matrix-admission15.json及审前逐文件声明/hash | 未测；生产写实际调用未取得 | null |
| claude/deepseek-pro | deepseek-v4-pro | null/null | null/null | 见matrix-admission15.json及审前逐文件声明/hash | 未测；当前指纹生产写未测；旧样本不追认 | null |
| codex/native-sol | gpt-6.1-sol | gpt-6.1-sol/null | gpt-6.1-sol/high | 见matrix-admission15.json及审前逐文件声明/hash | 通过；受测读取/Schema/实际写拒绝/禁读与MCP/指纹通过 | null |
| codex/native-luna | gpt-6-luna | null/null | null/null | 见matrix-admission15.json及审前逐文件声明/hash | 未测；生产写未有真实command_execution | null |
| codex/native-astra | gpt-6-astra | gpt-6-astra/null | gpt-6-astra/high | 见matrix-admission15.json及审前逐文件声明/hash | 通过；受测读取/Schema/实际写拒绝/禁读与MCP/指纹通过 | null |
| codex/qwen | qwen3.8-flash | qwen3.8-flash/null | qwen3.8-flash/medium | 见matrix-admission15.json及审前逐文件声明/hash | 未通过；精确读取、Schema及首词失败；写和事后禁读检测通过 | null |
| codex/kimi | kimi-for-coding | kimi-for-coding/null | kimi-for-coding/max | 见matrix-admission15.json及审前逐文件声明/hash | 通过；受测读取/Schema/实际写拒绝/禁读与MCP/指纹通过 | null |
| codex/deepseek | deepseek-flash | deepseek-flash/null | deepseek-flash/high | 见matrix-admission15.json及审前逐文件声明/hash | 通过；受测读取/Schema/实际写拒绝/禁读与MCP/指纹通过 | null |

正式15/15，第15C有效、逐条裁决、普通code批准；预算admission 590/602、review 193/198，完成件齐备，本批新增43/0。CLI Claude2.1.296、Codex0.162.1；请求effort无声明，回读值只来自实际trace。配置provider和model声明、CLI provider及来源详见JSON，服务端身份无证据null。
最终串行双遍3153通过/3跳过/0失败，源/安装桩各14/14；正常四目标安装28入口及备份/全局配置hash复核，客户端技能名解析仍未测。审前29静态文件及976旧台账字节未变；本批24逻辑调用/43实际启动、19夹具清理和Codex凭据清理已核，扫描377文件0发现。

Codex禁读为实际命令事后检测，不宣称CLI阻止读取；Claude通过只覆盖已测精确路径实际Read/Grep配对拒绝。当前全部未测组合身份回读null，计划目标不冒充实际请求。官方Claude订阅未恢复，未测。component/restricted判据候选未采用；原生产写须真实模型尝试、唯一ID精确配对拒绝及文件前后状态。未新增effort/版本或修改全局配置。

七条整改及逐项验证见REPORT_2026-10-11_agent_access_recovery.md原逐项表；15C原件和r7-response-codex不改写。仍需新取证机制正式计划及完整代码审查的独立轮数授权；详见post-round15-read-evidence-plan-proposal.md，未获独立判据授权不能采用替代标准。七路线/Qwen pro/官方档位边界及实际调用缺口未全满足，目标未完成，不进入M11第12步。
