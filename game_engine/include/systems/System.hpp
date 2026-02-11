#pragma once

#include "GameLoop.hpp"
#include <vector>
#include <memory>

namespace ArenaGame {

// =============================================================================
// System - Base class for all game systems
// =============================================================================
// Systems operate on entities and implement specific game logic
// (physics, collision, combat, etc.) in a decoupled way.
//
// Systems can hook into different update phases:
// - Start(): Called once at initialization
// - EarlyUpdate(): Before physics (input processing)
// - FixedUpdate(): Fixed timestep (physics simulation)
// - Update(): Every frame (game logic)
// - LateUpdate(): After update (camera, interpolation)
//
// This follows the Single Responsibility Principle:
// - Each system handles ONE aspect of gameplay
// - Systems can be tested independently
// - Easy to add new systems without modifying existing code
// =============================================================================

class System {
public:
    virtual ~System() = default;

    // Lifecycle hooks
    virtual void initialize() {}
    virtual void shutdown() {}
    virtual void start() {}  // Called once after initialization

    // Update phase hooks (override the ones you need)
    virtual void earlyUpdate(float deltaTime) {}   // Before physics
    virtual void fixedUpdate(float fixedDeltaTime) {}  // Physics (fixed timestep)
    virtual void update(float deltaTime) {}         // Game logic (variable timestep)
    virtual void lateUpdate(float deltaTime) {}     // After update

    // Default update (for backwards compatibility)
    // Systems that don't need specific phases can override this
    virtual void defaultUpdate(float deltaTime) {
        update(deltaTime);
    }

    // System name for debugging
    virtual const char* getName() const = 0;

    // Which phases does this system need?
    // Override these to optimize (don't call empty functions)
    virtual bool needsEarlyUpdate() const { return false; }
    virtual bool needsFixedUpdate() const { return false; }
    virtual bool needsUpdate() const { return true; }
    virtual bool needsLateUpdate() const { return false; }
};

} // namespace ArenaGame
