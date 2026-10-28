参数：原生技能加载器在这份无参数占位符的正文末尾追加 `ARGUMENTS: <用户参数原文>`。
从该尾段取得本次参数；下文 `<参数>` 按转抄规约拼入命令。参数写法：`{{fm:argument-hint}}`

**只在用户显式调用本命令时执行。** 用户没有调用本命令时，不执行其中任何一步。
CLI 的 `-p` 模式把 `/skill:名字 …` 原样交给模型，由原生 `Skill` 工具加载；
原生加载和模型转抄是两步，不能把转抄结果当作客户端自动执行。

#### 参数转抄规约

{{> args/rule-source}}
{{> args/rule-empty}}
{{> args/rule-quote@ARG_KIND}}
{{> args/rule-example@ARG_KIND}}
