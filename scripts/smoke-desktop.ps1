param(
  [string]$ApplicationPath = 'src-tauri/target/release/boz-desktop.exe',
  [string]$ResourceDirectory = 'src-tauri/target/release/resources',
  [string]$ConfigDirectory = 'artifacts/desktop-smoke/profile',
  [int]$StartupTimeoutSeconds = 35,
  [switch]$ForceSidecar,
  [switch]$SkipWindowCycles
)

$ErrorActionPreference = 'Stop'

if (-not ('BozNativeWindow' -as [type])) {
  Add-Type @'
using System;
using System.Collections.Generic;
using System.Text;
using System.Runtime.InteropServices;

public static class BozNativeWindow {
  private delegate bool EnumWindowsProc(IntPtr window, IntPtr parameter);

  [DllImport("user32.dll")]
  private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);

  [DllImport("user32.dll")]
  private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  private static extern int GetWindowText(IntPtr window, StringBuilder text, int maximumCount);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  private static extern int GetClassName(IntPtr window, StringBuilder text, int maximumCount);

  [DllImport("user32.dll")]
  private static extern bool IsWindowVisible(IntPtr window);

  [DllImport("user32.dll")]
  private static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);

  public static IntPtr FindWindow(uint expectedProcessId, string expectedTitle) {
    IntPtr result = IntPtr.Zero;
    EnumWindows((window, parameter) => {
      uint processId;
      GetWindowThreadProcessId(window, out processId);
      if (processId != expectedProcessId) return true;
      var title = new StringBuilder(256);
      GetWindowText(window, title, title.Capacity);
      if (!title.ToString().StartsWith(expectedTitle, StringComparison.OrdinalIgnoreCase)) return true;
      result = window;
      return false;
    }, IntPtr.Zero);
    return result;
  }

  public static bool RequestClose(IntPtr window) {
    return PostMessage(window, 0x0010, IntPtr.Zero, IntPtr.Zero);
  }

  public static string[] DescribeWindows(uint expectedProcessId) {
    var results = new List<string>();
    EnumWindows((window, parameter) => {
      uint processId;
      GetWindowThreadProcessId(window, out processId);
      if (processId != expectedProcessId) return true;
      var title = new StringBuilder(256);
      var className = new StringBuilder(256);
      GetWindowText(window, title, title.Capacity);
      GetClassName(window, className, className.Capacity);
      results.Add($"title='{title}' class='{className}' visible={IsWindowVisible(window)} handle={window}");
      return true;
    }, IntPtr.Zero);
    return results.ToArray();
  }
}
'@
}

function Test-BozPort {
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    return $client.ConnectAsync('127.0.0.1', 21526).Wait(250)
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

$application = (Resolve-Path -LiteralPath $ApplicationPath).Path
$resourceRoot = (Resolve-Path -LiteralPath $ResourceDirectory).Path
$node = Join-Path $resourceRoot 'node.exe'
if (-not (Test-Path -LiteralPath $node -PathType Leaf)) {
  throw "Bundled Node.js executable is missing: $node"
}
if (Test-BozPort) {
  throw 'Port 21526 is already in use; refusing to disturb an existing process.'
}

$configRoot = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $ConfigDirectory))
New-Item -ItemType Directory -Force -Path $configRoot | Out-Null
$desktopLog = Join-Path $configRoot 'desktop.log'
$expectedVersion = (Get-Content -Raw -LiteralPath 'package.json' | ConvertFrom-Json).version
$baselineNodeIds = @(Get-Process node -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -eq $node } |
  ForEach-Object Id)
$previousEnvironment = @{}
foreach ($name in @('BOZ_DESKTOP_CONFIG_DIR', 'BOZ_DESKTOP_LOG', 'BOZ_DESKTOP_FORCE_SIDECAR', 'BOZ_DESKTOP_RESOURCE_DIR')) {
  $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
[Environment]::SetEnvironmentVariable('BOZ_DESKTOP_CONFIG_DIR', $configRoot, 'Process')
[Environment]::SetEnvironmentVariable('BOZ_DESKTOP_LOG', $desktopLog, 'Process')
if ($ForceSidecar) {
  [Environment]::SetEnvironmentVariable('BOZ_DESKTOP_FORCE_SIDECAR', '1', 'Process')
  [Environment]::SetEnvironmentVariable('BOZ_DESKTOP_RESOURCE_DIR', $resourceRoot, 'Process')
}

$first = $null
$secondaryProcesses = @()
function Get-NewBozNodeProcesses {
  @(Get-Process node -ErrorAction SilentlyContinue | Where-Object {
    $baselineNodeIds -notcontains $_.Id -and $_.Path -and (
      $_.Path -eq $node -or
      $_.Path.EndsWith('\BOZ\resources\node.exe', [System.StringComparison]::OrdinalIgnoreCase)
    )
  })
}

$collisionLog = Join-Path $configRoot "port-collision-$([guid]::NewGuid()).log"
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 21526)
$collisionHost = $null
try {
  $listener.Start()
  [Environment]::SetEnvironmentVariable('BOZ_DESKTOP_LOG', $collisionLog, 'Process')
  $collisionHost = Start-Process -FilePath $application -ArgumentList '--autostart' -WindowStyle Hidden -PassThru
  $collisionDeadline = (Get-Date).AddSeconds(10)
  do {
    Start-Sleep -Milliseconds 250
    $collisionDetected = (Test-Path -LiteralPath $collisionLog) -and
      ((Get-Content -Raw -LiteralPath $collisionLog) -match 'already in use')
  } until ($collisionDetected -or (Get-Date) -gt $collisionDeadline)
  if (-not $collisionDetected) {
    throw 'BOZ did not report its fixed-port collision within 10 seconds.'
  }
  if ((Get-NewBozNodeProcesses).Count -ne 0) {
    throw 'BOZ spawned a Node.js sidecar despite the fixed-port collision.'
  }
} finally {
  if ($collisionHost -and -not $collisionHost.HasExited) {
    Stop-Process -Id $collisionHost.Id -Force -ErrorAction SilentlyContinue
  }
  $listener.Stop()
  [Environment]::SetEnvironmentVariable('BOZ_DESKTOP_LOG', $desktopLog, 'Process')
  Start-Sleep -Seconds 1
}

$baselineWebViewIds = @(Get-Process msedgewebview2 -ErrorAction SilentlyContinue | ForEach-Object Id)
try {
  $first = Start-Process -FilePath $application -ArgumentList '--autostart' -WindowStyle Hidden -PassThru
  $deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
  $version = $null
  do {
    Start-Sleep -Milliseconds 500
    try {
      $version = Invoke-RestMethod -Uri 'http://127.0.0.1:21526/api/version' -TimeoutSec 2
    } catch {
      if ($first.HasExited) {
        throw "BOZ desktop host exited during startup with code $($first.ExitCode)."
      }
    }
  } until ($version -or (Get-Date) -gt $deadline)

  if (-not $version) {
    $tail = if (Test-Path -LiteralPath $desktopLog) {
      (Get-Content -LiteralPath $desktopLog -Tail 20) -join [Environment]::NewLine
    } else {
      'No desktop log was produced.'
    }
    throw "BOZ did not become ready within $StartupTimeoutSeconds seconds.`n$tail"
  }
  if ($version.currentVersion -ne $expectedVersion -or $version.distribution -ne 'desktop') {
    throw "Unexpected desktop version response: $($version | ConvertTo-Json -Compress)"
  }

  $second = Start-Process -FilePath $application -ArgumentList '--autostart' -WindowStyle Hidden -PassThru
  $secondaryProcesses += $second
  if (-not $second.WaitForExit(10000)) {
    throw 'A second BOZ launch did not hand off to the existing instance.'
  }
  if ($second.ExitCode -ne 0) {
    throw "The second BOZ launch exited with code $($second.ExitCode)."
  }
  Start-Sleep -Seconds 2

  $hideShowPrivateMiB = @()
  $cycles = if ($SkipWindowCycles) { @() } else { 1..4 }
  foreach ($cycle in $cycles) {
    $windowDeadline = (Get-Date).AddSeconds(5)
    do {
      $window = [BozNativeWindow]::FindWindow([uint32]$first.Id, 'BOZ')
      if ($window -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 250 }
    } until ($window -ne [IntPtr]::Zero -or (Get-Date) -gt $windowDeadline)
    if ($window -eq [IntPtr]::Zero) {
      $windows = [BozNativeWindow]::DescribeWindows([uint32]$first.Id) -join '; '
      throw "BOZ did not expose a main window before hide/show cycle $cycle. Windows: $windows"
    }
    if (-not [BozNativeWindow]::RequestClose($window)) {
      throw "BOZ did not accept a close-to-tray request during cycle $cycle."
    }
    Start-Sleep -Milliseconds 750
    $first.Refresh()
    if ($first.HasExited) {
      throw "BOZ exited instead of hiding in the tray during cycle $cycle."
    }
    $cycleVersion = Invoke-RestMethod -Uri 'http://127.0.0.1:21526/api/version' -TimeoutSec 2
    if ($cycleVersion.currentVersion -ne $expectedVersion) {
      throw "BOZ stopped serving while hidden during cycle $cycle."
    }

    $reopen = Start-Process -FilePath $application -ArgumentList '--autostart' -WindowStyle Hidden -PassThru
    $secondaryProcesses += $reopen
    if (-not $reopen.WaitForExit(10000) -or $reopen.ExitCode -ne 0) {
      throw "BOZ did not reopen through its single-instance handoff during cycle $cycle."
    }
    Start-Sleep -Seconds 1
    $cycleNodes = @(Get-NewBozNodeProcesses)
    if ($cycleNodes.Count -ne 1) {
      throw "BOZ had $($cycleNodes.Count) Node.js sidecars after hide/show cycle $cycle."
    }
    $cycleWebViews = @(Get-Process msedgewebview2 -ErrorAction SilentlyContinue |
      Where-Object { $baselineWebViewIds -notcontains $_.Id })
    $first.Refresh()
    $cyclePrivateBytes = $first.PrivateMemorySize64 +
      (($cycleNodes | Measure-Object PrivateMemorySize64 -Sum).Sum) +
      (($cycleWebViews | Measure-Object PrivateMemorySize64 -Sum).Sum)
    $hideShowPrivateMiB += [math]::Round($cyclePrivateBytes / 1MB, 1)
  }
  if ($hideShowPrivateMiB.Count -gt 1 -and
      $hideShowPrivateMiB[-1] -gt $hideShowPrivateMiB[0] + 32) {
    throw "Private memory grew by more than 32 MiB across hide/show cycles: $($hideShowPrivateMiB -join ', ')"
  }

  $nodes = @(Get-NewBozNodeProcesses)
  if ($nodes.Count -ne 1) {
    throw "Expected exactly one bundled Node.js sidecar; found $($nodes.Count)."
  }
  $webviews = @(Get-Process msedgewebview2 -ErrorAction SilentlyContinue |
    Where-Object { $baselineWebViewIds -notcontains $_.Id })
  $first.Refresh()

  $result = [ordered]@{
    version = $version.currentVersion
    distribution = $version.distribution
    firstHostPid = $first.Id
    secondExitCode = $second.ExitCode
    bundledNodeCount = $nodes.Count
    hostWorkingMiB = [math]::Round($first.WorkingSet64 / 1MB, 1)
    hostPrivateMiB = [math]::Round($first.PrivateMemorySize64 / 1MB, 1)
    nodeWorkingMiB = [math]::Round((($nodes | Measure-Object WorkingSet64 -Sum).Sum) / 1MB, 1)
    nodePrivateMiB = [math]::Round((($nodes | Measure-Object PrivateMemorySize64 -Sum).Sum) / 1MB, 1)
    webViewProcessCount = $webviews.Count
    webViewWorkingMiB = [math]::Round((($webviews | Measure-Object WorkingSet64 -Sum).Sum) / 1MB, 1)
    webViewPrivateMiB = [math]::Round((($webviews | Measure-Object PrivateMemorySize64 -Sum).Sum) / 1MB, 1)
    hideShowPrivateMiB = $hideShowPrivateMiB
  }
  $result | ConvertTo-Json
} finally {
  Get-NewBozNodeProcesses | Stop-Process -Force -ErrorAction SilentlyContinue
  foreach ($secondary in $secondaryProcesses) {
    if (-not $secondary.HasExited) {
      Stop-Process -Id $secondary.Id -Force -ErrorAction SilentlyContinue
    }
  }
  if ($first -and -not $first.HasExited) {
    Stop-Process -Id $first.Id -Force -ErrorAction SilentlyContinue
  }
  foreach ($name in $previousEnvironment.Keys) {
    [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process')
  }
  Start-Sleep -Milliseconds 500
}
