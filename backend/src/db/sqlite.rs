use std::sync::Arc;

use diesel::connection::SimpleConnection;
use diesel::prelude::*;
use parking_lot::{Condvar, Mutex};
use tokio::sync::Mutex as AsyncMutex;
use tracing::info;

use super::{Database, DbConn, DbError, run_migrations};

/// Default number of reader connections in the pool.
#[allow(dead_code)]
const DEFAULT_READER_COUNT: usize = 4;

// ── SqliteDatabase ─────────────────────────────────────────────────────────

/// SQLite [`Database`] backend backed by a pool of reader connections and a
/// single serialised writer connection.
///
/// Cloning is cheap (`Arc`).
#[derive(Clone)]
pub struct SqliteDatabase {
    inner: Arc<SqliteInner>,
}

struct SqliteInner {
    /// Pool of reader connections – guarded by a parking_lot mutex + condvar
    /// because access only happens inside `spawn_blocking`.
    readers: Mutex<Vec<DbConn>>,
    reader_available: Condvar,

    /// Single writer connection behind a **tokio** async mutex so that
    /// multiple concurrent `write()` callers queue up without consuming
    /// blocking-thread-pool threads.
    writer: Arc<AsyncMutex<DbConn>>,
}

impl SqliteDatabase {
    /// Create a new SQLite database.
    ///
    /// Opens `reader_count` reader connections and one dedicated writer
    /// connection.  All connections are configured with performance pragmas
    /// and pending diesel migrations are run on the writer.
    pub fn new(database_url: &str, reader_count: usize) -> Result<Self, DbError> {
        // ── writer ─────────────────────────────────────────────────────
        let mut writer = SqliteConnection::establish(database_url).map_err(DbError::Connection)?;
        configure_connection(&mut writer).map_err(DbError::Query)?;
        run_migrations(&mut writer);

        // ── readers ────────────────────────────────────────────────────
        let mut readers = Vec::with_capacity(reader_count);
        for _ in 0..reader_count {
            let mut conn =
                SqliteConnection::establish(database_url).map_err(DbError::Connection)?;
            configure_connection(&mut conn).map_err(DbError::Query)?;
            readers.push(conn);
        }

        info!(
            "SQLite database initialized: {reader_count} reader(s), 1 writer | url = {}",
            if database_url.contains("memory") {
                database_url
            } else {
                "<file>"
            },
        );

        Ok(Self {
            inner: Arc::new(SqliteInner {
                readers: Mutex::new(readers),
                reader_available: Condvar::new(),
                writer: Arc::new(AsyncMutex::new(writer)),
            }),
        })
    }
}

// ── Test-only constructor ──────────────────────────────────────────────────

#[cfg(test)]
impl SqliteDatabase {
    /// Create an in-memory SQLite database for testing.
    ///
    /// Uses a random URI filename with `mode=memory&cache=shared` so that
    /// the reader and writer connections see the same data while each test
    /// gets a fully isolated database.
    pub fn new_test() -> Result<Self, DbError> {
        let id: u64 = rand::random();
        let url = format!("file:test_{id}?mode=memory&cache=shared");
        Self::new(&url, DEFAULT_READER_COUNT)
    }
}

// ── Database trait implementation ──────────────────────────────────────────

impl Database for SqliteDatabase {
    async fn read<F, R>(&self, f: F) -> Result<R, DbError>
    where
        F: FnOnce(&mut DbConn) -> R + Send + 'static,
        R: Send + 'static,
    {
        let db = self.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = db.inner.acquire_reader();
            let result = f(&mut conn);
            db.inner.return_reader(conn);
            result
        })
        .await
        .map_err(DbError::from)
    }

    async fn write<F, R>(&self, f: F) -> Result<R, DbError>
    where
        F: FnOnce(&mut DbConn) -> R + Send + 'static,
        R: Send + 'static,
    {
        // Await the async mutex so writers queue without wasting blocking
        // threads.  `lock_owned` yields an `OwnedMutexGuard` that is Send
        // and can be moved into `spawn_blocking`.
        let guard = self.inner.writer.clone().lock_owned().await;

        tokio::task::spawn_blocking(move || {
            let mut guard = guard;
            f(&mut *guard)
        })
        .await
        .map_err(DbError::from)
    }

    async fn transaction_readonly<F, R>(&self, f: F) -> Result<R, DbError>
    where
        F: FnOnce(&mut DbConn) -> Result<R, diesel::result::Error> + Send + 'static,
        R: Send + 'static,
    {
        let db = self.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = db.inner.acquire_reader();
            let result = conn.transaction(|conn| f(conn));
            db.inner.return_reader(conn);
            result
        })
        .await
        .map_err(DbError::from)
        .and_then(|r| r.map_err(DbError::from))
    }

    async fn transaction_write<F, R>(&self, f: F) -> Result<R, DbError>
    where
        F: FnOnce(&mut DbConn) -> Result<R, diesel::result::Error> + Send + 'static,
        R: Send + 'static,
    {
        let guard = self.inner.writer.clone().lock_owned().await;

        tokio::task::spawn_blocking(move || {
            let mut guard = guard;
            guard.immediate_transaction(|conn| f(conn))
        })
        .await
        .map_err(DbError::from)
        .and_then(|r| r.map_err(DbError::from))
    }
}

// ── Reader pool primitives ─────────────────────────────────────────────────

impl SqliteInner {
    /// Block until a reader connection is available.
    ///
    /// Only called inside `spawn_blocking`, so blocking is intentional.
    fn acquire_reader(&self) -> DbConn {
        let mut readers = self.readers.lock();
        loop {
            if let Some(conn) = readers.pop() {
                return conn;
            }
            self.reader_available.wait(&mut readers);
        }
    }

    /// Return a reader connection to the pool and wake one waiter.
    fn return_reader(&self, conn: DbConn) {
        let mut readers = self.readers.lock();
        readers.push(conn);
        self.reader_available.notify_one();
    }
}

// ── Connection configuration ───────────────────────────────────────────────

/// Configure SQLite pragmas for optimal performance.
///
/// Applied once per connection at creation time.
pub(super) fn configure_connection(
    conn: &mut SqliteConnection,
) -> Result<(), diesel::result::Error> {
    // Retry on SQLITE_BUSY for up to 2 seconds.
    // conn.batch_execute("PRAGMA busy_timeout = 2000;")?;
    // WAL mode: concurrent readers + single writer without blocking each other.
    conn.batch_execute("PRAGMA journal_mode = WAL;")?;
    // Sync only at critical moments (good trade-off for most workloads).
    conn.batch_execute("PRAGMA synchronous = NORMAL;")?;
    // Auto-checkpoint every ~1 000 pages ≈ 1 MB WAL file.
    conn.batch_execute("PRAGMA wal_autocheckpoint = 1000;")?;
    // Enforce foreign-key constraints.
    conn.batch_execute("PRAGMA foreign_keys = ON;")?;
    Ok(())
}
