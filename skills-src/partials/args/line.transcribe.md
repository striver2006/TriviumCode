参数：本载体**不替换**参数占位符。参数就是用户随本命令给出的全部文本（跟在命令名后面，或被载体标成「User request」的那一段）；
下文命令里写 `<参数>` 的地方，按下面的转抄规约把它拼进去。参数写法：`{{fm:argument-hint}}`

**只在用户显式调用本命令时执行。** 本载体没有「禁止模型自行调用」的开关：你若是自己读到这份说明、
而用户并没有调用本命令，不要执行其中任何一步。

#### 参数转抄规约

{{> args/rule-source}}
{{> args/rule-empty}}
{{> args/rule-quote@ARG_KIND}}
{{> args/rule-example@ARG_KIND}}
