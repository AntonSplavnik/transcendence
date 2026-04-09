#pragma once

#include "../GameTypes.hpp"
#include <string>
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
	std::string    characterClass;
};

struct StateChangeEvent {
	PlayerID       playerID;
	CharacterState state;
};

struct MatchEndEvent {};

// Emitted by CombatSystem when a player starts an attack swing.
struct AttackStartedEvent {
	PlayerID playerID;
	uint8_t  chainStage;  // 0 = first hit, 1 = second, 2 = third
};

// Emitted by CombatSystem when a player activates a skill.
struct SkillUsedEvent {
	PlayerID playerID;
	uint8_t  skillSlot;   // 1 or 2
};

using NetworkEvent = std::variant<
	DeathEvent,
	DamageEvent,
	SpawnEvent,
	StateChangeEvent,    // Stunned only — no longer emitted for Attacking/Casting
	MatchEndEvent,
	AttackStartedEvent,
	SkillUsedEvent
>;

} // namespace NetEvents
} // namespace ArenaGame
