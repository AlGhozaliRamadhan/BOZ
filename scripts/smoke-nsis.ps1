param(
  [Parameter(Mandatory = $true)][string]$InstallerPath
)

$ErrorActionPreference = 'Stop'
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\BOZ'
$expectedInstallRoot = Join-Path $env:LOCALAPPDATA 'BOZ'
$installer = (Resolve-Path -LiteralPath $InstallerPath).Path

if (Test-Path -LiteralPath $uninstallKey) {
  throw 'BOZ is already installed. The NSIS smoke test only runs on a clean Windows account.'
}

$uninstaller = $null
try {
  $install = Start-Process -FilePath $installer -ArgumentList '/S' -WindowStyle Hidden -PassThru -Wait
  if ($install.ExitCode -ne 0) {
    throw "BOZ installer exited with code $($install.ExitCode)."
  }

  $entry = Get-ItemProperty -LiteralPath $uninstallKey -ErrorAction Stop
  $installRoot = ([string]$entry.InstallLocation).Trim('"')
  if ([System.IO.Path]::GetFullPath($installRoot) -ne [System.IO.Path]::GetFullPath($expectedInstallRoot)) {
    throw "Unexpected per-user installation directory: $installRoot"
  }

  $application = ([string]$entry.DisplayIcon).Trim('"')
  $uninstaller = ([string]$entry.UninstallString).Trim('"')
  foreach ($path in @($application, $uninstaller, (Join-Path $installRoot 'resources\node.exe'))) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
      throw "Installed BOZ file is missing: $path"
    }
  }

  & "$PSScriptRoot\smoke-desktop.ps1" `
    -ApplicationPath $application `
    -ResourceDirectory (Join-Path $installRoot 'resources') `
    -ConfigDirectory 'artifacts/desktop-smoke/installed-profile'
} finally {
  if (-not $uninstaller -and (Test-Path -LiteralPath $uninstallKey)) {
    $entry = Get-ItemProperty -LiteralPath $uninstallKey -ErrorAction SilentlyContinue
    $uninstaller = ([string]$entry.UninstallString).Trim('"')
  }
  if ($uninstaller -and (Test-Path -LiteralPath $uninstaller -PathType Leaf)) {
    $uninstall = Start-Process -FilePath $uninstaller -ArgumentList '/S' -WindowStyle Hidden -PassThru -Wait
    if ($uninstall.ExitCode -ne 0) {
      throw "BOZ uninstaller exited with code $($uninstall.ExitCode)."
    }
  }
}

$deadline = (Get-Date).AddSeconds(15)
while ((Test-Path -LiteralPath $uninstallKey) -or (Test-Path -LiteralPath $expectedInstallRoot)) {
  if ((Get-Date) -gt $deadline) { break }
  Start-Sleep -Milliseconds 500
}

# The NSIS uninstaller only removes files it installed. The Next.js sidecar
# legitimately persists its route cache under resources\server\.next at
# runtime (page renders during the smoke run create it), so that subtree is
# expected residue. Everything else — especially the registry entry — must
# be gone.
$allowedCacheRoot = Join-Path $expectedInstallRoot 'resources\server\.next'
$separator = [System.IO.Path]::DirectorySeparatorChar
$offenders = @()
if (Test-Path -LiteralPath $uninstallKey) { $offenders += "registry key still present: $uninstallKey" }
if (Test-Path -LiteralPath $expectedInstallRoot) {
  Get-ChildItem -LiteralPath $expectedInstallRoot -Recurse -Force -ErrorAction SilentlyContinue |
    Where-Object {
      $itemPath = $_.FullName
      $inCache = $itemPath.Equals($allowedCacheRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
        $itemPath.StartsWith($allowedCacheRoot + $separator, [System.StringComparison]::OrdinalIgnoreCase)
      $isCacheAncestor = $allowedCacheRoot.StartsWith($itemPath + $separator, [System.StringComparison]::OrdinalIgnoreCase)
      -not ($inCache -or $isCacheAncestor)
    } |
    Select-Object -First 20 -ExpandProperty FullName |
    ForEach-Object { $offenders += "unexpected residue: $_" }
}
if ($offenders.Count -gt 0) {
  $holders = @((Get-Process boz-desktop -ErrorAction SilentlyContinue | ForEach-Object Id) +
    (Get-Process msedgewebview2 -ErrorAction SilentlyContinue | ForEach-Object Id) |
    Select-Object -Unique)
  if ($holders.Count -gt 0) { $offenders += "processes still alive: $($holders -join ', ')" }
  throw "BOZ did not fully remove its per-user registry entry and installation directory.`n$($offenders -join "`n")"
}

Write-Host 'Verified per-user NSIS install, desktop launch, and uninstall (Next.js runtime route cache excluded).'
