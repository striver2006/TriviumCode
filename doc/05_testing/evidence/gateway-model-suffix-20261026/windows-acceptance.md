# EV-258 Windows 真实网关验收清单

- 主题：网关模型名上下文后缀（BACKLOG EV-258）
- 执行人：用户，在 Windows 开发机上（本机层 `.trivium/config.local.yaml` 已开 `agents.claude.settings_env_source: user_settings`，CC Switch 网关，当前是 Qwen）
- **会动用凭据、花配额**：doctor 一次（主探针约十次模型调用 + 目录臂 7 次）、claude 作审核者的真实审查一次（EV-257 那次约 10 分钟）。第 0、1、4 步零配额。
- 为什么要在 Windows 上验：带 `[1m]` 后缀的模型名键是 CC Switch 写在 Windows 机器 `settings.json` 里的，开发机 macOS 没开 `settings_env_source`。本机零配额验收（新旧构建对拍 38 项）已在 macOS 用假 CLI 做完，见同目录 `accept-readout.txt`。
- 要验的事：①带后缀的模型名键（`ANTHROPIC_MODEL`、`ANTHROPIC_DEFAULT_{OPUS,SONNET,FABLE}_MODEL`、`CLAUDE_CODE_SUBAGENT_MODEL`）全部豁免，凭据类键（`ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_BASE_URL`）照旧替换；②探针原文与审查文档里 `init.model` / `model_effective` 记 `qwen3.8-max[1m]` 一类带后缀的名、来源 `envelope`；③`trace.json` 新增的 `modelReadback` 记下服务端回报的不带后缀的名并判为一致；④落盘凭据零命中。

## 0. 准备

每个 PowerShell 窗口开头先执行。Windows PowerShell 5.1 默认按 GBK 解码 node 输出、`Get-Content` / `Select-String` 也不按 UTF-8 读文件（EV-256、EV-257 两次都撞过乱码），所以**落文件一律 `Out-File -Encoding utf8`，读文件一律带 `-Encoding UTF8`**：

```powershell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$E = "doc\05_testing\evidence\gateway-model-suffix-20261026"
$E257 = "doc\05_testing\evidence\gateway-readback-model-20261025"
$T = "$env:TEMP\ev258"
New-Item -ItemType Directory -Force $T | Out-Null
```

> **全程的输出都先写到 `$T`（仓库外）**，第 5 步再统一拷进证据目录。审查运行期间往工作树里写任何文件都会被跑后复算判成漂移、整次运行作废（EV-256 第 4 步撞过）。

1. 拉取含 EV-258 的提交，按惯例构建并重装；重装后核安装副本与仓库构建一致：

   ```powershell
   (Get-FileHash skills\dual-critic\scripts\trivium.cjs).Hash
   (Get-FileHash "$env:USERPROFILE\.claude\skills\dual-critic\scripts\trivium.cjs").Hash
   ```

   两行应相同。
2. 构建测试产物（第 1、4 步的脚本直接导入产品的判定函数，不另写口径）：`node scripts\build.mjs --with-tests`
3. 确认本机层配置：`Select-String -Encoding UTF8 -Path .trivium\config.local.yaml -Pattern settings_env_source` 应命中 `user_settings`。
4. 扫描器自检（零配额，沿用 EV-257 的脚本，不读你的 settings.json）：

   ```powershell
   node "$E257\scan-gateway-exposure.mjs" --self-test 2>&1 | Out-File -Encoding utf8 "$T\windows-scan-self-test.txt"
   echo "exit=$LASTEXITCODE"
   ```

   期望三格全 `✓`、末行 `SELF-TEST PASS`、退出码 0。不通过就停下把文件发我。

## 1. 逐键诊断（零配额）

```powershell
node "$E\diag-scrub-plan.mjs" 2>&1 | Out-File -Encoding utf8 "$T\windows-diag.txt"
echo "exit=$LASTEXITCODE"
Get-Content -Encoding UTF8 "$T\windows-diag.txt"
```

脚本读你的 `settings.json`，但**不打印任何凭据值**：凭据类键只打印长度，未豁免的模型名键只打印「形状」（字母换 `a`、数字换 `9`），已豁免的模型名键打印原值。

**通过判据**

| 项 | 期望 |
| --- | --- |
| 退出码 | 0 |
| 带 `[1m]` 的五个模型名键 | 「像模型名」与「豁免」两列都是 `Y`，值列为 `qwen3.8-max[1m]` / `qwen3.8-flash[1m]` |
| `*_MODEL_NAME` 四键与 `ANTHROPIC_DEFAULT_HAIKU_MODEL` | 豁免 `Y`（与 EV-257 验收时相同） |
| `ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN` | 豁免 `N`，只有长度 |
| 末行替换集长度 | 恰为两个凭据值的长度（EV-257 判读里是 62 与 116） |

不符合就停下把 `windows-diag.txt` 发我，不必做后面几步。

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
| 探针原文里的 `\"model\":\"<redacted-env>\"` | **0 处**（EV-257 验收时目录臂 7 次全是它） |
| 探针原文里的 `\"model\":\"…\"` | `qwen3.8-max[1m]`（`init.model`，带后缀）；assistant 消息里另有 `qwen3.8-max`（不带后缀） |
| `model_flag` | **不为 `null`**。按别名 `opus` 选模型时回读的是解析后的全名，记 `false` 是既有口径（EV-256 验收时也是 false），判通过；`null` 即回读仍被吞，判不通过 |
| `readonly_flags` / `readonly_breach` / `directory_deny_verified` | 与 EV-256 / EV-257 验收时相同（非空 / 不为 true / 有结论） |

## 3. 一次 claude 作审核者的真实审查（审查调用的回读与 AC-20 留痕）

在仓库根建一个临时文件作被审对象（**不要提交**），用非 claude 的 Driver 只选 claude 一侧、opus 档发起代码审（与 EV-257 第 2 步同一形态）：

```powershell
Set-Content -Encoding utf8 tmp-ev258.txt "EV-258 Windows 验收用的临时文件，审完删除。"
.\.trivium\bin\trivium.cmd review --start --entry B --stage code --topic ev258-win-claude --driver codex --critics claude --focus "只核对这个临时文件的措辞" --json 2>&1 | Out-File -Encoding utf8 "$T\windows-review-start.json"
Get-Content -Encoding UTF8 "$T\windows-review-start.json"
```

记下 `run_id` 与 `run_dir`，然后反复等待，直到退出码不是 73：

```powershell
.\.trivium\bin\trivium.cmd review --wait <run_id> --timeout 180 --json 2>&1 | Out-File -Encoding utf8 -Append "$T\windows-review-wait.txt"
echo "exit=$LASTEXITCODE"
```

审完（退 0，或退 1 也照样往下做）后：

```powershell
Copy-Item (Get-ChildItem .reviews\ev258-win-claude\code\*-claude.md | Select-Object -First 1).FullName "$T\windows-review-claude.md"
Select-String -Encoding UTF8 -Path "$T\windows-review-claude.md" -Pattern '^model_effective|right_model|right_source'
$trace = Get-Content -Raw -Encoding UTF8 "<run_dir>\claude\out\trace.json" | ConvertFrom-Json
$trace.modelReadback | ConvertTo-Json | Out-File -Encoding utf8 "$T\windows-trace-model-readback.json"
Get-Content -Encoding UTF8 "$T\windows-trace-model-readback.json"
```

`<run_dir>` 是 `windows-review-start.json` 里 `run_dir` 的值。

**通过判据**

| 项 | 期望 |
| --- | --- |
| claude 侧 | 正常交卷 |
| `model_effective` | `qwen3.8-max[1m]`（带后缀；不是 `null`、不是 `<redacted-env>`） |
| `model_effective_source` | `envelope` |
| `family_comparisons` 里 claude 一侧的 `right_model` / `right_source` | 同上模型名 / `envelope` |
| `trace.json` 的 `modelReadback` | `init` 为 `qwen3.8-max[1m]`，`reported` 为 `["qwen3.8-max"]`，`consistent` 为 `true` |

> 若 `consistent` 为 `false`：说明网关回报的模型名既不是 `init.model`、也不是剥掉后缀的基名——不判不通过（生效模型照记 `init.model`，这一格只留痕），但请把 `windows-trace-model-readback.json` 发我，我据此判断网关是否改写了模型名。

## 4. 落盘扫描（凭据零命中、模型名只报 NOTE）

```powershell
node "$E257\scan-gateway-exposure.mjs" .trivium "<run_dir>" .reviews\ev258-win-claude $T 2>&1 | Out-File -Encoding utf8 "$T\windows-scan.txt"
echo "exit=$LASTEXITCODE"
Get-Content -Encoding UTF8 "$T\windows-scan.txt"
```

扫描脚本只打印键名与命中文件，不打印任何值；它导入的是新构建的 `gatewayScrubPlan`，所以带后缀的模型名键这次应列在「豁免模型名键」里。

**通过判据**：首行「豁免模型名键」包含上面五个带后缀的键；没有 `LEAK` 行；末行 `RESULT: no leak`、退出码 0。`NOTE` 行（模型名键的值出现在审查文档、探针原文里）是预期的。

## 5. 交回

```powershell
Copy-Item "$T\windows-*" $E
Remove-Item tmp-ev258.txt
```

临时主题目录 `.reviews\ev258-win-claude` 按惯例自行清理（不要提交）。把 `$E` 下新生成的 `windows-*` 文件发我（不含任何凭据值：doctor 与审查输出对凭据逐值脱敏，两个脚本只写键名、长度与模型名）。我据此回填测试报告 §8 与 BACKLOG EV-258。任一项不符合期望，原样发我，不要重试。
