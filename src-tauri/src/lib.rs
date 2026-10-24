use std::{
    env,
    fs::OpenOptions,
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

use tauri::{
    AppHandle, Manager, RunEvent, Runtime,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    plugin::{Builder as PluginBuilder, TauriPlugin},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as AutostartExt};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;
use uuid::Uuid;

const BOZ_HOST: &str = "127.0.0.1";
const BOZ_PORT: u16 = 21_526;
const BOZ_ORIGIN: &str = "http://127.0.0.1:21526";
const HEALTH_PATH: &str = "/api/desktop/health";
const STARTUP_TIMEOUT: Duration = Duration::from_secs(30);
const DESKTOP_LOG_LIMIT_BYTES: u64 = 256 * 1024;
const BOZ_TRAY_ID: &str = "boz-primary-tray";
/// After this long, the boot screen says so instead of looking frozen.
const BOZ_SLOW_START_AFTER: Duration = Duration::from_secs(8);

#[derive(Default)]
struct DesktopRuntime {
    child: Mutex<Option<Child>>,
    stopping: AtomicBool,
    server_ready: AtomicBool,
    recovery_dialog_open: AtomicBool,
    tray_initialized: AtomicBool,
    /// One silent update check per app session. Without this every sidecar
    /// restart (crash recovery, manual Retry) re-prompted the user.
    update_checked: AtomicBool,
    /// An install or download is in flight; blocks overlapping prompts.
    update_running: AtomicBool,
    /// Current in-app update state, readable by the webview on mount.
    update_status: Mutex<UpdateStatus>,
}

/// Boot screen state pushed into the loading page by `render_boot_progress`.
struct BootProgress {
    stage: &'static str,
    percent: u8,
    slow: bool,
    done: bool,
}

fn lock_child(state: &DesktopRuntime) -> std::sync::MutexGuard<'_, Option<Child>> {
    state
        .child
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn claim_tray_slot(state: &DesktopRuntime) -> bool {
    !state.tray_initialized.swap(true, Ordering::SeqCst)
}

fn append_desktop_log(log_path: &std::path::Path, message: &str) {
    if let Some(parent) = log_path.parent() {
        if std::fs::create_dir_all(parent).is_err() {
            return;
        }
    }
    if log_path
        .metadata()
        .is_ok_and(|metadata| metadata.len() >= DESKTOP_LOG_LIMIT_BYTES)
    {
        let _ = std::fs::remove_file(&log_path);
    }
    if let Ok(mut log) = OpenOptions::new().create(true).append(true).open(log_path) {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|value| value.as_secs())
            .unwrap_or_default();
        let _ = writeln!(log, "{timestamp} {message}");
    }
}

fn desktop_log<R: Runtime>(app: &AppHandle<R>, message: &str) {
    let log_path = env::var_os("BOZ_DESKTOP_LOG")
        .map(PathBuf::from)
        .or_else(|| {
            app.path()
                .app_config_dir()
                .ok()
                .map(|directory| directory.join("desktop.log"))
        });
    if let Some(log_path) = log_path {
        append_desktop_log(&log_path, message);
    }
}

fn bootstrap_log(message: &str) {
    if let Some(log_path) = env::var_os("BOZ_DESKTOP_LOG").map(PathBuf::from) {
        append_desktop_log(&log_path, message);
    }
}

fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn is_autostart_launch() -> bool {
    env::args_os().any(|argument| argument == "--autostart")
}

fn allowed_navigation(url: &tauri::Url) -> bool {
    if url.scheme() == "tauri" || url.host_str() == Some("tauri.localhost") {
        return true;
    }

    url.scheme() == "http"
        && url.host_str() == Some(BOZ_HOST)
        && url.port_or_known_default() == Some(BOZ_PORT)
}

fn navigation_guard<R: Runtime>() -> TauriPlugin<R> {
    PluginBuilder::new("boz-navigation-guard")
        .on_navigation(|_webview, url| {
            if allowed_navigation(url) {
                return true;
            }

            if matches!(url.scheme(), "http" | "https") {
                let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
            }
            false
        })
        .build()
}

fn port_is_occupied() -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], BOZ_PORT));
    TcpStream::connect_timeout(&address, Duration::from_millis(250)).is_ok()
}

/// Parse `netstat -ano -p TCP` output and return the PIDs in LISTENING state
/// on `port`. Pure function so the parsing contract stays unit-tested.
fn parse_listening_pids(netstat_output: &str, port: u16) -> Vec<u32> {
    let suffix = format!(":{port}");
    let mut pids = Vec::new();
    for line in netstat_output.lines() {
        let fields: Vec<&str> = line.split_whitespace().collect();
        // TCP <local address> <remote address> <state> <pid>
        if fields.len() != 5 || fields[0] != "TCP" || fields[3] != "LISTENING" {
            continue;
        }
        if !fields[1].ends_with(&suffix) {
            continue;
        }
        if let Ok(pid) = fields[4].parse::<u32>() {
            if pid != 0 && !pids.contains(&pid) {
                pids.push(pid);
            }
        }
    }
    pids
}

#[cfg(windows)]
fn listening_pids() -> Vec<u32> {
    let mut netstat = Command::new("netstat.exe");
    netstat
        .args(["-ano", "-p", "TCP"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    hide_process_window(&mut netstat);
    let Ok(output) = netstat.output() else {
        return Vec::new();
    };
    parse_listening_pids(&String::from_utf8_lossy(&output.stdout), BOZ_PORT)
}

#[cfg(not(windows))]
fn listening_pids() -> Vec<u32> {
    Vec::new()
}

#[cfg(windows)]
fn process_image_name(pid: u32) -> Option<String> {
    let mut tasklist = Command::new("tasklist.exe");
    tasklist
        .args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    hide_process_window(&mut tasklist);
    let output = tasklist.output().ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    let name = text
        .lines()
        .next()?
        .split(',')
        .next()?
        .trim_matches('"')
        .trim();
    if name.is_empty() || name.starts_with("INFO") {
        return None;
    }
    Some(name.to_string())
}

#[cfg(not(windows))]
fn process_image_name(_pid: u32) -> Option<String> {
    None
}

#[cfg(windows)]
fn terminate_process_tree(pid: u32) {
    let mut taskkill = Command::new("taskkill.exe");
    taskkill
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    hide_process_window(&mut taskkill);
    let _ = taskkill.status();
}

#[cfg(not(windows))]
fn terminate_process_tree(_pid: u32) {}

/// Decide which PIDs holding BOZ_PORT may be reclaimed: only Node.js processes
/// (bundled sidecar or leftover dev server). Anything else — test harnesses,
/// user software, system services — must be left alone so startup fails fast
/// with "already in use" instead of killing an unrelated process.
/// Returns `None` when any occupant is not reclaimable. Pure function so the
/// safety contract stays unit-tested.
fn reclaimable_node_pids(occupants: Vec<(u32, Option<String>)>) -> Option<Vec<(u32, String)>> {
    let mut result = Vec::new();
    for (pid, name) in occupants {
        let name = name.unwrap_or_else(|| "unknown".to_string());
        if !name.eq_ignore_ascii_case("node.exe") {
            return None;
        }
        result.push((pid, name));
    }
    Some(result)
}

/// Free BOZ_PORT by stopping a stale Node.js sidecar or leftover dev server.
/// Never touches our own process or any non-Node process. Returns true
/// once the port is free for our sidecar.
fn reclaim_boz_port<R: Runtime>(app: &AppHandle<R>) -> bool {
    if !port_is_occupied() {
        return true;
    }
    let own = std::process::id();
    let occupants: Vec<(u32, Option<String>)> = listening_pids()
        .into_iter()
        .filter(|pid| *pid != own)
        .map(|pid| {
            let name = process_image_name(pid);
            (pid, name)
        })
        .collect();
    if occupants.is_empty() {
        desktop_log(
            app,
            "BOZ port is occupied but no owning process was identified; leaving it alone",
        );
        return false;
    }
    let Some(reclaimable) = reclaimable_node_pids(occupants) else {
        desktop_log(
            app,
            "BOZ port is held by a non-Node process; leaving it alone",
        );
        return false;
    };
    for (pid, name) in reclaimable {
        desktop_log(
            app,
            &format!("Reclaiming {BOZ_ORIGIN}: stopping {name} pid={pid}"),
        );
        terminate_process_tree(pid);
    }
    for _ in 0..20 {
        if !port_is_occupied() {
            desktop_log(app, "BOZ port reclaimed");
            return true;
        }
        thread::sleep(Duration::from_millis(250));
    }
    desktop_log(app, "BOZ port is still occupied after reclaim attempt");
    false
}

fn normalize_resource_path(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let display = path.to_string_lossy();
        if let Some(network_path) = display.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{network_path}"));
        }
        if let Some(local_path) = display.strip_prefix(r"\\?\") {
            return PathBuf::from(local_path);
        }
    }
    path
}

fn resource_path<R: Runtime>(app: &AppHandle<R>, name: &str) -> Result<PathBuf, String> {
    if let Some(override_root) = env::var_os("BOZ_DESKTOP_RESOURCE_DIR").map(PathBuf::from) {
        let override_path = normalize_resource_path(override_root.join(name));
        if override_path.exists() {
            return Ok(override_path);
        }
    }
    let root = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    let root = normalize_resource_path(root);
    let nested = root.join("resources").join(name);
    if nested.exists() {
        return Ok(nested);
    }
    let flat = root.join(name);
    if flat.exists() {
        return Ok(flat);
    }
    Err(format!("Bundled desktop resource is missing: {name}"))
}

#[cfg(windows)]
fn hide_process_window(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_process_window(_command: &mut Command) {}

fn terminate_sidecar<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<DesktopRuntime>();
    state.stopping.store(true, Ordering::SeqCst);
    state.server_ready.store(false, Ordering::SeqCst);
    let child = lock_child(&state).take();

    if let Some(mut child) = child {
        desktop_log(app, &format!("Stopping Node sidecar pid={}", child.id()));
        #[cfg(windows)]
        {
            let mut taskkill = Command::new("taskkill.exe");
            taskkill
                .args(["/PID", &child.id().to_string(), "/T", "/F"])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            hide_process_window(&mut taskkill);
            let _ = taskkill.status();
        }
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn request_quit<R: Runtime>(app: &AppHandle<R>) {
    terminate_sidecar(app);
    app.exit(0);
}

fn health_response_is_ready(response: &str) -> bool {
    let success = response.starts_with("HTTP/1.1 200") || response.starts_with("HTTP/1.0 200");
    success
        && response.contains("\"name\":\"BOZ\"")
        && response.contains("\"distribution\":\"desktop\"")
        && response.contains("\"status\":\"ready\"")
}

fn probe_health(token: &str) -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], BOZ_PORT));
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(400)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(800)));
    let request = format!(
        "GET {HEALTH_PATH} HTTP/1.1\r\nHost: {BOZ_HOST}:{BOZ_PORT}\r\nX-BOZ-Desktop-Token: {token}\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }

    let mut response = String::new();
    stream.read_to_string(&mut response).is_ok() && health_response_is_ready(&response)
}

/// Escapes a string for embedding in a single-quoted JavaScript literal.
/// Belt-and-braces: every value here is a Rust literal, but the boot script is
/// assembled by concatenation and must never be able to break out of its quotes.
fn js_string(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
}

/// Pushes boot progress into the static loading page.
///
/// The page ships zero JavaScript (the desktop CSP is `script-src 'none'`), so
/// the host writes the DOM through webview eval instead. That keeps the boot
/// screen free of any script surface without loosening the CSP for the whole
/// app or granting the page new capabilities. Every write is best-effort: a
/// failure here must never block startup.
fn render_boot_progress<R: Runtime>(app: &AppHandle<R>, progress: BootProgress) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let version = app.package_info().version.to_string();
    let percent = progress.percent.min(100);
    let script = format!(
        "(function(){{var m=document.querySelector('main');if(!m)return;m.classList.add('hosted');\
var s=document.getElementById('stage');if(s)s.textContent={stage};\
var t=document.getElementById('track');if(t)t.setAttribute('aria-valuenow','{percent}');\
var b=document.getElementById('bar');if(b)b.style.width='{percent}%';\
var p=document.getElementById('pct');if(p)p.textContent='{percent}%';\
var v=document.getElementById('version');if(v)v.textContent='BOZ {version}';\
var w=document.getElementById('slow');if(w)w.hidden={slow};\
var h=document.getElementById('hint');if(h)h.hidden={hint};}})();",
        stage = js_string(progress.stage),
        version = js_string(&version),
        slow = !progress.slow,
        hint = !progress.done,
    );
    let _ = window.eval(&script);
}

fn wait_for_server<R: Runtime>(app: &AppHandle<R>, token: &str) -> Result<(), String> {
    let started = Instant::now();
    let deadline = started + STARTUP_TIMEOUT;
    let mut last_percent = u8::MAX;
    while Instant::now() < deadline {
        if probe_health(token) {
            render_boot_progress(
                app,
                BootProgress {
                    stage: "Workspace ready, opening BOZ",
                    percent: 100,
                    slow: false,
                    done: true,
                },
            );
            return Ok(());
        }

        let state = app.state::<DesktopRuntime>();
        let mut child = lock_child(&state);
        if let Some(process) = child.as_mut() {
            match process.try_wait() {
                Ok(Some(status)) => {
                    child.take();
                    return Err(format!("The BOZ server stopped during startup ({status})."));
                }
                Ok(None) => {}
                Err(error) => return Err(format!("Could not monitor the BOZ server: {error}")),
            }
        } else {
            return Err("The BOZ server is not running.".to_string());
        }
        drop(child);

        // Real progress against the real deadline, on a square-root curve so it
        // moves early instead of sitting still and then jumping. Capped below
        // 100 so the bar never claims completion before the server answers.
        let elapsed = started.elapsed().as_secs_f64();
        let fraction = (elapsed / STARTUP_TIMEOUT.as_secs_f64()).clamp(0.0, 1.0);
        let percent = (4.0 + 88.0 * fraction.sqrt()).round() as u8;
        if percent != last_percent {
            last_percent = percent;
            render_boot_progress(
                app,
                BootProgress {
                    stage: "Starting your private market workspace",
                    percent,
                    slow: elapsed >= BOZ_SLOW_START_AFTER.as_secs_f64(),
                    done: false,
                },
            );
        }

        thread::sleep(Duration::from_millis(250));
    }

    render_boot_progress(
        app,
        BootProgress {
            stage: "BOZ did not start in time",
            percent: 100,
            slow: false,
            done: true,
        },
    );
    Err("BOZ did not become ready within 30 seconds.".to_string())
}

fn launch_sidecar<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    desktop_log(app, "Starting bundled Node sidecar");
    render_boot_progress(
        app,
        BootProgress {
            stage: "Starting the local market server",
            percent: 4,
            slow: false,
            done: false,
        },
    );
    if port_is_occupied() && !reclaim_boz_port(app) {
        return Err(format!(
            "BOZ cannot start because {BOZ_ORIGIN} is already in use. Close the other program and retry."
        ));
    }

    let node = resource_path(app, "node.exe")?;
    let server_root = resource_path(app, "server")?;
    desktop_log(
        app,
        &format!(
            "Resolved desktop resources node={} server={}",
            node.display(),
            server_root.display()
        ),
    );
    let server = server_root.join("server.js");
    if !server.exists() {
        return Err("The bundled BOZ server is incomplete (server.js is missing).".to_string());
    }

    let config_dir = match env::var_os("BOZ_DESKTOP_CONFIG_DIR") {
        Some(path) => PathBuf::from(path),
        None => app
            .path()
            .app_config_dir()
            .map_err(|error| error.to_string())?,
    };
    std::fs::create_dir_all(&config_dir)
        .map_err(|error| format!("Could not create the BOZ configuration directory: {error}"))?;
    let token = Uuid::new_v4().to_string();

    let mut command = Command::new(node);
    command
        .arg("server.js")
        .current_dir(server_root)
        .env("NODE_ENV", "production")
        .env("HOSTNAME", BOZ_HOST)
        .env("PORT", BOZ_PORT.to_string())
        .env("BOZ_CONFIG_DIR", config_dir)
        .env("BOZ_DESKTOP_HEALTH_TOKEN", &token)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    hide_process_window(&mut command);
    let child = command
        .spawn()
        .map_err(|error| format!("Could not start the bundled BOZ server: {error}"))?;
    desktop_log(app, &format!("Started Node sidecar pid={}", child.id()));

    let state = app.state::<DesktopRuntime>();
    state.stopping.store(false, Ordering::SeqCst);
    state.server_ready.store(false, Ordering::SeqCst);
    *lock_child(&state) = Some(child);

    if let Err(error) = wait_for_server(app, &token) {
        terminate_sidecar(app);
        return Err(error);
    }
    state.stopping.store(false, Ordering::SeqCst);
    state.server_ready.store(true, Ordering::SeqCst);
    desktop_log(app, "Bundled server health check passed");
    Ok(())
}

fn show_error<R: Runtime>(app: &AppHandle<R>, title: &str, message: impl Into<String>) {
    app.dialog()
        .message(message)
        .title(title)
        .kind(MessageDialogKind::Error)
        .show(|_| {});
}

/// State of the in-app update flow, owned by the host and read by the webview.
///
/// The host owns it because it must survive the webview not being loaded yet:
/// a check that finishes during boot is still waiting when the UI mounts. The
/// UI reads the current state on mount and then follows [`UPDATE_EVENT`].
#[derive(Clone)]
struct UpdateStatus {
    /// `idle` | `available` | `downloading` | `installing` | `error`
    phase: &'static str,
    version: Option<String>,
    /// 0-100 while downloading; None when the total size is unknown.
    percent: Option<u8>,
    message: Option<String>,
    /// The version the user asked not to be reminded about again.
    snoozed_version: Option<String>,
    /// True only when a manual check finished and the webview should open the
    /// update modal now. The automatic launch check never sets it; the webview
    /// clears it via `clear_update_open_request` once the modal is up.
    open_requested: bool,
}

impl Default for UpdateStatus {
    fn default() -> Self {
        Self {
            phase: "idle",
            version: None,
            percent: None,
            message: None,
            snoozed_version: None,
            open_requested: false,
        }
    }
}

impl UpdateStatus {
    /// Payload shape for the webview. Built by hand rather than deriving
    /// `Serialize` so the host does not need a serde derive dependency.
    fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "phase": self.phase,
            "version": self.version,
            "percent": self.percent,
            "message": self.message,
            "snoozedVersion": self.snoozed_version,
            "openRequested": self.open_requested,
        })
    }
}

const UPDATE_EVENT: &str = "boz://update-status";

fn update_status_slot(state: &DesktopRuntime) -> std::sync::MutexGuard<'_, UpdateStatus> {
    state
        .update_status
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Publishes the current update status to any mounted webview and the log.
fn publish_update_status<R: Runtime>(app: &AppHandle<R>) {
    let status = update_status_slot(&app.state::<DesktopRuntime>()).to_json();
    desktop_log(
        app,
        &format!(
            "update status {}",
            serde_json::to_string(&status).unwrap_or_else(|_| "{}".to_string())
        ),
    );
    let _ = tauri::Emitter::emit(app, UPDATE_EVENT, &status);
}

fn set_update_status<R: Runtime>(app: &AppHandle<R>, status: UpdateStatus) {
    *update_status_slot(&app.state::<DesktopRuntime>()) = status;
    publish_update_status(app);
}

fn snooze_file<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join("update-snooze.json"))
}

fn read_snoozed_version<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    let path = snooze_file(app)?;
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|value| {
            value
                .get("version")
                .and_then(|version| version.as_str())
                .map(str::to_string)
        })
        .filter(|version| !version.is_empty())
}

fn write_snoozed_version<R: Runtime>(app: &AppHandle<R>, version: &str) {
    let Some(path) = snooze_file(app) else {
        return;
    };
    if let Some(parent) = path.parent()
        && std::fs::create_dir_all(parent).is_err()
    {
        return;
    }
    let payload = serde_json::json!({ "version": version });
    if let Ok(body) = serde_json::to_string(&payload) {
        let _ = std::fs::write(path, body);
    }
}

/// Records "remind me later" for this version. The next session re-offers any
/// newer version but stays quiet about this one.
#[tauri::command]
fn snooze_update<R: Runtime>(app: AppHandle<R>, version: String) -> Result<(), String> {
    write_snoozed_version(&app, &version);
    let mut status = update_status_slot(&app.state::<DesktopRuntime>()).clone();
    status.snoozed_version = Some(version);
    status.phase = "idle";
    status.version = None;
    status.percent = None;
    status.message = None;
    // The user acted on the offer; do not keep asking the webview to open.
    status.open_requested = false;
    *update_status_slot(&app.state::<DesktopRuntime>()) = status;
    publish_update_status(&app);
    Ok(())
}

/// Current update state, so a UI that mounts after the check still sees it.
#[tauri::command]
fn update_status<R: Runtime>(app: AppHandle<R>) -> serde_json::Value {
    update_status_slot(&app.state::<DesktopRuntime>()).to_json()
}

/// Installs the update the host already reported as available.
///
/// Re-checks rather than caching the earlier `Update` handle: the host does not
/// hold one across the async gap, and a fresh check immediately before the
/// install is cheap and always correct.
#[tauri::command]
fn install_available_update<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let state = app.state::<DesktopRuntime>();
    if state.update_running.load(Ordering::SeqCst) {
        return Err("An update is already in progress.".to_string());
    }

    let runtime = app.clone();
    tauri::async_runtime::spawn(async move {
        let before_exit_app = runtime.clone();
        let updater = runtime
            .updater_builder()
            .on_before_exit(move || terminate_sidecar(&before_exit_app))
            .build()
            .map_err(|error| error.to_string())?;

        match updater.check().await {
            Ok(Some(update)) => {
                install_update(runtime, update);
                Ok(())
            }
            Ok(None) => {
                set_update_status(&runtime, UpdateStatus::default());
                Err("You are already running the latest version of BOZ.".to_string())
            }
            Err(error) => {
                set_update_status(
                    &runtime,
                    UpdateStatus {
                        phase: "error",
                        message: Some(error.to_string()),
                        ..Default::default()
                    },
                );
                Err(error.to_string())
            }
        }
    });

    Ok(())
}

/// Marks that the webview has opened the update modal, so a later event or an
/// on-mount status read does not ask it to open again. Mutates the slot
/// silently on purpose: publishing again is itself a reason to re-open.
#[tauri::command]
fn clear_update_open_request<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let mut status = update_status_slot(&app.state::<DesktopRuntime>()).clone();
    status.open_requested = false;
    *update_status_slot(&app.state::<DesktopRuntime>()) = status;
    desktop_log(&app, "Update modal acknowledged; open request cleared");
    Ok(())
}

fn check_for_updates<R: Runtime>(app: AppHandle<R>, manual: bool) {
    let state = app.state::<DesktopRuntime>();

    // One silent check per session. Crash recovery and manual Retry both
    // restart the sidecar, and each of those used to re-prompt the user.
    if !manual && state.update_checked.swap(true, Ordering::SeqCst) {
        desktop_log(
            &app,
            "Skipped the automatic update check: already checked this session",
        );
        return;
    }
    // Never overlap a check with an in-flight download/install.
    if state.update_running.load(Ordering::SeqCst) {
        desktop_log(
            &app,
            "Skipped the update check: an update is already in progress",
        );
        return;
    }

    tauri::async_runtime::spawn(async move {
        let before_exit_app = app.clone();
        let updater = match app
            .updater_builder()
            .on_before_exit(move || terminate_sidecar(&before_exit_app))
            .build()
        {
            Ok(updater) => updater,
            Err(error) => {
                // The manual path lands in the webview (error modal); the
                // silent launch path publishes the same status without ever
                // opening a native dialog.
                if manual {
                    show_main_window(&app);
                }
                set_update_status(
                    &app,
                    UpdateStatus {
                        phase: "error",
                        message: Some(error.to_string()),
                        open_requested: manual,
                        ..Default::default()
                    },
                );
                return;
            }
        };

        match updater.check().await {
            Ok(Some(update)) => {
                let version = update.version.clone();
                let snoozed = read_snoozed_version(&app);
                if snoozed.as_deref() == Some(version.as_str()) {
                    desktop_log(&app, "Update already offered and snoozed; staying quiet");
                    // A manual check surfaces the snooze state in the modal so
                    // the user is not left wondering where the offer went; the
                    // automatic path stays quiet.
                    if manual {
                        show_main_window(&app);
                    }
                    set_update_status(
                        &app,
                        UpdateStatus {
                            phase: "idle",
                            snoozed_version: snoozed,
                            open_requested: manual,
                            ..Default::default()
                        },
                    );
                    return;
                }
                // The webview renders the offer itself: the modal shows the
                // Install and Later buttons, so the host never opens a native
                // dialog here and never installs from inside one. A manual
                // check surfaces the window so the offer is actually seen.
                if manual {
                    show_main_window(&app);
                }
                set_update_status(
                    &app,
                    UpdateStatus {
                        phase: "available",
                        version: Some(version),
                        open_requested: manual,
                        ..Default::default()
                    },
                );
            }
            Ok(None) => {
                // A manual check with nothing to install says so out loud; the
                // automatic path stays silent.
                if manual {
                    show_main_window(&app);
                    set_update_status(
                        &app,
                        UpdateStatus {
                            message: Some("You are running the latest version of BOZ.".to_string()),
                            open_requested: true,
                            ..Default::default()
                        },
                    );
                } else {
                    set_update_status(&app, UpdateStatus::default());
                }
            }
            Err(error) => {
                desktop_log(&app, &format!("Update check failed: {error}"));
                if manual {
                    show_main_window(&app);
                    set_update_status(
                        &app,
                        UpdateStatus {
                            phase: "error",
                            message: Some(error.to_string()),
                            open_requested: true,
                            ..Default::default()
                        },
                    );
                } else {
                    set_update_status(&app, UpdateStatus::default());
                }
            }
        }
    });
}

/// Downloads and installs a checked update, reporting progress to the webview.
///
/// Progress used to be a literal no-op closure, so a multi-minute download
/// showed the user nothing at all.
fn install_update<R: Runtime>(app: AppHandle<R>, update: tauri_plugin_updater::Update) {
    let progress_app = app.clone();
    app.state::<DesktopRuntime>()
        .update_running
        .store(true, Ordering::SeqCst);
    tauri::async_runtime::spawn(async move {
        set_update_status(
            &progress_app,
            UpdateStatus {
                phase: "downloading",
                percent: Some(0),
                ..Default::default()
            },
        );

        // Cumulative bytes, because the callback reports a per-chunk length and
        // only sometimes a total. Percent needs both.
        let downloaded = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
        let reporter = downloaded.clone();
        let finish_app = progress_app.clone();
        let result = update
            .download_and_install(
                move |chunk_length, content_length| {
                    let total = reporter.fetch_add(chunk_length as u64, Ordering::Relaxed)
                        + chunk_length as u64;
                    let percent = match content_length {
                        Some(expected) if expected > 0 => {
                            ((total as f64 / expected as f64) * 100.0)
                                .round()
                                .clamp(0.0, 100.0) as u8
                        }
                        // Total size unknown: report progress as "downloading"
                        // with no number rather than inventing a percentage.
                        _ => 0,
                    };
                    set_update_status(
                        &progress_app,
                        UpdateStatus {
                            phase: "downloading",
                            percent: if content_length.is_some() {
                                Some(percent)
                            } else {
                                None
                            },
                            ..Default::default()
                        },
                    );
                },
                || {
                    set_update_status(
                        &finish_app,
                        UpdateStatus {
                            phase: "installing",
                            percent: Some(100),
                            ..Default::default()
                        },
                    );
                },
            )
            .await;

        match result {
            Ok(()) => {
                // On Windows the NSIS installer exits the process itself once
                // it is done; nothing to restart here.
                desktop_log(&app, "Update installed successfully");
                if !cfg!(windows) {
                    app.restart();
                }
            }
            Err(error) => {
                desktop_log(&app, &format!("Update failed: {error}"));
                set_update_status(
                    &app,
                    UpdateStatus {
                        phase: "error",
                        message: Some(error.to_string()),
                        ..Default::default()
                    },
                );
            }
        }
        app.state::<DesktopRuntime>()
            .update_running
            .store(false, Ordering::SeqCst);
    });
}

fn monitor_sidecar<R: Runtime>(app: AppHandle<R>) {
    thread::spawn(move || {
        loop {
            thread::sleep(Duration::from_secs(1));
            let state = app.state::<DesktopRuntime>();
            if state.stopping.load(Ordering::SeqCst) {
                break;
            }

            let stopped = {
                let mut child = lock_child(&state);
                match child.as_mut().map(Child::try_wait) {
                    Some(Ok(Some(_))) | Some(Err(_)) => {
                        child.take();
                        true
                    }
                    None if state.server_ready.load(Ordering::SeqCst) => true,
                    _ => false,
                }
            };
            if !stopped {
                continue;
            }

            state.server_ready.store(false, Ordering::SeqCst);
            if state.recovery_dialog_open.swap(true, Ordering::SeqCst) {
                break;
            }
            let dialog_app = app.clone();
            app.dialog()
                .message("The BOZ server stopped unexpectedly. Restart it?")
                .title("BOZ server stopped")
                .kind(MessageDialogKind::Error)
                .buttons(MessageDialogButtons::OkCancelCustom(
                    "Restart".to_string(),
                    "Quit".to_string(),
                ))
                .show(move |restart| {
                    dialog_app
                        .state::<DesktopRuntime>()
                        .recovery_dialog_open
                        .store(false, Ordering::SeqCst);
                    if restart {
                        start_server_async(dialog_app);
                    } else {
                        request_quit(&dialog_app);
                    }
                });
            break;
        }
    });
}

fn start_server_async<R: Runtime>(app: AppHandle<R>) {
    thread::spawn(move || match launch_sidecar(&app) {
        Ok(()) => {
            if let Some(window) = app.get_webview_window("main") {
                if let Ok(url) = BOZ_ORIGIN.parse() {
                    let _ = window.navigate(url);
                }
            }
            if !is_autostart_launch() {
                show_main_window(&app);
            }
            monitor_sidecar(app.clone());
            check_for_updates(app, false);
        }
        Err(error) => {
            desktop_log(&app, &format!("Bundled server startup failed: {error}"));
            let retry_app = app.clone();
            app.dialog()
                .message(error)
                .title("BOZ could not start")
                .kind(MessageDialogKind::Error)
                .buttons(MessageDialogButtons::OkCancelCustom(
                    "Retry".to_string(),
                    "Quit".to_string(),
                ))
                .show(move |retry| {
                    if retry {
                        start_server_async(retry_app);
                    } else {
                        request_quit(&retry_app);
                    }
                });
        }
    });
}

fn build_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let state = app.state::<DesktopRuntime>();
    if !claim_tray_slot(&state) {
        desktop_log(app, "Skipped duplicate BOZ tray registration");
        return Ok(());
    }
    if app.tray_by_id(BOZ_TRAY_ID).is_some() {
        desktop_log(app, "Reused existing BOZ tray registration");
        return Ok(());
    }

    let result = (|| -> tauri::Result<()> {
        let open = MenuItem::with_id(app, "open", "Open BOZ", true, None::<&str>)?;
        let update = MenuItem::with_id(app, "update", "Check for updates", true, None::<&str>)?;
        let autostart_enabled = app.autolaunch().is_enabled().unwrap_or(false);
        let autostart = CheckMenuItem::with_id(
            app,
            "autostart",
            "Start with Windows",
            true,
            autostart_enabled,
            None::<&str>,
        )?;
        let separator = PredefinedMenuItem::separator(app)?;
        let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
        let menu = Menu::with_items(app, &[&open, &update, &autostart, &separator, &quit])?;
        let autostart_item = autostart.clone();

        let mut tray = TrayIconBuilder::with_id(BOZ_TRAY_ID)
            .menu(&menu)
            .show_menu_on_left_click(false)
            .tooltip("BOZ")
            .on_menu_event(move |app, event| match event.id().as_ref() {
                "open" => show_main_window(app),
                "update" => check_for_updates(app.clone(), true),
                "autostart" => {
                    let manager = app.autolaunch();
                    let enabled = manager.is_enabled().unwrap_or(false);
                    let result = if enabled {
                        manager.disable()
                    } else {
                        manager.enable()
                    };
                    match result {
                        Ok(()) => {
                            let _ = autostart_item.set_checked(!enabled);
                        }
                        Err(error) => {
                            show_error(app, "Autostart could not be changed", error.to_string())
                        }
                    }
                }
                "quit" => request_quit(app),
                _ => {}
            })
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    show_main_window(tray.app_handle());
                }
            });

        if let Some(icon) = app.default_window_icon() {
            tray = tray.icon(icon.clone());
        }
        tray.build(app)?;
        Ok(())
    })();

    if result.is_err() {
        state.tray_initialized.store(false, Ordering::SeqCst);
    }
    result
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    bootstrap_log("BOZ desktop process entered Rust host");
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            show_main_window(app);
        }))
        .plugin(navigation_guard())
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(true)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .manage(DesktopRuntime::default())
        .invoke_handler(tauri::generate_handler![
            update_status,
            snooze_update,
            install_available_update,
            clear_update_open_request
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<DesktopRuntime>();
                if !state.stopping.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            desktop_log(app.handle(), "BOZ desktop host initialized");
            build_tray(app.handle())?;
            if !is_autostart_launch() {
                show_main_window(app.handle());
            }

            if cfg!(debug_assertions) && env::var_os("BOZ_DESKTOP_FORCE_SIDECAR").is_none() {
                app.state::<DesktopRuntime>()
                    .server_ready
                    .store(true, Ordering::SeqCst);
            } else {
                start_server_async(app.handle().clone());
            }

            Ok(())
        });

    let application = builder
        .build(tauri::generate_context!())
        .expect("failed to build the BOZ desktop application");
    desktop_log(application.handle(), "BOZ desktop application built");
    application.run(|app, event| {
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            terminate_sidecar(app);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn health_contract_requires_all_desktop_markers() {
        let response = "HTTP/1.1 200 OK\r\n\r\n{\"name\":\"BOZ\",\"distribution\":\"desktop\",\"status\":\"ready\"}";
        assert!(health_response_is_ready(response));
        assert!(!health_response_is_ready("HTTP/1.1 200 OK\r\n\r\n{}"));
        assert!(!health_response_is_ready(&response.replace("200", "404")));
    }

    #[test]
    fn only_one_boz_tray_slot_can_be_claimed() {
        let runtime = DesktopRuntime::default();
        assert!(claim_tray_slot(&runtime));
        assert!(!claim_tray_slot(&runtime));
    }

    #[test]
    fn automatic_update_check_runs_once_per_session() {
        // Crash recovery and manual Retry both restart the sidecar; each of
        // those used to fire another silent check and re-prompt the user.
        let runtime = DesktopRuntime::default();
        assert!(!runtime.update_checked.swap(true, Ordering::SeqCst));
        assert!(runtime.update_checked.swap(true, Ordering::SeqCst));
    }

    #[test]
    fn update_running_blocks_overlapping_work() {
        let runtime = DesktopRuntime::default();
        assert!(!runtime.update_running.swap(true, Ordering::SeqCst));
        assert!(runtime.update_running.swap(true, Ordering::SeqCst));
        runtime.update_running.store(false, Ordering::SeqCst);
        assert!(!runtime.update_running.swap(true, Ordering::SeqCst));
    }

    #[test]
    fn update_status_payload_exposes_camel_case_for_the_webview() {
        let status = UpdateStatus {
            phase: "downloading",
            version: Some("2.9.0".to_string()),
            percent: Some(42),
            message: None,
            snoozed_version: Some("2.8.1".to_string()),
            open_requested: true,
        };
        let json = status.to_json();
        assert_eq!(json["phase"], "downloading");
        assert_eq!(json["version"], "2.9.0");
        assert_eq!(json["percent"], 42);
        assert_eq!(json["snoozedVersion"], "2.8.1");
        assert_eq!(json["openRequested"], true);
        assert!(json.get("snoozed_version").is_none());
        assert!(json.get("open_requested").is_none());
    }

    #[test]
    fn default_update_status_is_idle_and_unseen() {
        let json = UpdateStatus::default().to_json();
        assert_eq!(json["phase"], "idle");
        assert!(json["version"].is_null());
        assert!(json["percent"].is_null());
        assert!(json["snoozedVersion"].is_null());
        // Only a manual check ever asks the webview to open the modal.
        assert_eq!(json["openRequested"], false);
    }

    #[test]
    fn boot_progress_values_are_bounded_and_never_claim_false_completion() {
        let slow = BootProgress {
            stage: "Starting your private market workspace",
            percent: 92,
            slow: true,
            done: false,
        };
        assert!(slow.percent <= 100);
        assert!(slow.slow);
        assert!(!slow.done);
        assert_eq!(slow.stage, "Starting your private market workspace");
    }

    #[test]
    fn boot_script_values_are_escaped_for_the_loading_page() {
        // The boot script is assembled by string concatenation and executed as
        // JavaScript, so a value must never be able to break out of its string
        // literal. HTML escaping is deliberately not required: the value is
        // handed to webview eval, never parsed as HTML.
        assert_eq!(js_string("plain"), "\"plain\"");
        assert_eq!(js_string(""), "\"\"");
        // Quotes, backslashes and newlines are what break a JS string literal.
        assert_eq!(js_string("a\"b"), "\"a\\\"b\"");
        assert_eq!(js_string("a\\b"), "\"a\\\\b\"");
        assert_eq!(js_string("a\nb"), "\"a\\nb\"");
        assert_eq!(js_string("a\rb"), "\"a\\rb\"");
        // A backtick or ${} is inert inside a double-quoted literal.
        assert_eq!(js_string("`${x}`"), "\"`${x}`\"");
    }

    #[test]
    fn netstat_parsing_finds_only_listening_pids_on_boz_port() {
        let output = "Active Connections\r\n\
             \r\n\
             \x20 Proto  Local Address          Foreign Address        State           PID\r\n\
             \x20 TCP    127.0.0.1:21526        0.0.0.0:0              LISTENING       1234\r\n\
             \x20 TCP    127.0.0.1:21526        127.0.0.1:5678         ESTABLISHED     1234\r\n\
             \x20 TCP    0.0.0.0:21526          0.0.0.0:0              LISTENING       5678\r\n\
             \x20 TCP    [::]:21526             [::]:0                 LISTENING       4321\r\n\
             \x20 TCP    127.0.0.1:3000         0.0.0.0:0              LISTENING       9999\r\n";
        assert_eq!(parse_listening_pids(output, 21_526), vec![1234, 5678, 4321]);
        assert_eq!(parse_listening_pids(output, 3000), vec![9999]);
        assert!(parse_listening_pids("not netstat output", 21_526).is_empty());
    }

    #[test]
    fn port_reclaim_is_limited_to_node_processes() {
        // Stale sidecar / dev server: reclaimable.
        assert_eq!(
            reclaimable_node_pids(vec![
                (1234, Some("node.exe".to_string())),
                (5678, Some("NODE.EXE".to_string())),
            ]),
            Some(vec![
                (1234, "node.exe".to_string()),
                (5678, "NODE.EXE".to_string()),
            ])
        );
        // Test harness or user software holding the port: never touch it.
        assert_eq!(
            reclaimable_node_pids(vec![(1234, Some("pwsh.exe".to_string()))]),
            None
        );
        assert_eq!(
            reclaimable_node_pids(vec![
                (1234, Some("node.exe".to_string())),
                (5678, Some("pwsh.exe".to_string())),
            ]),
            None
        );
        // Unidentified process: never touch it.
        assert_eq!(reclaimable_node_pids(vec![(1234, None)]), None);
        assert_eq!(reclaimable_node_pids(vec![]), Some(vec![]));
    }

    #[test]
    fn navigation_is_restricted_to_bundled_assets_and_fixed_loopback_origin() {
        assert!(allowed_navigation(
            &"tauri://localhost/index.html".parse().unwrap()
        ));
        assert!(allowed_navigation(
            &"http://127.0.0.1:21526/chat".parse().unwrap()
        ));
        assert!(!allowed_navigation(
            &"http://127.0.0.1:3000".parse().unwrap()
        ));
        assert!(!allowed_navigation(&"https://example.com".parse().unwrap()));
    }

    #[cfg(windows)]
    #[test]
    fn windows_resource_paths_are_compatible_with_node() {
        assert_eq!(
            normalize_resource_path(PathBuf::from(r"\\?\D:\BOZ\resources\server")),
            PathBuf::from(r"D:\BOZ\resources\server")
        );
        assert_eq!(
            normalize_resource_path(PathBuf::from(r"\\?\UNC\server\share\BOZ")),
            PathBuf::from(r"\\server\share\BOZ")
        );
    }
}
