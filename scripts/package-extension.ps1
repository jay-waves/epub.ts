$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$packageJsonPath = Join-Path $root "package.json"
$extensionDir = Join-Path $root "release\\extension"
$manifestPath = Join-Path $extensionDir "manifest.json"
$releaseDir = Join-Path $root "release"

if (-not (Test-Path $manifestPath)) {
  throw "Missing release\\extension\\manifest.json. Run the build step before packaging."
}

$packageJson = Get-Content $packageJsonPath | ConvertFrom-Json
$version = $packageJson.version
$archiveName = "epub-viewer-extension-v$version.zip"
$archivePath = Join-Path $releaseDir $archiveName

New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null
if (Test-Path $archivePath) {
  Remove-Item -LiteralPath $archivePath -Force
}
Compress-Archive -Path (Join-Path $extensionDir "*") -DestinationPath $archivePath -Force

Write-Host "Created $archivePath"
