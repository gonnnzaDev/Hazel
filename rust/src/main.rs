use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use sqlx::postgres::PgPoolOptions;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use uuid::Uuid;

use hazel::calls::CallManager;
use hazel::config::settings;
use hazel::events::{EventBus, KafkaFanout};
use hazel::routes::app_router;
use hazel::state::AppState;
use hazel::supervisor::GroupSupervisor;
use hazel::utils::host_ips;

#[derive(Debug)]
enum Role {
    Node {
        host: Option<String>,
        port: Option<u16>,
    },
    Group {
        server_id: Uuid,
        host: Option<String>,
        port: u16,
    },
}

fn parse_args() -> Role {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let role = args.first().map(String::as_str).unwrap_or("node");
    let value = |key: &str| -> Option<String> {
        args.iter().find_map(|arg| {
            arg.strip_prefix(&format!("--{key}="))
                .map(str::to_string)
                .or_else(|| arg.strip_prefix(&format!("--{key} ")).map(str::to_string))
        })
    };
    match role {
        "group" => {
            let server_id = value("server-id")
                .and_then(|v| Uuid::parse_str(&v).ok())
                .unwrap_or_else(|| {
                    eprintln!("group requires --server-id=<uuid>");
                    std::process::exit(2);
                });
            let port = value("port")
                .and_then(|v| v.parse().ok())
                .unwrap_or_else(|| {
                    eprintln!("group requires --port=<number>");
                    std::process::exit(2);
                });
            Role::Group {
                server_id,
                host: value("host"),
                port,
            }
        }
        _ => Role::Node {
            host: value("host"),
            port: value("port").and_then(|v| v.parse().ok()),
        },
    }
}

#[tokio::main]
async fn main() {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let role = parse_args();
    let settings = settings();

    let pool = PgPoolOptions::new()
        .max_connections(settings.db_pool_size)
        .acquire_timeout(Duration::from_secs(10))
        .connect(&settings.sync_database_url())
        .await
        .unwrap_or_else(|error| {
            eprintln!("could not connect to PostgreSQL: {error}");
            std::process::exit(1);
        });

    let bus = Arc::new(EventBus::new(settings.websocket_queue_size));
    let kafka = Arc::new(KafkaFanout::start(settings, bus.clone()).await);

    let (host, port, supervisor, server_id) = match role {
        Role::Node { host, port } => {
            let host = host.unwrap_or_else(|| settings.host.clone());
            let supervisor = Arc::new(GroupSupervisor::new(host.clone(), bus.clone()));
            supervisor.start().await;
            (host, port.unwrap_or(settings.port), Some(supervisor), None)
        }
        Role::Group {
            server_id,
            host,
            port,
        } => (
            host.unwrap_or_else(|| settings.host.clone()),
            port,
            None,
            Some(server_id),
        ),
    };

    let state = Arc::new(AppState {
        pool: pool.clone(),
        settings: Arc::new((*settings).clone()),
        bus: bus.clone(),
        kafka: kafka.clone(),
        supervisor,
        calls: Arc::new(CallManager::default()),
        host_ips: host_ips(),
        server_id,
    });

    let app = app_router(state.clone());
    let address = format!("{host}:{port}");
    let listener = tokio::net::TcpListener::bind(&address)
        .await
        .unwrap_or_else(|error| {
            eprintln!("could not bind {address}: {error}");
            std::process::exit(1);
        });
    tracing::info!("Hazel listening on {address}");

    let shutdown = async {
        #[cfg(unix)]
        {
            let mut sigterm =
                tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                    .expect("cannot install SIGTERM handler");
            tokio::select! {
                _ = tokio::signal::ctrl_c() => {},
                _ = sigterm.recv() => {},
            }
        }
        #[cfg(not(unix))]
        let _ = tokio::signal::ctrl_c().await;
    };

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown)
    .await
    .ok();

    if let Some(supervisor) = &state.supervisor {
        supervisor.stop().await;
    }
    kafka.stop().await;
    bus.close_all().await;
    pool.close().await;
}
