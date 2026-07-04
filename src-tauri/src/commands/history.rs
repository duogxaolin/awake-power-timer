use crate::state::PowerAction;
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::AppHandle;

/// One entry in the activity log: a timestamped record of an automated event
/// (a timer starting, a scheduled action firing, an action executing, etc.).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ActivityEvent {
    /// RFC 3339 local timestamp of when the event was recorded.
    pub timestamp: String,
    pub kind: EventKind,
    /// Human-readable detail, already formatted for display.
    pub detail: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EventKind {
    TimerStarted,
    TimerCancelled,
    ActionExecuted,
    ScheduleFired,
    IdleFired,
    BatteryFired,
}

const STORE_KEY: &str = "activityLog";
/// Keep the log bounded so the store file can't grow without limit.
const MAX_EVENTS: usize = 200;

#[tauri::command]
pub async fn get_activity_log(app: AppHandle) -> Result<Vec<ActivityEvent>, String> {
    load_log(&app)
}

#[tauri::command]
pub async fn clear_activity_log(app: AppHandle) -> Result<(), String> {
    let store = tauri_plugin_store::StoreBuilder::new(&app, Path::new("store.json"))
        .build()
        .map_err(|e| e.to_string())?;
    store.set(STORE_KEY, serde_json::json!([]));
    store.save().map_err(|e| e.to_string())
}

pub fn load_log(app: &AppHandle) -> Result<Vec<ActivityEvent>, String> {
    let store = tauri_plugin_store::StoreBuilder::new(app, Path::new("store.json"))
        .build()
        .map_err(|e| e.to_string())?;
    match store.get(STORE_KEY) {
        Some(value) => serde_json::from_value(value).map_err(|e| e.to_string()),
        None => Ok(Vec::new()),
    }
}

/// Records an event to the persistent log, keeping only the most recent
/// `MAX_EVENTS`. Newest entries are stored first. Failures are swallowed so a
/// logging problem never blocks the action being logged.
pub fn record(app: &AppHandle, kind: EventKind, detail: impl Into<String>) {
    let timestamp = chrono::Local::now().to_rfc3339();
    let event = ActivityEvent {
        timestamp,
        kind,
        detail: detail.into(),
    };
    let mut log = load_log(app).unwrap_or_default();
    push_bounded(&mut log, event, MAX_EVENTS);
    if let Ok(store) = tauri_plugin_store::StoreBuilder::new(app, Path::new("store.json")).build() {
        if let Ok(value) = serde_json::to_value(&log) {
            store.set(STORE_KEY, value);
            let _ = store.save();
        }
    }
}

/// Convenience for the common "an action was requested/fired" wording.
pub fn describe_action(action: PowerAction) -> &'static str {
    match action {
        PowerAction::Shutdown => "Shutdown",
        PowerAction::Restart => "Restart",
        PowerAction::Sleep => "Sleep",
        PowerAction::Hibernate => "Hibernate",
    }
}

/// Inserts `event` at the front and truncates to `max`, keeping the newest.
pub fn push_bounded(log: &mut Vec<ActivityEvent>, event: ActivityEvent, max: usize) {
    log.insert(0, event);
    if log.len() > max {
        log.truncate(max);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(detail: &str) -> ActivityEvent {
        ActivityEvent {
            timestamp: "2026-01-01T00:00:00+00:00".into(),
            kind: EventKind::TimerStarted,
            detail: detail.into(),
        }
    }

    #[test]
    fn push_keeps_newest_first() {
        let mut log = Vec::new();
        push_bounded(&mut log, ev("a"), 10);
        push_bounded(&mut log, ev("b"), 10);
        assert_eq!(log[0].detail, "b");
        assert_eq!(log[1].detail, "a");
    }

    #[test]
    fn push_truncates_to_max() {
        let mut log = Vec::new();
        for i in 0..250 {
            push_bounded(&mut log, ev(&i.to_string()), 200);
        }
        assert_eq!(log.len(), 200);
        // Newest (249) is first, oldest kept is 50.
        assert_eq!(log[0].detail, "249");
        assert_eq!(log[199].detail, "50");
    }

    #[test]
    fn describe_action_covers_all_variants() {
        assert_eq!(describe_action(PowerAction::Shutdown), "Shutdown");
        assert_eq!(describe_action(PowerAction::Restart), "Restart");
        assert_eq!(describe_action(PowerAction::Sleep), "Sleep");
        assert_eq!(describe_action(PowerAction::Hibernate), "Hibernate");
    }

    #[test]
    fn event_roundtrips_json() {
        let e = ev("test");
        let json = serde_json::to_string(&e).unwrap();
        let back: ActivityEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(e, back);
    }

    #[test]
    fn kind_serializes_snake_case() {
        let json = serde_json::to_string(&EventKind::ScheduleFired).unwrap();
        assert_eq!(json, "\"schedule_fired\"");
    }
}
