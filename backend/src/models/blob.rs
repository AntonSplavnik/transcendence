use base64::Engine;
use base64::engine::Config;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as base64url;
use diesel::deserialize::{self, FromSql, FromSqlRow};
use diesel::expression::AsExpression;
use diesel::serialize::{self, Output, ToSql};
use diesel::sql_types::{Binary, Text};
use diesel::sqlite::Sqlite;
use rand::Rng;
use rand::distr::{Distribution, StandardUniform};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use smallvec::SmallVec;
use std::cmp::Ordering;
use std::fmt;
use std::ops::Deref;
use std::str::Utf8Error;

/// Fixed-size blob type of exactly N bytes.
///
/// Serialization:
/// - base64url (no padding) string
///
/// Database behavior:
/// - Write: all N bytes are stored as-is.
/// - Read: exactly N bytes are expected.
///
/// Panics if a value read from the database is not exactly N bytes.
#[derive(
    Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, AsExpression, FromSqlRow,
)]
#[diesel(sql_type = Binary)]
#[diesel(sql_type = Text)]
pub struct FixedBlob<const N: usize>(pub [u8; N]);

impl<const N: usize> FixedBlob<N> {
    /// Creates a new zero-initialized FixedBlob.
    #[inline]
    pub const fn empty() -> Self {
        Self([0u8; N])
    }

    // len() and as_slice() already exist via Deref

    /// Returns the bytes as `&str` without validating UTF-8.
    ///
    /// # Safety
    /// Caller must guarantee the data is valid UTF-8.
    #[inline]
    pub fn as_str_unchecked(&self) -> &str {
        // SAFETY: The user must ensure the data is valid UTF-8
        unsafe { str::from_utf8_unchecked(self.0.as_slice()) }
    }

    /// Returns the bytes as UTF-8 `&str`.
    ///
    /// Fails if the contents are not valid UTF-8.
    #[inline]
    pub fn to_str(&self) -> Result<&str, Utf8Error> {
        std::str::from_utf8(self.0.as_slice())
    }

    /// Returns the inner fixed-size array.
    #[inline]
    pub fn to_inner(&self) -> [u8; N] {
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
            Err(_) => panic!("Source string length != {}", N),
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
            Err(_) => panic!("Source slice length != {}", N),
        }
    }

    /// Attempts to create a `FixedBlob` from a byte slice.
    ///
    /// Returns `Err` when the length is not exactly N bytes.
    #[inline]
    pub fn try_from_slice(
        slice: impl AsRef<[u8]>,
    ) -> Result<Self, IntoBlobError> {
        let slice: &[u8; N] = slice
            .as_ref()
            .try_into()
            .map_err(|_| IntoBlobError::InvalidLength)?;
        Ok(Self(*slice))
    }

    /// Encodes the blob as a base64url (no padding) string.
    #[inline]
    pub fn to_base64url(&self) -> String {
        let encoded_len = base64::encoded_len(
            self.len(),
            base64url.config().encode_padding(),
        )
        .expect("we're not planning to encode 13835 or more Petabytes at once anytime soon :)");
        let mut buf: SmallVec<[u8; 96]> = SmallVec::from_elem(0, encoded_len);
        let encoded = base64url
            .encode_slice(self, &mut buf)
            .expect("output buffer is large enough");
        // SAFETY: encoded is guaranteed to be valid UTF-8
        unsafe { str::from_utf8_unchecked(&buf[..encoded]) }.to_owned()
    }

    /// Decodes a base64url (no padding) string into a `FixedBlob`.
    #[inline]
    pub fn try_from_base64url(
        s: impl AsRef<[u8]>,
    ) -> Result<Self, IntoBlobError> {
        let mut buf: [u8; N] = [0u8; N];
        let decoded_len = base64url
            .decode_slice(s.as_ref(), &mut buf)
            .map_err(|_| IntoBlobError::InvalidLength)?;
        FixedBlob::try_from_slice(&buf[..decoded_len])
    }
}

impl<const N: usize> From<[u8; N]> for FixedBlob<N> {
    #[inline]
    fn from(value: [u8; N]) -> Self {
        Self(value)
    }
}

impl<const N: usize> TryFrom<&[u8]> for FixedBlob<N> {
    type Error = IntoBlobError;

    #[inline]
    fn try_from(value: &[u8]) -> Result<Self, Self::Error> {
        Self::try_from_slice(value)
    }
}

impl<const N: usize> TryFrom<&str> for FixedBlob<N> {
    type Error = IntoBlobError;

    #[inline]
    fn try_from(value: &str) -> Result<Self, Self::Error> {
        Self::try_from_str(value)
    }
}

impl<const N: usize> ToSql<Binary, Sqlite> for FixedBlob<N> {
    #[inline]
    fn to_sql<'b>(
        &'b self,
        out: &mut Output<'b, '_, Sqlite>,
    ) -> serialize::Result {
        out.set_value(self.as_bytes());
        Ok(serialize::IsNull::No)
    }
}

impl<const N: usize> FromSql<Binary, Sqlite> for FixedBlob<N> {
    #[inline]
    fn from_sql(
        mut bytes: diesel::sqlite::SqliteValue,
    ) -> deserialize::Result<Self> {
        Ok(FixedBlob::try_from_slice(bytes.read_blob())?)
    }
}

impl<const N: usize> ToSql<Text, Sqlite> for FixedBlob<N> {
    #[inline]
    fn to_sql<'b>(
        &'b self,
        out: &mut Output<'b, '_, Sqlite>,
    ) -> serialize::Result {
        out.set_value(self.as_str_unchecked());
        Ok(serialize::IsNull::No)
    }
}

impl<const N: usize> FromSql<Text, Sqlite> for FixedBlob<N> {
    #[inline]
    fn from_sql(
        mut bytes: diesel::sqlite::SqliteValue,
    ) -> deserialize::Result<Self> {
        Ok(FixedBlob::try_from_slice(bytes.read_text().as_bytes())?)
    }
}

/// Variable-size null-terminated blob type with maximum size N bytes.
///
/// Serialization:
/// - base64url (no padding) string
///
/// Database behavior:
/// - Write: bytes up to the first null byte (or all N if none) are stored.
/// - Read: bytes are read and padded with null bytes up to N if shorter.
///
/// Panics if a value read from the database exceeds N bytes.
#[derive(Clone, Copy, Hash, AsExpression, FromSqlRow)]
#[diesel(sql_type = Binary)]
#[diesel(sql_type = Text)]
pub struct VarBlob<const N: usize>([u8; N]);

/// Error type for conversion failures when creating blob types from slices.
#[derive(Debug, thiserror::Error)]
pub enum IntoBlobError {
    #[error("Source slice length doesnt match the required length")]
    InvalidLength,
    #[error("Source slice contains a null byte, when it should not")]
    DisallowedNullByte,
}

impl<const N: usize> VarBlob<N> {
    /// Creates a new zero-initialized VarBlob.
    #[inline]
    pub const fn empty() -> Self {
        Self([0u8; N])
    }

    /// Returns the length up to the first null byte (or N if none).
    #[inline]
    pub fn len(&self) -> usize {
        self.0.iter().position(|&b| b == 0).unwrap_or(N)
    }

    /// Returns the bytes as `&str` without validating UTF-8.
    ///
    /// # Safety
    /// Caller must guarantee the data is valid UTF-8.
    #[inline]
    pub fn as_str_unchecked(&self) -> &str {
        // SAFETY: The user must ensure the data is valid UTF-8.
        unsafe { str::from_utf8_unchecked(&self.0[..self.len()]) }
    }

    /// Returns the bytes as UTF-8 `&str`.
    ///
    /// Fails if the contents are not valid UTF-8.
    #[inline]
    pub fn to_str(&self) -> Result<&str, Utf8Error> {
        std::str::from_utf8(&self.0[..self.len()])
    }

    /// Returns the inner fixed-size array.
    #[inline]
    pub fn to_inner(&self) -> [u8; N] {
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
            Err(_) => panic!("Source string too long to fit in VarBlob<{}>", N),
        }
    }

    /// Attempts to create a `VarBlob` from a string.
    ///
    /// Returns `Err` if the string length exceeds N bytes.
    #[inline]
    pub fn try_from_str(s: impl AsRef<str>) -> Result<Self, IntoBlobError> {
        Self::try_from_slice_unchecked_null(s.as_ref())
    }

    /// Creates a `VarBlob` from a slice, stopping at the first null byte.
    ///
    /// # Panics
    /// Panics if the slice length up to the first null exceeds N bytes.
    #[inline]
    pub fn from_slice_until_null(slice: impl AsRef<[u8]>) -> Self {
        match Self::try_from_slice_until_null(slice) {
            Ok(blob) => blob,
            Err(_) => panic!("Source slice too long to fit in VarBlob<{}>", N),
        }
    }

    /// Attempts to create a `VarBlob` from a slice, stopping at the first null byte.
    ///
    /// Returns `Err` if the slice length up to the first null exceeds N bytes.
    #[inline]
    pub fn try_from_slice_until_null(
        slice: impl AsRef<[u8]>,
    ) -> Result<Self, IntoBlobError> {
        let slice = slice.as_ref();
        let slice_len = slice.iter().take(N).take_while(|b| **b != 0).count();
        if slice_len > N {
            return Err(IntoBlobError::InvalidLength);
        }
        let slice = &slice[..slice_len];
        let mut array = [0u8; N];
        array[..slice_len].copy_from_slice(slice);
        // Null terminator is already in place due to initialization above
        Ok(Self(array))
    }

    /// Creates a `VarBlob` from a slice and keeps embedded nulls.
    ///
    /// # Panics
    /// Panics if the slice length exceeds N bytes.
    #[inline]
    pub fn from_slice_unchecked_null(slice: impl AsRef<[u8]>) -> Self {
        match Self::try_from_slice_unchecked_null(slice) {
            Ok(blob) => blob,
            Err(_) => panic!("Source slice too long to fit in VarBlob<{}>", N),
        }
    }

    /// Attempts to create a `VarBlob` from a slice and keeps embedded nulls.
    ///
    /// Returns `Err` if the slice length exceeds N bytes.
    #[inline]
    pub fn try_from_slice_unchecked_null(
        slice: impl AsRef<[u8]>,
    ) -> Result<Self, IntoBlobError> {
        let slice = slice.as_ref();
        let slice_len = slice.len();
        if slice_len > N {
            return Err(IntoBlobError::InvalidLength);
        }
        let mut array = [0u8; N];
        array[..slice_len].copy_from_slice(slice);
        // Null terminator is already in place due to initialization above
        Ok(Self(array))
    }

    /// Creates a `VarBlob` from a slice that must not contain null bytes.
    ///
    /// # Panics
    /// Panics if the slice contains a null byte or exceeds N bytes.
    pub fn from_slice_no_null(slice: impl AsRef<[u8]>) -> Self {
        match Self::try_from_slice_no_null(slice) {
            Ok(blob) => blob,
            Err(err) => panic!("Failed to create VarBlob<{}>: {}", N, err),
        }
    }

    /// Attempts to create a `VarBlob` from a slice that must not contain null bytes.
    ///
    /// Returns `Err` if a null byte is present or the length exceeds N bytes.
    #[inline]
    pub fn try_from_slice_no_null(
        slice: impl AsRef<[u8]>,
    ) -> Result<Self, IntoBlobError> {
        let slice = slice.as_ref();
        if slice.iter().take(N).any(|&b| b == 0) {
            return Err(IntoBlobError::DisallowedNullByte);
        }
        Self::try_from_slice_unchecked_null(slice)
    }

    /// Encodes the blob as a base64url (no padding) string.
    #[inline]
    pub fn to_base64url(&self) -> String {
        let slice = self.as_slice();
        let encoded_len = base64::encoded_len(
            slice.len(),
            base64url.config().encode_padding(),
        )
        .expect("we're not planning to encode 13835 or more Petabytes at once anytime soon :)");
        let mut buf: SmallVec<[u8; 96]> = SmallVec::from_elem(0, encoded_len);
        let encoded = base64url
            .encode_slice(slice, &mut buf)
            .expect("output buffer is large enough");
        // SAFETY: encoded is guaranteed to be valid UTF-8
        unsafe { str::from_utf8_unchecked(&buf[..encoded]) }.to_owned()
    }

    /// Decodes a base64url (no padding) string into a `VarBlob`.
    #[inline]
    pub fn try_from_base64url(
        s: impl AsRef<[u8]>,
    ) -> Result<Self, IntoBlobError> {
        let mut buf: [u8; N] = [0u8; N];
        let decoded_len = base64url
            .decode_slice(s.as_ref(), &mut buf)
            .map_err(|_| IntoBlobError::InvalidLength)?;
        VarBlob::try_from_slice_no_null(&buf[..decoded_len])
    }

    pub fn eq_ignore_ascii_case<const M: usize>(
        &self,
        other: &VarBlob<M>,
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
}

impl<const N: usize> From<[u8; N]> for VarBlob<N> {
    /// # Panics
    /// Panics if the source array contains a null byte with trailing non-null bytes.
    #[inline]
    fn from(value: [u8; N]) -> Self {
        let result = Self(value);
        let len_until_null = result.len();
        assert!(
            len_until_null == N
                || result.0[len_until_null..].iter().all(|b| *b == 0),
            "Source array contains a null byte, when it should not"
        );
        result
    }
}

impl<const N: usize> TryFrom<&[u8]> for VarBlob<N> {
    type Error = IntoBlobError;

    #[inline]
    fn try_from(value: &[u8]) -> Result<Self, Self::Error> {
        Self::try_from_slice_no_null(value)
    }
}

impl<const N: usize> TryFrom<&str> for VarBlob<N> {
    type Error = IntoBlobError;

    #[inline]
    fn try_from(value: &str) -> Result<Self, Self::Error> {
        Self::try_from_str(value)
    }
}

impl<const N: usize> Serialize for FixedBlob<N> {
    #[inline]
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_base64url())
    }
}

impl<'de, const N: usize> Deserialize<'de> for FixedBlob<N> {
    #[inline]
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let encoded = String::deserialize(deserializer)?;
        FixedBlob::try_from_base64url(encoded.as_bytes())
            .map_err(serde::de::Error::custom)
    }
}

impl<const N: usize> Serialize for VarBlob<N> {
    #[inline]
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_base64url())
    }
}

impl<'de, const N: usize> Deserialize<'de> for VarBlob<N> {
    #[inline]
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        // TODO deserialization itself can maybe be optimized to avoid allocation, but no idea how
        let encoded = String::deserialize(deserializer)?;
        VarBlob::try_from_base64url(encoded.as_bytes())
            .map_err(serde::de::Error::custom)
    }
}

impl<const N: usize> ToSql<Binary, Sqlite> for VarBlob<N> {
    #[inline]
    fn to_sql<'b>(
        &'b self,
        out: &mut Output<'b, '_, Sqlite>,
    ) -> serialize::Result {
        out.set_value(self.as_bytes());
        Ok(serialize::IsNull::No)
    }
}

impl<const N: usize> FromSql<Binary, Sqlite> for VarBlob<N> {
    #[inline]
    fn from_sql(
        mut bytes: diesel::sqlite::SqliteValue,
    ) -> deserialize::Result<Self> {
        Ok(VarBlob::try_from_slice_unchecked_null(bytes.read_blob())?)
    }
}

impl<const N: usize> ToSql<Text, Sqlite> for VarBlob<N> {
    #[inline]
    fn to_sql<'b>(
        &'b self,
        out: &mut Output<'b, '_, Sqlite>,
    ) -> serialize::Result {
        out.set_value(self.as_str_unchecked());
        Ok(serialize::IsNull::No)
    }
}

impl<const N: usize> FromSql<Text, Sqlite> for VarBlob<N> {
    #[inline]
    fn from_sql(
        mut bytes: diesel::sqlite::SqliteValue,
    ) -> deserialize::Result<Self> {
        Ok(VarBlob::try_from_slice_unchecked_null(
            bytes.read_text().as_bytes(),
        )?)
    }
}

impl<const N: usize, const M: usize> PartialEq<VarBlob<M>> for VarBlob<N> {
    #[inline]
    fn eq(&self, other: &VarBlob<M>) -> bool {
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

impl<const N: usize> PartialEq<[u8]> for VarBlob<N> {
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

impl<const N: usize> PartialEq<[u8]> for FixedBlob<N> {
    #[inline]
    fn eq(&self, other: &[u8]) -> bool {
        self.as_bytes() == other
    }
}

impl<const N: usize> PartialEq<&str> for VarBlob<N> {
    #[inline]
    fn eq(&self, other: &&str) -> bool {
        self.eq(other.as_bytes())
    }
}

impl<const N: usize> PartialEq<&str> for FixedBlob<N> {
    #[inline]
    fn eq(&self, other: &&str) -> bool {
        self.eq(other.as_bytes())
    }
}

impl<const N: usize> PartialEq<String> for VarBlob<N> {
    #[inline]
    fn eq(&self, other: &String) -> bool {
        self.eq(other.as_bytes())
    }
}

impl<const N: usize> PartialEq<String> for FixedBlob<N> {
    #[inline]
    fn eq(&self, other: &String) -> bool {
        self.eq(other.as_bytes())
    }
}

impl<const N: usize> Eq for VarBlob<N> {}

impl<const N: usize, const M: usize> PartialOrd<VarBlob<M>> for VarBlob<N> {
    #[inline]
    fn partial_cmp(&self, other: &VarBlob<M>) -> Option<Ordering> {
        let common = if N < M { N } else { M };

        match self.0[..common].cmp(&other.0[..common]) {
            Ordering::Equal => {
                if N > M {
                    Some(self.0[M].cmp(&0))
                } else if M > N {
                    Some(0.cmp(&other.0[N]))
                } else {
                    Some(Ordering::Equal)
                }
            }
            ord => Some(ord),
        }
    }
}

impl<const N: usize> Ord for VarBlob<N> {
    #[inline]
    fn cmp(&self, other: &Self) -> Ordering {
        // Compare the full arrays (including trailing zeros) to avoid extra passes.
        self.0.cmp(&other.0)
    }
}

impl<const N: usize> AsRef<str> for VarBlob<N> {
    #[inline]
    fn as_ref(&self) -> &str {
        self.as_str_unchecked()
    }
}

impl<const N: usize> AsRef<str> for FixedBlob<N> {
    #[inline]
    fn as_ref(&self) -> &str {
        self.as_str_unchecked()
    }
}

impl<const N: usize> AsRef<[u8]> for VarBlob<N> {
    #[inline]
    fn as_ref(&self) -> &[u8] {
        self.as_bytes()
    }
}

impl<const N: usize> AsRef<[u8]> for FixedBlob<N> {
    #[inline]
    fn as_ref(&self) -> &[u8] {
        self.as_bytes()
    }
}

impl<const N: usize> Deref for FixedBlob<N> {
    type Target = [u8; N];

    #[inline]
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl<const N: usize> Default for VarBlob<N> {
    #[inline]
    fn default() -> Self {
        Self([0u8; N])
    }
}

impl<const N: usize> Default for FixedBlob<N> {
    #[inline]
    fn default() -> Self {
        Self([0u8; N])
    }
}

impl<const N: usize> fmt::Display for FixedBlob<N> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        format_blob(&self.0, f)
    }
}

impl<const N: usize> fmt::Debug for FixedBlob<N> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "FixedBlob<{}>(", N)?;
        format_blob(&self.0, f)?;
        write!(f, ")")
    }
}

impl<const N: usize> fmt::Display for VarBlob<N> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        format_blob(self.as_bytes(), f)
    }
}

impl<const N: usize> fmt::Debug for VarBlob<N> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "VarBlob<{}>(", N)?;
        format_blob(self.as_bytes(), f)?;
        write!(f, ")")
    }
}

#[inline]
fn format_blob(bytes: &[u8], f: &mut fmt::Formatter<'_>) -> fmt::Result {
    match std::str::from_utf8(bytes) {
        Ok(s) => write!(f, "{}", s),
        Err(_) => {
            let encoded = base64url.encode(bytes);
            write!(f, "base64:{}", encoded)
        }
    }
}

impl<const N: usize> salvo::oapi::ToSchema for FixedBlob<N> {
    fn to_schema(
        components: &mut salvo::oapi::Components,
    ) -> salvo::oapi::RefOr<salvo::oapi::schema::Schema> {
        let name = salvo::oapi::naming::assign_name::<Self>(
            salvo::oapi::naming::NameRule::Auto,
        );
        let ref_or = salvo::oapi::RefOr::Ref(salvo::oapi::Ref::new(format!(
            "#/components/schemas/{}",
            name
        )));
        if !components.schemas.contains_key(&name) {
            components.schemas.insert(name.clone(), ref_or.clone());
            let schema = salvo::oapi::Object::new()
                .schema_type(salvo::oapi::schema::SchemaType::basic(
                    salvo::oapi::schema::BasicType::String,
                ))
                .description(format!(
                    "Exactly {} bytes, encoded as base64url (no padding) string",
                    N
                ));
            components.schemas.insert(name, schema);
        }
        ref_or
    }
}

impl<const N: usize> salvo::oapi::ToSchema for VarBlob<N> {
    fn to_schema(
        components: &mut salvo::oapi::Components,
    ) -> salvo::oapi::RefOr<salvo::oapi::schema::Schema> {
        let name = salvo::oapi::naming::assign_name::<Self>(
            salvo::oapi::naming::NameRule::Auto,
        );
        let ref_or = salvo::oapi::RefOr::Ref(salvo::oapi::Ref::new(format!(
            "#/components/schemas/{}",
            name
        )));
        if !components.schemas.contains_key(&name) {
            components.schemas.insert(name.clone(), ref_or.clone());
            let schema = salvo::oapi::Object::new()
                .schema_type(salvo::oapi::schema::SchemaType::basic(
                    salvo::oapi::schema::BasicType::String,
                ))
                .description(format!(
                    "Up to {} bytes, encoded as base64url (no padding) string",
                    N
                ));
            components.schemas.insert(name, schema);
        }
        ref_or
    }
}

impl<const N: usize> Distribution<FixedBlob<N>> for StandardUniform {
    fn sample<R: Rng + ?Sized>(&self, rng: &mut R) -> FixedBlob<N> {
        FixedBlob(rng.random())
    }
}
