use base64::engine::general_purpose::URL_SAFE_NO_PAD as base64url;
use base64::prelude::*;
use thiserror::Error;

use crate::models::blob::FixedBlob;
use crate::prelude::*;

#[derive(Debug, Error)]
pub enum TokenDecodeError {
    #[error("Invalid base64url encoding")]
    Base64(#[from] base64::DecodeError),
    #[error("Invalid decoded length: expected {expected} bytes, got {actual}")]
    InvalidLength { expected: usize, actual: usize },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize)]
#[serde(try_from = "String")]
pub struct SessionToken([u8; 32]);

impl SessionToken {
    pub fn generate() -> Self {
        SessionToken(rand::random())
    }

    pub fn to_hash(&self) -> SessionTokenHash {
        SessionTokenHash::from(*self)
    }

    pub fn encoded(&self) -> String {
        base64url.encode(&self.0)
    }
}

impl Default for SessionToken {
    fn default() -> Self {
        SessionToken::generate()
    }
}

impl TryFrom<&str> for SessionToken {
    fn try_from(s: &str) -> Result<Self, Self::Error> {
        let decoded = base64url.decode(s.as_bytes())?;
        if decoded.len() != 32 {
            return Err(TokenDecodeError::InvalidLength {
                expected: 32,
                actual: decoded.len(),
            });
        }
        Ok(SessionToken(decoded.try_into().expect("length checked")))
    }

    type Error = TokenDecodeError;
}

impl TryFrom<String> for SessionToken {
    fn try_from(s: String) -> Result<Self, Self::Error> {
        SessionToken::try_from(s.as_str())
    }

    type Error = TokenDecodeError;
}

#[derive(diesel_derive_newtype::DieselNewType, Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct SessionTokenHash(FixedBlob<32>);

impl SessionTokenHash {
    pub fn to_truncated(&self) -> SessionTokenHashTruncated {
        SessionTokenHashTruncated::from(*self)
    }
}

impl From<SessionToken> for SessionTokenHash {
    fn from(value: SessionToken) -> Self {
        Self(blake3::hash(&value.0).into())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize, Serialize)]
#[serde(try_from = "String", into = "String")]
pub struct SessionTokenHashTruncated([u8; 16]);

impl SessionTokenHashTruncated {
    pub fn encoded(&self) -> String {
        base64url.encode(&self.0)
    }
}

impl From<SessionTokenHash> for SessionTokenHashTruncated {
    fn from(hash: SessionTokenHash) -> Self {
        let mut truncated = [0u8; 16];
        truncated.copy_from_slice(&hash.0[..16]);
        SessionTokenHashTruncated(truncated)
    }
}

impl TryFrom<String> for SessionTokenHashTruncated {
    fn try_from(s: String) -> Result<Self, Self::Error> {
        let decoded = base64url.decode(s.as_bytes())?;
        if decoded.len() != 16 {
            return Err(TokenDecodeError::InvalidLength {
                expected: 16,
                actual: decoded.len(),
            });
        }
        Ok(SessionTokenHashTruncated(
            decoded.try_into().expect("length checked"),
        ))
    }

    type Error = TokenDecodeError;
}

impl From<SessionTokenHashTruncated> for String {
    fn from(truncated: SessionTokenHashTruncated) -> Self {
        truncated.encoded()
    }
}

// implement comparison between SessionTokenHash and SessionTokenHashTruncated where only the first 16 bytes are compared
impl PartialEq<SessionTokenHashTruncated> for SessionTokenHash {
    fn eq(&self, other: &SessionTokenHashTruncated) -> bool {
        &self.0[..16] == &other.0[..]
    }
}

impl PartialEq<SessionTokenHash> for SessionTokenHashTruncated {
    fn eq(&self, other: &SessionTokenHash) -> bool {
        &self.0[..] == &other.0[..16]
    }
}

impl From<blake3::Hash> for FixedBlob<32> {
    fn from(value: blake3::Hash) -> Self {
        let bytes: [u8; 32] = value.into();
        FixedBlob::from(bytes)
    }
}
