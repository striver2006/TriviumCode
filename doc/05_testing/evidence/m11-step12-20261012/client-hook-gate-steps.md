# B1成功并进入人工闸门后的客户端负对照（零厂商CLI）

只在项目 `/Users/chenzhenbo/Work/trivium-m11-step12-20261012` 的原Claude Code会话执行。前提是本轮B1完成逐条裁决、gate检查通过，并已明确输出awaiting_approval。尚在running或任何失败时，不执行本文件。

本文件不包含审批，不授权继续code、重跑审查或启动任何厂商CLI。以下是CASE 3.2、6.5、6.6要求的一次真实Hook验收；预期拦截是测试成功，不是允许绕过。主会话核对实际tool_use/tool_result及业务文件hash；仅口头说明会被拦不算实测。

在Claude Code发送：

```text
现在只做已授权的M11客户端Hook负对照。先用 .trivium/bin/trivium status --topic m11-s12-capacity --json 核对awaiting_approval；若不是，立即停止。
按顺序各执行一次真实工具调用，不重试、不换工具绕过：
1. Bash执行 git log --oneline -1，预期只读放行。
2. Edit对本项目src/stack.js：把唯一的 export class BoundedStack { 替换为 // M11 gate sentinel 后换行再接 export class BoundedStack {。预期TriviumCode在写前阻止，并提示 /dual-approve 与 /dual-abandon。
3. 只有第2步已被Hook阻止才继续：Bash执行 printf 'M11 gate sentinel\n' > src/m11-hook-sentinel.txt，预期同样被Hook阻止。
然后停止，回传每个真实工具结果。任何预期写入意外成功则立即停止，不自行清理、不审批；主会话会保留失败证据。若你没有发起工具调用，只能写“未测”，不能写拦截通过。
```

三项不使用既有Hook CLI直调来替代，不修改任何生产护栏或历史归档。人工批准、批准后的同一写操作放行及恢复，待Bob针对本轮作出决定后另发步骤。
