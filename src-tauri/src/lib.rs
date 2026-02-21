use device_query::{DeviceQuery, DeviceState, Keycode};
use enigo::{Enigo, Mouse, Settings};
use std::time::{Duration, Instant};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, State, Wry,
};
use tokio::sync::Mutex;

struct AppState {
    mouse_moving: Mutex<bool>,
    is_pet_mode: Mutex<bool>,
}

#[tauri::command]
async fn is_mouse_moving(state: State<'_, AppState>) -> Result<bool, String> {
    let moving = *state.mouse_moving.lock().await;
    Ok(moving)
}

#[tauri::command]
async fn toggle_mouse(state: State<'_, AppState>) -> Result<bool, String> {
    let mut moving = state.mouse_moving.lock().await;
    *moving = !*moving;
    // We update the tray label in the actual tray menu event if toggled there.
    // Toggling from UI just returns the bool.
    Ok(*moving)
}

#[tauri::command]
async fn schedule_whatsapp(phone: String, message: String, delay_secs: u64) -> Result<(), String> {
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

        // Open the native WhatsApp app pointing to the specific chat
        let url = format!(
            "whatsapp://send?phone={}&text={}",
            sanitized_phone,
            urlencoding::encode(&message)
        );
        let _ = std::process::Command::new("open").arg(&url).spawn();

        // Wait for WhatsApp to load and focus - increased delay for reliability
        tokio::time::sleep(tokio::time::Duration::from_secs(4)).await;

        // Use AppleScript to focus WhatsApp and press return twice to ensure sending
        let script = r#"
            tell application "System Events"
                tell process "WhatsApp"
                    set frontmost to true
                    key code 36 -- Return
                    delay 0.5
                    key code 36 -- Return again to ensure send if stuck in draft
                end tell
            end tell
        "#;

        let _ = std::process::Command::new("osascript")
            .arg("-e")
            .arg(script)
            .output(); // Use output to wait for completion
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
fn set_ignore_cursor_events(window: tauri::Window, ignore: bool) -> Result<(), String> {
    let _ = window.set_ignore_cursor_events(ignore);
    Ok(())
}

#[tauri::command]
async fn toggle_pet_mode(
    window: tauri::Window,
    active: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    {
        let mut pet_mode = state.is_pet_mode.lock().await;
        *pet_mode = active;
    }

    #[cfg(target_os = "macos")]
    {
        if active {
            // Make full screen and ignore mouse
            let _ = window.set_resizable(true);
            let _ = window.maximize();
            let _ = window.set_always_on_top(true);
            let _ = window.set_ignore_cursor_events(true);
        } else {
            // Restore sidebar size
            let _ = window.set_ignore_cursor_events(false);
            let _ = window.unmaximize();
            let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
                width: 440.0,
                height: 820.0,
            }));
            let _ = window.set_resizable(false);
            let _ = window.set_always_on_top(false);
        }
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Pet mode not supported on this OS".to_string())
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
    #[cfg(not(target_os = "macos"))]
    {
        Err("Not supported on this OS".to_string())
    }
}

#[tauri::command]
async fn extract_text_from_screen(window: tauri::WebviewWindow) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        use std::fs;
        use std::process::Command;

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
            Ok(_) => {
                // If user pressed Escape to cancel, the file might not exist
                if !std::path::Path::new(temp_image_path).exists() {
                    return Ok("".to_string()); // Cancelled capture
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
                        print("ERROR: Failed to load image")
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
                        if stdout.starts_with("ERROR:") {
                            Err(stdout)
                        } else {
                            Ok(stdout)
                        }
                    }
                    Err(e) => Err(format!("OCR extraction failed: {}", e)),
                }
            }
            Err(e) => Err(format!("Screencapture failed: {}", e)),
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("OCR is only supported on macOS".to_string())
    }
}

#[tauri::command]
async fn write_to_clipboard(text: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use std::io::Write;
        use std::process::{Command, Stdio};

        let mut child = Command::new("pbcopy")
            .stdin(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to start pbcopy: {}", e))?;

        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(text.as_bytes())
                .map_err(|e| format!("Failed to write to pbcopy stdin: {}", e))?;
        }

        let _ = child
            .wait()
            .map_err(|e| format!("Failed to wait for pbcopy: {}", e))?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Not supported on this OS".to_string())
    }
}

fn notify_user<R: tauri::Runtime>(app: &tauri::AppHandle<R>, _title: &str, message: &str) {
    if let Some(window) = app.get_webview_window("main") {
        // 1. Ensure main window is visible
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
async fn process_screenshot_ocr(window: tauri::WebviewWindow) -> Result<(), String> {
    let app_handle = window.app_handle().clone();
    match extract_text_from_screen(window).await {
        Ok(text) => {
            if text.trim().is_empty() {
                // User cancelled or no text found - do nothing silent
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
async fn hide_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())
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
                    tauri::async_runtime::spawn(async move {
                        if let Some(window) = handle.get_webview_window("main") {
                            // Trigger the unified screenshot process
                            let _ = process_screenshot_ocr(window).await;
                        }
                    });
                }
            }

            ctrl_was_pressed = ctrl_is_pressed;
            std::thread::sleep(Duration::from_millis(20)); // Polling interval
        }
    });
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
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
            toggle_pet_mode,
            set_ignore_cursor_events,
            close_all_apps,
            extract_text_from_screen,
            write_to_clipboard,
            process_screenshot_ocr,
            test_toast
        ])
        .setup(|app| {
            app.manage(AppState {
                mouse_moving: Mutex::new(false),
                is_pet_mode: Mutex::new(false),
            });

            // Start global key listener for Triple-Tap Control
            spawn_key_listener(app.handle().clone());

            // Explicitly request notification permissions on startup
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                use tauri_plugin_notification::NotificationExt;
                let _ = handle.notification().request_permission();
            });

            let toggle_i =
                MenuItem::<Wry>::with_id(app, "toggle", "Start Moving Mouse", true, None::<&str>)?;
            let quit_i = MenuItem::<Wry>::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::<Wry>::with_items(app, &[&toggle_i, &quit_i])?;

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
                            let state = app_handle.state::<AppState>();
                            let mut moving = state.mouse_moving.lock().await;
                            *moving = !*moving;

                            if *moving {
                                let _ = toggle_item.set_text("Stop Moving Mouse");
                            } else {
                                let _ = toggle_item.set_text("Start Moving Mouse");
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
                            let is_visible = window.is_visible().unwrap_or(false);
                            if is_visible {
                                let _ = window.hide();
                            } else {
                                if let Ok(size) = window.outer_size() {
                                    let x = (position.x as i32) - (size.width as i32 / 2);
                                    let _ =
                                        window.set_position(tauri::PhysicalPosition::new(x, 30));
                                }
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
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
                    tauri::WindowEvent::Focused(focused) => {
                        if !focused {
                            let state = app_handle.state::<AppState>();
                            let is_pet_mode = tauri::async_runtime::block_on(async {
                                *state.is_pet_mode.lock().await
                            });

                            if !is_pet_mode {
                                let _ = window_clone.hide();
                            }
                        }
                    }
                    _ => {}
                });
            }

            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut enigo = Enigo::new(&Settings::default()).unwrap();
                let mut direction = 1;
                loop {
                    tokio::time::sleep(Duration::from_millis(50)).await;
                    let state = app_handle.state::<AppState>();
                    let moving = {
                        let lock = state.mouse_moving.lock().await;
                        *lock
                    };

                    if moving {
                        let _ = enigo.move_mouse(direction, 0, enigo::Coordinate::Rel);
                        direction = -direction;
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
