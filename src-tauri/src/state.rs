use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::async_runtime::Mutex;
use tokio::sync::oneshot;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
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
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            keep_awake: Arc::new(Mutex::new(KeepAwakeState::default())),
            power_timer: Arc::new(Mutex::new(PowerTimerState::default())),
        }
    }
}
