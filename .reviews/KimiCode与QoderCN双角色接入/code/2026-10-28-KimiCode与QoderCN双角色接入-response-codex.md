---
schema: trivium.disposition.v1
topic: KimiCode与QoderCN双角色接入
stage: code
role: codex
kind: response
run_id: 20261027T155518Z
addresses:
  - 2026-10-28-KimiCode与QoderCN双角色接入-gemini.md
  - 2026-10-28-KimiCode与QoderCN双角色接入-glm.md
---

# 代码审第 1 轮应答：Kimi Code 与 Qoder CN 双角色接入

本轮共 18 条意见：gemini 5 条、glm 13 条。接受 17 条，驳回 1 条，暂缓 0 条。接受项已按下表落地；随后会运行定向构建与测试，再按同一 `driver codex`、`gemini,glm`、最多 3 轮的状态机自动重审。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| --- | --- | --- | --- | --- | --- |
| AGY-01 | gemini | blocker | 接受 | 计划 §7.2 明确不接受 `prompt-only`；新侧 schema/type 放行该值会形成未消费的安全降级旋钮。 | 删除两家配置的 `readonly_enforcement` 字段与枚举，保留审核准入关闭。 |
| AGY-02 | gemini | major | 接受 | Kimi 未有 effort/profile 实测，不应引用包含 effort 的公共 tiers 形状。 | moonshot 分支改用 `tiersModelOnly`，与 qoder-cn 一致。 |
| AGY-03 | gemini | major | 接受 | r2 允许 `bin?`，省略表示官方 CLI 发现；required 同时违反旧配置兼容边界。 | 两家 schema 仅 required `vendor`，TS 改为 `bin?: string | null`。 |
| AGY-04 | gemini | major | 接受 | Qoder 官方目录中的 `auto` 是路由标签，不得成为 default/flash/pro 的具体默认模型。 | 目录校验显式拒绝大小写不敏感的 `auto` 默认值。 |
| AGY-05 | gemini | minor | 接受 | 回退提示可能出现在 stdout；override 时 `declared` 必须仍表示配置目录默认，不能被请求值覆盖。 | 合并 stdout/stderr 的逐行回退检测并保留证据行；解析结果分离 `declared` 与 `requested`。 |
| GLM-01 | glm | major | 接受 | 护栏对账不能用与生产函数同源的重新推导，否则误登记护栏时测试不会失败。 | 恢复六家明确期望表，新增 Kimi/Qoder 的 `l2-none`。 |
| GLM-02 | glm | major | 接受 | 未证明两家会加载 AGENTS.md，且 L2 没有 Hook；让未验证入口可选为 Driver 会把协议送达当成事实。 | 两家 `driverEnabled` 关闭，保留候选入口与未验收说明；客户端证据完成后再打开。 |
| GLM-03 | glm | major | 接受 | 技能根与共享读取根目前只有官方文档候选值，没有 CLI/桌面/Extension Host 分别实测。 | 注册表注释标为候选未验收，文档补候选落点和调用写法；安装/查重测试仍按注册表派生。 |
| GLM-04 | glm | major | 接受 | 与 AGY-01 同一契约问题；提示词只读不能作为新侧安全准入。 | 同 AGY-01，删除两家 `readonly_enforcement` 形状。 |
| GLM-05 | glm | major | 接受 | 请求与回读不符、嵌套 `message.model` 和真实回退证据均缺测试，删掉分支也不会红。 | 增加 mismatch、嵌套回读正反例，并读取本轮真实 Qoder failure JSON 作夹具。 |
| GLM-06 | glm | minor | 接受 | 外部目录解析异常应归为配置缺失，不能泄露 TypeError；非法档位也应 fail closed。 | 校验 defaults 对象形状和 default/flash/pro 档位值。 |
| GLM-07 | glm | minor | 接受 | 裸 `fallback`/`not available` 会误把无关 stderr 判为模型回退，且缺少证据行不利排障。 | 只接受带 model 上下文的回退行，并把命中行写入错误。 |
| GLM-08 | glm | minor | 驳回 | `qoder-cn` vendor 取值属于已审 r2 的身份契约；改成 `qoder` 会改变 Schema、配置、注册表派生和历史计划，不是本轮实现修复，需另行计划补审。 | 保留 `vendor: qoder-cn`；Schema 的 vendor const 继续作为可辨识联合形状判别式。 |
| GLM-09 | glm | minor | 接受 | label 是审查文档固定称谓，r2 已指定 Critic-E/F，不能用临时 Driver 标签替代。 | 改为 `Critic-E · Moonshot Kimi Code` 与 `Critic-F · Qoder CN`。 |
| GLM-10 | glm | minor | 接受 | 与 AGY-02 同一 tiers 形状问题，Kimi 不应暴露 effort。 | 同 AGY-02，moonshot 改用 `tiersModelOnly`。 |
| GLM-11 | glm | minor | 接受 | 设计文档是实现依据，§7.4.1 的安装目标清单缺两家会与 install.ts 不一致。 | 补 Kimi/Qoder 候选安装根、调用写法和未验收/Driver 关闭状态。 |
| GLM-12 | glm | nit | 接受 | README 仍写四家和四家入口，已与注册表、发布包及测试事实不符。 | 改为四家已支持 + 两家候选入口，并说明未验收。 |
| GLM-13 | glm | minor | 接受 | QUICKSTART/MANUAL 直接宣称两家可作 Driver，但实际客户端与 Extension Host 未验收。 | 改为候选入口、Driver 开关关闭；补安装根、调用写法和状态表。 |

## 说明

本轮不把 Kimi tools 探针“未调用禁用工具”、Qoder CLI 退出 0 或文件未变化当成执行层拒绝；两家审核准入仍关闭。Qoder 的真实无效模型证据仍判失败，`Auto` 不进入生效模型；Windows 与五个 macOS Driver 的真实客户端验收仍按逐项“未测”处理。
