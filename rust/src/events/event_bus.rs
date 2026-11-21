use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde_json::Value;
use tokio::sync::{broadcast, Mutex};
use uuid::Uuid;

use super::*;

pub struct EventBus {
    inner: Mutex<BusInner>,
    queue_size: usize,
}

impl EventBus {
    pub fn new(queue_size: usize) -> Self {
        Self {
            inner: Mutex::new(BusInner::default()),
            queue_size,
        }
    }

    pub fn configure(&self, _queue_size: usize) {
        // El tamaño de cola se fija al crear el bus (al arrancar el proceso).
    }

    pub async fn subscribe(
        &self,
        server_id: Uuid,
        member_id: Uuid,
        nickname: String,
        display_name: Option<String>,
    ) -> (Arc<Subscription>, bool) {
        let (tx, _) = broadcast::channel(self.queue_size);
        let sub = Arc::new(Subscription {
            id: Uuid::new_v4(),
            server_id,
            member_id,
            nickname,
            display_name,
            channels: Mutex::new(HashSet::new()),
            tx,
            closed: AtomicBool::new(false),
        });
        let mut inner = self.inner.lock().await;
        inner.subs.insert(sub.id, sub.clone());
        let key = (server_id, member_id);
        let count = inner.sockets_by_member.entry(key).or_insert(0);
        *count += 1;
        (sub, *count == 1)
    }

    pub async fn unsubscribe(&self, sub: &Subscription) -> bool {
        let mut inner = self.inner.lock().await;
        inner.subs.remove(&sub.id);
        let key = (sub.server_id, sub.member_id);
        match inner.sockets_by_member.get_mut(&key) {
            Some(count) if *count > 1 => {
                *count -= 1;
                false
            }
            _ => {
                inner.sockets_by_member.remove(&key);
                true
            }
        }
    }

    pub async fn subscribe_channel(&self, sub: &Subscription, channel_id: Uuid) {
        sub.channels.lock().await.insert(channel_id);
    }

    pub async fn unsubscribe_channel(&self, sub: &Subscription, channel_id: Uuid) {
        sub.channels.lock().await.remove(&channel_id);
    }

    pub async fn is_subscribed(&self, sub: &Subscription, channel_id: Uuid) -> bool {
        sub.channels.lock().await.contains(&channel_id)
    }

    pub async fn publish(&self, server_id: Uuid, channel_id: Option<Uuid>, event: Value) {
        let candidates: Vec<Arc<Subscription>> = {
            let inner = self.inner.lock().await;
            inner
                .subs
                .values()
                .filter(|sub| sub.server_id == server_id && !sub.closed.load(Ordering::Relaxed))
                .cloned()
                .collect()
        };
        // `blocking_lock()` aquí panicaría dentro del runtime de tokio: el
        // filtrado por canal se hace con `.lock().await` fuera del `Mutex` del bus.
        let targets = match channel_id {
            Some(id) => {
                let mut selected = Vec::new();
                for sub in candidates {
                    if sub.channels.lock().await.contains(&id) {
                        selected.push(sub);
                    }
                }
                selected
            }
            None => candidates,
        };
        self.enqueue(targets, event).await;
    }

    pub async fn publish_to_all(&self, event_type: &str, data: Value) {
        let server_ids: Vec<Uuid> = {
            let inner = self.inner.lock().await;
            inner
                .subs
                .values()
                .map(|sub| sub.server_id)
                .collect::<HashSet<_>>()
                .into_iter()
                .collect()
        };
        for server_id in server_ids {
            self.publish(
                server_id,
                None,
                envelope(event_type, server_id, None, data.clone()),
            )
            .await;
        }
    }

    async fn enqueue(&self, targets: Vec<Arc<Subscription>>, event: Value) {
        let mut stale = vec![];
        for sub in targets {
            if sub.tx.receiver_count() == 0 || sub.tx.send(event.clone()).is_err() {
                tracing::warn!(member = %sub.member_id, "socket too slow; closing it");
                sub.closed.store(true, Ordering::Relaxed);
                stale.push(sub.id);
            }
        }
        if !stale.is_empty() {
            let mut inner = self.inner.lock().await;
            for id in stale {
                inner.subs.remove(&id);
            }
        }
    }

    pub async fn direct(&self, sub: &Subscription, event: Value) {
        let _ = sub.tx.send(event);
    }

    pub async fn close_all(&self) {
        let mut inner = self.inner.lock().await;
        for sub in inner.subs.values() {
            sub.closed.store(true, Ordering::Relaxed);
        }
        inner.subs.clear();
        inner.sockets_by_member.clear();
    }
}
