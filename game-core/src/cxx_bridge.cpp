// CXX bridge adapter — implements the GameBridge wrapper that bridges
// CXX shared types to the internal ArenaGame C++ API.

#include "cxx_bridge.hpp"
#include "transcendence-backend/src/game/ffi.rs.h"

#include <string>
#include <utility>
#include <variant>
#include <vector>

namespace arena_game {

// =============================================================================
// Vec3 layout guards and zero-cost conversion helpers
// =============================================================================

static_assert(sizeof(::ArenaGame::Vector3D) == sizeof(Vec3),
    "Vector3D and Vec3 size mismatch — update the bridge");
static_assert(offsetof(::ArenaGame::Vector3D, x) == offsetof(Vec3, x),
    "Vector3D.x and Vec3.x offset mismatch");
static_assert(offsetof(::ArenaGame::Vector3D, y) == offsetof(Vec3, y),
    "Vector3D.y and Vec3.y offset mismatch");
static_assert(offsetof(::ArenaGame::Vector3D, z) == offsetof(Vec3, z),
    "Vector3D.z and Vec3.z offset mismatch");

/// Convert internal Vector3D → bridge Vec3 via reinterpret_cast (zero-copy).
inline Vec3 to_vec3(const ::ArenaGame::Vector3D& v) {
    return *reinterpret_cast<const Vec3*>(&v);
}

/// Convert bridge Vec3 → internal Vector3D via reinterpret_cast (zero-copy).
inline ::ArenaGame::Vector3D from_vec3(const Vec3& v) {
    return *reinterpret_cast<const ::ArenaGame::Vector3D*>(&v);
}

// =============================================================================
// Factory
// =============================================================================

std::unique_ptr<GameBridge> create_bridge() {
    return std::make_unique<GameBridge>();
}

// =============================================================================
// Game lifecycle
// =============================================================================

void GameBridge::start(GameModeType mode) {
    game.start(static_cast<::ArenaGame::GameModeType>(static_cast<uint8_t>(mode)));
}

void GameBridge::stop() {
    game.stop();
}

void GameBridge::update() {
    game.update();
}

bool GameBridge::is_running() const {
    return game.isRunning();
}

size_t GameBridge::get_player_count() const {
    return game.getPlayerCount();
}

// =============================================================================
// Player management
// =============================================================================

bool GameBridge::add_player(uint32_t id, rust::Str name, rust::Str character_class) {
    return game.addPlayer(id,
        std::string(name.data(), name.size()),
        std::string(character_class.data(), character_class.size()));
}

bool GameBridge::remove_player(uint32_t id) {
    return game.markPlayerDisconnected(id);
}

void GameBridge::set_player_input(uint32_t id, const PlayerInput& input) {
    ::ArenaGame::InputState state;
    state.movementDirection = from_vec3(input.movement);
    state.lookDirection     = from_vec3(input.look_direction);
    state.isAttacking     = input.attacking;
    state.isJumping       = input.jumping;
    state.isUsingAbility1 = input.ability1;
    state.isUsingAbility2 = input.ability2;
    state.isDodging       = input.dodging;
    state.isSprinting     = input.sprinting;
    game.setPlayerInput(id, state);
}

// =============================================================================
// Snapshot
// =============================================================================

GameStateSnapshot GameBridge::get_snapshot() const {
    auto snap = game.createSnapshot();

    GameStateSnapshot out;
    out.frame_number = snap.frameNumber;
    out.timestamp    = snap.timestamp;

    for (const auto& c : snap.characters) {
        out.characters.push_back(CharacterSnapshot{
            /* player_id         */ c.playerID,
            /* position          */ to_vec3(c.position),
            /* velocity          */ to_vec3(c.velocity),
            /* yaw               */ c.yaw,
            /* state             */ static_cast<uint8_t>(c.state),
            /* health            */ c.health,
            /* max_health        */ c.maxHealth,
            /* ability1_timer    */ c.ability1Timer,
            /* ability1_cooldown */ c.ability1Cooldown,
            /* ability2_timer    */ c.ability2Timer,
            /* ability2_cooldown */ c.ability2Cooldown,
            /* swing_progress    */ c.swingProgress,
            /* is_grounded       */ c.isGrounded,
            /* stamina           */ c.stamina,
            /* max_stamina       */ c.maxStamina,
        });
    }

    return out;
}

// =============================================================================
// Network events — ownership-transfer drain
// =============================================================================

std::unique_ptr<EventQueue> GameBridge::take_events() {
    auto eq = std::make_unique<EventQueue>();
    eq->events = game.getWorld().takeNetworkEvents();
    return eq;
}

size_t EventQueue::len() const { return events.size(); }

NetworkEventType EventQueue::kind_at(size_t idx) const {
    return std::visit([](auto&& ev) -> NetworkEventType {
        using T = std::decay_t<decltype(ev)>;
        if constexpr (std::is_same_v<T, ::ArenaGame::NetEvents::DeathEvent>)
            return NetworkEventType::Death;
        else if constexpr (std::is_same_v<T, ::ArenaGame::NetEvents::DamageEvent>)
            return NetworkEventType::Damage;
        else if constexpr (std::is_same_v<T, ::ArenaGame::NetEvents::SpawnEvent>)
            return NetworkEventType::Spawn;
        else if constexpr (std::is_same_v<T, ::ArenaGame::NetEvents::StateChangeEvent>)
            return NetworkEventType::StateChange;
        else if constexpr (std::is_same_v<T, ::ArenaGame::NetEvents::AttackStartedEvent>)
            return NetworkEventType::AttackStarted;
        else if constexpr (std::is_same_v<T, ::ArenaGame::NetEvents::SkillUsedEvent>)
            return NetworkEventType::SkillUsed;
        else {
            static_assert(std::is_same_v<T, ::ArenaGame::NetEvents::MatchEndEvent>,
                "Unhandled NetworkEvent variant in kind_at");
            return NetworkEventType::MatchEnd;
        }
    }, events[idx]);
}

DeathEvent EventQueue::get_death_at(size_t idx) const {
    const auto& ev = std::get<::ArenaGame::NetEvents::DeathEvent>(events[idx]);
    return DeathEvent{ ev.killer, ev.victim };
}

DamageEvent EventQueue::get_damage_at(size_t idx) const {
    const auto& ev = std::get<::ArenaGame::NetEvents::DamageEvent>(events[idx]);
    return DamageEvent{ ev.attacker, ev.victim, ev.damage };
}

SpawnEvent EventQueue::get_spawn_at(size_t idx) const {
    const auto& ev = std::get<::ArenaGame::NetEvents::SpawnEvent>(events[idx]);
    return SpawnEvent{ ev.playerID, to_vec3(ev.position), rust::String(ev.characterClass) };
}

StateChangeEvent EventQueue::get_state_change_at(size_t idx) const {
    const auto& ev = std::get<::ArenaGame::NetEvents::StateChangeEvent>(events[idx]);
    return StateChangeEvent{ ev.playerID, static_cast<uint8_t>(ev.state) };
}

AttackStartedEvent EventQueue::get_attack_started_at(size_t idx) const {
    const auto& ev = std::get<::ArenaGame::NetEvents::AttackStartedEvent>(events[idx]);
    return AttackStartedEvent{ ev.playerID, ev.chainStage };
}

SkillUsedEvent EventQueue::get_skill_used_at(size_t idx) const {
    const auto& ev = std::get<::ArenaGame::NetEvents::SkillUsedEvent>(events[idx]);
    return SkillUsedEvent{ ev.playerID, ev.skillSlot };
}

MatchEndEvent EventQueue::get_match_end_at(size_t idx) const {
    const auto& ev = std::get<::ArenaGame::NetEvents::MatchEndEvent>(events[idx]);
    MatchEndEvent out;
    out.players.reserve(ev.players.size());
    for (const auto& p : ev.players) {
        out.players.push_back(PlayerMatchStats{
            /* player_id        */ p.playerID,
            /* name             */ rust::String(p.name),
            /* character_class  */ rust::String(p.characterClass),
            /* kills            */ p.kills,
            /* deaths           */ p.deaths,
            /* damage_dealt     */ p.damageDealt,
            /* damage_taken     */ p.damageTaken,
            /* placement        */ p.placement,
        });
    }
    return out;
}

} // namespace arena_game
