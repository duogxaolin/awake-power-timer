use crate::state::{AppState, PowerAction};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::{AppHandle, State};

/// Configuration for the "run a power action when the battery gets low" safety
/// feature. Fires `action` once the battery drops to `threshold_percent` or
/// below while the machine is running on battery (not charging).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BatteryActionConfig {
    pub enabled: bool,
    pub action: PowerAction,
    pub threshold_percent: u8,
    /// Warning countdown before the action fires, so it can be cancelled.
    #[serde(default = "default_grace")]
    pub grace_seconds: u64,
}

fn default_grace() -> u64 {
    120
}

impl Default for BatteryActionConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            action: PowerAction::Hibernate,
            threshold_percent: 15,
            grace_seconds: 120,
        }
    }
}

const STORE_KEY: &str = "batteryAction";

#[tauri::command]
pub async fn get_battery_action(app: AppHandle) -> Result<BatteryActionConfig, String> {
    load_battery_action(&app)
}

#[tauri::command]
pub async fn save_battery_action(
    app: AppHandle,
    config: BatteryActionConfig,
) -> Result<(), String> {
    store_battery_action(&app, &config)
}

pub fn load_battery_action(app: &AppHandle) -> Result<BatteryActionConfig, String> {
    let store = tauri_plugin_store::StoreBuilder::new(app, Path::new("store.json"))
        .build()
        .map_err(|e| e.to_string())?;
    match store.get(STORE_KEY) {
        Some(value) => serde_json::from_value(value).map_err(|e| e.to_string()),
        None => Ok(BatteryActionConfig::default()),
    }
}

pub fn store_battery_action(app: &AppHandle, config: &BatteryActionConfig) -> Result<(), String> {
    let store = tauri_plugin_store::StoreBuilder::new(app, Path::new("store.json"))
        .build()
        .map_err(|e| e.to_string())?;
    let value = serde_json::to_value(config).map_err(|e| e.to_string())?;
    store.set(STORE_KEY, value);
    store.save().map_err(|e| e.to_string())
}

/// Returns true when the reported battery level warrants firing the action:
/// enabled, discharging (not on AC), and at or below the threshold.
pub fn should_fire(
    config: &BatteryActionConfig,
    percent: Option<u8>,
    on_ac_power: Option<bool>,
) -> bool {
    if !config.enabled {
        return false;
    }
    // If we know it's plugged in, never fire. If AC state is unknown, fall back
    // to the percentage alone so a machine without charge reporting is still
    // protected.
    if on_ac_power == Some(true) {
        return false;
    }
    matches!(percent, Some(p) if p <= config.threshold_percent)
}

/// Background loop that watches the battery level and fires the configured
/// power action once it drops low while unplugged. Samples every `SAMPLE_SECS`.
pub fn spawn_battery_watcher(app: AppHandle, state: AppState) {
    const SAMPLE_SECS: u64 = 30;
    tauri::async_runtime::spawn(async move {
        let mut fired = false;
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(SAMPLE_SECS));
        loop {
            interval.tick().await;
            let config = match load_battery_action(&app) {
                Ok(c) => c,
                Err(_) => continue,
            };
            if !config.enabled {
                fired = false;
                continue;
            }

            let stats = {
                let mut monitor = state.system_monitor.lock().await;
                monitor.sample()
            };

            // Reset the latch once charging resumes or the level recovers above
            // the threshold, so the action can fire again on the next drain.
            if stats.on_ac_power == Some(true)
                || matches!(stats.battery_percent, Some(p) if p > config.threshold_percent)
            {
                fired = false;
            }

            if !fired && should_fire(&config, stats.battery_percent, stats.on_ac_power) {
                fired = true;
                crate::commands::history::record(
                    &app,
                    crate::commands::history::EventKind::BatteryFired,
                    format!(
                        "Battery at {}%: {}",
                        stats.battery_percent.unwrap_or(0),
                        crate::commands::history::describe_action(config.action)
                    ),
                );
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

    fn cfg() -> BatteryActionConfig {
        BatteryActionConfig {
            enabled: true,
            action: PowerAction::Hibernate,
            threshold_percent: 15,
            grace_seconds: 120,
        }
    }

    #[test]
    fn fires_when_low_and_discharging() {
        assert!(should_fire(&cfg(), Some(10), Some(false)));
        assert!(should_fire(&cfg(), Some(15), Some(false)));
    }

    #[test]
    fn does_not_fire_above_threshold() {
        assert!(!should_fire(&cfg(), Some(40), Some(false)));
    }

    #[test]
    fn does_not_fire_on_ac_power() {
        assert!(!should_fire(&cfg(), Some(5), Some(true)));
    }

    #[test]
    fn fires_when_ac_state_unknown() {
        // No AC reporting: protect the machine based on percentage alone.
        assert!(should_fire(&cfg(), Some(10), None));
    }

    #[test]
    fn does_not_fire_without_battery() {
        assert!(!should_fire(&cfg(), None, Some(false)));
    }

    #[test]
    fn disabled_never_fires() {
        let mut c = cfg();
        c.enabled = false;
        assert!(!should_fire(&c, Some(1), Some(false)));
    }

    #[test]
    fn default_is_disabled_hibernate() {
        let d = BatteryActionConfig::default();
        assert!(!d.enabled);
        assert!(matches!(d.action, PowerAction::Hibernate));
        assert_eq!(d.threshold_percent, 15);
    }

    #[test]
    fn config_roundtrips_json() {
        let c = cfg();
        let json = serde_json::to_string(&c).unwrap();
        let back: BatteryActionConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(c, back);
    }

    #[test]
    fn grace_defaults_when_absent() {
        let json = r#"{"enabled":true,"action":"shutdown","threshold_percent":10}"#;
        let parsed: BatteryActionConfig = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.grace_seconds, 120);
    }
}
