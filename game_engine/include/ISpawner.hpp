#pragma once
#include "CharacterPreset.hpp"
#include "GameTypes.hpp"
#include "entt/entt.hpp"

namespace ArenaGame {
	class ISpawner {
	public:
		virtual ~ISpawner() = default;
		virtual entt::entity createBot(const Vector3D& pos, const CharacterPreset& preset, Components::CollisionLayer layer) = 0;
		virtual void respawnPlayer(entt::entity player, const Vector3D& pos) = 0;
		virtual entt::entity createPlayer(PlayerID id, const std::string& name,
										Vector3D pos, const CharacterPreset& preset) = 0;
		virtual bool removePlayer(PlayerID id) = 0;
		virtual bool destroyEntity(entt::entity entity) = 0;
	};
}
