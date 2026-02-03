use std::sync::LazyLock;
use std::time::Duration;

use diesel::connection::SimpleConnection;
use diesel::r2d2::{ConnectionManager, Pool, PooledConnection};
use diesel_migrations::{
    EmbeddedMigrations, MigrationHarness, embed_migrations,
};
use tracing::info;

use crate::prelude::*;

pub type DbConn = PooledConnection<ConnectionManager<SqliteConnection>>;

pub const MIGRATIONS: EmbeddedMigrations = embed_migrations!();

/// The global connection pool
static DB: LazyLock<Pool<ConnectionManager<SqliteConnection>>> =
    LazyLock::new(init_pool);

/// Custom connection customizer to set SQLite pragmas on each connection
#[derive(Debug)]
struct SqliteConnectionCustomizer;

impl diesel::r2d2::CustomizeConnection<SqliteConnection, diesel::r2d2::Error>
    for SqliteConnectionCustomizer
{
    fn on_acquire(
        &self,
        conn: &mut SqliteConnection,
    ) -> Result<(), diesel::r2d2::Error> {
        // taken from https://docs.rs/diesel/2.3.6/diesel/sqlite/struct.SqliteConnection.html#concurrency
        // see https://fractaledmind.github.io/2023/09/07/enhancing-rails-sqlite-fine-tuning/
        // sleep if the database is busy, this corresponds to up to 2 seconds sleeping time.
        conn.batch_execute("PRAGMA busy_timeout = 2000;")?;
        // better write-concurrency
        conn.batch_execute("PRAGMA journal_mode = WAL;")?;
        // fsync only in critical moments
        conn.batch_execute("PRAGMA synchronous = NORMAL;")?;
        // write WAL changes back every 1000 pages, for an in average 1MB WAL file.
        // May affect readers if number is increased
        conn.batch_execute("PRAGMA wal_autocheckpoint = 1000;")?;
        // free some space by truncating possibly massive WAL files from the last run
        conn.batch_execute("PRAGMA wal_checkpoint(TRUNCATE);")?;

        conn.batch_execute("PRAGMA foreign_keys = ON;")?;
        Ok(())
    }
}

fn init_pool() -> Pool<ConnectionManager<SqliteConnection>> {
    let database_url = database_url();
    let manager = ConnectionManager::<SqliteConnection>::new(&database_url);

    let pool = Pool::builder()
        .max_size(10) // Maximum number of connections in the pool
        .min_idle(Some(1)) // Keep at least 1 connection ready
        .connection_timeout(Duration::from_secs(30))
        .connection_customizer(Box::new(SqliteConnectionCustomizer))
        .build(manager)
        .expect("Failed to create database connection pool");
    info!("Database connection pool initialized with WAL mode");
    migrate(&mut pool.get().expect("Failed to get connection for migration"));
    pool
}

fn migrate(conn: &mut DbConn) {
    info!(
        "Has pending migration: {}",
        conn.has_pending_migration(MIGRATIONS).unwrap()
    );
    conn.run_pending_migrations(MIGRATIONS)
        .expect("migrate db should worked");
}

pub fn get() -> DbConn {
    DB.get()
        .expect("local sqlite db should not time out while trying to connect")
}

const TEST_DATABASE_URL: &str =
    "file:transcendence_test?mode=memory&cache=shared";

fn database_url() -> String {
    if cfg!(test) {
        TEST_DATABASE_URL.to_string()
    } else {
        crate::config::get().database_url.clone()
    }
}
