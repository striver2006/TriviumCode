---
schema: trivium.disposition.v1
topic: Agent双模式接入真实准入收口
stage: plan
role: codex
kind: revised
run_id: 20261010T175354Z
addresses:
  - 2026-10-11-Agent双模式接入真实准入收口-r3-claude.md
  - 2026-10-11-Agent双模式接入真实准入收口-r3-gemini.md
  - 2026-10-11-Agent双模式接入真实准入收口-r3-glm.md
---

# 第5次正式运行逐条裁决（plan-r3 / 20261010T175354Z）

三份全文已读取。本轮12条全部接受；历史code-r2七条另按r7计划实施。本件只裁决当前run。

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CLAUDE-01 | claude | major | 接受 | 轮次载体和计数应明确且可回归 | doc/05_testing/evidence/agent-access-20261011-closeout-r3/launch.mjs纳入Git及第6轮代码范围；抽取纯核验函数，N=task.runs已启动条目数+1（包括running/failed），历史四ID是保留子集；task与归档ID集合严格相等。测试现4放5B/plan、现5放6C/code、现6及7拒绝、错入口/主题/Driver/critic、不读task、归档多一项均拒绝 |
| CLAUDE-02 | claude | major | 接受 | 过期注释需按全仓语义域同步 | 更新adapters/claude.ts三处、probes/claude.ts1071及1076、types.ts2123、report.ts545；Claude合取为file_shape_verified及实际压缩工具已验证的防御不变式，其他适配器保持探针语义；历史引文逐处注明历史，源注释句族对账 |
| CLAUDE-03 | claude | minor | 接受 | 四个无新机制的写组合应同样由机制拒绝 | scripts/agent-access-closeout.mjs将qwen-pro加入现kimi/kimi-pro/deepseek的write启动前拒绝；测试四组合均不spawn、不消耗启动预算 |
| CLAUDE-04 | claude | minor | 接受 | 当前指针应同步而历史采样保留 | doc/02_design/README.md的ADR003条目指向2026-10-11恢复报告；ADR_003保留10-10历史段，另加10-11当前进度及报告指针 |
| CLAUDE-05 | claude | nit | 接受 | 历史与当前相同编号应按run区分 | 七历史行统一code-r2/run20261010T170416Z限定；本次裁决仅plan-r3/run20261010T175354Z，不改历史编号 |
| AGY-01 | gemini | minor | 接受 | 集成构造的目录事实也必须更新 | test/integration/claude-directory-adapter.test.ts同步注入真实cfg.review.sensitive_globs的hash及形态事实，并验证缺值/变更回退 |
| AGY-02 | gemini | minor | 接受 | 新增事实必须与原事实同生命周期 | src/trivium/doctor.ts路线不稳定时snapshot与existing.probe均清空新增项目hash及形态事实；默认初始化和目录失败也一起清空 |
| AGY-03 | gemini | minor | 接受 | 回放测试应独立于用户本地归档 | 静态检入test/fixtures/claude-deny-paths-replay.json，消费test/unit/claude-directory.test.ts；来源是原request.json.requests.claude.deny_paths，并与原out/trace.json sourceHash一致，记录原件hash、字段及精确集合hash；不依赖本地文件运行 |
| AGY-04 | gemini | minor | 接受 | 底层只有两个独立预算池 | 每批admission/review分别发布extension与启动清单，沿用旧根计数，硬上限包含wrapper/native/version/help/失败/超时/重试；CLI扩容与formal总6无关 |
| GLM-01 | glm | minor | 接受 | ASCII目录消费域必须精确且依据拓扑实测 | 精确目录段正则^[A-Za-z0-9_-]+$，根1至4段、根下0至2级子目录，点目录及非ASCII不消费。目录doctor的原七臂扩展至四种根深度及两级后代，同次逐目标配对核验，增加nullable directory_deny_shape事实ascii-root1-4-depth0-2-v1；旧形态缺值不消费。projectClaudeDenyPaths超出段数/后代深度的路径维持逐文件；现生产根被排除时先补上述真实拓扑证据再消费，仍不符则逐文件并显式报告settings大小/启动失败，不悄然扩域 |
| GLM-02 | glm | nit | 接受 | 避免共享入口已迁移但整改未完的中停态 | 迁移推迟至业务与两次check已完成后的最终构建；备份、移动、四目标安装及核验作为单一操作记录连续执行。任一步失败或意外中断标记rollback-required并恢复七入口，拒覆盖；重启先恢复该操作再继续，不保留未经登记过渡态 |
| GLM-03 | glm | nit | 接受 | hash读取次数需有直接观测通道 | claudeDirectoryFingerprint增加可注入readBinary参数（默认fs.readFile），本次调用精确路径Map复用；目录消费解析函数使用同一注入点测试0/1/2次及下一次重读；无跨调用缓存 |

完整修订计划为同目录r7-codex.md。审批须以本轮gate及当前授权为准；无判据变更。
