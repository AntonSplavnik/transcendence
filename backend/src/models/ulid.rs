use diesel_derive_newtype::DieselNewType;
use ulid::Ulid;

use crate::models::blob::FixedBlob;

/// Ulid NewType providing ToSql und FromSql impls, stored as 16-byte BLOB
///
/// # Usage
///
/// ```
/// #[diesel(deserialize_as = SqlUlid, serialize_as = SqlUlid)]
/// pub id: Ulid,
/// ```
#[derive(DieselNewType, Debug)]
pub struct SqlUlid(FixedBlob<16>);

impl From<Ulid> for SqlUlid {
    #[inline]
    fn from(value: Ulid) -> Self {
        Self(FixedBlob::from(value.to_bytes()))
    }
}

impl From<SqlUlid> for Ulid {
    #[inline]
    fn from(value: SqlUlid) -> Self {
        value.0.0.into()
    }
}
