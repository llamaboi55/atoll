//! System stats for the Stats tab. Refreshed only while the tab is open.

use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;
use sysinfo::{Disks, Networks, ProcessesToUpdate, System};

pub struct StatsState {
    sys: Mutex<System>,
    net: Mutex<(Networks, Instant)>,
}

impl StatsState {
    pub fn new() -> Self {
        Self {
            sys: Mutex::new(System::new()),
            net: Mutex::new((Networks::new_with_refreshed_list(), Instant::now())),
        }
    }
}

#[derive(Serialize)]
pub struct ProcessRow {
    name: String,
    memory: u64,
    cpu: f32,
    count: usize,
}

#[derive(Serialize)]
pub struct DiskRow {
    name: String,
    mount: String,
    total: u64,
    available: u64,
}

#[derive(Serialize)]
pub struct Stats {
    cpu: f32,
    cores: usize,
    memory_used: u64,
    memory_total: u64,
    uptime: u64,
    top: Vec<ProcessRow>,
    disks: Vec<DiskRow>,
    rx_per_sec: f64,
    tx_per_sec: f64,
    os: String,
    host: String,
}

/// Same-named processes (browser tabs, helpers) are grouped, like a person would count them.
pub fn group_processes(rows: impl Iterator<Item = (String, u64, f32)>, limit: usize) -> Vec<ProcessRow> {
    let mut map: HashMap<String, ProcessRow> = HashMap::new();
    for (name, memory, cpu) in rows {
        let key = name.trim_end_matches(".exe").to_string();
        let entry = map.entry(key.clone()).or_insert(ProcessRow { name: key, memory: 0, cpu: 0.0, count: 0 });
        entry.memory += memory;
        entry.cpu += cpu;
        entry.count += 1;
    }
    let mut out: Vec<ProcessRow> = map.into_values().collect();
    out.sort_by(|a, b| b.memory.cmp(&a.memory));
    out.truncate(limit);
    out
}

#[tauri::command]
pub fn stats(state: tauri::State<StatsState>) -> Stats {
    let mut sys = state.sys.lock().unwrap();
    sys.refresh_cpu_usage();
    sys.refresh_memory();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    let cores = sys.cpus().len();
    let top = group_processes(
        // On Linux, sysinfo also lists each thread as a task; count real processes only.
        sys.processes().values().filter(|p| p.thread_kind().is_none()).map(|p| {
            (p.name().to_string_lossy().into_owned(), p.memory(), p.cpu_usage() / cores.max(1) as f32)
        }),
        6,
    );

    let disks = Disks::new_with_refreshed_list()
        .list()
        .iter()
        .filter(|d| d.total_space() > 1_000_000_000 && d.total_space() < 1u64 << 50)
        .map(|d| DiskRow {
            name: d.name().to_string_lossy().into_owned(),
            mount: d.mount_point().to_string_lossy().into_owned(),
            total: d.total_space(),
            available: d.available_space(),
        })
        .take(4)
        .collect();

    let (rx_per_sec, tx_per_sec) = {
        let mut guard = state.net.lock().unwrap();
        let (networks, last) = &mut *guard;
        networks.refresh(true);
        let secs = last.elapsed().as_secs_f64().max(0.2);
        *last = Instant::now();
        let (rx, tx) = networks.iter().fold((0u64, 0u64), |acc, (_, d)| (acc.0 + d.received(), acc.1 + d.transmitted()));
        (rx as f64 / secs, tx as f64 / secs)
    };

    Stats {
        cpu: sys.global_cpu_usage(),
        cores,
        memory_used: sys.used_memory(),
        memory_total: sys.total_memory(),
        uptime: System::uptime(),
        top,
        disks,
        rx_per_sec,
        tx_per_sec,
        os: System::long_os_version().unwrap_or_default(),
        host: System::host_name().unwrap_or_default(),
    }
}

#[derive(Serialize)]
pub struct SpeedResult {
    down_mbps: f64,
    latency_ms: f64,
}

/// Download test against Cloudflare's public speed endpoint (no account, no tracking ids).
#[tauri::command]
pub async fn speed_test() -> Result<SpeedResult, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let t0 = Instant::now();
    client
        .get("https://speed.cloudflare.com/__down?bytes=0")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let latency_ms = t0.elapsed().as_secs_f64() * 1000.0;

    let bytes = 25_000_000u64;
    let t1 = Instant::now();
    let body = client
        .get(format!("https://speed.cloudflare.com/__down?bytes={bytes}"))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;
    let secs = t1.elapsed().as_secs_f64().max(0.001);
    Ok(SpeedResult { down_mbps: body.len() as f64 * 8.0 / secs / 1_000_000.0, latency_ms })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn groups_and_sorts_processes() {
        let rows = vec![
            ("chrome.exe".to_string(), 100, 1.0),
            ("chrome.exe".to_string(), 300, 2.0),
            ("code".to_string(), 250, 5.0),
            ("tiny".to_string(), 1, 0.0),
        ];
        let out = group_processes(rows.into_iter(), 2);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].name, "chrome");
        assert_eq!(out[0].memory, 400);
        assert_eq!(out[0].count, 2);
        assert_eq!(out[1].name, "code");
    }
}
