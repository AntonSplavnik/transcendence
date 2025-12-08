use std::sync::OnceLock;

use figment::Figment;
use figment::providers::{Env, Format, Toml};
use serde::Deserialize;

mod log_config;
pub use log_config::LogConfig;

pub static CONFIG: OnceLock<ServerConfig> = OnceLock::new();

pub fn init() {
    let raw_config = Figment::new()
        .merge(Toml::file(
            Env::var("APP_CONFIG").as_deref().unwrap_or("config.toml"),
        ))
        .merge(Env::raw().only(&["database_url"]))
        .merge(Env::prefixed("APP_").global());

    let config = match raw_config.extract::<ServerConfig>() {
        Ok(s) => s,
        Err(e) => {
            eprintln!(
                "It looks like your config is invalid. The following error occurred: {e}"
            );
            std::process::exit(1);
        }
    };
    if config.database_url.is_empty() {
        eprintln!("DATABASE_URL is not set");
        std::process::exit(1);
    }
    crate::config::CONFIG
        .set(config)
        .expect("config should be set");
}

pub fn get() -> &'static ServerConfig {
    CONFIG.get().expect("config should be set")
}

#[derive(Deserialize, Clone, Debug)]
pub struct ServerConfig {
    #[serde(default = "default_listen_addr")]
    pub listen_addr: String,
    #[serde(default = "default_listen_http_port")]
    pub listen_http_port: u16,
    #[serde(default = "default_listen_https_port")]
    pub listen_https_port: u16,
    pub domain: Option<String>,
    pub database_url: String,
    pub log: LogConfig,
    pub tls: Option<TlsConfig>,
    #[serde(default = "default_serve_dir")]
    pub serve_dir: String,
}

#[derive(Deserialize, Clone, Debug)]
pub struct TlsConfig {
    pub cert: String,
    pub key: String,
}

fn default_listen_addr() -> String {
    "127.0.0.1".into()
}

fn default_listen_http_port() -> u16 {
    8080
}

fn default_listen_https_port() -> u16 {
    8443
}

fn default_serve_dir() -> String {
    "/www".into()
}
