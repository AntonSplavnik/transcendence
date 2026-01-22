use std::process::ExitCode;

use salvo::catcher::Catcher;
use salvo::conn::Acceptor;
use salvo::conn::rustls::{Keycert, RustlsConfig};
use salvo::prelude::*;
use salvo::server::ServerHandle;
use tokio::signal;

mod auth;
mod chat;
mod config;
pub mod db;
mod error;
mod models;
mod prelude;
mod routers;
mod schema;
mod stream;
mod utils;
mod validate;

pub use error::ApiError;

use crate::config::{ServerConfig, TlsConfig};

#[tokio::main]
async fn main() -> ExitCode {
    let _ = dotenvy::dotenv();
    crate::config::init();
    let config = crate::config::get();
    let _guard = config.log.guard();
    crate::utils::limiter::periodic_rate_limit_report();

    tracing::info!("log level: {}", &config.log.filter_level);

    let mut router = routers::root()
        .hoop(ForceHttps::new().https_port(config.listen_https_port))
        .hoop(crate::auth::device_id_inserter_hoop);

    if let Some(tls) = &config.tls {
        let acceptor = setup_acceptor_socket(&config, tls).await;
        run_server(acceptor, router, config).await;
    } else if let Some(domain) = &config.domain {
        let acceptor =
            setup_acme_acceptor_socket(&config, domain, &mut router).await;
        run_server(acceptor, router, &config).await;
    } else {
        eprintln!("⚠️  No TLS configuration and no domain provided. Exiting.");
        return ExitCode::FAILURE;
    }

    ExitCode::SUCCESS
}

async fn setup_acceptor_socket(
    cfg: &ServerConfig,
    tls: &TlsConfig,
) -> impl Acceptor {
    // Load TLS certificates for https from files
    let (cert, key) =
        tokio::join!(tokio::fs::read(&tls.cert), tokio::fs::read(&tls.key));
    let cert = cert.expect("Valid cert.pem path must be provided");
    let key = key.expect("Valid key.pem path must be provided");
    let tls_config = RustlsConfig::new(Keycert::new().cert(cert).key(key));
    // Set up a TCP listener on port 80 for HTTP
    let http =
        TcpListener::new((cfg.listen_addr.clone(), cfg.listen_http_port));
    // Set up a TCP listener on port 443 for HTTPS
    let https =
        TcpListener::new((cfg.listen_addr.clone(), cfg.listen_https_port))
            .rustls(tls_config.clone());
    // Enable QUIC/HTTP3 support on the same port
    let http3 = QuinnListener::new(
        tls_config,
        (cfg.listen_addr.clone(), cfg.listen_https_port),
    );
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
    let http =
        TcpListener::new((cfg.listen_addr.clone(), cfg.listen_http_port));
    let https =
        TcpListener::new((cfg.listen_addr.clone(), cfg.listen_https_port))
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
async fn run_server<A>(acceptor: A, router: Router, config: &ServerConfig)
where
    A: Acceptor + Send,
{
    let server = Server::new(acceptor);
    tokio::spawn(shutdown_signal(server.handle()));

    let listen_addr = &config.listen_addr;
    let port = config.listen_https_port;
    eprintln!(
        "🚀 Server Listening on https://{}:{port}/",
        listen_addr.replace("0.0.0.0", "127.0.0.1"),
    );
    eprintln!(
        "📖 Open API Pages:\nhttps://{0}:{port}/scalar\nhttps://{0}:{port}/swagger-ui\nhttps://{0}:{port}/rapidoc\nhttps://{0}:{port}/redoc",
        listen_addr.replace("0.0.0.0", "127.0.0.1")
    );

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
    handle.stop_graceful(std::time::Duration::from_secs(60));
}
