use std::ops::Deref;

use diesel_derive_newtype::DieselNewType;
use salvo::oapi::ToSchema;
use serde::{Deserialize, Serialize};

use crate::models::blob::VarStr;

/// Nickname with max 16 bytes, null-terminated if shorter.
#[derive(
    DieselNewType, Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
)]
#[serde(transparent)]
pub struct Nickname(pub VarStr<16>);

impl Nickname {
    pub const fn empty() -> Self {
        Nickname(VarStr::empty())
    }
}

impl Deref for Nickname {
    type Target = VarStr<16>;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl ToSchema for Nickname {
    fn to_schema(
        components: &mut salvo::oapi::Components,
    ) -> salvo::oapi::RefOr<salvo::oapi::schema::Schema> {
        <VarStr<16> as ToSchema>::to_schema(components)
    }
}
