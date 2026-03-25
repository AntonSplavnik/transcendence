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

// ── User lookup extension ─────────────────────────────────────────────────

#[allow(async_fn_in_trait)]
pub trait DatabaseUserExt {
    async fn get_user(&self, user_id: i32) -> Result<crate::models::User, crate::ApiError>;
}

impl DatabaseUserExt for Db {
    async fn get_user(&self, user_id: i32) -> Result<crate::models::User, crate::ApiError> {
        Ok(self
            .read(move |conn| {
                use crate::schema::users::dsl::*;
                use diesel::{QueryDsl, RunQueryDsl};
                users.find(user_id).first::<crate::models::User>(conn)
            })
            .await??)
    }
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
    /// Panics if the database is not present in the depot. Make sure to inject it in the router with `affix_state::inject` or similar.
    fn db(&self) -> &Db;
}

impl DepotDatabaseExt for salvo::Depot {
    fn db(&self) -> &Db {
        self.obtain::<Db>()
            .expect("Database not found in depot. Make sure it is injected in the router with affix_state::inject")
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

#[cfg(test)]
mod tests {
    use diesel::RunQueryDsl as _;

    #[tokio::test]
    async fn parallel_writers_should_not_fail() {
        use super::*;
        use std::sync::Arc;
        use tokio::sync::Barrier;

        const N: i32 = 100;

        let db = Arc::new(SqliteDatabase::new_test().expect("Failed to create test database"));
        let barrier = Arc::new(Barrier::new(N as usize));

        // create test_table
        db.write(|conn| {
            diesel::sql_query(
				"CREATE TABLE test_table (id INTEGER PRIMARY KEY AUTOINCREMENT, value BINARY NOT NULL)",
			)
			.execute(conn)
        })
        .await
        .expect("Failed to create test_table")
        .expect("Query should succeed");

        let mut handles = Vec::new();
        for i in 0..N {
            let db_clone = db.clone();
            #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
            // i is 0..100, safely fits in u8
            let value = vec![i as u8; 20000]; // arbitrary data to write
            let barrier_clone = barrier.clone();
            let handle = tokio::spawn(async move {
                barrier_clone.wait().await; // Synchronize start
                println!("Task {i} starting write");
                let _ = db_clone
                    .write(move |conn| {
                        diesel::sql_query("INSERT INTO test_table (value) VALUES (?)")
                            .bind::<diesel::sql_types::Binary, _>(value)
                            .execute(conn)
                    })
                    .await
                    .expect("Write should succeed")
                    .expect("Query should succeed");
                println!("Task {i} finished");
            });
            handles.push(handle);
        }

        for handle in handles {
            handle.await.expect("Task should not panic");
        }
    }
}
