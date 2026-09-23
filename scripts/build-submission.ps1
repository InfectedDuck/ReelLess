Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$manifest = Get-Content -LiteralPath (Join-Path $root "manifest.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$version = $manifest.version
$releaseRoot = Join-Path $root "release"
$bundle = Join-Path $releaseRoot "ReelLess-v$version"
$assets = Join-Path $bundle "listing-assets"
$documents = Join-Path $bundle "documents"

if (Test-Path -LiteralPath $bundle) {
  throw "Submission folder already exists: $bundle"
}

& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "build-package.ps1")
if ($LASTEXITCODE -ne 0) { throw "Extension package build failed" }

New-Item -ItemType Directory -Path $assets -Force | Out-Null
New-Item -ItemType Directory -Path $documents -Force | Out-Null

Copy-Item -LiteralPath (Join-Path $root "dist/reels-blocker.zip") -Destination (Join-Path $bundle "UPLOAD-THIS-reels-blocker-v$version.zip")
Copy-Item -LiteralPath (Join-Path $root "SUBMISSION_README.md") -Destination (Join-Path $bundle "README-FIRST.md")

$assetFiles = @(
  "01-popup.png",
  "02-youtube-before-after.png",
  "03-instagram-facebook.png",
  "04-advanced-settings.png",
  "05-focus-count.png",
  "promo-440x280.png",
  "marquee-1400x560.png"
)
foreach ($file in $assetFiles) {
  Copy-Item -LiteralPath (Join-Path $root "store-assets/$file") -Destination (Join-Path $assets $file)
}
Copy-Item -LiteralPath (Join-Path $root "icons/icon-128.png") -Destination (Join-Path $assets "icon-128.png")

$documentFiles = @(
  "STORE_LISTING.md",
  "PRIVACY.md",
  "SECURITY_REVIEW.md",
  "MANUAL_TESTING.md",
  "PUBLISHING_CHECKLIST.md"
)
foreach ($file in $documentFiles) {
  Copy-Item -LiteralPath (Join-Path $root $file) -Destination (Join-Path $documents $file)
}

Write-Host "Created submission kit: $bundle"
Write-Host "Upload only: $(Join-Path $bundle "UPLOAD-THIS-reels-blocker-v$version.zip")"
