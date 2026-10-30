# Packages the binary `pnpm tauri build` left behind a second time, with Microsoft's
# standalone WebView2 installer inside the MSI, so it installs with no internet.
# The result lands in bundle\msi-offline and the regular MSI stays where it was.
#
#   powershell -File scripts/build-offline-msi.ps1
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$bundle = "$root\src-tauri\target\release\bundle"

$found = Get-ChildItem "$bundle\msi\*_x64_en-US.msi" | Select-Object -First 1
if (-not $found) { throw 'No MSI found; run pnpm tauri build --bundles msi first.' }
$regular = $found.FullName
$regularSize = $found.Length
$offlineDir = "$bundle\msi-offline"
$offline = "$offlineDir\$($found.BaseName)_offline.msi"
$aside = "$offlineDir\$($found.Name).regular"

New-Item -ItemType Directory -Force $offlineDir | Out-Null
# The bundler writes to the regular MSI's path.
Move-Item -Force $regular $aside
try {
  # The bundler's download has no retry, and a failed release leg holds back every channel.
  foreach ($attempt in 1, 2) {
    pnpm -C $root tauri bundle --bundles msi --config "$root\src-tauri\tauri.offline-msi.conf.json"
    if ($LASTEXITCODE -eq 0) { break }
    if ($attempt -eq 2) { throw "tauri bundle failed with exit code $LASTEXITCODE" }
    Write-Host 'Retrying tauri bundle' -ForegroundColor Yellow
  }

  # The bundler clears this folder before downloading, so a lone file here is the
  # one it just embedded. A Tauri upgrade that moves it fails here, not silently.
  $installers = @(Get-ChildItem "$root\src-tauri\target\release\wix\x64\x64\*\*.exe")
  if ($installers.Count -ne 1) { throw "Expected one WebView2 installer, found $($installers.Count)." }
  & "$PSScriptRoot\webview2-signature-check.ps1" $installers[0].FullName

  Move-Item -Force $regular $offline
} finally {
  Move-Item -Force $aside $regular
}

$growth = (Get-Item $offline).Length - $regularSize
if ($growth -lt 100MB) { throw "$offline is only $([math]::Round($growth / 1MB)) MB larger than the regular MSI, so it does not embed the installer." }
Write-Host "Built $offline" -ForegroundColor Green
