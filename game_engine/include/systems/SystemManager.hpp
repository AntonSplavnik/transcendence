#pragma once

#include "System.hpp"
#include <vector>
#include <memory>
#include <algorithm>
#include <cstring>

namespace ArenaGame {

// =============================================================================
// SystemManager - Manages and updates all game systems
// =============================================================================
// Responsibilities:
// - Register/unregister systems
// - Update all systems in the correct phase order
// - System lifecycle management
//
// Update phases (in order):
//   1. start() - Called once after initialization
//   2. earlyUpdate() - Before physics (input)
//   3. fixedUpdate() - Physics (fixed timestep, may run 0-N times per frame)
//   4. update() - Game logic (every frame)
//   5. lateUpdate() - Post-processing (every frame)
//
// Usage:
//   SystemManager manager;
//   manager.addSystem(std::make_unique<PhysicsSystem>());
//   manager.addSystem(std::make_unique<CollisionSystem>());
//   manager.initialize();
//   manager.start();
//
//   // Game loop
//   while (running) {
//       manager.earlyUpdate(deltaTime);
//       while (shouldDoFixedUpdate()) {
//           manager.fixedUpdate(fixedDeltaTime);
//       }
//       manager.update(deltaTime);
//       manager.lateUpdate(deltaTime);
//   }
// =============================================================================

class SystemManager {
public:
    SystemManager() = default;
    ~SystemManager() = default;

    // System management
    void addSystem(std::unique_ptr<System> system);
    void removeSystem(const char* systemName);
    System* getSystem(const char* systemName);

    // Get system by type (template convenience method)
    template<typename T>
    T* getSystem() {
        for (auto& system : m_systems) {
            T* casted = dynamic_cast<T*>(system.get());
            if (casted) {
                return casted;
            }
        }
        return nullptr;
    }

    // Lifecycle
    void initialize();
    void start();     // NEW: Called once after initialization
    void shutdown();
    void clear();

    // Update phases (NEW: separate methods for each phase)
    void earlyUpdate(float deltaTime);
    void fixedUpdate(float fixedDeltaTime);
    void update(float deltaTime);
    void lateUpdate(float deltaTime);

    // Queries
    size_t getSystemCount() const { return m_systems.size(); }
    bool isInitialized() const { return m_initialized; }
    bool isStarted() const { return m_started; }

private:
    std::vector<std::unique_ptr<System>> m_systems;
    bool m_initialized = false;
    bool m_started = false;
};

// =============================================================================
// Implementation
// =============================================================================

inline void SystemManager::addSystem(std::unique_ptr<System> system) {
    if (!system) {
        return;
    }

    // Initialize system if manager is already initialized
    if (m_initialized) {
        system->initialize();
        if (m_started) {
            system->start();
        }
    }

    m_systems.push_back(std::move(system));
}

inline void SystemManager::removeSystem(const char* systemName) {
    m_systems.erase(
        std::remove_if(m_systems.begin(), m_systems.end(),
            [systemName](const std::unique_ptr<System>& system) {
                bool match = std::strcmp(system->getName(), systemName) == 0;
                if (match) {
                    system->shutdown();
                }
                return match;
            }
        ),
        m_systems.end()
    );
}

inline System* SystemManager::getSystem(const char* systemName) {
    for (auto& system : m_systems) {
        if (std::strcmp(system->getName(), systemName) == 0) {
            return system.get();
        }
    }
    return nullptr;
}

inline void SystemManager::initialize() {
    if (m_initialized) {
        return;
    }

    for (auto& system : m_systems) {
        system->initialize();
    }

    m_initialized = true;
}

inline void SystemManager::start() {
    if (!m_initialized || m_started) {
        return;
    }

    for (auto& system : m_systems) {
        system->start();
    }

    m_started = true;
}

inline void SystemManager::shutdown() {
    if (!m_initialized) {
        return;
    }

    // Shutdown in reverse order
    for (auto it = m_systems.rbegin(); it != m_systems.rend(); ++it) {
        (*it)->shutdown();
    }

    m_initialized = false;
    m_started = false;
}

inline void SystemManager::clear() {
    shutdown();
    m_systems.clear();
}

inline void SystemManager::earlyUpdate(float deltaTime) {
    for (auto& system : m_systems) {
        if (system->needsEarlyUpdate()) {
            system->earlyUpdate(deltaTime);
        }
    }
}

inline void SystemManager::fixedUpdate(float fixedDeltaTime) {
    for (auto& system : m_systems) {
        if (system->needsFixedUpdate()) {
            system->fixedUpdate(fixedDeltaTime);
        }
    }
}

inline void SystemManager::update(float deltaTime) {
    for (auto& system : m_systems) {
        if (system->needsUpdate()) {
            system->update(deltaTime);
        }
    }
}

inline void SystemManager::lateUpdate(float deltaTime) {
    for (auto& system : m_systems) {
        if (system->needsLateUpdate()) {
            system->lateUpdate(deltaTime);
        }
    }
}

} // namespace ArenaGame
