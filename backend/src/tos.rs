use chrono::{DateTime, Utc};
use diesel::prelude::*;

use crate::db::DbConn;
use crate::prelude::*;

// ── ToS version enum ─────────────────────────────────────────────────────

/// Every ToS revision gets its own variant, named after the date the ToS
/// text was updated. Add a new variant here and update [`CURRENT_TOS`]
/// to force all users to re-accept.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TosVersion {
    /// Initial Terms of Service — matches "Last updated: 25.02.2026" on
    /// the frontend ToS page.
    V2026_02_25,
}

impl TosVersion {
    /// Returns the string key for this ToS version, used as the primary
    /// key in the `tos_versions` database table.
    pub const fn key(&self) -> &'static str {
        match self {
            TosVersion::V2026_02_25 => "2026-02-25",
        }
    }
}

/// The current ToS version. Change this to a new variant to force
/// all users to re-accept.
pub const CURRENT_TOS: TosVersion = TosVersion::V2026_02_25;

/// The key string for the current ToS version, derived from [`CURRENT_TOS`].
/// Used as the primary key in the `tos_versions` database table.
pub const CURRENT_TOS_KEY: &str = CURRENT_TOS.key();

// ── Injected timestamp ───────────────────────────────────────────────────

/// The effective timestamp for the current ToS version, injected into the
/// Salvo depot via `affix_state::inject`. A user's `tos_accepted_at` must
/// be `>=` this value to pass the ToS gate.
/// Timestamps are truncated to second precision because JWT claims store
/// `tos_accepted_at` as a unix timestamp (`i64`). Without truncation,
/// nanosecond differences would cause spurious comparison failures.
#[derive(Debug, Clone, Copy)]
pub struct CurrentTosTimestamp(DateTime<Utc>);

impl CurrentTosTimestamp {
    /// Snapshot the current time (truncated to seconds).
    pub fn now() -> Self {
        Self::from_utc(Utc::now())
    }

    /// Wrap an existing `DateTime` (truncated to seconds).
    pub fn from_utc(ts: DateTime<Utc>) -> Self {
        let truncated = DateTime::from_timestamp(ts.timestamp(), 0)
            .expect("valid DateTime must round-trip through unix timestamp");
        Self(truncated)
    }

    pub fn timestamp(&self) -> DateTime<Utc> {
        self.0
    }
}

/// Load (or create) the current ToS version timestamp from the database.
///
/// If an entry for [`CURRENT_TOS_KEY`] already exists, its `created_at`
/// timestamp is used.  Otherwise a new row is inserted with `now()` and
/// that timestamp becomes the effective date.
pub fn load_current_tos_timestamp(conn: &mut DbConn) -> CurrentTosTimestamp {
    use crate::schema::tos_versions::dsl::*;

    let existing: Option<DateTime<Utc>> = tos_versions
        .filter(key.eq(CURRENT_TOS_KEY))
        .select(created_at)
        .first(conn)
        .optional()
        .expect("failed to query tos_versions table");

    let ts = match existing {
        Some(ts) => {
            tracing::info!("ToS version {CURRENT_TOS_KEY} found in database (created {ts})");
            ts
        }
        None => {
            let now = CurrentTosTimestamp::now().timestamp();
            diesel::insert_into(tos_versions)
                .values((key.eq(CURRENT_TOS_KEY), created_at.eq(now)))
                .execute(conn)
                .expect("failed to insert new tos_versions row");
            tracing::info!("ToS version {CURRENT_TOS_KEY} not found — created new entry at {now}");
            now
        }
    };

    CurrentTosTimestamp::from_utc(ts)
}

// ── Depot integration ────────────────────────────────────────────────────

pub trait DepotTosExt {
    fn current_tos_timestamp(&self) -> DateTime<Utc>;
}

impl DepotTosExt for salvo::Depot {
    fn current_tos_timestamp(&self) -> DateTime<Utc> {
        self.obtain::<CurrentTosTimestamp>()
            .expect(
                "CurrentTosTimestamp not found in depot. \
                 Make sure it is injected in the router with affix_state::inject",
            )
            .timestamp()
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────

pub fn has_accepted_current_tos(
    tos_accepted_at: Option<DateTime<Utc>>,
    tos_timestamp: DateTime<Utc>,
) -> bool {
    tos_accepted_at.map_or(false, |ts| ts >= tos_timestamp)
}

// ── Unauthenticated endpoint ─────────────────────────────────────────────

#[derive(Debug, Serialize, ToSchema)]
#[cfg_attr(test, derive(serde::Deserialize))]
pub(crate) struct TosInfo {
    pub current_tos_timestamp: DateTime<Utc>,
}

/// Returns the current ToS version timestamp.
///
/// Unauthenticated. The client compares this against the user's
/// `tos_accepted_at` to decide whether ToS acceptance is needed.
#[endpoint]
pub async fn current_tos(depot: &mut Depot) -> JsonResult<TosInfo> {
    let ts = depot.current_tos_timestamp();
    json_ok(TosInfo {
        current_tos_timestamp: ts,
    })
}

// ── Hoop ─────────────────────────────────────────────────────────────────

/// Hoop that checks whether the authenticated user has accepted the current ToS.
///
/// Reads the `tos` claim from the JWT (stored in the depot by `access_hoop`)
/// and the [`CurrentTosTimestamp`] from the depot (injected via `affix_state`).
/// Returns **403 Forbidden** with brief `TosNotAccepted` if the user hasn't accepted.
///
/// Must run **after** `access_hoop`.
#[handler]
pub async fn tos_hoop(depot: &mut Depot, res: &mut Response, ctrl: &mut FlowCtrl) {
    let tos_accepted_at = depot.tos_accepted_at();
    let tos_timestamp = depot.current_tos_timestamp();
    if !has_accepted_current_tos(tos_accepted_at, tos_timestamp) {
        StatusError::forbidden().brief("TosNotAccepted").render(res);
        ctrl.skip_rest();
    }
}

pub trait RouterTosExt {
    /// Guard routes behind ToS acceptance. See [`tos_hoop`].
    fn requires_tos_accepted(self) -> Self;
}

impl RouterTosExt for Router {
    fn requires_tos_accepted(self) -> Self {
        self.hoop(tos_hoop)
    }
}

// ── Tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;

    fn sample_ts() -> DateTime<Utc> {
        Utc::now()
    }

    #[test]
    fn current_tos_key_matches_method() {
        assert_eq!(
            CURRENT_TOS_KEY,
            CURRENT_TOS.key(),
            "CURRENT_TOS_KEY must match the enum key() method"
        );
    }

    #[test]
    fn has_accepted_none_returns_false() {
        let ts = sample_ts();
        assert!(
            !has_accepted_current_tos(None, ts),
            "None should indicate ToS not accepted"
        );
    }

    #[test]
    fn has_accepted_before_returns_false() {
        let ts = sample_ts();
        let before = ts - Duration::seconds(1);
        assert!(
            !has_accepted_current_tos(Some(before), ts),
            "timestamp before current ToS should be rejected"
        );
    }

    #[test]
    fn has_accepted_equal_returns_true() {
        let ts = sample_ts();
        assert!(
            has_accepted_current_tos(Some(ts), ts),
            "timestamp equal to current ToS should be accepted"
        );
    }

    #[test]
    fn has_accepted_after_returns_true() {
        let ts = sample_ts();
        let after = ts + Duration::seconds(1);
        assert!(
            has_accepted_current_tos(Some(after), ts),
            "timestamp after current ToS should be accepted"
        );
    }

    #[test]
    fn current_tos_timestamp_truncates_to_seconds() {
        let ts_with_nanos = DateTime::from_timestamp(1_700_000_000, 123_456_789).unwrap();
        let tos_ts = CurrentTosTimestamp::from_utc(ts_with_nanos);
        assert_eq!(
            tos_ts.timestamp().timestamp_subsec_nanos(),
            0,
            "CurrentTosTimestamp must truncate sub-second precision"
        );
        assert_eq!(
            tos_ts.timestamp().timestamp(),
            1_700_000_000,
            "second-precision unix timestamp must be preserved"
        );
    }

    #[test]
    fn current_tos_timestamp_now_truncates() {
        let tos_ts = CurrentTosTimestamp::now();
        assert_eq!(
            tos_ts.timestamp().timestamp_subsec_nanos(),
            0,
            "CurrentTosTimestamp::now() must truncate sub-second precision"
        );
    }

    #[test]
    fn tos_version_key_is_date_format() {
        let key = TosVersion::V2026_02_25.key();
        // Must be YYYY-MM-DD format
        assert_eq!(key.len(), 10, "ToS key must be 10 chars (YYYY-MM-DD)");
        assert_eq!(&key[4..5], "-", "ToS key must have hyphen at position 4");
        assert_eq!(&key[7..8], "-", "ToS key must have hyphen at position 7");
    }

    #[test]
    fn has_accepted_far_future_returns_true() {
        let tos_ts = DateTime::from_timestamp(1_000_000_000, 0).unwrap();
        let accepted = DateTime::from_timestamp(2_000_000_000, 0).unwrap();
        assert!(
            has_accepted_current_tos(Some(accepted), tos_ts),
            "acceptance far in the future should pass"
        );
    }

    #[test]
    fn has_accepted_far_past_returns_false() {
        let tos_ts = DateTime::from_timestamp(2_000_000_000, 0).unwrap();
        let accepted = DateTime::from_timestamp(1_000_000_000, 0).unwrap();
        assert!(
            !has_accepted_current_tos(Some(accepted), tos_ts),
            "acceptance far in the past should fail"
        );
    }
}
