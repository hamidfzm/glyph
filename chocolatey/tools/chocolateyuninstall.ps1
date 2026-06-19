$ErrorActionPreference = 'Stop'

$packageArgs = @{
  packageName = 'glyph'
  fileType    = 'msi'
  silentArgs  = '/qn /norestart'
}

[array]$key = Get-UninstallRegistryKey -SoftwareName 'Glyph*'

if ($key.Count -eq 1) {
  $key | ForEach-Object {
    $packageArgs['file'] = "$($_.UninstallString.Replace('MsiExec.exe /I','').Replace('MsiExec.exe /X',''))"
    Uninstall-ChocolateyPackage @packageArgs
  }
}

# Remove the Start Menu and Desktop shortcuts created by the install script.
# Silent so a missing shortcut (e.g. user deleted it manually) is not an error.
$shortcuts = @(
  (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\Glyph.lnk'),
  (Join-Path $env:Public 'Desktop\Glyph.lnk')
)
foreach ($lnk in $shortcuts) {
  if (Test-Path -LiteralPath $lnk) {
    Remove-Item -LiteralPath $lnk -Force -ErrorAction SilentlyContinue
  }
}

# Remove the `glyph` PATH shim created by chocolateyinstall.ps1.
Uninstall-BinFile -Name 'glyph'
