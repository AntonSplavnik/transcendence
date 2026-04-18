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
// Implementation (added in Task 6)
// =============================================================================

inline void CharacterPresetRegistry::loadFromDirectory(const std::string& dirPath) {
	(void)dirPath;
	throw std::runtime_error("CharacterPresetRegistry::loadFromDirectory: not implemented");
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
