#pragma once

#include "../CharacterPreset.hpp"

#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wconversion"
#pragma GCC diagnostic ignored "-Wsign-conversion"
#pragma GCC diagnostic ignored "-Wold-style-cast"
#pragma GCC diagnostic ignored "-Wshadow"
#pragma GCC diagnostic ignored "-Wfloat-equal"
#include "../../nlohmann/json.hpp"
#pragma GCC diagnostic pop

#include <fstream>
#include <stdexcept>
#include <string>
#include <unordered_set>

namespace ArenaGame {

// =============================================================================
// CharacterPresetLoader — strict JSON → CharacterPreset parser.
// Throws std::runtime_error on any parse failure with a descriptive message
// that names the file path and the offending field path.
//
// Expected schema: see docs/schemas/character-preset.v1.json
// =============================================================================

class CharacterPresetLoader {
public:
	CharacterPreset loadFromFile(const std::string& filePath);
	CharacterPreset loadFromString(const std::string& jsonString, const std::string& sourceName);
};

// =============================================================================
// Implementation (added in Task 4)
// =============================================================================

inline CharacterPreset CharacterPresetLoader::loadFromFile(const std::string& filePath) {
	(void)filePath;
	throw std::runtime_error("CharacterPresetLoader::loadFromFile: not implemented");
}

inline CharacterPreset CharacterPresetLoader::loadFromString(const std::string& jsonString, const std::string& sourceName) {
	(void)jsonString;
	(void)sourceName;
	throw std::runtime_error("CharacterPresetLoader::loadFromString: not implemented");
}

} // namespace ArenaGame
