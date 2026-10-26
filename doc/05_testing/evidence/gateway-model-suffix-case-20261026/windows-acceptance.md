# EV-258 第二轮 Windows 真实网关验收清单（后缀单位大小写）

- 主题：网关模型名后缀大小写（BACKLOG EV-258 第二轮；第一轮清单见 `../gateway-model-suffix-20261026/windows-acceptance.md`，第 1 步不通过，判读同目录 `windows-readout.md`）
- 执行人：用户，在 Windows 开发机上（本机层 `.trivium/config.local.yaml` 已开 `agents.claude.settings_env_source: user_settings`，CC Switch 网关，Qwen）
- **会动用凭据、花配额**：doctor 一次（主探针约十次模型调用 + 目录臂 7 次）、claude 作审核者的真实审查一次（约 10 分钟）。第 0、1、4 步零配额。
- 这次修的事：后缀单位改为大小写不敏感（`[1M]` 与 `[1m]` 都剥），其余边界不变。macOS 零配额对拍（47 项，含大写情形）已做完，见同目录 `accept-readout.txt`。
- **和第一轮最大的不同：期望值不再预先写死一个具体串。** 第一轮的期望表写了 `qwen3.8-max[1m]`，那是从「形状」推出来的（形状把字母都换成 `a`，大小写被抹掉了）。这次第 1 步直接打印模型名键末尾方括号段的**码点**，后面各步的期望一律写「与第 1 步打印值逐字相同」，并在第 3 步再打印一次 `model_effective` 后缀的码点对照。
- 要验的事：①带后缀的模型名键全部豁免，凭据类键（`ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_BASE_URL`）照旧替换；②探针原文与审查文档里 `init.model` / `model_effective` 逐字等于第 1 步打印的豁免值（带 `[1M]`）、来源 `envelope`；③`trace.json` 的 `modelReadback` 记下服务端回报的不带后缀的名并判为一致；④落盘凭据零命中。

## 0. 准备

每个 PowerShell 窗口开头先执行。Windows PowerShell 5.1 默认按 GBK 解码 node 输出、`Get-Content` / `Select-String` 也不按 UTF-8 读文件，所以**落文件一律 `Out-File -Encoding utf8`，读文件一律带 `-Encoding UTF8`**：

```powershell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$E = "doc\05_testing\evidence\gateway-model-suffix-case-20261026"
$E257 = "doc\05_testing\evidence\gateway-readback-model-20261025"
$T = "$env:TEMP\ev258b"
New-Item -ItemType Directory -Force $T | Out-Null
```

> **全程的输出都先写到 `$T`（仓库外）**，第 5 步再统一拷进证据目录。审查运行期间往工作树里写任何文件都会被跑后复算判成漂移、整次运行作废。

1. 拉取含 EV-258 第二轮的提交，按惯例构建并重装；重装后核安装副本与仓库构建一致：

   ```powershell
   (Get-FileHash skills\dual-critic\scripts\trivium.cjs).Hash
   (Get-FileHash "$env:USERPROFILE\.claude\skills\dual-critic\scripts\trivium.cjs").Hash
   ```

   两行应相同。
2. 构建测试产物（第 0、1、4 步的脚本直接导入产品的判定函数，不另写口径）：`node scripts\build.mjs --with-tests`
3. 确认本机层配置：`Select-String -Encoding UTF8 -Path .trivium\config.local.yaml -Pattern settings_env_source` 应命中 `user_settings`。
4. 两个自检（零配额，都不读你的 settings.json）：

   ```powershell
   node "$E257\scan-gateway-exposure.mjs" --self-test 2>&1 | Out-File -Encoding utf8 "$T\windows-scan-self-test.txt"
   echo "exit=$LASTEXITCODE"
   node "$E\diag-suffix-codepoints.mjs" --self-test 2>&1 | Out-File -Encoding utf8 "$T\windows-diag-self-test.txt"
   echo "exit=$LASTEXITCODE"
   Get-Content -Encoding UTF8 "$T\windows-diag-self-test.txt"
   ```

   期望两条退出码都是 0：扫描器三格全 `✓`、末行 `SELF-TEST PASS`；码点诊断全 `✓`、首格「构建自证为『是』」、末行 `SELF-TEST PASS`（它用合成值核过：误填进模型名键的短凭据、与凭据键同值的值、方括号里的长随机串、以子串形式混在模型名值里的凭据，都不会以原文或码点出现在输出里）。不通过就停下把两个文件发我。

## 1. 逐键诊断：直接打印后缀码点（零配额）

```powershell
node "$E\diag-suffix-codepoints.mjs" 2>&1 | Out-File -Encoding utf8 "$T\windows-diag.txt"
echo "exit=$LASTEXITCODE"
Get-Content -Encoding UTF8 "$T\windows-diag.txt"
```

脚本读你的 `settings.json`，**不打印任何凭据值**：凭据类键只打印长度；已豁免的模型名键打印原值与末尾方括号段的码点；未豁免的模型名键只打印形状，末尾方括号段只有是「1～4 位数字加一个字母」、且不命中模式脱敏、不与任何凭据类键同值时才打印码点，否则只写类别。每一行出屏前还会再过一遍产品的逐值脱敏（同一份替换集）：若某行行尾带「已按产品口径脱敏；此值不作逐字期望」的标注，说明那个模型名值里混着凭据子串——不算通过也不算不通过，原样发我。

**通过判据**

| 项 | 期望 |
| --- | --- |
| 退出码 | 0 |
| 首行 | `dist/test 含第二轮代码：是` |
| 带后缀的 5 个模型名键（`ANTHROPIC_MODEL`、`ANTHROPIC_DEFAULT_{OPUS,SONNET,FABLE}_MODEL`、`CLAUDE_CODE_SUBAGENT_MODEL`） | 「像模型名」「豁免」两列都是 `Y`；码点列与 2026-10-26 读数一致（`U+005B U+0031 U+004D U+005D`）。若码点变了（比如 CC Switch 改写了后缀），照实发我，不要按形状判 |
| `*_MODEL_NAME` 四键与 `ANTHROPIC_DEFAULT_HAIKU_MODEL` | 豁免 `Y`，码点列为「（无方括号后缀）」 |
| `ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN` | 豁免 `N`，只有长度 |
| 末行替换集长度 | 恰为两个凭据值的长度（前两次判读里是 116 与 62） |

**把第 1 步打印的 `ANTHROPIC_DEFAULT_OPUS_MODEL` 那一行的值记下来**，下文记作〈OPUS 值〉；第 2、3 步的期望都以它为准（opus 档按别名读这个键）。不符合就停下把 `windows-diag.txt` 发我，不必做后面几步。

## 2. doctor（探针侧回读）

```powershell
.\.trivium\bin\trivium.cmd doctor --only claude --json 2>&1 | Out-File -Encoding utf8 "$T\windows-doctor.json"
echo "exit=$LASTEXITCODE"
Select-String -Encoding UTF8 -Path "$T\windows-doctor.json" -Pattern '"model_flag"'
(Select-String -Encoding UTF8 -Path "$T\windows-doctor.json" -Pattern 'model\\":\\"<redacted-env>').Count
Select-String -Encoding UTF8 -Path "$T\windows-doctor.json" -Pattern 'model\\":\\"[^<\\]+' | Select-Object -First 3
```

**通过判据**

| 项 | 期望 |
| --- | --- |
| doctor 退出码 | 0 |
| 探针原文里的 `\"model\":\"<redacted-env>\"` | **0 处** |
| 探针原文里的 `\"model\":\"…\"` | `init.model` 逐字等于〈OPUS 值〉（带后缀）；assistant 消息里另有不带后缀的名 |
| `model_flag` | **不为 `null`**。按别名 `opus` 选模型时回读的是解析后的全名，记 `false` 是既有口径，判通过；`null` 即回读仍被吞，判不通过 |
| `readonly_flags` / `readonly_breach` / `directory_deny_verified` | 与前几次验收相同（非空 / 不为 true / 有结论） |

## 3. 一次 claude 作审核者的真实审查（审查调用的回读与 AC-20 留痕）

在仓库根建一个临时文件作被审对象（**不要提交**），用非 claude 的 Driver 只选 claude 一侧、opus 档发起代码审：

```powershell
Set-Content -Encoding utf8 tmp-ev258b.txt "EV-258 第二轮 Windows 验收用的临时文件，审完删除。"
.\.trivium\bin\trivium.cmd review --start --entry B --stage code --topic ev258b-win-claude --driver codex --critics claude --focus "只核对这个临时文件的措辞" --json 2>&1 | Out-File -Encoding utf8 "$T\windows-review-start.json"
Get-Content -Encoding UTF8 "$T\windows-review-start.json"
```

记下 `run_id` 与 `run_dir`，然后反复等待，直到退出码不是 73：

```powershell
.\.trivium\bin\trivium.cmd review --wait <run_id> --timeout 180 --json 2>&1 | Out-File -Encoding utf8 -Append "$T\windows-review-wait.txt"
echo "exit=$LASTEXITCODE"
```

审完（退 0，或退 1 也照样往下做）后：

```powershell
Copy-Item (Get-ChildItem .reviews\ev258b-win-claude\code\*-claude.md | Select-Object -First 1).FullName "$T\windows-review-claude.md"
Select-String -Encoding UTF8 -Path "$T\windows-review-claude.md" -Pattern '^model_effective|right_model|right_source'
$me = ((Select-String -Encoding UTF8 -Path "$T\windows-review-claude.md" -Pattern '^model_effective:' | Select-Object -First 1).Line -replace '^model_effective:\s*', '').Trim()
$i = $me.LastIndexOf('[')
if ($i -ge 0) { "model_effective 后缀码点：" + (($me.Substring($i).ToCharArray() | ForEach-Object { 'U+{0:X4}' -f [int]$_ }) -join ' ') } else { "model_effective 无方括号后缀" }
$trace = Get-Content -Raw -Encoding UTF8 "<run_dir>\claude\out\trace.json" | ConvertFrom-Json
$trace.modelReadback | ConvertTo-Json | Out-File -Encoding utf8 "$T\windows-trace-model-readback.json"
Get-Content -Encoding UTF8 "$T\windows-trace-model-readback.json"
```

`<run_dir>` 是 `windows-review-start.json` 里 `run_dir` 的值。

**通过判据**

| 项 | 期望 |
| --- | --- |
| claude 侧 | 正常交卷 |
| `model_effective` | 逐字等于〈OPUS 值〉（不是 `null`、不是 `<redacted-env>`）；上面打印的后缀码点与第 1 步该键的码点列相同 |
| `model_effective_source` | `envelope` |
| `family_comparisons` 里 claude 一侧的 `right_model` / `right_source` | 同上模型名 / `envelope` |
| `trace.json` 的 `modelReadback` | `init` 等于〈OPUS 值〉，`reported` 为去掉后缀的名（一个元素），`consistent` 为 `true` |

> 若 `consistent` 为 `false`：说明服务端回报的模型名既不是 `init.model`、也不是剥掉后缀的基名——不判不通过（生效模型照记 `init.model`，这一格只留痕），但请把 `windows-trace-model-readback.json` 发我。

## 4. 落盘扫描（凭据零命中、模型名只报 NOTE）

```powershell
node "$E257\scan-gateway-exposure.mjs" .trivium "<run_dir>" .reviews\ev258b-win-claude $T 2>&1 | Out-File -Encoding utf8 "$T\windows-scan.txt"
echo "exit=$LASTEXITCODE"
Get-Content -Encoding UTF8 "$T\windows-scan.txt"
```

扫描脚本只打印键名与命中文件，不打印任何值；它导入的是新构建的 `gatewayScrubPlan`，所以带 `[1M]` 的模型名键这次应列在「豁免模型名键」里。

**通过判据**：首行「豁免模型名键」包含第 1 步那五个带后缀的键；没有 `LEAK` 行；末行 `RESULT: no leak`、退出码 0。`NOTE` 行（模型名键的值出现在审查文档、探针原文里）是预期的。

## 5. 交回

```powershell
Copy-Item "$T\windows-*" $E
Remove-Item tmp-ev258b.txt
```

临时主题目录 `.reviews\ev258b-win-claude` 按惯例自行清理（不要提交）。把 `$E` 下新生成的 `windows-*` 文件发我（不含任何凭据值：doctor 与审查输出对凭据逐值脱敏，两个脚本只写键名、长度、模型名与白名单形态的后缀码点）。我据此回填测试报告 §8 与 BACKLOG EV-258。任一项不符合期望，原样发我，不要重试。
