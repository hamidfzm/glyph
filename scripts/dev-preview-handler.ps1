# Registers the locally built Explorer preview handler for the current user, so
# the preview pane can be tested without building and installing the MSI.
# Build first with `pnpm build:preview-handler`. Mirrors the MSI's keys in
# src-tauri/windows/preview-handler.wxs, under HKCU instead of HKLM.
#
#   powershell -File scripts/dev-preview-handler.ps1              # register
#   powershell -File scripts/dev-preview-handler.ps1 -Unregister  # undo
#
# A handler already registered for an extension (PowerToys uses HKCU too) is
# saved on register and put back on unregister.
param([switch]$Unregister)
$ErrorActionPreference = 'Stop'

$clsid = '{D0BF6AA3-FB9F-473F-BDEF-ABB364324298}'
$previewShellex = '{8895b1c6-b41f-4c1c-a562-0d564250836f}'
$prevhostAppId = '{6d2b5079-2f0b-48dd-ab7f-97cec514d30b}'
$classes = 'HKCU:\Software\Classes'
$clsidKey = "$classes\CLSID\$clsid"
$approved = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\PreviewHandlers'

$root = Split-Path $PSScriptRoot -Parent
$conf = Get-Content "$root\src-tauri\tauri.conf.json" -Raw | ConvertFrom-Json
$extensions = ($conf.bundle.fileAssociations | Where-Object mimeType -eq 'text/markdown').ext

# prevhost.exe keeps the DLL loaded (and locked) between previews.
Get-Process prevhost -ErrorAction SilentlyContinue | Stop-Process -Force

function Get-Handler($ext) {
  $key = "$classes\.$ext\shellex\$previewShellex"
  if (Test-Path $key) { (Get-Item $key).GetValue('') } else { $null }
}

function Set-Handler($ext, $value) {
  $key = "$classes\.$ext\shellex\$previewShellex"
  if ($value) {
    New-Item $key -Force | Out-Null
    Set-ItemProperty $key -Name '(default)' -Value $value
  } elseif (Test-Path $key) {
    Remove-Item $key
  }
}

if ($Unregister) {
  $saved = Get-Item $clsidKey -ErrorAction SilentlyContinue
  foreach ($ext in $extensions) {
    $previous = if ($saved) { $saved.GetValue("Previous.$ext") } else { $null }
    if ((Get-Handler $ext) -eq $clsid) { Set-Handler $ext $previous }
  }
  if (Test-Path $clsidKey) { Remove-Item $clsidKey -Recurse }
  Remove-ItemProperty $approved -Name $clsid -ErrorAction SilentlyContinue
  Write-Host 'Unregistered the Glyph preview handler.'
  return
}

$dll = Join-Path $root 'dist-preview\glyph_preview_handler.dll'
if (-not (Test-Path $dll)) { throw "Missing $dll; run pnpm build:preview-handler first." }

New-Item "$clsidKey\InprocServer32" -Force | Out-Null
Set-ItemProperty $clsidKey -Name '(default)' -Value 'Glyph Markdown Preview Handler'
Set-ItemProperty $clsidKey -Name 'DisplayName' -Value 'Glyph Markdown Preview Handler'
Set-ItemProperty $clsidKey -Name 'AppID' -Value $prevhostAppId
Set-ItemProperty $clsidKey -Name 'DisableLowILProcessIsolation' -Value 1 -Type DWord
Set-ItemProperty "$clsidKey\InprocServer32" -Name '(default)' -Value $dll
Set-ItemProperty "$clsidKey\InprocServer32" -Name 'ThreadingModel' -Value 'Apartment'

foreach ($ext in $extensions) {
  $previous = Get-Handler $ext
  if ($previous -and $previous -ne $clsid) {
    Set-ItemProperty $clsidKey -Name "Previous.$ext" -Value $previous
  }
  Set-Handler $ext $clsid
}

if (-not (Test-Path $approved)) { New-Item $approved | Out-Null }
Set-ItemProperty $approved -Name $clsid -Value 'Glyph Markdown Preview Handler'
Write-Host "Registered $dll for: $($extensions -join ', ')"
