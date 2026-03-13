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
