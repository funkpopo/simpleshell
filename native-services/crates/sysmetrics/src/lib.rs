//! `system-metrics`: local machine metrics for the system panel.
//!
//! Stdin is a JSON request, stdout the JSON answer:
//!
//! * `{"op": "sample"}` → `{cpu, memory {total, used, free, usagePercent},
//!   net {rxPerSec, txPerSec}, diskIo {readPerSec, writePerSec}, disks [...]}`
//! * `{"op": "processes"}` → `[{pid, name, cpu, memory, memoryBytes}]`
//!   (`cpu` and `memory` in percent of the machine)
//! * `{"op": "cpu"}` → `{cpu}`
//! * `{"op": "disks"}` → the `disks` of a sample, without touching the
//!   counters behind the rates
//!
//! Usage figures are rates since the previous request; the counters live in
//! the resident core for its lifetime. A first request measures over
//! sysinfo's minimum interval; rates it cannot know yet are `null`.

use core_protocol::service::{self, Input};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;
use sysinfo::{Disks, Networks, ProcessesToUpdate, System, MINIMUM_CPU_UPDATE_INTERVAL};
use tokio::io::AsyncReadExt;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
enum Op {
    Sample,
    Processes,
    Cpu,
    Disks,
}

#[derive(Deserialize)]
struct Request {
    op: Op,
}

struct Counters {
    system: System,
    networks: Networks,
    disks: Disks,
    /// When CPU usage / processes / networks / disks were last refreshed.
    cpu_at: Option<Instant>,
    processes_at: Option<Instant>,
    io_at: Option<Instant>,
}

impl Counters {
    fn new() -> Result<Self, String> {
        let error = |error: sysinfo::Error| format!("system metrics unavailable: {error}");
        Ok(Self {
            system: System::new().map_err(error)?,
            networks: Networks::new_with_refreshed_list().map_err(error)?,
            disks: Disks::new_with_refreshed_list().map_err(error)?,
            cpu_at: None,
            processes_at: None,
            io_at: None,
        })
    }

    /// CPU usage needs two measurements at least the minimum interval apart.
    fn refresh_cpu(&mut self) {
        if self.cpu_at.is_none() {
            self.system.refresh_cpu_usage();
            std::thread::sleep(MINIMUM_CPU_UPDATE_INTERVAL);
        }
        self.system.refresh_cpu_usage();
        self.cpu_at = Some(Instant::now());
    }

    fn cpu(&mut self) -> f64 {
        self.refresh_cpu();
        clamp_percent(self.system.global_cpu_usage() as f64)
    }

    fn sample(&mut self) -> Value {
        let cpu = self.cpu();
        self.system.refresh_memory();
        let total = self.system.total_memory();
        let free = self.system.available_memory();
        let used = total.saturating_sub(free);

        let elapsed = self.io_at.map(|at| at.elapsed().as_secs_f64());
        self.networks.refresh(true);
        self.disks.refresh(true);
        self.io_at = Some(Instant::now());
        let rate = |bytes: u64| {
            elapsed
                .filter(|secs| *secs > 0.0)
                .map(|secs| bytes as f64 / secs)
        };

        let (mut rx, mut tx) = (0, 0);
        for (name, data) in &self.networks {
            if is_loopback(&name.to_string_lossy()) {
                continue;
            }
            rx += data.received();
            tx += data.transmitted();
        }
        let (mut read, mut written) = (0, 0);
        for disk in &self.disks {
            let usage = disk.usage();
            read += usage.read_bytes;
            written += usage.written_bytes;
        }
        let disks = disk_entries(&self.disks);
        json!({
            "cpu": cpu,
            "memory": {
                "total": total,
                "used": used,
                "free": free,
                "usagePercent": if total > 0 { clamp_percent(used as f64 * 100.0 / total as f64) } else { 0.0 },
            },
            "net": {"rxPerSec": rate(rx), "txPerSec": rate(tx)},
            "diskIo": {"readPerSec": rate(read), "writePerSec": rate(written)},
            "disks": disks,
        })
    }

    fn processes(&mut self) -> Value {
        if self.processes_at.is_none() {
            self.system.refresh_processes(ProcessesToUpdate::All, true);
            std::thread::sleep(MINIMUM_CPU_UPDATE_INTERVAL);
        }
        self.system.refresh_processes(ProcessesToUpdate::All, true);
        self.system.refresh_memory();
        self.processes_at = Some(Instant::now());
        let cores = self.system.cpus().len().max(1) as f64;
        let total = self.system.total_memory().max(1) as f64;
        let mut list: Vec<Value> = self
            .system
            .processes()
            .values()
            .map(|process| {
                let memory = process.memory();
                json!({
                    "pid": process.pid().as_u32(),
                    "name": process.name().to_string_lossy(),
                    // sysinfo counts one core as 100 %.
                    "cpu": round2(process.cpu_usage() as f64 / cores),
                    "memory": round2(memory as f64 * 100.0 / total),
                    "memoryBytes": memory,
                })
            })
            .collect();
        list.sort_by(|a, b| b["memoryBytes"].as_u64().cmp(&a["memoryBytes"].as_u64()));
        Value::Array(list)
    }
}

/// Mounted file systems with their space, fullest first.
fn disk_entries(disks: &Disks) -> Vec<Value> {
    let mut entries: Vec<(f64, Value)> = disks
        .iter()
        .filter(|disk| disk.total_space() > 0)
        .map(|disk| {
            let total = disk.total_space();
            let free = disk.available_space();
            let used = total.saturating_sub(free);
            let percent = clamp_percent(used as f64 * 100.0 / total as f64);
            let entry = json!({
                "mount": disk.mount_point().to_string_lossy(),
                "total": total,
                "used": used,
                "free": free,
                "usedPercent": percent,
            });
            (percent, entry)
        })
        .collect();
    entries.sort_by(|a, b| b.0.total_cmp(&a.0));
    entries.into_iter().map(|(_, entry)| entry).collect()
}

fn is_loopback(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower == "lo" || lower.starts_with("lo0") || lower.contains("loopback")
}

fn clamp_percent(value: f64) -> f64 {
    if value.is_finite() {
        round2(value.clamp(0.0, 100.0))
    } else {
        0.0
    }
}

fn round2(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

fn counters() -> &'static Mutex<Option<Counters>> {
    static COUNTERS: OnceLock<Mutex<Option<Counters>>> = OnceLock::new();
    COUNTERS.get_or_init(|| Mutex::new(None))
}

fn answer(op: Op) -> Result<Value, String> {
    if let Op::Disks = op {
        let disks = Disks::new_with_refreshed_list()
            .map_err(|error| format!("disks unavailable: {error}"))?;
        return Ok(Value::Array(disk_entries(&disks)));
    }
    let mut guard = counters()
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    if guard.is_none() {
        *guard = Some(Counters::new()?);
    }
    let counters = guard.as_mut().expect("initialized above");
    Ok(match op {
        Op::Sample => counters.sample(),
        Op::Processes => counters.processes(),
        Op::Cpu => json!({"cpu": counters.cpu()}),
        Op::Disks => unreachable!("answered without counters"),
    })
}

pub async fn run(mut input: Input) -> Result<(), String> {
    let mut request = String::new();
    input
        .read_to_string(&mut request)
        .await
        .map_err(|error| format!("failed to read request: {error}"))?;
    let request: Request =
        serde_json::from_str(&request).map_err(|error| format!("invalid request: {error}"))?;
    let value = tokio::task::spawn_blocking(move || answer(request.op))
        .await
        .map_err(|error| error.to_string())??;
    service::emit_json(&value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn samples_rates_from_the_second_request_on() {
        let first = answer(Op::Sample).unwrap();
        let cpu = first["cpu"].as_f64().unwrap();
        assert!((0.0..=100.0).contains(&cpu));
        assert!(first["memory"]["total"].as_u64().unwrap() > 0);
        assert!(
            first["memory"]["used"].as_u64().unwrap() <= first["memory"]["total"].as_u64().unwrap()
        );
        assert!(!first["disks"].as_array().unwrap().is_empty());

        std::thread::sleep(std::time::Duration::from_millis(50));
        let second = answer(Op::Sample).unwrap();
        assert!(second["net"]["rxPerSec"].as_f64().is_some(), "{second}");
        assert!(
            second["diskIo"]["readPerSec"].as_f64().is_some(),
            "{second}"
        );
    }

    #[test]
    fn lists_processes_including_this_one() {
        let list = answer(Op::Processes).unwrap();
        let me = std::process::id();
        let entry = list
            .as_array()
            .unwrap()
            .iter()
            .find(|process| process["pid"] == me)
            .expect("own process listed");
        assert!(entry["memoryBytes"].as_u64().unwrap() > 0);
        assert!(entry["name"].as_str().is_some_and(|name| !name.is_empty()));
    }

    #[test]
    fn lists_disks_fullest_first() {
        let disks = answer(Op::Disks).unwrap();
        let percents: Vec<f64> = disks
            .as_array()
            .unwrap()
            .iter()
            .map(|disk| disk["usedPercent"].as_f64().unwrap())
            .collect();
        assert!(!percents.is_empty());
        assert!(percents.windows(2).all(|pair| pair[0] >= pair[1]));
    }

    #[test]
    fn recognizes_loopback_interfaces() {
        assert!(is_loopback("lo"));
        assert!(is_loopback("Loopback Pseudo-Interface 1"));
        assert!(!is_loopback("eth0"));
        assert!(!is_loopback("WLAN"));
    }
}
