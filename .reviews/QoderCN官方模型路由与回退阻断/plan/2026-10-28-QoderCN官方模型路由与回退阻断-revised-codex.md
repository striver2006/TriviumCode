---
schema: trivium.disposition.v1
topic: QoderCN官方模型路由与回退阻断
stage: plan
role: codex
kind: revised
run_id: 20261027T230515Z
addresses:
  - 2026-10-28-QoderCN官方模型路由与回退阻断-gemini.md
  - 2026-10-28-QoderCN官方模型路由与回退阻断-glm.md
  - 2026-10-28-QoderCN官方模型路由与回退阻断-claude.md
---

# 首轮计划审逐条裁决

已读三份审查全文。16 条全部接受；合入完整 r2 计划，按编排器计票和 gate 决定下一阶段，不自行改写审核者结论。

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| --- | --- | --- | --- | --- | --- |
| AGY-01 | gemini | major | 接受 | 新证据结构必须与严格 Schema 和交接一致 | r2 §4 明定 native_model、确定性逐项比对及 Schema 同步 |
| AGY-02 | gemini | major | 接受 | unknown 是知识状态，不能写成表外的通用来源枚举 | r2 §4/§5 使用 null+unverified、具体信封用 envelope |
| AGY-03 | gemini | major | 接受 | 候选侧生产身份校验应保留 | r2 §6 只改隔离复制树并重打包的测试装置 |
| AGY-04 | gemini | major | 接受 | 异步探测不能塞进同步 catalogModelsFor | r2 §3/§4 探针异步保存事实，纯钩子消费已加载事实 |
| AGY-05 | gemini | minor | 接受 | 需要明确配置支持子集且不能用正则破坏字符串 | r2 §3 用字符状态机支持注释；环境引用拒绝 |
| GLM-01 | glm | minor | 接受 | 默认来源冲突必须有唯一处理 | r2 §3 显式已验证原生配置优先于内置默认，缺声明时目录默认+无 model 实测须一致 |
| GLM-02 | glm | minor | 接受 | Auto 默认解析与底层身份验收应分别下结论 | r2 §6 Auto 标签解析可通过、身份保持 null，不能宣称具体默认身份 |
| GLM-03 | glm | minor | 接受 | 未核实不能混成已确认回退 | r2 §5 精确请求无可验证标签则失败；合法 Auto 标签未知底层仅告警，生产准入仍关闭 |
| CLAUDE-01 | claude | major | 接受 | 必须复用既有路由及已审 native_default 契约 | r2 §4 纯 defaultModelFor、resolveTier 最末层、probe_default、显式值最高 |
| CLAUDE-02 | claude | major | 接受 | 冻结前需固定请求与配置声明语义 | r2 §3 决策表，固定实际 argv --model，独立保存用户声明 |
| CLAUDE-03 | claude | major | 接受 | 不能新增生产环境变量开关绕过准入 | r2 §6 复用 copyProductionTree 形态，临时注册表启用并用相同构建脚本打包 |
| CLAUDE-04 | claude | minor | 接受 | 文本告警与 JSON 正文必须按通道/事件分类 | r2 §5 分类两路纯文本和 init/assistant model/result modelUsage |
| CLAUDE-05 | claude | minor | 接受 | 排序/额度不应导致目录语义漂移 | r2 §3/§4 原始 hash 与规范化语义 hash 分开；worker 不重新取目录 |
| CLAUDE-06 | claude | minor | 接受 | 重放不能替代当前版本真机中止证据 | r2 §6 单独验收脚本调用真实 invoke 边界做无效模型故障臂，无生产跳过旗标 |
| CLAUDE-07 | claude | minor | 接受 | Auto 语义更新须消除旧断言副本 | r2 §6 点名纯逻辑/测试/P2 状态与来源映射 |
| CLAUDE-08 | claude | nit | 接受 | 显式来源排除项目设置需要真机反向对照 | r2 §6 cwd 项目/本地恶意 model 对照 |
