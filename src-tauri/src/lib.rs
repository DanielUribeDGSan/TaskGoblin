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
    println!("Scheduled WhatsApp to {} in {} seconds", phone, delay_secs);
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_secs(delay_secs)).await;
        
        // Open the native WhatsApp app pointing to the specific chat with pre-filled text
        let url = format!("whatsapp://send?phone={}&text={}", phone, urlencoding::encode(&message));
        let _ = std::process::Command::new("open")
            .arg(&url)
            .spawn();
            
        // Wait 3 seconds for WhatsApp to load and focus
        tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
        
        // Use AppleScript to simulate pressing the Return key to send the message
        let script = r#"
            tell application "System Events"
                keystroke return
            end tell
        "#;
        let _ = std::process::Command::new("osascript")
            .arg("-e")
            .arg(script)
            .spawn();
    });
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![is_mouse_moving, toggle_mouse, schedule_whatsapp])
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
