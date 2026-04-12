#pragma once

#include "../components/GameModeComponent.hpp"
#include "../components/MatchStatsComponent.hpp"
#include "../components/InternalEventsComponent.hpp"
#include "../components/NetworkEventsComponent.hpp"
#include "../components/PlayerInfo.hpp"
#include "../components/Tags.hpp"
#include "../events/InternalEvents.hpp"
#include "../events/NetworkEvents.hpp"
#include "System.hpp"
#include "../Helpers.hpp"
#include "../GameMode.hpp"

#include <memory>

namespace ArenaGame {

	// Builds the MatchEnd payload from final match stats.
	// Skips bots (human-facing modal) and entities missing PlayerInfo.
	inline NetEvents::MatchEndEvent buildMatchEndEvent(
		const entt::registry& registry,
		const Components::MatchStatsComponent& stats)
	{
		NetEvents::MatchEndEvent out;
		out.players.reserve(stats.playerStats.size());

		for (const auto& [entity, ps] : stats.playerStats) {
			if (registry.all_of<BotTag>(entity)) continue;

			const auto* info = registry.try_get<Components::PlayerInfo>(entity);
			if (!info) continue;

			out.players.push_back(NetEvents::PlayerMatchStats{
				info->playerID,
				info->name,
				info->characterClass,
				ps.kills,
				ps.deaths,
				ps.damageDealt,
				ps.damageTaken,
				ps.placement,
			});
		}
		return out;
	}

	class GameModeSystem : public System {
	public:
		GameModeSystem() = default;

		void startMode();
		void lateUpdate(float deltaTime) override;
		const char* getName() const override { return "GameModeSystem"; }
		bool needsLateUpdate() const override { return true; }
		bool needsUpdate()     const override { return false; }

		void setSpawner(ISpawner* spawner) { m_spawner = spawner; }

	private:
		std::unique_ptr<IGameMode> m_mode;
		ISpawner* m_spawner = nullptr;
	};

	inline void GameModeSystem::startMode() {
		auto* gm    = m_registry->try_get<Components::GameModeComponent>(m_gameManager);
		auto* stats = m_registry->try_get<Components::MatchStatsComponent>(m_gameManager);
		if (!gm || !stats) return;
		assert(gm->modeType != GameModeType::None && "GameMode was never set before startMode()");
		m_mode = IGameMode::create(gm->modeType);
		GameModeContext ctx { *m_registry, *m_spawner };
		m_mode->onStart(ctx, *gm, *stats);
	}

	inline void GameModeSystem::lateUpdate(float deltaTime) {
		if (!m_mode) return;
		auto* gm    = m_registry->try_get<Components::GameModeComponent>(m_gameManager);
		auto* stats = m_registry->try_get<Components::MatchStatsComponent>(m_gameManager);
		auto* ie    = m_registry->try_get<Components::InternalEventsComponent>(m_gameManager);

		if (!gm || !stats || !ie || gm->matchStatus != MatchStatus::InProgress) return;

		GameModeContext ctx { *m_registry, *m_spawner };

		for (const auto& event : ie->events) {
			std::visit(overloaded {
				[&](const Events::DeathEvent& e) { m_mode->onDeath(e, ctx, *gm, *stats); }
			}, event);
		}

		m_mode->tick(deltaTime, ctx, *gm, *stats);

		if (m_mode->isOver()) {
			gm->matchStatus = MatchStatus::Over;
			auto* ne = m_registry->try_get<Components::NetworkEventsComponent>(m_gameManager);
			if (ne) ne->events.push_back(buildMatchEndEvent(*m_registry, *stats));
		}

		if (m_mode->isOver()) {
			endMatch(*gm, *stats);
		} else {
			// End the match when too few human players remain (e.g. disconnect).
			size_t playerCount = 0;
			for ([[maybe_unused]] auto _ : m_registry->view<PlayerTag>()) ++playerCount;

			if (playerCount < m_mode->minPlayers()) {
				for (auto entity : m_registry->view<PlayerTag>()) {
					stats->playerStats[entity].placement = 1;
				}
				endMatch(*gm, *stats);
			}
		}

		ie->events.clear();
	}

	inline void GameModeSystem::endMatch(
        Components::GameModeComponent& gm,
        const Components::MatchStatsComponent& stats)
    {
        gm.matchStatus = MatchStatus::Over;
        auto* ne = m_registry->try_get<Components::NetworkEventsComponent>(m_gameManager);
        if (ne) ne->events.push_back(buildMatchEndEvent(*m_registry, stats));
    }

} // namespace ArenaGame

