param(
  [Parameter(Mandatory = $true)][string]$ReleaseDir,
  [Parameter(Mandatory = $true)][string]$Version,
  [Parameter(Mandatory = $true)][string]$DownloadRoot
)

# End-to-end check of the updater manifest that is actually uploaded.
#
# Why this exists: the in-app updater downloads whatever latest.json points at
# and runs it. A manifest that points at a missing or unsigned artifact makes
# every in-app update fail at the signature check, and one built from the wrong
# file name ships green because nothing compared the manifest against the files
# on disk.
#
# Note on artifact type: an NSIS bundle is emitted by Tauri as `*-setup.exe`
# plus `.sig`. There is no separate `*.nsis.zip` for NSIS targets, so the
# manifest must reference the signed installer. Whether an update shows the
# setup wizard is governed by `plugins.updater.windows.installMode`, not by
# the artifact type.

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $ReleaseDir).Path
$manifestPath = Join-Path $root 'latest.json'

if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
  throw "Updater manifest not found: $manifestPath"
}

$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json

if ($manifest.version -ne $Version) {
  throw "Manifest version '$($manifest.version)' does not match package.json version '$Version'."
}

$platforms = $manifest.platforms.PSObject.Properties
if (-not $platforms -or $platforms.Count -eq 0) {
  throw 'Updater manifest declares no platforms.'
}

$requiredPlatforms = @('windows-x86_64', 'windows-aarch64')
foreach ($name in $requiredPlatforms) {
  if (-not $manifest.platforms.PSObject.Properties.Name.Contains($name)) {
    throw "Updater manifest is missing the '$name' platform."
  }
}

$verified = 0
foreach ($platform in $platforms) {
  $name = $platform.Name
  $entry = $platform.Value

  if ([string]::IsNullOrWhiteSpace($entry.url)) { throw "Platform '$name' has no url." }
  if ([string]::IsNullOrWhiteSpace($entry.signature)) { throw "Platform '$name' has no signature." }

  # The url must live under the expected release, not somewhere else.
  $expectedPrefix = "$DownloadRoot/"
  if (-not $entry.url.StartsWith($expectedPrefix, [System.StringComparison]::Ordinal)) {
    throw "Platform '$name' url '$($entry.url)' is not under the release download root."
  }

  $fileName = $entry.url.Substring($expectedPrefix.Length)
  if ([string]::IsNullOrWhiteSpace($fileName) -or $fileName.Contains('/')) {
    throw "Platform '$name' url must reference a file directly in the release root: '$($entry.url)'."
  }

  # THE regression guard: the artifact must be the signed NSIS installer that
  # Tauri actually produces for this bundle.
  if (-not $fileName.EndsWith('-setup.exe', [System.StringComparison]::Ordinal)) {
    throw "Platform '$name' points at '$fileName'. The updater artifact for an NSIS bundle is the signed *-setup.exe; Tauri v2 emits no separate .nsis.zip."
  }

  $artifactPath = Join-Path $root $fileName
  if (-not (Test-Path -LiteralPath $artifactPath -PathType Leaf)) {
    throw "Platform '$name' references '$fileName', which is not in the release directory."
  }

  $signaturePath = Join-Path $root "$fileName.sig"
  if (-not (Test-Path -LiteralPath $signaturePath -PathType Leaf)) {
    throw "Platform '$name' references '$fileName' but '$fileName.sig' is missing from the release directory."
  }

  $onDisk = (Get-Content -Raw -LiteralPath $signaturePath).Trim()
  if ($onDisk -ne $entry.signature.Trim()) {
    throw "Platform '$name' signature does not match '$fileName.sig'. The updater verifies the manifest signature, so a mismatch breaks every in-app update."
  }

  # A payload that is not a Windows executable cannot be run by the updater.
  $bytes = [System.IO.File]::ReadAllBytes($artifactPath)
  if ($bytes.Length -lt 2 -or $bytes[0] -ne 0x4D -or $bytes[1] -ne 0x5A) {
    throw "Platform '$name' artifact '$fileName' is not a Windows executable (missing MZ header)."
  }

  Write-Host "Verified $name -> $fileName ($([Math]::Round($bytes.Length / 1MB, 1)) MB, signature matches)"
  $verified++
}

if ($verified -ne $requiredPlatforms.Count) {
  throw "Verified $verified platform(s); expected $($requiredPlatforms.Count)."
}

Write-Host "Updater manifest verified: $verified platform(s) point at signed NSIS installers."