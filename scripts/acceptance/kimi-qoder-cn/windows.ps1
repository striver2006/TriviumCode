param(
  [Parameter(Mandatory=$true)][string]$KimiExe,
  [Parameter(Mandatory=$true)][string]$QoderCnExe,
  [string]$OutputDirectory = ""
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
if (-not $OutputDirectory) {
  $OutputDirectory = Join-Path $repo ('doc/05_testing/evidence/kimi-qoder-cn-windows-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
}
foreach ($binary in @($KimiExe, $QoderCnExe)) {
  if (-not (Test-Path -LiteralPath $binary -PathType Leaf) -or [IO.Path]::GetExtension($binary) -ne '.exe') {
    throw '请传官方 CLI 的原生 exe 绝对路径，不能传 IDE、国际版或命令行 shim。'
  }
}
$failed = 0
foreach ($side in @(@{Id='kimi';Bin=$KimiExe}, @{Id='qoder-cn';Bin=$QoderCnExe})) {
  foreach ($arm in @('open','deny','tools','failure','cancel')) {
    & node (Join-Path $PSScriptRoot 'probe.mjs') --agent $side.Id --bin $side.Bin --case $arm --output $OutputDirectory
    if ($LASTEXITCODE -ne 0) { $failed++ }
  }
}
Write-Host "证据目录：$OutputDirectory；失败调用数：$failed。零退出也仅表示采集完成，待逐项核验，不代表准入。"
exit ([int]($failed -gt 0))
