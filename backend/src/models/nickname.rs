use crate::models::blob::VarStr;

/// Nickname with max 16 bytes, null-terminated if shorter.
pub type Nickname = VarStr<16>;
