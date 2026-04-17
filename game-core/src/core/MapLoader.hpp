#pragma once

#include "EntityFactory.hpp"
#include "../components/Collider.hpp"
#include "../GameTypes.hpp"

#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wconversion"
#pragma GCC diagnostic ignored "-Wsign-conversion"
#pragma GCC diagnostic ignored "-Wold-style-cast"
#pragma GCC diagnostic ignored "-Wshadow"
#pragma GCC diagnostic ignored "-Wfloat-equal"
#include "../../nlohmann/json.hpp"
#pragma GCC diagnostic pop

#include <fstream>
#include <string>
#include <vector>
#include <stdexcept>

namespace ArenaGame {

// =============================================================================
// MapData - Parsed map definition returned by MapLoader
// =============================================================================

struct MapData {
	float arenaWidth  = 50.0f;
	float arenaLength = 50.0f;
	float arenaHeight = 20.0f;
	std::vector<Vector3D> spawns;
};

// =============================================================================
// MapLoader - Loads map data from JSON
// =============================================================================
// Reads a JSON file describing the arena, spawn points, and static obstacle
// colliders, then spawns collider entities via EntityFactory and returns
// the parsed MapData.
//
// JSON schema (top-level object):
//   "arena":     { "width": float, "length": float, "height": float }
//   "spawns":    [ { "x": float, "z": float }, ... ]
//   "colliders": [
//     { "id": "name", "type": "box",      "center": {x,y,z}, "halfExtents": {x,y,z} },
//     { "id": "name", "type": "cylinder",  "center": {x,y,z}, "radius": float }
//   ]
// =============================================================================

class MapLoader {
public:
	explicit MapLoader(EntityFactory& factory) : m_factory(factory) {}

	MapData loadFromFile(const std::string& filePath);
	MapData loadFromString(const std::string& jsonString);

private:
	EntityFactory& m_factory;

	MapData parseMap(const nlohmann::json& root);
	void spawnColliders(const nlohmann::json& collidersArray);
};

// =============================================================================
// Implementation
// =============================================================================

inline MapData MapLoader::loadFromFile(const std::string& filePath) {
	std::ifstream file(filePath);
	if (!file.is_open()) {
		throw std::runtime_error("MapLoader: cannot open file '" + filePath + "'");
	}

	nlohmann::json root = nlohmann::json::parse(file);
	return parseMap(root);
}

inline MapData MapLoader::loadFromString(const std::string& jsonString) {
	nlohmann::json root = nlohmann::json::parse(jsonString);
	return parseMap(root);
}

inline MapData MapLoader::parseMap(const nlohmann::json& root) {
	MapData data;

	// Parse arena dimensions (optional — defaults match old compile-time constants)
	if (root.contains("arena")) {
		const auto& arena = root["arena"];
		if (arena.contains("width"))  data.arenaWidth  = arena["width"].get<float>();
		if (arena.contains("length")) data.arenaLength = arena["length"].get<float>();
		if (arena.contains("height")) data.arenaHeight = arena["height"].get<float>();
	}

	// Parse spawn points (optional)
	if (root.contains("spawns")) {
		for (const auto& s : root["spawns"]) {
			data.spawns.emplace_back(
				s.at("x").get<float>(),
				GameConfig::GROUND_Y,
				s.at("z").get<float>()
			);
		}
	}

	// Spawn collider entities (optional)
	if (root.contains("colliders")) {
		spawnColliders(root["colliders"]);
	}

	return data;
}

inline void MapLoader::spawnColliders(const nlohmann::json& collidersArray) {
	for (const auto& obj : collidersArray) {
		const std::string type = obj.at("type").get<std::string>();
		const auto& c = obj.at("center");
		Vector3D position(
			c.at("x").get<float>(),
			c.at("y").get<float>(),
			c.at("z").get<float>()
		);

		Components::Collider collider;
		if (type == "box") {
			const auto& he = obj.at("halfExtents");
			Vector3D halfExtents(
				he.at("x").get<float>(),
				he.at("y").get<float>(),
				he.at("z").get<float>()
			);
			collider = Components::Collider::createWall(halfExtents);
		} else if (type == "cylinder") {
			float radius = obj.at("radius").get<float>();
			collider = Components::Collider::createStaticCylinder(radius);
		} else {
			throw std::runtime_error("MapLoader: unknown collider type '" + type + "'");
		}

		m_factory.createStaticMapEntity(position, std::move(collider));
	}
}

} // namespace ArenaGame
