#pragma once

#include "../GameTypes.hpp"
#include <string>

namespace ArenaGame {
namespace Components {

// =============================================================================
// PlayerInfo - Player identification and metadata
// =============================================================================
// Pure data component - stores player ID and name
// Used in EnTT implementation to maintain PlayerID mapping
//
// In the original ECS, this data was stored in the Entity class itself.
// With EnTT, entities are just handles (uint32_t), so we need a component
// to store the player identification data.
//
// Usage:
//   PlayerInfo playerInfo{42, "PlayerName"};
//   registry.emplace<PlayerInfo>(entity, playerInfo);
// =============================================================================

struct PlayerInfo {
    PlayerID playerID;      // Unique player identifier
    std::string name;       // Player display name

    // Constructors
    PlayerInfo()
        : playerID(0)
        , name("")
    {}

    PlayerInfo(PlayerID id, const std::string& playerName)
        : playerID(id)
        , name(playerName)
    {}

    PlayerInfo(PlayerID id, std::string&& playerName)
        : playerID(id)
        , name(std::move(playerName))
    {}
};

} // namespace Components
} // namespace ArenaGame
