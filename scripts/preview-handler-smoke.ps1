# Installs the built MSI silently, checks that it registers the Explorer preview
# handler, then uninstalls and checks that nothing is left behind. Run from CI
# (or locally in an elevated shell) after `pnpm tauri build --bundles msi`.
#
#   powershell -File scripts/preview-handler-smoke.ps1
$ErrorActionPreference = 'Stop'

$clsid = '{D0BF6AA3-FB9F-473F-BDEF-ABB364324298}'
$previewShellex = '{8895b1c6-b41f-4c1c-a562-0d564250836f}'
$classes = 'HKLM:\SOFTWARE\Classes'
$root = Split-Path $PSScriptRoot -Parent
$conf = Get-Content "$root\src-tauri\tauri.conf.json" -Raw | ConvertFrom-Json
$extensions = ($conf.bundle.fileAssociations | Where-Object mimeType -eq 'text/markdown').ext

$msi = Get-ChildItem "$root\src-tauri\target\release\bundle\msi\*.msi" | Select-Object -First 1
if (-not $msi) { throw 'No MSI found; run pnpm tauri build --bundles msi first.' }

function Invoke-Msi($arguments) {
  $process = Start-Process msiexec.exe -ArgumentList $arguments -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "msiexec $arguments failed with $($process.ExitCode)" }
}

Write-Host "Installing $($msi.Name)" -ForegroundColor Cyan
Invoke-Msi "/i `"$($msi.FullName)`" /qn /norestart"

try {
  $server = (Get-Item "$classes\CLSID\$clsid\InprocServer32" -ErrorAction Stop).GetValue('')
  if (-not (Test-Path $server)) { throw "InprocServer32 points at a missing file: $server" }
  $web = Join-Path (Split-Path $server) 'web\index.html'
  if (-not (Test-Path $web)) { throw "The preview page was not installed at $web" }

  $class = Get-Item "$classes\CLSID\$clsid"
  if ($class.GetValue('AppID') -ne '{6d2b5079-2f0b-48dd-ab7f-97cec514d30b}') {
    throw 'The handler is not registered against the preview surrogate.'
  }
  if ($class.GetValue('DisableLowILProcessIsolation') -ne 1) {
    throw 'WebView2 needs the low integrity opt-out.'
  }

  foreach ($ext in $extensions) {
    $value = (Get-Item "$classes\.$ext\shellex\$previewShellex" -ErrorAction Stop).GetValue('')
    if ($value -ne $clsid) { throw ".$ext points at $value instead of the handler" }
  }
  Write-Host "Registered for: $($extensions -join ', ')" -ForegroundColor Green
} finally {
  Write-Host 'Uninstalling' -ForegroundColor Cyan
  Invoke-Msi "/x `"$($msi.FullName)`" /qn /norestart"
}

if (Test-Path "$classes\CLSID\$clsid") { throw 'Uninstall left the CLSID registration behind.' }
foreach ($ext in $extensions) {
  if (Test-Path "$classes\.$ext\shellex\$previewShellex") {
    throw "Uninstall left the .$ext shellex key behind."
  }
}
$approved = Get-Item 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\PreviewHandlers' -ErrorAction SilentlyContinue
if ($approved -and $approved.Property -contains $clsid) {
  throw 'Uninstall left the handler in the PreviewHandlers list.'
}
Write-Host 'Install and uninstall are clean.' -ForegroundColor Green
