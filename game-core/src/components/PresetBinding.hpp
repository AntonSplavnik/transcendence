#pragma once

#include <string>

namespace ArenaGame {
namespace Components {

// Preset id (filename stem of the JSON file the entity was spawned from).
struct PresetBinding {
	std::string id;
};

} // namespace Components
} // namespace ArenaGame
