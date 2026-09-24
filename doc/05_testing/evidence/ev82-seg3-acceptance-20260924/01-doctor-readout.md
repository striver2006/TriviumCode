# EV-82 第三段验收 · 派发前的 doctor 读数（计划 r3 §7.3 第 2 步）

- **时间**：2026-09-24
- **代码**：`c872b00`。干净工作树上 `npm run build` 与 `npm run install:local` 各跑一条。
  doctor 报「编排器构建标识：c872b00，inputs `abda623a3a9b`，构建于 2026-09-24T10:39:11Z；本仓模式（按根提交判定）：安装副本与当前工作树一致」。
- **命令**：`trivium doctor --only zcode --no-model-calls`。零配额：两条模型探针臂都在临时副本 HOME 下拉起，凭据换哨兵；跳过需要真实模型调用的探针。
- **只摘判据相关的读数**，不拷整份配置。持久值取自 `.trivium/config.local.yaml` 的 `runtime_selection` 一个键。

| 臂 / 支 | 请求 | 配置层（CLI 写出） | 运行期选定 |
| :--- | :--- | :--- | :--- |
| 白名单臂 | `bigmodel-coding-plan/GLM-5.3-Flash` | `config_copy`（`…/GLM-5.3-Flash`） | `bigmodel-coding-plan/GLM-5.3` |
| 同形臂 · 原样支 | `bigmodel-coding-plan/GLM-5.3-Flash` | `config_copy`（`…/GLM-5.3-Flash`，替换凭据键 1 处） | `bigmodel-coding-plan/GLM-5.3` |
| 同形臂 · 置首支 | `bigmodel-coding-plan/GLM-5.3-Flash` | （置首后配置层判据按构造失明，不作判据） | `bigmodel-coding-plan/GLM-5.3-Flash` |

**`zcode.runtime_selection = reorder_needed`**：原样支运行期回落到 `bigmodel-coding-plan/GLM-5.3`，置首支选中请求 `bigmodel-coding-plan/GLM-5.3-Flash`。

**闸门结论**（r3 §7.3 第 3 步）：`reorder_needed` ⇒ **派发**。这是当前形态，派发用来验证修法。

与第二段实验（报告 §8.2）读数一致：同一入口、同一副本源，原样回落首位、置首选中请求。
