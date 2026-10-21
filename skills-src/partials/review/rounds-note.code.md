**轮次上限无条件传**：resolve 输出的 `code_rounds` 已含缺省回落（`code_rounds_source` 记来源
flag / config），照抄进 `--code-rounds`。漏传不会报错——`--start` 会自己回落配置缺省——
但当次指定的上限就此消失，多轮循环的「用尽停下人工审批」会提前或推迟触发，
用户看不出参数曾被给过。