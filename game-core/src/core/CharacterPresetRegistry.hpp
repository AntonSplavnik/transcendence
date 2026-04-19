#pragma once

#include "../CharacterPreset.hpp"

#include <stdexcept>
#include <string>
#include <unordered_map>

namespace ArenaGame {

// =============================================================================
// CharacterPresetRegistry — in-memory store of loaded presets indexed by id
// (filename stem). Populated at World::initialize by scanning PRESETS_DIR.
// =============================================================================

class CharacterPresetRegistry {
public:
	void loadFromDirectory(const std::string& dirPath);

	const CharacterPreset& get(const std::string& id) const;
	bool contains(const std::string& id) const;
	std::size_t size() const { return m_presets.size(); }

private:
	std::unordered_map<std::string, CharacterPreset> m_presets;
};

// =============================================================================
// Implementation
// =============================================================================

} // namespace ArenaGame

#include "CharacterPresetLoader.hpp"
#include <filesystem>

namespace ArenaGame {

inline void CharacterPresetRegistry::loadFromDirectory(const std::string& dirPath) {
	namespace fs = std::filesystem;

	if (!fs::exists(dirPath) || !fs::is_directory(dirPath)) {
		throw std::runtime_error("CharacterPresetRegistry: presets directory not found '" + dirPath + "'");
	}

	CharacterPresetLoader loader;
	std::size_t parsed = 0;
	for (const auto& entry : fs::recursive_directory_iterator(dirPath)) {
		if (!entry.is_regular_file()) continue;
		if (entry.path().extension() != ".json") continue;

		const std::string filename = entry.path().string();
		const std::string id       = entry.path().stem().string();

		if (m_presets.find(id) != m_presets.end()) {
			throw std::runtime_error("CharacterPresetRegistry: duplicate preset id '" + id
				+ "' (second file: " + filename + ")");
		}

		CharacterPreset preset = loader.loadFromFile(filename);
		m_presets.emplace(id, std::move(preset));
		++parsed;
	}

	if (parsed == 0) {
		throw std::runtime_error("CharacterPresetRegistry: no preset files found in '" + dirPath + "'");
	}
}

inline const CharacterPreset& CharacterPresetRegistry::get(const std::string& id) const {
	auto it = m_presets.find(id);
	if (it == m_presets.end()) {
		throw std::runtime_error("CharacterPresetRegistry: unknown preset id '" + id + "'");
	}
	return it->second;
}

inline bool CharacterPresetRegistry::contains(const std::string& id) const {
	return m_presets.find(id) != m_presets.end();
}

} // namespace ArenaGame
