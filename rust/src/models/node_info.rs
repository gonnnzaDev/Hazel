use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct NodeInfo {
    pub service: &'static str,
    pub version: &'static str,
    pub environment: String,
    pub bind_host: String,
    pub bind_port: u16,
    pub is_listening: bool,
    /// `true` cuando la petición llega desde la máquina anfitriona del nodo.
    pub can_manage: bool,
    pub kafka_topic_prefix: String,
}
