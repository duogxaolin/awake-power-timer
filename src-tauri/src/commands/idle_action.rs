use crate::state::{AppState, PowerAction};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::{AppHandle, State};

/// Configuration for the "run a power action once the machine goes idle" feature.
/// Idle is defined as CPU usage below `cpu_threshold` AND combined network
/// throughput below `net_threshold_kb` for `idle_minutes` consecutive minutes.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct IdleActionConfig {
    pub enabled: bool,
    pub action: PowerAction,
    pub idle_minutes: u64,
    pub cpu_threshold: f32,
    pub net_threshold_kb: f32,
    /// Warning countdown before the action fires, so it can be cancelled.
    #[serde(default = "default_grace")]
    pub grace_seconds: u64,
}

fn default_grace() -> u64 {
    120
}

impl Default for IdleActionConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            action: PowerAction::Sleep,
            idle_minutes: 15,
            cpu_threshold: 15.0,
            net_threshold_kb: 200.0,
            grace_seconds: 120,
        }
    }
}

const STORE_KEY: &str = "idleAction";

#[tauri::command]
pub async fn get_idle_action(app: AppHandle) -> Result<IdleActionConfig, String> {
    load_idle_action(&app)
}

#[tauri::command]
pub async fn save_idle_action(app: AppHandle, config: IdleActionConfig) -> Result<(), String> {
    store_idle_action(&app, &config)
}

pub fn load_idle_action(app: &AppHandle) -> Result<IdleActionConfig, String> {
    let store = tauri_plugin_store::StoreBuilder::new(app, Path::new("store.json"))
        .build()
        .map_err(|e| e.to_string())?;
    match store.get(STORE_KEY) {
        Some(value) => serde_json::from_value(value).map_err(|e| e.to_string()),
        None => Ok(IdleActionConfig::default()),
    }
}

pub fn store_idle_action(app: &AppHandle, config: &IdleActionConfig) -> Result<(), String> {
    let store = tauri_plugin_store::StoreBuilder::new(app, Path::new("store.json"))
        .build()
        .map_err(|e| e.to_string())?;
    let value = serde_json::to_value(config).map_err(|e| e.to_string())?;
    store.set(STORE_KEY, value);
    store.save().map_err(|e| e.to_string())
}

/// Returns true when the current sample counts as idle under the config.
pub fn is_idle(config: &IdleActionConfig, cpu_usage: f32, net_kb_per_sec: f32) -> bool {
    cpu_usage < config.cpu_threshold && net_kb_per_sec < config.net_threshold_kb
}

/// Background loop that watches system activity and fires the configured power
/// action after the machine stays idle long enough. Sampling every `SAMPLE_SECS`
/// seconds, it accumulates idle time and resets the counter on any activity.
pub fn spawn_idle_watcher(app: AppHandle, state: AppState) {
    const SAMPLE_SECS: u64 = 30;
    tauri::async_runtime::spawn(async move {
        let mut idle_secs: u64 = 0;
        let mut fired = false;
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(SAMPLE_SECS));
        loop {
            interval.tick().await;
            let config = match load_idle_action(&app) {
                Ok(c) => c,
                Err(_) => continue,
            };
            if !config.enabled {
                idle_secs = 0;
                fired = false;
                continue;
            }

            // Don't trigger while a keep-awake session is deliberately active.
            let keep_awake_active = {
                let lock = state.keep_awake.lock().await;
                lock.handle.is_some()
            };
            if keep_awake_active {
                idle_secs = 0;
                fired = false;
                continue;
            }

            let stats = {
                let mut monitor = state.system_monitor.lock().await;
                monitor.sample()
            };
            let net_kb = (stats.net_rx_per_sec + stats.net_tx_per_sec) as f32 / 1024.0;

            if is_idle(&config, stats.cpu_usage, net_kb) {
                idle_secs = idle_secs.saturating_add(SAMPLE_SECS);
            } else {
                idle_secs = 0;
                fired = false;
            }

            if !fired && idle_secs >= config.idle_minutes * 60 {
                fired = true;
                let _ = crate::commands::power_timer::start_power_timer_inner(
                    app.clone(),
                    &state,
                    config.action,
                    config.grace_seconds,
                )
                .await;
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> IdleActionConfig {
        IdleActionConfig {
            enabled: true,
            action: PowerAction::Sleep,
            idle_minutes: 10,
            cpu_threshold: 15.0,
            net_threshold_kb: 200.0,
            grace_seconds: 120,
        }
    }

    #[test]
    fn idle_when_below_both_thresholds() {
        assert!(is_idle(&cfg(), 5.0, 50.0));
    }

    #[test]
    fn busy_cpu_is_not_idle() {
        assert!(!is_idle(&cfg(), 40.0, 10.0));
    }

    #[test]
    fn busy_network_is_not_idle() {
        assert!(!is_idle(&cfg(), 5.0, 800.0));
    }

    #[test]
    fn default_is_disabled_sleep() {
        let d = IdleActionConfig::default();
        assert!(!d.enabled);
        assert!(matches!(d.action, PowerAction::Sleep));
        assert_eq!(d.idle_minutes, 15);
    }

    #[test]
    fn config_roundtrips_json() {
        let c = cfg();
        let json = serde_json::to_string(&c).unwrap();
        let back: IdleActionConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(c, back);
    }

    #[test]
    fn grace_defaults_when_absent() {
        let json = r#"{"enabled":true,"action":"shutdown","idle_minutes":5,"cpu_threshold":10.0,"net_threshold_kb":100.0}"#;
        let parsed: IdleActionConfig = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.grace_seconds, 120);
    }
}
