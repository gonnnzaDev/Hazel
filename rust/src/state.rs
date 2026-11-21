//! Estado compartido de la aplicación.

use std::sync::Arc;

use sqlx::PgPool;

use crate::calls::CallManager;
use crate::config::Settings;
use crate::error::ApiResult;
use crate::events::{drain_outbox, EventBus, KafkaFanout};
use crate::supervisor::GroupSupervisor;
use uuid::Uuid;

pub struct AppState {
    pub pool: PgPool,
    pub settings: Arc<Settings>,
    pub bus: Arc<EventBus>,
    pub kafka: Arc<KafkaFanout>,
    pub supervisor: Option<Arc<GroupSupervisor>>,
    pub calls: Arc<CallManager>,
    /// Some(...) cuando el proceso es un grupo (no el nodo).
    pub server_id: Option<Uuid>,
}

impl AppState {
    /// Confirma la transacción y publica los eventos que la misma transacción
    /// dejó en la outbox. Equivale al hook post-commit de `core.api.deps`.
    pub async fn finish(&self, tx: sqlx::Transaction<'_, sqlx::Postgres>) -> ApiResult<()> {
        tx.commit().await?;
        drain_outbox(&self.pool, &self.bus, &self.kafka).await
    }
}
