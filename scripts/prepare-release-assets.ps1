param(
    [string]$Version
)

$ErrorActionPreference = "Stop"

& node (Join-Path $PSScriptRoot 'check-release-source.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Release source preflight failed.' }

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
$packageJson = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $Version) {
    $Version = $packageJson.version
}
if ($Version -ne $packageJson.version) { throw 'Requested release version differs from package.json.' }

if ($Version -notmatch '^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$') {
    throw "Invalid release version: $Version"
}

$formalExe = Join-Path $projectRoot 'src-tauri/target/release/zixi.exe'
if (-not (Test-Path -LiteralPath $formalExe -PathType Leaf)) { throw 'Formal release executable is missing.' }
$binaryVersion = (Get-Item -LiteralPath $formalExe).VersionInfo.ProductVersion
if ($binaryVersion -notmatch ('^' + [regex]::Escape($Version) + '(\.0)?$')) {
    throw "Executable version $binaryVersion differs from release $Version. Rebuild before packaging."
}
foreach ($document in @('docs/releases/README.md', "docs/releases/v$Version.md")) {
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $document) -PathType Leaf)) {
        throw "Missing release documentation: $document"
    }
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

$assetDirectory = Join-Path $projectRoot "releases/v$Version"
[System.IO.Directory]::CreateDirectory($assetDirectory) | Out-Null

# Fail before changing any release asset if an installer is missing.
foreach ($asset in $sources) {
    if (-not (Test-Path -LiteralPath $asset.Source -PathType Leaf)) {
        throw "Release bundle not found: $($asset.Source)"
    }
}
$stagingRoot = Join-Path $projectRoot ('src-tauri/target/release/portable-staging/' + [guid]::NewGuid().ToString('N'))
& (Join-Path $PSScriptRoot 'prepare-portable.ps1') -Destination $stagingRoot
$portableName = "Zixi-${Version}-Windows-x64-Portable.zip"
$portablePath = Join-Path $assetDirectory $portableName
Add-Type -AssemblyName System.IO.Compression.FileSystem
$stagedZip = "$stagingRoot.zip"
[IO.Compression.ZipFile]::CreateFromDirectory($stagingRoot, $stagedZip)
Copy-Item -LiteralPath $stagedZip -Destination $portablePath -Force
# Refresh the discoverable local entry from the same formal release build.
& (Join-Path $PSScriptRoot 'prepare-portable.ps1')

$stagedFiles = foreach ($asset in $sources) {
    if (-not (Test-Path -LiteralPath $asset.Source -PathType Leaf)) {
        throw "Release bundle not found: $($asset.Source)"
    }

    $destination = Join-Path $assetDirectory $asset.Name
    Copy-Item -LiteralPath $asset.Source -Destination $destination -Force
    Get-Item -LiteralPath $destination
}
$stagedFiles = @($stagedFiles) + (Get-Item -LiteralPath $portablePath)

$checksumLines = foreach ($file in $stagedFiles) {
    $hash = Get-Sha256Hex -Path $file.FullName
    "$hash  $($file.Name)"
}

$checksumPath = Join-Path $assetDirectory "SHA256SUMS.txt"
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($checksumPath, (($checksumLines -join "`n") + "`n"), $utf8WithoutBom)

Copy-Item -LiteralPath (Join-Path $projectRoot 'docs/releases/README.md') -Destination (Join-Path $assetDirectory 'README.md') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot "docs/releases/v$Version.md") -Destination (Join-Path $assetDirectory 'RELEASE-NOTES.md') -Force

Get-ChildItem -LiteralPath $assetDirectory -File | Select-Object Name, Length
