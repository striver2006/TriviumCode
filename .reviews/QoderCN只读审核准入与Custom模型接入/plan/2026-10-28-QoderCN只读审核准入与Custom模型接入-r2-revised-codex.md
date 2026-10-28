---
schema: trivium.disposition.v1
topic: QoderCN只读审核准入与Custom模型接入
stage: plan
role: codex
kind: revised
run_id: 20261028T050945Z
addresses:
  - 2026-10-28-QoderCN只读审核准入与Custom模型接入-r2-gemini.md
  - 2026-10-28-QoderCN只读审核准入与Custom模型接入-r2-glm.md
  - 2026-10-28-QoderCN只读审核准入与Custom模型接入-r2-claude.md
---

# 续实施计划逐条裁决

19条全部接受，r4为完整定稿。接受风险发现，不机械采用无法覆盖SIGKILL的进程exit回调建议；采用持久租约及已核实退出后的监督清理。编排器关于引用清单、拒写轨迹和未知模型族的告警保留。

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| --- | --- | --- | --- | --- | --- |
| AGY-01 | gemini | major | 接受 | 保留父键undefined兜底并统一qoderRun强制replace，防止调用漏传 | §1、exec/qoder派生包装器及真实窗口回归 |
| AGY-02 | gemini | major | 接受 | 目录与规范化契约明确，Custom不能被通用短名匹配吞掉 | §2、catalogModelsFor/normalizeModelForCatalog及通用精确匹配能力 |
| AGY-03 | gemini | major | 接受 | 接受finally在终止链不执行的风险；不声称exit或信号处理可覆盖SIGKILL | §5、持久凭据租约与父进程取消/失联回收，真实清理矩阵 |
| AGY-04 | gemini | minor | 接受 | 新Schema只校形状，注册表校身份 | §5/6、admission.v1注册与schemas/registry-parity测试 |
| GLM-01 | glm | minor | 接受 | 并发台账必须锁和原子替换，解析异常拒绝 | §5、同组合覆盖持锁原子替换，读者fail closed |
| GLM-02 | glm | minor | 接受 | 哨兵实测须回填对应载体登记，不能推及桌面 | §4/6、registry候选注释及instructionFiles注入复核 |
| GLM-03 | glm | nit | 接受 | 有效期明确且不能用新事实掩盖旧证据 | §5、独立expires_at并受测试时间与probe TTL上限约束 |
| GLM-04 | glm | nit | 接受 | 旧事实保持原绑定且不回写，新事实独立语义 | §6、v1通过/不回写及v2路线绑定三格回归 |
| CLAUDE-01 | claude | major | 接受 | 厂商提取JS/WASM不能在编排器进程直接执行 | §1、replace环境私有tmp的短命codec子进程、全记录秘密集及提取物清理 |
| CLAUDE-02 | claude | major | 接受 | 选择项目级准入，证据相对当前项目根；其它项目缺记录拒绝 | §5、项目绑定与安装副本/跨仓缺失回归 |
| CLAUDE-03 | claude | major | 接受 | 保留布尔登记，完整准入后才持久启用并加组合第二道门 | §5、criticEnabled启用条件及历史归档可读性，不临时翻转 |
| CLAUDE-04 | claude | major | 接受 | 补声明存在但服务端模型无效控制，不能借其它三臂覆盖 | §3/4、第四invalid-model原生对照 |
| CLAUDE-05 | claude | minor | 接受 | 标签只作每次一致性，路线可信度还依赖指纹绑定控制 | §3、route_verified与effective身份分离 |
| CLAUDE-06 | claude | minor | 接受 | 准入记录也须冻结，worker不能另选新记录 | §2/5、requested_routes可选admission引用及两进程替换/过期回归 |
| CLAUDE-07 | claude | minor | 接受 | 不进Git需要实际规则，新Schema需要登记 | §6、.gitignore/protocol/gitignore.snippet/init幂等及Schema注册测试 |
| CLAUDE-08 | claude | minor | 接受 | 历史原件不变，当前状态和源码注释必须更新 | §6、RunOptions/qoderChildEnv/设计原位更新，报告按批次追加并标旧句 |
| CLAUDE-09 | claude | minor | 接受 | 扫描覆盖全部Qoder持久化出口，不只stdout/stderr | §1/3、原始响应/结构结论/失败原因/worker日志等先脱敏再返回 |
| CLAUDE-10 | claude | minor | 接受 | 精确目录匹配不能走通用短名兜底 | §2、可选精确匹配钩子与同名官方/Custom回归 |
| CLAUDE-11 | claude | nit | 接受 | 不以明文key哈希进入项目或归档 | §2、加密源字节指纹校验；声明语义独立绑定 |

