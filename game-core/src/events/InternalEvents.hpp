#pragma once

#include "../../entt/entt.hpp"
#include <variant>

namespace ArenaGame {
namespace Events {

struct DeathEvent {
	entt::entity killer;  // entt::null = environment / self-damage
	entt::entity victim;
};

using GameEvent = std::variant<DeathEvent>;

} // namespace Events
} // namespace ArenaGame
