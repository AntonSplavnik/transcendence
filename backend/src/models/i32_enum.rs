macro_rules! diesel_i32_enum {
    (
        $(#[$meta:meta])*
        $vis:vis enum $name:ident {
            $($variant:ident),+ $(,)?
        }
    ) => {
        $(#[$meta])*
        #[derive(
            Debug,
            Clone,
            Copy,
            PartialEq,
            Eq,
            serde::Serialize,
            serde::Deserialize,
            diesel::expression::AsExpression,
            diesel::deserialize::FromSqlRow,
            salvo::oapi::ToSchema,
            strum::FromRepr,
        )]
        #[diesel(sql_type = diesel::sql_types::Integer)]
        #[repr(i32)]
        $vis enum $name {
            $($variant),+
        }

        impl
            diesel::serialize::ToSql<diesel::sql_types::Integer, diesel::sqlite::Sqlite>
            for $name
        where
            i32: diesel::serialize::ToSql<
                    diesel::sql_types::Integer,
                    diesel::sqlite::Sqlite,
                >,
        {
            fn to_sql<'b>(
                &'b self,
                out: &mut diesel::serialize::Output<'b, '_, diesel::sqlite::Sqlite>,
            ) -> diesel::serialize::Result {
                out.set_value(*self as i32);
                Ok(diesel::serialize::IsNull::No)
            }
        }

        impl<DB> diesel::deserialize::FromSql<diesel::sql_types::Integer, DB>
            for $name
        where
            DB: diesel::backend::Backend,
            i32: diesel::deserialize::FromSql<diesel::sql_types::Integer, DB>,
        {
            fn from_sql(bytes: DB::RawValue<'_>) -> diesel::deserialize::Result<Self> {
                match $name::from_repr(i32::from_sql(bytes)?) {
                    Some(ty) => Ok(ty),
                    None => Err("Unrecognized enum variant".into()),
                }
            }
        }
    };
}
