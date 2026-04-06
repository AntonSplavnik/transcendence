#pragma once

#include "Events/NetworkEvents.hpp"
#include <deque>

namespace ArenaGame {
namespace Components {
	struct NetworkEventsComponent {
		std::deque<NetEvents::NetworkEvent> events;
	};
} // namespace Components
} // namespace ArenaGame
