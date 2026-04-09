#pragma once

#include "CharacterPreset.hpp"
#include "Presets.hpp"
#include <cassert>
#include <string>
#include <unordered_map>

namespace ArenaGame {

inline const CharacterPreset& presetFromClass(const std::string& characterClass) {
	static const std::unordered_map<std::string, const CharacterPreset*> table = {
		{"knight", &Presets::KNIGHT},
	};
	auto it = table.find(characterClass);
	assert(it != table.end() && "Unknown character class received from Rust");
	return *it->second;
}

} // namespace ArenaGame
