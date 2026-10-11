$ErrorActionPreference = 'Stop'
$fixture = Join-Path $env:TEMP ('boz-updater-fixture-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $fixture | Out-Null
try {
  $downloadRoot = 'https://github.com/AlGhozaliRamadhan/BOZ/releases/download/v2.9.0'
  $version = '2.9.0'

  function New-Zip([string]$name) {
    $p = Join-Path $fixture $name
    [System.IO.File]::WriteAllBytes($p, [byte[]](0x50, 0x4B, 0x03, 0x04, 0, 0, 0, 0))
    return $p
  }

  # ── case 1: correct manifest (bundles) must PASS ──
  $x64 = New-Zip 'boz-v2.9.0-windows-x64-setup.exe.nsis.zip'
  $arm = New-Zip 'boz-v2.9.0-windows-arm64-setup.exe.nsis.zip'
  foreach ($n in @('boz-v2.9.0-windows-x64-setup.exe', 'boz-v2.9.0-windows-arm64-setup.exe')) {
    [System.IO.File]::WriteAllBytes((Join-Path $fixture $n), [byte[]](0x4D, 0x5A, 0, 0))
  }
  'SIG-X64' | Set-Content -LiteralPath "$x64.sig" -NoNewline
  'SIG-ARM' | Set-Content -LiteralPath "$arm.sig" -NoNewline

  $good = [ordered]@{
    version = $version
    notes = 'https://github.com/AlGhozaliRamadhan/BOZ/pull/1'
    platforms = [ordered]@{
      'windows-x86_64' = [ordered]@{ signature = 'SIG-X64'; url = "$downloadRoot/boz-v2.9.0-windows-x64-setup.exe.nsis.zip" }
      'windows-aarch64' = [ordered]@{ signature = 'SIG-ARM'; url = "$downloadRoot/boz-v2.9.0-windows-arm64-setup.exe.nsis.zip" }
    }
  }
  $good | ConvertTo-Json -Depth 4 | ForEach-Object { [System.IO.File]::WriteAllText((Join-Path $fixture 'latest.json'), $_, (New-Object System.Text.UTF8Encoding($false))) }
  & "$PSScriptRoot\..\scripts\verify-updater-manifest.ps1" -ReleaseDir $fixture -Version $version -DownloadRoot $downloadRoot
  Write-Host 'PASS: correct bundle manifest accepted' -ForegroundColor Green

  # ── case 2: the #116 regression — manifest points at the raw installer ──
  $bad = [ordered]@{
    version = $version
    notes = 'https://github.com/AlGhozaliRamadhan/BOZ/pull/1'
    platforms = [ordered]@{
      'windows-x86_64' = [ordered]@{ signature = 'SIG-X64'; url = "$downloadRoot/boz-v2.9.0-windows-x64-setup.exe" }
      'windows-aarch64' = [ordered]@{ signature = 'SIG-ARM'; url = "$downloadRoot/boz-v2.9.0-windows-arm64-setup.exe.nsis.zip" }
    }
  }
  $bad | ConvertTo-Json -Depth 4 | ForEach-Object { [System.IO.File]::WriteAllText((Join-Path $fixture 'latest.json'), $_, (New-Object System.Text.UTF8Encoding($false))) }
  $failed = $false
  try {
    & "$PSScriptRoot\..\scripts\verify-updater-manifest.ps1" -ReleaseDir $fixture -Version $version -DownloadRoot $downloadRoot
  } catch {
    $failed = $true
    Write-Host "PASS: rejected raw installer -> $($_.Exception.Message)"
  }
  if (-not $failed) { throw 'Case 2 FAILED: raw -setup.exe was not rejected.' }

  # ── case 3: signature mismatch must be rejected ──
  $good | ConvertTo-Json -Depth 4 | ForEach-Object { [System.IO.File]::WriteAllText((Join-Path $fixture 'latest.json'), $_, (New-Object System.Text.UTF8Encoding($false))) }
  'WRONG-SIG' | Set-Content -LiteralPath "$x64.sig" -NoNewline
  $failed = $false
  try {
    & "$PSScriptRoot\..\scripts\verify-updater-manifest.ps1" -ReleaseDir $fixture -Version $version -DownloadRoot $downloadRoot
  } catch {
    $failed = $true
    Write-Host "PASS: rejected signature mismatch -> $($_.Exception.Message)"
  }
  if (-not $failed) { throw 'Case 3 FAILED: signature mismatch was not rejected.' }

  # ── case 4: missing artifact file must be rejected ──
  'SIG-X64' | Set-Content -LiteralPath "$x64.sig" -NoNewline
  Remove-Item -LiteralPath $arm -Force
  $failed = $false
  try {
    & "$PSScriptRoot\..\scripts\verify-updater-manifest.ps1" -ReleaseDir $fixture -Version $version -DownloadRoot $downloadRoot
  } catch {
    $failed = $true
    Write-Host "PASS: rejected missing artifact -> $($_.Exception.Message)"
  }
  if (-not $failed) { throw 'Case 4 FAILED: missing artifact was not rejected.' }

  Write-Host 'All verify-updater-manifest cases passed.' -ForegroundColor Green
} finally {
  Remove-Item -LiteralPath $fixture -Recurse -Force -ErrorAction SilentlyContinue
}