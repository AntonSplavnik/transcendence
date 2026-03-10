use std::process::ExitCode;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use salvo::catcher::Catcher;
use salvo::conn::rustls::{Keycert, RustlsConfig};
use salvo::conn::Acceptor;
use salvo::prelude::*;
use salvo::server::ServerHandle;
use tokio::signal;

mod auth;
mod avatar;
mod config;
pub mod db;
mod error;
mod game;
mod models;
mod notifications;
mod prelude;
mod routers;
mod schema;
#[allow(dead_code)]
mod stream;
mod utils;
mod validate;

pub use error::ApiError;
use tokio::sync::Notify;

use crate::config::{ServerConfig, TlsConfig};

pub static ON_SHUTDOWN: Notify = Notify::const_new();

fn main() -> ExitCode {
    #[allow(
        clippy::expect_used,
        clippy::diverging_sub_expression,
        clippy::needless_return,
        clippy::unwrap_in_result
    )]
    return tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .thread_name_fn(|| {
            static ATOMIC_ID: AtomicUsize = AtomicUsize::new(0);
            let id = ATOMIC_ID.fetch_add(1, Ordering::SeqCst);
            format!("tokio-{}", id)
        })
        .build()
        .expect("Failed building the Runtime")
        .block_on(async_main());
}

async fn async_main() -> ExitCode {
    let _ = dotenvy::dotenv();
    crate::config::init();
    let config = crate::config::get();

    #[cfg(not(debug_assertions))]
    eprintln!("📖 Open API Pages are only enabled with debug builds.");
    #[cfg(debug_assertions)]
    {
        let listen_addr = if config.listen_addr == "::" {
            "[::]".to_string()
        } else if config.listen_addr.contains(':') && !config.listen_addr.starts_with('[') {
            format!("[{}]", config.listen_addr)
        } else {
            config.listen_addr.clone()
        };
        let port = config.listen_https_port;
        eprintln!("📖 Open API Pages: https://{listen_addr}:{port}/scalar");
    }

    let logger = config.log.guard();
    tokio::spawn(async move {
        let _logger = logger;
        // block infinitely
        std::future::pending::<()>().await;
    });

    #[cfg(not(test))]
    crate::utils::limiter::periodic_rate_limit_report();

    tracing::info!("log level: {}", &config.log.filter_level);
    // Initialize database (reader pool + single writer, runs migrations)
    let database = db::Db::new(&config.database_url, 4).expect("Failed to initialize database");

    // Initialize game system
    let game_manager = std::sync::Arc::new(crate::game::GameManager::new());

    // Start the game
    game_manager.clone().start().await;
    tracing::info!("Game engine started");

    // Spawn game loop in background
    tokio::spawn({
        let gm = game_manager.clone();
        async move {
            gm.run_game_loop().await;
        }
    });

    let mut router = routers::root(database, game_manager)
        .hoop(ForceHttps::new().https_port(config.listen_https_port));
    if let Some(tls) = &config.tls {
        let acceptor = setup_acceptor_socket(&config, tls).await;
        run_server(acceptor, router).await;
    } else if let Some(domain) = &config.domain {
        let acceptor = setup_acme_acceptor_socket(&config, domain, &mut router).await;
        run_server(acceptor, router).await;
    } else {
        eprintln!("⚠️  No TLS configuration and no domain provided. Exiting.");
        return ExitCode::FAILURE;
    }

    ExitCode::SUCCESS
}

async fn setup_acceptor_socket(cfg: &ServerConfig, tls: &TlsConfig) -> impl Acceptor {
    // Load TLS certificates for https from files
    let (cert, key) = tokio::join!(tokio::fs::read(&tls.cert), tokio::fs::read(&tls.key));
    let cert = cert.expect("Valid cert.pem path must be provided");
    let key = key.expect("Valid key.pem path must be provided");
    let tls_config = RustlsConfig::new(Keycert::new().cert(cert).key(key));
    // Set up a TCP listener on port 80 for HTTP
    let http = TcpListener::new((cfg.listen_addr.clone(), cfg.listen_http_port));
    // Set up a TCP listener on port 443 for HTTPS
    let https = TcpListener::new((cfg.listen_addr.clone(), cfg.listen_https_port))
        .rustls(tls_config.clone());
    // Enable QUIC/HTTP3 support on the same port
    let http3 = QuinnListener::new(tls_config, (cfg.listen_addr.clone(), cfg.listen_https_port));
    // Combine HTTP, HTTPS, and HTTP3 listeners into a single acceptor
    let acceptor = http3.join(https).join(http).bind().await;
    acceptor
}

async fn setup_acme_acceptor_socket(
    cfg: &ServerConfig,
    domain: &String,
    mut router: &mut Router,
) -> impl Acceptor + use<> {
    // Set up a TCP listener on port 80 for HTTP
    let http = TcpListener::new((cfg.listen_addr.clone(), cfg.listen_http_port));
    let https = TcpListener::new((cfg.listen_addr.clone(), cfg.listen_https_port))
        .acme() // Enable ACME for automatic SSL certificate management
        .cache_path("temp/letsencrypt") // Path to store the certificate cache
        .add_domain(domain)
        .http01_challenge(&mut router) // Add routes to handle ACME challenge requests
        .quinn((cfg.listen_addr.clone(), cfg.listen_https_port)); // Enable QUIC/HTTP3 support
                                                                  // Combine HTTP, HTTPS, and HTTP3 listeners into a single acceptor
    let acceptor = https.join(http).bind().await;
    acceptor
}

// generic helper to enable using different acceptor types
async fn run_server<A>(acceptor: A, router: Router)
where
    A: Acceptor + Send,
{
    let server = Server::new(acceptor);
    tokio::spawn(shutdown_signal(server.handle()));

    let service = Service::new(router).catcher(Catcher::default());
    server.serve(service).await;
}

async fn shutdown_signal(handle: ServerHandle) {
    let ctrl_c = async {
        signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("failed to install signal handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => tracing::info!("ctrl_c signal received"),
        _ = terminate => tracing::info!("terminate signal received"),
    }
    handle.stop_graceful(Duration::from_secs(10));
    tokio::time::sleep(Duration::from_secs(1)).await;
    ON_SHUTDOWN.notify_waiters();
    tokio::time::sleep(Duration::from_secs(1)).await;
}
