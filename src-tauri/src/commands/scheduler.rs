use crate::state::{AppState, PowerAction};
use chrono::{Datelike, Local, Timelike};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::{AppHandle, State};

/// A recurring power-action rule, e.g. "Shutdown at 23:00 every weekday".
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RecurringSchedule {
    pub id: String,
    pub action: PowerAction,
    pub hour: u32,
    pub minute: u32,
    /// Weekday flags, index 0 = Monday .. 6 = Sunday.
    pub days: [bool; 7],
    pub enabled: bool,
    /// Countdown in seconds shown before the action fires (allows cancelling).
    #[serde(default = "default_grace")]
    pub grace_seconds: u64,
}

fn default_grace() -> u64 {
    60
}

const STORE_KEY: &str = "recurringSchedules";

#[tauri::command]
pub async fn get_schedules(app: AppHandle) -> Result<Vec<RecurringSchedule>, String> {
    load_schedules(&app)
}

#[tauri::command]
pub async fn save_schedules(
    app: AppHandle,
    schedules: Vec<RecurringSchedule>,
) -> Result<(), String> {
    store_schedules(&app, &schedules)
}

pub fn load_schedules(app: &AppHandle) -> Result<Vec<RecurringSchedule>, String> {
    let store = tauri_plugin_store::StoreBuilder::new(app, Path::new("store.json"))
        .build()
        .map_err(|e| e.to_string())?;
    match store.get(STORE_KEY) {
        Some(value) => serde_json::from_value(value).map_err(|e| e.to_string()),
        None => Ok(Vec::new()),
    }
}

pub fn store_schedules(app: &AppHandle, schedules: &[RecurringSchedule]) -> Result<(), String> {
    let store = tauri_plugin_store::StoreBuilder::new(app, Path::new("store.json"))
        .build()
        .map_err(|e| e.to_string())?;
    let value = serde_json::to_value(schedules).map_err(|e| e.to_string())?;
    store.set(STORE_KEY, value);
    store.save().map_err(|e| e.to_string())
}

/// Returns the schedules that should fire at the given weekday/hour/minute.
/// `weekday_mon0` is 0 for Monday through 6 for Sunday.
pub fn due_schedules<'a>(
    schedules: &'a [RecurringSchedule],
    weekday_mon0: usize,
    hour: u32,
    minute: u32,
) -> Vec<&'a RecurringSchedule> {
    schedules
        .iter()
        .filter(|s| {
            s.enabled
                && s.days.get(weekday_mon0).copied().unwrap_or(false)
                && s.hour == hour
                && s.minute == minute
        })
        .collect()
}

/// Background loop: once a minute, fire any schedule due at the current local time.
/// A `last_fired` guard prevents re-firing the same rule within the same minute.
pub fn spawn_scheduler(app: AppHandle, state: AppState) {
    tauri::async_runtime::spawn(async move {
        let mut last_fired_key: Option<String> = None;
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(20));
        loop {
            interval.tick().await;
            let now = Local::now();
            let weekday_mon0 = now.weekday().num_days_from_monday() as usize;
            let minute_key = format!("{}-{}-{}", now.hour(), now.minute(), weekday_mon0);

            // Only evaluate once per clock-minute.
            if last_fired_key.as_deref() == Some(minute_key.as_str()) {
                continue;
            }

            let schedules = match load_schedules(&app) {
                Ok(s) => s,
                Err(_) => continue,
            };
            let due = due_schedules(&schedules, weekday_mon0, now.hour(), now.minute());
            if due.is_empty() {
                continue;
            }
            last_fired_key = Some(minute_key);

            // If several rules collide, honour the first one.
            if let Some(schedule) = due.into_iter().next() {
                crate::commands::history::record(
                    &app,
                    crate::commands::history::EventKind::ScheduleFired,
                    format!(
                        "Recurring schedule fired: {} at {:02}:{:02}",
                        crate::commands::history::describe_action(schedule.action),
                        schedule.hour,
                        schedule.minute
                    ),
                );
                let _ = crate::commands::power_timer::start_power_timer_inner(
                    app.clone(),
                    &state,
                    schedule.action,
                    schedule.grace_seconds,
                )
                .await;
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> RecurringSchedule {
        RecurringSchedule {
            id: "a".into(),
            action: PowerAction::Shutdown,
            hour: 23,
            minute: 0,
            days: [true, true, true, true, true, false, false],
            enabled: true,
            grace_seconds: 60,
        }
    }

    #[test]
    fn due_when_day_time_match() {
        let s = vec![sample()];
        // Monday (0) at 23:00 -> due.
        assert_eq!(due_schedules(&s, 0, 23, 0).len(), 1);
    }

    #[test]
    fn not_due_on_weekend() {
        let s = vec![sample()];
        // Saturday (5) is disabled in the sample.
        assert!(due_schedules(&s, 5, 23, 0).is_empty());
    }

    #[test]
    fn not_due_wrong_minute() {
        let s = vec![sample()];
        assert!(due_schedules(&s, 0, 23, 1).is_empty());
    }

    #[test]
    fn disabled_never_fires() {
        let mut item = sample();
        item.enabled = false;
        let s = vec![item];
        assert!(due_schedules(&s, 0, 23, 0).is_empty());
    }

    #[test]
    fn roundtrips_through_json() {
        let s = vec![sample()];
        let json = serde_json::to_string(&s).unwrap();
        let back: Vec<RecurringSchedule> = serde_json::from_str(&json).unwrap();
        assert_eq!(s, back);
    }

    #[test]
    fn grace_defaults_when_absent() {
        let json = r#"{"id":"x","action":"sleep","hour":1,"minute":30,"days":[false,false,false,false,false,true,true],"enabled":true}"#;
        let parsed: RecurringSchedule = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.grace_seconds, 60);
    }
}
