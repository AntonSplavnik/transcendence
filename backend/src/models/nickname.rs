use std::ops::Deref;

use diesel_derive_newtype::DieselNewType;
use salvo::oapi::ToSchema;
use serde::{Deserialize, Serialize};

use crate::models::blob::VarBlob;

/// Username with max 16 bytes, null-terminated if shorter.
#[derive(
    DieselNewType, Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash,
)]
pub struct Nickname(pub VarBlob<16>);

impl Nickname {
    pub const fn empty() -> Self {
        Nickname(VarBlob::empty())
    }
}

impl Deref for Nickname {
    type Target = VarBlob<16>;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

// de/serialize as string - VarBlob::as_str_unchecked and VarBlob::try_from_str
impl Serialize for Nickname {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        self.0.as_str_unchecked().serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for Nickname {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        Ok(Nickname(
            VarBlob::try_from_str(&s).map_err(serde::de::Error::custom)?,
        ))
    }
}

impl ToSchema for Nickname {
    fn to_schema(
        components: &mut salvo::oapi::Components,
    ) -> salvo::oapi::RefOr<salvo::oapi::schema::Schema> {
        String::to_schema(components)
    }
}
