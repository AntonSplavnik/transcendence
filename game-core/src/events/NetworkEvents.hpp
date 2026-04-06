#pragma once

#include "../GameTypes.hpp"
#include <variant>

namespace ArenaGame {
namespace NetEvents {

struct DeathEvent {
	PlayerID killer;
	PlayerID victim;
};

struct DamageEvent {
	PlayerID attacker;
	PlayerID victim;
	float    damage;
};

struct SpawnEvent {
	PlayerID       playerID;
	Vector3D       position;
};

struct StateChangeEvent {
	PlayerID       playerID;
	CharacterState state;
};

struct MatchEndEvent {};

using NetworkEvent = std::variant<DeathEvent, DamageEvent, SpawnEvent, StateChangeEvent, MatchEndEvent>;

} // namespace NetEvents
} // namespace ArenaGame
