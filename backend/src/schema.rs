// @generated automatically by Diesel CLI.

diesel::table! {
    avatars_large (user_id) {
        user_id -> Integer,
        data -> Binary,
        updated_at -> Timestamp,
    }
}

diesel::table! {
    avatars_small (user_id) {
        user_id -> Integer,
        data -> Binary,
        updated_at -> Timestamp,
    }
}

diesel::table! {
    friend_requests (id) {
        id -> Integer,
        sender_id -> Integer,
        receiver_id -> Integer,
        status -> Text,
        created_at -> Timestamp,
        updated_at -> Timestamp,
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
        created_at -> Timestamp,
        refreshed_at -> Timestamp,
        last_used_at -> Timestamp,
        last_authenticated_at -> Timestamp,
    }
}

diesel::table! {
    two_fa_recovery_codes (id) {
        id -> Integer,
        user_id -> Integer,
        code_hash -> Binary,
        used_at -> Nullable<Timestamp>,
        created_at -> Timestamp,
    }
}

diesel::table! {
    users (id) {
        id -> Integer,
        email -> Text,
        nickname -> Text,
        totp_enabled -> Bool,
        totp_secret_enc -> Nullable<Text>,
        totp_confirmed_at -> Nullable<Timestamp>,
        password_hash -> Text,
        created_at -> Timestamp,
    }
}

diesel::joinable!(avatars_large -> users (user_id));
diesel::joinable!(avatars_small -> users (user_id));
diesel::joinable!(sessions -> users (user_id));
diesel::joinable!(two_fa_recovery_codes -> users (user_id));

diesel::allow_tables_to_appear_in_same_query!(
    avatars_large,
    avatars_small,
    friend_requests,
    sessions,
    two_fa_recovery_codes,
    users,
);
