use diesel_derive_newtype::DieselNewType;
use serde::{Deserialize, Serialize};
use ulid::Ulid;

use crate::models::blob::FixedBlob;

#[derive(
    DieselNewType,
    Clone,
    Copy,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    Hash,
    Serialize,
    Deserialize,
)]
#[serde(from = "Ulid")]
#[serde(into = "Ulid")]
pub struct SqlUlid(FixedBlob<16>);

impl SqlUlid {
    #[inline]
    pub fn ulid(&self) -> Ulid {
        Ulid::from_bytes(self.0.0)
    }
}

impl From<Ulid> for SqlUlid {
    #[inline]
    fn from(value: Ulid) -> Self {
        Self(FixedBlob(value.to_bytes()))
    }
}

impl From<SqlUlid> for Ulid {
    #[inline]
    fn from(value: SqlUlid) -> Self {
        value.0.0.into()
    }
}

impl std::fmt::Debug for SqlUlid {
    #[inline]
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.ulid().fmt(f)
    }
}

impl std::fmt::Display for SqlUlid {
    #[inline]
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.ulid().fmt(f)
    }
}
