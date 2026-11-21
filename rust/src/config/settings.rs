use super::*;

#[derive(Debug, Clone)]
pub struct Settings {
    pub env: String,
    pub debug: bool,
    pub secret_key: String,
    pub admin_token: String,
    pub storage_root: String,
    pub backup_retention_days: i64,
    pub host: String,
    pub port: u16,
    pub group_port_end: u16,
    pub root_path: String,
    pub cors_origins: Vec<String>,
    pub database_url: String,
    pub db_pool_size: u32,
    pub db_max_overflow: u32,
    pub db_echo: bool,
    pub kafka_bootstrap_servers: Vec<String>,
    pub kafka_topic_prefix: String,
    pub kafka_client_id: String,
    pub kafka_max_poll_records: i64,
    pub rate_limit_messages_per_minute: i64,
    pub max_message_bytes: usize,
    pub max_attachment_bytes: usize,
    pub call_max_participants: usize,
    pub call_ice_servers: Vec<String>,
    pub typing_rate_per_minute: i64,
    pub websocket_idle_timeout_seconds: u64,
    pub websocket_queue_size: usize,
    pub kafka_fanout_enabled: bool,
}

impl Settings {
    pub fn load() -> Result<Self, String> {
        load_dotenv();

        let secret_key = string("SECRET_KEY", "");
        if secret_key.is_empty() {
            return Err("Missing required configuration variables: secret_key\n\
                 Generate your .env with `python -m composer setup` or define the variables \
                 in the environment."
                .to_string());
        }

        let env = string("ENV", "local");
        if !matches!(env.as_str(), "local" | "test" | "prod") {
            return Err(format!("Invalid configuration: HAZEL_ENV={env}"));
        }

        let port = int("PORT", 7272);
        let group_port_end = int("GROUP_PORT_END", 7400);

        Ok(Self {
            env,
            debug: boolean("DEBUG", false),
            secret_key,
            admin_token: string("ADMIN_TOKEN", ""),
            storage_root: string("STORAGE_ROOT", "/data/hazel"),
            backup_retention_days: int("BACKUP_RETENTION_DAYS", 3),
            host: string("HOST", "0.0.0.0"),
            port: port as u16,
            group_port_end: group_port_end as u16,
            root_path: string("ROOT_PATH", ""),
            cors_origins: csv("CORS_ORIGINS", &["*"]),
            database_url: string(
                "DATABASE_URL",
                "postgresql+asyncpg://hazel:hazel@localhost:5432/hazel",
            ),
            db_pool_size: int("DB_POOL_SIZE", 10) as u32,
            db_max_overflow: int("DB_MAX_OVERFLOW", 20) as u32,
            db_echo: boolean("DB_ECHO", false),
            kafka_bootstrap_servers: csv("KAFKA_BOOTSTRAP_SERVERS", &["localhost:9092"]),
            kafka_topic_prefix: string("KAFKA_TOPIC_PREFIX", "hazel"),
            kafka_client_id: string("KAFKA_CLIENT_ID", ""),
            kafka_max_poll_records: int("KAFKA_MAX_POLL_RECORDS", 500),
            rate_limit_messages_per_minute: int("RATE_LIMIT_MESSAGES_PER_MINUTE", 20),
            max_message_bytes: int("MAX_MESSAGE_BYTES", 4000) as usize,
            max_attachment_bytes: int("MAX_ATTACHMENT_BYTES", 25_000_000) as usize,
            call_max_participants: int("CALL_MAX_PARTICIPANTS", 16) as usize,
            call_ice_servers: csv("CALL_ICE_SERVERS", &[]),
            typing_rate_per_minute: int("TYPING_RATE_PER_MINUTE", 15),
            websocket_idle_timeout_seconds: int("WEBSOCKET_IDLE_TIMEOUT_SECONDS", 300) as u64,
            websocket_queue_size: int("WEBSOCKET_QUEUE_SIZE", 128) as usize,
            kafka_fanout_enabled: boolean("KAFKA_FANOUT_ENABLED", true),
        })
    }

    /// `postgresql+asyncpg://` → `postgresql://` (lo que entiende sqlx/libpq).
    pub fn sync_database_url(&self) -> String {
        self.database_url.replacen("+asyncpg", "", 1)
    }

    pub fn kafka_client_id_resolved(&self) -> String {
        if self.kafka_client_id.is_empty() {
            format!("hazel-{}", self.env)
        } else {
            self.kafka_client_id.clone()
        }
    }

    pub fn kafka_topic(&self, name: &str) -> String {
        format!("{}.{}", self.kafka_topic_prefix, name)
    }

    pub fn bind_host_is_wildcard(&self) -> bool {
        matches!(self.host.trim(), "0.0.0.0" | "::" | "[::]")
    }
}
