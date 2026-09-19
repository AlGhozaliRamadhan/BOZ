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

#[derive(Default)]
struct DesktopRuntime {
    child: Mutex<Option<Child>>,
    stopping: AtomicBool,
    server_ready: AtomicBool,
    recovery_dialog_open: AtomicBool,
    tray_initialized: AtomicBool,
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

/// Free BOZ_PORT by stopping whatever currently listens on it (stale sidecar,
/// leftover dev server, ...). Never touches our own process. Returns true
/// once the port is free for our sidecar.
fn reclaim_boz_port<R: Runtime>(app: &AppHandle<R>) -> bool {
    if !port_is_occupied() {
        return true;
    }
    let own = std::process::id();
    let occupants: Vec<u32> = listening_pids()
        .into_iter()
        .filter(|pid| *pid != own)
        .collect();
    if occupants.is_empty() {
        desktop_log(
            app,
            "BOZ port is occupied but no owning process was identified; leaving it alone",
        );
        return false;
    }
    for pid in occupants {
        let name = process_image_name(pid).unwrap_or_else(|| "unknown".to_string());
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

fn wait_for_server<R: Runtime>(app: &AppHandle<R>, token: &str) -> Result<(), String> {
    let deadline = Instant::now() + STARTUP_TIMEOUT;
    while Instant::now() < deadline {
        if probe_health(token) {
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
        thread::sleep(Duration::from_millis(250));
    }

    Err("BOZ did not become ready within 30 seconds.".to_string())
}

fn launch_sidecar<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    desktop_log(app, "Starting bundled Node sidecar");
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

fn check_for_updates<R: Runtime>(app: AppHandle<R>, manual: bool) {
    tauri::async_runtime::spawn(async move {
        let before_exit_app = app.clone();
        let updater = match app
            .updater_builder()
            .on_before_exit(move || terminate_sidecar(&before_exit_app))
            .build()
        {
            Ok(updater) => updater,
            Err(error) => {
                if manual {
                    show_error(&app, "Update check failed", error.to_string());
                }
                return;
            }
        };

        match updater.check().await {
            Ok(Some(update)) => {
                let version = update.version.clone();
                let install_app = app.clone();
                app.dialog()
                    .message(format!(
                        "BOZ {version} is available. Download and install it now?"
                    ))
                    .title("BOZ update available")
                    .buttons(MessageDialogButtons::OkCancelCustom(
                        "Install".to_string(),
                        "Later".to_string(),
                    ))
                    .show(move |install| {
                        if !install {
                            return;
                        }
                        tauri::async_runtime::spawn(async move {
                            if let Err(error) = update.download_and_install(|_, _| {}, || {}).await
                            {
                                show_error(&install_app, "Update failed", error.to_string());
                            } else if !cfg!(windows) {
                                install_app.restart();
                            }
                        });
                    });
            }
            Ok(None) if manual => {
                app.dialog()
                    .message("You are running the latest version of BOZ.")
                    .title("No update available")
                    .show(|_| {});
            }
            Ok(None) => {}
            Err(error) if manual => show_error(&app, "Update check failed", error.to_string()),
            Err(_) => {}
        }
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
