use crate::state::AppState;
use std::collections::BTreeSet;
use tauri::State;

/// A running process entry surfaced to the UI for the app picker.
#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq, PartialOrd, Ord)]
pub struct ProcessEntry {
    pub name: String,
}

#[tauri::command]
pub async fn list_processes(state: State<'_, AppState>) -> Result<Vec<ProcessEntry>, String> {
    list_processes_inner(state.inner()).await
}

#[tauri::command]
pub async fn any_process_running(
    state: State<'_, AppState>,
    names: Vec<String>,
) -> Result<bool, String> {
    any_process_running_inner(state.inner(), &names).await
}

pub async fn list_processes_inner(state: &AppState) -> Result<Vec<ProcessEntry>, String> {
    let names = collect_process_names(state).await;
    Ok(names.into_iter().map(|name| ProcessEntry { name }).collect())
}

pub async fn any_process_running_inner(state: &AppState, names: &[String]) -> Result<bool, String> {
    if names.is_empty() {
        return Ok(false);
    }
    let running = collect_process_names(state).await;
    Ok(names_match(&running, names))
}

/// Refreshes the process list and returns a sorted, de-duplicated set of
/// lowercased executable names (extensions stripped where present).
async fn collect_process_names(state: &AppState) -> BTreeSet<String> {
    let mut monitor = state.system_monitor.lock().await;
    monitor.refresh_processes();
    monitor.process_names()
}

/// Case-insensitive membership test: true if any wanted name matches a running
/// process name (either direction of substring, to tolerate `.exe` and paths).
pub fn names_match(running: &BTreeSet<String>, wanted: &[String]) -> bool {
    wanted.iter().any(|w| {
        let w = normalize(w);
        !w.is_empty()
            && running
                .iter()
                .any(|r| r == &w || r.contains(&w) || w.contains(r.as_str()))
    })
}

/// Lowercase and strip a trailing `.exe` so Windows and Unix names compare equal.
pub fn normalize(name: &str) -> String {
    let lower = name.trim().to_lowercase();
    lower.strip_suffix(".exe").unwrap_or(&lower).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set(items: &[&str]) -> BTreeSet<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn normalize_strips_exe_and_lowercases() {
        assert_eq!(normalize("Chrome.exe"), "chrome");
        assert_eq!(normalize("  Firefox  "), "firefox");
    }

    #[test]
    fn matches_exact_name() {
        let running = set(&["chrome", "code", "explorer"]);
        assert!(names_match(&running, &["chrome".into()]));
    }

    #[test]
    fn matches_case_insensitively_with_exe() {
        let running = set(&["steam"]);
        assert!(names_match(&running, &["Steam.exe".into()]));
    }

    #[test]
    fn no_match_returns_false() {
        let running = set(&["chrome", "code"]);
        assert!(!names_match(&running, &["obs".into()]));
    }

    #[test]
    fn empty_wanted_never_matches() {
        let running = set(&["chrome"]);
        assert!(!names_match(&running, &[]));
        assert!(!names_match(&running, &["".into()]));
    }
}
