#pragma once

#include "../events/NetworkEvents.hpp"
#include <vector>

namespace ArenaGame {
namespace Components {
	struct NetworkEventsComponent {
		std::vector<NetEvents::NetworkEvent> events;
	};
} // namespace Components
} // namespace ArenaGame
