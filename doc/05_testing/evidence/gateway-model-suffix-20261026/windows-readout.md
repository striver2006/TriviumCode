# EV-258 Windows 真实网关验收判读

- 执行：用户，Windows 开发机，2026-10-26；构建 `4e21fb76`（`dist/test` 已重建，见下文「是」那一行）
- 网关：CC Switch，Qwen
- 原始输出：同目录 `windows-scan-self-test.txt`、`windows-diag.txt`（用户提交 `4f70e087`）；追加诊断的输出由用户贴回会话，本文照录

## 第 0 步第 4 小步：扫描器自检——通过

三格全 `✓`、末行 `SELF-TEST PASS`。

## 第 1 步：逐键诊断——不通过

| 项 | 期望 | 实测 |
| :--- | :--- | :--- |
| 带后缀的 5 个模型名键（`ANTHROPIC_MODEL`、`ANTHROPIC_DEFAULT_{OPUS,SONNET,FABLE}_MODEL`、`CLAUDE_CODE_SUBAGENT_MODEL`） | 守卫 4 `Y`、豁免 `Y` | 守卫 4 `N`、豁免 `N`（形状 `aaaa9.9-aaa[9a]` / `aaaa9.9-aaaaa[9a]`） |
| `*_MODEL_NAME` 四键与 `ANTHROPIC_DEFAULT_HAIKU_MODEL` | 豁免 `Y` | 豁免 `Y` |
| 凭据类键 | 豁免 `N` | 豁免 `N`（长度 62、116） |
| 替换集 | 恰为两个凭据值 | 4 个值（116、62、17、15）——多出两个带后缀的模型名值 |

形状区分不了大小写，也区分不了 `dist/test` 是否已重建，于是追加一段零配额诊断（只看模型名键，只打印末尾方括号内容与码点）：

```
dist/test 含 EV-258 新代码：是
ANTHROPIC_DEFAULT_FABLE_MODEL | 后缀 [1M] | U+005B U+0031 U+004D U+005D | 守卫4 false
ANTHROPIC_DEFAULT_OPUS_MODEL | 后缀 [1M] | U+005B U+0031 U+004D U+005D | 守卫4 false
ANTHROPIC_DEFAULT_SONNET_MODEL | 后缀 [1M] | U+005B U+0031 U+004D U+005D | 守卫4 false
CLAUDE_CODE_SUBAGENT_MODEL | 后缀 [1M] | U+005B U+0031 U+004D U+005D | 守卫4 false
ANTHROPIC_MODEL | 后缀 [1M] | U+005B U+0031 U+004D U+005D | 守卫4 false
（其余 5 个模型名键：无方括号后缀）
```

## 结论

**根因：CC Switch 写的后缀是大写 `[1M]`，EV-258 的后缀片段 `\[[1-9][0-9]{0,3}[km]\]` 只认小写单位。** 计划 r2 §2.1 定「只认小写 k / m，大写不认是 fail-closed」，依据是「Claude Code 文档与 CC Switch 实测写的都是 `[1m]`」——后半句不成立：EV-257 判读里的 `qwen3.8-max[1m]` 是从形状推出来的，形状不分大小写；真实值从未逐字核过。单测 S11 与 access-modes 新格还把 `[1M]` 锁成了反例，变异 M5a（大小写不敏感）按「过宽」咬住——这几处都随修法改。

旁证（推断，未逐字核）：EV-257 判读里 `result.modelUsage` 的**键**被替换成占位符、其 `canonicalModel` 记作 `qwen3.8-max[1m]` 且未被替换。若那份判读照录了原文大小写，可以这样解释：键与 `init.model` 逐字等于配置值（大写 `[1M]`），`canonicalModel` 是 CLI 归一化后的小写形态，不等于任何键值、没被替换。与本次读数相容。

实现本身按计划生效（`dist/test` 是新代码，`[1m]` 小写形态在 macOS 用例、变异与对拍里都已证）。凭据类键照旧替换。第 2～4 步（doctor、真实审查、落盘扫描）未执行——同一原因下必然不通过，不花配额。

## 修法方向（用户 2026-10-26 定：EV-258 由 done 改回 doing、在原条目上修，另走 `/dual-run`）

后缀单位大小写不敏感（`[kKmM]`），其余边界（末尾恰好一个、1～4 位不以 0 开头的数字、剥后其余判据照旧、守卫 2、3 看完整值）不变；`claudeProfileMetadata` 与 `claudeModelConsistency` 共用同一片段，随之生效。S11 / access-modes 的 `[1M]` 由反例改为正例，另补 `[1K]`；变异 M5a 改为「单位任意字母」一类，保持过宽方向有锚。
