#pragma once

#include "GameTypes.hpp"
#include <memory>

namespace ArenaGame {
namespace Components {
	struct GameModeComponent {
		GameModeType           modeType    = GameModeType::None;
		MatchStatus            matchStatus = MatchStatus::WaitingToStart;
	};
} // namespace Components
}
