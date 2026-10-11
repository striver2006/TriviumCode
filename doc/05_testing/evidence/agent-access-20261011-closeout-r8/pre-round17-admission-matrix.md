# 第17C前路线与实际型号最小清单

新ac9包完整准入12未测；以下实际型号仅指旧874 CLI回读。新请求尚未启动，当前CLI回读与服务端身份均null。

|路线|旧实际模型|新指纹缺口|可复用证据|必要新增启动|
|---|---|---|---|---|
|claude/qwen|qwen3.8-flash|新完整指纹读取/写/禁读与MCP边界待必要刷新|原轨迹和机制分析，完整准入不追认|{"capability_starts":4,"profile_version":1,"only_after_qwen_first_read_pass":true}|
|claude/qwen-pro|null|生产写实际尝试未取得|原轨迹和机制分析，完整准入不追认|0：无新机制先不启动|
|claude/kimi|null|.env Read实际尝试及生产写未测|原轨迹和机制分析，完整准入不追认|0：无新机制先不启动|
|claude/kimi-pro|null|生产写实际尝试未取得|原轨迹和机制分析，完整准入不追认|0：无新机制先不启动|
|claude/deepseek|null|生产写实际尝试未取得|原轨迹和机制分析，完整准入不追认|0：无新机制先不启动|
|claude/deepseek-pro|null|旧写样本不能补当前完整指纹|原轨迹和机制分析，完整准入不追认|0：无新机制先不启动|
|codex/native-sol|gpt-6.1-sol|新完整指纹读取/写/禁读与MCP边界待必要刷新|原轨迹和机制分析，完整准入不追认|{"capability_starts":6,"profile_version":2,"only_after_qwen_first_read_pass":true}|
|codex/native-luna|null|生产写无command_execution|原轨迹和机制分析，完整准入不追认|0：无新机制先不启动|
|codex/native-astra|gpt-6-astra|新完整指纹读取/写/禁读与MCP边界待必要刷新|原轨迹和机制分析，完整准入不追认|{"capability_starts":6,"profile_version":2,"only_after_qwen_first_read_pass":true}|
|codex/qwen|qwen3.8-flash|先补新任务书单cat实际读取、完整对象Schema和首词，保留原3失败；通过后才条件式刷新其他臂|原轨迹和机制分析，完整准入不追认|{"first_read":2,"profile_version":2,"only_after_code_approval":true}|
|codex/kimi|kimi-for-coding|新完整指纹读取/写/禁读与MCP边界待必要刷新|原轨迹和机制分析，完整准入不追认|{"capability_starts":6,"profile_version":2,"only_after_qwen_first_read_pass":true}|
|codex/deepseek|deepseek-flash|新完整指纹读取/写/禁读与MCP边界待必要刷新|原轨迹和机制分析，完整准入不追认|{"capability_starts":6,"profile_version":2,"only_after_qwen_first_read_pass":true}|

第一条件臂是Codex/Qwen版本2+read2=4启动。仅在原单cat/完整Schema/首词全部通过后，另条件式刷新其余成熟臂，完整六组合19能力臂含版本共预计43，硬55须另发布批manifest和池停线，当前不执行。五Claude非flash生产写、Kimi.env Read、Luna写仍缺实际调用，不反复换提示。官方Claude仍未测。
