use super::*;
use crate::events::{node_state, EventBus};
use chrono::Utc;
use serde_json::json;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::process::Command;
use tokio::sync::Mutex;
use uuid::Uuid;

const SUPERVISE_INTERVAL: Duration = Duration::from_secs(2);
const GRACEFUL_SHUTDOWN: Duration = Duration::from_secs(10);

pub struct GroupSupervisor {
    host: String,
    bus: Arc<EventBus>,
    groups: Arc<Mutex<HashMap<Uuid, GroupProcess>>>,
    shutdown: Arc<AtomicBool>,
    task: Mutex<Option<tokio::task::JoinHandle<()>>>,
}

impl GroupSupervisor {
    pub fn new(host: String, bus: Arc<EventBus>) -> Self {
        Self {
            host,
            bus,
            groups: Arc::new(Mutex::new(HashMap::new())),
            shutdown: Arc::new(AtomicBool::new(false)),
            task: Mutex::new(None),
        }
    }

    pub async fn start(&self) {
        if let Some(task) = self.task.lock().await.as_ref() {
            if !task.is_finished() {
                return;
            }
        }
        self.shutdown.store(false, Ordering::Relaxed);
        let groups = self.groups.clone();
        let shutdown = self.shutdown.clone();
        let bus = self.bus.clone();
        let task = tokio::spawn(async move {
            loop {
                if shutdown.load(Ordering::Relaxed) {
                    break;
                }
                tokio::time::sleep(SUPERVISE_INTERVAL).await;
                let mut groups = groups.lock().await;
                let dead: Vec<(Uuid, Option<i32>)> = {
                    let mut found = vec![];
                    for (id, group) in groups.iter_mut() {
                        if !group.is_running().await {
                            found.push((*id, group.exit_code().await));
                        }
                    }
                    found
                };
                for (id, code) in dead {
                    groups.remove(&id);
                    tracing::warn!(%id, ?code, "group died on its own; it stays inactive");
                    let mut extra =
                        json!({ "server_id": id.to_string(), "reason": "process_exit" });
                    if let Some(code) = code {
                        extra["exit_code"] = json!(code);
                    }
                    bus.publish_to_all("node.state_changed", node_state("group_down", extra))
                        .await;
                }
            }
        });
        *self.task.lock().await = Some(task);
        self.bus
            .publish_to_all(
                "node.state_changed",
                node_state("up", json!({ "reason": "node_started" })),
            )
            .await;
        tracing::info!("group supervisor started");
    }

    pub async fn stop(&self) {
        self.shutdown.store(true, Ordering::Relaxed);
        if let Some(task) = self.task.lock().await.take() {
            task.abort();
        }
        let ids: Vec<Uuid> = self.groups.lock().await.keys().copied().collect();
        for id in ids {
            self.terminate(id).await;
        }
        self.bus
            .publish_to_all(
                "node.state_changed",
                node_state("down", json!({ "reason": "node_stopped" })),
            )
            .await;
        tracing::info!("group supervisor stopped");
    }

    pub async fn spawn(&self, server_id: Uuid, port: u16) -> u32 {
        if let Some(group) = self.groups.lock().await.get_mut(&server_id) {
            if group.is_running().await {
                return group.child.id().unwrap_or(0);
            }
        }

        let executable = std::env::current_exe().unwrap_or_else(|_| "hazel".into());
        let child = Command::new(executable)
            .arg("group")
            .arg(format!("--server-id={server_id}"))
            .arg(format!("--port={port}"))
            .arg(format!("--host={}", self.host))
            .env("HAZEL_ROLE", "group")
            .stdin(Stdio::null())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|error| format!("could not spawn group process: {error}"))
            .unwrap();

        let pid = child.id().unwrap_or(0);
        self.groups.lock().await.insert(
            server_id,
            GroupProcess {
                server_id,
                port,
                child,
                started_at: Utc::now(),
            },
        );
        self.bus
            .publish_to_all(
                "node.state_changed",
                node_state(
                    "group_up",
                    json!({ "server_id": server_id.to_string(), "port": port }),
                ),
            )
            .await;
        tracing::info!(%server_id, port, pid, "group started");
        pid
    }

    pub async fn terminate(&self, server_id: Uuid) -> bool {
        let mut group = self.groups.lock().await.remove(&server_id);
        let Some(group) = group.as_mut() else {
            return false;
        };
        let pid = group.child.id().unwrap_or(0);
        if group.child.try_wait().ok().flatten().is_none() {
            if pid > 0 {
                // SIGTERM, igual que asyncio.Process.terminate().
                let _ = std::process::Command::new("kill")
                    .arg("-TERM")
                    .arg(pid.to_string())
                    .status();
            }
            if tokio::time::timeout(GRACEFUL_SHUTDOWN, group.child.wait())
                .await
                .is_err()
            {
                let _ = group.child.kill().await;
                let _ = group.child.wait().await;
            }
        }
        self.bus
            .publish_to_all(
                "node.state_changed",
                node_state(
                    "group_down",
                    json!({ "server_id": server_id.to_string(), "reason": "terminated" }),
                ),
            )
            .await;
        true
    }

    pub async fn is_running(&self, server_id: Uuid) -> bool {
        let mut groups = self.groups.lock().await;
        match groups.get_mut(&server_id) {
            Some(group) => group.is_running().await,
            None => false,
        }
    }

    pub async fn port(&self, server_id: Uuid) -> Option<u16> {
        self.groups.lock().await.get(&server_id).map(|g| g.port)
    }

    pub async fn used_ports(&self) -> Vec<i32> {
        self.groups
            .lock()
            .await
            .values()
            .map(|g| g.port as i32)
            .collect()
    }

    pub async fn process_state(&self, server_id: Uuid) -> serde_json::Value {
        let mut groups = self.groups.lock().await;
        let Some(group) = groups.get_mut(&server_id) else {
            return json!({ "running": false, "pid": null, "uptime_seconds": null, "exit_code": null });
        };
        let running = group.is_running().await;
        let pid = group.child.id();
        let uptime = if running {
            json!((group.uptime().await * 10.0).round() / 10.0)
        } else {
            serde_json::Value::Null
        };
        json!({
            "running": running,
            "pid": pid,
            "uptime_seconds": uptime,
            "exit_code": if running { serde_json::Value::Null } else { json!(group.exit_code().await) },
        })
    }

    pub async fn wait_ready(&self, server_id: Uuid, timeout: Duration) -> bool {
        let port = self.port(server_id).await;
        let Some(port) = port else { return false };
        let deadline = tokio::time::Instant::now() + timeout;
        while tokio::time::Instant::now() < deadline {
            if !self.is_running(server_id).await {
                tracing::error!(%server_id, "group died before becoming ready");
                return false;
            }
            if tokio::net::TcpStream::connect(("127.0.0.1", port))
                .await
                .is_ok()
            {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        tracing::warn!(%server_id, "group did not respond in time");
        false
    }
}
