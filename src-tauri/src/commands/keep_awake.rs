use crate::state::{AppState, KeepAwakeMode, KeepAwakeState};
use std::time::{Duration, Instant};
use tauri::{AppHandle, State};
use tauri_plugin_notification::NotificationExt;

#[derive(Debug, serde::Serialize)]
pub struct KeepAwakeStatus {
    pub active: bool,
    pub mode: KeepAwakeMode,
    pub remaining_seconds: u64,
}

#[tauri::command]
pub async fn start_keep_awake(
    app: AppHandle,
    state: State<'_, AppState>,
    mode: KeepAwakeMode,
    seconds: u64,
) -> Result<(), String> {
    start_keep_awake_inner(app, state.inner(), mode, seconds).await
}

#[tauri::command]
pub async fn stop_keep_awake(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    stop_keep_awake_inner(app, state.inner()).await
}

#[tauri::command]
pub async fn get_keep_awake_status(
    state: State<'_, AppState>,
) -> Result<KeepAwakeStatus, String> {
    Ok(get_keep_awake_status_inner(state.inner()).await)
}

pub async fn start_keep_awake_inner(
    app: AppHandle,
    state: &AppState,
    mode: KeepAwakeMode,
    seconds: u64,
) -> Result<(), String> {
    let mut lock = state.keep_awake.lock().await;
    stop_keep_awake_inner_state(&mut lock);

    let both = matches!(mode, KeepAwakeMode::Both);
    let display = both || matches!(mode, KeepAwakeMode::Display);
    let system = both || matches!(mode, KeepAwakeMode::System);

    let handle = keepawake::Builder::default()
        .display(display)
        .idle(system)
        .sleep(system)
        .reason("Awake & Power Timer is keeping the system awake")
        .create()
        .map_err(|e| format!("keepawake failed: {e}"))?;

    lock.handle = Some(handle);
    lock.mode = mode;
    lock.remaining_seconds = seconds;
    lock.end_time = if seconds == 0 {
        None
    } else {
        Some(Instant::now() + Duration::from_secs(seconds))
    };

    notify(&app, state, "Awake & Power Timer", "Keep awake started").await;
    Ok(())
}

pub async fn stop_keep_awake_inner(app: AppHandle, state: &AppState) -> Result<(), String> {
    let mut lock = state.keep_awake.lock().await;
    if stop_keep_awake_inner_state(&mut lock) {
        notify(&app, state, "Awake & Power Timer", "Keep awake ended").await;
    }
    Ok(())
}

fn stop_keep_awake_inner_state(lock: &mut KeepAwakeState) -> bool {
    let was_active = lock.handle.is_some();
    lock.handle.take();
    lock.end_time = None;
    lock.remaining_seconds = 0;
    was_active
}

pub async fn get_keep_awake_status_inner(state: &AppState) -> KeepAwakeStatus {
    let mut lock = state.keep_awake.lock().await;
    if let Some(end) = lock.end_time {
        let remaining = end.saturating_duration_since(Instant::now()).as_secs();
        lock.remaining_seconds = remaining;
        if remaining == 0 {
            lock.handle.take();
            lock.end_time = None;
        }
    }
    KeepAwakeStatus {
        active: lock.handle.is_some(),
        mode: lock.mode,
        remaining_seconds: lock.remaining_seconds,
    }
}

async fn notify(app: &AppHandle, state: &AppState, title: &str, body: &str) {
    if !state.notifications_enabled().await {
        return;
    }
    let _ = app
        .notification()
        .builder()
        .title(title)
        .body(body)
        .show();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    #[tokio::test]
    async fn status_default_is_inactive() {
        let state = AppState::default();
        let status = get_keep_awake_status_inner(&state).await;
        assert!(!status.active);
        assert_eq!(status.remaining_seconds, 0);
    }

    #[tokio::test]
    async fn status_ended_timer_marks_inactive() {
        let state = AppState::default();
        {
            let mut lock = state.keep_awake.lock().await;
            lock.handle = None;
            lock.mode = KeepAwakeMode::Display;
            lock.end_time = Some(Instant::now() - Duration::from_secs(1));
            lock.remaining_seconds = 1;
        }
        let status = get_keep_awake_status_inner(&state).await;
        assert!(!status.active);
        assert_eq!(status.remaining_seconds, 0);
    }

    #[tokio::test]
    async fn status_reports_remaining_seconds() {
        let state = AppState::default();
        let handle = keepawake::Builder::default()
            .display(true)
            .idle(true)
            .sleep(true)
            .reason("test")
            .create()
            .expect("keepawake handle should be created");
        {
            let mut lock = state.keep_awake.lock().await;
            lock.handle = Some(handle);
            lock.mode = KeepAwakeMode::System;
            lock.end_time = Some(Instant::now() + Duration::from_secs(120));
            lock.remaining_seconds = 120;
        }
        let status = get_keep_awake_status_inner(&state).await;
        assert!(status.active);
        assert_eq!(status.mode, KeepAwakeMode::System);
        assert!(status.remaining_seconds <= 120 && status.remaining_seconds >= 118);
    }
}
