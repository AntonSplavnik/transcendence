#pragma once

#include <unordered_map>
#include <entt/entt.hpp>

namespace ArenaGame {
namespace Components {
	struct MatchStatsComponent {

		struct PlayerStats {
			int   kills       = 0;
			int   deaths      = 0;
			float damageDealt = 0.0f;
			float damageTaken = 0.0f;
			int   placement   = 0;  // 1 = first, 2 = second, etc. Set at match end.
		};

		std::unordered_map<entt::entity, PlayerStats> playerStats;

		const PlayerStats* getPlayerStats(entt::entity player) const {
			auto it = playerStats.find(player);
			if (it != playerStats.end())
				return &it->second;
			return nullptr;
		}
	};
} // namespace Components
} // namespace ArenaGame

