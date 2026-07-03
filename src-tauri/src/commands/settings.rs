use crate::state::AppState;
use tauri::{AppHandle, State};

#[derive(Debug, serde::Serialize)]
pub struct Settings {
    pub notifications_enabled: bool,
}

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<Settings, String> {
    Ok(Settings {
        notifications_enabled: state.notifications_enabled().await,
    })
}

#[tauri::command]
pub async fn set_notifications_enabled(
    app: AppHandle,
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<(), String> {
    state.set_notifications_enabled(enabled).await;
    save_notifications_to_store(&app, enabled).await
}

pub async fn load_notifications_from_store(app: &AppHandle, state: &AppState) -> Result<(), String> {
    let store = tauri_plugin_store::StoreBuilder::new(app, std::path::Path::new("store.json"))
        .build()
        .map_err(|e| e.to_string())?;
    match store.get("notificationsEnabled") {
        Some(serde_json::Value::Bool(enabled)) => {
            state.set_notifications_enabled(enabled).await;
        }
        _ => {}
    }
    Ok(())
}

pub async fn save_notifications_to_store(
    app: &AppHandle,
    enabled: bool,
) -> Result<(), String> {
    let store = tauri_plugin_store::StoreBuilder::new(app, std::path::Path::new("store.json"))
        .build()
        .map_err(|e| e.to_string())?;
    store.set("notificationsEnabled", serde_json::Value::Bool(enabled));
    store.save().map_err(|e: tauri_plugin_store::Error| e.to_string())
}
