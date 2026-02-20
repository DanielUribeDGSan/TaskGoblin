use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState},
    Manager, Wry, State
};
use tokio::sync::Mutex;
use enigo::{Enigo, Mouse, Settings};

struct AppState {
    mouse_moving: Mutex<bool>,
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
    let sanitized_phone = phone.chars().filter(|c| c.is_digit(10) || *c == '+').collect::<String>();
    
    println!("Scheduled WhatsApp to {} in {} seconds", sanitized_phone, delay_secs);
    
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_secs(delay_secs)).await;
        
        // Open the native WhatsApp app pointing to the specific chat
        let url = format!("whatsapp://send?phone={}&text={}", sanitized_phone, urlencoding::encode(&message));
        let _ = std::process::Command::new("open")
            .arg(&url)
            .spawn();
            
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
            Command::new("osascript")
                .arg("-e")
                .arg(script)
                .output()
        }).await.map_err(|e| e.to_string())?;

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

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            is_mouse_moving, 
            toggle_mouse, 
            schedule_whatsapp, 
            get_contacts,
            open_contact_settings
        ])
        .setup(|app| {
            app.manage(AppState {
                mouse_moving: Mutex::new(false),
            });

            let toggle_i = MenuItem::<Wry>::with_id(app, "toggle", "Start Moving Mouse", true, None::<&str>)?;
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
                                    let _ = window.set_position(tauri::PhysicalPosition::new(x, 30));
                                }
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            // Auto-hide the main window when it loses focus
            if let Some(window) = app.get_webview_window("main") {
                let window_clone = window.clone();
                window.on_window_event(move |event| match event {
                    tauri::WindowEvent::Focused(false) => {
                        let _ = window_clone.hide();
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
