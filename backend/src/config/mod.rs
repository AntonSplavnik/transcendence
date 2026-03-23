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
            eprintln!("It looks like your config is invalid. The following error occurred: {e}");
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
    #[serde(default = "default_acme_cache_dir")]
    pub acme_cache_dir: String,
    pub database_url: String,
    pub log: LogConfig,
    pub tls: Option<TlsConfig>,
    #[serde(default = "default_serve_dir")]
    pub serve_dir: String,
    #[serde(default)]
    pub email: EmailConfig,
}

#[derive(Deserialize, Clone, Debug)]
pub struct EmailConfig {
    #[serde(default = "default_smtp_host")]
    pub smtp_host: String,
    #[serde(default = "default_smtp_port")]
    pub smtp_port: u16,
    pub smtp_username: Option<String>,
    pub smtp_password: Option<String>,
    #[serde(default)]
    pub smtp_tls: bool,
    #[serde(default = "default_from_address")]
    pub from_address: String,
    #[serde(default = "default_base_url")]
    pub base_url: String,
}

#[derive(Deserialize, Clone, Debug)]
pub struct TlsConfig {
    pub cert: String,
    pub key: String,
}

fn default_listen_addr() -> String {
    "::".into()
}

fn default_listen_http_port() -> u16 {
    8080
}

fn default_listen_https_port() -> u16 {
    8443
}

fn default_acme_cache_dir() -> String {
    "./acme".into()
}

fn default_serve_dir() -> String {
    "/www".into()
}

fn default_smtp_host() -> String {
    "mailpit".into()
}

fn default_smtp_port() -> u16 {
    1025
}

fn default_from_address() -> String {
    "noreply@transcendence.local".into()
}

fn default_base_url() -> String {
    "https://localhost:8443".into()
}

impl Default for EmailConfig {
    fn default() -> Self {
        Self {
            smtp_host: default_smtp_host(),
            smtp_port: default_smtp_port(),
            smtp_username: None,
            smtp_password: None,
            smtp_tls: false,
            from_address: default_from_address(),
            base_url: default_base_url(),
        }
    }
}
