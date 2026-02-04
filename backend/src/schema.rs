// @generated automatically by Diesel CLI.

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
    user_stats (user_id) {
        user_id -> Integer,
        xp -> Integer,
        level -> Integer,
        games_played -> Integer,
        games_won -> Integer,
        current_win_streak -> Integer,
        best_win_streak -> Integer,
        created_at -> Timestamp,
        updated_at -> Timestamp,
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

diesel::joinable!(sessions -> users (user_id));
diesel::joinable!(two_fa_recovery_codes -> users (user_id));
diesel::joinable!(user_stats -> users (user_id));

diesel::allow_tables_to_appear_in_same_query!(sessions, two_fa_recovery_codes, user_stats, users,);
