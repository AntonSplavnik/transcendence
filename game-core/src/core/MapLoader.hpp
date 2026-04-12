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
#include <stdexcept>

namespace ArenaGame {

// =============================================================================
// MapLoader - Loads map colliders from JSON
// =============================================================================
// Reads a JSON file describing static obstacle colliders (boxes and cylinders)
// and spawns them as ECS entities via EntityFactory.
//
// JSON schema (array of objects):
//   { "id": "name", "type": "box",      "center": {x,y,z}, "halfExtents": {x,y,z} }
//   { "id": "name", "type": "cylinder",  "center": {x,y,z}, "radius": float }
// =============================================================================

class MapLoader {
public:
	explicit MapLoader(EntityFactory& factory) : m_factory(factory) {}

	void loadFromFile(const std::string& filePath);
	void loadFromString(const std::string& jsonString);

private:
	EntityFactory& m_factory;

	void spawnColliders(const nlohmann::json& root);
};

// =============================================================================
// Implementation
// =============================================================================

inline void MapLoader::loadFromFile(const std::string& filePath) {
	std::ifstream file(filePath);
	if (!file.is_open()) {
		throw std::runtime_error("MapLoader: cannot open file '" + filePath + "'");
	}

	nlohmann::json root = nlohmann::json::parse(file);
	spawnColliders(root);
}

inline void MapLoader::loadFromString(const std::string& jsonString) {
	nlohmann::json root = nlohmann::json::parse(jsonString);
	spawnColliders(root);
}

inline void MapLoader::spawnColliders(const nlohmann::json& root) {
	for (const auto& obj : root) {
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
