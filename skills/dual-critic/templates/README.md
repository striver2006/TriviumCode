# 模板（设计交付物 6）

供 Driver 起草工件时套用。`{{...}}` 是占位符，由人或 skill 填。

| 模板 | 产出工件 | 阶段 |
| :--- | :--- | :--- |
| [`plan.md.template`](./plan.md.template) | `plan/<日期>-<主题>-claude.md` 计划原稿 | 计划审 |
| [`rca.md.template`](./rca.md.template) | `bug/<日期>-<主题>-claude.md` 根因原稿 | 根因审 |
| [`disposition.md.template`](./disposition.md.template) | `<阶段>/<日期>-<主题>-revised-claude.md` 修订件（含逐条裁决） | 计划审 / 根因审 |
| [`response.md.template`](./response.md.template) | `code/<日期>-<主题>-response-claude.md` 应答件 | 代码审 |

## 第五类「验证记录」为什么没有模板

`verify/<日期>-<主题>-verify.md` **不由人书写**，而是 `trivium verify` 执行完
`.trivium/config.yaml` 里显式配置的命令后渲染落盘的——它记录的是实际执行的命令、
退出码、耗时与输出摘要，还带命令原文的 sha256 以便与配置对账（AC-10）。

给它配一份模板等于邀请人手写这份记录，而手写的「验证通过」恰恰是 FR-21 要防的东西
（设计原则 P5 不可伪装）。所以这里不提供模板；渲染器就是它的唯一格式定义，
见 `src/trivium/verify.ts` 的 `renderVerifyDoc`。

## 命名与落盘

**不要手工创建审查文档**（`-gemini.md` / `-glm.md`）——那是编排器从审查员的结构化
输出渲染的，Claude Code Hook 会拦下主脑对这两类文件的写入（AC-07）。

本目录的模板只对应 `-claude.md` 后缀的工件，即 Driver 自己的产出。
