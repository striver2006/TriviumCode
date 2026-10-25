# EV-256 Windows 真实网关验收清单

- 主题：网关凭据改环境变量注入（Bug 清单 §3.1 第 14 条，BACKLOG EV-256）
- 执行人：用户，在 Windows 开发机上（本机层 `.trivium/config.local.yaml` 已开 `agents.claude.settings_env_source: user_settings`，CC Switch 网关）
- **会动用凭据、花少量配额**：doctor 一次（主探针约十次模型调用 + 目录臂 7 次）、预检探活一次；可选的真实审查一次。
- 为什么要在 Windows 上验：开发机 macOS 没开 `settings_env_source`，真实网关形态只有 Windows 机器有。本机零配额验收（新旧构建对拍、进程表采样）已在 macOS 用假 CLI 做完，见同目录 `accept-readout.txt`。

## 0. 准备

1. 拉取含 EV-256 的提交，按惯例构建并重装（重装后安装副本与仓库构建的 sha256 应一致）。
2. 确认本机层配置：`Select-String -Path .trivium\config.local.yaml -Pattern settings_env_source` 应命中 `user_settings`。
3. 检查脚本 `check-gateway-exposure.ps1`（本目录）只读、只输出键名与计数，不打印任何值。先空跑一次确认它能读到键：

   ```powershell
   .\doc\05_testing\evidence\gateway-env-injection-20261025\check-gateway-exposure.ps1
   ```

   应输出「gateway keys to check: N (…)」，N ≥ 1，退出码 0。若退 2，说明 settings.json 的 env 段为空或值太短，后面的检查没有意义，先停下告诉我。

## 1. doctor（探针各臂与目录臂）

开两个 PowerShell 窗口，都在仓库根。

- 窗口 B **先**启动采样（300 秒够 doctor 跑完；不够就加长）：

  ```powershell
  .\doc\05_testing\evidence\gateway-env-injection-20261025\check-gateway-exposure.ps1 -Watch 300 *> doc\05_testing\evidence\gateway-env-injection-20261025\windows-watch-doctor.txt
  ```

- 窗口 A 随即：

  ```powershell
  .\.trivium\bin\trivium.cmd doctor --only claude --json *> doc\05_testing\evidence\gateway-env-injection-20261025\windows-doctor.json
  echo "exit=$LASTEXITCODE"
  ```

**通过判据**

| 项 | 期望 |
| --- | --- |
| doctor 退出码 | 0 |
| `notes` | 有一条「[claude] 网关 env 经子进程环境变量注入（N 键；不进命令行，值不落留痕）…」；若写的是「经 --settings 内联注入」，装的还是旧构建 |
| `probe.cli.claude.readonly_flags` | 非空 |
| `probe.cli.claude.readonly_breach` | 不为 true |
| `probe.cli.claude.directory_deny_verified` | 有结论（不是 `{}`） |
| `blockers` | 不含鉴权失败、「未登录」一类 |
| `windows-watch-doctor.txt` | 无 `LEAK` 行；「claude executables」计数 ≥ 1；末行 `RESULT: no leak`、退出码 0 |

doctor 跑完后扫一遍探针落盘与 doctor 输出：

```powershell
.\doc\05_testing\evidence\gateway-env-injection-20261025\check-gateway-exposure.ps1 -Scan .trivium,doc\05_testing\evidence\gateway-env-injection-20261025\windows-doctor.json *> doc\05_testing\evidence\gateway-env-injection-20261025\windows-scan-doctor.txt
```

期望 `RESULT: no leak`。

## 2. 预检探活（`invokeClaude` 的探活形态）

```powershell
.\.trivium\bin\trivium.cmd preflight --stage code --driver codex --critics claude --json *> doc\05_testing\evidence\gateway-env-injection-20261025\windows-preflight.json
echo "exit=$LASTEXITCODE"
```

期望退出码 0，「Claude Code 已认证」一格为「探活通过」。（预检若因别的原因退 69，把 JSON 发我，不要自行重跑 doctor 以外的东西。）

## 3. 可选：一次真实审查（审查调用 `claudeAdapter.run`）

审查调用与探活、目录臂走同一个出口 `invokeClaude`，第 1、2 步已覆盖这条出口；想再加一道真实审查，就在任意小改动上从非 claude 的 Driver 发起一次 `--critics claude` 的代码审，期间在另一窗口跑 `-Watch 600`，审完对本次运行目录与 `.reviews\` 跑 `-Scan`：

```powershell
.\doc\05_testing\evidence\gateway-env-injection-20261025\check-gateway-exposure.ps1 -Scan "$env:USERPROFILE\.trivium\runs\<本次运行目录>",.reviews *> doc\05_testing\evidence\gateway-env-injection-20261025\windows-scan-review.txt
```

期望两份输出都是 `RESULT: no leak`，审查侧 claude 结论正常落盘。

## 4. 交回

把本目录下新生成的 `windows-*.json` / `windows-*.txt` 发我（这些文件里不含任何键值：doctor 输出本就逐值脱敏，检查脚本只写键名）。我据此在 Bug 清单 §3.1 第 14 条与测试报告里补「Windows 真实网关形态已验」。任一项不符合期望，原样发我，不要重试。
