use diesel::{
    backend::Backend, deserialize::FromSql, serialize::ToSql,
    sql_types::Binary, sqlite::Sqlite,
};
use serde::{Deserialize, Serialize};
use ulid::Ulid;

#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    Hash,
    diesel::expression::AsExpression,
    diesel::deserialize::FromSqlRow,
    Serialize,
    Deserialize,
)]
#[diesel(sql_type = diesel::sql_types::Binary)]
#[serde(from = "Ulid")]
#[serde(into = "Ulid")]
pub struct SqlUlid([u8; 16]);

impl SqlUlid {
    pub fn ulid(&self) -> Ulid {
        Ulid::from_bytes(self.0)
    }
}

impl From<Ulid> for SqlUlid {
    fn from(value: Ulid) -> Self {
        Self(value.to_bytes())
    }
}

impl From<SqlUlid> for Ulid {
    fn from(value: SqlUlid) -> Self {
        value.0.into()
    }
}

impl<DB> ToSql<Binary, DB> for SqlUlid
where
    DB: Backend,
    [u8; 16]: ToSql<Binary, DB>,
{
    fn to_sql<'b>(
        &'b self,
        out: &mut diesel::serialize::Output<'b, '_, DB>,
    ) -> diesel::serialize::Result {
        self.0.to_sql(out)
    }
}

impl FromSql<Binary, Sqlite> for SqlUlid
where
    Vec<u8>: FromSql<Binary, Sqlite>,
{
    fn from_sql(
        mut bytes: <Sqlite as Backend>::RawValue<'_>,
    ) -> diesel::deserialize::Result<Self> {
        Ok(Self(
            bytes
                .read_blob()
                .try_into()
                .map_err(|_| "Ulid blob length incorrect")?,
        ))
    }
}
