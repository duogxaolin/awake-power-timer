pub mod commands;
pub mod state;
pub mod tray;

use state::AppState;
use tauri::Manager;
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_notification::NotificationExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "macos")]
    let shortcut = "Cmd+Shift+A";
    #[cfg(not(target_os = "macos"))]
    let shortcut = "Ctrl+Shift+A";

    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        tray::toggle_keep_awake(app);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_log::Builder::new().build())
        .manage(AppState::default())
        .setup(move |app| {
            if let Err(e) = app.notification().request_permission() {
                eprintln!("notification permission request failed: {e}");
            }
            let state = app.state::<AppState>().inner().clone();
            let app_handle = app.app_handle().clone();
            tauri::async_runtime::block_on(async move {
                if let Err(e) = commands::settings::load_notifications_from_store(&app_handle, &state).await {
                    eprintln!("failed to load notifications setting: {e}");
                }
            });
            tray::setup_tray(app)?;
            app.global_shortcut().register(shortcut)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::keep_awake::start_keep_awake,
            commands::keep_awake::stop_keep_awake,
            commands::keep_awake::get_keep_awake_status,
            commands::power_timer::start_power_timer,
            commands::power_timer::cancel_power_timer,
            commands::power_timer::get_power_timer_status,
            commands::settings::get_settings,
            commands::settings::set_notifications_enabled,
            commands::system_monitor::get_system_stats,
            set_autostart,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
async fn set_autostart(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    if enabled {
        app.autolaunch().enable().map_err(|e| e.to_string())
    } else {
        app.autolaunch().disable().map_err(|e| e.to_string())
    }
}
