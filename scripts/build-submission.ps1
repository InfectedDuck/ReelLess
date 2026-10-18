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

# The Chrome Web Store accepts at most five screenshots; they are numbered in upload order.
$screenshots = @(
  "01-popup.png",
  "02-youtube-before-after.png",
  "05-focus-count.png",
  "06-supported-sites.png",
  "07-section-controls.png"
)
for ($i = 0; $i -lt $screenshots.Count; $i++) {
  $file = $screenshots[$i]
  Copy-Item -LiteralPath (Join-Path $root "store-assets/$file") -Destination (Join-Path $assets ("screenshot-{0}-{1}" -f ($i + 1), $file))
}
# Edge Add-ons accepts up to ten screenshots; these extras are optional there.
$extras = Join-Path $assets "extra-screenshots-edge-only"
New-Item -ItemType Directory -Path $extras -Force | Out-Null
foreach ($file in @("04-advanced-settings.png", "08-youtube-tabs-before-after.png", "09-youtube-focus-screen.png")) {
  Copy-Item -LiteralPath (Join-Path $root "store-assets/$file") -Destination (Join-Path $extras $file)
}
foreach ($file in @("promo-440x280.png", "marquee-1400x560.png")) {
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
