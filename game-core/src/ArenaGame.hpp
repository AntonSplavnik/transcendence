#pragma once

#include "core/World.hpp"
#include "components/Stamina.hpp"
#include "GameTypes.hpp"
#include <vector>
#include <chrono>

namespace ArenaGame {

// =============================================================================
// GameState - Snapshot of the entire game state for network sync
// =============================================================================

struct CharacterSnapshot {
	PlayerID playerID;
	Vector3D position;
	Vector3D velocity;
	float yaw;
	CharacterState state;
	float health;
	float maxHealth;
	// Cooldown data for HUD
	float ability1Timer;     // seconds remaining on ability 1 cooldown (0 = ready)
	float ability1Cooldown;  // max cooldown duration (for computing fill ratio)
	float ability2Timer;     // seconds remaining on ability 2 cooldown
	float ability2Cooldown;  // max cooldown duration
	float swingProgress;     // 0.0–1.0 progress through current attack swing (0 = not attacking)
	bool isGrounded;         // true if character is on the ground (from physics)
	// Stamina data for HUD
	float stamina;
	float maxStamina;

	CharacterSnapshot() = default;
};

struct GameStateSnapshot {
	uint64_t frameNumber;
	std::vector<CharacterSnapshot> characters;
	double timestamp;

	GameStateSnapshot() : frameNumber(0), timestamp(0.0) {}
};

// =============================================================================
// ArenaGame - EnTT-based game loop implementation
// =============================================================================
// Drop-in replacement for ArenaGame using World
// - Uses EnTT registry for entity storage (10-20x faster iteration)
// - Identical public interface to ArenaGame
// - Identical snapshot format (FFI compatible)
// - Deterministic physics (same as original)
//
// Performance improvements:
// - Faster system updates (packed component storage)
// - Lower memory usage (no std::optional overhead)
// - Better cache locality
//
// Usage:
//   ArenaGame game;
//   game.start();
//   game.addPlayer(1, "Player1");
//   game.update();  // Updates all systems
//   GameStateSnapshot snapshot = game.createSnapshot();
// =============================================================================

class ArenaGame {
public:
	ArenaGame();
	~ArenaGame() = default;

	// Game lifecycle
	void start(GameModeType mode);
	void stop();
	bool isRunning() const { return m_isRunning; }

	// Main game loop - call this continuously
	// Uses fixed timestep internally for deterministic physics
	void update();

	// Stops the loop when the GameManager reports MatchStatus::Over.
	void checkMatchOver();

	// Player management
	bool addPlayer(PlayerID playerID, const std::string& name, const std::string& characterClass);
	bool removePlayer(PlayerID playerID);

	// Input handling
	void setPlayerInput(PlayerID playerID, const InputState& input);

	// State queries
	GameStateSnapshot createSnapshot() const;
	uint64_t getFrameNumber() const { return m_frameNumber; }
	double getGameTime() const { return m_gameTime; }
	size_t getPlayerCount() const { return m_world.getPlayerCount(); }

	// World access (for advanced usage)
	World& getWorld() { return m_world; }
	const World& getWorld() const { return m_world; }

private:
	// World manages all entities and systems
	World m_world;

	// Game state (identical to ArenaGame)
	bool m_isRunning;
	uint64_t m_frameNumber;
	double m_gameTime;
	float m_accumulator;
	std::chrono::steady_clock::time_point m_lastUpdateTime;

};

// =============================================================================
// ArenaGame Implementation
// =============================================================================

inline ArenaGame::ArenaGame()
	: m_isRunning(false)
	, m_frameNumber(0)
	, m_gameTime(0.0)
	, m_accumulator(0.0)
{
	// Initialize world (creates and initializes all systems)
	m_world.initialize();
}

inline void ArenaGame::start(GameModeType mode) {

	m_isRunning = true;
	m_frameNumber = 0;
	m_gameTime = 0.0;
	m_accumulator = 0.0;
	m_lastUpdateTime = std::chrono::steady_clock::now();

	m_world.setGameMode(mode);
}

inline void ArenaGame::stop() {
	m_isRunning = false;
}

inline void ArenaGame::update() {
	if (!m_isRunning) {
		return;
	}

	// Calculate delta time since last update
	auto currentTime = std::chrono::steady_clock::now();
	float deltaTime = std::chrono::duration<float>(currentTime - m_lastUpdateTime).count();
	m_lastUpdateTime = currentTime;

	// Clamp delta time to prevent spiral of death
	if (deltaTime > 0.1f) {
		deltaTime = 0.1f;
	}

	// Accumulate time for fixed timestep
	m_accumulator += deltaTime;

	// PHASE 1: EarlyUpdate - Input processing (variable dt)
	m_world.earlyUpdate(deltaTime);

	// PHASE 2: FixedUpdate - Physics & Collision (fixed dt, deterministic)
	int iterations = 0;
	while (m_accumulator >= GameConfig::FIXED_TIMESTEP && iterations < GameConfig::MAX_PHYSICS_ITERATIONS) {
		m_world.fixedUpdate(GameConfig::FIXED_TIMESTEP);

		m_accumulator -= GameConfig::FIXED_TIMESTEP;
		m_frameNumber++;
		m_gameTime += static_cast<double>(GameConfig::FIXED_TIMESTEP);
		iterations++;
	}

	// If we hit the iteration limit, reset accumulator to prevent spiral of death
	if (iterations >= GameConfig::MAX_PHYSICS_ITERATIONS) {
		m_accumulator = 0.0f;
	}

	// PHASE 3: Update - Game logic, Combat, AI (variable dt)
	m_world.update(deltaTime);

	// PHASE 4: LateUpdate - Post-processing, interpolation (variable dt)
	m_world.lateUpdate(deltaTime);

	// PHASE 5: Stop the loop if the active game mode has concluded.
	checkMatchOver();
}

inline void ArenaGame::checkMatchOver() {
	auto& reg = m_world.getRegistry();
	for (auto e : reg.view<GameManagerTag>()) {
		if (auto* gm = reg.try_get<Components::GameModeComponent>(e);
			gm && gm->matchStatus == MatchStatus::Over) {
			m_isRunning = false;
		}
		break;
	}
}

inline bool ArenaGame::addPlayer(PlayerID playerID, const std::string& name, const std::string& characterClass) {
	return m_world.addPlayer(playerID, name, characterClass);
}

inline bool ArenaGame::removePlayer(PlayerID playerID) {
	return m_world.removePlayer(playerID);
}

inline void ArenaGame::setPlayerInput(PlayerID playerID, const InputState& input) {
	m_world.setPlayerInput(playerID, input);
}

inline GameStateSnapshot ArenaGame::createSnapshot() const {
	GameStateSnapshot snapshot;
	snapshot.frameNumber = m_frameNumber;
	snapshot.timestamp = m_gameTime;

	// Get all entities that represent players (have all player components)
	auto& registry = const_cast<World&>(m_world).getRegistry();

	// View of all entities with player components
	auto view = registry.view<
		Components::PlayerInfo,
		Components::Transform,
		Components::PhysicsBody,
		Components::Health,
		Components::CharacterController,
		Components::CombatController,
		Components::Stamina
	>();

	// Convert entities to character snapshots
	view.each([&](Components::PlayerInfo& playerInfo,
				  Components::Transform& transform,
				  Components::PhysicsBody& physics,
				  Components::Health& health,
				  Components::CharacterController& controller,
				  Components::CombatController& combat,
				  Components::Stamina& stam) {

		CharacterSnapshot charSnapshot;
		charSnapshot.playerID = playerInfo.playerID;
		charSnapshot.position = transform.position;
		charSnapshot.velocity = physics.velocity;
		charSnapshot.yaw = transform.getYaw();
		charSnapshot.state = controller.state;
		charSnapshot.health = health.current;
		charSnapshot.maxHealth = health.maximum;

		// Cooldown data from CombatController
		charSnapshot.ability1Timer    = combat.skill1CooldownTimer;
		charSnapshot.ability1Cooldown = combat.ability1.cooldown;
		charSnapshot.ability2Timer    = combat.skill2CooldownTimer;
		charSnapshot.ability2Cooldown = combat.ability2.cooldown;
		{
			float duration = combat.currentStage().duration;
			charSnapshot.swingProgress = (combat.isAttacking && duration > 0.0f)
				? combat.swingTimer / duration
				: 0.0f;
		}
		charSnapshot.isGrounded       = physics.isGrounded;
		charSnapshot.stamina    = stam.current;
		charSnapshot.maxStamina = stam.maximum;

		snapshot.characters.push_back(charSnapshot);
	});

	return snapshot;
}

} // namespace ArenaGame
