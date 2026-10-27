# 1.3.2 Windows 发版清单

- 执行人：用户，在 Windows 开发机上
- 前提：macOS 侧已提交发布提交、打附注标签 `v1.3.2`、建分支 `1.3.2` 并推送 origin；macOS 正式包由 Claude 在 Mac 上从干净工作树打出，`.tar.gz` 与 `.sha256` 已入库 `main` 的 `releases/1.3.2/`（第 6 步拉取即得）
- 不花配额：本清单只有构建、测试、打包、零配额自检与手册 PDF，没有带模型调用的步骤

## 0. 准备

每个 PowerShell 窗口开头先执行（Windows PowerShell 5.1 默认不按 UTF-8 读写）：

```powershell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$T = "$env:TEMP\rel132"
New-Item -ItemType Directory -Force $T | Out-Null
```

全程输出先写到 `$T`（仓库外），落文件一律 `Out-File -Encoding utf8`，读文件一律 `-Encoding UTF8`。正式包要求干净的工作树：打包之前不要往仓库里写任何文件。

## 1. 切到发布提交

标签 `v1.3.2` 在 2026-10-27 由 `bf4bf556` 移到了 `bd5c0635`（含 Windows ZIP 改用系统 tar 的修复），已拉过旧标签的机器要带 `--force` 才会更新：

```powershell
git fetch origin --tags --force
git checkout v1.3.2
git status --short
git rev-parse HEAD
git rev-parse "v1.3.2^{commit}"
```

`git status --short` 应为空，两个 `rev-parse` 相同。

## 2. 全量检查

```powershell
npm run check 2>&1 | Out-File -Encoding utf8 "$T\windows-check.txt"
echo "exit=$LASTEXITCODE"
Select-String -Encoding UTF8 -Path "$T\windows-check.txt" -Pattern '^ℹ (tests|pass|fail|skipped)'
```

照实记录读数。Windows 上全量有登记在案的负载底噪红格（Bug 清单 §3.1 第 13 条），红了不要重试刷绿，把文件发我、由我对照登记判读。

## 3. 正式包

```powershell
npm run release 2>&1 | Out-File -Encoding utf8 "$T\windows-release.txt"
echo "exit=$LASTEXITCODE"
Get-Content -Encoding UTF8 "$T\windows-release.txt" | Select-Object -Last 8
```

期望退出码 0，输出里 `version` 为 `1.3.2`、`candidate` 为 `false`，产出 `dist\releases\TriviumCode-1.3.2-windows-x64.zip` 与对应 `.sha256`。核对包内发布信息：

```powershell
Expand-Archive dist\releases\TriviumCode-1.3.2-windows-x64.zip "$T\pkg" -Force
Get-Content -Raw -Encoding UTF8 (Get-ChildItem "$T\pkg" -Recurse -Filter 发布信息.json | Select-Object -First 1).FullName
```

`release_state` 为 `stable`、`source_commit` 等于第 1 步的 HEAD、`source_dirty` 为 `false`、`platform` 为 `windows`。

## 4. 解压包的一键安装自检（零配额）

在解压出来的包目录里运行 `一键安装.cmd`，输出另存：

```powershell
Push-Location (Get-ChildItem "$T\pkg" -Directory | Select-Object -First 1).FullName
.\一键安装.cmd 2>&1 | Out-File -Encoding utf8 "$T\windows-quick-install.txt"
echo "exit=$LASTEXITCODE"
Pop-Location
Get-Content -Encoding UTF8 "$T\windows-quick-install.txt" | Select-Object -Last 15
```

期望退出码 0、装后版本 `1.3.2`、`doctor --selftest` 14/14。注意这一步会覆盖本机的全局安装（等同重装 1.3.2）。

## 5. 完整手册 PDF

```powershell
node scripts\build-manual-pdf.mjs --out "$T\TriviumCode-1.3.2-完整手册.pdf" 2>&1 | Out-File -Encoding utf8 "$T\windows-pdf.txt"
echo "exit=$LASTEXITCODE"
```

PDF 第四部分「增补篇」本次加了「七、1.3.x 增量」一节。打开核一眼目录与页数。

## 6. 回到 main，把 Windows 包、PDF 与输出放进仓库

正式包按版本入库 `releases/1.3.2/`（2026-10-27 起，见 `releases/README.md`）；macOS 包已由 Claude 提交在那里。

```powershell
git checkout main
git pull --ff-only origin main
Copy-Item dist\releases\TriviumCode-1.3.2-windows-x64.zip, dist\releases\TriviumCode-1.3.2-windows-x64.zip.sha256 releases\1.3.2\
Copy-Item "$T\TriviumCode-1.3.2-完整手册.pdf" releases\1.3.2\
Copy-Item "$T\windows-check.txt", "$T\windows-release.txt", "$T\windows-quick-install.txt", "$T\windows-pdf.txt" doc\05_testing\evidence\release-132-20261027\
(Get-FileHash releases\1.3.2\TriviumCode-1.3.2-macos.tar.gz -Algorithm SHA256).Hash.ToLower()
Get-Content releases\1.3.2\TriviumCode-1.3.2-macos.tar.gz.sha256
```

最后两行的哈希应相同（`3d2492fa1de0b9c345c272faedfcdad6f61d6b4b7191b74c47495d593736d4d3`）。然后按文件名逐个 `git add`、提交、推送。前一次打出的那个「.zip」实际是 tar 归档，不要放进来。

## 7. Release 附件

在代码托管平台的 `v1.3.2` 标签上建 Release，从 `releases\1.3.2\` 上传：

- `TriviumCode-1.3.2-windows-x64.zip` 与 `.sha256`
- `TriviumCode-1.3.2-macos.tar.gz` 与 `.sha256`
- `TriviumCode-1.3.2-完整手册.pdf`

Release 说明可直接用 `doc/08_project/发布说明.md` 的 1.3.2 一节。完成后告诉我，我据此回填《发布检查报告》1.3.2 一节的 Windows 侧。任一步不符合期望，原样发我，不要重试。
