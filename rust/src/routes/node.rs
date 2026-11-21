use std::sync::Arc;

use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};

use crate::error::ApiResult;
use crate::models::{NodeAddress, NodeInfo, VERSION};
use crate::state::AppState;
use crate::utils::local_addresses;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/", get(node_info))
        .route("/address", get(node_address))
}

async fn node_info(State(state): State<Arc<AppState>>) -> Json<NodeInfo> {
    Json(NodeInfo {
        service: "hazel-node",
        version: VERSION,
        environment: state.settings.env.clone(),
        bind_host: state.settings.host.clone(),
        bind_port: state.settings.port,
        is_listening: true,
        kafka_topic_prefix: state.settings.kafka_topic_prefix.clone(),
    })
}

async fn node_address(State(state): State<Arc<AppState>>) -> ApiResult<Json<NodeAddress>> {
    let candidates = local_addresses(false);
    Ok(Json(NodeAddress {
        port: state.settings.port,
        bind_host: state.settings.host.clone(),
        is_wildcard: state.settings.bind_host_is_wildcard(),
        recommended: candidates.first().map(|a| a.host.clone()),
        candidates,
    }))
}
