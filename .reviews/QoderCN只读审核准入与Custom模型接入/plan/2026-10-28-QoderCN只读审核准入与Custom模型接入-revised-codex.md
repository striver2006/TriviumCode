---
schema: trivium.disposition.v1
topic: QoderCN只读审核准入与Custom模型接入
stage: plan
role: codex
kind: revised
run_id: 20261028T022148Z
addresses:
  - 2026-10-28-QoderCN只读审核准入与Custom模型接入-gemini.md
  - 2026-10-28-QoderCN只读审核准入与Custom模型接入-glm.md
  - 2026-10-28-QoderCN只读审核准入与Custom模型接入-claude.md
---

# 计划首轮逐条裁决

22条：21接受，1驳回，无暂缓。接受项已合入r2完整计划；驳回项坚持用户验收标准。

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| --- | --- | --- | --- | --- | --- |
| AGY-01 | gemini | blocker | 接受 | 运行期凭据根不在freeze禁读集中，必须在临时根创建后补权限；其声称原生不支持路径拒绝不成立，P2/前置已有真实拒绝，仍需本轮逐工具重测 | r2 D1；withQoderHome内在派生模型前合并req.deny_paths与临时根，若不能实证则阻塞 |
| AGY-02 | gemini | major | 接受 | Custom斜杠标识必须单独解析且接入目录预检；不放宽官方目录正则 | r2 D2；native_routes与adapter目录钩子 |
| AGY-03 | gemini | major | 驳回 | 建议把裁剪工具列表当结构化免疫以降低拒绝证据标准，与用户明确要求冲突。保留rejectionRecorded=false的合法分档，但不以此豁免本任务必需拒绝实测 | 维持原计划第3节与r2 D3，不能触发则阻塞 |
| AGY-04 | gemini | major | 接受 | 必须新增真实流式调用与结果关联解析；所引用runQoderCnWorker和行号与当前文件不符，不据此断言已存在该函数 | r2 D3；Qoder事件解析器及adapter结果映射 |
| AGY-05 | gemini | minor | 接受 | 通用三处防御只调用通用适配器钩子，不硬编码Agent | r2 D4；adapter准入钩子/现有availability复用 |
| GLM-01 | glm | major | 接受 | 官方和Custom按独立语义源绑定；原始整份hash保留审计，旧facts维持原语义 | r2 D2；配置绑定v2和兼容分支 |
| GLM-02 | glm | major | 接受 | 多路线存储和组合准入落点须先明确 | r2 D4；probe.native_routes和项目本机准入文件 |
| GLM-03 | glm | minor | 接受 | 官方MODEL单列解析保持原防线，Custom用独立声明解析 | r2 D2 |
| GLM-04 | glm | minor | 接受 | 配方hash不得含临时路径/mtime/本次时间；冻结事实原样传递 | r2 D1/D2；确定性配方 |
| GLM-05 | glm | minor | 接受 | 先最小对照，固定模型/提示词，每格限时限次，缺口不靠无限重试 | r2 D3；每格180秒最多2次 |
| GLM-06 | glm | minor | 接受 | 按实际载体和隔离配方回填登记并复核身份注入，不能将CLI证据推广桌面 | r2 D5；registry与入口实测同步 |
| CLAUDE-01 | claude | major | 接受 | Custom请求标签回显不能冒充底层身份；可靠模型信封与必要路由回读标准先定义，缺必要证据阻塞 | r2 D2；label与effective独立 |
| CLAUDE-02 | claude | major | 接受 | 生产环境按白名单构建并绑定配方，父环境canary需反测 | r2 D1；env白名单 |
| CLAUDE-03 | claude | major | 接受 | access.provider_*是供应商身份唯一事实源，native只保留目录命名空间不另写生效供应商 | r2 D2；access一致性 |
| CLAUDE-04 | claude | major | 接受 | 机器准入不写静态registry或由doctor假产完整验收；本机证据生成和消费分开 | r2 D4 |
| CLAUDE-05 | claude | major | 接受 | 保持P2默认官方来源，Custom必须显式选路，避免静默改变计费 | r2 D2；default/flash/pro显式Custom配置 |
| CLAUDE-06 | claude | major | 接受 | Trivium内部区分不足以证明原生CLI消歧；冲突派生前拒绝 | r2 D2；大小写/原生key冲突检测 |
| CLAUDE-07 | claude | major | 接受 | 不能用目录前缀推测生效族；可信回读模型与命名空间分离，不可确认时比较unknown | r2 D2/D4；registry模型族规则仅据可信身份 |
| CLAUDE-08 | claude | minor | 接受 | 当前v3扩展可选，缺字段为历史官方；保留v1/v2及parse/report/render全部同步 | r2 D5 |
| CLAUDE-09 | claude | minor | 接受 | 允许原生临时私有凭据落盘；输出归档前精确扫描已知key，命中脱敏并失败；未知密文不得伪称已扫明文 | r2 D1/D5 |
| CLAUDE-10 | claude | minor | 接受 | 静态能力取全部可用组合的保守交集；组合细节写准入，不为过验收改分档 | r2 D3/D4 |
| CLAUDE-11 | claude | nit | 接受 | 注册表候选/Driver-only等注释需与最终实测状态同步 | r2 D5 |

