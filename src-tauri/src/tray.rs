use crate::commands::{keep_awake, power_timer};
use crate::state::{AppState, KeepAwakeMode, PowerAction};
use tauri::async_runtime::Mutex;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::Manager;
use tauri_plugin_notification::NotificationExt;

pub struct TrayIconHandle(pub Mutex<Option<TrayIcon>>);

pub fn setup_tray(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let icon = app
        .default_window_icon()
        .cloned()
        .expect("default window icon should be set from bundle icons");

    let menu = Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "toggle_awake", "Toggle Keep Awake", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "timer_5", "Shutdown in 5 min", true, None::<&str>)?,
            &MenuItem::with_id(app, "timer_30", "Sleep in 30 min", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "open", "Open", true, None::<&str>)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;

    let tray = TrayIconBuilder::new()
        .icon(icon)
        .tooltip("Awake & Power Timer")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            match event.id().as_ref() {
                "toggle_awake" => toggle_keep_awake(app),
                "timer_5" => quick_timer(app, PowerAction::Shutdown, 5 * 60),
                "timer_30" => quick_timer(app, PowerAction::Sleep, 30 * 60),
                "open" => {
                    let _ = show_window(app);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let _ = show_window(tray.app_handle());
            }
        })
        .build(app)?;

    app.manage(TrayIconHandle(Mutex::new(Some(tray))));
    Ok(())
}

pub fn toggle_keep_awake(app: &tauri::AppHandle) {
    let state = app.state::<AppState>().inner().clone();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let status = keep_awake::get_keep_awake_status_inner(&state).await;
        if status.active {
            let _ = keep_awake::stop_keep_awake_inner(app.clone(), &state).await;
        } else {
            let _ = keep_awake::start_keep_awake_inner(app.clone(), &state, KeepAwakeMode::Both, 0)
                .await;
        }
        update_tray_tooltip(&app, !status.active).await;
    });
}

pub fn quick_timer(app: &tauri::AppHandle, action: PowerAction, seconds: u64) {
    let state = app.state::<AppState>().inner().clone();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = power_timer::start_power_timer_inner(app, &state, action, seconds).await;
    });
}

async fn update_tray_tooltip(app: &tauri::AppHandle, active: bool) {
    let handle = app.state::<TrayIconHandle>();
    let status = handle.0.lock().await;
    if let Some(tray) = status.as_ref() {
        let tooltip = if active {
            "Awake & Power Timer (keep awake active)"
        } else {
            "Awake & Power Timer"
        };
        let _ = tray.set_tooltip(Some(tooltip));
    }
}

pub fn show_window(app: &tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn _notify(app: &tauri::AppHandle, title: &str, body: &str) {
    let _ = app
        .notification()
        .builder()
        .title(title)
        .body(body)
        .show();
}
