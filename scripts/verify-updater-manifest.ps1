param(
  [Parameter(Mandatory = $true)][string]$ReleaseDir,
  [Parameter(Mandatory = $true)][string]$Version,
  [Parameter(Mandatory = $true)][string]$DownloadRoot
)

# End-to-end check of the updater manifest that is actually uploaded.
#
# Why this exists: the in-app updater downloads whatever latest.json points at
# and runs it. Pointing it at the standalone `-setup.exe` makes an update run
# the full first-time NSIS wizard, so the user sees "Installing" and a
# "Create folder:" progress log — an update that looks like a reinstall. The
# updater must be handed the `.nsis.zip` updater bundle instead.
#
# Nothing else in the release pipeline compared latest.json against the files on
# disk, so a manifest pointing at the wrong artifact shipped green.

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

  # THE regression guard. A raw installer here is what re-runs the setup wizard.
  if (-not $fileName.EndsWith('.nsis.zip', [System.StringComparison]::Ordinal)) {
    throw "Platform '$name' points at '$fileName'. In-app updates must download the NSIS updater bundle (*.nsis.zip); a standalone -setup.exe runs the full install wizard."
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

  # A zip that is not really a zip would be extracted into nothing at install time.
  $bytes = [System.IO.File]::ReadAllBytes($artifactPath)
  if ($bytes.Length -lt 4 -or $bytes[0] -ne 0x50 -or $bytes[1] -ne 0x4B) {
    throw "Platform '$name' artifact '$fileName' is not a ZIP archive."
  }

  Write-Host "Verified $name -> $fileName ($([Math]::Round($bytes.Length / 1MB, 1)) MB, signature matches)"
  $verified++
}

if ($verified -ne $requiredPlatforms.Count) {
  throw "Verified $verified platform(s); expected $($requiredPlatforms.Count)."
}

Write-Host "Updater manifest verified: $verified platform(s) point at signed NSIS updater bundles."