use std::sync::Arc;

use axum::extract::State;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use chrono::Utc;
use serde_json::json;

use crate::error::ApiResult;
use crate::models::{HealthResponse, VERSION};
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/", get(health))
        .route("/ready", get(readiness))
}

async fn health(State(state): State<Arc<AppState>>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        service: "hazel-node",
        version: VERSION,
        environment: state.settings.env.clone(),
        timestamp: Utc::now(),
    })
}

async fn readiness(State(state): State<Arc<AppState>>) -> ApiResult<axum::response::Response> {
    let database = match sqlx::query("SELECT 1").execute(&state.pool).await {
        Ok(_) => "ok".to_string(),
        Err(error) => format!("error: {error}"),
    };
    let ready = database == "ok";
    let body = json!({
        "status": if ready { "ready" } else { "unavailable" },
        "checks": {
            "database": database,
            "kafka": state.kafka.state().await,
        }
    });
    let status = if ready {
        axum::http::StatusCode::OK
    } else {
        axum::http::StatusCode::SERVICE_UNAVAILABLE
    };
    Ok((status, Json(body)).into_response())
}
