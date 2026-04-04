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
        Self(rand::random())
    }

    pub fn to_hash(self) -> SessionTokenHash {
        SessionTokenHash::from(self)
    }

    pub fn encoded(&self) -> String {
        base64url.encode(self.0)
    }
}

impl Default for SessionToken {
    fn default() -> Self {
        Self::generate()
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
        Ok(Self(decoded.try_into().expect("length checked")))
    }

    type Error = TokenDecodeError;
}

impl TryFrom<String> for SessionToken {
    fn try_from(s: String) -> Result<Self, Self::Error> {
        Self::try_from(s.as_str())
    }

    type Error = TokenDecodeError;
}

#[derive(diesel_derive_newtype::DieselNewType, Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct SessionTokenHash(FixedBlob<32>);

impl SessionTokenHash {
    pub fn to_truncated(self) -> SessionTokenHashTruncated {
        SessionTokenHashTruncated::from(self)
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
        base64url.encode(self.0)
    }
}

impl From<SessionTokenHash> for SessionTokenHashTruncated {
    fn from(hash: SessionTokenHash) -> Self {
        let mut truncated = [0u8; 16];
        truncated.copy_from_slice(&hash.0[..16]);
        Self(truncated)
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
        Ok(Self(decoded.try_into().expect("length checked")))
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
        self.0[..16] == other.0[..]
    }
}

impl PartialEq<SessionTokenHash> for SessionTokenHashTruncated {
    fn eq(&self, other: &SessionTokenHash) -> bool {
        self.0[..] == other.0[..16]
    }
}

impl From<blake3::Hash> for FixedBlob<32> {
    fn from(value: blake3::Hash) -> Self {
        let bytes: [u8; 32] = value.into();
        Self::from(bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_produces_32_bytes() {
        let token = SessionToken::generate();
        assert_eq!(token.0.len(), 32);
    }

    #[test]
    fn encode_decode_roundtrip() {
        let token = SessionToken::generate();
        let encoded = token.encoded();
        let decoded = SessionToken::try_from(encoded.as_str()).unwrap();
        assert_eq!(token, decoded);
    }

    #[test]
    fn decode_invalid_base64_fails() {
        let result = SessionToken::try_from("not-valid-base64!!!");
        assert!(result.is_err());
    }

    #[test]
    fn decode_wrong_length_fails() {
        let short = base64url.encode([0u8; 16]); // 16 bytes instead of 32
        let result = SessionToken::try_from(short.as_str());
        assert!(result.is_err());
        match result.unwrap_err() {
            TokenDecodeError::InvalidLength { expected, actual } => {
                assert_eq!(expected, 32);
                assert_eq!(actual, 16);
            }
            err @ TokenDecodeError::Base64(_) => panic!("unexpected error variant: {err:?}"),
        }
    }

    #[test]
    fn hash_is_deterministic() {
        let token = SessionToken::generate();
        let h1 = token.to_hash();
        let h2 = token.to_hash();
        assert_eq!(h1, h2);
    }

    #[test]
    fn different_tokens_produce_different_hashes() {
        let t1 = SessionToken::generate();
        let t2 = SessionToken::generate();
        assert_ne!(t1.to_hash(), t2.to_hash());
    }

    #[test]
    fn truncated_uses_first_16_bytes() {
        let token = SessionToken::generate();
        let hash = token.to_hash();
        let truncated = hash.to_truncated();
        // The truncated hash should contain the first 16 bytes of the full hash.
        assert_eq!(&hash.0[..16], &truncated.0[..]);
    }

    #[test]
    fn hash_equals_truncated_cross_type() {
        let token = SessionToken::generate();
        let hash = token.to_hash();
        let truncated = hash.to_truncated();
        assert_eq!(
            hash, truncated,
            "SessionTokenHash == SessionTokenHashTruncated"
        );
        assert_eq!(
            truncated, hash,
            "SessionTokenHashTruncated == SessionTokenHash"
        );
    }

    #[test]
    fn different_tokens_truncated_not_equal() {
        let t1 = SessionToken::generate();
        let t2 = SessionToken::generate();
        let trunc1 = t1.to_hash().to_truncated();
        let trunc2 = t2.to_hash().to_truncated();
        assert_ne!(trunc1, trunc2);
    }

    #[test]
    fn truncated_encode_decode_roundtrip() {
        let token = SessionToken::generate();
        let truncated = token.to_hash().to_truncated();
        let encoded = truncated.encoded();
        let decoded = SessionTokenHashTruncated::try_from(encoded).unwrap();
        assert_eq!(truncated, decoded);
    }

    #[test]
    fn truncated_decode_wrong_length_fails() {
        let short = base64url.encode([0u8; 8]); // 8 bytes instead of 16
        let result = SessionTokenHashTruncated::try_from(short);
        assert!(result.is_err());
    }
}
