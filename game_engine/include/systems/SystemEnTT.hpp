#pragma once

#include "Systems/System.hpp"
#include <entt/entt.hpp>

namespace ArenaGame {

// =============================================================================
// SystemEnTT - Base class for EnTT-based systems
// =============================================================================
// Extends the System base class to provide access to the EnTT registry.
// All EnTT systems inherit from this instead of System directly.
//
// Key differences from System:
// - Stores registry pointer for component access
// - Systems use EnTT views/groups instead of manual entity tracking
// - No need for addEntity/removeEntity methods
//
// Usage:
//   class MySystemEnTT : public SystemEnTT {
//   public:
//       void fixedUpdate(float dt) override {
//           auto view = m_registry->view<Transform, PhysicsBody>();
//           for (auto entity : view) {
//               auto& [transform, physics] = view.get<Transform, PhysicsBody>(entity);
//               // Process components...
//           }
//       }
//   };
// =============================================================================

class SystemEnTT : public System {
public:
    virtual ~SystemEnTT() = default;

    // Set registry (called during world initialization)
    void setRegistry(entt::registry* registry) {
        m_registry = registry;
    }

protected:
    // Protected access to registry for derived systems
    entt::registry* m_registry = nullptr;
};

} // namespace ArenaGame
