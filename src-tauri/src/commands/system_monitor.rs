use crate::state::AppState;
use std::collections::BTreeSet;
use sysinfo::{Networks, ProcessRefreshKind, ProcessesToUpdate, System};
use tauri::State;

#[derive(Debug, Clone, serde::Serialize)]
pub struct SystemStats {
    /// Global CPU usage as a percentage (0-100).
    pub cpu_usage: f32,
    /// Per-core CPU usage percentages.
    pub cpu_per_core: Vec<f32>,
    /// Total physical memory in bytes.
    pub memory_total: u64,
    /// Used physical memory in bytes.
    pub memory_used: u64,
    /// Total swap in bytes.
    pub swap_total: u64,
    /// Used swap in bytes.
    pub swap_used: u64,
    /// Bytes received per second across all interfaces since the last sample.
    pub net_rx_per_sec: u64,
    /// Bytes transmitted per second across all interfaces since the last sample.
    pub net_tx_per_sec: u64,
    /// Number of logical CPU cores.
    pub core_count: usize,
    /// Seconds the system has been running.
    pub uptime: u64,
    /// System-reported battery level (0-100), if available.
    pub battery_percent: Option<u8>,
    /// Whether the machine is currently charging / on AC power, if known.
    pub on_ac_power: Option<bool>,
}

#[tauri::command]
pub async fn get_system_stats(state: State<'_, AppState>) -> Result<SystemStats, String> {
    get_system_stats_inner(state.inner()).await
}

pub async fn get_system_stats_inner(state: &AppState) -> Result<SystemStats, String> {
    let mut monitor = state.system_monitor.lock().await;
    Ok(monitor.sample())
}

/// Holds the sysinfo handles and the previous network counters so we can
/// compute per-second deltas between polls.
pub struct SystemMonitor {
    sys: System,
    networks: Networks,
    last_rx_total: u64,
    last_tx_total: u64,
    last_sample: Option<std::time::Instant>,
}

impl Default for SystemMonitor {
    fn default() -> Self {
        let mut sys = System::new_all();
        sys.refresh_all();
        Self {
            sys,
            networks: Networks::new_with_refreshed_list(),
            last_rx_total: 0,
            last_tx_total: 0,
            last_sample: None,
        }
    }
}

impl SystemMonitor {
    pub fn sample(&mut self) -> SystemStats {
        self.sys.refresh_cpu_all();
        self.sys.refresh_memory();
        self.networks.refresh(true);

        let cpu_per_core: Vec<f32> = self.sys.cpus().iter().map(|c| c.cpu_usage()).collect();
        let core_count = cpu_per_core.len();
        let cpu_usage = self.sys.global_cpu_usage();

        let (rx_total, tx_total) = self
            .networks
            .iter()
            .fold((0u64, 0u64), |(rx, tx), (_, data)| {
                (rx + data.total_received(), tx + data.total_transmitted())
            });

        let elapsed = self
            .last_sample
            .map(|t| t.elapsed().as_secs_f64())
            .filter(|s| *s > 0.0)
            .unwrap_or(1.0);

        let net_rx_per_sec = if self.last_rx_total == 0 {
            0
        } else {
            ((rx_total.saturating_sub(self.last_rx_total)) as f64 / elapsed) as u64
        };
        let net_tx_per_sec = if self.last_tx_total == 0 {
            0
        } else {
            ((tx_total.saturating_sub(self.last_tx_total)) as f64 / elapsed) as u64
        };

        self.last_rx_total = rx_total;
        self.last_tx_total = tx_total;
        self.last_sample = Some(std::time::Instant::now());

        let (battery_percent, on_ac_power) = read_battery();

        // (process list is refreshed separately via `refresh_processes`)

        SystemStats {
            cpu_usage,
            cpu_per_core,
            memory_total: self.sys.total_memory(),
            memory_used: self.sys.used_memory(),
            swap_total: self.sys.total_swap(),
            swap_used: self.sys.used_swap(),
            net_rx_per_sec,
            net_tx_per_sec,
            core_count,
            uptime: System::uptime(),
            battery_percent,
            on_ac_power,
        }
    }

    /// Refreshes the process table without pulling extra per-process detail,
    /// keeping the scan cheap enough to run on a short interval.
    pub fn refresh_processes(&mut self) {
        self.sys.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing(),
        );
    }

    /// Sorted, de-duplicated set of normalized (lowercased, `.exe`-stripped)
    /// process names currently running.
    pub fn process_names(&self) -> BTreeSet<String> {
        self.sys
            .processes()
            .values()
            .map(|p| crate::commands::process_trigger::normalize(&p.name().to_string_lossy()))
            .filter(|n| !n.is_empty())
            .collect()
    }
}

/// Battery reporting is best-effort and platform dependent; returns `(None, None)`
/// when no battery is present or the platform is unsupported.
fn read_battery() -> (Option<u8>, Option<bool>) {
    (None, None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn monitor_sample_reports_cores() {
        let mut monitor = SystemMonitor::default();
        let stats = monitor.sample();
        assert!(stats.core_count > 0);
        assert_eq!(stats.core_count, stats.cpu_per_core.len());
        assert!(stats.memory_total > 0);
    }

    #[test]
    fn first_sample_has_zero_net_rate() {
        let mut monitor = SystemMonitor::default();
        let stats = monitor.sample();
        // No previous counters, so rate must be zero rather than a huge spike.
        assert_eq!(stats.net_rx_per_sec, 0);
        assert_eq!(stats.net_tx_per_sec, 0);
    }
}
