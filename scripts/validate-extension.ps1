Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$manifestPath = Join-Path $root "manifest.json"
if (-not (Test-Path -LiteralPath $manifestPath)) { throw "Missing manifest.json" }
# Read as UTF-8 explicitly: Windows PowerShell defaults to ANSI for a file without a BOM,
# which turns the em dash in the store name into three characters and breaks the length checks.
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json

if ($manifest.manifest_version -ne 3) { throw "manifest_version must be 3" }
if ($manifest.version -ne "2.3.0") { throw "Release version must be 2.3.0" }
if ($manifest.name -notlike "*ReelLess*") { throw "Unexpected extension name" }
if ($manifest.name.Length -gt 75) { throw "Store name exceeds 75 characters: $($manifest.name.Length)" }
if ($manifest.description.Length -gt 132) { throw "Store summary exceeds 132 characters: $($manifest.description.Length)" }

$allowedPermissions = @("alarms", "declarativeNetRequestWithHostAccess", "scripting", "storage")
foreach ($permission in @($manifest.permissions)) {
  if ($permission -notin $allowedPermissions) { throw "Unexpected permission: $permission" }
}
foreach ($permission in $allowedPermissions) {
  if ($permission -notin @($manifest.permissions)) { throw "Missing permission: $permission" }
}
if ($manifest.PSObject.Properties.Name -contains "host_permissions") { throw "Install-time host_permissions are not allowed" }
if ($manifest.PSObject.Properties.Name -contains "declarative_net_request") { throw "A disabled static ruleset must not be shipped" }
if ($manifest.PSObject.Properties.Name -contains "externally_connectable") { throw "External messaging must not be enabled" }
if (@($manifest.optional_host_permissions).Count -ne 1 -or $manifest.optional_host_permissions[0] -ne "https://*/*") {
  throw "Custom domains must be declared as optional HTTPS access and requested as exact origins"
}

$expectedCoreMatches = @(
  "https://www.youtube.com/*", "https://m.youtube.com/*", "https://youtube.com/*",
  "https://www.instagram.com/*", "https://m.instagram.com/*", "https://instagram.com/*",
  "https://www.facebook.com/*", "https://m.facebook.com/*", "https://facebook.com/*",
  "https://fb.com/*", "https://www.fb.com/*", "https://fb.watch/*", "https://www.fb.watch/*",
  "https://www.tiktok.com/*", "https://m.tiktok.com/*", "https://tiktok.com/*"
)
$scripts = @($manifest.content_scripts)
if ($scripts.Count -ne 1) { throw "Exactly one bundled core content-script registration is expected" }
$script = $scripts[0]
if (@($script.js).Count -ne 2 -or $script.js[0] -ne "shared.js" -or $script.js[1] -ne "site_guard.js") {
  throw "Core guard must load shared.js then site_guard.js"
}
if (@($script.css).Count -ne 1 -or $script.css[0] -ne "site_guard.css") { throw "Core guard stylesheet is missing" }
if ($script.run_at -ne "document_start") { throw "Core guard must run at document_start" }
if (@($script.matches).Count -ne $expectedCoreMatches.Count) { throw "Unexpected core site match count" }
foreach ($match in @($script.matches)) {
  if ($match -notin $expectedCoreMatches) { throw "Advanced site leaked into install-time access: $match" }
}

$requiredFiles = @(
  "manifest.json", "service_worker.js", "shared.js", "site_guard.js", "site_guard.css",
  "popup.html", "popup.css", "popup.js", "options.html", "options.css", "options.js",
  "onboarding.html", "onboarding.css", "onboarding.js", "privacy.html"
)
foreach ($file in $requiredFiles) {
  if (-not (Test-Path -LiteralPath (Join-Path $root $file))) { throw "Missing required extension file: $file" }
}
foreach ($size in @("16", "32", "48", "128")) {
  $icon = $manifest.icons.$size
  if (-not (Test-Path -LiteralPath (Join-Path $root $icon))) { throw "Missing icon: $icon" }
}

Add-Type -AssemblyName System.Drawing
foreach ($file in @("01-popup.png", "02-youtube-before-after.png", "03-instagram-facebook.png", "04-advanced-settings.png", "05-focus-count.png")) {
  $assetPath = Join-Path $root "store-assets/$file"
  if (-not (Test-Path -LiteralPath $assetPath)) { throw "Missing listing screenshot: $file" }
  $image = [System.Drawing.Image]::FromFile($assetPath)
  try {
    if ($image.Width -ne 1280 -or $image.Height -ne 800) { throw "Listing screenshot must be 1280x800: $file" }
  } finally {
    $image.Dispose()
  }
}
$promoPath = Join-Path $root "store-assets/promo-440x280.png"
$promo = [System.Drawing.Image]::FromFile($promoPath)
try {
  if ($promo.Width -ne 440 -or $promo.Height -ne 280) { throw "Promo tile must be 440x280" }
} finally {
  $promo.Dispose()
}
$marqueePath = Join-Path $root "store-assets/marquee-1400x560.png"
$marquee = [System.Drawing.Image]::FromFile($marqueePath)
try {
  if ($marquee.Width -ne 1400 -or $marquee.Height -ne 560) { throw "Marquee tile must be 1400x560" }
} finally {
  $marquee.Dispose()
}

$runtimeScripts = @("shared.js", "service_worker.js", "site_guard.js", "popup.js", "options.js", "onboarding.js")
foreach ($file in $runtimeScripts) {
  & node --check (Join-Path $root $file)
  if ($LASTEXITCODE -ne 0) { throw "JavaScript syntax check failed: $file" }
  $content = Get-Content -LiteralPath (Join-Path $root $file) -Raw
  if ($content -match "\b(fetch|XMLHttpRequest|WebSocket|sendBeacon)\s*\(") { throw "External request API found in runtime file: $file" }
  if ($content -match "\beval\s*\(|new\s+Function\s*\(") { throw "Arbitrary code execution pattern found in runtime file: $file" }
  if ($content -match "direct_videos|shouldBlockDirectVideos|reelless-direct-blocked") { throw "Retired Direct-message behavior remains in runtime file: $file" }
}

foreach ($file in @("popup.html", "options.html", "onboarding.html", "privacy.html")) {
  $content = Get-Content -LiteralPath (Join-Path $root $file) -Raw
  if ($content -match '<(script|link)[^>]+(src|href)\s*=\s*["'']https?://') { throw "Remote executable resource found in extension page: $file" }
}

$textFiles = @("README.md", "PRIVACY.md", "STORE_LISTING.md", "docs/index.html", "docs/privacy.html", "docs/support.html")
foreach ($file in $textFiles) {
  $path = Join-Path $root $file
  if (-not (Test-Path -LiteralPath $path)) { throw "Missing release copy: $file" }
  if ((Get-Content -LiteralPath $path -Raw) -match "your-username|TODO|PLACEHOLDER") { throw "Placeholder remains in $file" }
  if ((Get-Content -LiteralPath $path -Raw) -match "Direct-message videos|Block Direct videos|Direct-video") { throw "Retired Direct-message claim remains in $file" }
}

Write-Host "Extension validation passed."
