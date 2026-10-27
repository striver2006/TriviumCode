param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][int]$HoldMs
)

# EV-260 live test helper. ASCII-only on purpose:
# Windows PowerShell 5.1 reads a BOM-less .ps1 as ANSI, which corrupts
# non-ASCII literals. This file writes no files; the node driver captures
# stdout. Any future file I/O here must pass -Encoding UTF8 explicitly.

$fs = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::None)
try {
    Write-Output 'READY'
    Start-Sleep -Milliseconds $HoldMs
}
finally {
    $fs.Close()
}
