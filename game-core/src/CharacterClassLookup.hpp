#pragma once

#include "CharacterPreset.hpp"
#include "Presets.hpp"
#include <string>

namespace ArenaGame {

inline const CharacterPreset& presetFromClass(const std::string& characterClass) {
	if (characterClass == "knight") return Presets::KNIGHT;
	return Presets::KNIGHT; // fallback — extend when more presets are added
}

} // namespace ArenaGame
