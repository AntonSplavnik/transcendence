mod sqlite;

use diesel::SqliteConnection;
use diesel_migrations::{EmbeddedMigrations, MigrationHarness, embed_migrations};
use salvo::extract::{Extractible, Metadata};
use salvo::http::ParseError;
use tracing::info;

pub use sqlite::SqliteDatabase;

pub const MIGRATIONS: EmbeddedMigrations = embed_migrations!();

/// The active [`Database`] implementation, selected at compile time.
pub type Db = SqliteDatabase;

/// Diesel connection type used inside `Database` methods and helper functions.
pub type DbConn = SqliteConnection;

// ── Error ──────────────────────────────────────────────────────────────────

/// Errors produced by [`Database`] operations.
#[derive(Debug, thiserror::Error)]
pub enum DbError {
    /// A diesel query-level error (constraint violation, not found, …).
    #[error(transparent)]
    Query(#[from] diesel::result::Error),

    /// Failed to establish a database connection.
    #[error(transparent)]
    Connection(#[from] diesel::ConnectionError),

    /// The blocking background task panicked.
    #[error("database background task panicked")]
    TaskJoin(#[from] tokio::task::JoinError),
}

impl From<DbError> for crate::ApiError {
    fn from(err: DbError) -> Self {
        match err {
            DbError::Query(e) => Self::DatabaseQuery(e),
            DbError::Connection(e) => Self::DatabaseConnection(e),
            DbError::TaskJoin(e) => {
                tracing::error!(error = ?e, "database background task panicked");
                Self::DatabaseConnection(diesel::ConnectionError::BadConnection(
                    "database background task panicked".into(),
                ))
            }
        }
    }
}

// ── Database trait ─────────────────────────────────────────────────────────

/// Core database abstraction providing async access to a diesel connection.
///
/// Implementations must be cheaply cloneable (typically `Arc`-backed),
/// thread-safe, and `'static` for easy sharing across handlers.
///
/// # Reader / Writer contract
///
/// | Method                 | Connection | Guarantee              |
/// |------------------------|------------|------------------------|
/// | `read`                 | reader     | concurrent readers OK  |
/// | `write`                | writer     | exclusive, serialised  |
/// | `transaction_readonly` | reader     | read-only transaction  |
/// | `transaction_write`    | writer     | write transaction      |
///
/// It is the **caller's responsibility** to never perform write operations
/// through `read` or `transaction_readonly`.  This contract is **not**
/// enforced by the type system.
#[allow(async_fn_in_trait)]
pub trait Database: Send + Sync + Clone + 'static {
    /// Execute a closure with a reader connection.
    async fn read<F, R>(&self, f: F) -> Result<R, DbError>
    where
        F: FnOnce(&mut DbConn) -> R + Send + 'static,
        R: Send + 'static;

    /// Execute a closure with the exclusive writer connection.
    async fn write<F, R>(&self, f: F) -> Result<R, DbError>
    where
        F: FnOnce(&mut DbConn) -> R + Send + 'static,
        R: Send + 'static;

    /// Run a read-only diesel transaction on a reader connection.
    ///
    /// The closure's `Err` triggers a rollback; `Ok` commits.
    async fn transaction_readonly<F, R>(&self, f: F) -> Result<R, DbError>
    where
        F: FnOnce(&mut DbConn) -> Result<R, diesel::result::Error> + Send + 'static,
        R: Send + 'static;

    /// Run a write transaction on the exclusive writer connection.
    ///
    /// The closure's `Err` triggers a rollback; `Ok` commits.
    async fn transaction_write<F, R>(&self, f: F) -> Result<R, DbError>
    where
        F: FnOnce(&mut DbConn) -> Result<R, diesel::result::Error> + Send + 'static,
        R: Send + 'static;
}

// ── Handler extraction ─────────────────────────────────────────────────────

impl<'ex> Extractible<'ex> for Db {
    fn metadata() -> &'static Metadata {
        static METADATA: Metadata = Metadata::new("");
        &METADATA
    }

    #[allow(refining_impl_trait)]
    async fn extract(
        _req: &'ex mut salvo::Request,
        depot: &'ex mut salvo::Depot,
    ) -> Result<Self, ParseError> {
        Ok(depot.db().clone())
    }
}

impl salvo::oapi::EndpointArgRegister for Db {
    fn register(
        _components: &mut salvo::oapi::Components,
        _operation: &mut salvo::oapi::Operation,
        _arg: &str,
    ) {
    }
}

// ── Depot integration ──────────────────────────────────────────────────────

/// Extension trait for convenient [`Database`] access from a Salvo
/// [`Depot`](salvo::Depot).
pub trait DepotDatabaseExt {
    /// Retrieve a reference to the injected database.
    ///
    /// # Panics
    ///
    /// Panics if [`DatabaseHoop`] was not added upstream in the router.
    fn db(&self) -> &Db;
}

impl DepotDatabaseExt for salvo::Depot {
    fn db(&self) -> &Db {
        self.get::<Db>("database")
            .expect("Database not in depot. Add DatabaseHoop to your router.")
    }
}

/// Salvo middleware that injects a cloned [`Database`] into every request's
/// depot.
///
/// # Example
///
/// ```rust,ignore
/// let db = db::Db::new(&config.database_url, 4)?;
/// let router = Router::new()
///     .hoop(db::DatabaseHoop::new(db))
///     .push(/* routes */);
/// ```
pub struct DatabaseHoop {
    db: Db,
}

impl DatabaseHoop {
    /// Create a new hoop that will inject `db` into every request.
    pub fn new(db: Db) -> Self {
        Self { db }
    }
}

#[salvo::async_trait]
impl salvo::Handler for DatabaseHoop {
    async fn handle(
        &self,
        req: &mut salvo::Request,
        depot: &mut salvo::Depot,
        res: &mut salvo::Response,
        ctrl: &mut salvo::FlowCtrl,
    ) {
        depot.insert("database", self.db.clone());
        ctrl.call_next(req, depot, res).await;
    }
}

// ── Migrations ─────────────────────────────────────────────────────────────

fn run_migrations(conn: &mut SqliteConnection) {
    info!(
        "Has pending migration: {}",
        conn.has_pending_migration(MIGRATIONS).unwrap()
    );
    conn.run_pending_migrations(MIGRATIONS)
        .expect("migrations should succeed");
}
