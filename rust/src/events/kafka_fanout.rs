use std::sync::Arc;
use std::time::Duration;

use futures::StreamExt;
use rdkafka::config::ClientConfig;
use rdkafka::consumer::{Consumer, StreamConsumer};
use rdkafka::message::Message;
use rdkafka::producer::{FutureProducer, FutureRecord};
use serde_json::{json, Value};
use tokio::sync::{Mutex, RwLock};
use uuid::Uuid;

use crate::config::Settings;

use super::*;

pub struct KafkaFanout {
    state: Arc<RwLock<&'static str>>,
    instance_id: String,
    topic: String,
    producer: Option<FutureProducer>,
    bus: Arc<EventBus>,
    task: Mutex<Option<tokio::task::JoinHandle<()>>>,
}

impl KafkaFanout {
    pub async fn start(settings: &Settings, bus: Arc<EventBus>) -> Self {
        let instance_id = format!(
            "{}-{}",
            settings.kafka_client_id_resolved(),
            &Uuid::new_v4().simple().to_string()[..8]
        );
        let topic = settings.kafka_topic("events");

        if !settings.kafka_fanout_enabled {
            let fanout = Self {
                state: Arc::new(RwLock::new("disabled")),
                instance_id,
                topic,
                producer: None,
                bus,
                task: Mutex::new(None),
            };
            return fanout;
        }

        let bootstrap = settings.kafka_bootstrap_servers.join(",");
        let producer: Result<FutureProducer, _> = ClientConfig::new()
            .set("bootstrap.servers", &bootstrap)
            .set("client.id", &instance_id)
            .create();
        let consumer: Result<StreamConsumer, _> = ClientConfig::new()
            .set("bootstrap.servers", &bootstrap)
            .set("client.id", &instance_id)
            .set("group.id", &instance_id)
            .set("auto.offset.reset", "latest")
            .set("enable.auto.commit", "true")
            .create();

        let fanout = Self {
            state: Arc::new(RwLock::new("stopped")),
            instance_id,
            topic,
            producer: producer.ok(),
            bus,
            task: Mutex::new(None),
        };

        match (&fanout.producer, consumer) {
            (Some(_), Ok(consumer)) => {
                let consumer_result = consumer.subscribe(&[&fanout.topic]);
                if consumer_result.is_err() {
                    *fanout.state.write().await = "error";
                    tracing::error!("kafka fanout could not subscribe; continuing with local bus");
                    return fanout;
                }
                let bus = fanout.bus.clone();
                let instance = fanout.instance_id.clone();
                let task = tokio::spawn(async move {
                    let mut stream = consumer.stream();
                    while let Some(message) = stream.next().await {
                        let Ok(message) = message else { continue };
                        let Some(payload) = message.payload() else {
                            continue;
                        };
                        let Ok(payload) = serde_json::from_slice::<Value>(payload) else {
                            continue;
                        };
                        if payload.get("instance").and_then(Value::as_str)
                            == Some(instance.as_str())
                        {
                            continue;
                        }
                        let Some(event) = payload.get("event").cloned() else {
                            continue;
                        };
                        let Some(server_id) = event
                            .get("server_id")
                            .and_then(Value::as_str)
                            .and_then(|s| Uuid::parse_str(s).ok())
                        else {
                            continue;
                        };
                        let channel_id = event
                            .get("channel_id")
                            .and_then(Value::as_str)
                            .and_then(|s| Uuid::parse_str(s).ok());
                        bus.publish(server_id, channel_id, event).await;
                    }
                });
                *fanout.task.lock().await = Some(task);
                *fanout.state.write().await = "ok";
                tracing::info!(topic = %fanout.topic, instance = %fanout.instance_id, "kafka fanout started");
            }
            _ => {
                *fanout.state.write().await = "error";
                tracing::error!("kafka fanout could not start; continuing with the local bus only");
            }
        }
        fanout
    }

    pub async fn state(&self) -> String {
        (*self.state.read().await).to_string()
    }

    pub async fn publish(&self, event: Value) {
        if *self.state.read().await != "ok" {
            return;
        }
        let Some(producer) = &self.producer else {
            return;
        };
        let payload = json!({ "instance": self.instance_id, "event": event });
        let key = event
            .get("server_id")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let payload = payload.to_string();
        let record = FutureRecord::to(&self.topic).key(&key).payload(&payload);
        if let Err((error, _)) = producer.send(record, Duration::from_secs(5)).await {
            tracing::warn!(%error, "could not publish event to kafka");
        }
    }

    pub async fn stop(&self) {
        if let Some(task) = self.task.lock().await.take() {
            task.abort();
        }
        *self.state.write().await = "stopped";
    }
}
