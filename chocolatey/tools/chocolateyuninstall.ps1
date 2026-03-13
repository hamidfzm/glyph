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
