# Agent 双模式接入真实准入收口：本轮预检停点

2026-10-10，Asia/Singapore。Driver=codex，正式入口A；用户确认主题为「Agent双模式接入真实准入收口」。前置任务未完成，不能进入M11第12步。

起始工具核对工作树干净，HEAD与origin/main均为3e5ca6bb5d5d69c7cfc5059b4d9bcf1418fb5c0a。随后创建本独立目录，baseline.json中的status_before_audit因此含该目录；不能把它解释为起始业务工作树脏。仓库与安装bundle相同，嵌入提交一致、dirty=false，当前构建输入一致。Claude三profile的旧证据指纹匹配；Codex全局配置和auth hash与三档最新批次一致，仍须逐能力臂核对完整指纹才能复用。版本/help真实调用尚未替代零启动静态核对。

第一次topic resolve因全文含仓库路径导致推导主题非法，退64，零厂商启动；用户随后明确指定合法主题，全文与旗标分别传递，resolve成功。user-goal.txt与resolve.json保存请求及解析结果，不推断Driver模型/provider。

S0.6共享三审预检退69：agy版本已变（探针记录1.3.2 → 实际1.3.3），须重新运行doctor。依已调用dual-run技能S0.6「失败则原样转述并停止」，本轮没有认领plan、没有正式审查、没有继续能力补测。新能力项、正式审查、最终两次check、自检与重装均未测；旧检查不写成本轮重新执行。

- approval.json：提前发布的最小补测清单、准入16/正式审查40独立上限；后续扩容已获用户授权。
- audit.mjs、baseline.json：零厂商启动核对，保存旧台账逐文件hash和配置/入口/bundle指纹。
- launch.mjs、calls/、loaded/、ledger/：预检调用、装载与逐启动预占/结束；版本、失败等仍计入预算。
- preflight-stop.json：预检全文、实际预算、全局hash与历史原件不变核验、扫描及限制。

本次复制入口的tv分支将execution_sha256声明为原scripts/agent-access-launch.mjs；实际独立入口hash另存在script_sha256。此两项不一致，明确作为取证装置缺项，不能把声明hash当实际执行源码。原件不追改；下轮启动前须修正独立入口，并保存新hash。

原生产写负对照标准不变，Kimi coding/k3与DeepSeek flash没有实际写调用时继续未测。既有权限诊断、模拟供应商传输与文件不存在均不替代真实模型主动尝试。无代码、项目配置或全局配置整改，无提交或推送。
