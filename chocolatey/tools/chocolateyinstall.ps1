$ErrorActionPreference = 'Stop'

$packageArgs = @{
  packageName    = 'glyph'
  fileType       = 'msi'
  url64bit       = "https://github.com/hamidfzm/glyph/releases/download/v$env:ChocolateyPackageVersion/Glyph_$($env:ChocolateyPackageVersion)_x64_en-US.msi"
  checksum64     = '{{SHA256}}'
  checksumType64 = 'sha256'
  silentArgs     = '/qn /norestart'
  validExitCodes = @(0, 3010)
}

Install-ChocolateyPackage @packageArgs

# The Tauri WiX template should create Start Menu / Desktop shortcuts, but
# we've seen MSI installs land Glyph in Program Files without surfacing it
# in the Start Menu or Apps list (#188). Install shortcuts defensively from
# the Chocolatey side so `choco install glyph` always leaves the app
# discoverable. Idempotent: rerunning the install replaces the .lnks.

# Locate the installed Glyph.exe. Prefer the registry uninstall key
# (authoritative even if MSI changes install directory in the future) and
# fall back to the Tauri default `Program Files\Glyph` per-machine path.
$exePath = $null
$keys = Get-UninstallRegistryKey -SoftwareName 'Glyph*'
foreach ($key in $keys) {
  $candidateDir = $key.InstallLocation
  if ($candidateDir -and (Test-Path (Join-Path $candidateDir 'Glyph.exe'))) {
    $exePath = Join-Path $candidateDir 'Glyph.exe'
    break
  }
}
if (-not $exePath) {
  $fallback = Join-Path $env:ProgramFiles 'Glyph\Glyph.exe'
  if (Test-Path $fallback) { $exePath = $fallback }
}

if ($exePath) {
  $workingDir = Split-Path -Parent $exePath

  $startMenuShortcut = Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\Glyph.lnk'
  Install-ChocolateyShortcut `
    -ShortcutFilePath $startMenuShortcut `
    -TargetPath $exePath `
    -WorkingDirectory $workingDir `
    -Description 'Cross-platform markdown viewer' `
    -IconLocation $exePath

  $desktopShortcut = Join-Path $env:Public 'Desktop\Glyph.lnk'
  Install-ChocolateyShortcut `
    -ShortcutFilePath $desktopShortcut `
    -TargetPath $exePath `
    -WorkingDirectory $workingDir `
    -Description 'Cross-platform markdown viewer' `
    -IconLocation $exePath

  # Expose a `glyph` command on PATH so `glyph file.md` works from a terminal,
  # matching macOS (Homebrew cask binary) and Linux (deb /usr/bin/glyph). The
  # MSI itself does not add the exe to PATH. Install-BinFile creates a shim in
  # the Chocolatey bin directory (already on PATH); shimgen detects the GUI
  # subsystem so the shim launches Glyph and returns instead of blocking.
  Install-BinFile -Name 'glyph' -Path $exePath
} else {
  Write-Warning "Glyph.exe was not found after MSI install. Skipping shortcut and shim creation."
}
