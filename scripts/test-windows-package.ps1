$ErrorActionPreference = 'Stop'
function Get-PackageFileHash {
    param([string]$LiteralPath)
    $stream = [IO.File]::OpenRead($LiteralPath)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return [pscustomobject]@{ Hash = ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() } }
    finally { $sha.Dispose(); $stream.Dispose() }
}
$projectRoot = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$assetRoot = Join-Path $projectRoot "releases/v$version"
$zipPath = Join-Path $assetRoot "Zixi-$version-Windows-x64-Portable.zip"
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($zipPath)
try {
    $actual = @($zip.Entries | ForEach-Object { $_.FullName.Replace('\', '/') } | Sort-Object)
    $expected = @('zixi.exe', 'fonts/NotoSerifSC-VariableFont_wght.ttf', 'fonts/OFL.txt',
        'scripts/Create Desktop Shortcut.cmd', 'scripts/create-shortcut.ps1', 'START-HERE.md',
        'LICENSE', 'THIRD_PARTY_NOTICES.md') | Sort-Object
    if (Compare-Object $expected $actual) { throw "Unexpected portable ZIP contents: $($actual -join ', ')" }
} finally { $zip.Dispose() }

# An isolated extraction also covers spaces in shortcut paths; no real Desktop writes.
$testRoot = Join-Path $projectRoot ('src-tauri/target/release/package-tests/Extracted folder ' + [guid]::NewGuid().ToString('N'))
[IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $testRoot)
foreach ($rel in @('zixi.exe', 'fonts/NotoSerifSC-VariableFont_wght.ttf', 'fonts/OFL.txt')) {
    if ((Get-PackageFileHash -LiteralPath (Join-Path $testRoot $rel)).Hash -ne
        (Get-PackageFileHash -LiteralPath (Join-Path $projectRoot $rel)).Hash) {
        throw "Extracted asset differs from local entry: $rel"
    }
}
if ((Get-PackageFileHash -LiteralPath (Join-Path $testRoot 'zixi.exe')).Hash -ne
    (Get-PackageFileHash -LiteralPath (Join-Path $projectRoot 'src-tauri/target/release/zixi.exe')).Hash) {
    throw 'Portable executable differs from the formal release.'
}
$testDesktop = Join-Path $testRoot 'Test Desktop'
[IO.Directory]::CreateDirectory($testDesktop) | Out-Null
& (Join-Path $testRoot 'scripts/create-shortcut.ps1') -DestinationDirectory $testDesktop -Quiet
& (Join-Path $testRoot 'scripts/create-shortcut.ps1') -DestinationDirectory $testDesktop -Quiet
$shell = New-Object -ComObject WScript.Shell
try {
    $link = $shell.CreateShortcut((Join-Path $testDesktop 'Zixi.lnk'))
    if ($link.TargetPath -ne (Join-Path $testRoot 'zixi.exe') -or $link.WorkingDirectory -ne $testRoot -or
        $link.IconLocation -ne ((Join-Path $testRoot 'zixi.exe') + ',0')) {
        throw 'Shortcut target, working directory or icon is incorrect.'
    }
} finally {
    if ($null -ne $link) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($link) }
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell)
}
$checksums = @(Get-Content -LiteralPath (Join-Path $assetRoot 'SHA256SUMS.txt'))
if ($checksums.Count -ne 3) { throw 'Expected checksums for exactly three release assets.' }
foreach ($line in $checksums) {
    if ($line -notmatch '^([0-9a-f]{64})  ([^/\\]+)$') { throw 'Invalid checksum line.' }
    if ((Get-PackageFileHash -LiteralPath (Join-Path $assetRoot $Matches[2])).Hash -ne $Matches[1]) {
        throw "Checksum mismatch: $line"
    }
}
Write-Host 'PASS: portable root layout, resources, executable identity, repeatable shortcut creation, checksums.'
Write-Host "Test extraction: $testRoot"
