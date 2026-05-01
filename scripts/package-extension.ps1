$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$packageJsonPath = Join-Path $root "package.json"
$manifestPath = Join-Path $root "dist\\manifest.json"
$releaseDir = Join-Path $root "release"

if (-not (Test-Path $manifestPath)) {
  throw "Missing dist\\manifest.json. Run the build step before packaging."
}

$packageJson = Get-Content $packageJsonPath | ConvertFrom-Json
$version = $packageJson.version
$archiveName = "epub-viewer-extension-v$version.zip"
$archivePath = Join-Path $releaseDir $archiveName

if (Test-Path $releaseDir) {
  Remove-Item -LiteralPath $releaseDir -Recurse -Force
}

New-Item -ItemType Directory -Path $releaseDir | Out-Null
Compress-Archive -Path (Join-Path $root "dist\\*") -DestinationPath $archivePath -Force

Write-Host "Created $archivePath"
