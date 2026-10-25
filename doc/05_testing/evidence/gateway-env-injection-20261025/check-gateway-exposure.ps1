# EV-256 Windows acceptance, read-only check: do gateway values appear in process command lines or in files?
# (Kept ASCII-only on purpose: Windows PowerShell 5.1 reads BOM-less .ps1 files as ANSI.)
#
# Values are read from the env section of %USERPROFILE%\.claude\settings.json (only ANTHROPIC_ / CLAUDE_
# keys with string values of length >= 8, same as the orchestrator's extraction and scrubbing rules) and are
# compared in memory only. Output contains key names, pids, file paths and counts -- never a value.
#
# Usage (PowerShell, repo root):
#   .\doc\05_testing\evidence\gateway-env-injection-20261025\check-gateway-exposure.ps1 -Watch 300
#       sample the process table once per second for 300 s and check every claude-related command line
#   .\doc\05_testing\evidence\gateway-env-injection-20261025\check-gateway-exposure.ps1 -Scan <dir-or-file>[,<dir-or-file>...]
#       check file contents under these paths (recursive)
# Exit codes: 0 no leak; 1 leak seen; 2 nothing to check in settings.json; 3 -Watch saw no claude process (sampling invalid).
#
# Model-name keys (ending in _MODEL or _MODEL_NAME) are reported as NOTE, not LEAK: their values are model ids the gateway
# reports back, which the probe legitimately records (config.local.yaml, doctor output) and which may appear as --model.
# Only the remaining keys (ANTHROPIC_AUTH_TOKEN, ANTHROPIC_BASE_URL, ...) count as a leak.
# (2026-10-25 first Windows run reported three model-name keys as LEAK in .trivium\config.local.yaml; see windows-readout.md.)
param(
  [int]$Watch = 0,
  [string[]]$Scan = @()
)
$ErrorActionPreference = 'Stop'

$settingsPath = Join-Path $env:USERPROFILE '.claude\settings.json'
$json = Get-Content -Raw -LiteralPath $settingsPath | ConvertFrom-Json
$pairs = @()
if ($null -ne $json.env) {
  foreach ($p in $json.env.PSObject.Properties) {
    if ($p.Name -match '^(ANTHROPIC_|CLAUDE_)' -and $p.Value -is [string] -and $p.Value.Length -ge 8) {
      $pairs += [pscustomobject]@{ Key = $p.Name; Value = $p.Value; IsModel = ($p.Name -match '_MODEL(_NAME)?$') }
    }
  }
}
Write-Output ("gateway keys to check: {0} ({1})" -f $pairs.Count, (($pairs | ForEach-Object { $_.Key }) -join ', '))
if ($pairs.Count -eq 0) {
  Write-Output 'nothing to check: env section empty, or every value shorter than 8 chars'
  exit 2
}

$leak = $false

function Report-Hit($pair, [string]$where) {
  if ($pair.IsModel) {
    Write-Output ("NOTE {0} (model name, expected to appear) {1}" -f $pair.Key, $where)
  } else {
    Write-Output ("LEAK {0} {1}" -f $pair.Key, $where)
    $script:leak = $true
  }
}

if ($Watch -gt 0) {
  $deadline = (Get-Date).AddSeconds($Watch)
  $samples = 0
  $claudePids = @{}
  $checkedPids = @{}
  while ((Get-Date) -lt $deadline) {
    $samples++
    $procs = Get-CimInstance Win32_Process | Where-Object {
      $_.ProcessId -ne $PID -and ($_.Name -like 'claude*' -or ($null -ne $_.CommandLine -and $_.CommandLine -match 'claude'))
    }
    foreach ($proc in $procs) {
      if ($proc.Name -like 'claude*') { $claudePids[$proc.ProcessId] = $true }
      $checkedPids[$proc.ProcessId] = $true
      if ($null -eq $proc.CommandLine) { continue }
      foreach ($pair in $pairs) {
        if ($proc.CommandLine.Contains($pair.Value)) {
          Report-Hit $pair ("pid={0} name={1}" -f $proc.ProcessId, $proc.Name)
        }
      }
    }
    Start-Sleep -Seconds 1
  }
  Write-Output ("process table: {0} samples; {1} processes checked, {2} of them claude executables" -f $samples, $checkedPids.Count, $claudePids.Count)
  if ($claudePids.Count -eq 0) {
    Write-Output 'no claude process seen while sampling: this run is invalid, rerun it while doctor / a review is running'
    if (-not $leak) { exit 3 }
  }
}

foreach ($root in $Scan) {
  if (Test-Path -LiteralPath $root -PathType Leaf) { $files = @(Get-Item -LiteralPath $root) }
  else { $files = @(Get-ChildItem -LiteralPath $root -Recurse -File -Force -ErrorAction SilentlyContinue) }
  $scanned = 0
  foreach ($f in $files) {
    if ($f.Length -gt 50MB) { Write-Output ("SKIP too large: {0}" -f $f.FullName); continue }
    $scanned++
    $text = [System.IO.File]::ReadAllText($f.FullName)
    foreach ($pair in $pairs) {
      if ($text.Contains($pair.Value)) {
        Report-Hit $pair ("file={0}" -f $f.FullName)
      }
    }
  }
  Write-Output ("scanned {0}: {1} files" -f $root, $scanned)
}

if ($leak) { Write-Output 'RESULT: leak seen'; exit 1 }
Write-Output 'RESULT: no leak'
exit 0
