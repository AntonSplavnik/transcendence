#pragma once

#include "PlayerInfo.hpp"
#include <vector>

namespace ArenaGame {
namespace Components {
	struct PendingPlayer {
		PlayerID       id;
		std::string    name;
		std::string    characterClass;
	};

	struct PendingPlayersComponent {
		std::vector<PendingPlayer> players;
	};
}
}
