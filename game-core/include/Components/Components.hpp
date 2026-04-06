#pragma once

// =============================================================================
// Components.hpp - Convenience header to include all component types
// =============================================================================
// Include this file to get access to all component definitions
//
// Usage:
//   #include "Components/Components.hpp"
//   using namespace ArenaGame::Components;
// =============================================================================

#include "Transform.hpp"
#include "PhysicsBody.hpp"
#include "Collider.hpp"
#include "Health.hpp"
#include "CharacterController.hpp"
#include "CombatController.hpp"

namespace ArenaGame {
namespace Components {

// Component type enumeration (for runtime type checking if needed)
enum class ComponentType {
    Transform,
    PhysicsBody,
    Collider,
    Health,
    CharacterController,
    CombatController
};

} // namespace Components
} // namespace ArenaGame
