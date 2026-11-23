//! Estado compartido de la aplicación.

use std::collections::HashSet;
use std::net::IpAddr;
use std::sync::Arc;

use sqlx::PgPool;

use crate::calls::CallManager;
use crate::config::Settings;
use crate::error::ApiResult;
use crate::events::{drain_outbox, EventBus, KafkaFanout};
use crate::supervisor::GroupSupervisor;
use crate::utils::is_host_address;
use uuid::Uuid;

pub struct AppState {
    pub pool: PgPool,
    pub settings: Arc<Settings>,
    pub bus: Arc<EventBus>,
    pub kafka: Arc<KafkaFanout>,
    pub supervisor: Option<Arc<GroupSupervisor>>,
    pub calls: Arc<CallManager>,
    /// Direcciones de la máquina anfitriona; solo desde ellas se gestiona el nodo.
    pub host_ips: HashSet<IpAddr>,
    /// Some(...) cuando el proceso es un grupo (no el nodo).
    pub server_id: Option<Uuid>,
}

impl AppState {
    pub fn is_host(&self, ip: IpAddr) -> bool {
        is_host_address(ip, &self.host_ips)
    }

    /// Confirma la transacción y publica los eventos que la misma transacción
    /// dejó en la outbox. Equivale al hook post-commit de `core.api.deps`.
    pub async fn finish(&self, tx: sqlx::Transaction<'_, sqlx::Postgres>) -> ApiResult<()> {
        tx.commit().await?;
        drain_outbox(&self.pool, &self.bus, &self.kafka).await
    }
}
