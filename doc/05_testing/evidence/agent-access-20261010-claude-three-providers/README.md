# Claude 三供应商补测证据

验收矩阵和达成边界见 [测试报告](../../REPORT_2026-10-10_claude_three_providers.md)。当前汇总为 [summary-closeout.json](./summary-closeout.json)，旧汇总不覆盖。

- `approval.json`：最小补测清单、初始 20 次上限及用户按需扩容授权。
- `extension-{1,2,3}.json`、`extensions-by-key/`：20→24→30→36 的具名扩容和幂等回执。
- `ledger/admission/`：36 份预占、36 份结束；版本、失败和超时均计数，预占不回收。
- `calls/`、`loaded/`：调用及预算侧车装载证明；本批正式审查零启动。
- `baseline.json`：CLI/包装器/profile 与已核对全局文件的起始 hash。
- `probe-v{1,2,3,4}.mjs`、`probe.mjs`：执行过的脚本快照和最新版本；逐臂 requested/call 记录对应脚本 hash。
- `launch-v{1,2}.mjs`、`launch.mjs`：入口快照；只通过现有适配器/探针执行，计数侧车在厂商进程启动前预占。
- `shape-refinement.json`、`fixture-refinement.json`：完整生产 Schema 形态及禁读集合补全的原因；原始证据保留。
- `verify*.mjs`：零 CLI 审计；现行审计输出 summary-closeout.json，不能原名重跑覆盖。
- `routes/controlled-illegal-tool-response-1/`：真实 CLI、模拟供应商传输的确定性拦截；不得当作 Kimi 真实模型负对照。

关键真实供应商原件：

| 项目 | 相对路径 |
| :--- | :--- |
| Qwen flash 读取与完整 Schema | `routes/claude-qwen-read-2/` |
| Qwen flash 真实 Write 配对拒绝 | `routes/claude-qwen-write-full-1/` |
| Kimi coding 读取与完整 Schema | `routes/claude-kimi-read-1/` |
| Kimi coding 三种写提示，无写调用 | `routes/claude-kimi-write-full-{1,2,3}/` |
| Kimi k3 读取 / 写调用缺口 | `routes/claude-kimi-pro-read-1/`、`routes/claude-kimi-pro-write-full-1/` |
| DeepSeek flash 读取 / 三种写提示 | `routes/claude-deepseek-read-1/`、`routes/claude-deepseek-write-full-{1,2,3}/` |
| DeepSeek V4 pro 读取 / 相对目标 Write 拒绝 | `routes/claude-deepseek-pro-read-1/`、`routes/claude-deepseek-pro-write-full-1/` |
| 完整生产集合：Read / 显式文件 Grep | `routes/claude-{qwen,kimi,deepseek,deepseek-pro}-deny-full-{1,2}/` |

每个能力臂保留 requested、call-shape、raw、result、fixture-before/after、cleanup；版本臂保存真实 version 输出。schemaJson、设置与参数属于声明，init.model 属于 CLI 回读；供应商、认证方法及 effort 无运行回读均记 null。旧阶段部分写/禁读臂没有完整 Schema，不复用成完整调用形态通过。

Qwen 的 deny-full-2 原生进程超时退出 143：三次 Grep 配对错误已在原始事件中，但缺最终结果与完整 Schema 交付，整个臂未完成。Kimi 两模型及 DeepSeek flash 无真实模型写尝试，继续「未测」。两次早期 Qwen 读取/写探测不达标的结果也保留，不以模型自述或文件不存在判通过。

本批未启动官方模型，未改全局配置、运行配置或版本号。旧预算均不重置。全部 JSON 经脱敏扫描后独占落盘；收尾审计继续扫描全目录。提交与推送未执行。
