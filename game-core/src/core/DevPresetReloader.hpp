#ifndef NDEBUG
#pragma once

#include "CharacterPresetRegistry.hpp"
#include "CharacterPresetLoader.hpp"
#include "../components/PresetBinding.hpp"
#include "../components/Health.hpp"
#include "../components/PhysicsBody.hpp"
#include "../components/Collider.hpp"
#include "../components/Stamina.hpp"
#include "../components/CombatController.hpp"
#include "../components/CharacterController.hpp"
#include "../GameTypes.hpp"
#include "../../entt/entt.hpp"
#include <filesystem>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <cstdio>

namespace ArenaGame {

class DevPresetReloader {
public:
    DevPresetReloader(entt::registry& registry,
                      CharacterPresetRegistry& presets)
        : m_registry(registry)
        , m_presets(presets)
    {
        namespace fs = std::filesystem;
        const std::string dir = GameConfig::PRESETS_DIR;
        if (!fs::exists(dir) || !fs::is_directory(dir)) return;

        for (const auto& entry : fs::recursive_directory_iterator(dir)) {
            if (!entry.is_regular_file()) continue;
            if (entry.path().extension() != ".json") continue;
            m_mtimes[entry.path().string()] = fs::last_write_time(entry);
        }
    }

    void checkAndReload();

private:
    entt::registry& m_registry;
    CharacterPresetRegistry& m_presets;
    std::unordered_map<std::string, std::filesystem::file_time_type> m_mtimes;
};

// =============================================================================
// Implementation
// =============================================================================

inline void DevPresetReloader::checkAndReload() {
    namespace fs = std::filesystem;
    try {
        const std::string dir = GameConfig::PRESETS_DIR;
        if (!fs::exists(dir) || !fs::is_directory(dir)) return;

        std::unordered_set<std::string> reloadedIds;
        CharacterPresetLoader loader;

        std::unordered_set<std::string> seenPaths;

        for (const auto& entry : fs::recursive_directory_iterator(dir)) {
            if (!entry.is_regular_file()) continue;
            if (entry.path().extension() != ".json") continue;

            const std::string filePath = entry.path().string();
            seenPaths.insert(filePath);
            const auto mtime = fs::last_write_time(entry);

            auto it = m_mtimes.find(filePath);
            if (it != m_mtimes.end() && it->second == mtime) continue;

            const std::string id = entry.path().stem().string();

            CharacterPreset preset;
            try {
                preset = loader.loadFromFile(filePath, id);
            } catch (const std::exception& e) {
                fprintf(stderr, "[hot-reload] ERROR: failed to parse '%s': %s\n",
                        filePath.c_str(), e.what());
                continue;
            }

            bool conflict = false;
            for (const auto& [otherPath, _] : m_mtimes) {
                if (otherPath != filePath && fs::path(otherPath).stem() == id) {
                    fprintf(stderr,
                        "[hot-reload] ERROR: stem '%s' conflicts: '%s' vs '%s' — skipping\n",
                        id.c_str(), filePath.c_str(), otherPath.c_str());
                    conflict = true;
                    break;
                }
            }
            if (conflict) continue;

            m_presets.loadOrReplace(id, std::move(preset));
            m_mtimes[filePath] = mtime;
            reloadedIds.insert(id);
        }

        auto it = m_mtimes.begin();
        while (it != m_mtimes.end()) {
            if (seenPaths.find(it->first) == seenPaths.end()) {
                fprintf(stderr, "[hot-reload] WARNING: preset file removed from disk: '%s'\n",
                        it->first.c_str());
                it = m_mtimes.erase(it);
            } else {
                ++it;
            }
        }

        if (reloadedIds.empty()) return;

        auto view = m_registry.view<Components::PresetBinding>();
        for (auto entity : view) {
            const auto& binding = view.get<Components::PresetBinding>(entity);
            if (reloadedIds.find(binding.id) == reloadedIds.end()) continue;

            if (!m_presets.contains(binding.id)) continue;
            const auto& preset = m_presets.get(binding.id);

            m_registry.replace<Components::Health>(entity,
                Components::Health::createFromPreset(preset.health));
            m_registry.replace<Components::PhysicsBody>(entity,
                Components::PhysicsBody::createFromPreset(preset.movement));

            Components::CollisionLayer layer = m_registry.get<Components::Collider>(entity).layer;
            m_registry.replace<Components::Collider>(entity,
                Components::Collider::createFromPreset(preset.collider, layer));

            m_registry.replace<Components::Stamina>(entity,
                Components::Stamina::createFromPreset(preset.stamina));
            m_registry.replace<Components::CombatController>(entity,
                Components::CombatController::createFromPreset(preset.combat));

            if (m_registry.all_of<Components::CharacterController>(entity)) {
                m_registry.replace<Components::CharacterController>(entity,
                    Components::CharacterController::createFromPreset(preset.movement));
            }
        }

        for (const auto& id : reloadedIds) {
            int count = 0;
            for (auto entity : view) {
                if (view.get<Components::PresetBinding>(entity).id == id) ++count;
            }
            fprintf(stderr, "[hot-reload] reloaded preset '%s' (%d entities updated)\n",
                    id.c_str(), count);
        }

    } catch (const std::exception& e) {
        fprintf(stderr, "[hot-reload] ERROR: %s\n", e.what());
    }
}

} // namespace ArenaGame

#endif // NDEBUG
