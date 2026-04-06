#pragma once

#include "events/InternalEvents.hpp"
#include <vector>

namespace ArenaGame {
namespace Components {
	struct InternalEventsComponent {
		std::vector<Events::GameEvent> events;
	};
} // namespace Components
} // namespace ArenaGame
