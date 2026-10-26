---
schema: trivium.disposition.v1
topic: KimiCode与QoderCN双角色接入
stage: plan
role: codex
kind: revised
run_id: 20261026T174236Z
addresses:
  - 2026-10-27-KimiCode与QoderCN双角色接入-gemini.md
  - 2026-10-27-KimiCode与QoderCN双角色接入-glm.md
---

# 第 1 轮计划审裁决

完整阅读两侧全文。两侧均修改后通过；结构告警不删除、不改写审核者原件。下表逐条裁决，落实到同主题 r2 完整计划。

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| --- | --- | --- | --- | --- | --- |
| AGY-01 | gemini | major | 接受 | 接受明确 vendor 与类型完备性的要求；不采纳按 Qoder 工具身份造模型族的建议，原生 Auto 后端仍 unknown。Kimi 已有模型族规则，仅按真实回读格式扩充。 | r2 §7.1：moonshot/qoder-cn vendor、旧名义表保守无匹配及实际回读规则 |
| AGY-02 | gemini | major | 接受 | 明确定义 vendor、bin 与 tiers 的可选/必填边界；拒绝未实现 profile/permission 配置口子。 | r2 §7.2：JSON Schema 两支与配置类型 |
| AGY-03 | gemini | major | 接受 | defaultConfig 最小段经现有 mergeConfigLayer 合并可覆盖旧项目缺段，不需要放松选侧守卫或改写磁盘。 | r2 §7.2：默认合并与旧项目回归 |
| AGY-04 | gemini | major | 接受 | 先定义同一 Agent 下的载体扩展数据模型及单值兼容；加载根须实测后登记，不能猜路径。 | r2 §7.4：可选 driverCarriers 与安装/查重/停点话术 |
| AGY-05 | gemini | minor | 接受 | 明确专有镜头侧重；Jaccard 是 findings 位置的观测，不声称镜头文字能保证零重叠。 | r2 §7.5：三阶段镜头 |
| GLM-01 | glm | major | 接受 | 动态默认固定为探针快照，resolveTier 保持纯函数；启动前验证配置指纹及模型绑定，增加明确 probe_default 来源，不在 worker 重选。 | r2 §7.3：默认模型钩子、来源枚举与跨进程契约 |
| GLM-02 | glm | major | 接受 | 分离工具面裁剪和路径权限拒绝；工具清单缺席加无写入仍不足，必须用受控真实分发拒绝对照补足，不降低用户验收要求。 | r2 §7.6：两种机制、负对照证据及阻塞边界 |
| GLM-03 | glm | major | 接受 | 明确可选载体列表扩展，保持 AgentId 一家一个；根/语法一致用原模型，不一致按既定列表模型适配，不能借他家入口。 | r2 §7.4 |
| GLM-04 | glm | major | 接受 | 接受缺省最小段、不给猜测模型与接入说明；存量文件不会自动被改写，但运行合并会继承新增缺省键，故无需要求旧用户重 init。 | r2 §7.2：区分内存合并与磁盘迁移，缺模型指引 |
| GLM-05 | glm | major | 接受 | 选择真实审核者路线：Windows Driver 验收固定 gemini,glm 并列出安装登录/doctor/preflight 前置；桩只用于自动化单列，不替代用户要求。 | r2 §7.7：Windows 前置及材料 |
| GLM-06 | glm | minor | 接受 | label 预定 E/F；不安装未实测 Hook，L2 hookConfigTarget=null；instructionFiles 依逐载体实测。 | r2 §7.1、§7.4 |
| GLM-07 | glm | minor | 接受 | 增加五入口逐客户端步骤单，界面截图与 manifest case 对齐。 | r2 §7.7 |
| GLM-08 | glm | nit | 接受 | 记录现有 Bash 误拦摩擦面与结构化写工具/commit -F 标准出口；不改机制，也不重命名绕过判据。 | r2 §7.8：维护说明 |

