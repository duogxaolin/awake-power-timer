use crate::state::{AppState, PowerAction, PowerTimerState};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::async_runtime::Mutex;
use tauri::{AppHandle, State};
use tokio::sync::oneshot;
use tauri_plugin_notification::NotificationExt;

#[derive(Debug, serde::Serialize)]
pub struct PowerTimerStatus {
    pub active: bool,
    pub action: PowerAction,
    pub remaining_seconds: u64,
}

#[tauri::command]
pub async fn start_power_timer(
    app: AppHandle,
    state: State<'_, AppState>,
    action: PowerAction,
    seconds: u64,
) -> Result<(), String> {
    start_power_timer_inner(app, state.inner(), action, seconds).await
}

#[tauri::command]
pub async fn cancel_power_timer(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    cancel_power_timer_inner(app, state.inner()).await
}

#[tauri::command]
pub async fn get_power_timer_status(
    state: State<'_, AppState>,
) -> Result<PowerTimerStatus, String> {
    Ok(get_power_timer_status_inner(state.inner()).await)
}

pub async fn start_power_timer_inner(
    app: AppHandle,
    state: &AppState,
    action: PowerAction,
    seconds: u64,
) -> Result<(), String> {
    let mut lock = state.power_timer.lock().await;
    cancel_power_timer_inner_state(&mut lock);

    let (tx, rx) = oneshot::channel::<()>();
    lock.active = true;
    lock.action = action;
    lock.total_seconds = seconds;
    lock.remaining_seconds = seconds;
    lock.abort_tx = Some(tx);

    let power_timer = state.power_timer.clone();
    let app_handle = app.clone();
    let warning_app = app.clone();
    tauri::async_runtime::spawn(async move {
        let fired = run_timer(seconds, power_timer.clone(), rx, warning_app).await;
        if fired {
            let _ = execute_power_action(app_handle, action).await;
        } else {
            notify(&app_handle, "Awake & Power Timer", "Timer cancelled");
        }
        let mut lock = power_timer.lock().await;
        lock.active = false;
        lock.remaining_seconds = 0;
        lock.abort_tx = None;
    });

    notify(&app, "Awake & Power Timer", &format!("{:?} scheduled", action));
    Ok(())
}

pub async fn cancel_power_timer_inner(app: AppHandle, state: &AppState) -> Result<(), String> {
    let mut lock = state.power_timer.lock().await;
    if cancel_power_timer_inner_state(&mut lock) {
        notify(&app, "Awake & Power Timer", "Timer cancelled");
    }
    Ok(())
}

fn cancel_power_timer_inner_state(lock: &mut PowerTimerState) -> bool {
    if let Some(tx) = lock.abort_tx.take() {
        let _ = tx.send(());
    }
    let was_active = lock.active;
    lock.active = false;
    lock.remaining_seconds = 0;
    was_active
}

pub async fn get_power_timer_status_inner(state: &AppState) -> PowerTimerStatus {
    let lock = state.power_timer.lock().await;
    PowerTimerStatus {
        active: lock.active,
        action: lock.action,
        remaining_seconds: lock.remaining_seconds,
    }
}

async fn run_timer(
    seconds: u64,
    state: Arc<Mutex<PowerTimerState>>,
    mut rx: oneshot::Receiver<()>,
    warning_app: AppHandle,
) -> bool {
    let start = Instant::now();
    let end = start + Duration::from_secs(seconds);

    let mut interval = tokio::time::interval(Duration::from_secs(1));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    let mut warned = false;

    loop {
        tokio::select! {
            _ = interval.tick() => {
                let remaining = end.saturating_duration_since(Instant::now()).as_secs();
                {
                    let mut lock = state.lock().await;
                    lock.remaining_seconds = remaining;
                }
                if !warned && remaining <= 60 && remaining > 0 {
                    warned = true;
                    notify(&warning_app, "Awake & Power Timer", "Power action in 1 minute");
                }
                if remaining == 0 {
                    return true;
                }
            }
            _ = &mut rx => {
                return false;
            }
        }
    }
}

async fn execute_power_action(app: AppHandle, action: PowerAction) -> Result<(), String> {
    notify(&app, "Awake & Power Timer", &format!("Executing {:?}", action));
    match action {
        PowerAction::Shutdown => {
            system_shutdown::shutdown().map_err(|e| format!("shutdown failed: {e}"))
        }
        PowerAction::Restart => system_shutdown::reboot().map_err(|e| format!("restart failed: {e}")),
        PowerAction::Sleep => system_shutdown::sleep().map_err(|e| format!("sleep failed: {e}")),
        PowerAction::Hibernate => {
            system_shutdown::hibernate().map_err(|e| format!("hibernate failed: {e}"))
        }
    }
}

fn notify(app: &AppHandle, title: &str, body: &str) {
    let _ = app
        .notification()
        .builder()
        .title(title)
        .body(body)
        .show();
}
