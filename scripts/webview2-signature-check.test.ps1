# One case per check in webview2-signature-check.ps1. Each fixture's own signature
# is asserted first, so a runner image that changes one fails loudly here instead
# of a case passing for the wrong reason. The unsigned fixture is the glyph.exe a
# build leaves behind; the rest are already on any Windows machine with Node.
#
#   powershell -File scripts/webview2-signature-check.test.ps1 [-Unsigned <glyph.exe>]
param([string]$Unsigned = "$(Split-Path $PSScriptRoot -Parent)\src-tauri\target\release\glyph.exe")
$ErrorActionPreference = 'Stop'

$check = "$PSScriptRoot\webview2-signature-check.ps1"

function Assert-Fixture($path, $status, $type) {
  $signature = Get-AuthenticodeSignature -LiteralPath $path
  if ($signature.Status -ne $status -or $signature.SignatureType -ne $type) {
    throw "Fixture $path is $($signature.Status), $($signature.SignatureType); expected $status, $type."
  }
}

function Assert-Rejected($path, $reason) {
  try {
    & $check $path
  } catch {
    if ($_.Exception.Message -notmatch "fails on ${reason}:") {
      throw "Rejected for the wrong reason: $($_.Exception.Message)"
    }
    Write-Host "Rejected on ${reason}: $path" -ForegroundColor Green
    return
  }
  throw "Expected a rejection on ${reason}: $path"
}

# A certificate only this process holds: it claims to be Microsoft, but nothing
# trusts it, and it never touches a certificate store.
function New-ForgedCertificate {
  $request = [Security.Cryptography.X509Certificates.CertificateRequest]::new(
    'CN=Microsoft Corporation, O=Microsoft Corporation',
    [Security.Cryptography.RSA]::Create(2048),
    [Security.Cryptography.HashAlgorithmName]::SHA256,
    [Security.Cryptography.RSASignaturePadding]::Pkcs1)
  $usages = [Security.Cryptography.OidCollection]::new()
  [void]$usages.Add([Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.3')) # code signing
  $request.CertificateExtensions.Add(
    [Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($usages, $false))
  $request.CreateSelfSigned([DateTimeOffset]::Now.AddDays(-1), [DateTimeOffset]::Now.AddDays(1))
}

$microsoft = (Get-Item 'C:\Program Files (x86)\Microsoft\EdgeWebView\Application\*\msedgewebview2.exe' | Select-Object -First 1).FullName
Assert-Fixture $microsoft 'Valid' 'Authenticode'
& $check $microsoft

$thirdParty = (Get-Command node).Source
Assert-Fixture $thirdParty 'Valid' 'Authenticode'
Assert-Rejected $thirdParty 'signer'

$catalogSigned = "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
Assert-Fixture $catalogSigned 'Valid' 'Catalog'
Assert-Rejected $catalogSigned 'type'

$scratch = New-Item -ItemType Directory (Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid()))
try {
  $copy = "$scratch\fixture.exe"
  Copy-Item $Unsigned $copy
  Assert-Fixture $copy 'NotSigned' 'None'
  Assert-Rejected $copy 'status'

  [void](Set-AuthenticodeSignature -LiteralPath $copy -Certificate (New-ForgedCertificate))
  Assert-Fixture $copy 'UnknownError' 'Authenticode'
  Assert-Rejected $copy 'status'
} finally {
  Remove-Item -Recurse -Force $scratch
}
Write-Host 'Every check rejects what it should.' -ForegroundColor Green
