# 模板（设计交付物 6）

供 Driver 起草工件时套用。`{{...}}` 是占位符，由人或 skill 填。

| 模板 | 产出工件 | 阶段 |
| :--- | :--- | :--- |
| [`plan.md.template`](./plan.md.template) | `plan/<日期>-<主题>-<当轮 Driver>.md` 计划原稿 | 计划审 |
| [`rca.md.template`](./rca.md.template) | `bug/<日期>-<主题>-<当轮 Driver>.md` 根因原稿 | 根因审 |
| [`disposition.md.template`](./disposition.md.template) | `<阶段>/<日期>-<主题>-revised-<当轮 Driver>.md` 修订件（含逐条裁决） | 计划审 / 根因审 |
| [`response.md.template`](./response.md.template) | `code/<日期>-<主题>-response-<当轮 Driver>.md` 应答件 | 代码审 |

## 第五类「验证记录」为什么没有模板

`verify/<日期>-<主题>-verify.md` **不由人书写**，而是 `trivium verify` 执行完
`.trivium/config.yaml` 里显式配置的命令后渲染落盘的——它记录的是实际执行的命令、
退出码、耗时与输出摘要，还带命令原文的 sha256 以便与配置对账（AC-10）。

给它配一份模板等于邀请人手写这份记录，而手写的「验证通过」恰恰是 FR-21 要防的东西
（设计原则 P5 不可伪装）。所以这里不提供模板；渲染器就是它的唯一格式定义，
见 `src/trivium/verify.ts` 的 `renderVerifyDoc`。

## 命名与落盘

**不要手工创建审查文档**——那是编排器从审查员的结构化输出渲染的，
Hook 会拦下 Driver 对它们的写入（AC-07；Claude Code 主攻时兜得住，ZCode 主攻时只作尽力拦截，Codex / Antigravity 主攻时没有 Hook、靠 `archive` 与事后核对，见设计 8.5）。
受保护的后缀是**除当轮 Driver 之外的全部已登记角色**，权威判据是 `hooks.ts` 的
`criticRoleSuffixes()`——**不要在这里枚举**：上一版枚举了 `-gemini.md` / `-glm.md` 两个，
M8 接入 codex 之后就漏了一个，而漏掉的那一格没有任何判据看得见。

本目录的模板只对应 **Driver 自己产出**的工件，不含审查文档。

后缀取**当轮 Driver 的 Agent id**，不是固定的 `claude`：裁决件（`revised` / `response`）
的文件名后缀与 front-matter 的 `role` 必须同指一人，闸门两头都比对（EV-66）。

裁决件的 `addresses` 列本轮**每个出了结论的审核者**的审查文档文件名（照抄归档里的名字；失败侧不列），
**不是意见编号**。闸门按本轮 `run.json.artifacts[]` 派生期望集逐项比对，份数不符或列了别的轮次即判
`bad_front_matter` 并给出期望的文件名（EV-134；此前只核非空，本仓曾有大批裁决件填的是编号而照样过闸）。

> **原稿的后缀同样随当轮 Driver 变**，别把它当成「只有裁决件才讲究」的事。
>
> 这句话上一版写反过：原稿模板曾写死 `-claude.md`，理由是「原稿不进闸门的裁决件定位，
> 所以照抄不会当场报错」。**那个理由是错的**（代码双审 CODEX-02 ≡ AGY-01）——
> 原稿后缀进的是**被审对象**定位：`locateSubject` 按 `parsed.role === 当轮 Driver` 过滤，
> 照旧文本写会在 `review --start` 的第一步退 65，比闸门报得还早。
> 留着这句写反的理由，会让下一个人以为这一面无关紧要。
