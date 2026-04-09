#pragma once

#include "rust/cxx.h"
#include "ArenaGame.hpp"
#include "events/NetworkEvents.hpp"
#include <memory>
#include <vector>

namespace arena_game {

// Forward declarations of CXX-generated shared types.
// Full definitions come from the generated header included in the .cpp file.
struct Vec3;
struct PlayerInput;
struct CharacterSnapshot;
struct GameStateSnapshot;
struct DeathEvent;
struct DamageEvent;
struct SpawnEvent;
struct StateChangeEvent;
struct AttackStartedEvent;
struct SkillUsedEvent;
enum class GameModeType : uint8_t;
enum class NetworkEventType : uint8_t;

/// Owned snapshot of the network event queue for one tick.
/// Returned by GameBridge::take_events() and consumed by Rust via indexed access.
struct EventQueue {
    std::vector<::ArenaGame::NetEvents::NetworkEvent> events;

    size_t len() const;
    NetworkEventType kind_at(size_t idx) const;
    DeathEvent       get_death_at(size_t idx) const;
    DamageEvent      get_damage_at(size_t idx) const;
    SpawnEvent       get_spawn_at(size_t idx) const;
    StateChangeEvent   get_state_change_at(size_t idx) const;
    AttackStartedEvent get_attack_started_at(size_t idx) const;
    SkillUsedEvent     get_skill_used_at(size_t idx) const;
};

/// Thin wrapper around ArenaGame that adapts the C++ API to CXX shared types.
/// Keeps ArenaGame decoupled from CXX — all type conversion lives here.
struct GameBridge {
    ::ArenaGame::ArenaGame game;

    // Game lifecycle
    void start(GameModeType mode);
    void stop();
    void update();
    bool is_running() const;
    size_t get_player_count() const;

    // Player management
    bool add_player(uint32_t id, rust::Str name, rust::Str character_class);
    bool remove_player(uint32_t id);
    void set_player_input(uint32_t id, const PlayerInput& input);

    // Snapshot
    GameStateSnapshot get_snapshot() const;

    // Network events (ownership-transfer drain)
    std::unique_ptr<EventQueue> take_events();
};

std::unique_ptr<GameBridge> create_bridge();

} // namespace arena_game
