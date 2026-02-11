use serde::Deserialize;
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::fmt;
use tracing_subscriber::fmt::format::{self, FormatEvent, FormatFields};
#[cfg(debug_assertions)]
use tracing_subscriber::fmt::time::FormatTime;
use tracing_subscriber::registry::LookupSpan;

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
    #[serde(default = "default_false")]
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

fn default_false() -> bool {
    false
}

impl Default for LogConfig {
    fn default() -> Self {
        Self {
            filter_level: default_filter_level(),
            with_ansi: true,
            format: default_format(),
            with_level: true,
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

        let subscriber = tracing_subscriber::fmt()
            .with_env_filter(
                tracing_subscriber::EnvFilter::try_from_default_env()
                    .unwrap_or(tracing_subscriber::EnvFilter::new(&self.filter_level)),
            )
            .with_ansi(self.with_ansi)
            .with_writer(non_blocking);

        let is_debug = cfg!(debug_assertions);
        let display_target_internal = !is_debug;
        let display_target_external = true;
        let display_thread_ids = self.with_thread_ids;
        let display_thread_names = self.with_thread_names;

        let crate_prefixes = crate_prefixes();
        match &*self.format {
            FORMAT_PRETTY => {
                let base_internal = format::format()
                    .with_timer(build_timer())
                    .with_level(self.with_level)
                    .with_target(display_target_internal)
                    .with_thread_ids(display_thread_ids)
                    .with_thread_names(display_thread_names)
                    .with_ansi(self.with_ansi)
                    .pretty();
                let base_external = format::format()
                    .with_timer(build_timer())
                    .with_level(self.with_level)
                    .with_target(display_target_external)
                    .with_thread_ids(display_thread_ids)
                    .with_thread_names(display_thread_names)
                    .with_ansi(self.with_ansi)
                    .pretty();
                let with_location = base_internal
                    .clone()
                    .with_source_location(is_debug && self.with_source_location);
                let without_location = base_external.clone().with_source_location(false);
                subscriber
                    .pretty()
                    .event_format(SelectiveLocationFormat::new(
                        with_location,
                        without_location,
                        crate_prefixes,
                    ))
                    .init();
            }
            FORMAT_COMPACT => {
                let base_internal = format::format()
                    .with_timer(build_timer())
                    .with_level(self.with_level)
                    .with_target(display_target_internal)
                    .with_thread_ids(display_thread_ids)
                    .with_thread_names(display_thread_names)
                    .with_ansi(self.with_ansi)
                    .compact();
                let base_external = format::format()
                    .with_timer(build_timer())
                    .with_level(self.with_level)
                    .with_target(display_target_external)
                    .with_thread_ids(display_thread_ids)
                    .with_thread_names(display_thread_names)
                    .with_ansi(self.with_ansi)
                    .compact();
                let with_location = base_internal
                    .clone()
                    .with_source_location(is_debug && self.with_source_location);
                let without_location = base_external.clone().with_source_location(false);
                subscriber
                    .compact()
                    .event_format(SelectiveLocationFormat::new(
                        with_location,
                        without_location,
                        crate_prefixes,
                    ))
                    .init();
            }
            _ => {
                let base_internal = format::format()
                    .with_timer(build_timer())
                    .with_level(self.with_level)
                    .with_target(display_target_internal)
                    .with_thread_ids(display_thread_ids)
                    .with_thread_names(display_thread_names)
                    .with_ansi(self.with_ansi);
                let base_external = format::format()
                    .with_timer(build_timer())
                    .with_level(self.with_level)
                    .with_target(display_target_external)
                    .with_thread_ids(display_thread_ids)
                    .with_thread_names(display_thread_names)
                    .with_ansi(self.with_ansi);
                let with_location = base_internal
                    .clone()
                    .with_source_location(is_debug && self.with_source_location);
                let without_location = base_external.clone().with_source_location(false);
                subscriber
                    .event_format(SelectiveLocationFormat::new(
                        with_location,
                        without_location,
                        crate_prefixes,
                    ))
                    .init();
            }
        }

        guard
    }
}

#[derive(Clone)]
struct SelectiveLocationFormat<F, T> {
    with_location: format::Format<F, T>,
    without_location: format::Format<F, T>,
    crate_prefixes: Vec<String>,
}

impl<F, T> SelectiveLocationFormat<F, T> {
    fn new(
        with_location: format::Format<F, T>,
        without_location: format::Format<F, T>,
        crate_prefixes: Vec<String>,
    ) -> Self {
        Self {
            with_location,
            without_location,
            crate_prefixes,
        }
    }

    fn is_internal_target(&self, module_path: Option<&str>, target: &str) -> bool {
        self.crate_prefixes.iter().any(|prefix| {
            module_path.is_some_and(|path| path.starts_with(prefix)) || target.starts_with(prefix)
        })
    }
}

impl<S, N, F, T> FormatEvent<S, N> for SelectiveLocationFormat<F, T>
where
    S: tracing::Subscriber + for<'a> LookupSpan<'a>,
    N: for<'a> FormatFields<'a> + 'static,
    format::Format<F, T>: FormatEvent<S, N>,
{
    fn format_event(
        &self,
        ctx: &fmt::FmtContext<'_, S, N>,
        writer: format::Writer<'_>,
        event: &tracing::Event<'_>,
    ) -> std::fmt::Result {
        let meta = event.metadata();
        if self.is_internal_target(meta.module_path(), meta.target()) {
            self.with_location.format_event(ctx, writer, event)
        } else {
            self.without_location.format_event(ctx, writer, event)
        }
    }
}

fn crate_prefixes() -> Vec<String> {
    let crate_name = env!("CARGO_PKG_NAME");
    let underscored = crate_name.replace('-', "_");
    if underscored == crate_name {
        vec![crate_name.to_string()]
    } else {
        vec![crate_name.to_string(), underscored]
    }
}

#[cfg(debug_assertions)]
fn build_timer() -> LocalTimeShort {
    LocalTimeShort
}

#[cfg(not(debug_assertions))]
fn build_timer() -> tracing_subscriber::fmt::time::SystemTime {
    tracing_subscriber::fmt::time::SystemTime
}

#[cfg(debug_assertions)]
#[derive(Clone, Copy, Debug, Default)]
struct LocalTimeShort;

#[cfg(debug_assertions)]
impl FormatTime for LocalTimeShort {
    fn format_time(&self, w: &mut format::Writer<'_>) -> std::fmt::Result {
        let now = chrono::Local::now();
        write!(w, "{}", now.format("%H:%M:%S%.3f"))
    }
}
