param(
    [string]$Version
)

$ErrorActionPreference = "Stop"

function Get-Sha256Hex {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $stream = [System.IO.File]::OpenRead($Path)
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        return ([System.BitConverter]::ToString($sha256.ComputeHash($stream))).Replace('-', '').ToLowerInvariant()
    }
    finally {
        $sha256.Dispose()
        $stream.Dispose()
    }
}

$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $Version) {
    $packageJson = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw | ConvertFrom-Json
    $Version = $packageJson.version
}

if ($Version -notmatch '^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$') {
    throw "Invalid release version: $Version"
}

$bundleRoot = Join-Path $projectRoot "src-tauri\target\release\bundle"
$sources = @(
    [pscustomobject]@{
        Source = Join-Path $bundleRoot "nsis\Zixi_${Version}_x64-setup.exe"
        Name = "Zixi-${Version}-Windows-x64-Setup.exe"
    },
    [pscustomobject]@{
        Source = Join-Path $bundleRoot "msi\Zixi_${Version}_x64_en-US.msi"
        Name = "Zixi-${Version}-Windows-x64.msi"
    }
)

$assetDirectory = Join-Path $projectRoot "release-assets"
[System.IO.Directory]::CreateDirectory($assetDirectory) | Out-Null

$stagedFiles = foreach ($asset in $sources) {
    if (-not (Test-Path -LiteralPath $asset.Source -PathType Leaf)) {
        throw "Release bundle not found: $($asset.Source)"
    }

    $destination = Join-Path $assetDirectory $asset.Name
    Copy-Item -LiteralPath $asset.Source -Destination $destination -Force
    Get-Item -LiteralPath $destination
}

$checksumLines = foreach ($file in $stagedFiles) {
    $hash = Get-Sha256Hex -Path $file.FullName
    "$hash  $($file.Name)"
}

$checksumPath = Join-Path $assetDirectory "SHA256SUMS.txt"
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($checksumPath, (($checksumLines -join "`n") + "`n"), $utf8WithoutBom)

Get-ChildItem -LiteralPath $assetDirectory -File | Select-Object Name, Length
