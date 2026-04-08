#pragma once

#include "GameTypes.hpp"
#include "events/InternalEvents.hpp"
#include "ISpawner.hpp"
#include "components/GameModeComponent.hpp"
#include "components/MatchStatsComponent.hpp"
#include "components/Tags.hpp"
#include "components/Health.hpp"
#include "components/PlayerInfo.hpp"
#include "../entt/entt.hpp"
#include <memory>
#include <unordered_map>
#include <vector>
#include <algorithm>
#include <cassert>

namespace ArenaGame {

// =============================================================================
// GameModeContext - bundle passed to every IGameMode call
// =============================================================================

struct GameModeContext {
	entt::registry& registry;
	ISpawner&       spawner;
};

// =============================================================================
// IGameMode - strategy interface
// =============================================================================

class IGameMode {
public:
	virtual ~IGameMode() = default;

	// Called once when the match begins. Use to spawn initial entities or set up mode state.
	virtual void onStart([[maybe_unused]] GameModeContext& ctx,
						 [[maybe_unused]] Components::GameModeComponent& gm,
						 [[maybe_unused]] Components::MatchStatsComponent& stats) {}

	// Called for every death this frame, after CombatSystem has finished. Use to queue
	// respawns, update kill counts, or check win conditions.
	virtual void onDeath(const Events::DeathEvent& e,
						 GameModeContext& ctx,
						 Components::GameModeComponent& gm,
						 Components::MatchStatsComponent& stats) = 0;

	// Called every frame in lateUpdate. Use for time-driven logic: respawn countdowns,
	// wave timers, match time limits.
	virtual void tick(float dt,
					  GameModeContext& ctx,
					  Components::GameModeComponent& gm,
					  Components::MatchStatsComponent& stats) = 0;

	// Returns true once the mode has determined a winner or loss condition.
	virtual bool isOver() const = 0;

	static std::unique_ptr<IGameMode> create(GameModeType type);
};

// =============================================================================
// LastStanding - no respawns, last alive player wins
// =============================================================================

class LastStanding : public IGameMode {
public:
	void onDeath(const Events::DeathEvent& e,
				 GameModeContext& ctx,
				 [[maybe_unused]] Components::GameModeComponent& gm,
				 Components::MatchStatsComponent& stats) override
	{
		auto view = ctx.registry.view<PlayerTag, Components::Health>();

		int alive = 0;
		view.each([&](entt::entity, Components::Health& health) {
			if (health.isAlive()) alive++;
		});

		// Victim's placement = players still alive + 1
		stats.playerStats[e.victim].placement = alive + 1;

		if (alive <= 1) {
			view.each([&](entt::entity entity, Components::Health& health) {
				if (health.isAlive())
					stats.playerStats[entity].placement = 1;
			});
			m_over = true;
		}
	}

	void tick([[maybe_unused]] float dt,
			  [[maybe_unused]] GameModeContext& ctx,
			  [[maybe_unused]] Components::GameModeComponent& gm,
			  [[maybe_unused]] Components::MatchStatsComponent& stats) override {}

	bool isOver() const override { return m_over; }

private:
	bool m_over = false;
};

// =============================================================================
// Deathmatch - kill limit, respawn after delay
// =============================================================================

struct RespawnTimer {
	entt::entity entity;
	float        remaining;
};

class Deathmatch : public IGameMode {
public:
	explicit Deathmatch(int killLimit = 10, float respawnDelay = 5.0f)
		: m_killLimit(killLimit)
		, m_respawnDelay(respawnDelay)
	{}

	void onDeath(const Events::DeathEvent& e,
				 GameModeContext& ctx,
				 Components::GameModeComponent& gm,
				 Components::MatchStatsComponent& stats) override
	{
		// Queue victim for respawn (skip bots)
		if (!ctx.registry.all_of<BotTag>(e.victim)) {
			m_respawnQueue.push_back({ e.victim, m_respawnDelay });
		}

		// Track kills for win condition (skip env kills and bot killers)
		if (e.killer != entt::null && !ctx.registry.all_of<BotTag>(e.killer)) {
			m_killCounts[e.killer]++;
			if (m_killCounts[e.killer] >= m_killLimit) {
				m_over = true;
				gm.matchStatus = MatchStatus::Over;
			}
		}

		// Re-rank all players by kills descending
		std::vector<std::pair<entt::entity, int>> ranked;
		ranked.reserve(stats.playerStats.size());
		for (auto entity : ctx.registry.view<PlayerTag>())
			ranked.push_back({ entity, stats.playerStats[entity].kills });

		std::sort(ranked.begin(), ranked.end(), [](const auto& a, const auto& b) {
			return a.second > b.second;
		});

		for (int i = 0; i < static_cast<int>(ranked.size()); i++)
			stats.playerStats[ranked[static_cast<size_t>(i)].first].placement = i + 1;
	}

	void tick(float dt,
			  GameModeContext& ctx,
			  [[maybe_unused]] Components::GameModeComponent& gm,
			  [[maybe_unused]] Components::MatchStatsComponent& stats) override
	{
		for (auto& timer : m_respawnQueue) {
			timer.remaining -= dt;
		}

		// Respawn players whose timer expired
		m_respawnQueue.erase(
			std::remove_if(m_respawnQueue.begin(), m_respawnQueue.end(),
				[&](const RespawnTimer& t) {
					if (t.remaining > 0.0f) return false;
					ctx.spawner.respawnPlayer(t.entity, Vector3D{0, 0, 0});
					return true;
				}),
			m_respawnQueue.end()
		);
	}

	bool isOver() const override { return m_over; }

private:
	int   m_killLimit;
	float m_respawnDelay;
	bool  m_over = false;

	std::unordered_map<entt::entity, int> m_killCounts;
	std::vector<RespawnTimer>         m_respawnQueue;
};

// =============================================================================
// WaveSurvival - placeholder
// =============================================================================

class WaveSurvival : public IGameMode {
public:
	void onDeath(const Events::DeathEvent&, GameModeContext&,
				 Components::GameModeComponent&, Components::MatchStatsComponent&) override {}
	void tick(float, GameModeContext&,
			  Components::GameModeComponent&, Components::MatchStatsComponent&) override {}
	bool isOver() const override { return false; }
};

// =============================================================================
// TeamDeathmatch - placeholder
// =============================================================================

class TeamDeathmatch : public IGameMode {
public:
	void onDeath(const Events::DeathEvent&, GameModeContext&,
				 Components::GameModeComponent&, Components::MatchStatsComponent&) override {}
	void tick(float, GameModeContext&,
			  Components::GameModeComponent&, Components::MatchStatsComponent&) override {}
	bool isOver() const override { return false; }
};

// =============================================================================
// Factory
// =============================================================================

inline std::unique_ptr<IGameMode> IGameMode::create(GameModeType type) {
	switch (type) {
		case GameModeType::Deathmatch:     return std::make_unique<Deathmatch>();
		case GameModeType::LastStanding:   return std::make_unique<LastStanding>();
		case GameModeType::WaveSurvival:   return std::make_unique<WaveSurvival>();
		case GameModeType::TeamDeathmatch: return std::make_unique<TeamDeathmatch>();
		case GameModeType::None:
			assert(false && "GameModeType::None passed to IGameMode::create — set a real mode first");
			return nullptr;
	}
	assert(false && "Unhandled GameModeType in IGameMode::create");
	return nullptr;
}

} // namespace ArenaGame
