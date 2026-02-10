// C FFI bindings for Rust integration
// This file provides a C-compatible API that Rust can call

#include "../include/ArenaGame.hpp"
#include <cstring>

using namespace ArenaGame;
using Game = ::ArenaGame::ArenaGame;

// Opaque pointer type for Rust
extern "C" {

// =============================================================================
// Game Lifecycle
// =============================================================================

Game* game_create() {
    return new Game();
}

void game_destroy(Game* game) {
    delete game;
}

void game_start(Game* game) {
    game->start();
}

void game_stop(Game* game) {
    game->stop();
}

void game_update(Game* game) {
    game->update();
}

bool game_is_running(Game* game) {
    return game->isRunning();
}

// =============================================================================
// Player Management
// =============================================================================

bool game_add_player(Game* game, uint32_t player_id, const char* name) {
    return game->addPlayer(player_id, std::string(name));
}

bool game_remove_player(Game* game, uint32_t player_id) {
    return game->removePlayer(player_id);
}

size_t game_get_player_count(Game* game) {
    return game->getPlayerCount();
}

// =============================================================================
// Input Handling
// =============================================================================

void game_set_input(
    Game* game,
    uint32_t player_id,
    float move_x, float move_y, float move_z,
    float look_x, float look_y, float look_z,
    bool attacking,
    bool jumping,
    bool ability1,
    bool ability2,
    bool dodging
) {
    InputState input;
    input.movementDirection = Vector3D(move_x, move_y, move_z);
    input.lookDirection = Vector3D(look_x, look_y, look_z);
    input.isAttacking = attacking;
    input.isJumping = jumping;
    input.isUsingAbility1 = ability1;
    input.isUsingAbility2 = ability2;
    input.isDodging = dodging;

    game->setPlayerInput(player_id, input);
}

// =============================================================================
// Snapshot Retrieval
// =============================================================================

// C-compatible snapshot structure
struct CCharacterSnapshot {
    uint32_t player_id;
    float pos_x, pos_y, pos_z;
    float vel_x, vel_y, vel_z;
    float yaw;
    uint8_t state;
    float health;
    float max_health;
};

struct CGameStateSnapshot {
    uint64_t frame_number;
    double timestamp;
    size_t character_count;
    CCharacterSnapshot characters[32]; // Max 32 players
};

void game_get_snapshot(Game* game, CGameStateSnapshot* out_snapshot) {
    GameStateSnapshot snapshot = game->createSnapshot();

    out_snapshot->frame_number = snapshot.frameNumber;
    out_snapshot->timestamp = snapshot.timestamp;
    out_snapshot->character_count = std::min(snapshot.characters.size(), size_t(32));

    for (size_t i = 0; i < out_snapshot->character_count; ++i) {
        const auto& src = snapshot.characters[i];
        auto& dst = out_snapshot->characters[i];

        dst.player_id = src.playerID;
        dst.pos_x = src.position.x;
        dst.pos_y = src.position.y;
        dst.pos_z = src.position.z;
        dst.vel_x = src.velocity.x;
        dst.vel_y = src.velocity.y;
        dst.vel_z = src.velocity.z;
        dst.yaw = src.yaw;
        dst.state = static_cast<uint8_t>(src.state);
        dst.health = src.health;
        dst.max_health = src.maxHealth;
    }
}

// =============================================================================
// Game State Queries
// =============================================================================

uint64_t game_get_frame_number(Game* game) {
    return game->getFrameNumber();
}

double game_get_game_time(Game* game) {
    return game->getGameTime();
}

// =============================================================================
// Combat
// =============================================================================

void game_register_hit(Game* game, uint32_t attacker_id, uint32_t victim_id, float damage) {
    game->registerHit(attacker_id, victim_id, damage);
}

} // extern "C"
