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

inline float readPositiveFloat(const nlohmann::json& obj, const std::string& key, const std::string& path) {
	float val = readFloat(obj, key, path);
	if (!(val > 0.0f)) {
		throw std::runtime_error("CharacterPresetLoader: " + path + "." + key
			+ " must be > 0 (got " + std::to_string(val) + ")");
	}
	return val;
}

inline float readNonNegativeFloat(const nlohmann::json& obj, const std::string& key, const std::string& path) {
	float val = readFloat(obj, key, path);
	if (val < 0.0f) {
		throw std::runtime_error("CharacterPresetLoader: " + path + "." + key
			+ " must be >= 0 (got " + std::to_string(val) + ")");
	}
	return val;
}

inline float readFloatInRange(const nlohmann::json& obj, const std::string& key,
                               float lo, float hi, const std::string& path) {
	float val = readFloat(obj, key, path);
	if (!(val >= lo && val <= hi)) {
		throw std::runtime_error("CharacterPresetLoader: " + path + "." + key
			+ " must be in [" + std::to_string(lo) + ", " + std::to_string(hi)
			+ "] (got " + std::to_string(val) + ")");
	}
	return val;
}

inline float readNonNegativeFloatOr(const nlohmann::json& obj, const std::string& key, float dflt, const std::string& path) {
	float val = readFloatOr(obj, key, dflt, path);
	if (val < 0.0f) {
		throw std::runtime_error("CharacterPresetLoader: " + path + "." + key
			+ " must be >= 0 (got " + std::to_string(val) + ")");
	}
	return val;
}

inline HealthPreset parseHealth(const nlohmann::json& obj, const std::string& path) {
	requireKeysExactly(obj, {"maxHealth", "armor", "resistance"}, {}, path);
	return HealthPreset{
		readPositiveFloat(obj, "maxHealth",                path),
		readNonNegativeFloat(obj, "armor",                 path),
		readFloatInRange(obj, "resistance", 0.0f, 1.0f,   path),
	};
}

inline MovementPreset parseMovement(const nlohmann::json& obj, const std::string& path) {
	requireKeysExactly(obj, {
		"movementSpeed", "rotationSpeed", "sprintMultiplier", "crouchMultiplier",
		"jumpVelocity", "dodgeVelocity", "airControlFactor", "acceleration",
		"deceleration", "mass", "friction", "drag", "maxSpeed", "maxFallSpeed"
	}, {}, path);
	return MovementPreset{
		readPositiveFloat(obj, "movementSpeed",                path),
		readPositiveFloat(obj, "rotationSpeed",                path),
		readPositiveFloat(obj, "sprintMultiplier",             path),
		readPositiveFloat(obj, "crouchMultiplier",             path),
		readNonNegativeFloat(obj, "jumpVelocity",              path),
		readNonNegativeFloat(obj, "dodgeVelocity",             path),
		readFloatInRange(obj, "airControlFactor", 0.0f, 1.0f, path),
		readPositiveFloat(obj, "acceleration",                 path),
		readPositiveFloat(obj, "deceleration",                 path),
		readPositiveFloat(obj, "mass",                         path),
		readFloatInRange(obj, "friction", 0.0f, 1.0f,         path),
		readNonNegativeFloat(obj, "drag",                      path),
		readPositiveFloat(obj, "maxSpeed",                     path),
		readPositiveFloat(obj, "maxFallSpeed",                 path),
	};
}

inline ColliderPreset parseCollider(const nlohmann::json& obj, const std::string& path) {
	requireKeysExactly(obj, {"radius", "height"}, {}, path);
	return ColliderPreset{
		readPositiveFloat(obj, "radius", path),
		readPositiveFloat(obj, "height", path),
	};
}

inline StaminaPreset parseStamina(const nlohmann::json& obj, const std::string& path) {
	requireKeysExactly(obj, {"maxStamina", "baseRegenRate", "drainDelaySeconds", "sprintCostPerSec", "jumpCost"}, {}, path);
	return StaminaPreset{
		readPositiveFloat(obj, "maxStamina",            path),
		readNonNegativeFloat(obj, "baseRegenRate",      path),
		readNonNegativeFloat(obj, "drainDelaySeconds",  path),
		readNonNegativeFloat(obj, "sprintCostPerSec",   path),
		readNonNegativeFloat(obj, "jumpCost",           path),
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
	s.damageMultiplier   = readPositiveFloat(obj, "damageMultiplier",                path);
	s.range              = readPositiveFloat(obj, "range",                           path);
	s.duration           = readPositiveFloat(obj, "duration",                        path);
	s.movementMultiplier = readFloatInRange(obj, "movementMultiplier", 0.0f, 1.0f,  path);
	s.chainWindow        = readNonNegativeFloat(obj, "chainWindow",                  path);
	s.attackAngle        = readNonNegativeFloatOr(obj, "attackAngle", 0.7f,          path);
	s.staminaCost        = readNonNegativeFloat(obj, "staminaCost",                  path);
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
			readPositiveFloat(obj, "range",                                path),
			readFloatInRange(obj, "movementMultiplier", 0.0f, 1.0f,      path),
			readPositiveFloat(obj, "dmgMultiplier",                       path),
		};
	}
	throw std::runtime_error("CharacterPresetLoader: " + path + ".type unknown skill type '" + type + "'");
}

inline SkillDefinition parseSkill(const nlohmann::json& obj, const std::string& path) {
	requireKeysExactly(obj, {"params"}, {"cooldown", "castDuration", "staminaCost"}, path);
	SkillDefinition s;
	s.params       = parseSkillParams(obj["params"], path + ".params");
	s.cooldown     = readNonNegativeFloatOr(obj, "cooldown",     0.0f, path);
	s.castDuration = readNonNegativeFloatOr(obj, "castDuration", 0.0f, path);
	s.staminaCost  = readNonNegativeFloatOr(obj, "staminaCost",  0.0f, path);
	return s;
}

inline CombatPreset parseCombat(const nlohmann::json& obj, const std::string& path) {
	requireKeysExactly(obj,
		{"baseDamage", "damageMultiplier", "criticalChance", "criticalMultiplier", "attackChain", "skill1", "skill2"},
		{}, path);
	CombatPreset c;
	c.baseDamage         = readNonNegativeFloat(obj, "baseDamage",                   path);
	c.damageMultiplier   = readPositiveFloat(obj, "damageMultiplier",                path);
	c.criticalChance     = readFloatInRange(obj, "criticalChance", 0.0f, 1.0f,      path);
	c.criticalMultiplier = readFloat(obj, "criticalMultiplier",                      path);
	if (c.criticalMultiplier < 1.0f) {
		throw std::runtime_error("CharacterPresetLoader: " + path + ".criticalMultiplier must be >= 1 (got "
			+ std::to_string(c.criticalMultiplier) + ")");
	}

	if (!obj["attackChain"].is_array() || obj["attackChain"].empty()) {
		throw std::runtime_error("CharacterPresetLoader: " + path + ".attackChain must be a non-empty array");
	}
	if (obj["attackChain"].size() > 8) {
		throw std::runtime_error("CharacterPresetLoader: " + path + ".attackChain exceeds maximum of 8 stages (got "
			+ std::to_string(obj["attackChain"].size()) + ")");
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
