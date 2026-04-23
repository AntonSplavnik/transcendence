#pragma once

#include <string>

namespace ArenaGame {
namespace Components {

// Preset id (filename stem of the JSON file the entity was spawned from).
// Today this is informational. Future hot-reload will query entities by id
// to refresh preset-sourced fields after a file change.
struct PresetBinding {
	std::string id;
};

} // namespace Components
} // namespace ArenaGame
