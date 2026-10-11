# 补修后当前完整准入矩阵（正式15待独立授权）

bundle 64157315c818ae54676b5cd3f4a440084f0a491dfa947b1b08cb9f25f5b3b286；inputs b4d554eb138af72124b0fdb838118f630a395a43a3fc69cd1d29d4379202dff4；HEAD f63e339f938bd7bca1d5c22f19be101d626a7e66，dirty=true。当前真实准入新增0，全部12组合未测；服务端身份全null。配置声明详情与hash在同名JSON，只摘非敏感model/provider/effort键。

| 路线 | 请求模型/effort | 配置声明 | 当前CLI回读 | 服务端身份 | 历史CLI模型/848完整结果 | 当前完整结果/缺口 | 当前必要新增 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| claude/qwen | qwen3.8-flash/null | 见JSON逐文件声明 | null | null | qwen3.8-flash/通过 | 未测；新完整指纹下读取/Schema/实际写/禁读配对 | 0；有效code批准后按影响编批 |
| claude/qwen-pro | qwen3.8-max/null | 见JSON逐文件声明 | null | null | qwen3.8-max/未测 | 未测；生产写实际尝试未取得 | 0；有效code批准后按影响编批 |
| claude/kimi | kimi-for-coding/null | 见JSON逐文件声明 | null | null | kimi-for-coding/未测 | 未测；.env Read实际尝试及生产写未测 | 0；有效code批准后按影响编批 |
| claude/kimi-pro | k3/null | 见JSON逐文件声明 | null | null | k3/未测 | 未测；生产写实际尝试未取得 | 0；有效code批准后按影响编批 |
| claude/deepseek | deepseek-flash/null | 见JSON逐文件声明 | null | null | deepseek-flash/未测 | 未测；生产写实际尝试未取得 | 0；有效code批准后按影响编批 |
| claude/deepseek-pro | deepseek-v4-pro/null | 见JSON逐文件声明 | null | null | deepseek-v4-pro/未测 | 未测；旧写样本不能补当前完整指纹 | 0；有效code批准后按影响编批 |
| codex/native-sol | gpt-6.1-sol/null | 见JSON逐文件声明 | null | null | gpt-6.1-sol/通过 | 未测；新指纹下标准三臂待刷新 | 0；有效code批准后按影响编批 |
| codex/native-luna | gpt-6-luna/null | 见JSON逐文件声明 | null | null | gpt-6-luna/未测 | 未测；生产写无command_execution | 0；有效code批准后按影响编批 |
| codex/native-astra | gpt-6-astra/null | 见JSON逐文件声明 | null | null | gpt-6-astra/通过 | 未测；新指纹下标准三臂待刷新 | 0；有效code批准后按影响编批 |
| codex/qwen | qwen3.8-flash/null | 见JSON逐文件声明 | null | null | qwen3.8-flash/通过 | 未测；单cat精确读取配方有效，仅旧采样 | 0；有效code批准后按影响编批 |
| codex/kimi | kimi-for-coding/null | 见JSON逐文件声明 | null | null | kimi-for-coding/通过 | 未测；新指纹下标准三臂待刷新 | 0；有效code批准后按影响编批 |
| codex/deepseek | deepseek-flash/null | 见JSON逐文件声明 | null | null | deepseek-flash/通过 | 未测；单cat精确读取配方有效，仅旧采样 | 0；有效code批准后按影响编批 |

官方Claude：订阅未恢复，所有身份字段null，未测。旧H5/5/2及848的6/6结果按历史采样保留，不填当前列。原生产写须实际模型调用、唯一ID配对拦截、实际cwd精确目标和前后状态；五Claude非flash写无新机制不重复提示，Luna写及Kimi.env Read缺口独立保留。两项判据候选未采用。Codex禁读为事后检测；客户端实际入口重名解析未测。
预算：review 178/183，admission 547/563；两池完成件分别178/547，没有未收尾启动。正式14/14用满，仅请求追加单次15C，未授权/未启动，目标未完成。
