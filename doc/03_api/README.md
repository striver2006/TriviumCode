# 03_接口契约与协议规范 (API & Protocols)

本目录直接存放所有接口契约与协议规范文档（扁平结构，无子目录），通过文件名前缀区分文档类型。

---

## 文件命名规范

| 前缀 / 格式 | 文档类型 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| `API_<名称>.md` | 接口契约定义 | RESTful / RPC / CLI 接口规范、入参出参与错误码约定。 | `API_review_runner.md` |
| `PROTOCOL_<名称>.md` | 协同协议规范 | 智能体交互、工件中继协议规范、状态流转协议。 | `PROTOCOL_agent_relay.md` |
| `SCHEMA_<名称>.json/.yaml` | 数据结构约束 | JSON Schema / OpenAPI 规范文件。 | `SCHEMA_review_result.json` |

---

## 核心约定
- 智能体协同流水线统一以本地文件为中继通道（例如 `.reviews/PLAN.md`、`.reviews/DIFF.patch`、`.reviews/CODE_*.md`）。
- 接口与工件数据字段命名遵循驼峰命名法（CamelCase）或蛇形命名法（snake_case），并在协议文档中保持全局统一。
