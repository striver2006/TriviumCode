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

## 当前已归档文件

- [`PROTOCOL_dual_critic_relay.md`](./PROTOCOL_dual_critic_relay.md)：Driver-DualCritic 流水线的工件中继与协议契约（四份 JSON Schema、BRIEF 八段结构、退出码、分段长调用协议、Hook 契约）。

---

## 核心约定

- 智能体协同流水线统一以**本地文件**为中继通道。工件路径与命名见
  [`.reviews/README.md`](../../.reviews/README.md)：
  `.reviews/<主题>/{plan,code,bug,verify}/<日期>-<主题>[-r<N>][-revised|-response]-{claude|gemini|glm}.md`。
  > 早期文档里的 `.reviews/PLAN.md` / `DIFF.patch` / `CODE_*.md` 平铺命名**已废弃**，
  > 与 PRD FR-08 及设计 §6.2 冲突，勿再沿用。
- 工件数据字段统一用**蛇形命名法**（snake_case），与四份 JSON Schema 一致；
  TypeScript 源码内部的局部变量用驼峰，两者在适配边界转换。
- 协议一律带 `schema` 字段做版本标识（`trivium.review.v1` 等），
  解析方先校验 `schema` 再校验结构。
