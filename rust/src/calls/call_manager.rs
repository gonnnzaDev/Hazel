use super::*;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Default)]
pub struct CallManager {
    rooms: Mutex<HashMap<String, HashMap<String, Arc<Peer>>>>,
}

impl CallManager {
    pub async fn join(&self, channel_id: &str, peer: Arc<Peer>) -> Vec<Arc<Peer>> {
        let mut rooms = self.rooms.lock().await;
        let room = rooms.entry(channel_id.to_string()).or_default();
        let existing: Vec<_> = room
            .values()
            .filter(|p| p.member_id != peer.member_id)
            .cloned()
            .collect();
        room.insert(peer.member_id.clone(), peer);
        existing
    }

    pub async fn leave(&self, channel_id: &str, member_id: &str) -> Vec<Arc<Peer>> {
        let mut rooms = self.rooms.lock().await;
        let Some(room) = rooms.get_mut(channel_id) else {
            return vec![];
        };
        room.remove(member_id);
        let remaining: Vec<_> = room.values().cloned().collect();
        if room.is_empty() {
            rooms.remove(channel_id);
        }
        remaining
    }

    pub async fn update_state(
        &self,
        channel_id: &str,
        member_id: &str,
        mic: bool,
        cam: bool,
    ) -> Option<(bool, bool)> {
        let rooms = self.rooms.lock().await;
        let peer = rooms.get(channel_id)?.get(member_id)?;
        let mut state = peer.state.lock().await;
        *state = (mic, cam);
        Some(*state)
    }

    pub async fn get(&self, channel_id: &str, member_id: &str) -> Option<Arc<Peer>> {
        let rooms = self.rooms.lock().await;
        rooms.get(channel_id)?.get(member_id).cloned()
    }

    pub async fn targets(&self, channel_id: &str, exclude: Option<&str>) -> Vec<Arc<Peer>> {
        let rooms = self.rooms.lock().await;
        let Some(room) = rooms.get(channel_id) else {
            return vec![];
        };
        room.values()
            .filter(|p| Some(p.member_id.as_str()) != exclude)
            .cloned()
            .collect()
    }

    pub async fn broadcast(&self, channel_id: &str, message: Value, exclude: Option<&str>) {
        for peer in self.targets(channel_id, exclude).await {
            let _ = peer.send.send(message.clone()).await;
        }
    }

    pub async fn send_to(&self, channel_id: &str, member_id: &str, message: Value) -> bool {
        let Some(peer) = self.get(channel_id, member_id).await else {
            return false;
        };
        peer.send.send(message).await.is_ok()
    }

    pub async fn snapshot(&self, channel_id: &str) -> Vec<Value> {
        let rooms = self.rooms.lock().await;
        let Some(room) = rooms.get(channel_id) else {
            return vec![];
        };
        let mut result = vec![];
        for peer in room.values() {
            result.push(peer.public().await);
        }
        result
    }

    pub async fn count(&self, channel_id: &str) -> usize {
        let rooms = self.rooms.lock().await;
        rooms.get(channel_id).map(|r| r.len()).unwrap_or(0)
    }
}
