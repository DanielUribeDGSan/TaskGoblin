use device_query::{DeviceQuery, DeviceState, Keycode};
use enigo::{Enigo, Mouse, Settings};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, State, Wry,
};

#[derive(Serialize, Deserialize, Debug)]
struct AppConfig {
    last_x: Option<i32>,
    last_y: Option<i32>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            last_x: None,
            last_y: None,
        }
    }
}

struct AppState {
    mouse_moving: std::sync::Mutex<bool>,
    is_paint_mode: std::sync::Mutex<bool>,
    is_dialog_open: std::sync::Mutex<bool>,
    is_capturing: Arc<std::sync::Mutex<bool>>, // Arc so it can be cloned into threads
    // Sends capture region (x,y,w,h) or None (cancel) back from the Tauri overlay window
    capture_tx:
        tokio::sync::Mutex<Option<tokio::sync::oneshot::Sender<Option<(i32, i32, i32, i32)>>>>,
    shutdown_cancel_tx: tokio::sync::Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
    shutdown_target: tokio::sync::Mutex<Option<u64>>,
    shutdown_duration: tokio::sync::Mutex<Option<u64>>,
    last_tray_pos: tokio::sync::Mutex<Option<tauri::PhysicalPosition<i32>>>,
}

#[tauri::command]
async fn is_mouse_moving(state: State<'_, AppState>) -> Result<bool, String> {
    let moving = *state.mouse_moving.lock().map_err(|e| e.to_string())?;
    Ok(moving)
}

#[tauri::command]
async fn toggle_mouse(state: State<'_, AppState>) -> Result<bool, String> {
    let mut moving = state.mouse_moving.lock().map_err(|e| e.to_string())?;
    *moving = !*moving;
    Ok(*moving)
}

#[tauri::command]
async fn schedule_whatsapp(
    app_handle: tauri::AppHandle,
    phone: String,
    message: String,
    delay_secs: u64,
) -> Result<(), String> {
    #[cfg(not(target_os = "windows"))]
    let _ = app_handle;

    // Strictly sanitize phone
    let sanitized_phone = phone
        .chars()
        .filter(|c| c.is_digit(10) || *c == '+')
        .collect::<String>();

    println!(
        "Scheduled WhatsApp to {} in {} seconds",
        sanitized_phone, delay_secs
    );

    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_secs(delay_secs)).await;

        let url = format!(
            "whatsapp://send?phone={}&text={}",
            sanitized_phone,
            urlencoding::encode(&message)
        );

        #[cfg(target_os = "macos")]
        {
            let _ = std::process::Command::new("open").arg(&url).spawn();
            tokio::time::sleep(tokio::time::Duration::from_secs(4)).await;
            let script = r#"
                tell application "WhatsApp" to activate
                delay 0.5
                tell application "System Events"
                    keystroke return
                end tell
            "#;
            let _ = std::process::Command::new("osascript")
                .arg("-e")
                .arg(script)
                .output();
        }

        #[cfg(target_os = "windows")]
        {
            use tauri_plugin_opener::OpenerExt;

            // Show notification that we are starting
            use tauri_plugin_notification::NotificationExt;
            let _ = app_handle
                .notification()
                .builder()
                .title("TaskGoblin")
                .body(format!("Sending WhatsApp message to {}", sanitized_phone))
                .show();

            // Open URL via Tauri's robust opener which handles Windows correctly
            let _ = app_handle.opener().open_url(&url, None::<&str>);

            // Auto-send logic for Windows: wait 6s for the app to load the chat, then hit Enter
            tokio::time::sleep(tokio::time::Duration::from_secs(6)).await;
            let _ = tauri::async_runtime::spawn_blocking(move || {
                use enigo::{Direction, Enigo, Key, Keyboard, Settings};
                if let Ok(mut enigo) = Enigo::new(&Settings::default()) {
                    let _ = enigo.key(Key::Return, Direction::Click);
                }
            })
            .await;
        }

        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            let _ = std::process::Command::new("xdg-open").arg(&url).spawn();
        }
    });
    Ok(())
}

#[derive(serde::Serialize)]
struct Contact {
    name: String,
    phone: String,
}

#[tauri::command]
async fn get_contacts() -> Result<Vec<Contact>, String> {
    println!("Fetching contacts (async + optimized bulk)...");
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;

        // This is a more compatible bulk fetch. We get names and phones separately
        // to avoid the -1728 error that occurs when mixing them in a filter.
        let script = r#"
            tell application "Contacts"
                try
                    set allNames to name of every person
                    set allPhones to value of phones of every person
                    
                    set _output to ""
                    repeat with i from 1 to count of allNames
                        set _n to item i of allNames
                        set _ps to item i of allPhones
                        repeat with _p in _ps
                            set _output to _output & _n & "|" & _p & "\n"
                        end repeat
                    end repeat
                    return _output
                on error err
                    return "ERROR|" & err
                end try
            end tell
        "#;

        let res = tauri::async_runtime::spawn_blocking(move || {
            Command::new("osascript").arg("-e").arg(script).output()
        })
        .await
        .map_err(|e| e.to_string())?;

        match res {
            Ok(out) => {
                let stdout = String::from_utf8_lossy(&out.stdout);

                if stdout.starts_with("ERROR|") {
                    return Err(stdout.replace("ERROR|", ""));
                }

                let contacts: Vec<Contact> = stdout
                    .lines()
                    .filter_map(|line| {
                        let parts: Vec<&str> = line.split('|').collect();
                        if parts.len() == 2 {
                            let name = parts[0].trim().to_string();
                            let phone = parts[1].trim().to_string();
                            if name.is_empty() || name == "missing value" || phone.is_empty() {
                                None
                            } else {
                                Some(Contact { name, phone })
                            }
                        } else {
                            None
                        }
                    })
                    .collect();
                println!("Fetched {} contacts", contacts.len());
                return Ok(contacts);
            }
            Err(e) => {
                return Err(format!("Command execution failed: {}", e));
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(Vec::new())
    }
}

#[tauri::command]
fn open_contact_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let _ = Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Contacts")
            .spawn();
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Not supported on this OS".to_string())
    }
}

#[tauri::command]
fn open_accessibility_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let _ = Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
            .spawn();
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Not supported on this OS".to_string())
    }
}

#[tauri::command]
fn check_accessibility() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        extern "C" {
            fn AXIsProcessTrusted() -> bool;
        }
        unsafe { Ok(AXIsProcessTrusted()) }
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(true)
    }
}

#[tauri::command]
fn request_accessibility() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
        // Moving mouse 1 pixel to trigger the permission dialog
        let _ = enigo.move_mouse(0, 0, enigo::Coordinate::Rel);
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(())
    }
}

#[tauri::command]
fn start_window_drag(window: tauri::Window) {
    let _ = window.start_dragging();
}

#[tauri::command]
fn set_ignore_cursor_events(window: tauri::Window, ignore: bool) -> Result<(), String> {
    let _ = window.set_ignore_cursor_events(ignore);
    Ok(())
}

#[tauri::command]
async fn repair_permissions(_app_handle: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        use std::thread;
        use std::time::Duration;
        let bundle_id = "com.taskgoblin.app";

        println!("Repairing permissions for {}", bundle_id);

        // Reset TCC entries
        let _ = Command::new("tccutil")
            .arg("reset")
            .arg("Accessibility")
            .arg(bundle_id)
            .output();
        let _ = Command::new("tccutil")
            .arg("reset")
            .arg("ScreenCapture")
            .arg(bundle_id)
            .output();
        let _ = Command::new("tccutil")
            .arg("reset")
            .arg("All")
            .arg(bundle_id)
            .output();

        // Wait for macOS to process the resets
        thread::sleep(Duration::from_secs(5));

        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(())
    }
}

#[tauri::command]
fn restart_app(app_handle: tauri::AppHandle) {
    app_handle.restart();
}

// (Pet mode removed as per user request)

#[tauri::command]
async fn toggle_paint_mode(
    window: tauri::Window,
    active: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let _ = window;

    {
        let mut paint_mode = state.is_paint_mode.lock().map_err(|e| e.to_string())?;
        *paint_mode = active;
    }

    #[cfg(target_os = "macos")]
    {
        if active {
            // Manual "maximize" to avoid OS animation jitter
            if let Ok(Some(monitor)) = window.current_monitor() {
                let size = monitor.size();
                let _ = window.set_resizable(true);
                let _ = window.set_size(tauri::Size::Physical(*size));
                let _ = window.set_position(tauri::PhysicalPosition::new(0, 0));
                let _ = window.set_always_on_top(true);
                let _ = window.set_ignore_cursor_events(false);
            }
        } else {
            // Hide window during transition flip to avoid seeing the sidebar jump/slide
            let _ = window.hide();

            // Restore sidebar size
            let _ = window.set_ignore_cursor_events(false);
            let _ = window.set_resizable(false);
            let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(360.0, 580.0)));

            // Force position restoration
            let pos_lock = state.last_tray_pos.lock().await;
            if let Some(pos) = *pos_lock {
                let _ = window.set_position(tauri::Position::Physical(pos));
            }

            let _ = window.set_always_on_top(false);

            // Show again once in place
            let _ = window.show();
            let _ = window.set_focus();
        }
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        if active {
            // Expand window to cover the full primary monitor
            if let Ok(Some(monitor)) = window.current_monitor() {
                let size = monitor.size();
                let _ = window.set_decorations(false);
                let _ = window.set_resizable(true);
                let _ = window.set_size(tauri::Size::Physical(*size));
                let _ = window.set_position(tauri::PhysicalPosition::new(0, 0));
                let _ = window.set_always_on_top(true);
                let _ = window.set_ignore_cursor_events(false);
            }
        } else {
            // Restore sidebar size — keep the window VISIBLE on Windows (no hide)
            let _ = window.set_ignore_cursor_events(false);
            let _ = window.set_always_on_top(false);
            let _ = window.set_resizable(false);
            let _ = window.set_decorations(false);
            let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(360.0, 580.0)));

            // Restore last position
            let pos_lock = state.last_tray_pos.lock().await;
            if let Some(pos) = *pos_lock {
                let _ = window.set_position(tauri::Position::Physical(pos));
            }

            let _ = window.show();
            let _ = window.set_focus();
        }
        Ok(())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Ok(())
    }
}

#[tauri::command]
async fn close_all_apps() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;

        // Expanded list of applications to explicitly NOT close when "Close All Apps" is triggered
        let script = r#"
            set appsToKeep to {"Finder", "mouse-crazy-app", "TaskGoblin", "Terminal", "iTerm", "iTerm2", "System Events", "System Settings", "System Preferences", "Activity Monitor", "Console", "Docker Desktop", "Docker", "1Password", "1Password 8", "Alfred", "Raycast", "Dropbox", "Google Drive", "OneDrive", "Rectangle", "Magnet", "BetterTouchTool", "Logi Options", "Logi Options+", "Logitech G HUB"}

            set bundleIdsToQuit to {}
            tell application "System Events"
                set activeProcs to every application process where background only is false
                repeat with proc in activeProcs
                    set pName to name of proc
                    if pName is not in appsToKeep then
                        try
                            set bundleId to bundle identifier of proc
                            if bundleId is not missing value then
                                set end of bundleIdsToQuit to bundleId
                            end if
                        end try
                    end if
                end repeat
            end tell
            
            repeat with bid in bundleIdsToQuit
                try
                    tell application id bid to quit
                end try
            end repeat
        "#;

        let res = tauri::async_runtime::spawn_blocking(move || {
            Command::new("osascript").arg("-e").arg(script).output()
        })
        .await
        .map_err(|e| e.to_string())?;

        match res {
            Ok(_) => Ok(()),
            Err(e) => Err(format!("Command execution failed: {}", e)),
        }
    }
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        // On Windows, close all foreground processes except system & our app
        let keep = [
            "mouse-crazy-app.exe",
            "explorer.exe",
            "taskmgr.exe",
            "cmd.exe",
            "powershell.exe",
            "WindowsTerminal.exe",
            "svchost.exe",
            "lsass.exe",
            "csrss.exe",
            "wininit.exe",
            "services.exe",
            "System",
        ];
        // PowerShell: get all visible windows processes except the ones we keep
        let ps_script = r#"
$keep = @('mouse-crazy-app.exe','explorer.exe','taskmgr.exe','cmd.exe','powershell.exe','WindowsTerminal.exe','svchost.exe','lsass.exe','csrss.exe','wininit.exe','services.exe','System','SearchUI.exe','ShellExperienceHost.exe','RuntimeBroker.exe','dwm.exe','winlogon.exe')
Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $keep -notcontains ($_.Name + '.exe') } | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
"#;
        let _ = keep; // suppress unused warning
        let _ = tauri::async_runtime::spawn_blocking(move || {
            #[allow(unused_mut)]
            let mut cmd = Command::new("powershell");
            cmd.arg("-NoProfile")
                .arg("-NonInteractive")
                .arg("-WindowStyle")
                .arg("Hidden")
                .arg("-Command")
                .arg(ps_script);
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x08000000);
            }
            cmd.output()
        })
        .await;
        Ok(())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Err("Not supported on this OS".to_string())
    }
}

/// Close only "leisure" apps (streaming, social, games). Keeps our app and system apps.
#[tauri::command]
async fn close_leisure_apps() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let apps_to_quit = [
            "Spotify",
            "Netflix",
            "YouTube",
            "Hulu",
            "Disney+",
            "Prime Video",
            "Apple Music",
            "Music",
            "Discord",
            "Slack",
            "Telegram",
            "WhatsApp",
            "Messenger",
            "Facebook",
            "Twitch",
            "Steam",
            "Epic Games Launcher",
            "Battle.net",
            "Origin",
            "EA app",
            "GOG Galaxy",
            "iTunes",
            "TV",
            "Podcasts",
            "Books",
        ];
        run_close_apps_by_names(&apps_to_quit).await
    }
    #[cfg(target_os = "windows")]
    {
        let apps_to_quit = [
            "Spotify.exe",
            "Discord.exe",
            "Slack.exe",
            "Telegram.exe",
            "WhatsApp.exe",
            "Messenger.exe",
            "steam.exe",
            "EpicGamesLauncher.exe",
            "Battle.net.exe",
            "Origin.exe",
            "EADesktop.exe",
            "GalaxyClient.exe",
            "Twitch.exe",
        ];
        run_close_apps_by_names_win(&apps_to_quit).await
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Err("Not supported on this OS".to_string())
    }
}

/// Close only "heavy" apps (browsers with many tabs, IDEs, Docker, etc.).
#[tauri::command]
async fn close_heavy_apps() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let apps_to_quit = [
            "Google Chrome",
            "Chrome",
            "Safari",
            "Firefox",
            "Arc",
            "Brave Browser",
            "Microsoft Edge",
            "Docker Desktop",
            "Docker",
            "Xcode",
            "Visual Studio Code",
            "Code",
            "Figma",
            "Zoom",
            "Microsoft Teams",
            "Webex",
            "Adobe Acrobat",
            "Adobe Acrobat DC",
            "IntelliJ IDEA",
            "WebStorm",
            "PhpStorm",
            "PyCharm",
            "Android Studio",
        ];
        run_close_apps_by_names(&apps_to_quit).await
    }
    #[cfg(target_os = "windows")]
    {
        let apps_to_quit = [
            "chrome.exe",
            "msedge.exe",
            "firefox.exe",
            "brave.exe",
            "opera.exe",
            "iexplore.exe",
            "Code.exe",
            "devenv.exe",
            "idea64.exe",
            "webstorm64.exe",
            "pycharm64.exe",
            "studio64.exe",
            "Figma.exe",
            "Zoom.exe",
            "Teams.exe",
            "AcroRd32.exe",
            "Acrobat.exe",
            "Docker Desktop.exe",
        ];
        run_close_apps_by_names_win(&apps_to_quit).await
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Err("Not supported on this OS".to_string())
    }
}

#[cfg(target_os = "macos")]
async fn run_close_apps_by_names(names: &[&str]) -> Result<(), String> {
    use std::process::Command;
    let list_str = names
        .iter()
        .map(|s| format!("\"{}\"", s))
        .collect::<Vec<_>>()
        .join(", ");
    let script = format!(
        r#"
        set appsToQuit to {{{}}}
        tell application "System Events"
            set activeProcs to every application process where background only is false
            repeat with proc in activeProcs
                set pName to name of proc
                if appsToQuit contains pName then
                    try
                        set bundleId to bundle identifier of proc
                        if bundleId is not missing value then
                            tell application id bundleId to quit
                        end if
                    end try
                end if
            end repeat
        end tell
        "#,
        list_str
    );
    let res = tauri::async_runtime::spawn_blocking(move || {
        Command::new("osascript").arg("-e").arg(script).output()
    })
    .await
    .map_err(|e| e.to_string())?;
    match res {
        Ok(_) => Ok(()),
        Err(e) => Err(format!("Command execution failed: {}", e)),
    }
}

#[cfg(target_os = "windows")]
async fn run_close_apps_by_names_win(names: &[&str]) -> Result<(), String> {
    use std::process::Command;
    for name in names {
        let name_owned = name.to_string();
        let _ = tauri::async_runtime::spawn_blocking(move || {
            #[allow(unused_mut)]
            let mut cmd = Command::new("taskkill");
            cmd.arg("/F").arg("/IM").arg(&name_owned).arg("/T");
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x08000000);
            }
            cmd.output()
        })
        .await;
    }
    Ok(())
}

/// Open macOS Focus (Do Not Disturb) settings so user can enable it.
#[tauri::command]
async fn open_focus_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let res = Command::new("open")
            .arg("x-apple.systempreferences:com.apple.Focus-Settings.extension")
            .output();
        match res {
            Ok(_) => Ok(()),
            Err(e) => Err(format!("Failed to open Focus settings: {}", e)),
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Not supported on this OS".to_string())
    }
}

/// Schedule system shutdown after delay_secs. App must stay running until then; quitting the app cancels the shutdown.
#[tauri::command]
async fn schedule_shutdown(
    delay_secs: u64,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if delay_secs == 0 {
            return Err("Delay must be greater than 0".to_string());
        }

        // 1. Cancel existing shutdown task if any
        let mut new_rx;
        {
            let mut tx_lock = state.shutdown_cancel_tx.lock().await;
            if let Some(tx) = tx_lock.take() {
                let _ = tx.send(()); // abort previous sleep
            }

            // Create new oneshot channel
            let (new_tx, rx) = tokio::sync::oneshot::channel::<()>();
            new_rx = rx;
            *tx_lock = Some(new_tx);
        }

        let target_timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs()
            + delay_secs;

        {
            *state.shutdown_target.lock().await = Some(target_timestamp);
            *state.shutdown_duration.lock().await = Some(delay_secs);
        }

        // 2. Spawn the transparent "Island" window at the top center
        let window_label = "island";
        if let Some(existing) = app_handle.get_webview_window(window_label) {
            let _ = existing.close();
        }

        let _island_window = tauri::WebviewWindowBuilder::new(
            &app_handle,
            window_label,
            tauri::WebviewUrl::App("island.html".into()),
        )
        .title("Shutdown Scheduler")
        .inner_size(240.0, 60.0)
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .resizable(false)
        .skip_taskbar(true)
        .shadow(false)
        .position(0.0, 30.0) // We will center it dynamically below, but start at top
        .build()
        .map_err(|e| format!("Failed to create island window: {}", e))?;

        // Try to center it correctly
        if let Some(window) = app_handle.get_webview_window(window_label) {
            if let Ok(Some(monitor)) = window.current_monitor() {
                let monitor_size = monitor.size();
                let window_size = window
                    .outer_size()
                    .unwrap_or(tauri::PhysicalSize::new(240, 60));
                let x = (monitor_size.width as f64 / 2.0) - (window_size.width as f64 / 2.0);
                let _ = window.set_position(tauri::Position::Physical(
                    tauri::PhysicalPosition::new(x as i32, 20),
                ));
            }
        }

        // 3. Spawn the background cancellable tokio task
        let app_clone = app_handle.clone();
        tauri::async_runtime::spawn(async move {
            tokio::select! {
                _ = tokio::time::sleep(tokio::time::Duration::from_secs(delay_secs)) => {
                    // Time elapsed naturally, execute shutdown using AppleScript (no root needed)
                    let _ = std::process::Command::new("osascript")
                        .arg("-e")
                        .arg("tell application \"System Events\" to shut down")
                        .output();

                    // Cleanup window exactly before system dies
                    if let Some(w) = app_clone.get_webview_window("island") {
                        let _ = w.close();
                    }
                }
                _ = &mut new_rx => {
                    // User cancelled via UI or re-scheduled
                    println!("Shutdown task was aborted/replaced.");
                }
            }
        });

        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;

        if delay_secs == 0 {
            return Err("Delay must be greater than 0".to_string());
        }

        // Cancel any previous Windows scheduled shutdown
        let _ = Command::new("shutdown").arg("/a").output();

        // 1. Cancel existing countdown task if any
        let mut new_rx;
        {
            let mut tx_lock = state.shutdown_cancel_tx.lock().await;
            if let Some(tx) = tx_lock.take() {
                let _ = tx.send(());
            }
            let (new_tx, rx) = tokio::sync::oneshot::channel::<()>();
            new_rx = rx;
            *tx_lock = Some(new_tx);
        }

        // 2. Update state for UI countdown
        let target_timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs()
            + delay_secs;
        *state.shutdown_target.lock().await = Some(target_timestamp);
        *state.shutdown_duration.lock().await = Some(delay_secs);

        // 3. Create island countdown window (same as macOS)
        let window_label = "island";
        if let Some(existing) = app_handle.get_webview_window(window_label) {
            let _ = existing.close();
        }
        let _island_window = tauri::WebviewWindowBuilder::new(
            &app_handle,
            window_label,
            tauri::WebviewUrl::App("island.html".into()),
        )
        .title("Shutdown Scheduler")
        .inner_size(240.0, 60.0)
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .resizable(false)
        .skip_taskbar(true)
        .shadow(false)
        .position(0.0, 30.0)
        .build()
        .map_err(|e| format!("Failed to create island window: {}", e))?;

        // Center island at top of screen
        if let Some(island) = app_handle.get_webview_window(window_label) {
            if let Ok(Some(monitor)) = island.current_monitor() {
                let mw = monitor.size().width as f64;
                let ww = island
                    .outer_size()
                    .unwrap_or(tauri::PhysicalSize::new(240, 60))
                    .width as f64;
                let x = mw / 2.0 - ww / 2.0;
                let _ = island.set_position(tauri::Position::Physical(
                    tauri::PhysicalPosition::new(x as i32, 20),
                ));
            }
        }

        // 4. Schedule actual OS shutdown via `shutdown /s /t <N>`
        let secs_str = delay_secs.to_string();
        let res = tauri::async_runtime::spawn_blocking(move || {
            #[allow(unused_mut)]
            let mut cmd = Command::new("shutdown");
            cmd.arg("/s").arg("/t").arg(&secs_str).arg("/f");
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x08000000);
            }
            cmd.output()
        })
        .await
        .map_err(|e| e.to_string())?;

        if let Err(e) = res {
            return Err(format!("Failed to schedule shutdown: {}", e));
        }

        // 5. Spawn cancellable tokio task (closes island on cancel)
        let app_clone = app_handle.clone();
        tauri::async_runtime::spawn(async move {
            tokio::select! {
                _ = tokio::time::sleep(tokio::time::Duration::from_secs(delay_secs)) => {
                    // OS already scheduled to shut down; just clean up
                    if let Some(w) = app_clone.get_webview_window("island") {
                        let _ = w.close();
                    }
                }
                _ = &mut new_rx => {
                    // User cancelled: OS shutdown already aborted via `shutdown /a` in cancel_shutdown
                    println!("Windows shutdown task cancelled.");
                }
            }
        });

        Ok(())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Err("Not supported on this OS".to_string())
    }
}

#[tauri::command]
async fn cancel_shutdown(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut tx_lock = state.shutdown_cancel_tx.lock().await;
    if let Some(tx) = tx_lock.take() {
        let _ = tx.send(()); // Trigger the oneshot receiver (macOS path)
    }

    *state.shutdown_target.lock().await = None;
    *state.shutdown_duration.lock().await = None;

    if let Some(w) = app_handle.get_webview_window("island") {
        let _ = w.close();
    }

    // On Windows, abort the OS-level scheduled shutdown
    #[cfg(target_os = "windows")]
    {
        let _ = tauri::async_runtime::spawn_blocking(|| {
            #[allow(unused_mut)]
            let mut cmd = std::process::Command::new("shutdown");
            cmd.arg("/a");
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x08000000);
            }
            cmd.output()
        })
        .await;
    }

    Ok(())
}

#[tauri::command]
async fn get_shutdown_time(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let target = *state.shutdown_target.lock().await;
    let duration = *state.shutdown_duration.lock().await;

    Ok(serde_json::json!({
        "target_timestamp": target.unwrap_or(0),
        "duration_secs": duration.unwrap_or(0)
    }))
}

#[tauri::command]
async fn process_image(
    input_path: String,
    output_path: String,
    format: String,
    width: Option<u32>,
    height: Option<u32>,
    quality: Option<u8>,
    optimize: bool,
) -> Result<(), String> {
    use image::{ImageEncoder, ImageFormat};
    use std::fs::File;

    println!(
        "Processing image: {} to {} as {}",
        input_path, output_path, format
    );

    // Load image
    let img = image::open(&input_path).map_err(|e| format!("Failed to open image: {}", e))?;

    // Resize if requested
    let img = if width.is_some() || height.is_some() {
        let (w, h) = match (width, height) {
            (Some(w), Some(h)) => (w, h),
            (Some(w), None) => {
                let ratio = w as f32 / img.width() as f32;
                (w, (img.height() as f32 * ratio) as u32)
            }
            (None, Some(h)) => {
                let ratio = h as f32 / img.height() as f32;
                ((img.width() as f32 * ratio) as u32, h)
            }
            _ => unreachable!(),
        };
        img.resize(w, h, image::imageops::FilterType::Lanczos3)
    } else {
        img
    };

    let output_file =
        File::create(&output_path).map_err(|e| format!("Failed to create output file: {}", e))?;

    match format.to_lowercase().as_str() {
        "jpg" | "jpeg" => {
            let q = if optimize { 70 } else { quality.unwrap_or(80) };
            let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(output_file, q);
            encoder
                .encode_image(&img)
                .map_err(|e| format!("Failed to encode JPEG: {}", e))?;
        }
        "png" => {
            if optimize {
                let encoder = image::codecs::png::PngEncoder::new_with_quality(
                    output_file,
                    image::codecs::png::CompressionType::Best,
                    image::codecs::png::FilterType::Adaptive,
                );
                encoder
                    .write_image(img.as_bytes(), img.width(), img.height(), img.color())
                    .map_err(|e| format!("Failed to encode optimized PNG: {}", e))?;
            } else {
                img.write_to(&mut std::io::BufWriter::new(output_file), ImageFormat::Png)
                    .map_err(|e| format!("Failed to write PNG: {}", e))?;
            }
        }
        "webp" => {
            use image::codecs::webp::{WebPEncoder, WebPQuality};

            let q = if optimize { 75 } else { quality.unwrap_or(80) };
            let mut writer = std::io::BufWriter::new(output_file);
            let encoder = WebPEncoder::new_with_quality(&mut writer, WebPQuality::lossy(q));

            encoder
                .encode(img.as_bytes(), img.width(), img.height(), img.color())
                .map_err(|e| format!("Failed to encode WebP: {}", e))?;
        }
        "avif" => {
            let (width, height) = (img.width() as usize, img.height() as usize);
            let rgba = img.to_rgba8();
            let pixels = rgba.as_raw();

            // Map raw bytes to RGBA8 pixels manually (safe and simple)
            let pixels_rgba: Vec<ravif::RGBA8> = pixels
                .chunks_exact(4)
                .map(|c| ravif::RGBA8::new(c[0], c[1], c[2], c[3]))
                .collect();

            let img_ravif = ravif::Img::new(pixels_rgba.as_slice(), width, height);

            let q = if optimize {
                70.0
            } else {
                quality.unwrap_or(80) as f32
            };
            let speed = 8; // Faster encoding for better UX

            let res = ravif::Encoder::new()
                .with_quality(q)
                .with_speed(speed)
                .encode_rgba(img_ravif)
                .map_err(|e| format!("AVIF encoding failed: {}", e))?;

            let avif_file = res.avif_file;

            use std::io::Write;
            let mut writer = std::io::BufWriter::new(output_file);
            writer
                .write_all(&avif_file)
                .map_err(|e| format!("Failed to write AVIF file: {}", e))?;
        }
        "bmp" => {
            img.write_to(&mut std::io::BufWriter::new(output_file), ImageFormat::Bmp)
                .map_err(|e| format!("Failed to write BMP: {}", e))?;
        }
        "gif" => {
            img.write_to(&mut std::io::BufWriter::new(output_file), ImageFormat::Gif)
                .map_err(|e| format!("Failed to write GIF: {}", e))?;
        }
        "tiff" => {
            img.write_to(&mut std::io::BufWriter::new(output_file), ImageFormat::Tiff)
                .map_err(|e| format!("Failed to write TIFF: {}", e))?;
        }
        "heic" | "heif" => {
            // MacOS native conversion using sips
            // Since we already resized 'img' if requested, we should save it to a temp folder first
            // or if no resize was requested, just call sips on the input file.

            use std::process::Command;

            // If we resized, we need to export the resized version to a temp file first
            if width.is_some() || height.is_some() {
                let temp_path = format!("{}.tmp.png", output_path);
                img.write_to(
                    &mut std::io::BufWriter::new(
                        File::create(&temp_path).map_err(|e| e.to_string())?,
                    ),
                    ImageFormat::Png,
                )
                .map_err(|e| format!("Failed to write temp PNG for HEIC conversion: {}", e))?;

                let output = Command::new("sips")
                    .args(["-s", "format", "heic", &temp_path, "--out", &output_path])
                    .output()
                    .map_err(|e| format!("Sips command failed: {}", e))?;

                let _ = std::fs::remove_file(temp_path);

                if !output.status.success() {
                    return Err(format!(
                        "sips failed: {}",
                        String::from_utf8_lossy(&output.stderr)
                    ));
                }
            } else {
                // No resize needed, just convert input to output directly
                let output = Command::new("sips")
                    .args(["-s", "format", "heic", &input_path, "--out", &output_path])
                    .output()
                    .map_err(|e| format!("Sips command failed: {}", e))?;

                if !output.status.success() {
                    return Err(format!(
                        "sips failed: {}",
                        String::from_utf8_lossy(&output.stderr)
                    ));
                }
            }
        }
        _ => return Err(format!("Unsupported output format: {}", format)),
    }

    Ok(())
}

/// Fixes common OCR misreads for Spanish (e.g. å→á).
#[cfg(target_os = "windows")]
fn fix_ocr_spanish_accents(s: String) -> String {
    s.replace('å', "á")
        .replace('Å', "Á")
        .replace('ã', "á")
        .replace('Ã', "Á")
        .replace('õ', "ó")
        .replace('Õ', "Ó")
        .replace('è', "é")
        .replace('È', "É")
        .replace('ì', "í")
        .replace('Ì', "Í")
        .replace('ù', "ú")
        .replace('Ù', "Ú")
        // Misreads from user examples
        .replace("iS", "¡S")
        .replace(" 10 ", " lo ")
        .replace(" dd ", " del ")
        .replace("mensaJe", "mensaje")
        .replace("errorz", "errores")
        .replace("conv«sión", "conversión")
        .replace("Sistana", "Sistema")
        .replace("EI ", "El ")
}

#[cfg(not(target_os = "windows"))]
fn fix_ocr_spanish_accents(s: String) -> String {
    s
}

#[tauri::command]
async fn extract_text_from_screen(window: tauri::WebviewWindow) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        use std::fs;
        use std::process::Command;

        // 0. Preliminary check: Is 'swift' available?
        let swift_check = Command::new("which")
            .arg("swift")
            .output()
            .map_err(|e| format!("Failed to check for swift: {}", e))?;

        if !swift_check.status.success() {
            return Err("El comando 'swift' no está disponible. Por favor, instala Xcode Command Line Tools (ejecuta 'xcode-select --install' en la Terminal).".to_string());
        }

        let was_visible = window.is_visible().unwrap_or(false);

        // Ensure the window is fully hidden before taking the screenshot
        if was_visible {
            let _ = window.hide();
            // Give macOS time to animate the window away
            tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        }

        let temp_image_path = "/tmp/mouse_crazy_ocr_capture.png";

        // 1. Trigger interactive screencapture.
        // -i = interactive (selection), -x = no sound
        let capture_res = tauri::async_runtime::spawn_blocking(move || {
            Command::new("screencapture")
                .arg("-i")
                .arg("-x")
                .arg(temp_image_path)
                .output()
        })
        .await
        .map_err(|e| e.to_string())?;

        // After capture is complete (or aborted), show the window again only if it was visible
        if was_visible {
            let _ = window.show();
            let _ = window.set_focus();
        }

        match capture_res {
            Ok(output) => {
                // If user pressed Escape to cancel, the file might not exist
                if !std::path::Path::new(temp_image_path).exists() {
                    // Try to differentiate between Cancel and "No Permission"
                    // Usually if capture fails due to TCC permissions, it might return a non-zero exit code or stderr message
                    if !output.status.success() {
                        let stderr = String::from_utf8_lossy(&output.stderr);
                        if stderr.contains("denied") || stderr.contains("permission") {
                            return Err("Permiso de 'Grabación de Pantalla' denegado. Por favor, habilítalo en Ajustes del Sistema > Privacidad y Seguridad.".to_string());
                        }
                        return Err(format!("Error en captura: {}", stderr));
                    }

                    // If status is success but file doesn't exist, it's likely a cancel (Esc)
                    return Ok("".to_string());
                }

                // 2. Swift script to run Vision OCR on the image
                let swift_script = r#"
                    import Vision
                    import Cocoa

                    let imagePath = "/tmp/mouse_crazy_ocr_capture.png"
                    guard let image = NSImage(contentsOfFile: imagePath),
                          let tiffData = image.tiffRepresentation,
                          let bitmap = NSBitmapImageRep(data: tiffData),
                          let cgImage = bitmap.cgImage else {
                        print("ERROR: Failed to load image. If this happens consistently, check Screen Recording permissions.")
                        exit(1)
                    }

                    let request = VNRecognizeTextRequest { (request, error) in
                        guard let observations = request.results as? [VNRecognizedTextObservation] else { return }
                        let text = observations.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
                        print(text)
                    }
                    request.recognitionLevel = .accurate
                    request.usesLanguageCorrection = true
                    request.recognitionLanguages = ["es-ES", "en-US"]

                    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
                    do {
                        try handler.perform([request])
                    } catch {
                        print("ERROR: \(error)")
                        exit(1)
                    }
                "#;

                let ocr_res = tauri::async_runtime::spawn_blocking(move || {
                    Command::new("swift").arg("-e").arg(swift_script).output()
                })
                .await
                .map_err(|e| e.to_string())?;

                // 3. Clean up the temp image
                let _ = fs::remove_file(temp_image_path);

                match ocr_res {
                    Ok(out) => {
                        let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
                        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();

                        if !out.status.success() || stdout.starts_with("ERROR:") {
                            let err_msg = if !stdout.is_empty() { stdout } else { stderr };
                            Err(format!("Error OCR: {}", err_msg))
                        } else if stdout.starts_with("BASE64:") {
                            // Decode Base64 to get perfect UTF-8 string
                            let b64_data = stdout.trim_start_matches("BASE64:");
                            use base64::{engine::general_purpose, Engine as _};
                            match general_purpose::STANDARD.decode(b64_data) {
                                Ok(bytes) => Ok(String::from_utf8_lossy(&bytes).to_string()),
                                Err(_) => Ok(stdout), // fallback if decode fails
                            }
                        } else {
                            Ok(stdout)
                        }
                    }
                    Err(e) => Err(format!("No se pudo ejecutar el script de OCR: {}", e)),
                }
            }
            Err(e) => Err(format!("Fallo al iniciar screencapture: {}", e)),
        }
    }
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;

        let app_handle = window.app_handle().clone();
        let was_visible = window.is_visible().unwrap_or(false);

        // Minimize the sidebar so it's not in the screenshot
        if was_visible {
            let _ = window.minimize();
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        }

        // Create a oneshot channel; store the sender in AppState
        let (tx, rx) = tokio::sync::oneshot::channel::<Option<(i32, i32, i32, i32)>>();
        {
            let state = app_handle.state::<AppState>();
            let mut lock = state.capture_tx.lock().await;
            *lock = Some(tx);
        }

        // Open the Tauri transparent fullscreen overlay window (capture.html)
        // This is instant — no console window, no PowerShell needed for the UI
        if let Some(existing) = app_handle.get_webview_window("capture") {
            let _ = existing.close();
        }
        let _cap_win = tauri::WebviewWindowBuilder::new(
            &app_handle,
            "capture",
            tauri::WebviewUrl::App("capture.html".into()),
        )
        .fullscreen(true)
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .resizable(false)
        .build()
        .map_err(|e| format!("Failed to open capture window: {}", e))?;

        // Wait for the user to select a region (or cancel)
        let region = rx.await.ok().flatten();

        let (sx, sy, sw, sh) = match region {
            Some(r) => r,
            None => {
                if was_visible {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                return Ok("".to_string());
            }
        };

        if sw <= 0 || sh <= 0 {
            if was_visible {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
            return Ok("".to_string());
        }

        use tauri::Emitter;
        let _ = app_handle.emit("ocr-start", ());

        // Show island "Copiando texto..." while OCR runs (same pill UI as shutdown countdown)
        let ocr_island_label = "ocr-island";
        if let Some(existing) = app_handle.get_webview_window(ocr_island_label) {
            let _ = existing.close();
        }
        let _ocr_island = tauri::WebviewWindowBuilder::new(
            &app_handle,
            ocr_island_label,
            tauri::WebviewUrl::App("island.html?mode=ocr".into()),
        )
        .title("OCR")
        .inner_size(240.0, 60.0)
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .resizable(false)
        .skip_taskbar(true)
        .shadow(false)
        .position(0.0, 30.0)
        .build()
        .ok();
        if let Some(ref island) = app_handle.get_webview_window(ocr_island_label) {
            if let Ok(Some(monitor)) = island.current_monitor() {
                let mw = monitor.size().width as f64;
                let ww = island
                    .outer_size()
                    .unwrap_or(tauri::PhysicalSize::new(240, 60))
                    .width as f64;
                let x = mw / 2.0 - ww / 2.0;
                let _ = island.set_position(tauri::Position::Physical(
                    tauri::PhysicalPosition::new(x as i32, 20),
                ));
            }
        }

        let temp_image_path = std::env::temp_dir().join("mouse_crazy_ocr_capture.png");
        let temp_image_str = temp_image_path.to_string_lossy().to_string();

        let combined_ps = r#"
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Runtime.WindowsRuntime

try {
    # 1. Capture Screen
    $x=[int]$env:CAP_X; $y=[int]$env:CAP_Y; $w=[int]$env:CAP_W; $h=[int]$env:CAP_H
    $bmp = New-Object System.Drawing.Bitmap($w, $h)
    $g   = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($x, $y, 0, 0, (New-Object System.Drawing.Size($w, $h)))
    $g.Dispose()
    
    # 2. Scale 2x for better OCR recognition quality
    $sw = $w * 2; $sh = $h * 2
    $sbmp = New-Object System.Drawing.Bitmap($sw, $sh)
    $sg = [System.Drawing.Graphics]::FromImage($sbmp)
    $sg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $sg.DrawImage($bmp, 0, 0, $sw, $sh)
    $sg.Dispose()
    $bmp.Dispose()

    $sbmp.Save($env:OCR_IMG_PATH, [System.Drawing.Imaging.ImageFormat]::Png)
    $sbmp.Dispose()

    # 2. Perform OCR (load WinRT types)
    $null = [Windows.Media.Ocr.OcrEngine,             Windows.Foundation, ContentType=WindowsRuntime]
    $null = [Windows.Graphics.Imaging.BitmapDecoder,  Windows.Graphics,   ContentType=WindowsRuntime]
    $null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics,   ContentType=WindowsRuntime]
    $null = [Windows.Globalization.Language,          Windows.Globalization, ContentType=WindowsRuntime]

    $asTaskGM = [System.WindowsRuntimeSystemExtensions].GetMethods() |
        Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1 } |
        Select-Object -First 1

    function Await { param($op, $type)
        $asTaskGM.MakeGenericMethod($type).Invoke($null, @($op)).GetAwaiter().GetResult()
    }

    $fileStream = [System.IO.File]::OpenRead($env:OCR_IMG_PATH)
    $ras        = [System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($fileStream)
    $decoder    = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($ras)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $softBmp    = Await ($decoder.GetSoftwareBitmapAsync())                            ([Windows.Graphics.Imaging.SoftwareBitmap])
    $fileStream.Dispose()
    Remove-Item $env:OCR_IMG_PATH -ErrorAction SilentlyContinue

    # Prefer Spanish so OCR preserves accents (á, é, í, ó, ú, ñ)
    $engine = $null
    try {
        $langEs = [Windows.Globalization.Language]::new('es-ES')
        $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($langEs)
    } catch { }
    if ($null -eq $engine) {
        try {
            $langMx = [Windows.Globalization.Language]::new('es-MX')
            $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($langMx)
        } catch { }
    }
    if ($null -eq $engine) {
        $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    }
    if ($null -eq $engine) {
        try {
            $langEn = [Windows.Globalization.Language]::new('en-US')
            $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($langEn)
        } catch { }
    }

    $result = Await ($engine.RecognizeAsync($softBmp)) ([Windows.Media.Ocr.OcrResult])
    if ($result -and $result.Lines) {
        $lines = @($result.Lines)
        $fullText = ""
        for ($i = 0; $i -lt $lines.Count; $i++) {
            $line = $lines[$i]
            $fullText += $line.Text
            if ($i -lt ($lines.Count - 1)) {
                try {
                    $nextLine = $lines[$i+1]
                    # Robust coordinate access: Cast to double to ensure safe math
                    $lineRect = $line.Rect
                    $nextRect = $nextLine.Rect
                    $gap = [double]$nextRect.Y - ([double]$lineRect.Y + [double]$lineRect.Height)
                    $avgHeight = ([double]$lineRect.Height + [double]$nextRect.Height) / 2
                    
                    if ($gap -gt ($avgHeight * 0.7)) {
                        $fullText += "`r`n`r`n"
                    } else {
                        $fullText += "`r`n"
                    }
                } catch {
                    # Fallback if coordinate math fails
                    $fullText += "`r`n"
                }
            }
        }
        # Bulletproof: Encode output as Base64 to bypass all console encoding issues
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($fullText)
        $b64 = [System.Convert]::ToBase64String($bytes)
        Write-Output "B64:$b64"
    }
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
"#;

        let img_path_env = temp_image_str.clone();
        let ocr_res = tauri::async_runtime::spawn_blocking(move || {
            #[allow(unused_mut)]
            let mut cmd = Command::new("powershell");
            cmd.arg("-NoProfile")
                .arg("-NonInteractive")
                .arg("-WindowStyle")
                .arg("Hidden")
                .arg("-Command")
                .arg(combined_ps)
                .env("CAP_X", sx.to_string())
                .env("CAP_Y", sy.to_string())
                .env("CAP_W", sw.to_string())
                .env("CAP_H", sh.to_string())
                .env("OCR_IMG_PATH", &img_path_env);
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
            }
            cmd.output()
        })
        .await
        .map_err(|e| {
            if let Some(w) = app_handle.get_webview_window("ocr-island") {
                let _ = w.close();
            }
            if was_visible {
                let _ = window.unminimize();
                let _ = window.show();
            }
            e.to_string()
        })?;

        // Close "Copiando texto..." island and restore main window
        if let Some(w) = app_handle.get_webview_window("ocr-island") {
            let _ = w.close();
        }
        let _ = app_handle.emit("ocr-end", ());
        if was_visible {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }

        match ocr_res {
            Ok(out) => {
                let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
                let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();

                if !out.status.success() {
                    Err(format!(
                        "OCR error: {}",
                        if !stderr.is_empty() {
                            stderr
                        } else {
                            "Unknown PowerShell error".to_string()
                        }
                    ))
                } else if stdout.starts_with("B64:") {
                    let b64_part = stdout[4..].trim();
                    use base64::{engine::general_purpose, Engine as _};
                    match general_purpose::STANDARD.decode(b64_part) {
                        Ok(bytes) => {
                            let text = String::from_utf8_lossy(&bytes).to_string();
                            Ok(fix_ocr_spanish_accents(text))
                        }
                        Err(_) => Ok(stdout), // fallback
                    }
                } else {
                    Ok(stdout)
                }
            }
            Err(e) => Err(format!("Failed to run Combined OCR: {}", e)),
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Err("OCR is only supported on macOS and Windows".to_string())
    }
}

#[tauri::command]
async fn write_to_clipboard(text: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use std::io::Write;
        use std::process::{Command, Stdio};

        // Using Swift to set the clipboard is more robust for Unicode than pbcopy,
        // which sometimes misinterprets UTF-8 as MacRoman depending on the environment.
        let swift_script = r#"
            import Cocoa
            import Foundation

            let pasteboard = NSPasteboard.general
            let data = FileHandle.standardInput.readDataToEndOfFile()
            if let text = String(data: data, encoding: .utf8) {
                pasteboard.clearContents()
                pasteboard.setString(text, forType: .string)
            } else {
                exit(1)
            }
        "#;

        let mut child = Command::new("swift")
            .arg("-e")
            .arg(swift_script)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to start swift for clipboard: {}", e))?;

        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(text.as_bytes())
                .map_err(|e| format!("Failed to write to swift stdin: {}", e))?;
        }

        let output = child
            .wait_with_output()
            .map_err(|e| format!("Failed to wait for swift: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Swift clipboard script failed: {}", stderr));
        }
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        use arboard::Clipboard;
        let mut clipboard =
            Clipboard::new().map_err(|e| format!("Failed to access clipboard: {}", e))?;
        clipboard
            .set_text(text)
            .map_err(|e| format!("Failed to set clipboard text: {}", e))?;
        Ok(())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Err("Not supported on this OS".to_string())
    }
}

fn notify_user<R: tauri::Runtime>(app: &tauri::AppHandle<R>, _title: &str, message: &str) {
    if let Some(window) = app.get_webview_window("main") {
        // 1. Ensure main window is visible
        #[cfg(target_os = "windows")]
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();

        // 2. Emit the event to the frontend (App.tsx)
        // Frontend will handle opening and auto-closing with animation
        let _ = window.emit(
            "show-toast",
            serde_json::json!({ "title": _title, "message": message }),
        );
    }
}

#[tauri::command]
fn test_toast(app: tauri::AppHandle) {
    notify_user(&app, "Test Toast", "Esta es una notificación de prueba");
}

#[tauri::command]
async fn convert_pdf_to_word(
    app_handle: tauri::AppHandle,
    window: tauri::WebviewWindow,
    pdf_path: String,
) -> Result<String, String> {
    use std::path::Path;
    use std::process::Command;
    use tauri::Manager;

    let emit_progress = |step: &str, progress: f32| {
        let _ = window.emit(
            "pdf-progress",
            serde_json::json!({ "step": step, "progress": progress }),
        );
    };

    // ── Resolve Downloads folder (shared by both platforms) ─────────────────
    let downloads_dir = app_handle
        .path()
        .download_dir()
        .map_err(|e| format!("Could not find Downloads directory: {}", e))?;

    let pdf_path_obj = Path::new(&pdf_path);
    if !pdf_path_obj.exists() {
        return Err("Selected PDF file does not exist locally.".to_string());
    }

    let file_name = pdf_path_obj
        .file_stem()
        .ok_or("Invalid file name")?
        .to_string_lossy();
    let output_path = downloads_dir.join(format!("{}.docx", file_name));
    let output_str = output_path.to_string_lossy().to_string();

    // ── macOS: Microsoft Word Automation ─────────────────────────────────────
    #[cfg(target_os = "macos")]
    {
        emit_progress("Iniciando Word...", 0.2);

        let word_check = Command::new("mdfind")
            .arg("kMDItemCFBundleIdentifier == 'com.microsoft.Word'")
            .output();

        let word_installed = match word_check {
            Ok(output) => String::from_utf8_lossy(&output.stdout).trim().len() > 0,
            Err(_) => false,
        };

        if !word_installed {
            return Err(
                "Microsoft Word no está instalado. Instala MS Office para usar la conversión."
                    .to_string(),
            );
        }

        emit_progress("Guardando diseño original...", 0.6);

        let applescript = format!(
            r#"
tell application "Microsoft Word"
    try
        set display alerts to none
    end try
    try
        open POSIX file "{}"
        
        save as active document file name POSIX file "{}" file format format document
        close active document saving no
        try
            set display alerts to all
        end try
        return "SUCCESS"
    on error errMsg
        try
            set display alerts to all
        end try
        try
            close active document saving no
        end try
        return "ERROR:" & errMsg
    end try
end tell"#,
            pdf_path, output_str
        );

        let as_output = tauri::async_runtime::spawn_blocking(move || {
            Command::new("osascript")
                .arg("-e")
                .arg(&applescript)
                .output()
        })
        .await
        .map_err(|e| e.to_string())?;

        if let Ok(out) = as_output {
            let as_stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if out.status.success() && as_stdout.contains("SUCCESS") {
                emit_progress("Terminado", 1.0);
                return Ok(output_str);
            } else {
                return Err(format!("Word falló: {}", as_stdout));
            }
        }

        return Err("Error de AppleScript.".to_string());
    }

    // ── Windows: Microsoft Word COM automation (no Python needed) ───────────
    #[cfg(target_os = "windows")]
    {
        emit_progress("Opening PDF with Microsoft Word...", 0.3);

        // PowerShell script using Word COM object — Word opens the PDF and saves as .docx
        let ps_script = r#"
$ErrorActionPreference = 'Stop'
$pdfPath  = $env:PDF_IN
$docxPath = $env:DOCX_OUT

try {
    $word = New-Object -ComObject Word.Application
} catch {
    Write-Output "ERROR:Microsoft Word is not installed. Please install Microsoft Office to use PDF conversion."
    exit 1
}

$word.Visible = $false
$word.DisplayAlerts = 0

try {
    # wdFormatXMLDocument = 12 (docx)
    $doc = $word.Documents.Open($pdfPath, $false, $true)   # ReadOnly=$true to open PDF
    $doc.SaveAs([ref]$docxPath, [ref]12)
    $doc.Close($false)
    $word.Quit()
    Write-Output "SUCCESS"
} catch {
    try { $word.Quit() } catch {}
    Write-Output "ERROR:$($_.Exception.Message)"
    exit 1
}
"#;

        let pdf_in = pdf_path.clone();
        let docx_out = output_str.clone();

        let result = tauri::async_runtime::spawn_blocking(move || {
            #[allow(unused_mut)]
            let mut cmd = Command::new("powershell");
            cmd.arg("-NoProfile")
                .arg("-NonInteractive")
                .arg("-WindowStyle")
                .arg("Hidden")
                .arg("-Command")
                .arg(ps_script)
                .env("PDF_IN", &pdf_in)
                .env("DOCX_OUT", &docx_out);
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
            }
            cmd.output()
        })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("Failed to launch Word: {}", e))?;

        emit_progress("Finishing...", 0.9);

        let stdout = String::from_utf8_lossy(&result.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&result.stderr).trim().to_string();

        if stdout.starts_with("ERROR:") {
            return Err(stdout.trim_start_matches("ERROR:").to_string());
        }
        if !result.status.success() || !stdout.contains("SUCCESS") {
            let detail = if !stderr.is_empty() { stderr } else { stdout };
            return Err(format!("Error converting PDF: {}", detail));
        }

        emit_progress("Done!", 1.0);
        return Ok(output_str);
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    Err("PDF conversion not supported on this OS".to_string())
}

#[tauri::command]
async fn read_pdf_file(path: String) -> Result<Vec<u8>, String> {
    use std::fs;
    fs::read(&path).map_err(|e| format!("Failed to read PDF: {}", e))
}

#[tauri::command]
async fn save_pdf_file(path: String, bytes: Vec<u8>) -> Result<(), String> {
    use std::fs;
    fs::write(&path, bytes).map_err(|e| format!("Failed to save PDF: {}", e))?;
    Ok(())
}

/// Called by the Tauri capture overlay (capture.tsx) when the user releases the mouse.
/// Closes the overlay window and unblocks extract_text_from_screen with the selected region.
#[tauri::command]
async fn finalize_capture(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
    x: i32,
    y: i32,
    w: i32,
    h: i32,
) -> Result<(), String> {
    // Close the overlay window first so it doesn't appear in the screenshot
    if let Some(win) = app_handle.get_webview_window("capture") {
        let _ = win.close();
    }
    // Small delay so the window is fully gone before we capture
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    // Unblock the waiting OCR task
    let mut tx_lock = state.capture_tx.lock().await;
    if let Some(tx) = tx_lock.take() {
        let _ = tx.send(Some((x, y, w, h)));
    }
    Ok(())
}

/// Called by the Tauri capture overlay when the user presses Escape.
#[tauri::command]
async fn cancel_capture(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if let Some(win) = app_handle.get_webview_window("capture") {
        let _ = win.close();
    }
    let mut tx_lock = state.capture_tx.lock().await;
    if let Some(tx) = tx_lock.take() {
        let _ = tx.send(None); // None = cancelled
    }
    Ok(())
}

#[tauri::command]
async fn process_screenshot_ocr(window: tauri::WebviewWindow) -> Result<(), String> {
    let app_handle = window.app_handle().clone();
    match extract_text_from_screen(window).await {
        Ok(text) => {
            if text.trim().is_empty() {
                notify_user(&app_handle, "OCR", "No text found in selection.");
                return Ok(());
            }

            // Copy to clipboard
            if let Err(e) = write_to_clipboard(text.clone()).await {
                notify_user(&app_handle, "OCR Error", &format!("Failed to copy: {}", e));
                return Err(e);
            }

            // Success Notification
            notify_user(&app_handle, "Text Copied!", "Copied content");
            Ok(())
        }
        Err(e) => {
            notify_user(&app_handle, "OCR Failed", &e);
            Err(e)
        }
    }
}

#[tauri::command]
async fn set_dialog_open(state: State<'_, AppState>, open: bool) -> Result<(), String> {
    if let Ok(mut dialog_open) = state.is_dialog_open.lock() {
        *dialog_open = open;
    }
    Ok(())
}

#[tauri::command]
async fn hide_window(window: tauri::WebviewWindow) {
    // On macOS: truly hide the window (it's accessed via the menu bar icon)
    // On Windows: minimize instead — otherwise it disappears from the taskbar
    #[cfg(target_os = "macos")]
    {
        let _ = window.hide();
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window.minimize();
    }
}

fn spawn_key_listener(app_handle: tauri::AppHandle) {
    std::thread::spawn(move || {
        let device_state = DeviceState::new();
        let mut last_tap = Instant::now();
        let mut tap_count = 0;
        let mut ctrl_was_pressed = false;

        loop {
            let keys = device_state.get_keys();
            let ctrl_is_pressed =
                keys.contains(&Keycode::LControl) || keys.contains(&Keycode::RControl);

            // Detect Edge (Press)
            if ctrl_is_pressed && !ctrl_was_pressed {
                let now = Instant::now();
                if now.duration_since(last_tap) < Duration::from_millis(500) {
                    tap_count += 1;
                } else {
                    tap_count = 1;
                }
                last_tap = now;

                if tap_count == 3 {
                    tap_count = 0; // reset
                    let handle = app_handle.clone();

                    // Guard: clone the Arc so we own it independently of the handle lifetime
                    let cap_flag = {
                        let state = app_handle.state::<AppState>();
                        Arc::clone(&state.is_capturing)
                    };

                    let already_capturing = match cap_flag.lock() {
                        Ok(mut cap) => {
                            if *cap {
                                true
                            } else {
                                *cap = true;
                                false
                            }
                        }
                        Err(_) => true,
                    };

                    if !already_capturing {
                        let cap_flag2 = Arc::clone(&cap_flag);
                        tauri::async_runtime::spawn(async move {
                            if let Some(window) = handle.get_webview_window("main") {
                                let _ = process_screenshot_ocr(window.clone()).await;
                            }
                            // Release the guard
                            if let Ok(mut cap) = cap_flag2.lock() {
                                *cap = false;
                            }
                        });
                    }
                }
            }

            ctrl_was_pressed = ctrl_is_pressed;
            std::thread::sleep(Duration::from_millis(20)); // Polling interval
        }
    });
}

#[tauri::command]
async fn resize_window(
    window: tauri::Window,
    width: f64,
    height: f64,
    center: bool,
) -> Result<(), String> {
    let _ = window.set_resizable(true);
    let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(width, height)));
    if center {
        let _ = window.center();
    }
    Ok(())
}

#[tauri::command]
async fn restore_window(window: tauri::Window, state: State<'_, AppState>) -> Result<(), String> {
    let _ = window.set_resizable(false);
    let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(360.0, 580.0)));
    let pos_lock = state.last_tray_pos.lock().await;
    if let Some(pos) = *pos_lock {
        let _ = window.set_position(tauri::Position::Physical(pos));
    }
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            hide_window,
            is_mouse_moving,
            toggle_mouse,
            schedule_whatsapp,
            get_contacts,
            open_contact_settings,
            open_accessibility_settings,
            check_accessibility,
            request_accessibility,
            start_window_drag,
            repair_permissions,
            toggle_paint_mode,
            set_ignore_cursor_events,
            close_all_apps,
            close_leisure_apps,
            close_heavy_apps,
            open_focus_settings,
            schedule_shutdown,
            cancel_shutdown,
            get_shutdown_time,
            extract_text_from_screen,
            write_to_clipboard,
            restart_app,
            process_screenshot_ocr,
            convert_pdf_to_word,
            read_pdf_file,
            save_pdf_file,
            set_dialog_open,
            process_image,
            test_toast,
            finalize_capture,
            cancel_capture,
            resize_window,
            restore_window
        ])
        .setup(|app| {
            let config: AppConfig = confy::load("mouse-crazy-app", None).unwrap_or_default();
            app.manage(AppState {
                mouse_moving: std::sync::Mutex::new(false),
                is_paint_mode: std::sync::Mutex::new(false),
                is_dialog_open: std::sync::Mutex::new(false),
                is_capturing: Arc::new(std::sync::Mutex::new(false)),
                capture_tx: tokio::sync::Mutex::new(None),
                shutdown_cancel_tx: tokio::sync::Mutex::new(None),
                shutdown_target: tokio::sync::Mutex::new(None),
                shutdown_duration: tokio::sync::Mutex::new(None),
                last_tray_pos: tokio::sync::Mutex::new(
                    config
                        .last_x
                        .and_then(|x| config.last_y.map(|y| tauri::PhysicalPosition::new(x, y))),
                ),
            });

            // Start global key listener for Triple-Tap Control
            spawn_key_listener(app.handle().clone());

            // Explicitly request notification permissions on startup
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                use tauri_plugin_notification::NotificationExt;
                let _ = handle.notification().request_permission();
            });
            // --- Initial Window Positioning ---
            if let Some(window) = app.get_webview_window("main") {
                let window_clone = window.clone();
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let state = handle.state::<AppState>();
                    let initial_pos = {
                        let lock = state.last_tray_pos.lock().await;
                        *lock
                    };

                    if let Some(pos) = initial_pos {
                        let _ = window_clone.set_position(pos);
                    } else if let Ok(Some(monitor)) = window_clone.current_monitor() {
                        let monitor_size = monitor.size();
                        let scale_factor = monitor.scale_factor();

                        // Default to top-right corner if no tray pos yet
                        let sidebar_width_logical = 360.0;
                        let sidebar_width_physical = (sidebar_width_logical * scale_factor) as i32;

                        let x = monitor_size.width as i32 - sidebar_width_physical - 20; // 20px padding from right
                        let pos = tauri::PhysicalPosition::new(x, 30); // 30px from top

                        let _ = window_clone.set_position(pos);
                    }
                    // Explicitly show and focus after positioning to avoid the "jump"
                    let _ = window_clone.show();
                    let _ = window_clone.set_focus();
                });
            }
            // ------------------------------------

            let toggle_i = MenuItem::<Wry>::with_id(
                app.handle(),
                "toggle",
                "Start Moving Mouse",
                true,
                None::<&str>,
            )?;
            let quit_i =
                MenuItem::<Wry>::with_id(app.handle(), "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::<Wry>::with_items(app.handle(), &[&toggle_i, &quit_i])?;

            let toggle_item_clone = toggle_i.clone();

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "quit" => {
                        std::process::exit(0);
                    }
                    "toggle" => {
                        let app_handle = app.clone();
                        let toggle_item = toggle_item_clone.clone();
                        tauri::async_runtime::spawn(async move {
                            if let Ok(mut moving) =
                                app_handle.state::<AppState>().mouse_moving.lock()
                            {
                                *moving = !*moving;
                                if *moving {
                                    let _ = toggle_item.set_text("Stop Moving Mouse");
                                } else {
                                    let _ = toggle_item.set_text("Start Moving Mouse");
                                }
                            }
                        });
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| match event {
                    TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        position,
                        ..
                    } => {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let app_handle = tray.app_handle().clone();
                            let window_clone = window.clone();
                            let position = position.clone();

                            tauri::async_runtime::spawn(async move {
                                let state = app_handle.state::<AppState>();
                                let is_paint = {
                                    *state
                                        .is_paint_mode
                                        .lock()
                                        .unwrap_or_else(|e| e.into_inner())
                                };

                                if is_paint {
                                    // In special modes, we NEVER hide. We just show/focus which triggers App.tsx listener
                                    let _ = window_clone.set_ignore_cursor_events(false);
                                    let _ = window_clone.show();
                                    let _ = window_clone.set_focus();
                                    let _ = window_clone.emit("open-sidebar", ());
                                } else {
                                    #[cfg(target_os = "macos")]
                                    {
                                        let is_visible = window_clone.is_visible().unwrap_or(false);
                                        if is_visible {
                                            let _ = window_clone.hide();
                                            return;
                                        }
                                    }

                                    // For Windows OR macOS when hidden: centering/repositioning logic
                                    if let Ok(Some(monitor)) = window_clone.current_monitor() {
                                        let scale_factor = monitor.scale_factor();
                                        let sidebar_width_physical = (360.0 * scale_factor) as i32;

                                        let x = (position.x as i32) - (sidebar_width_physical / 2);
                                        let pos = tauri::PhysicalPosition::new(x, 30);
                                        {
                                            let mut last_pos = state.last_tray_pos.lock().await;
                                            *last_pos = Some(pos);
                                        }
                                        // Persist to disk
                                        let _ = confy::store(
                                            "mouse-crazy-app",
                                            None,
                                            AppConfig {
                                                last_x: Some(pos.x),
                                                last_y: Some(pos.y),
                                            },
                                        );
                                        let _ = window_clone.set_position(pos);
                                    }
                                    let _ = window_clone.show();
                                    let _ = window_clone.set_focus();
                                }
                            });
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            // Auto-hide the main window when it loses focus, UNLESS we are in pet mode
            if let Some(window) = app.get_webview_window("main") {
                let window_clone = window.clone();
                let app_handle = app.handle().clone();
                window.on_window_event(move |event| match event {
                    tauri::WindowEvent::Moved(pos) => {
                        let app_handle = app_handle.clone();
                        let p = *pos;
                        let w = window_clone.clone();
                        tauri::async_runtime::spawn(async move {
                            // Only save position if window is in standard sidebar size (approximate check to allow for small deviations)
                            if let Ok(size) = w.outer_size() {
                                if let Ok(Some(monitor)) = w.current_monitor() {
                                    let scale = monitor.scale_factor();
                                    let expected_width = (360.0 * scale) as u32;
                                    let expected_height = (580.0 * scale) as u32;

                                    // Allow some tolerance for decorations/rounding
                                    let is_standard_size =
                                        (size.width as i32 - expected_width as i32).abs() < 50
                                            && (size.height as i32 - expected_height as i32).abs()
                                                < 50;

                                    if is_standard_size {
                                        let state = app_handle.state::<AppState>();
                                        let mut last_pos = state.last_tray_pos.lock().await;
                                        *last_pos = Some(p);
                                        let _ = confy::store(
                                            "mouse-crazy-app",
                                            None,
                                            AppConfig {
                                                last_x: Some(p.x),
                                                last_y: Some(p.y),
                                            },
                                        );
                                    }
                                }
                            }
                        });
                    }
                    tauri::WindowEvent::Focused(focused) => {
                        if !focused {
                            let state = app_handle.state::<AppState>();
                            let is_paint_mode = *state
                                .is_paint_mode
                                .lock()
                                .unwrap_or_else(|e| e.into_inner());
                            let is_dialog_open = *state
                                .is_dialog_open
                                .lock()
                                .unwrap_or_else(|e| e.into_inner());

                            if !is_paint_mode && !is_dialog_open {
                                // On Windows: don't auto-hide (would remove from taskbar).
                                // On macOS: hide normally.
                                #[cfg(target_os = "macos")]
                                {
                                    let _ = window_clone.hide();
                                }
                                #[cfg(not(target_os = "macos"))]
                                let _ = window_clone; // noop — keep window visible on Windows
                            }
                        }
                    }
                    _ => {}
                });
            }

            let app_handle = app.handle().clone();
            // Use a real OS thread for Enigo (it is !Send on Windows, so async tasks fail)
            std::thread::spawn(move || {
                // Retry initialization if it fails (Windows sometimes needs a moment)
                let mut enigo_opt = None;
                for _ in 0..5 {
                    if let Ok(e) = Enigo::new(&Settings::default()) {
                        enigo_opt = Some(e);
                        break;
                    }
                    std::thread::sleep(Duration::from_secs(1));
                }

                let mut enigo = match enigo_opt {
                    Some(e) => e,
                    None => return, // Silently exit if still fails after retries
                };

                let mut offset: i32 = 1; // 1px diagonal is enough to keep awake without interrupting use
                loop {
                    std::thread::sleep(Duration::from_millis(2000)); // 2 second interval is plenty keep-awake
                    let state = app_handle.state::<AppState>();
                    let moving = if let Ok(lock) = state.mouse_moving.lock() {
                        *lock
                    } else {
                        false
                    };

                    if moving {
                        // Diagonal movement is more robust, but just 1px
                        let _ = enigo.move_mouse(offset, offset, enigo::Coordinate::Rel);
                        offset = -offset;
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
