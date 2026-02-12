// C FFI bindings for Rust integration
// This file provides a C-compatible API that Rust can call
// Updated to work with Entity-Component-System architecture

// =============================================================================
// EnTT Migration Toggle
// =============================================================================
// Set to 1 to use EnTT implementation, 0 to use original implementation
// This allows switching between implementations with zero Rust code changes
#define USE_ENTT 1
// =============================================================================

#if USE_ENTT
    #include "../include/ArenaGameEnTT.hpp"
    using Game = ::ArenaGame::ArenaGameEnTT;
#else
    #include "../include/ArenaGame.hpp"
    using Game = ::ArenaGame::ArenaGame;
#endif

#include <cstring>

using namespace ArenaGame;
using namespace ArenaGame::Core;

// Opaque pointer types for Rust
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
// Player Management (Backwards Compatible)
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
// Entity Management (NEW - ECS Features)
// =============================================================================

// Create a projectile entity
bool game_create_projectile(
    Game* game,
    uint32_t entity_id,
    float pos_x, float pos_y, float pos_z,
    float vel_x, float vel_y, float vel_z
) {
    Vector3D position(pos_x, pos_y, pos_z);
    Vector3D velocity(vel_x, vel_y, vel_z);

#if USE_ENTT
    entt::entity entity = game->getWorld().createProjectile(entity_id, position, velocity);
    return entity != entt::null;
#else
    Entity* entity = game->getWorld().createProjectile(entity_id, position, velocity);
    return entity != nullptr;
#endif
}

// Create a wall entity
bool game_create_wall(
    Game* game,
    uint32_t entity_id,
    float pos_x, float pos_y, float pos_z,
    float half_x, float half_y, float half_z
) {
    Vector3D position(pos_x, pos_y, pos_z);
    Vector3D halfExtents(half_x, half_y, half_z);

#if USE_ENTT
    entt::entity entity = game->getWorld().createWall(entity_id, position, halfExtents);
    return entity != entt::null;
#else
    Entity* entity = game->getWorld().createWall(entity_id, position, halfExtents);
    return entity != nullptr;
#endif
}

// Destroy any entity by ID
bool game_destroy_entity(Game* game, uint32_t entity_id) {
    return game->getWorld().destroyEntity(entity_id);
}

// Check if entity exists
bool game_entity_exists(Game* game, uint32_t entity_id) {
#if USE_ENTT
    return game->getEntity(entity_id) != entt::null;
#else
    return game->getEntity(entity_id) != nullptr;
#endif
}

// Check if entity is alive (has health and health > 0)
bool game_entity_is_alive(Game* game, uint32_t entity_id) {
#if USE_ENTT
    entt::entity entity = game->getEntity(entity_id);
    if (entity == entt::null) return false;

    auto& registry = game->getWorld().getRegistry();
    auto* health = registry.try_get<Components::Health>(entity);
    return health && health->isAlive();
#else
    Entity* entity = game->getEntity(entity_id);
    return entity && entity->isAlive();
#endif
}

// =============================================================================
// Component Access (NEW - Direct component manipulation)
// =============================================================================

// Get entity health
bool game_get_entity_health(Game* game, uint32_t entity_id, float* out_current, float* out_max) {
#if USE_ENTT
    entt::entity entity = game->getEntity(entity_id);
    if (entity == entt::null) return false;

    auto& registry = game->getWorld().getRegistry();
    auto* health = registry.try_get<Components::Health>(entity);
    if (!health) return false;

    *out_current = health->current;
    *out_max = health->maximum;
    return true;
#else
    Entity* entity = game->getEntity(entity_id);
    if (!entity || !entity->hasHealth()) {
        return false;
    }

    *out_current = entity->getHealth().current;
    *out_max = entity->getHealth().maximum;
    return true;
#endif
}

// Set entity health
bool game_set_entity_health(Game* game, uint32_t entity_id, float health) {
#if USE_ENTT
    entt::entity entity = game->getEntity(entity_id);
    if (entity == entt::null) return false;

    auto& registry = game->getWorld().getRegistry();
    auto* healthComp = registry.try_get<Components::Health>(entity);
    if (!healthComp) return false;

    healthComp->setHealth(health);
    return true;
#else
    Entity* entity = game->getEntity(entity_id);
    if (!entity || !entity->hasHealth()) {
        return false;
    }

    entity->getHealth().setHealth(health);
    return true;
#endif
}

// Get entity position
bool game_get_entity_position(Game* game, uint32_t entity_id, float* out_x, float* out_y, float* out_z) {
#if USE_ENTT
    entt::entity entity = game->getEntity(entity_id);
    if (entity == entt::null) return false;

    auto& registry = game->getWorld().getRegistry();
    auto* transform = registry.try_get<Components::Transform>(entity);
    if (!transform) return false;

    *out_x = transform->position.x;
    *out_y = transform->position.y;
    *out_z = transform->position.z;
    return true;
#else
    Entity* entity = game->getEntity(entity_id);
    if (!entity || !entity->hasTransform()) {
        return false;
    }

    const auto& pos = entity->getTransform().position;
    *out_x = pos.x;
    *out_y = pos.y;
    *out_z = pos.z;
    return true;
#endif
}

// Set entity position
bool game_set_entity_position(Game* game, uint32_t entity_id, float x, float y, float z) {
#if USE_ENTT
    entt::entity entity = game->getEntity(entity_id);
    if (entity == entt::null) return false;

    auto& registry = game->getWorld().getRegistry();
    auto* transform = registry.try_get<Components::Transform>(entity);
    if (!transform) return false;

    transform->position = Vector3D(x, y, z);
    return true;
#else
    Entity* entity = game->getEntity(entity_id);
    if (!entity || !entity->hasTransform()) {
        return false;
    }

    entity->getTransform().position = Vector3D(x, y, z);
    return true;
#endif
}

// Get entity velocity
bool game_get_entity_velocity(Game* game, uint32_t entity_id, float* out_x, float* out_y, float* out_z) {
#if USE_ENTT
    entt::entity entity = game->getEntity(entity_id);
    if (entity == entt::null) return false;

    auto& registry = game->getWorld().getRegistry();
    auto* physics = registry.try_get<Components::PhysicsBody>(entity);
    if (!physics) return false;

    *out_x = physics->velocity.x;
    *out_y = physics->velocity.y;
    *out_z = physics->velocity.z;
    return true;
#else
    Entity* entity = game->getEntity(entity_id);
    if (!entity || !entity->hasPhysics()) {
        return false;
    }

    const auto& vel = entity->getPhysics().velocity;
    *out_x = vel.x;
    *out_y = vel.y;
    *out_z = vel.z;
    return true;
#endif
}

// Set entity velocity
bool game_set_entity_velocity(Game* game, uint32_t entity_id, float x, float y, float z) {
#if USE_ENTT
    entt::entity entity = game->getEntity(entity_id);
    if (entity == entt::null) return false;

    auto& registry = game->getWorld().getRegistry();
    auto* physics = registry.try_get<Components::PhysicsBody>(entity);
    if (!physics) return false;

    physics->velocity = Vector3D(x, y, z);
    return true;
#else
    Entity* entity = game->getEntity(entity_id);
    if (!entity || !entity->hasPhysics()) {
        return false;
    }

    entity->getPhysics().velocity = Vector3D(x, y, z);
    return true;
#endif
}

// =============================================================================
// Input Handling (Backwards Compatible)
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
// Snapshot Retrieval (Backwards Compatible)
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
// Game State Queries (Backwards Compatible)
// =============================================================================

uint64_t game_get_frame_number(Game* game) {
    return game->getFrameNumber();
}

double game_get_game_time(Game* game) {
    return game->getGameTime();
}

// =============================================================================
// Combat (Backwards Compatible)
// =============================================================================

void game_register_hit(Game* game, uint32_t attacker_id, uint32_t victim_id, float damage) {
    game->registerHit(attacker_id, victim_id, damage);
}

} // extern "C"
