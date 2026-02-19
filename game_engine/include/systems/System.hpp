#pragma once

#include <entt/entt.hpp>
#include "GameEvents.hpp"

namespace ArenaGame {

// =============================================================================
// System - Base class for EnTT-based systems
// =============================================================================
// Base class for all game systems using EnTT registry.
// Systems process entities with specific component combinations.
//
// Update phases (in order):
// 1. earlyUpdate()  - Input processing (variable dt)
// 2. fixedUpdate()  - Physics simulation (fixed dt, deterministic)
// 3. update()       - Game logic, combat (variable dt)
// 4. lateUpdate()   - Post-processing, interpolation (variable dt)
//
// Usage:
//   class MySystem : public System {
//   public:
//       void fixedUpdate(float dt) override {
//           auto view = m_registry->view<Transform, PhysicsBody>();
//           for (auto entity : view) {
//               auto& [transform, physics] = view.get<Transform, PhysicsBody>(entity);
//               // Process components...
//           }
//       }
//       const char* getName() const override { return "MySystem"; }
//       bool needsFixedUpdate() const override { return true; }
//   };
// =============================================================================

class System {
public:
    virtual ~System() = default;

    // System lifecycle
    virtual void initialize() {}
    virtual void shutdown() {}
    virtual void start() {}

    // Update phases (override what you need)
    virtual void earlyUpdate(float deltaTime) {}
    virtual void fixedUpdate(float fixedDeltaTime) {}
    virtual void update(float deltaTime) {}
    virtual void lateUpdate(float deltaTime) {}

    // System metadata
    virtual const char* getName() const = 0;

    // Update phase flags (override to indicate which phases this system needs)
    virtual bool needsEarlyUpdate() const { return false; }
    virtual bool needsFixedUpdate() const { return false; }
    virtual bool needsUpdate() const { return true; }  // Most systems need this
    virtual bool needsLateUpdate() const { return false; }

    // Set registry (called during world initialization)
    void setRegistry(entt::registry* registry) {
        m_registry = registry;
    }

    // Set event queue (called during world initialization)
    void setEventQueue(GameEventQueue* queue) {
        m_eventQueue = queue;
    }

protected:
    // Protected access to registry for derived systems
    entt::registry* m_registry = nullptr;
    // Protected access to event queue for derived systems
    GameEventQueue* m_eventQueue = nullptr;
};

} // namespace ArenaGame
