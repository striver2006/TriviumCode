# EV-257 Windows 真实网关验收清单

- 主题：网关回读模型脱敏（BACKLOG EV-257）
- 执行人：用户，在 Windows 开发机上（本机层 `.trivium/config.local.yaml` 已开 `agents.claude.settings_env_source: user_settings`，CC Switch 网关）
- **会动用凭据、花配额**：doctor 一次（主探针约十次模型调用 + 目录臂 7 次）、claude 作审核者的真实审查一次（上次约 10 分钟）。
- 为什么要在 Windows 上验：开发机 macOS 没开 `settings_env_source`，真实网关形态只有 Windows 机器有。本机零配额验收（新旧构建对拍 28 项、扫描器自检 3 格）已在 macOS 用假 CLI 做完，见同目录 `accept-readout.txt`、`scan-self-test-macos.txt`。
- 要验的事：网关回报的模型名不再被吞成 `<redacted-env>`——探针原文与审查文档里记真实模型名、来源 `envelope`；凭据类键（`ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_BASE_URL` 等）的值照旧零命中。

## 0. 准备

每个 PowerShell 窗口开头先执行（Windows PowerShell 5.1 默认按 GBK 解码 node 输出，见 EV-256 清单）：

```powershell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$E = "doc\05_testing\evidence\gateway-readback-model-20261025"
$T = "$env:TEMP\ev257"
New-Item -ItemType Directory -Force $T | Out-Null
```

> **全程的输出都先写到 `$T`（仓库外）**，第 4 步再统一拷进证据目录。审查运行期间往工作树里写任何文件都会被跑后复算判成漂移、整次运行作废（EV-256 第 4 步撞过）。

1. 拉取含 EV-257 的提交，按惯例构建并重装（重装后安装副本与仓库构建的 sha256 应一致）。
2. 构建测试产物（扫描脚本直接导入产品的分类函数，不另写口径）：`node scripts\build.mjs --with-tests`
3. 确认本机层配置：`Select-String -Path .trivium\config.local.yaml -Pattern settings_env_source` 应命中 `user_settings`。
4. 扫描器自检（零配额，不读你的 settings.json）：

   ```powershell
   node "$E\scan-gateway-exposure.mjs" --self-test 2>&1 | Out-File -Encoding utf8 "$T\windows-scan-self-test.txt"
   echo "exit=$LASTEXITCODE"
   ```

   期望三格全 `✓`、末行 `SELF-TEST PASS`、退出码 0。不通过就停下把文件发我。

## 1. doctor（探针侧回读）

```powershell
.\.trivium\bin\trivium.cmd doctor --only claude --json 2>&1 | Out-File -Encoding utf8 "$T\windows-doctor.json"
echo "exit=$LASTEXITCODE"
Select-String -Path "$T\windows-doctor.json" -Pattern '"model_flag"'
(Select-String -Path "$T\windows-doctor.json" -Pattern 'model\\":\\"<redacted-env>').Count
Select-String -Path "$T\windows-doctor.json" -Pattern 'model\\":\\"[^<\\]+' | Select-Object -First 3
```

**通过判据**

| 项 | 期望 |
| --- | --- |
| doctor 退出码 | 0 |
| `notes` | 有一条「[claude] 网关 env 经子进程环境变量注入（N 键；不进命令行，**凭据值**不落留痕）…」；若还是「值不落留痕」，装的是旧构建 |
| 探针原文里的 `\"model\":\"<redacted-env>\"` | **0 处**（修复前每条 init 事件都是它） |
| 探针原文里的 `\"model\":\"…\"` | 是网关模型名（上次是 `kimi-for-coding` 一族） |
| `model_flag` | `true`（本机层给 claude 配的模型 slug 与网关回报名相同时）；若为 `false`，把配置的 slug 与原文里的模型名一起发我核对；**为 `null` 即回读仍被吞，判不通过** |
| `readonly_flags` / `readonly_breach` / `directory_deny_verified` | 与 EV-256 验收时相同（非空 / 不为 true / 有结论） |

## 2. 一次 claude 作审核者的真实审查（审查调用的回读）

在仓库根建一个临时文件作被审对象（**不要提交**），用非 claude 的 Driver 只选 claude 一侧发起代码审：

```powershell
Set-Content -Encoding utf8 tmp-ev257.txt "EV-257 Windows 验收用的临时文件，审完删除。"
.\.trivium\bin\trivium.cmd review --start --entry B --stage code --topic ev257-win-claude --driver codex --critics claude --focus "只核对这个临时文件的措辞" --json 2>&1 | Out-File -Encoding utf8 "$T\windows-review-start.json"
Get-Content "$T\windows-review-start.json"
```

记下 `run_id`，然后反复等待，直到退出码不是 73：

```powershell
.\.trivium\bin\trivium.cmd review --wait <run_id> --timeout 180 --json 2>&1 | Out-File -Encoding utf8 -Append "$T\windows-review-wait.txt"
echo "exit=$LASTEXITCODE"
```

审完（退 0，或退 1 也照样往下做）后：

```powershell
Copy-Item (Get-ChildItem .reviews\ev257-win-claude\code\*-claude.md | Select-Object -First 1).FullName "$T\windows-review-claude.md"
Select-String -Path "$T\windows-review-claude.md" -Pattern '^model_effective|right_model|right_source'
```

**通过判据**

| 项 | 期望 |
| --- | --- |
| claude 侧 | 正常交卷（`state: ok`） |
| `model_effective` | 网关模型名（不是 `<redacted-env>`、不是 `null`） |
| `model_effective_source` | `envelope` |
| `family_comparisons` 里 claude 一侧的 `right_model` / `right_source` | 同上模型名 / `envelope` |

> 若 `model_effective` 是 `null` 且来源 `unverified`：说明网关回报的模型名被判为带脱敏痕迹或没被豁免——**不是**旧缺陷复现（旧缺陷是占位符 + `envelope`）。把审查文档与 doctor 输出一起发我，我据此判断是哪道守卫拦下的。

## 3. 落盘扫描（凭据零命中、模型名只报 NOTE）

```powershell
node "$E\scan-gateway-exposure.mjs" .trivium "$env:USERPROFILE\.trivium\runs\<本次运行目录>" .reviews\ev257-win-claude $T 2>&1 | Out-File -Encoding utf8 "$T\windows-scan.txt"
echo "exit=$LASTEXITCODE"
Get-Content "$T\windows-scan.txt"
```

`<本次运行目录>` 是 `windows-review-start.json` 里 `run_dir` 的值。扫描脚本只打印键名与命中文件，不打印任何值。

**通过判据**：首行列出的「豁免模型名键」应包含 CC Switch 写的那几个模型名键；没有 `LEAK` 行；末行 `RESULT: no leak`、退出码 0。`NOTE` 行（模型名键的值出现在审查文档、探针原文里）是**预期的**——修复的就是这个。

可选：进程表采样沿用 EV-256 的旧脚本（命令行里本就不该出现任何网关值）：在第 2 步发起前另开窗口跑 `& ".\doc\05_testing\evidence\gateway-env-injection-20261025\check-gateway-exposure.ps1" -Watch 900 2>&1 | Out-File -Encoding utf8 "$T\windows-watch-review.txt"`，期望 `RESULT: no leak`。

## 4. 交回

```powershell
Copy-Item "$T\windows-*" $E
Remove-Item tmp-ev257.txt
```

临时主题目录 `.reviews\ev257-win-claude` 按惯例自行清理（不要提交）。把 `$E` 下新生成的 `windows-*` 文件发我（不含任何凭据值：doctor 与审查输出本就对凭据逐值脱敏，扫描脚本只写键名）。我据此回填测试报告、BACKLOG EV-257 与 Bug 清单 §3.1 第 14 条的「Windows 真实网关形态已验」。任一项不符合期望，原样发我，不要重试。
