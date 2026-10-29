# Windows 四家 Agent 真机与客户端验收任务

编制日期：2026-10-29。负责人：Bob；执行人：Windows 端测试人员或受托 Driver；记录人：当轮执行人。

**状态：任务已编制，尚未执行。本文所有 Windows、桌面客户端、真实模型用例均为「未测」。** 本文不启动双审、不授权自动审批、不代表发布验收通过。

## 1. 目标、基线与结论边界

### 1.1 测什么

验证四家收口后的 TriviumCode 在 Windows 原生环境下能否完成安装、探测、真实审查、原生客户端入口调用、结果归档和人工停点，并核验 Windows 原子写重试、进程观察和取消行为。

| 项目 | 固定口径 |
| :--- | :--- |
| 被测源码 | `4bd1d0d50d15d9641156598487bea7fcae5f751f`，四家收口后的 main 提交 |
| 产品版本字段 | `1.3.2`；版本号相同不表示构建相同，必须同时记录完整 SHA 与 bundle SHA256 |
| 历史分支 | `1.3.2` 的 `642a238e60b0e6b537f3b4e2af12f41982c55fe7` 仅作对照，不是本任务被测对象 |
| 支持对象 | Codex、Claude Code、ZCode（GLM）、Antigravity（Gemini） |
| 明确排除 | Kimi Code / Qoder CN 客户端接入、重新启用候选 Agent、生产项目审查、正式发版 |
| 现有证据 | [四家收口报告](./REPORT_2026-10-29_四家Agent支持范围收口.md)中的 macOS 检查、自检与安装结果；不能替代本次 Windows 验收 |

若执行时 main 已更新，先记录差异：要验证本文基线，仍用上述 SHA；要验证更新后的 main，先修订任务中的完整 SHA、变更范围和用例，再开始新的批次。不能执行中途切换版本后把结果合并为一轮。

### 1.2 分开出具四种结论

1. **Windows 编排器回归**：构建、自动化测试、零配额自检、Windows 特有行为。
2. **真实审核者链路**：每一家实际 CLI、认证、请求路由、工具轨迹、审查归档。
3. **原生客户端 Driver 入口**：在对应桌面／IDE／CLI 会话中加载技能并执行；逐客户端形态记录。
4. **实际模型身份**：请求值、配置声明、运行回读分别取证。没有底层回读时填 `unknown`，不能据 UI 名称推定模型。

例如：Claude Code 通过第三方 profile 调用其他模型，只能证明该客户端与该路线可用；不能据此宣布 Anthropic 官方模型通过。Codex 客户端通过也不等于所有 OpenAI 模型通过。

### 1.3 验收范围与执行层级

| 层级 | 内容 | 依赖 | 允许的结论 |
| :--- | :--- | :--- | :--- |
| W0 | 环境、基线与证据目录 | 无 | 基线可追溯 |
| W1 | 自动化、安装、自检、Windows 特性 | W0 | Windows 编排器验证结果 |
| W2 | 四家探针、认证、各一次真实单侧 B 审查 | W1 关键项通过 | 已测路线的审核者能力 |
| W3 | 四家原生客户端 B 入口 | 对应 W2 路线可用 | 对应客户端形态的 Driver 能力 |
| W4 | 多审、取消、只读与 Hook 边界 | 对应单侧已准入 | 所列组合与护栏用例结果 |
| W5 | A / C / D 与审批后续流程扩展 | W2～W4；人工审批按实际阶段发起 | 所列入口全流程结果 |

W0～W4 是本次基础验收范围。W5 是宣称「A/B/C/D 全流程已验收」的必要扩展，未做就明确保留缺口。某客户端缺失，只阻塞该格及其依赖，不把另外三家已完成的证据抹掉；也不能把三家结果写成四家通过。

## 2. 人员、环境、时间和预算

### 2.1 分工及开工条件

- Bob：指定 Windows 机器、实际需要支持的客户端形态、四家模型路线与配额上限；在实际人工停点决定通过／拒绝／放弃。
- Windows 执行人：建隔离夹具、执行命令、观察真实客户端、保留失败现场、整理脱敏证据。
- 代码维护人：接收问题单。验收中不直接修生产源码；修复另起变更、形成新 SHA 后安排复测。

本文是执行任务书。未来获授权开始测试时，可按本文开展隔离测试；**本文的编写不代表已经获得真实调用预算，也不替代每个实际审批停点的人工决定**。已有明确测试范围与预算授权不重复询问，仅补齐缺失信息。

### 2.2 环境矩阵

| 项目 | 主验收机 | 扩展机／扩展场景 |
| :--- | :--- | :--- |
| 系统 | Windows 11 原生，记录版本、Build、架构 | 若宣称 Windows 10 支持已验证，必须补 Windows 10 原生实机；未做填未测 |
| Node | 开发／测试使用 Node 22 系列，记录实际完整版本与绝对路径 | 其他 Node 版本另列，不从本轮外推 |
| Git | Git for Windows，记录 `git`、`sh` 路径与版本 | 不以 WSL 的 Git 代替 |
| Shell | PowerShell 5.1 或 7，记录版本；Git Bash 必须可用 | cmd 包装器冒烟，Git Bash 复杂参数冒烟 |
| 工作目录 | 本机 NTFS、普通用户、非同步目录 | 独立「中文 空格」路径夹具；网络盘／OneDrive 非本轮默认范围 |
| 客户端 | 四家逐一记录实际安装版本、启动方式、插件宿主版本 | CLI、独立桌面、IDE 插件分别列格，不互相替代 |
| 账号网络 | 由用户在私有界面完成登录，记录可用性 | 不采集密码、Token、完整 auth/config 文件 |

Windows 原生 VM 可以形成单独的 Windows 虚拟机结果，但本任务所需「真机」应在实际 Windows 设备执行，并记录硬件/虚拟化属性。macOS、WSL、容器结果不能填进 Windows 真机通过栏。

建议安排：W0～W1 半天，W2～W3 半天至一天，W4～W5 另留半天至一天；这是排期估计，不是超时保证。账号不可用、客户端缺失及失败诊断时间单列。

### 2.3 真实调用预算与停止条件

开工前填一张 `budget.md`：授权人、总金额上限、每家上限、开始／截止时间、允许的用例、是否包括 Driver 会话费用。未填预算的真实调用步骤保持未测；离线部分仍可执行。

基础批次预排：四个真实 doctor 作业、四个认证预检作业、W2 四个单侧 B、W3 最多四个单侧 B、W4 一个三侧 B 和一个取消用例。W2 与 W3 如在同一次真实原生会话中满足双方全部证据，可复用；否则基础审查预算最多 **12 个审核者侧次**，不含 W4 额外安全控制实验及 W5。

**作业数、审核者侧次不等于 API 请求次数。** doctor、认证、审查内部可能多次调用；Driver 会话也消耗配额。逐项记录实际账单或客户端 usage，无法核实填 `unknown`，不能把无账单写成零费用。W4 额外控制实验、W5 与失败复跑均需纳入明确的新增额度，默认不重跑。

单侧 B 指定 `--max-rounds 1`，禁止自动增加轮次、切换备用 profile 或换模型求通过。doctor 总时限建议 600 秒，允许范围为 30～900 秒。review 使用返回的等待预算与取消机制；超时不能用无限轮询消耗预算。

遇到凭据泄露、只读失守、意外修改真实项目、路线回退、预算到顶、进程失控时，停止相关调用，保存现场，取消本次运行；其余不依赖该问题的离线任务可继续。禁止以关闭安全软件、管理员提权、绕过权限或关闭 Hook 换取通过。

## 3. W0：准备固定源码与证据空间

### 3.1 PowerShell 通用记录约定

以下命令在 Windows PowerShell 中执行。`<...>` 都是待填写值，不可原样运行。脚本保存为 `.ps1` 时，PowerShell 5.1 含中文的脚本使用 UTF-8 BOM；日志统一明确指定 UTF-8。不要转储全量环境变量或用户配置。

```powershell
$ErrorActionPreference = 'Stop'
$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $Utf8NoBom
$OutputEncoding = $Utf8NoBom
$Baseline = '4bd1d0d50d15d9641156598487bea7fcae5f751f'
$Batch = 'four-agent-win-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
$Repo = "C:\Work\TriviumCode-$Batch"
$Evidence = "C:\Work\TriviumCode-evidence\$Batch"
$FixtureBase = "C:\Work\TriviumCode-fixtures\$Batch"
if ((Test-Path $Repo) -or (Test-Path $Evidence) -or (Test-Path $FixtureBase)) {
    throw '本批目录已存在，请使用新的批次标识，不覆盖旧证据'
}
New-Item -ItemType Directory -Path $Evidence, $FixtureBase | Out-Null

# 仅用于下面的原生外部程序；不要在此包装 PowerShell cmdlet。
function Invoke-Logged {
    param([string]$Name, [string]$Exe, [string[]]$Argv)
    $Log = Join-Path $Evidence ($Name + '.log')
    $Meta = Join-Path $Evidence ($Name + '.meta.json')
    if ((Test-Path $Log) -or (Test-Path $Meta)) { throw '证据文件已存在' }
    $Begin = (Get-Date).ToUniversalTime().ToString('o')
    $SavedPreference = $ErrorActionPreference
    $Exit = $null
    $LaunchError = $null
    try {
        # PowerShell 5.1 的原生 stderr 可能成为 ErrorRecord；保留它，不因警告中断记录。
        $ErrorActionPreference = 'Continue'
        $global:LASTEXITCODE = $null
        & $Exe @Argv 2>&1 | Out-File -FilePath $Log -Encoding utf8
        $Exit = $LASTEXITCODE
    } catch {
        $LaunchError = $_.Exception.Message
    } finally {
        $ErrorActionPreference = $SavedPreference
    }
    [ordered]@{
        name=$Name; cwd=(Get-Location).Path; executable=$Exe; arguments=$Argv
        started_at=$Begin; ended_at=(Get-Date).ToUniversalTime().ToString('o')
        exit_code=$Exit; launch_error=$LaunchError
    } | ConvertTo-Json -Depth 5 | Out-File -FilePath $Meta -Encoding utf8
    if ($null -eq $Exit -or $Exit -ne 0 -or $LaunchError) {
        throw "$Name 未成功；先查看原始记录，不继续依赖步骤"
    }
}
```

此函数在命令结束后写记录，不负责超时或进程树监督。长任务由另一个终端观察；外部工具无法启动时记录 `exit_code: null` 与错误，不能猜为 0。日志落盘失败本身也算取证失败。预期非零的负向用例使用单独记录方法，保存真实退出码后按用例判据判断，不拿此函数的异常当产品失败。

### 3.2 独立克隆与基线核验

从原仓库 `git remote get-url origin` 取得正确地址，先检查 URL 中没有内嵌凭据，再将地址填写到 `$OriginUrl`。以下只操作新建测试副本，不切换原工作仓库分支。

```powershell
$OriginUrl = '<已核对且不含凭据的 origin 地址>'
Invoke-Logged '00-clone' 'git.exe' @('clone', '--branch', 'main', $OriginUrl, $Repo)
Set-Location $Repo
Invoke-Logged '01-checkout' 'git.exe' @('checkout', '--detach', $Baseline)
$Actual = (& git.exe rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $Actual -ne $Baseline) { throw '源码基线不一致' }
$Dirty = & git.exe status --porcelain
if ($LASTEXITCODE -ne 0 -or $Dirty) { throw '测试源码工作树不干净' }
Invoke-Logged '02-baseline' 'git.exe' @('show', '-s', '--format=fuller', 'HEAD')
```

不要执行旧版任务里的 `checkout v1.3.2`、`fetch --tags --force` 或覆盖 `releases/1.3.2`。测试本次源码不需要修改标签、版本号、远端或旧安装包。

### 3.3 环境留痕

```powershell
Get-CimInstance Win32_OperatingSystem |
    Select-Object Caption, Version, BuildNumber, OSArchitecture |
    ConvertTo-Json | Out-File "$Evidence\environment-os.json" -Encoding utf8
$PSVersionTable | Out-String | Out-File "$Evidence\environment-shell.txt" -Encoding utf8
Get-Command node.exe, npm.cmd, git.exe, sh.exe |
    Select-Object Name, Source |
    ConvertTo-Json | Out-File "$Evidence\environment-paths.json" -Encoding utf8
Invoke-Logged '03-node' 'node.exe' @('--version')
Invoke-Logged '04-npm' 'npm.cmd' @('--version')
Invoke-Logged '05-git' 'git.exe' @('--version')
Invoke-Logged '06-sh' 'sh.exe' @('--version')
```

核对 `sh.exe` 来自 Git for Windows；若 PATH 指向其他实现，先记录并在测试会话显式选定正确路径，不悄悄改全局 PATH。记录时间同步、机器标识的脱敏代号、NTFS、普通用户及实际防病毒产品状态；不要求关闭防病毒。

## 4. W1：零模型回归、安装和 Windows 特性

### 4.1 自动化与构建

在 `$Repo` 执行：

```powershell
Invoke-Logged '10-npm-ci' 'npm.cmd' @('ci')
Invoke-Logged '11-check' 'npm.cmd' @('run', 'check')
Invoke-Logged '12-render' 'npm.cmd' @('run', 'render')
Invoke-Logged '13-render-diff' 'git.exe' @('diff', '--exit-code', '--', 'skills', 'skills-src')
Invoke-Logged '14-four-agent-scope' 'node.exe' @('--test', 'dist/test/test/integration/four-agent-scope.test.js')
Invoke-Logged '15-selftest' 'node.exe' @('skills/dual-critic/scripts/trivium.cjs', 'doctor', '--selftest', '--keep-fixture')
Get-FileHash 'skills/dual-critic/scripts/trivium.cjs', 'dist/install.cjs' -Algorithm SHA256 |
    ConvertTo-Json | Out-File "$Evidence\source-bundle-hashes.json" -Encoding utf8
```

`npm run check` 自带测试构建；若改为单独执行构建后测试，必须用 `node scripts/build.mjs --with-tests`，普通 build 不保证测试产物新鲜。全文日志放仓库外，避免影响快照与测试计数。

通过条件：退出码为 0；记录 pass/fail/cancelled/skipped 的实际数量与跳过原因；生成入口零漂移；四家集合与已移除身份拒绝测试通过；自检明确 14 步结果。自检为桩调用，**不证明真实厂商可用**。旧 macOS 的 4032 项总数只供变化核查，不能强求 Windows 的 pass/skip 分布完全相同。

全量测试的首个失败必须保留。只可针对已经定位的失败文件做一次具名诊断复跑，并同时报告原失败；禁止用反复全量运行、删掉慢测、调低门槛或套用历史 flaky 豁免变成通过。测试运行器当前逐测超时为 600000ms；监督全量任务不能随意套 90 秒总时限。自检若停滞，保存已完成步骤及现场，先诊断再决定下一步。

### 4.2 安装与新夹具

安装会写四家用户级技能目录与运行时。先列出目标目录，检查已有同名技能来源，备份待覆盖的 TriviumCode 自有文件并记录哈希；遇到非本项目同名文件停止安装该目标并报告。不得整目录删除用户自定义技能、全局账号或厂商配置。

```powershell
# 只清当前测试进程里的资产根覆盖，防止把仓库当安装目标。
Remove-Item Env:TRIVIUM_ASSET_ROOT -ErrorAction SilentlyContinue
Invoke-Logged '16a-install-precheck' 'npm.cmd' @('run', 'install:check')
Invoke-Logged '16-install' 'node.exe' @('dist/install.cjs')
Invoke-Logged '17-install-check' 'npm.cmd' @('run', 'install:check')
```

`install:check` 检查名称冲突与残留，不等于验证四家均已安装。核验实际安装输出、四家技能正文及 runtime 路径；某家被 installer 跳过应逐项记明。以安装器输出的真实运行时路径计算 SHA256，和上节源码 bundle 比较；不得只检查 `--version`。运行时应包含当前四家入口，无候选接入入口。若旧 Kimi/Qoder 用户目录仍残留本项目资产，单独登记；只有确认本项目所有权、备份并获得该清理范围授权后才能删除，不能清空厂商目录。

每个会进入审批停点的用例建独立 Git 夹具，例如 `$FixtureBase\W2-codex-claude`。这是预先独立的用例，不用于逃避已有主题的停点。夹具至少含下列文件，并作本地初始提交，不设远端：

| 文件 | 最小内容及用途 |
| :--- | :--- |
| `src/sum.cjs` | 导出 `sum(a,b)`，初始仅做 `a + b` |
| `test/sum.test.cjs` | Node 内建测试，覆盖正常两个数的加法 |
| `README.md` | 用法与测试命令 `node --test test/sum.test.cjs` |
| `requirements.md` | 需求：只接收有限 number；拒绝字符串、NaN、Infinity；允许负数和小数 |
| `task.md` | 本用例目标、边界、验收标准；不是伪造的计划稿或根因稿 |

初始化顺序：创建文件 → `git init` → 必要时设置**仅夹具仓库**的 Git 作者信息 → 按文件名暂存并本地提交 → 在夹具目录调用 `$Repo\skills\dual-critic\scripts\trivium.cjs init` → 检查生成配置与入口。不得复制原仓库 `.trivium/state.json`、审批状态或历史审查工件。

将夹具 `.trivium/config.local.yaml` 的 `runtime.run_root` 设为本批专属绝对路径，例如 `C:/Work/TriviumCode-fixtures/<批次>/runs/W2-codex-claude`，不与其他用例共享运行根。配置中的模型、profile、effort 只按已确认路线填写，保留默认工具调用／项目阅读门槛，不降低以求通过。新增配置不得被下一条命令整份覆盖掉探针结果。

在夹具目录分别测试：

```powershell
.\.trivium\bin\trivium.cmd --version
.\.trivium\bin\trivium.cmd status --json
.\.trivium\bin\trivium.cmd doctor --no-model-calls --json
```

每条记录真实退出码、stdout/stderr。检查 Windows `.cmd` 和 Git Bash 包装器存在，且指向本轮安装副本。另在 Git Bash 执行 `.trivium/bin/trivium --version`；涉及 `topic resolve -- ...`、复杂引用与参数尾部的场景优先按手册用 Git Bash，不擅自换成语义不同的 PowerShell 拼接。

### 4.3 Windows 专项清单

| ID | 操作 | 通过判据 / 必留证据 |
| :--- | :--- | :--- |
| W1-01 | 全量、生成入口、四家集合、自检 | 上述日志与退出码；旧身份拒绝；无新入口漂移 |
| W1-02 | 安装后 wrapper 调用 | 源 bundle 与安装 bundle 同哈希；四家技能可定位；路径及版本留痕 |
| W1-03 | 「中文 空格」夹具路径执行 init、status、自检 | 参数未拆散、中文路径未乱码；同名文件内容和退出码正确 |
| W1-04 | §4.4 两个真实占用句柄场景 | 短占用成功，长占用有界失败；旧文件不损坏、临时文件不残留 |
| W1-05 | 观察自动化／探针时进程树 | 无递归自触发的进程枚举风暴；采样次数、PID、创建时间、父子关系和持续时间 |
| W1-06 | `cancel-way-out` 对应测试及取消提示 | Windows 提示为 Get-CimInstance/taskkill；真正取消另由 W4 验证 |
| W1-07 | 结束后清理检查 | 测试前后临时路径清单、运行目录、活进程；保留项与异常残留分开 |

与专项对应的自动化文件包括 `fsx-write-atomic-retry`、`cancel-way-out`、`probe-section`、`scratch-cleanup`、`doctor-deadline-cli`；完整路径以固定基线 `test/` 为准。它们全量已覆盖，不需例行重复；只有诊断或单独取证需求时补跑并独立记录。

### 4.4 真实文件占用实验：必须连接本次源码

历史 [Windows 原子写报告](./REPORT_2026-10-27_windows_atomic_write_retry.md)可借用实验方法，但其 `entry.ts` 导入的是 `./fsx-src.ts` 历史快照。**直接执行历史 bundle 或原入口，不能证明本次 main。**

以下仅在本批证据目录产生新装置，不改历史证据和产品源码：

```powershell
$Atomic = Join-Path $Evidence 'atomic-live'
New-Item -ItemType Directory -Path $Atomic | Out-Null
$OldHarness = Join-Path $Repo 'doc/05_testing/evidence/windows-atomic-write-retry-2026-10-27'
$Entry = [IO.File]::ReadAllText((Join-Path $OldHarness 'entry.ts'))
$Needle = "'./fsx-src.ts'"
if (($Entry.Split([string[]]@($Needle), [StringSplitOptions]::None).Length - 1) -ne 1) {
    throw '历史装置导入不符合预期，停止并核对'
}
$CurrentFsx = (Join-Path $Repo 'src/trivium/util/fsx.ts').Replace('\', '/')
$Entry = $Entry.Replace($Needle, ("'" + $CurrentFsx + "'"))
[IO.File]::WriteAllText((Join-Path $Atomic 'entry.ts'), $Entry, $Utf8NoBom)
Copy-Item (Join-Path $OldHarness 'hold.ps1') (Join-Path $Atomic 'hold.ps1')
Invoke-Logged '18-atomic-build' (Join-Path $Repo 'node_modules/.bin/esbuild.cmd') @(
    (Join-Path $Atomic 'entry.ts'), '--bundle', '--platform=node', '--format=esm',
    "--outfile=$Atomic/bundle.mjs", "--metafile=$Atomic/inputs.json"
)
# 先核查 inputs.json 确实引用当前 Repo 的 fsx.ts，而不是 fsx-src.ts，再运行。
Invoke-Logged '19-atomic-live' 'node.exe' @((Join-Path $Atomic 'bundle.mjs'))
Get-FileHash (Join-Path $Atomic 'entry.ts'), (Join-Path $Atomic 'hold.ps1'),
    (Join-Path $Atomic 'bundle.mjs'), $CurrentFsx -Algorithm SHA256 |
    ConvertTo-Json | Out-File "$Evidence\atomic-hashes.json" -Encoding utf8
```

执行前安排第二终端监督，**两分钟无结束即记录超时并处理本实验进程树**。历史装置的 READY 等待没有完整超时兜底，不能无限等。只结束已核对 PID、创建时间与父子关系的本次 node/PowerShell 子进程，不执行全机 `taskkill /IM node.exe`。`hold.ps1` 的进程级 `ExecutionPolicy Bypass` 只用于这份已检查的实验脚本，不改变机器策略。

| 场景 | 现有装置阈值 | 额外人工核查 |
| :--- | :--- | :--- |
| A：FileShare.None 占用 400ms 后释放 | 成功；耗时 300～1500ms；内容 `updated-A`；无 `.tmp-` | 确有 READY 后计时；实际 Windows 文件句柄占用 |
| B：占用 5000ms | 有界失败；耗时 700～3000ms；原始权限／占用错误；无 `.tmp-` | **明确断言 `final_content === 'initial'`**，不能仅凭历史脚本 `ok` 字段 |

阈值来自已有装置；本轮若超阈值先记录失败和机器负载，不临场放宽。产品当前重试等待为 25/50/100/200/400ms，总退避 775ms，真实耗时还包含系统调度，不能把 775ms 当精确墙钟。保存 JSON、构建 inputs、源码与装置哈希及进程结束情况。失败导致临时目录留存时只清理本实验已登记目录，先留证再清理。

## 5. W2：四家真实审核者与模型路由

### 5.1 先建立路线表

| Agent ID | 本仓对应客户端 | doctor 的 `--only` | 请求模型 | profile / native | effort | 运行模型回读 | 状态 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `codex` | Codex | `codex` | 待填 | 待填 | 待填／不适用 | unknown | 未测 |
| `claude` | Claude Code | `claude` | 待填 | 待填 | 待填／不适用 | unknown | 未测 |
| `glm` | ZCode | `zcode` | 待填 | 待填 | 待填／不适用 | unknown | 未测 |
| `gemini` | Antigravity | `agy` | 待填 | 待填 | 待填／不适用 | unknown | 未测 |

`gemini` 在本仓不等于任意名为 Gemini 的 CLI；必须按注册表对应的 Antigravity/agy 验证。模型名称从本机客户端实际可用项和探针取得，不照抄历史报告里的型号。

Codex 缺省配置可能选中第三方 profile；`--native-codex` 只改路线，不自动清除模型和 effort。Claude 的 native 路线也不保证全局代理配置不存在。不得把 `native` 单词当官方服务或实际模型的证明。只读取必要的非敏感路由键；需要隔离账号配置时按现有适配器机制走受限权限临时副本，不改全局配置、不把副本上传。

### 5.2 真实 doctor 与预检

在独立夹具里，逐家串行执行。下例只展示公共骨架，**先依据 §5.1 添加该侧已确认的 `--model-<id>`、适用的 `--profile-<id>` 或 `--native-<id>`、适用的 `--effort-<id>` 参数**，然后记录完整脱敏 argv。不能未填路线就连续复制执行。

```powershell
.\.trivium\bin\trivium.cmd doctor --only codex --deadline-s 600 --json
.\.trivium\bin\trivium.cmd doctor --only claude --deadline-s 600 --json
.\.trivium\bin\trivium.cmd doctor --only zcode --deadline-s 600 --json
.\.trivium\bin\trivium.cmd doctor --only agy --deadline-s 600 --json
```

每次立即保存 stdout/stderr、退出码、开始结束时间及本夹具 probe 段的脱敏差异。部分段失败或超时不得被旧 probe 值掩盖；超时 76、未完成 sections、CLI 指纹和结论时间都要回传。`--no-model-calls` 结果不能替代本节。

预检选择与下一次审查完全一致的 Driver、审核者及路线。例如 Codex Driver 审 Claude：

```powershell
.\.trivium\bin\trivium.cmd preflight --stage plan --driver codex --critics claude --json
```

同样追加已确定的路线参数。不要使用 `--skip-auth-check` 作为认证通过证明；若命中缓存，记录缓存来源，不能声称产生了新真实认证调用。确有需要并在预算内才使用支持的 `--refresh-auth` 刷新认证。不存在／过期／未知的关键能力阻塞该侧，禁止静默换模型、改门槛或略过失败侧。

### 5.3 单侧 B 审查矩阵

| 用例 | Driver | 唯一审核者 | 原生会话可同时满足 W3 时 |
| :--- | :--- | :--- | :--- |
| W2-B1 | Codex | Claude | 复用为 Codex 对应客户端形态的 W3 |
| W2-B2 | Claude Code | Gemini | 复用为 Claude 对应客户端形态的 W3 |
| W2-B3 | Antigravity | GLM | 复用为 Antigravity 对应客户端形态的 W3 |
| W2-B4 | ZCode | Codex | 复用为 ZCode 对应客户端形态的 W3 |

每个用例独立夹具、独立主题、独立 run root。在对应 Driver 的正式技能入口发起 B，不直接调用厂商审核者 CLI，不绕编排器手拼 reviewer 命令。用户任务内容统一为：

> 为本夹具的 sum 输入校验需求编写实施计划并进行计划审查。读取 requirements.md、README.md、src/sum.cjs 和测试文件；先认领 plan 阶段，再按入口准备步骤生成并回读原稿；只审计划，不修改业务实现。只选指定的一家审核者，plan 最大一轮。逐条裁决；到人工审批停点后停止，等待 Bob 决定。模型和路线使用本用例已冻结参数。

例如在 Codex 原生输入框输入下列技能调用，再附上上述任务及已核对的路线参数；这是客户端消息，不是在 PowerShell 中运行的命令：

```text
$dual-review-plan 检查有限数值输入校验计划的正确性与测试覆盖 --topic Win四家B1 --critics claude --max-rounds 1 --context requirements.md,README.md,src/sum.cjs,test/sum.test.cjs
```

其余客户端按 §6.1 替换正式入口，主题与审核者按矩阵填写。显式选一侧不需要把失败降级开关 `--allow-single` 当成必需参数；本任务不以失败后自动降级替代原定用例。

原稿由该原生 Driver 依规生成，记录从用户消息到认领、原稿、resolve、预检和 start 的顺序。已有用户提供原稿的分支，另以一份用户准备的计划在新夹具测试：应读回并保留原文，不能静默重写成自己的稿；该补充格另计预算。

通过判据：

1. run 元数据中的 Driver、阶段、入选审核者、请求路线与预检一致；没有残留候选 Agent 或隐式补回其他审核者。
2. 确实启动对应厂商 CLI，记录版本、可执行路径、脱敏 argv、cwd、PID/创建时间、run ID；无桩指纹。
3. 原生工具轨迹显示实际读取项目；达到当前门槛；输出能关联到同一运行和相应审查归档，不以模型说“已读取”代替工具证据。
4. 请求、配置声明、回读分别列出；有回读时必须与请求一致；回读缺失，模型身份项为未验证，而非“默认正确”。
5. 审查输出可校验、各条意见有真实 Driver 裁决，随后停在正确状态。审查员判业务计划不通过可以是正常产品行为；需区分「内容被驳回」与「执行链路故障」。
6. 保存审查前后业务文件哈希、Git 状态、运行状态、审查归档和报告；无意外业务写入、无同行禁读泄露。

单侧有未验证项时，报告具体缺口。不能用 exit 0、gate 通过、原稿存在或未改文件，单独替代以上六项。

## 6. W3：桌面、IDE 与 CLI 原生入口

### 6.1 先确认实际客户端，而不是预设都存在

| Agent | 正式调用形式 | 必须登记的实际承载面 | 默认护栏口径 |
| :--- | :--- | :--- | :--- |
| Codex | `$dual-review-plan ...` | 实际 Windows CLI／可用桌面／IDE 插件分别登记版本与技能支持情况 | L2；有 hooks.json 不等于拦截已生效 |
| Claude Code | `/dual-review-plan ...` | 实际 CLI 或承载 Claude Code 的桌面／IDE 会话 | L1 以原生 Hook 安装和实测成立为条件 |
| ZCode（GLM） | 桌面 `/dual-review-plan ...`；CLI `/skill dual-review-plan ...` | 桌面与 CLI 分格 | L2；CLI 不宣称 Hook 兜底 |
| Antigravity（Gemini） | `/dual-review-plan ...` | 实际 Antigravity 原生窗口／实际使用形态 | L2 |

不要把浏览器聊天页面、另开终端代执行或仅由其他客户端名义指定 Driver 当成桌面验收。客户端不存在、该 Windows 版本不可用、技能未被加载或插件宿主缺失时，该格记阻塞并注明事实；不自行推定厂商不支持 Windows，也不假定一定存在独立桌面版。

### 6.2 每个实际客户端的执行步骤

1. 安装后新开会话；打开本用例夹具。截图记录应用版本、工作目录和窗口，裁掉账号及其他隐私。
2. 在原生技能列表／加载轨迹里找到对应入口；核对实际加载路径与已安装技能 SHA256。只看到名称或模型说“已加载”不足以证明正文生效。
3. 在原生输入框提交 §5.3 的任务及 `--critics <指定Agent> --max-rounds 1` 和本轮路线参数。参数随用户消息传入，不能假定 `$ARGUMENTS` 已展开。
4. 观察真正的 Driver 工具调用：读配置和文档、认领、写本方原稿、读回、预检、异步启动、等待、读审查意见、逐条裁决。失败应停在相应步骤，不能跳过缺稿继续运行。
5. 核验 `role` 与本轮 Driver 一致，工件命名正确；不得冒写其他审核者后缀。由编排器产生的审查员工件不能由 Driver 拼写替代。
6. 观察人工停点：原生会话停止业务写入，明确等待；不自动 `approve`、`abandon` 或改状态文件。保留状态读回和最后一条客户端消息。
7. 保存客户端原生事件与同一 run 的对应关系；UI 截图证明窗口，事件证明工具，仓库／运行目录证明结果，三者时间和 ID 必须能互相核对。

### 6.3 逐格结果表

| 客户端及形态 | 技能实际加载 | 原稿准备 | 真实审核者 | 裁决／停点 | Hook 证据 | 结果 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Codex：待填实际形态 | 未测 | 未测 | 未测 | 未测 | L2，未测 | 未测 |
| Claude Code：待填实际形态 | 未测 | 未测 | 未测 | 未测 | 未测 | 未测 |
| ZCode 桌面 | 未测 | 未测 | 未测 | 未测 | 条件性，未测 | 未测 |
| ZCode CLI | 未测 | 未测 | 未测 | 未测 | 无桌面 Hook，不适用 | 未测 |
| Antigravity：待填实际形态 | 未测 | 未测 | 未测 | 未测 | L2，未测 | 未测 |

Bob 只需某些承载面时，在开工表明确本轮范围；范围外标未测，不用凭空增加未安装客户端。CLI 与桌面各自完成方可分别宣称通过。

## 7. W4：多审、取消与安全边界

### 7.1 多审组合与取消

| ID | 具体操作 | 通过条件 |
| :--- | :--- | :--- |
| W4-01 | 四家单侧均满足准入后，在新夹具由 Codex Driver 通过 B 选 `--critics claude,gemini,glm --max-rounds 1` | 三侧均按请求启动、各自产出真实证据；无同侧覆盖；整体裁决覆盖三侧；不把降级两审记三审通过 |
| W4-02 | 新夹具启动一次预算内的真实单侧审查，确认审核者进程已启动后发起取消 | 取消绑定本 run；子进程结束或不可确认明确报告；状态、取消原因、请求快照保留；不抹掉已产生的失败工件 |
| W4-03 | 同一用例观察 start/wait/status | 使用返回的 run ID；wait 退 73 表示仍运行，不重复 start；遵守返回的 `max_waits`、`bash_timeout_ms` |

运行后可用的观察／取消命令（在对应夹具中执行，替换占位值）：

```powershell
.\.trivium\bin\trivium.cmd review --status <RUN_ID> --json
.\.trivium\bin\trivium.cmd review --wait <RUN_ID> --timeout <返回预算内的秒数> --json
.\.trivium\bin\trivium.cmd review --cancel <RUN_ID>
.\.trivium\bin\trivium.cmd status --topic <主题> --json
.\.trivium\bin\trivium.cmd report --topic <主题> --json
```

取消前后只查询本轮进程的 PID、ParentProcessId、CreationDate 等必要字段；不要把全机带密钥的 CommandLine 上传。自动取消失败时按产品 Windows 提示核对进程身份再处理，记录手动介入；PID 单独相同不证明还是原进程。验证取消不影响一个预先登记的无关哨兵进程，严禁广泛杀进程。

### 7.2 只读准入与真实 Hook 用例

正常审查没有越界行为，只能证明本次未观察到失守。要宣称执行层防护有效，必须有实际尝试及相应拒绝证据。安全控制实验另用一次性夹具，不读取真正秘密、不伤害现有审查工件，且额外调用纳入预算。

| ID | 测试设计 | 可接受的证据 / 不能代替的证据 |
| :--- | :--- | :--- |
| W4-S1 | 对每家已选路线检查 doctor 的只读及禁读实测段，关联相同客户端版本和能力指纹 | 原生调用、实际越界尝试、同 ID 工具结果、拒绝点、文件前后哈希；只有声明／prompt／模型拒绝不算 |
| W4-S2 | 若 doctor 对必需危险面无原生证据，补独立控制臂：同一执行约束下，允许读的 canary 正对照，禁读 canary 负对照；另测试业务 canary 写尝试 | 仅用无敏感值的 canary；先冻结路径、预期和观察办法。未发生工具尝试填未测；读出禁读值或写成功为失守，立即停止该侧组合准入 |
| W4-S3 | Claude L1 原生会话在专用停点夹具中，受控尝试修改一份无价值的业务 canary | 必须先确认仅此负向测试得到授权；真实 Hook 事件及同 ID 被拒结果，文件不变；文件未变本身不够 |
| W4-S4 | ZCode 桌面 Hook 若在本次形态启用，核验信任、主 Agent、匹配器、加载与超时条件 | 记录真实触发路径；不从静态配置推定所有会话有效；CLI 不套用桌面结果 |
| W4-S5 | Codex／Antigravity／其他 L2 形态 | 记录人工遵约、运行期漂移检测证据和无强制拦截的边界；不把缺少 L1 Hook 判成实现承诺中的阻断，也不宣传有 L1 保障 |

W4-S2 需先形成具体控制臂任务：路径、原生入口、允许/拒绝的工具调用、同 ID 关联、限时、预算、清理方式。当前任务不允许测试者绕过四条正式入口自行调用 reviewer CLI；若现有入口无法给出所需执行层证据，先标「证据缺口／阻塞」，另提交装置方案，不能把 Node collector 的输出伪装成厂商原生结果。

所有 L2 停点期间仍遵守不改业务文件的规则。不得为了证明「没有强制 Hook」主动破坏受保护工件。执行中发现漂移时留原失败，不通过恢复文件、删运行目录或改 state 把它改绿。

## 8. W5：A / C / D 与人工审批扩展

如果本轮目标包括“Windows 四家全流程可用”，需把下列矩阵扩展到每个声称支持的 Driver／客户端形态；单一 Driver 跑通不能外推另外三家。

| 入口 | 最小夹具任务与步骤 | 关键判据 |
| :--- | :--- | :--- |
| D：`dual-review-bug` | 独立夹具给出可复现输入错误；先认领 bug、准备和回读根因稿，再送审 | 新增原稿准备步骤成立；有实际复现证据；不用 plan 的 `--max-rounds` 参数；停在对应人工审批点 |
| C：`dual-review-code` | 独立夹具预先准备一份已知小改动和明确 Git 基线，通过正式入口审查 diff | 真正被审 diff 与预期一致；业务文件审查期间不变；逐条裁决与停点正确 |
| A：`dual-run` | 从 sum 的需求开始，按入口走计划、审查、实际允许的后续实施、代码审查和 verify | 每处人工停点均等待 Bob 的实际决定；不自动批准；最终验证执行真实夹具命令 |
| 审批／拒绝／放弃 | Bob 对已存在的具体主题明确下达相应操作后，使用正式辅助入口 | 操作前后状态可读回；已归档证据保留；不复用其他主题的授权 |

为 A 明确配置夹具的 verify 命令：build 可用 `node --check src/sum.cjs`，test 可用 `node --test test/sum.test.cjs`；按当前配置 schema 填写命令列表并核对。`doctor --suggest-verify` 只产生建议，不代表配置已生效或测试已执行。记录实际 cwd、argv、退出码和报告；不能把省略 verify、空命令或桩结果写成真实编译测试通过。

W5 的 reviewer 侧次、Driver 费用、阶段上限另列预算。审批未发生时，结果写「已到人工停点，后续未测」，无需为凑完整流程擅自批准。用户要求拒绝或放弃时按该决定记录，不改成批准来继续测试。

## 9. 失败处理、清理和证据交付

### 9.1 状态定义与问题单

只使用：**通过、失败、阻塞、未测、不适用**。通过必须同时满足该格所有判据；不适用要写理由，例如该形态本就不声明桌面 Hook。已开始但证据缺失不能填通过。

每个问题单至少包含：编号、严重程度、固定源码 SHA、客户端版本、路线声明、机器/Shell、用例与 run ID、最短复现步骤、预期/实际、原始退出码、证据路径、影响范围、是否继续、后续责任人。将产品缺陷、账号/网络问题、测试装置问题分开，原因不明填待定位。

优先级：P0 凭据/只读失守/错误进程终止等立即停止相关运行；P1 安装、任一核心链路、请求回退或归档错误阻塞该组合；P2 非关键交互问题记录后按依赖继续。禁止用降低 `min_tool_calls`／`min_project_reads`、改 schema、忽略验证或换模型消除红项。

### 9.2 推荐证据结构

```text
<批次>/
  manifest.json                 # SHA、系统、版本、路径、范围、开始结束时间
  budget.md                     # 授权及实际消耗；unknown 不填 0
  cases.csv                     # 每格状态及证据索引
  environment-*.json/txt
  *.log / *.meta.json           # 本文命令原始日志与退出码
  atomic-live/                  # 当前源码连接后的独立装置与构建输入
  W2-B1/ ... W2-B4/
    route.json                 # requested / configured / observed 分开
    native-events/             # 脱敏副本，原始件留受控目录
    screenshots/               # 原生窗口、版本、加载、停点
    before-after.json          # 业务文件哈希、Git 状态、进程身份
    run-artifacts/             # 对应 run 与审查归档的可分享子集
  W3-*/ W4-*/ W5-*/
  issues.md
  acceptance.md                # 汇总和未测边界
  SHA256SUMS.txt               # 交付文件的相对路径与 SHA256
```

建议 `cases.csv` 列：`case_id,baseline,os,client,surface,driver,critics,run_id,requested_model,effective_model,status,exit_code,evidence,issue_id`。多侧模型按侧分别记录；缺失 exit 用空/null，不猜 0。

证据复制前检查 Token、Authorization、Cookie、私有 URL、邮箱与用户名；保留原始受控证据，对外只给脱敏副本。**不整包上传 run root**：其中可能包含临时凭据。脱敏改变文件后重新生成交付哈希，明确它是脱敏件；不要覆盖原件再声称原始哈希一致。

### 9.3 清理

先确认所有本批进程已终止，再检查临时凭据副本及残留。只清理登记属于本批的临时空间；不清用户账号、不删除历史 `.reviews`、不整目录删除厂商安装、不全机杀进程。保留待人工决定的夹具状态，不能用删目录代替 approve/abandon。为了复测创建新用例时保留原失败样本和关联。

安装若覆盖了本机此前 TriviumCode 版本，按开工约定决定是否保留或从备份回退；回退需核验来源和哈希，不能未经说明把全局运行时留在实验版本。源码副本最后 `git status --porcelain` 应没有产品源码改动；若有，先解释每个文件，不能直接 reset 丢证据。

### 9.4 最终验收报告与放行条件

报告必须包含：

1. 实测基线、机器与客户端形态、各路线表、预算实际消耗。
2. W0～W5 逐项结果，自动化的实际计数、退出码、跳过理由。
3. 每家审核者和 Driver 分开的小结；客户端能力与模型身份分开的小结。
4. 多审、取消、只读、Hook、人工停点的证据及缺口。
5. 首次失败、所有诊断复跑、问题单、残留和清理情况。
6. 明确 Windows 10、额外桌面/IDE 形态、未测模型、未做 W5 的边界。

基础验收通过需 W0～W4 范围内必需格全部达标、没有未解决的安全/核心故障；缺一个必需客户端或模型身份证据就按项说明，不宣布“四家全部通过”。只有完成 W5 对应矩阵，才写相应客户端的 A/B/C/D 全流程通过。

完成后先回传 `acceptance.md`、`cases.csv`、问题单和脱敏证据索引。经检查再将报告及可公开证据归档到仓库 `doc/05_testing/REPORT_<实际日期>_Windows四家Agent验收.md` 和 `evidence/<本批标识>/`，同步本目录 README。提交、推送、发布安装包是独立交付动作，按当时授权执行；本任务不重打或覆盖旧 1.3.2 发布包。

## 10. 可直接交给 Windows 执行人的任务摘要

> 在 Windows 原生真机上，按本文验证固定提交 `4bd1d0d50d15d9641156598487bea7fcae5f751f`。先做 W0/W1，再按已确认预算执行四家真实 doctor、单侧 B 和原生客户端入口；四家单侧证据齐备后才做三审组合。所有实际模型、客户端形态、人工停点和安全边界分开记录。不要修改产品源码、不要绕正式入口调用 reviewer CLI、不要自动 approve/abandon、不要换模型求通过、不要发版。每条命令保留退出码，任何失败保留首个现场；未执行及无原生证据的项目明确写未测。最终交付逐项报告、路线回读表、问题单及脱敏证据索引。

## 11. 实施依据

- [部署手册](../06_deployment/部署手册.md)：Windows 前置、源构建、安装及包装器。
- [快速上手](../07_manuals/QUICKSTART.md)：§5.2 原生入口与 L1/L2 边界。
- [Codex 开发指南](../04_development/GUIDE_codex_development.md)：本仓开发与隔离检查。
- [CLI 实现](../../src/trivium/cli.ts)、[Agent 注册表](../../src/trivium/agents/registry.ts)：实际旗标与客户端对应。
- [四家集合回归](../../test/integration/four-agent-scope.test.ts)：收口与旧身份拒绝。
- [Windows 原子写历史报告](./REPORT_2026-10-27_windows_atomic_write_retry.md)：仅借用方法，不继承结论或失败豁免。

本文命令按固定源码核对；尚未在 Windows PowerShell、真机或真实客户端执行。实际执行发现命令、客户端能力或环境差异时，先记录差异并修订任务，不伪造通过记录。
