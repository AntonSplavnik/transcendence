// @generated automatically by Diesel CLI.

diesel::table! {
    achievements (id) {
        id -> Integer,
        code -> Text,
        name -> Text,
        description -> Text,
        category -> Text,
        bronze_threshold -> Integer,
        silver_threshold -> Integer,
        gold_threshold -> Integer,
        base_xp_reward -> Integer,
        created_at -> Timestamp,
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
    games (id) {
        id -> Integer,
        player1_id -> Integer,
        player2_id -> Integer,
        winner_id -> Integer,
        score_p1 -> Integer,
        score_p2 -> Integer,
        played_at -> TimestamptzSqlite,
        mode -> Text,
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
    two_fa_recovery_codes (id) {
        id -> Integer,
        user_id -> Integer,
        code_hash -> Binary,
        used_at -> Nullable<TimestamptzSqlite>,
        created_at -> TimestamptzSqlite,
    }
}

diesel::table! {
    user_achievements (id) {
        id -> Integer,
        user_id -> Integer,
        achievement_id -> Integer,
        current_progress -> Integer,
        bronze_unlocked_at -> Nullable<Timestamp>,
        silver_unlocked_at -> Nullable<Timestamp>,
        gold_unlocked_at -> Nullable<Timestamp>,
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
        created_at -> TimestamptzSqlite,
        updated_at -> TimestamptzSqlite,
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
    }
}

diesel::joinable!(avatars_large -> users (user_id));
diesel::joinable!(avatars_small -> users (user_id));
diesel::joinable!(notifications -> users (user_id));
diesel::joinable!(sessions -> users (user_id));
diesel::joinable!(two_fa_recovery_codes -> users (user_id));
diesel::joinable!(user_achievements -> achievements (achievement_id));
diesel::joinable!(user_achievements -> users (user_id));
diesel::joinable!(user_stats -> users (user_id));

diesel::allow_tables_to_appear_in_same_query!(
    achievements,
    avatars_large,
    avatars_small,
    games,
    notifications,
    sessions,
    two_fa_recovery_codes,
    user_achievements,
    user_stats,
    users,
);
