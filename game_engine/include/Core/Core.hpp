#pragma once

// =============================================================================
// Core.hpp - Convenience header for core ECS architecture
// =============================================================================
// Include this to get Entity, World, and related systems
//
// Usage:
//   #include "Core/Core.hpp"
//   using namespace ArenaGame::Core;
// =============================================================================

#include "Entity.hpp"
#include "World.hpp"

namespace ArenaGame {
namespace Core {

// Version of the Core API
constexpr int CORE_VERSION_MAJOR = 1;
constexpr int CORE_VERSION_MINOR = 0;
constexpr int CORE_VERSION_PATCH = 0;

} // namespace Core
} // namespace ArenaGame
