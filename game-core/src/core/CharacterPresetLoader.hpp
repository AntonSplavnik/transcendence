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
	CharacterPreset loadFromFile(const std::string& filePath, const std::string& expectedId = "");
	CharacterPreset loadFromString(const std::string& jsonString, const std::string& sourceName, const std::string& expectedId = "");
};

// =============================================================================
// Implementation
// =============================================================================

namespace detail {

inline void requireKeysExactly(const nlohmann::json& obj,
                                const std::unordered_set<std::string>& required,
                                const std::unordered_set<std::string>& optional,
                                const std::string& path) {
	for (const auto& req : required) {
		if (!obj.contains(req)) {
			throw std::runtime_error("CharacterPresetLoader: " + path + " missing required key '" + req + "'");
		}
	}
	for (auto it = obj.begin(); it != obj.end(); ++it) {
		const std::string& key = it.key();
		if (required.find(key) == required.end() && optional.find(key) == optional.end()) {
			throw std::runtime_error("CharacterPresetLoader: " + path + " has unknown key '" + key + "'");
		}
	}
}

inline float readFloat(const nlohmann::json& obj, const std::string& key, const std::string& path) {
	if (!obj.contains(key)) {
		throw std::runtime_error("CharacterPresetLoader: " + path + "." + key + " missing");
	}
	if (!obj[key].is_number()) {
		throw std::runtime_error("CharacterPresetLoader: " + path + "." + key + " not a number");
	}
	return obj[key].get<float>();
}

inline float readFloatOr(const nlohmann::json& obj, const std::string& key, float dflt, const std::string& path) {
	if (!obj.contains(key)) return dflt;
	if (!obj[key].is_number()) {
		throw std::runtime_error("CharacterPresetLoader: " + path + "." + key + " not a number");
	}
	return obj[key].get<float>();
}

inline HealthPreset parseHealth(const nlohmann::json& obj, const std::string& path) {
	requireKeysExactly(obj, {"maxHealth", "armor", "resistance"}, {}, path);
	return HealthPreset{
		readFloat(obj, "maxHealth",  path),
		readFloat(obj, "armor",      path),
		readFloat(obj, "resistance", path),
	};
}

inline MovementPreset parseMovement(const nlohmann::json& obj, const std::string& path) {
	requireKeysExactly(obj, {
		"movementSpeed", "rotationSpeed", "sprintMultiplier", "crouchMultiplier",
		"jumpVelocity", "dodgeVelocity", "airControlFactor", "acceleration",
		"deceleration", "mass", "friction", "drag", "maxSpeed", "maxFallSpeed"
	}, {}, path);
	return MovementPreset{
		readFloat(obj, "movementSpeed",    path),
		readFloat(obj, "rotationSpeed",    path),
		readFloat(obj, "sprintMultiplier", path),
		readFloat(obj, "crouchMultiplier", path),
		readFloat(obj, "jumpVelocity",     path),
		readFloat(obj, "dodgeVelocity",    path),
		readFloat(obj, "airControlFactor", path),
		readFloat(obj, "acceleration",     path),
		readFloat(obj, "deceleration",     path),
		readFloat(obj, "mass",             path),
		readFloat(obj, "friction",         path),
		readFloat(obj, "drag",             path),
		readFloat(obj, "maxSpeed",         path),
		readFloat(obj, "maxFallSpeed",     path),
	};
}

inline ColliderPreset parseCollider(const nlohmann::json& obj, const std::string& path) {
	requireKeysExactly(obj, {"radius", "height"}, {}, path);
	return ColliderPreset{
		readFloat(obj, "radius", path),
		readFloat(obj, "height", path),
	};
}

inline StaminaPreset parseStamina(const nlohmann::json& obj, const std::string& path) {
	requireKeysExactly(obj, {"maxStamina", "baseRegenRate", "drainDelaySeconds", "sprintCostPerSec", "jumpCost"}, {}, path);
	return StaminaPreset{
		readFloat(obj, "maxStamina",        path),
		readFloat(obj, "baseRegenRate",     path),
		readFloat(obj, "drainDelaySeconds", path),
		readFloat(obj, "sprintCostPerSec",  path),
		readFloat(obj, "jumpCost",          path),
	};
}

inline AttackStage parseAttackStage(const nlohmann::json& obj, const std::string& path) {
	requireKeysExactly(
		obj,
		{"damageMultiplier", "range", "duration", "movementMultiplier", "chainWindow", "staminaCost"},
		{"attackAngle"},
		path
	);
	AttackStage s;
	s.damageMultiplier   = readFloat(obj, "damageMultiplier",   path);
	s.range              = readFloat(obj, "range",              path);
	s.duration           = readFloat(obj, "duration",           path);
	s.movementMultiplier = readFloat(obj, "movementMultiplier", path);
	s.chainWindow        = readFloat(obj, "chainWindow",        path);
	s.attackAngle        = readFloatOr(obj, "attackAngle", 0.7f, path);
	s.staminaCost        = readFloat(obj, "staminaCost",        path);
	return s;
}

inline SkillVariant parseSkillParams(const nlohmann::json& obj, const std::string& path) {
	if (!obj.contains("type") || !obj["type"].is_string()) {
		throw std::runtime_error("CharacterPresetLoader: " + path + ".type missing or not a string");
	}
	const std::string type = obj["type"].get<std::string>();
	if (type == "melee_aoe") {
		requireKeysExactly(obj, {"type", "range", "movementMultiplier", "dmgMultiplier"}, {}, path);
		return MeleeAOE{
			readFloat(obj, "range",              path),
			readFloat(obj, "movementMultiplier", path),
			readFloat(obj, "dmgMultiplier",      path),
		};
	}
	throw std::runtime_error("CharacterPresetLoader: " + path + ".type unknown skill type '" + type + "'");
}

inline SkillDefinition parseSkill(const nlohmann::json& obj, const std::string& path) {
	requireKeysExactly(obj, {"params"}, {"cooldown", "castDuration", "staminaCost"}, path);
	SkillDefinition s;
	s.params       = parseSkillParams(obj["params"], path + ".params");
	s.cooldown     = readFloatOr(obj, "cooldown",     0.0f, path);
	s.castDuration = readFloatOr(obj, "castDuration", 0.0f, path);
	s.staminaCost  = readFloatOr(obj, "staminaCost",  0.0f, path);
	return s;
}

inline CombatPreset parseCombat(const nlohmann::json& obj, const std::string& path) {
	requireKeysExactly(obj,
		{"baseDamage", "damageMultiplier", "criticalChance", "criticalMultiplier", "attackChain", "skill1", "skill2"},
		{}, path);
	CombatPreset c;
	c.baseDamage         = readFloat(obj, "baseDamage",         path);
	c.damageMultiplier   = readFloat(obj, "damageMultiplier",   path);
	c.criticalChance     = readFloat(obj, "criticalChance",     path);
	c.criticalMultiplier = readFloat(obj, "criticalMultiplier", path);

	if (!obj["attackChain"].is_array() || obj["attackChain"].empty()) {
		throw std::runtime_error("CharacterPresetLoader: " + path + ".attackChain must be a non-empty array");
	}
	c.attackChain.reserve(obj["attackChain"].size());
	for (std::size_t i = 0; i < obj["attackChain"].size(); ++i) {
		c.attackChain.push_back(parseAttackStage(obj["attackChain"][i], path + ".attackChain[" + std::to_string(i) + "]"));
	}

	c.skill1 = parseSkill(obj["skill1"], path + ".skill1");
	c.skill2 = parseSkill(obj["skill2"], path + ".skill2");
	return c;
}

} // namespace detail

inline CharacterPreset CharacterPresetLoader::loadFromFile(const std::string& filePath, const std::string& expectedId) {
	std::ifstream file(filePath);
	if (!file.is_open()) {
		throw std::runtime_error("CharacterPresetLoader: cannot open file '" + filePath + "'");
	}
	std::string contents((std::istreambuf_iterator<char>(file)), std::istreambuf_iterator<char>());
	return loadFromString(contents, filePath, expectedId);
}

inline CharacterPreset CharacterPresetLoader::loadFromString(const std::string& jsonString, const std::string& sourceName, const std::string& expectedId) {
	nlohmann::json root;
	try {
		root = nlohmann::json::parse(jsonString);
	} catch (const nlohmann::json::parse_error& e) {
		throw std::runtime_error("CharacterPresetLoader: " + sourceName + " JSON parse error: " + e.what());
	}

	detail::requireKeysExactly(
		root,
		{"schema_version", "id", "health", "movement", "collider", "stamina", "combat"},
		{},
		sourceName
	);

	if (!root["schema_version"].is_number_integer() || root["schema_version"].get<int>() != 1) {
		throw std::runtime_error("CharacterPresetLoader: " + sourceName + " unsupported schema_version (expected 1)");
	}
	if (!root["id"].is_string() || root["id"].get<std::string>().empty()) {
		throw std::runtime_error("CharacterPresetLoader: " + sourceName + ".id must be a non-empty string");
	}
	if (!expectedId.empty() && root["id"].get<std::string>() != expectedId) {
		throw std::runtime_error("CharacterPresetLoader: " + sourceName + ".id '" + root["id"].get<std::string>()
			+ "' does not match expected '" + expectedId + "'");
	}

	CharacterPreset preset;
	preset.health   = detail::parseHealth  (root["health"],   sourceName + ".health");
	preset.movement = detail::parseMovement(root["movement"], sourceName + ".movement");
	preset.collider = detail::parseCollider(root["collider"], sourceName + ".collider");
	preset.stamina  = detail::parseStamina (root["stamina"],  sourceName + ".stamina");
	preset.combat   = detail::parseCombat  (root["combat"],   sourceName + ".combat");
	return preset;
}

} // namespace ArenaGame
