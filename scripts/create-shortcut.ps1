param(
    [string]$DestinationDirectory = [Environment]::GetFolderPath('Desktop'),
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $appRoot 'zixi.exe'
if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) {
    throw 'zixi.exe is missing. Extract the complete Windows-x64-Portable.zip first, or run npm run release:build from source.'
}
if (-not (Test-Path -LiteralPath $DestinationDirectory -PathType Container)) {
    throw "Shortcut destination does not exist: $DestinationDirectory"
}
$shortcutPath = Join-Path (Resolve-Path -LiteralPath $DestinationDirectory).Path 'Zixi.lnk'
$shell = New-Object -ComObject WScript.Shell
try {
    $shortcut = $shell.CreateShortcut($shortcutPath)
    if ((Test-Path -LiteralPath $shortcutPath) -and
        $shortcut.TargetPath -ne $exe -and
        $shortcut.Description -ne 'Zixi desktop shortcut') {
        throw "A different shortcut already exists: $shortcutPath. Rename it before trying again."
    }
    $shortcut.TargetPath = $exe
    $shortcut.WorkingDirectory = $appRoot
    $shortcut.IconLocation = "$exe,0"
    $shortcut.Description = 'Zixi desktop shortcut'
    $shortcut.Save()
    if (-not $Quiet) { Write-Host "Desktop shortcut created: $shortcutPath" }
}
finally {
    if ($null -ne $shortcut) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcut) }
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell)
}
