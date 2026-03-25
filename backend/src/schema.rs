// @generated automatically by Diesel CLI.

diesel::table! {
    account_deletion_requests (user_id) {
        user_id -> Integer,
        token -> Binary,
        confirm_token -> Nullable<Binary>,
        expires_at -> TimestamptzSqlite,
    }
}

diesel::table! {
    avatars_large (user_id) {
        user_id -> Integer,
        data -> Binary,
        updated_at -> TimestamptzSqlite,
    }
}

diesel::table! {
    avatars_small (user_id) {
        user_id -> Integer,
        data -> Binary,
        updated_at -> TimestamptzSqlite,
    }
}

diesel::table! {
    data_export_requests (user_id) {
        user_id -> Integer,
        token -> Binary,
        confirm_token -> Nullable<Binary>,
        expires_at -> TimestamptzSqlite,
    }
}

diesel::table! {
    friend_requests (id) {
        id -> Integer,
        sender_id -> Integer,
        receiver_id -> Integer,
        status -> Integer,
        created_at -> TimestamptzSqlite,
        updated_at -> TimestamptzSqlite,
    }
}

diesel::table! {
    notifications (id) {
        id -> Integer,
        user_id -> Integer,
        data -> Binary,
        created_at -> TimestamptzSqlite,
    }
}

diesel::table! {
    sessions (id) {
        id -> Integer,
        user_id -> Integer,
        token_hash -> Binary,
        device_id -> Text,
        device_name -> Nullable<Text>,
        ip_address -> Nullable<Text>,
        created_at -> TimestamptzSqlite,
        refreshed_at -> TimestamptzSqlite,
        last_used_at -> TimestamptzSqlite,
        last_authenticated_at -> TimestamptzSqlite,
    }
}

diesel::table! {
    tos_versions (key) {
        key -> Text,
        created_at -> TimestamptzSqlite,
    }
}

diesel::table! {
    two_fa_recovery_codes (id) {
        id -> Integer,
        user_id -> Integer,
        code_hash -> Binary,
        used_at -> Nullable<TimestamptzSqlite>,
        created_at -> TimestamptzSqlite,
    }
}

diesel::table! {
    users (id) {
        id -> Integer,
        email -> Text,
        nickname -> Text,
        totp_enabled -> Bool,
        totp_secret_enc -> Nullable<Text>,
        totp_confirmed_at -> Nullable<TimestamptzSqlite>,
        password_hash -> Text,
        created_at -> TimestamptzSqlite,
        description -> Text,
        tos_accepted_at -> Nullable<TimestamptzSqlite>,
        email_confirmed_at -> Nullable<TimestamptzSqlite>,
        email_confirmation_token_hash -> Nullable<Binary>,
        email_confirmation_token_expires_at -> Nullable<TimestamptzSqlite>,
        email_confirmation_token_email -> Nullable<Text>,
    }
}

diesel::joinable!(account_deletion_requests -> users (user_id));
diesel::joinable!(avatars_large -> users (user_id));
diesel::joinable!(avatars_small -> users (user_id));
diesel::joinable!(data_export_requests -> users (user_id));
diesel::joinable!(notifications -> users (user_id));
diesel::joinable!(sessions -> users (user_id));
diesel::joinable!(two_fa_recovery_codes -> users (user_id));

diesel::allow_tables_to_appear_in_same_query!(
    account_deletion_requests,
    avatars_large,
    avatars_small,
    data_export_requests,
    friend_requests,
    notifications,
    sessions,
    tos_versions,
    two_fa_recovery_codes,
    users,
);
