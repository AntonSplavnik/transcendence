#pragma once

#include "../components/Transform.hpp"
#include "../components/PhysicsBody.hpp"
#include "../components/Collider.hpp"
#include "../components/Health.hpp"
#include "../components/Stamina.hpp"
#include "../components/CombatController.hpp"
#include "../components/Tags.hpp"
#include "../components/GameModeComponent.hpp"
#include "../components/MatchStatsComponent.hpp"
#include "../components/NetworkEventsComponent.hpp"
#include "../components/InternalEventsComponent.hpp"
#include "../components/PendingPlayersComponent.hpp"
#include "../components/PresetBinding.hpp"

#include "../../entt/entt.hpp"

namespace ArenaGame {

// =============================================================================
// EntityFactory - Creates and configures ECS entities
// =============================================================================
// Extracted from World to separate entity construction from game orchestration.
// Holds a reference to the shared entt::registry.
//
// Usage:
//   EntityFactory factory(registry);
//   entt::entity wall = factory.createWall(pos, halfExtents);
// =============================================================================

class EntityFactory {
public:
	explicit EntityFactory(entt::registry& registry)
		: m_registry(registry) {}

	// Game manager
	entt::entity createGameManager();

	// Actors (characters, bots)
	entt::entity createActor(const Vector3D& pos, const std::string& presetId, const CharacterPreset& preset,
							 Components::CollisionLayer layer = Components::CollisionLayer::Enemy);
	entt::entity createBot(const Vector3D& pos, const std::string& presetId, const CharacterPreset& preset,
						   Components::CollisionLayer layer);

	// Projectiles
	entt::entity createProjectile(const Vector3D& pos, const Vector3D& velocity);

	// Static environment
	entt::entity createStaticMapEntity(const Vector3D& position, Components::Collider collider);
	entt::entity createWall(const Vector3D& position, const Vector3D& halfExtents);
	entt::entity createTrigger(const Vector3D& position, float radius);

private:
	entt::registry& m_registry;
};

// =============================================================================
// Implementation
// =============================================================================

inline entt::entity EntityFactory::createGameManager() {
	auto gameManager = m_registry.create();
	if (gameManager == entt::null) {
		return entt::null;
	}
	m_registry.emplace<GameManagerTag>(gameManager);
	m_registry.emplace<Components::GameModeComponent>(gameManager);
	m_registry.emplace<Components::MatchStatsComponent>(gameManager);
	m_registry.emplace<Components::InternalEventsComponent>(gameManager);
	m_registry.emplace<Components::NetworkEventsComponent>(gameManager);
	m_registry.emplace<Components::PendingPlayersComponent>(gameManager);

	return gameManager;
}

inline entt::entity EntityFactory::createActor(const Vector3D& pos, const std::string& presetId, const CharacterPreset& preset, Components::CollisionLayer layer) {
	entt::entity entity = m_registry.create();
	if (entity == entt::null) {
		return entt::null;
	}

	m_registry.emplace<ActorTag>(entity);
	m_registry.emplace<Components::Transform>(entity, pos);
	m_registry.emplace<Components::PhysicsBody>(entity, Components::PhysicsBody::createFromPreset(preset.movement));
	m_registry.emplace<Components::Collider>(entity, Components::Collider::createFromPreset(preset.collider, layer));
	m_registry.emplace<Components::Health>(entity, Components::Health::createFromPreset(preset.health));
	m_registry.emplace<Components::Stamina>(entity, Components::Stamina::createFromPreset(preset.stamina));
	m_registry.emplace<Components::CombatController>(entity, Components::CombatController::createFromPreset(preset.combat));
	m_registry.emplace<Components::PresetBinding>(entity, Components::PresetBinding{presetId});

	return entity;
}

inline entt::entity EntityFactory::createBot(const Vector3D& pos, const std::string& presetId, const CharacterPreset& preset, Components::CollisionLayer layer) {
	auto bot = createActor(pos, presetId, preset, layer);
	if (bot == entt::null) return entt::null;

	m_registry.emplace<BotTag>(bot);
	return bot;
}

inline entt::entity EntityFactory::createProjectile(const Vector3D& spawnPos, const Vector3D& velocity) {
	entt::entity entity = m_registry.create();
	if (entity == entt::null) {
		return entt::null;
	}

	auto physics = Components::PhysicsBody::createProjectile();
	physics.velocity = velocity;

	m_registry.emplace<ProjectileTag>(entity);
	m_registry.emplace<Components::Transform>(entity, spawnPos);
	m_registry.emplace<Components::PhysicsBody>(entity, physics);
	m_registry.emplace<Components::Collider>(entity, Components::Collider::createProjectile());

	return entity;
}

inline entt::entity EntityFactory::createStaticMapEntity(const Vector3D& position, Components::Collider collider) {
	entt::entity entity = m_registry.create();
	if (entity == entt::null) {
		return entt::null;
	}

	m_registry.emplace<WallTag>(entity);
	m_registry.emplace<Components::Transform>(entity, position);
	m_registry.emplace<Components::Collider>(entity, std::move(collider));
	m_registry.emplace<Components::PhysicsBody>(entity, Components::PhysicsBody::createStatic());

	return entity;
}

inline entt::entity EntityFactory::createWall(const Vector3D& position, const Vector3D& halfExtents) {
	return createStaticMapEntity(position, Components::Collider::createWall(halfExtents));
}

inline entt::entity EntityFactory::createTrigger(const Vector3D& position, float radius) {
	entt::entity entity = m_registry.create();
	if (entity == entt::null) {
		return entt::null;
	}

	m_registry.emplace<TriggerTag>(entity);
	m_registry.emplace<Components::Transform>(entity, position);
	m_registry.emplace<Components::Collider>(entity, Components::Collider::createTrigger(radius));

	return entity;
}

} // namespace ArenaGame
