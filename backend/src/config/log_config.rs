use serde::Deserialize;
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::fmt;

const FORMAT_PRETTY: &str = "pretty";
const FORMAT_COMPACT: &str = "compact";
const FORMAT_FULL: &str = "full";

#[derive(Deserialize, Clone, Debug)]
pub struct LogConfig {
    #[serde(default = "default_filter_level")]
    pub filter_level: String,
    #[serde(default = "default_true")]
    pub with_ansi: bool,
    #[serde(default = "default_format")]
    pub format: String,
    #[serde(default = "default_true")]
    pub with_level: bool,
    #[serde(default = "default_true")]
    pub with_target: bool,
    #[serde(default = "default_true")]
    pub with_thread_ids: bool,
    #[serde(default = "default_true")]
    pub with_thread_names: bool,
    #[serde(default = "default_true")]
    pub with_source_location: bool,
}

fn default_filter_level() -> String {
    "info".into()
}

fn default_format() -> String {
    FORMAT_FULL.into()
}

fn default_true() -> bool {
    true
}

impl Default for LogConfig {
    fn default() -> Self {
        Self {
            filter_level: default_filter_level(),
            with_ansi: true,
            format: default_format(),
            with_level: true,
            with_target: true,
            with_thread_ids: true,
            with_thread_names: true,
            with_source_location: true,
        }
    }
}

impl LogConfig {
    /// Init tracing.
    ///
    /// Caller should hold the guard.
    pub fn guard(&self) -> WorkerGuard {
        let (non_blocking, guard) = tracing_appender::non_blocking(std::io::stdout());

        // Tracing subscriber init.
        let subscriber = tracing_subscriber::fmt()
            .with_env_filter(
                tracing_subscriber::EnvFilter::try_from_default_env()
                    .unwrap_or(tracing_subscriber::EnvFilter::new(&self.filter_level)),
            )
            .with_ansi(self.with_ansi)
            .with_writer(non_blocking);

        let subscriber = subscriber.event_format(
            fmt::format()
                .with_level(self.with_level)
                .with_target(self.with_target)
                .with_thread_ids(self.with_thread_ids)
                .with_thread_names(self.with_thread_names)
                .with_source_location(self.with_source_location),
        );

        match &*self.format {
            FORMAT_PRETTY => subscriber.pretty().init(),
            FORMAT_COMPACT => subscriber.compact().init(),
            _ => subscriber.init(),
        }

        // Caller should hold this handler.
        guard
    }
}
