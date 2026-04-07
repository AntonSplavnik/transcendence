#pragma once

#include "../GameTypes.hpp"
#include <memory>

namespace ArenaGame {
namespace Components {
	struct GameModeComponent {
		GameModeType           modeType    = GameModeType::LastStanding;
		MatchStatus            matchStatus = MatchStatus::WaitingToStart;
	};
} // namespace Components
}
