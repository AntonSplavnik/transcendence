#pragma once

#include "../GameTypes.hpp"
#include <string>

namespace ArenaGame {
namespace Components {

// =============================================================================
// PlayerInfo - Player identification and metadata
// =============================================================================
// Pure data component - stores player ID and name
// Used to maintain PlayerID mapping
//
// Usage:
//   PlayerInfo playerInfo{42, "PlayerName"};
//   registry.emplace<PlayerInfo>(entity, playerInfo);
// =============================================================================

struct PlayerInfo {
	PlayerID playerID;          // Unique player identifier
	std::string name;           // Player display name
	std::string characterClass; // Character class string (e.g. "knight")
	bool disconnected;          // True when player left but entity remains in simulation

	// Constructors
	PlayerInfo()
		: playerID(0)
		, name("")
		, characterClass("")
		, disconnected(false)
	{}

	PlayerInfo(PlayerID id, const std::string& playerName, const std::string& cls = "")
		: playerID(id)
		, name(playerName)
		, characterClass(cls)
		, disconnected(false)
	{}

	PlayerInfo(PlayerID id, std::string&& playerName, std::string&& cls = "")
		: playerID(id)
		, name(std::move(playerName))
		, characterClass(std::move(cls))
		, disconnected(false)
	{}
};

} // namespace Components
} // namespace ArenaGame
