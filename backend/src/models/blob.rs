use base64::engine::general_purpose::URL_SAFE_NO_PAD as base64url;
use base64::engine::Config;
use base64::Engine;
use diesel::deserialize::{self, FromSql, FromSqlRow};
use diesel::serialize::{self, Output, ToSql};
use diesel::sql_types::{Binary, Nullable, Text};
use diesel::sqlite::Sqlite;
use diesel::sqlite::SqliteValue;
use rand::distr::{Distribution, StandardUniform};
use rand::{Rng, RngExt};
use salvo::oapi;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use smallvec::SmallVec;
use std::cmp::Ordering;
use std::fmt;
use std::io::Cursor;
use std::marker::PhantomData;
use std::ops::{Deref, DerefMut};
use std::str::Utf8Error;

mod sealed {
    pub trait Sealed {}
    impl Sealed for super::Bytes {}
    impl Sealed for super::Str {}
}

/// Marker for raw binary blob content.
///
/// Serialized as base64url (no padding) in JSON.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default)]
pub struct Bytes;

/// Marker for UTF-8 string blob content.
///
/// Serialized as a plain string in JSON.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default)]
pub struct Str;

/// Sealed trait distinguishing blob content kinds.
///
/// - [`Bytes`]: raw binary data, serialized as base64url (no padding)
/// - [`Str`]: UTF-8 string data, serialized as a plain string
pub trait BlobKind:
    sealed::Sealed + Copy + Eq + Ord + std::hash::Hash + fmt::Debug + Default + 'static
{
}
impl BlobKind for Bytes {}
impl BlobKind for Str {}

/// A fixed-size UTF-8 string blob of exactly `N` bytes.
pub type FixedStr<const N: usize> = FixedBlob<N, Str>;

/// A variable-size null-terminated UTF-8 string blob of at most `N` bytes.
pub type VarStr<const N: usize> = VarBlob<N, Str>;

/// Error type for conversion failures when creating blob types from slices.
#[derive(Debug, thiserror::Error)]
pub enum IntoBlobError {
    #[error("Source slice length doesn't match the required length")]
    InvalidLength,
    #[error("Source slice contains a null byte, when it should not")]
    DisallowedNullByte,
}

/// Fixed-size blob type of exactly N bytes.
///
/// The `K` parameter selects the content kind:
/// - [`Bytes`] (default): raw binary, serialized as base64url (no padding)
/// - [`Str`]: UTF-8 string, serialized as a plain string
///
/// Database behavior is identical for both kinds:
/// - Write: all N bytes are stored as-is.
/// - Read: exactly N bytes are expected; a mismatched length will cause
///   deserialization from the database to return an error rather than panic.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, FromSqlRow)]
pub struct FixedBlob<const N: usize, K: BlobKind = Bytes>(pub [u8; N], PhantomData<K>);

impl<const N: usize, K: BlobKind> FixedBlob<N, K> {
    /// Creates a new zero-initialized `FixedBlob`.
    #[inline]
    pub const fn empty() -> Self {
        Self([0u8; N], PhantomData)
    }

    /// Wraps a raw byte array.
    #[inline]
    const fn wrap(inner: [u8; N]) -> Self {
        Self(inner, PhantomData)
    }

    /// Returns the number of bytes (always N).
    #[allow(clippy::unused_self)]
    // `&self` is required by the standard `len()`/`is_empty()` API convention;
    // the value comes from const generic N, not from the instance.
    #[inline]
    pub const fn len(&self) -> usize {
        N
    }

    /// Always returns false (a `FixedBlob` always has N bytes).
    #[allow(clippy::unused_self)]
    #[inline]
    pub const fn is_empty(&self) -> bool {
        N == 0
    }

    /// Returns the bytes as `&str` without validating UTF-8.
    ///
    /// # Safety
    /// Caller must guarantee the data is valid UTF-8.
    /// For [`FixedStr`], prefer deref coercion to `&str` instead.
    #[inline]
    pub fn as_str_unchecked(&self) -> &str {
        // SAFETY: The user must ensure the data is valid UTF-8
        unsafe { str::from_utf8_unchecked(self.0.as_slice()) }
    }

    /// Returns the bytes as UTF-8 `&str`.
    ///
    /// Fails if the contents are not valid UTF-8.
    #[inline]
    #[allow(clippy::wrong_self_convention)] // returns borrowed &str, must take &self
    pub fn to_str(&self) -> Result<&str, Utf8Error> {
        std::str::from_utf8(self.0.as_slice())
    }

    /// Returns the inner fixed-size array.
    #[inline]
    pub fn to_inner(self) -> [u8; N] {
        self.0
    }

    /// Returns the full byte slice (length N).
    #[inline]
    pub fn as_bytes(&self) -> &[u8] {
        self.0.as_slice()
    }

    /// Creates a `FixedBlob` from a string.
    ///
    /// # Panics
    /// Panics if the string length is not exactly N bytes.
    #[inline]
    pub fn from_str(s: impl AsRef<str>) -> Self {
        match Self::try_from_str(s) {
            Ok(blob) => blob,
            Err(e) => panic!("Source string length != {N}: {e}"),
        }
    }

    /// Attempts to create a `FixedBlob` from a string.
    ///
    /// Returns `Err` when the length is not exactly N bytes.
    #[inline]
    pub fn try_from_str(s: impl AsRef<str>) -> Result<Self, IntoBlobError> {
        Self::try_from_slice(s.as_ref())
    }

    /// Creates a `FixedBlob` from a byte slice.
    ///
    /// # Panics
    /// Panics if the slice length is not exactly N bytes.
    #[inline]
    pub fn from_slice(slice: impl AsRef<[u8]>) -> Self {
        match Self::try_from_slice(slice) {
            Ok(blob) => blob,
            Err(e) => panic!("Source slice length != {N}: {e}"),
        }
    }

    /// Attempts to create a `FixedBlob` from a byte slice.
    ///
    /// Returns `Err` when the length is not exactly N bytes.
    #[inline]
    pub fn try_from_slice(slice: impl AsRef<[u8]>) -> Result<Self, IntoBlobError> {
        let slice: &[u8; N] = slice
            .as_ref()
            .try_into()
            .map_err(|_| IntoBlobError::InvalidLength)?;
        Ok(Self::wrap(*slice))
    }

    /// Encodes the blob as a base64url (no padding) string.
    #[inline]
    pub fn to_base64url(self) -> String {
        let encoded_len = base64::encoded_len(self.len(), base64url.config().encode_padding())
            .expect("we're not planning to encode 13835 or more Petabytes at once anytime soon :)");
        let mut buf: SmallVec<[u8; 96]> = SmallVec::from_elem(0, encoded_len);
        let encoded = base64url
            .encode_slice(self.0, &mut buf)
            .expect("output buffer is large enough");
        // SAFETY: base64 output is always valid UTF-8
        unsafe { str::from_utf8_unchecked(&buf[..encoded]) }.to_owned()
    }

    /// Decodes a base64url (no padding) string into a `FixedBlob`.
    #[inline]
    pub fn try_from_base64url(s: impl AsRef<[u8]>) -> Result<Self, IntoBlobError> {
        let mut buf: [u8; N] = [0u8; N];
        let decoded_len = base64url
            .decode_slice(s.as_ref(), &mut buf)
            .map_err(|_| IntoBlobError::InvalidLength)?;
        Self::try_from_slice(&buf[..decoded_len])
    }

    /// Converts to the same blob with a different content kind.
    #[inline]
    pub fn into_kind<K2: BlobKind>(self) -> FixedBlob<N, K2> {
        FixedBlob::wrap(self.0)
    }
}

// --- From / TryFrom ---

impl<const N: usize, K: BlobKind> From<[u8; N]> for FixedBlob<N, K> {
    #[inline]
    fn from(value: [u8; N]) -> Self {
        Self::wrap(value)
    }
}

impl<const N: usize, K: BlobKind> TryFrom<&[u8]> for FixedBlob<N, K> {
    type Error = IntoBlobError;

    #[inline]
    fn try_from(value: &[u8]) -> Result<Self, Self::Error> {
        Self::try_from_slice(value)
    }
}

impl<const N: usize, K: BlobKind> TryFrom<&str> for FixedBlob<N, K> {
    type Error = IntoBlobError;

    #[inline]
    fn try_from(value: &str) -> Result<Self, Self::Error> {
        Self::try_from_str(value)
    }
}

// --- Serialize ---

impl<const N: usize> Serialize for FixedBlob<N, Bytes> {
    #[inline]
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_base64url())
    }
}

impl<const N: usize> Serialize for FixedBlob<N, Str> {
    #[inline]
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.as_str_unchecked())
    }
}

// --- Deserialize ---

impl<'de, const N: usize> Deserialize<'de> for FixedBlob<N, Bytes> {
    #[inline]
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let encoded = String::deserialize(deserializer)?;
        Self::try_from_base64url(encoded.as_bytes()).map_err(serde::de::Error::custom)
    }
}

impl<'de, const N: usize> Deserialize<'de> for FixedBlob<N, Str> {
    #[inline]
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        Self::try_from_str(&s).map_err(serde::de::Error::custom)
    }
}

// --- SQL: ToSql / FromSql (generic over K) ---

impl<const N: usize, K: BlobKind> ToSql<Binary, Sqlite> for FixedBlob<N, K> {
    #[inline]
    fn to_sql<'b>(&'b self, out: &mut Output<'b, '_, Sqlite>) -> serialize::Result {
        out.set_value(self.as_bytes());
        Ok(serialize::IsNull::No)
    }
}

impl<const N: usize, K: BlobKind> FromSql<Binary, Sqlite> for FixedBlob<N, K> {
    #[inline]
    fn from_sql(mut bytes: SqliteValue) -> deserialize::Result<Self> {
        Ok(Self::try_from_slice(bytes.read_blob())?)
    }
}

impl<const N: usize> ToSql<Text, Sqlite> for FixedBlob<N, Str> {
    #[inline]
    fn to_sql<'b>(&'b self, out: &mut Output<'b, '_, Sqlite>) -> serialize::Result {
        out.set_value(self.as_str_unchecked());
        Ok(serialize::IsNull::No)
    }
}

impl<const N: usize> ToSql<Text, Sqlite> for FixedBlob<N, Bytes> {
    #[inline]
    fn to_sql<'b>(&'b self, out: &mut Output<'b, '_, Sqlite>) -> serialize::Result {
        out.set_value(self.to_base64url());
        Ok(serialize::IsNull::No)
    }
}

impl<const N: usize> FromSql<Text, Sqlite> for FixedBlob<N, Str> {
    #[inline]
    fn from_sql(mut bytes: SqliteValue) -> deserialize::Result<Self> {
        Ok(Self::try_from_slice(bytes.read_text().as_bytes())?)
    }
}

impl<const N: usize> FromSql<Text, Sqlite> for FixedBlob<N, Bytes> {
    #[inline]
    fn from_sql(mut bytes: SqliteValue) -> deserialize::Result<Self> {
        Ok(Self::try_from_base64url(bytes.read_text())?)
    }
}

// --- Comparison with raw types ---

impl<const N: usize, K: BlobKind> PartialEq<[u8]> for FixedBlob<N, K> {
    #[inline]
    fn eq(&self, other: &[u8]) -> bool {
        self.as_bytes() == other
    }
}

impl<const N: usize, K: BlobKind> PartialEq<&str> for FixedBlob<N, K> {
    #[inline]
    fn eq(&self, other: &&str) -> bool {
        self.eq(other.as_bytes())
    }
}

impl<const N: usize, K: BlobKind> PartialEq<String> for FixedBlob<N, K> {
    #[inline]
    fn eq(&self, other: &String) -> bool {
        self.eq(other.as_bytes())
    }
}

// --- Deref ---

impl<const N: usize> Deref for FixedBlob<N, Bytes> {
    type Target = [u8; N];

    #[inline]
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl<const N: usize> Deref for FixedBlob<N, Str> {
    type Target = str;

    #[inline]
    fn deref(&self) -> &Self::Target {
        self.as_str_unchecked()
    }
}

// --- AsRef ---

impl<const N: usize> AsRef<str> for FixedBlob<N, Str> {
    #[inline]
    fn as_ref(&self) -> &str {
        self.as_str_unchecked()
    }
}

impl<const N: usize, K: BlobKind> AsRef<[u8]> for FixedBlob<N, K> {
    #[inline]
    fn as_ref(&self) -> &[u8] {
        self.as_bytes()
    }
}

// --- Default ---

impl<const N: usize, K: BlobKind> Default for FixedBlob<N, K> {
    #[inline]
    fn default() -> Self {
        Self::empty()
    }
}

// --- Display / Debug ---

impl<const N: usize, K: BlobKind> fmt::Display for FixedBlob<N, K> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        format_blob(&self.0, f)
    }
}

impl<const N: usize, K: BlobKind> fmt::Debug for FixedBlob<N, K> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "FixedBlob<{}, {}>(", N, std::any::type_name::<K>())?;
        format_blob(&self.0, f)?;
        write!(f, ")")
    }
}

// --- ToSchema ---

impl<const N: usize> oapi::ToSchema for FixedBlob<N, Bytes> {
    fn to_schema(components: &mut oapi::Components) -> oapi::RefOr<oapi::schema::Schema> {
        let name = oapi::naming::assign_name::<Self>(oapi::naming::NameRule::Auto);
        let ref_or = oapi::RefOr::Ref(oapi::Ref::new(format!("#/components/schemas/{name}")));
        if !components.schemas.contains_key(&name) {
            components.schemas.insert(name.clone(), ref_or.clone());
            let schema = oapi::Object::new()
                .schema_type(oapi::schema::SchemaType::basic(
                    oapi::schema::BasicType::String,
                ))
                .description(format!(
                    "Exactly {N} bytes, encoded as base64url (no padding)"
                ));
            components.schemas.insert(name, schema);
        }
        ref_or
    }
}

impl<const N: usize> oapi::ToSchema for FixedBlob<N, Str> {
    fn to_schema(components: &mut oapi::Components) -> oapi::RefOr<oapi::schema::Schema> {
        let name = oapi::naming::assign_name::<Self>(oapi::naming::NameRule::Auto);
        let ref_or = oapi::RefOr::Ref(oapi::Ref::new(format!("#/components/schemas/{name}")));
        if !components.schemas.contains_key(&name) {
            components.schemas.insert(name.clone(), ref_or.clone());
            let schema = oapi::Object::new()
                .schema_type(oapi::schema::SchemaType::basic(
                    oapi::schema::BasicType::String,
                ))
                .description(format!(
                    "UTF-8 string of exactly {N} bytes (maxLength/minLength are in bytes, not characters)"
                ));
            components.schemas.insert(name, schema);
        }
        ref_or
    }
}

// --- Distribution (Bytes only) ---

impl<const N: usize> Distribution<FixedBlob<N, Bytes>> for StandardUniform {
    fn sample<R: Rng + ?Sized>(&self, rng: &mut R) -> FixedBlob<N, Bytes> {
        FixedBlob::wrap(rng.random())
    }
}

/// Variable-size null-terminated blob type with maximum size N bytes.
/// WARNING: Not for binary data possibly containing zeros.
///
/// The `K` parameter selects the content kind:
/// - [`Bytes`] (default): raw binary, serialized as base64url (no padding)
/// - [`Str`]: UTF-8 string, serialized as a plain string
///
/// Database behavior is identical for both kinds:
/// - Write: bytes up to the first null byte (or all N if none) are stored.
/// - Read: bytes are read and padded with null bytes up to N if shorter.
///
/// Panics if a value read from the database exceeds N bytes.
#[derive(Clone, Copy, Hash, FromSqlRow)]
pub struct VarBlob<const N: usize, K: BlobKind = Bytes>([u8; N], PhantomData<K>);

impl<const N: usize, K: BlobKind> VarBlob<N, K> {
    /// Creates a new zero-initialized `VarBlob`.
    #[inline]
    pub const fn empty() -> Self {
        Self([0u8; N], PhantomData)
    }

    /// Wraps a raw byte array.
    #[inline]
    const fn wrap(inner: [u8; N]) -> Self {
        Self(inner, PhantomData)
    }

    /// Returns the length up to the first null byte (or N if none).
    #[inline]
    pub fn len(&self) -> usize {
        self.0.iter().position(|&b| b == 0).unwrap_or(N)
    }

    /// Returns `true` if the effective length is zero.
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.0[0] == 0
    }

    /// Returns the bytes as `&str` without validating UTF-8.
    ///
    /// # Safety
    /// Caller must guarantee the data is valid UTF-8.
    /// For [`VarStr`], prefer deref coercion to `&str` instead.
    #[inline]
    pub fn as_str_unchecked(&self) -> &str {
        // SAFETY: The user must ensure the data is valid UTF-8.
        unsafe { str::from_utf8_unchecked(&self.0[..self.len()]) }
    }

    /// Returns the bytes as UTF-8 `&str`.
    ///
    /// Fails if the contents are not valid UTF-8.
    #[inline]
    #[allow(clippy::wrong_self_convention)] // returns borrowed &str, must take &self
    pub fn to_str(&self) -> Result<&str, Utf8Error> {
        std::str::from_utf8(&self.0[..self.len()])
    }

    /// Returns the inner fixed-size array.
    #[inline]
    pub fn to_inner(self) -> [u8; N] {
        self.0
    }

    /// Returns the non-null portion as a byte slice.
    #[inline]
    pub fn as_bytes(&self) -> &[u8] {
        &self.0[..self.len()]
    }

    /// Returns the non-null portion as a byte slice.
    #[inline]
    pub fn as_slice(&self) -> &[u8] {
        &self.0[..self.len()]
    }

    /// Creates a `VarBlob` from a string.
    ///
    /// # Panics
    /// Panics if the string length exceeds N bytes.
    #[inline]
    pub fn from_str(s: impl AsRef<str>) -> Self {
        match Self::try_from_str(s) {
            Ok(blob) => blob,
            Err(e) => panic!("Source string too long to fit in VarBlob<{N}>: {e}"),
        }
    }

    /// Attempts to create a `VarBlob` from a string.
    ///
    /// Any content at and after the first null byte is discarded.
    /// Returns `Err` if the string length (up to the first null) exceeds N bytes.
    #[inline]
    pub fn try_from_str(s: impl AsRef<str>) -> Result<Self, IntoBlobError> {
        Self::try_from_slice_until_null(s.as_ref())
    }

    /// Creates a `VarBlob` from a slice, stopping at the first null byte.
    ///
    /// # Panics
    /// Panics if the slice length up to the first null exceeds N bytes.
    #[inline]
    pub fn from_slice_until_null(slice: impl AsRef<[u8]>) -> Self {
        match Self::try_from_slice_until_null(slice) {
            Ok(blob) => blob,
            Err(e) => panic!("Source slice too long to fit in VarBlob<{N}>: {e}"),
        }
    }

    /// Attempts to create a `VarBlob` from a slice, stopping at the first null byte.
    ///
    /// Returns `Err` if the slice length up to the first null exceeds N bytes.
    #[inline]
    pub fn try_from_slice_until_null(slice: impl AsRef<[u8]>) -> Result<Self, IntoBlobError> {
        let slice = slice.as_ref();
        let slice_len = slice.iter().take(N + 1).take_while(|b| **b != 0).count();
        if slice_len > N {
            return Err(IntoBlobError::InvalidLength);
        }
        let slice = &slice[..slice_len];
        let mut array = [0u8; N];
        array[..slice_len].copy_from_slice(slice);
        Ok(Self::wrap(array))
    }

    /// Creates a `VarBlob` from a slice and keeps embedded nulls.
    ///
    /// # Panics
    /// Panics if the slice length exceeds N bytes.
    #[inline]
    pub fn from_slice_unchecked_null(slice: impl AsRef<[u8]>) -> Self {
        match Self::try_from_slice_unchecked_null(slice) {
            Ok(blob) => blob,
            Err(e) => panic!("Source slice too long to fit in VarBlob<{N}>: {e}"),
        }
    }

    /// Attempts to create a `VarBlob` from a slice and keeps embedded nulls.
    ///
    /// Returns `Err` if the slice length exceeds N bytes.
    #[inline]
    pub fn try_from_slice_unchecked_null(slice: impl AsRef<[u8]>) -> Result<Self, IntoBlobError> {
        let slice = slice.as_ref();
        let slice_len = slice.len();
        if slice_len > N {
            return Err(IntoBlobError::InvalidLength);
        }
        let mut array = [0u8; N];
        array[..slice_len].copy_from_slice(slice);
        Ok(Self::wrap(array))
    }

    /// Creates a `VarBlob` from a slice that must not contain null bytes.
    ///
    /// # Panics
    /// Panics if the slice contains a null byte or exceeds N bytes.
    pub fn from_slice_no_null(slice: impl AsRef<[u8]>) -> Self {
        match Self::try_from_slice_no_null(slice) {
            Ok(blob) => blob,
            Err(err) => panic!("Failed to create VarBlob<{N}>: {err}"),
        }
    }

    /// Attempts to create a `VarBlob` from a slice that must not contain null bytes.
    ///
    /// Returns `Err` if a null byte is present or the length exceeds N bytes.
    #[inline]
    pub fn try_from_slice_no_null(slice: impl AsRef<[u8]>) -> Result<Self, IntoBlobError> {
        let slice = slice.as_ref();
        if slice.iter().take(N).any(|&b| b == 0) {
            return Err(IntoBlobError::DisallowedNullByte);
        }
        Self::try_from_slice_unchecked_null(slice)
    }

    /// Encodes the blob as a base64url (no padding) string.
    #[inline]
    pub fn to_base64url(self) -> String {
        let slice = self.as_slice();
        let encoded_len = base64::encoded_len(slice.len(), base64url.config().encode_padding())
            .expect("we're not planning to encode 13835 or more Petabytes at once anytime soon :)");
        let mut buf: SmallVec<[u8; 96]> = SmallVec::from_elem(0, encoded_len);
        let encoded = base64url
            .encode_slice(slice, &mut buf)
            .expect("output buffer is large enough");
        // SAFETY: base64 output is always valid UTF-8
        unsafe { str::from_utf8_unchecked(&buf[..encoded]) }.to_owned()
    }

    /// Decodes a base64url (no padding) string into a `VarBlob`.
    #[inline]
    pub fn try_from_base64url(s: impl AsRef<[u8]>) -> Result<Self, IntoBlobError> {
        let mut buf: [u8; N] = [0u8; N];
        let decoded_len = base64url
            .decode_slice(s.as_ref(), &mut buf)
            .map_err(|_| IntoBlobError::InvalidLength)?;
        Self::try_from_slice_no_null(&buf[..decoded_len])
    }

    /// Compares content case-insensitively (ASCII only).
    pub fn eq_ignore_ascii_case<const M: usize, K2: BlobKind>(
        &self,
        other: &VarBlob<M, K2>,
    ) -> bool {
        let common = if N < M { N } else { M };

        let mut i = 0;
        while i < common {
            if !self.0[i].eq_ignore_ascii_case(&other.0[i]) {
                return false;
            }
            i += 1;
        }

        match N.cmp(&M) {
            Ordering::Less => other.0[N] == 0,
            Ordering::Equal => true,
            Ordering::Greater => self.0[M] == 0,
        }
    }

    /// Converts to the same blob with a different content kind.
    #[inline]
    pub fn into_kind<K2: BlobKind>(self) -> VarBlob<N, K2> {
        VarBlob::wrap(self.0)
    }
}

// --- From / TryFrom ---

impl<const N: usize, K: BlobKind> From<[u8; N]> for VarBlob<N, K> {
    /// # Panics
    /// Panics if the source array contains a null byte with trailing non-null bytes.
    #[inline]
    fn from(value: [u8; N]) -> Self {
        let result = Self::wrap(value);
        let len_until_null = result.len();
        assert!(
            len_until_null == N || result.0[len_until_null..].iter().all(|b| *b == 0),
            "Source array contains a null byte with trailing non-null bytes"
        );
        result
    }
}

impl<const N: usize, K: BlobKind> TryFrom<&[u8]> for VarBlob<N, K> {
    type Error = IntoBlobError;

    #[inline]
    fn try_from(value: &[u8]) -> Result<Self, Self::Error> {
        Self::try_from_slice_no_null(value)
    }
}

impl<const N: usize, K: BlobKind> TryFrom<&str> for VarBlob<N, K> {
    type Error = IntoBlobError;

    #[inline]
    fn try_from(value: &str) -> Result<Self, Self::Error> {
        Self::try_from_str(value)
    }
}

// --- Serialize ---

impl<const N: usize> Serialize for VarBlob<N, Bytes> {
    #[inline]
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_base64url())
    }
}

impl<const N: usize> Serialize for VarBlob<N, Str> {
    #[inline]
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.as_str_unchecked())
    }
}

// --- Deserialize ---

impl<'de, const N: usize> Deserialize<'de> for VarBlob<N, Bytes> {
    #[inline]
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let encoded = String::deserialize(deserializer)?;
        Self::try_from_base64url(encoded.as_bytes()).map_err(serde::de::Error::custom)
    }
}

impl<'de, const N: usize> Deserialize<'de> for VarBlob<N, Str> {
    #[inline]
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        Self::try_from_str(&s).map_err(serde::de::Error::custom)
    }
}

// --- SQL: ToSql / FromSql (generic over K) ---

impl<const N: usize, K: BlobKind> ToSql<Binary, Sqlite> for VarBlob<N, K> {
    #[inline]
    fn to_sql<'b>(&'b self, out: &mut Output<'b, '_, Sqlite>) -> serialize::Result {
        out.set_value(self.as_bytes());
        Ok(serialize::IsNull::No)
    }
}

impl<const N: usize, K: BlobKind> FromSql<Binary, Sqlite> for VarBlob<N, K> {
    #[inline]
    fn from_sql(mut bytes: SqliteValue) -> deserialize::Result<Self> {
        Ok(Self::try_from_slice_unchecked_null(bytes.read_blob())?)
    }
}

impl<const N: usize> ToSql<Text, Sqlite> for VarBlob<N, Str> {
    #[inline]
    fn to_sql<'b>(&'b self, out: &mut Output<'b, '_, Sqlite>) -> serialize::Result {
        out.set_value(self.as_str_unchecked());
        Ok(serialize::IsNull::No)
    }
}

impl<const N: usize> ToSql<Text, Sqlite> for VarBlob<N, Bytes> {
    #[inline]
    fn to_sql<'b>(&'b self, out: &mut Output<'b, '_, Sqlite>) -> serialize::Result {
        out.set_value(self.to_base64url());
        Ok(serialize::IsNull::No)
    }
}

impl<const N: usize> FromSql<Text, Sqlite> for VarBlob<N, Str> {
    #[inline]
    fn from_sql(mut bytes: SqliteValue) -> deserialize::Result<Self> {
        Ok(Self::try_from_slice_unchecked_null(
            bytes.read_text().as_bytes(),
        )?)
    }
}

impl<const N: usize> FromSql<Text, Sqlite> for VarBlob<N, Bytes> {
    #[inline]
    fn from_sql(mut bytes: SqliteValue) -> deserialize::Result<Self> {
        Ok(Self::try_from_base64url(bytes.read_text())?)
    }
}

// --- Comparison (VarBlob with VarBlob) ---

impl<const N: usize, K1: BlobKind, const M: usize, K2: BlobKind> PartialEq<VarBlob<M, K2>>
    for VarBlob<N, K1>
{
    #[inline]
    fn eq(&self, other: &VarBlob<M, K2>) -> bool {
        let common = if N < M { N } else { M };

        let mut i = 0;
        while i < common {
            if self.0[i] != other.0[i] {
                return false;
            }
            i += 1;
        }

        match N.cmp(&M) {
            Ordering::Less => other.0[N] == 0,
            Ordering::Equal => true,
            Ordering::Greater => self.0[M] == 0,
        }
    }
}

impl<const N: usize, K: BlobKind> Eq for VarBlob<N, K> {}

impl<const N: usize, K1: BlobKind, const M: usize, K2: BlobKind> PartialOrd<VarBlob<M, K2>>
    for VarBlob<N, K1>
{
    #[inline]
    fn partial_cmp(&self, other: &VarBlob<M, K2>) -> Option<Ordering> {
        let common = if N < M { N } else { M };

        match self.0[..common].cmp(&other.0[..common]) {
            Ordering::Equal => match N.cmp(&M) {
                std::cmp::Ordering::Greater => Some(self.0[M].cmp(&0)),
                std::cmp::Ordering::Less => Some(0.cmp(&other.0[N])),
                std::cmp::Ordering::Equal => Some(Ordering::Equal),
            },
            ord => Some(ord),
        }
    }
}

impl<const N: usize, K: BlobKind> Ord for VarBlob<N, K> {
    #[inline]
    fn cmp(&self, other: &Self) -> Ordering {
        // Compare the full arrays (including trailing zeros).
        self.0.cmp(&other.0)
    }
}

// --- Comparison with raw types ---

impl<const N: usize, K: BlobKind> PartialEq<[u8]> for VarBlob<N, K> {
    #[inline]
    fn eq(&self, other: &[u8]) -> bool {
        let other_len = other.len();
        let common = if N < other_len { N } else { other_len };

        let mut i = 0;
        while i < common {
            if self.0[i] != other[i] {
                return false;
            }
            i += 1;
        }
        match N.cmp(&other_len) {
            Ordering::Greater => self.0[other_len] == 0,
            Ordering::Less => other[N] == 0,
            Ordering::Equal => true,
        }
    }
}

impl<const N: usize, K: BlobKind> PartialEq<&str> for VarBlob<N, K> {
    #[inline]
    fn eq(&self, other: &&str) -> bool {
        self.eq(other.as_bytes())
    }
}

impl<const N: usize, K: BlobKind> PartialEq<String> for VarBlob<N, K> {
    #[inline]
    fn eq(&self, other: &String) -> bool {
        self.eq(other.as_bytes())
    }
}

// --- AsRef ---

impl<const N: usize> AsRef<str> for VarBlob<N, Str> {
    #[inline]
    fn as_ref(&self) -> &str {
        self.as_str_unchecked()
    }
}

impl<const N: usize, K: BlobKind> AsRef<[u8]> for VarBlob<N, K> {
    #[inline]
    fn as_ref(&self) -> &[u8] {
        self.as_bytes()
    }
}

// --- Default ---

impl<const N: usize, K: BlobKind> Default for VarBlob<N, K> {
    #[inline]
    fn default() -> Self {
        Self::empty()
    }
}

// --- Display / Debug ---

impl<const N: usize, K: BlobKind> fmt::Display for VarBlob<N, K> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        format_blob(self.as_bytes(), f)
    }
}

impl<const N: usize, K: BlobKind> fmt::Debug for VarBlob<N, K> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "VarBlob<{}, {}>(", N, std::any::type_name::<K>())?;
        format_blob(self.as_bytes(), f)?;
        write!(f, ")")
    }
}

// --- ToSchema ---

impl<const N: usize> oapi::ToSchema for VarBlob<N, Bytes> {
    fn to_schema(components: &mut oapi::Components) -> oapi::RefOr<oapi::schema::Schema> {
        let name = oapi::naming::assign_name::<Self>(oapi::naming::NameRule::Auto);
        let ref_or = oapi::RefOr::Ref(oapi::Ref::new(format!("#/components/schemas/{name}")));
        if !components.schemas.contains_key(&name) {
            components.schemas.insert(name.clone(), ref_or.clone());
            let schema = oapi::Object::new()
                .schema_type(oapi::schema::SchemaType::basic(
                    oapi::schema::BasicType::String,
                ))
                .description(format!(
                    "Up to {N} bytes, encoded as base64url (no padding)"
                ));
            components.schemas.insert(name, schema);
        }
        ref_or
    }
}

impl<const N: usize> oapi::ToSchema for VarBlob<N, Str> {
    fn to_schema(components: &mut oapi::Components) -> oapi::RefOr<oapi::schema::Schema> {
        let name = oapi::naming::assign_name::<Self>(oapi::naming::NameRule::Auto);
        let ref_or = oapi::RefOr::Ref(oapi::Ref::new(format!("#/components/schemas/{name}")));
        if !components.schemas.contains_key(&name) {
            components.schemas.insert(name.clone(), ref_or.clone());
            let schema = oapi::Object::new()
                .schema_type(oapi::schema::SchemaType::basic(
                    oapi::schema::BasicType::String,
                ))
                .description(format!(
                    "UTF-8 string of up to {N} bytes (maxLength is in bytes, not characters)"
                ));
            components.schemas.insert(name, schema);
        }
        ref_or
    }
}

#[inline]
fn format_blob(bytes: &[u8], f: &mut fmt::Formatter<'_>) -> fmt::Result {
    if let Ok(s) = std::str::from_utf8(bytes) {
        write!(f, "{s}")
    } else {
        let encoded = base64url.encode(bytes);
        write!(f, "base64:{encoded}")
    }
}

// Diesel AsExpression – manual impls replacing #[derive(AsExpression)]
//
// FromSqlRow is provided by diesel's blanket impl:
//   FromSql → Queryable → FromSqlRow

macro_rules! impl_as_expression {
    ($blob:ident, $($sql_type:ty),+ $(,)?) => {$(
        impl<const N: usize, K: BlobKind>
            diesel::expression::AsExpression<$sql_type>
            for $blob<N, K>
        {
            type Expression =
                diesel::internal::derives::as_expression::Bound<
                    $sql_type,
                    Self,
                >;
            fn as_expression(self) -> Self::Expression {
                diesel::internal::derives::as_expression::Bound::new(self)
            }
        }

        impl<'expr, const N: usize, K: BlobKind>
            diesel::expression::AsExpression<$sql_type>
            for &'expr $blob<N, K>
        {
            type Expression =
                diesel::internal::derives::as_expression::Bound<
                    $sql_type,
                    Self,
                >;
            fn as_expression(self) -> Self::Expression {
                diesel::internal::derives::as_expression::Bound::new(self)
            }
        }
    )+};
}

impl_as_expression!(FixedBlob, Binary, Text, Nullable<Binary>, Nullable<Text>);
impl_as_expression!(VarBlob, Binary, Text, Nullable<Binary>, Nullable<Text>);

#[derive(Debug)]
pub struct WritableFixedBlob<const N: usize, K: BlobKind = Bytes>(Cursor<[u8; N]>, PhantomData<K>);

impl<const N: usize, K: BlobKind> WritableFixedBlob<N, K> {
    pub const fn new() -> Self {
        Self(Cursor::new([0u8; N]), PhantomData)
    }

    /// Finishes writing and returns the resulting `FixedBlob`.
    pub fn finish(self) -> FixedBlob<N, K> {
        FixedBlob::wrap(self.0.into_inner())
    }
}

impl<const N: usize, K: BlobKind> Deref for WritableFixedBlob<N, K> {
    type Target = Cursor<[u8; N]>;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl<const N: usize, K: BlobKind> DerefMut for WritableFixedBlob<N, K> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}

impl<const N: usize, K: BlobKind> Default for WritableFixedBlob<N, K> {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug)]
pub struct WritableVarBlob<const N: usize, K: BlobKind = Bytes>(Cursor<[u8; N]>, PhantomData<K>);

impl<const N: usize, K: BlobKind> WritableVarBlob<N, K> {
    pub const fn new() -> Self {
        Self(Cursor::new([0u8; N]), PhantomData)
    }

    /// Finishes writing and returns the resulting `VarBlob`.
    pub fn finish(self) -> VarBlob<N, K> {
        VarBlob::wrap(self.0.into_inner())
    }
}

impl<const N: usize, K: BlobKind> Deref for WritableVarBlob<N, K> {
    type Target = Cursor<[u8; N]>;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl<const N: usize, K: BlobKind> DerefMut for WritableVarBlob<N, K> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}

impl<const N: usize, K: BlobKind> Default for WritableVarBlob<N, K> {
    fn default() -> Self {
        Self::new()
    }
}
