use std::sync::LazyLock;

use chrono::{DateTime, TimeZone, Utc};

use crate::prelude::*;

/// The timestamp of the current Terms of Service.
///
/// Bump this whenever the ToS text changes to force every user to re-accept.
/// A user's `tos_accepted_at` must be >= this value to pass the ToS gate.
// 2026-02-25 00:00:00 UTC — matches "Last updated: 25.02.2026" in the frontend ToS page.
pub static CURRENT_TOS: LazyLock<DateTime<Utc>> =
    LazyLock::new(|| Utc.with_ymd_and_hms(2026, 2, 25, 0, 0, 0).unwrap());

pub fn has_accepted_current_tos(tos_accepted_at: Option<DateTime<Utc>>) -> bool {
    tos_accepted_at.map_or(false, |ts| ts >= *CURRENT_TOS)
}

/// Serde `serialize_with` helper: serializes `Option<DateTime<Utc>>` as a boolean
/// indicating whether the user has accepted the current ToS.
pub fn serialize_tos<S: serde::Serializer>(
    tos_accepted_at: &Option<DateTime<Utc>>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    serializer.serialize_bool(has_accepted_current_tos(*tos_accepted_at))
}

/// Hoop that checks whether the authenticated user has accepted the current ToS.
///
/// Reads the `tos` claim from the JWT (stored in the depot by `access_hoop`).
/// Returns **403 Forbidden** with brief `TosNotAccepted` if the user hasn't accepted.
///
/// Must run **after** `access_hoop`.
#[handler]
pub async fn tos_hoop(depot: &mut Depot, res: &mut Response, ctrl: &mut FlowCtrl) {
    let tos_accepted_at = depot.tos_accepted_at();
    if !has_accepted_current_tos(tos_accepted_at) {
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
