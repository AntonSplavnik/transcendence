#[cxx::bridge]
mod ffi {
    #[derive(Deserialize, Debug, Clone, Copy)]
    struct Move {
        delta_x: i32,
        delta_y: i32,
    }

    #[derive(Deserialize, Debug, Clone, Copy)]
    struct Attack {
        target_id: u32,
    }

    #[derive(Deserialize, Debug, Clone, Copy)]
    struct UseAbility {
        ability_id: u32,
        target_id: u32,
    }

    #[derive(Deserialize, Debug, Clone, Copy)]
    struct Emote {
        emote_id: u16,
    }

    struct ServerUpdate {
        entity_id: u32,
        new_x: i32,
        new_y: i32,
    }

    struct ServerSpawn {
        entity_id: u32,
        spawn_x: i32,
        spawn_y: i32,
    }

    struct ServerDespawn {
        entity_id: u32,
    }

    unsafe extern "C++" {
        include!("game_session.hpp");

        type GameSession;

        fn game_session_new() -> UniquePtr<GameSession>;
        fn tick_count(self: &GameSession) -> u32;
        fn tick(self: Pin<&mut GameSession>, dt_ms: u32);
        fn on_move(self: Pin<&mut GameSession>, user_id: u64, msg: &Move);
        fn on_attack(self: Pin<&mut GameSession>, user_id: u64, msg: &Attack);
        fn on_use_ability(
            self: Pin<&mut GameSession>,
            user_id: u64,
            msg: &UseAbility,
        );
        fn on_emote(self: Pin<&mut GameSession>, user_id: u64, msg: &Emote);
    }

    extern "Rust" {
        fn server_update(msg: &ServerUpdate);
        fn server_spawn(msg: &ServerSpawn);
        fn server_despawn(msg: &ServerDespawn);
    }
}

use std::pin::Pin;

pub enum ServerGameMessage {
    Update(ffi::ServerUpdate),
    Spawn(ffi::ServerSpawn),
    Despawn(ffi::ServerDespawn),
}

fn handle_server_message(_msg: ServerGameMessage) {}

pub fn server_update(msg: &ffi::ServerUpdate) {
    handle_server_message(ServerGameMessage::Update(ffi::ServerUpdate {
        entity_id: msg.entity_id,
        new_x: msg.new_x,
        new_y: msg.new_y,
    }));
}

pub fn server_spawn(msg: &ffi::ServerSpawn) {
    handle_server_message(ServerGameMessage::Spawn(ffi::ServerSpawn {
        entity_id: msg.entity_id,
        spawn_x: msg.spawn_x,
        spawn_y: msg.spawn_y,
    }));
}

pub fn server_despawn(msg: &ffi::ServerDespawn) {
    handle_server_message(ServerGameMessage::Despawn(ffi::ServerDespawn {
        entity_id: msg.entity_id,
    }));
}

#[derive(serde::Deserialize, Debug, Clone)]
pub enum ClientGameMessage {
    Move(ffi::Move),
    Attack(ffi::Attack),
    UseAbility(ffi::UseAbility),
    Emote(ffi::Emote),
}

pub fn dispatch_message(
    session: Pin<&mut ffi::GameSession>,
    user_id: u64,
    msg: &ClientGameMessage,
) {
    match msg {
        ClientGameMessage::Move(payload) => session.on_move(user_id, payload),
        ClientGameMessage::Attack(payload) => {
            session.on_attack(user_id, payload)
        }
        ClientGameMessage::UseAbility(payload) => {
            session.on_use_ability(user_id, payload)
        }
        ClientGameMessage::Emote(payload) => session.on_emote(user_id, payload),
    }
}

pub use ffi::{Attack, Emote, GameSession, Move, UseAbility, game_session_new};
