use crate::commands::system_monitor::SystemMonitor;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::async_runtime::Mutex;
use tokio::sync::oneshot;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum KeepAwakeMode {
    Display,
    System,
    Both,
}

impl Default for KeepAwakeMode {
    fn default() -> Self {
        KeepAwakeMode::Both
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PowerAction {
    Shutdown,
    Restart,
    Sleep,
    Hibernate,
}

impl PowerAction {
    pub fn as_str(&self) -> &'static str {
        match self {
            PowerAction::Shutdown => "shutdown",
            PowerAction::Restart => "restart",
            PowerAction::Sleep => "sleep",
            PowerAction::Hibernate => "hibernate",
        }
    }
}

pub struct KeepAwakeState {
    pub handle: Option<keepawake::KeepAwake>,
    pub mode: KeepAwakeMode,
    pub end_time: Option<std::time::Instant>,
    pub remaining_seconds: u64,
}

impl Default for KeepAwakeState {
    fn default() -> Self {
        Self {
            handle: None,
            mode: KeepAwakeMode::Both,
            end_time: None,
            remaining_seconds: 0,
        }
    }
}

pub struct PowerTimerState {
    pub active: bool,
    pub action: PowerAction,
    pub total_seconds: u64,
    pub remaining_seconds: u64,
    pub abort_tx: Option<oneshot::Sender<()>>,
}

impl Default for PowerTimerState {
    fn default() -> Self {
        Self {
            active: false,
            action: PowerAction::Shutdown,
            total_seconds: 0,
            remaining_seconds: 0,
            abort_tx: None,
        }
    }
}

#[derive(Clone)]
pub struct AppState {
    pub keep_awake: Arc<Mutex<KeepAwakeState>>,
    pub power_timer: Arc<Mutex<PowerTimerState>>,
    pub notifications_enabled: Arc<Mutex<bool>>,
    pub system_monitor: Arc<Mutex<SystemMonitor>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            keep_awake: Arc::new(Mutex::new(KeepAwakeState::default())),
            power_timer: Arc::new(Mutex::new(PowerTimerState::default())),
            notifications_enabled: Arc::new(Mutex::new(true)),
            system_monitor: Arc::new(Mutex::new(SystemMonitor::default())),
        }
    }
}

impl AppState {
    pub async fn notifications_enabled(&self) -> bool {
        *self.notifications_enabled.lock().await
    }

    pub async fn set_notifications_enabled(&self, enabled: bool) {
        *self.notifications_enabled.lock().await = enabled;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keep_awake_mode_default_is_both() {
        assert!(matches!(KeepAwakeMode::default(), KeepAwakeMode::Both));
    }

    #[test]
    fn power_action_default_is_shutdown() {
        let state = PowerTimerState::default();
        assert!(matches!(state.action, PowerAction::Shutdown));
    }

    #[test]
    fn keep_awake_state_defaults() {
        let state = KeepAwakeState::default();
        assert!(state.handle.is_none());
        assert!(matches!(state.mode, KeepAwakeMode::Both));
        assert!(state.end_time.is_none());
        assert_eq!(state.remaining_seconds, 0);
    }

    #[test]
    fn power_timer_state_defaults() {
        let state = PowerTimerState::default();
        assert!(!state.active);
        assert!(matches!(state.action, PowerAction::Shutdown));
        assert_eq!(state.total_seconds, 0);
        assert_eq!(state.remaining_seconds, 0);
        assert!(state.abort_tx.is_none());
    }

    #[test]
    fn keep_awake_mode_serializes_lowercase() {
        let json = serde_json::to_string(&KeepAwakeMode::Display).unwrap();
        assert_eq!(json, "\"display\"");
    }

    #[test]
    fn power_action_serializes_lowercase() {
        let json = serde_json::to_string(&PowerAction::Hibernate).unwrap();
        assert_eq!(json, "\"hibernate\"");
    }

    #[tokio::test]
    async fn app_state_notifications_default_true() {
        let state = AppState::default();
        assert!(state.notifications_enabled().await);
    }

    #[tokio::test]
    async fn app_state_notifications_can_be_disabled() {
        let state = AppState::default();
        state.set_notifications_enabled(false).await;
        assert!(!state.notifications_enabled().await);
    }
}
