use std::ops::Deref;

use diesel_derive_newtype::DieselNewType;
use salvo::oapi::ToSchema;
use serde::{Deserialize, Serialize};

use crate::models::blob::VarStr;

/// Chatname with max 31 bytes, null-terminated if shorter.
///
/// Why 31 and not 32?
/// 31 will allow Option<Chatname> to fit into only 32 bytes which is nice.
#[derive(
    DieselNewType,
    Debug,
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
#[serde(transparent)]
pub struct Chatname(pub VarStr<31>);

impl Chatname {
    pub const fn empty() -> Self {
        Chatname(VarStr::empty())
    }
}

impl Deref for Chatname {
    type Target = VarStr<31>;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl ToSchema for Chatname {
    fn to_schema(
        components: &mut salvo::oapi::Components,
    ) -> salvo::oapi::RefOr<salvo::oapi::schema::Schema> {
        <VarStr<16> as ToSchema>::to_schema(components)
    }
}
