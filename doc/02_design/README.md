# 02_系统设计 (System Design)

本目录直接存放所有系统设计、架构、决策与调研文档（扁平结构，无子目录），通过文件名前缀区分文档类型。

---

## 文件命名规范

| 前缀 / 格式 | 文档类型 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| `ARCH_<名称>.md` | 总体架构设计 (HLD) | 系统全局上下文、分层架构、核心数据总线、拓扑设计。 | `ARCH_system_overview.md` |
| `LLD_<名称>.md` | 详细设计说明书 (LLD) | 模块级内部设计、状态机、时序图、类与函数签名。 | `LLD_diff_patch_parser.md` |
| `ADR_<编号>_<名称>.md` | 架构决策记录 (ADR) | 关键技术选型与论证记录（背景、评估、决策与影响）。 | [`ADR_TEMPLATE.md`](./ADR_TEMPLATE.md) |
| `PROPOSAL_<名称>.md`<br>或 `YYYY-MM-DD-<主题>.md` | 方案调研与提案 | 针对特定技术挑战的早期提案、竞品调研或多模型答卷。 | `2026-09-10-Claude_Antigravity_ZCode_MultiAgent_Workflow-gemini.md` |

---

## 当前已归档文件
- [`ADR_TEMPLATE.md`](./ADR_TEMPLATE.md)：架构决策记录编写模板
- `2026-09-10-Claude-Code主攻双智能体审核流水线-dsv4flash.md`
- `2026-09-10-Claude-Code主攻双智能体审核流水线-grok4.6.md`
- `2026-09-10-Claude-Code主攻双智能体审核流水线-qwen3.8-flash.md`
- `2026-09-10-Claude_Antigravity_ZCode_MultiAgent_Workflow-gemini.md`
- `2026-09-10-Driver-DualCritic主攻双审流水线设计-zcode.md`
