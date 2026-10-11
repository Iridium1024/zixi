param(
    [string]$Destination
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $Destination) { $Destination = $projectRoot }
$Destination = [IO.Path]::GetFullPath($Destination)
$config = Get-Content -LiteralPath (Join-Path $projectRoot 'src-tauri/tauri.conf.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$payload = @(
    [pscustomobject]@{ Source = 'src-tauri/target/release/zixi.exe'; Target = 'zixi.exe' },
    [pscustomobject]@{ Source = 'scripts/Create Desktop Shortcut.cmd'; Target = 'scripts/Create Desktop Shortcut.cmd' },
    [pscustomobject]@{ Source = 'scripts/create-shortcut.ps1'; Target = 'scripts/create-shortcut.ps1' },
    [pscustomobject]@{ Source = 'docs/portable/START-HERE.md'; Target = 'START-HERE.md' },
    [pscustomobject]@{ Source = 'LICENSE'; Target = 'LICENSE' },
    [pscustomobject]@{ Source = 'docs/THIRD_PARTY_NOTICES.md'; Target = 'THIRD_PARTY_NOTICES.md' }
)

# Use the same resource mapping as the installer, never the source tree or AppData.
if ($config.bundle.resources -isnot [pscustomobject]) {
    throw 'Portable packaging requires explicit source-to-destination resource mappings.'
}
foreach ($resource in $config.bundle.resources.PSObject.Properties) {
    $payload += [pscustomobject]@{ Source = "src-tauri/$($resource.Name)"; Target = [string]$resource.Value }
}

# Preflight every source and destination before copying anything.
$targets = @{}
foreach ($file in $payload) {
    $source = [IO.Path]::GetFullPath((Join-Path $projectRoot $file.Source))
    $target = [IO.Path]::GetFullPath((Join-Path $Destination $file.Target))
    if (-not $source.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
        -not $target.StartsWith($Destination.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw "Resource path escapes the package: $($file.Source) -> $($file.Target)"
    }
    if ($targets.ContainsKey($target)) { throw "Duplicate package path: $target" }
    $targets[$target] = $true
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Missing release input: $source. Run npm run tauri -- build first."
    }
    $cursor = $target
    while ($cursor -and $cursor.Length -ge $Destination.Length) {
        if ((Test-Path -LiteralPath $cursor) -and
            ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw "Package destination contains a link: $cursor"
        }
        $cursor = Split-Path -Parent $cursor
    }
}
foreach ($file in $payload) {
    $source = [IO.Path]::GetFullPath((Join-Path $projectRoot $file.Source))
    $target = [IO.Path]::GetFullPath((Join-Path $Destination $file.Target))
    # Keep only the short source README at the project root; include full notices in ZIPs.
    if ($Destination -eq $projectRoot -and $file.Target -in @('START-HERE.md', 'THIRD_PARTY_NOTICES.md')) { continue }
    if ($source -eq $target) { continue }
    [IO.Directory]::CreateDirectory((Split-Path -Parent $target)) | Out-Null
    Copy-Item -LiteralPath $source -Destination $target -Force
}
Write-Host "Runnable Windows folder: $Destination"
