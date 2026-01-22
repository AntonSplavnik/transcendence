// @generated automatically by Diesel CLI.

diesel::table! {
    chat_join_filters (room_id, user_id) {
        room_id -> Integer,
        user_id -> Integer,
        actor_id -> Integer,
        created_at -> Timestamp,
    }
}

diesel::table! {
    chat_members (room_id, user_id) {
        room_id -> Integer,
        user_id -> Integer,
        is_admin -> Bool,
        last_read_message_id -> Nullable<Integer>,
        joined_at -> Timestamp,
    }
}

diesel::table! {
    chat_messages (id) {
        id -> Integer,
        room_id -> Integer,
        sender_id -> Integer,
        content -> Text,
        created_at -> Timestamp,
    }
}

diesel::table! {
    chat_rooms (id) {
        id -> Integer,
        name -> Nullable<Text>,
        chat_type -> Integer,
        dm_key -> Nullable<Text>,
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

diesel::joinable!(chat_join_filters -> chat_rooms (room_id));
diesel::joinable!(chat_members -> chat_rooms (room_id));
diesel::joinable!(chat_members -> users (user_id));
diesel::joinable!(chat_messages -> chat_rooms (room_id));
diesel::joinable!(chat_messages -> users (sender_id));
diesel::joinable!(sessions -> users (user_id));
diesel::joinable!(two_fa_recovery_codes -> users (user_id));

diesel::allow_tables_to_appear_in_same_query!(
    chat_join_filters,
    chat_members,
    chat_messages,
    chat_rooms,
    sessions,
    two_fa_recovery_codes,
    users,
);
