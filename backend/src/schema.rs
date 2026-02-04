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
    active_daily_challenges (id) {
        id -> Integer,
        challenge_id -> Integer,
        active_date -> Date,
        slot -> Integer,
    }
}

diesel::table! {
    daily_challenge_pool (id) {
        id -> Integer,
        code -> Text,
        description -> Text,
        difficulty -> Text,
        target_value -> Integer,
        stat_to_track -> Text,
        xp_reward -> Integer,
        created_at -> Timestamp,
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
        achievement_id -> Integer,
        current_progress -> Integer,
        bronze_unlocked_at -> Nullable<Timestamp>,
        silver_unlocked_at -> Nullable<Timestamp>,
        gold_unlocked_at -> Nullable<Timestamp>,
    }
}

diesel::table! {
    user_daily_progress (id) {
        id -> Integer,
        user_id -> Integer,
        active_challenge_id -> Integer,
        current_progress -> Integer,
        completed_at -> Nullable<Timestamp>,
        xp_claimed -> Bool,
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

diesel::joinable!(active_daily_challenges -> daily_challenge_pool (challenge_id));
diesel::joinable!(sessions -> users (user_id));
diesel::joinable!(two_fa_recovery_codes -> users (user_id));
diesel::joinable!(user_achievements -> achievements (achievement_id));
diesel::joinable!(user_achievements -> users (user_id));
diesel::joinable!(user_daily_progress -> active_daily_challenges (active_challenge_id));
diesel::joinable!(user_daily_progress -> users (user_id));
diesel::joinable!(user_stats -> users (user_id));

diesel::allow_tables_to_appear_in_same_query!(
    achievements,
    active_daily_challenges,
    daily_challenge_pool,
    sessions,
    two_fa_recovery_codes,
    user_achievements,
    user_daily_progress,
    user_stats,
    users,
);
