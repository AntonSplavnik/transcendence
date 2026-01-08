// @generated automatically by Diesel CLI.

diesel::table! {
    friendships (id) {
        id -> Integer,
        from_user_id -> Integer,
        to_user_id -> Integer,
        status -> Text,
        created_at -> Timestamp,
        updated_at -> Timestamp,
    }
}

diesel::table! {
    game_history (id) {
        id -> Integer,
        user_id -> Integer,
        kills -> Integer,
        time_played -> Integer,
        played_at -> Timestamp,
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
    user_achievements (id) {
        id -> Integer,
        user_id -> Integer,
        achievement_id -> Text,
        unlocked_at -> Timestamp,
    }
}

diesel::table! {
    user_stats (id) {
        id -> Integer,
        user_id -> Integer,
        games_played -> Integer,
        total_kills -> Integer,
        total_time_played -> Integer,
        last_game_kills -> Integer,
        last_game_time -> Integer,
        last_game_at -> Nullable<Timestamp>,
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
        avatar_url -> Nullable<Text>,
        is_online -> Bool,
        last_seen -> Nullable<Timestamp>,
    }
}

diesel::joinable!(game_history -> users (user_id));
diesel::joinable!(sessions -> users (user_id));
diesel::joinable!(two_fa_recovery_codes -> users (user_id));
diesel::joinable!(user_achievements -> users (user_id));
diesel::joinable!(user_stats -> users (user_id));

diesel::allow_tables_to_appear_in_same_query!(
    friendships,
    game_history,
    sessions,
    two_fa_recovery_codes,
    user_achievements,
    user_stats,
    users,
);
