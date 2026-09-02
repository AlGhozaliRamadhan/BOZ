import { spawn } from 'node:child_process';
import type { Readable } from 'node:stream';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ORIGINAL_BOZ_LOGO = join(MODULE_ROOT, 'public', 'logo-boz-transparant-white.png');
const READY_MARKER = 'BOZ_TRAY_READY';
const EXIT_MARKER = 'BOZ_TRAY_EXIT';
const TOGGLE_STARTUP_MARKER = 'BOZ_TRAY_TOGGLE_STARTUP';
const START_TIMEOUT_MS = 10_000;

export interface SystemTrayOptions {
  url: string;
  iconPath?: string;
  startupAvailable: boolean;
  startupEnabled: boolean;
  onExit: () => void;
  onToggleStartup: () => void;
  onUnexpectedExit?: (message: string) => void;
}

export interface SystemTrayHandle { stop: () => void; }

const WINDOWS_TRAY_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies 'System.Drawing', 'System.Windows.Forms' -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public static class BozNativeMethods {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetProcessDpiAwarenessContext(IntPtr dpiFlag);

    [DllImport("user32.dll")]
    public static extern bool DestroyIcon(IntPtr handle);

    [DllImport("user32.dll")]
    public static extern int GetSystemMetrics(int nIndex);

    [DllImport("dwmapi.dll", PreserveSig = true)]
    private static extern int DwmSetWindowAttribute(
        IntPtr handle,
        int attribute,
        ref int value,
        int valueSize
    );

    public static void EnableDpiAwareness() {
        try {
            SetProcessDpiAwarenessContext(new IntPtr(-4)); // PER_MONITOR_AWARE_V2
        } catch {
            try {
                SetProcessDpiAwarenessContext(new IntPtr(-3)); // PER_MONITOR_AWARE
            } catch {}
        }
    }

    public static void UseRoundedCorners(IntPtr handle) {
        try {
            const int DWMWA_WINDOW_CORNER_PREFERENCE = 33;
            const int DWMWCP_ROUND = 2;
            int preference = DWMWCP_ROUND;
            DwmSetWindowAttribute(
                handle,
                DWMWA_WINDOW_CORNER_PREFERENCE,
                ref preference,
                Marshal.SizeOf(typeof(int))
            );
        } catch {
            // Older Windows versions keep their native menu corners.
        }
    }

    public static Bitmap CreateCrispTrayIcon(string sourcePath, int targetSize) {
        using (Bitmap rawSource = new Bitmap(sourcePath)) {
            int canvasSize = Math.Max(rawSource.Width, rawSource.Height);
            Bitmap current = new Bitmap(canvasSize, canvasSize, PixelFormat.Format32bppArgb);
            using (Graphics canvas = Graphics.FromImage(current)) {
                canvas.Clear(Color.Transparent);
                canvas.InterpolationMode = InterpolationMode.HighQualityBicubic;
                canvas.SmoothingMode = SmoothingMode.HighQuality;
                canvas.PixelOffsetMode = PixelOffsetMode.HighQuality;
                canvas.CompositingQuality = CompositingQuality.HighQuality;
                int x = (canvasSize - rawSource.Width) / 2;
                int y = (canvasSize - rawSource.Height) / 2;
                canvas.DrawImage(rawSource, x, y, rawSource.Width, rawSource.Height);
            }

            int currentSize = canvasSize;
            while (currentSize > targetSize * 2) {
                int nextSize = Math.Max(targetSize * 2, currentSize / 2);
                Bitmap next = new Bitmap(nextSize, nextSize, PixelFormat.Format32bppArgb);
                using (Graphics graphics = Graphics.FromImage(next)) {
                    graphics.Clear(Color.Transparent);
                    graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    graphics.SmoothingMode = SmoothingMode.HighQuality;
                    graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
                    graphics.CompositingQuality = CompositingQuality.HighQuality;
                    graphics.DrawImage(current, new Rectangle(0, 0, nextSize, nextSize));
                }
                current.Dispose();
                current = next;
                currentSize = nextSize;
            }

            Bitmap final = new Bitmap(targetSize, targetSize, PixelFormat.Format32bppArgb);
            using (Graphics graphics = Graphics.FromImage(final)) {
                graphics.Clear(Color.Transparent);
                graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                graphics.SmoothingMode = SmoothingMode.HighQuality;
                graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
                graphics.CompositingQuality = CompositingQuality.HighQuality;
                graphics.DrawImage(current, new Rectangle(0, 0, targetSize, targetSize));
            }
            current.Dispose();
            return final;
        }
    }
}

public class BozColorTable : ProfessionalColorTable {
    public override Color ToolStripDropDownBackground { get { return Color.FromArgb(28, 28, 30); } }
    public override Color MenuBorder { get { return Color.FromArgb(52, 52, 56); } }
    public override Color MenuItemBorder { get { return Color.Transparent; } }
    public override Color MenuItemSelected { get { return Color.FromArgb(46, 47, 52); } }
    public override Color MenuItemSelectedGradientBegin { get { return Color.FromArgb(46, 47, 52); } }
    public override Color MenuItemSelectedGradientEnd { get { return Color.FromArgb(46, 47, 52); } }
    public override Color MenuItemPressedGradientBegin { get { return Color.FromArgb(58, 59, 66); } }
    public override Color MenuItemPressedGradientEnd { get { return Color.FromArgb(58, 59, 66); } }
    public override Color MenuItemPressedGradientMiddle { get { return Color.FromArgb(58, 59, 66); } }
    public override Color ImageMarginGradientBegin { get { return Color.FromArgb(28, 28, 30); } }
    public override Color ImageMarginGradientMiddle { get { return Color.FromArgb(28, 28, 30); } }
    public override Color ImageMarginGradientEnd { get { return Color.FromArgb(28, 28, 30); } }
    public override Color CheckBackground { get { return Color.Transparent; } }
    public override Color CheckSelectedBackground { get { return Color.Transparent; } }
    public override Color CheckPressedBackground { get { return Color.Transparent; } }
    public override Color SeparatorDark { get { return Color.FromArgb(48, 48, 52); } }
    public override Color SeparatorLight { get { return Color.Transparent; } }
}

public class BozMenuRenderer : ToolStripProfessionalRenderer {
    private readonly Image headerLogo;

    public BozMenuRenderer(Image headerLogo) : base(new BozColorTable()) {
        this.headerLogo = headerLogo;
        this.RoundedEdges = true;
    }

    private static GraphicsPath CreateRoundedPath(Rectangle rect, int radius) {
        GraphicsPath path = new GraphicsPath();
        int d = radius * 2;
        Rectangle arc = new Rectangle(rect.Location, new Size(d, d));
        path.AddArc(arc, 180, 90);
        arc.X = rect.Right - d;
        path.AddArc(arc, 270, 90);
        arc.Y = rect.Bottom - d;
        path.AddArc(arc, 0, 90);
        arc.X = rect.Left;
        path.AddArc(arc, 90, 90);
        path.CloseFigure();
        return path;
    }

    protected override void OnRenderToolStripBackground(ToolStripRenderEventArgs e) {
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        using (SolidBrush brush = new SolidBrush(Color.FromArgb(28, 28, 30))) {
            e.Graphics.FillRectangle(brush, e.AffectedBounds);
        }
    }

    protected override void OnRenderToolStripBorder(ToolStripRenderEventArgs e) {
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        using (Pen pen = new Pen(Color.FromArgb(52, 52, 56), 1f)) {
            Rectangle bounds = new Rectangle(0, 0, e.ToolStrip.Width - 1, e.ToolStrip.Height - 1);
            e.Graphics.DrawRectangle(pen, bounds);
        }
    }

    protected override void OnRenderMenuItemBackground(ToolStripItemRenderEventArgs e) {
        if (e.Item.Tag != null && e.Item.Tag.ToString() == "header") return;

        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        if (e.Item.Selected || e.Item.Pressed) {
            Rectangle bounds = new Rectangle(6, 2, e.Item.Width - 12, e.Item.Height - 4);
            Color hoverColor = e.Item.Pressed ? Color.FromArgb(58, 59, 66) : Color.FromArgb(46, 47, 52);

            using (GraphicsPath path = CreateRoundedPath(bounds, 5)) {
                using (SolidBrush brush = new SolidBrush(hoverColor)) {
                    e.Graphics.FillPath(brush, path);
                }
            }
        }
    }

    protected override void OnRenderSeparator(ToolStripSeparatorRenderEventArgs e) {
        e.Graphics.SmoothingMode = SmoothingMode.None;
        int y = e.Item.Height / 2;
        using (Pen pen = new Pen(Color.FromArgb(48, 48, 52), 1f)) {
            e.Graphics.DrawLine(pen, 12, y, e.Item.Width - 12, y);
        }
    }

    protected override void OnRenderItemText(ToolStripItemTextRenderEventArgs e) {
        e.Graphics.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;

        if (e.Item.Tag != null && e.Item.Tag.ToString() == "header") {
            int logoSize = 30;
            int logoY = (e.Item.Height - logoSize) / 2;
            e.Graphics.DrawImage(headerLogo, new Rectangle(16, logoY, logoSize, logoSize));
            using (Font titleFont = new Font("Segoe UI", 10f, FontStyle.Bold))
            using (SolidBrush titleBrush = new SolidBrush(Color.FromArgb(243, 244, 246))) {
                e.Graphics.DrawString("BOZ", titleFont, titleBrush, new PointF(56, 10));
            }
            using (Font subFont = new Font("Segoe UI", 8.25f, FontStyle.Regular))
            using (SolidBrush subBrush = new SolidBrush(Color.FromArgb(156, 163, 175))) {
                e.Graphics.DrawString("AI Market Intelligence", subFont, subBrush, new PointF(56, 28));
            }
            return;
        }

        if (e.Item.Tag != null && e.Item.Tag.ToString().StartsWith("toggle:")) {
            bool isChecked = e.Item.Tag.ToString() == "toggle:true";

            int swW = 28;
            int swH = 16;
            int swX = e.Item.Width - swW - 16;
            int swY = (e.Item.Height - swH) / 2;
            Rectangle swRect = new Rectangle(swX, swY, swW, swH);

            using (GraphicsPath swPath = CreateRoundedPath(swRect, 8)) {
                if (isChecked) {
                    using (SolidBrush onBrush = new SolidBrush(Color.FromArgb(34, 197, 94))) {
                        e.Graphics.FillPath(onBrush, swPath);
                    }
                    using (SolidBrush thBrush = new SolidBrush(Color.White)) {
                        e.Graphics.FillEllipse(thBrush, swX + swW - 14, swY + 2, 12, 12);
                    }
                } else {
                    using (SolidBrush offBrush = new SolidBrush(Color.FromArgb(55, 55, 60))) {
                        e.Graphics.FillPath(offBrush, swPath);
                    }
                    using (SolidBrush thBrush = new SolidBrush(Color.FromArgb(170, 170, 175))) {
                        e.Graphics.FillEllipse(thBrush, swX + 2, swY + 2, 12, 12);
                    }
                }
            }

            Color txtColor = e.Item.Selected ? Color.White : Color.FromArgb(236, 236, 237);
            using (SolidBrush txtBrush = new SolidBrush(txtColor)) {
                Rectangle textRect = new Rectangle(16, 0, e.Item.Width - swW - 32, e.Item.Height);
                using (StringFormat format = new StringFormat()) {
                    format.LineAlignment = StringAlignment.Center;
                    format.Alignment = StringAlignment.Near;
                    e.Graphics.DrawString(e.Text, e.Item.Font, txtBrush, textRect, format);
                }
            }
            return;
        }

        Color itemTextColor = e.Item.Selected ? Color.White : Color.FromArgb(236, 236, 237);
        using (SolidBrush textBrush = new SolidBrush(itemTextColor)) {
            Rectangle textRect = new Rectangle(16, 0, e.Item.Width - 32, e.Item.Height);
            using (StringFormat format = new StringFormat()) {
                format.LineAlignment = StringAlignment.Center;
                format.Alignment = StringAlignment.Near;
                e.Graphics.DrawString(e.Text, e.Item.Font, textBrush, textRect, format);
            }
        }
    }
}
'@

[BozNativeMethods]::EnableDpiAwareness()

$url = $env:BOZ_TRAY_URL
$iconPath = $env:BOZ_TRAY_ICON
$startupAvailable = $env:BOZ_TRAY_STARTUP_AVAILABLE -eq '1'
$script:startupEnabled = $env:BOZ_TRAY_STARTUP_ENABLED -eq '1'

function Open-BozDashboard {
  $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $url
  $startInfo.UseShellExecute = $true
  [void][System.Diagnostics.Process]::Start($startInfo)
}

$iconSize = [Math]::Max([BozNativeMethods]::GetSystemMetrics(49), 16)
if ($iconSize -le 0) {
  $iconSize = [Math]::Max([System.Windows.Forms.SystemInformation]::SmallIconSize.Width, 16)
}

$iconBmp = [BozNativeMethods]::CreateCrispTrayIcon($iconPath, $iconSize)
$iconHandle = $iconBmp.GetHicon()
$temporaryIcon = [System.Drawing.Icon]::FromHandle($iconHandle)
$trayIcon = $temporaryIcon.Clone()
$iconBmp.Dispose()
$temporaryIcon.Dispose()
[void][BozNativeMethods]::DestroyIcon($iconHandle)

$menuLogo = [BozNativeMethods]::CreateCrispTrayIcon($iconPath, 30)
$menuWidth = 220
$menu = [System.Windows.Forms.ContextMenuStrip]::new()
$menu.Renderer = [BozMenuRenderer]::new($menuLogo)
$menu.BackColor = [System.Drawing.Color]::FromArgb(28, 28, 30)
$menu.ForeColor = [System.Drawing.Color]::FromArgb(236, 236, 237)
$menu.Padding = [System.Windows.Forms.Padding]::new(4, 4, 4, 4)
$menu.MinimumSize = [System.Drawing.Size]::new($menuWidth, 0)
$menu.ShowImageMargin = $false
$menu.ShowCheckMargin = $false
$menu.Font = [System.Drawing.Font]::new('Segoe UI', 9.5, [System.Drawing.FontStyle]::Regular)
$menu.DropShadowEnabled = $true
$menu.Add_Opened({ [BozNativeMethods]::UseRoundedCorners($menu.Handle) })

$header = [System.Windows.Forms.ToolStripMenuItem]::new('BOZ')
$header.Tag = 'header'
$header.Enabled = $false
$header.AutoSize = $false
$header.Size = [System.Drawing.Size]::new($menuWidth, 52)
[void]$menu.Items.Add($header)
[void]$menu.Items.Add([System.Windows.Forms.ToolStripSeparator]::new())

$openItem = [System.Windows.Forms.ToolStripMenuItem]::new('Open Dashboard')
$openItem.Font = [System.Drawing.Font]::new('Segoe UI', 9.5, [System.Drawing.FontStyle]::Regular)
$openItem.Padding = [System.Windows.Forms.Padding]::new(16, 6, 16, 6)
$openItem.Add_Click({ Open-BozDashboard })
[void]$menu.Items.Add($openItem)

if ($startupAvailable) {
  $startupItem = [System.Windows.Forms.ToolStripMenuItem]::new('Start with Windows')
  $startupItem.Tag = if ($script:startupEnabled) { 'toggle:true' } else { 'toggle:false' }
  $startupItem.Font = [System.Drawing.Font]::new('Segoe UI', 9.5, [System.Drawing.FontStyle]::Regular)
  $startupItem.Padding = [System.Windows.Forms.Padding]::new(16, 6, 16, 6)
  $startupItem.Add_Click({
    $script:startupEnabled = -not $script:startupEnabled
    $startupItem.Tag = if ($script:startupEnabled) { 'toggle:true' } else { 'toggle:false' }
    $menu.Invalidate()
    [Console]::Out.WriteLine('${TOGGLE_STARTUP_MARKER}')
    [Console]::Out.Flush()
  })
  [void]$menu.Items.Add($startupItem)
}

[void]$menu.Items.Add([System.Windows.Forms.ToolStripSeparator]::new())
$exitItem = [System.Windows.Forms.ToolStripMenuItem]::new('Quit BOZ')
$exitItem.Tag = 'danger'
$exitItem.Font = [System.Drawing.Font]::new('Segoe UI', 9.5, [System.Drawing.FontStyle]::Regular)
$exitItem.Padding = [System.Windows.Forms.Padding]::new(16, 6, 16, 6)
$exitItem.Add_Click({
  [Console]::Out.WriteLine('${EXIT_MARKER}')
  [Console]::Out.Flush()
  [System.Windows.Forms.Application]::Exit()
})
[void]$menu.Items.Add($exitItem)

$notifyIcon = [System.Windows.Forms.NotifyIcon]::new()
$notifyIcon.Icon = $trayIcon
$notifyIcon.Text = 'BOZ - Local AI Market Intelligence'
$notifyIcon.ContextMenuStrip = $menu
$notifyIcon.Visible = $true
$notifyIcon.Add_DoubleClick({ Open-BozDashboard })

[System.Windows.Forms.Application]::add_ApplicationExit({
  $notifyIcon.Visible = $false
  $notifyIcon.Dispose()
  $menu.Dispose()
  $menuLogo.Dispose()
  $trayIcon.Dispose()
})

[Console]::Out.WriteLine('${READY_MARKER}')
[Console]::Out.Flush()
[System.Windows.Forms.Application]::Run()
`;


function collectLines(child: { stdout: Readable }, onLine: (line: string) => void): void {
  let pending = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? '';
    for (const line of lines) onLine(line.trim());
  });
}

export function isSystemTrayAvailable(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'win32';
}

export async function startSystemTray(options: SystemTrayOptions): Promise<SystemTrayHandle> {
  if (!isSystemTrayAvailable()) throw new Error('The BOZ system tray is currently available on Windows only.');
  const child = spawn('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-WindowStyle', 'Hidden', '-Command', '-',
  ], {
    windowsHide: true,
    env: {
      ...process.env,
      BOZ_TRAY_URL: options.url,
      BOZ_TRAY_ICON: options.iconPath ?? ORIGINAL_BOZ_LOGO,
      BOZ_TRAY_STARTUP_AVAILABLE: options.startupAvailable ? '1' : '0',
      BOZ_TRAY_STARTUP_ENABLED: options.startupEnabled ? '1' : '0',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdin.end(WINDOWS_TRAY_SCRIPT, 'utf8');

  let stopped = false;
  let ready = false;
  let exitRequested = false;
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-4_000); });

  const readyPromise = new Promise<void>((resolveP, rejectP) => {
    const timeout = setTimeout(() => {
      stopped = true;
      child.kill();
      rejectP(new Error('The Windows system tray did not become ready in time.'));
    }, START_TIMEOUT_MS);
    collectLines(child, (line) => {
      if (line === READY_MARKER && !ready) {
        ready = true;
        clearTimeout(timeout);
        resolveP();
      } else if (line === EXIT_MARKER && !exitRequested) {
        exitRequested = true;
        options.onExit();
      } else if (line === TOGGLE_STARTUP_MARKER) {
        options.onToggleStartup();
      }
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      if (!ready) rejectP(new Error(`Could not start the Windows system tray: ${error.message}`));
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      const detail = stderr.trim() || `PowerShell exited with code ${code ?? 'unknown'}`;
      if (!ready) rejectP(new Error(`Could not start the Windows system tray: ${detail}`));
      else if (!stopped && !exitRequested) options.onUnexpectedExit?.(detail);
    });
  });
  await readyPromise;
  return { stop: () => { if (!stopped && !child.killed) { stopped = true; child.kill(); } } };
}
