//! A transparent newtype that stores any `Serialize + DeserializeOwned` value
//! as a CBOR-encoded `Binary` blob in the database.
//!
//! # Example
//!
//! ```ignore
//! use crate::models::cbor_blob::CborBlob;
//!
//! // In your model struct:
//! pub data: CborBlob<Notification>,
//!
//! // Usage – wrapping:
//! let blob = CborBlob::new(Notification::FriendInvite { sender: 42 });
//! let blob: CborBlob<_> = Notification::FriendInvite { sender: 42 }.into();
//!
//! // Usage – access via Deref:
//! match &*blob {
//!     Notification::FriendInvite { sender } => { /* ... */ }
//! }
//!
//! // Usage – unwrapping:
//! let inner: Notification = blob.into_inner();
//! let inner: Notification = blob.into();
//! ```

use diesel::deserialize::{self, FromSql, FromSqlRow};
use diesel::expression::AsExpression;
use diesel::serialize::{self, Output, ToSql};
use diesel::sql_types::Binary;
use diesel::sqlite::{Sqlite, SqliteValue};
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::fmt;
use std::ops::{Deref, DerefMut};

/// A transparent CBOR-encoded wrapper for storing arbitrary serializable
/// values in a `Binary` database column.
///
/// `T` must implement `Serialize` (for writing) and `DeserializeOwned`
/// (for reading). The database sees raw CBOR bytes; Rust code sees `T`.
#[derive(Clone, PartialEq, Eq, Hash, AsExpression, FromSqlRow)]
#[diesel(sql_type = Binary)]
pub struct CborBlob<T>(pub T);

// Construction / conversion

impl<T> CborBlob<T> {
    /// Wrap a value.
    #[inline]
    pub fn new(value: T) -> Self {
        Self(value)
    }

    /// Unwrap, consuming the wrapper.
    #[inline]
    pub fn into_inner(self) -> T {
        self.0
    }
}

impl<T> From<T> for CborBlob<T> {
    #[inline]
    fn from(value: T) -> Self {
        Self(value)
    }
}

// Deref / DerefMut – transparent access to `T`

impl<T> Deref for CborBlob<T> {
    type Target = T;

    #[inline]
    fn deref(&self) -> &T {
        &self.0
    }
}

impl<T> DerefMut for CborBlob<T> {
    #[inline]
    fn deref_mut(&mut self) -> &mut T {
        &mut self.0
    }
}

impl<T> AsRef<T> for CborBlob<T> {
    #[inline]
    fn as_ref(&self) -> &T {
        &self.0
    }
}

impl<T> AsMut<T> for CborBlob<T> {
    #[inline]
    fn as_mut(&mut self) -> &mut T {
        &mut self.0
    }
}

// Debug – delegates to T
impl<T: fmt::Debug> fmt::Debug for CborBlob<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

// Diesel: ToSql / FromSql  (Binary ↔ CBOR bytes)

impl<T> ToSql<Binary, Sqlite> for CborBlob<T>
where
    T: Serialize + fmt::Debug,
{
    fn to_sql<'b>(&'b self, out: &mut Output<'b, '_, Sqlite>) -> serialize::Result {
        let mut buf = Vec::new();
        ciborium::into_writer(&self.0, &mut buf)
            .map_err(|e| format!("CborBlob serialization failed: {e}"))?;
        out.set_value(buf);
        Ok(serialize::IsNull::No)
    }
}

impl<T> FromSql<Binary, Sqlite> for CborBlob<T>
where
    T: DeserializeOwned + fmt::Debug,
{
    fn from_sql(mut bytes: SqliteValue<'_, '_, '_>) -> deserialize::Result<Self> {
        let blob = bytes.read_blob();
        let value = ciborium::from_reader(blob)
            .map_err(|e| format!("CborBlob deserialization failed: {e}"))?;
        Ok(Self(value))
    }
}

// Serde: Serialize / Deserialize – delegates to T transparently

impl<T: Serialize> serde::Serialize for CborBlob<T> {
    #[inline]
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.0.serialize(serializer)
    }
}

impl<'de, T: serde::Deserialize<'de>> serde::Deserialize<'de> for CborBlob<T> {
    #[inline]
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        T::deserialize(deserializer).map(CborBlob)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
    enum TestEnum {
        Foo { x: i32 },
        Bar,
    }

    #[test]
    fn roundtrip_cbor_bytes() {
        let original = TestEnum::Foo { x: 42 };

        let mut buf = Vec::new();
        ciborium::into_writer(&original, &mut buf).unwrap();
        let decoded: TestEnum = ciborium::from_reader(buf.as_slice()).unwrap();

        assert_eq!(original, decoded);
    }

    #[test]
    fn new_into_inner() {
        let blob = CborBlob::new(TestEnum::Bar);
        assert_eq!(*blob, TestEnum::Bar);
        assert_eq!(blob.into_inner(), TestEnum::Bar);
    }

    #[test]
    fn from_into() {
        let blob: CborBlob<TestEnum> = TestEnum::Foo { x: 7 }.into();
        assert_eq!(*blob, TestEnum::Foo { x: 7 });
    }

    #[test]
    fn deref_deref_mut() {
        let mut blob = CborBlob::new(TestEnum::Foo { x: 1 });
        // Deref
        assert!(matches!(&*blob, TestEnum::Foo { x: 1 }));
        // DerefMut
        *blob = TestEnum::Bar;
        assert_eq!(*blob, TestEnum::Bar);
    }

    #[test]
    fn debug_delegates() {
        let blob = CborBlob::new(TestEnum::Foo { x: 99 });
        let dbg = format!("{blob:?}");
        assert!(dbg.contains("Foo"));
        assert!(dbg.contains("99"));
    }
}
