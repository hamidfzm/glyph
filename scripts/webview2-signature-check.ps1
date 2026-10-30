# Fails unless a file carries a trusted, embedded Authenticode signature from
# Microsoft Corporation. Tauri's bundler downloads the WebView2 installer it puts
# in the offline MSI with no hash or signature check, so this is the only one.
#
#   powershell -File scripts/webview2-signature-check.ps1 <installer.exe>
param([Parameter(Mandatory)][string]$Path)
$ErrorActionPreference = 'Stop'

$signature = Get-AuthenticodeSignature -LiteralPath $Path
if ($signature.Status -ne 'Valid') {
  throw "$Path fails on status: $($signature.Status), $($signature.StatusMessage)"
}
if ($signature.SignatureType -ne 'Authenticode') {
  throw "$Path fails on type: $($signature.SignatureType), not embedded"
}
# One name per line, so a value that merely contains this text cannot match.
if ($signature.SignerCertificate.SubjectName.Format($true) -notmatch '(?m)^O=Microsoft Corporation\r?$') {
  throw "$Path fails on signer: $($signature.SignerCertificate.Subject)"
}
Write-Host "Signed by Microsoft Corporation: $Path" -ForegroundColor Green
