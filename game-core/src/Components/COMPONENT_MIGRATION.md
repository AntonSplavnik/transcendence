# Component-Based Architecture Migration Guide

This guide shows how to migrate from the monolithic `Character` class to the new component-based architecture.

## Architecture Overview

### Before (Monolithic)
```cpp
class Character {
    // Transform data
    Vector3D m_position;
    Vector3D m_velocity;
    float m_yaw;

    // Stats
    CharacterStats m_stats;

    // Combat
    float m_attackCooldown;

    // Physics logic
    void applyMovement();
    void applyGravity();

    // Combat logic
    bool tryAttack();
    void takeDamage();
};
```

### After (Component-Based)
```cpp
// Pure data components
Transform transform;
PhysicsBody physics;
Collider collider;
Health health;
CharacterController controller;
CombatController combat;

// Logic in systems
PhysicsSystem::update();
CollisionSystem::update();
CombatSystem::update();
```

## Component Mapping

### Character → Components

| Old Character Member | New Component |
|---------------------|---------------|
| `m_position`, `m_yaw` | `Transform` |
| `m_velocity` | `PhysicsBody.velocity` |
| `m_isGrounded` | `PhysicsBody.isGrounded` |
| `m_stats.currentHealth` | `Health.current` |
| `m_stats.maxHealth` | `Health.maximum` |
| `m_attackCooldown` | `CombatController.attackCooldown` |
| `m_lastAttackTime` | `CombatController.timeSinceLastAttack` |
| `m_input` | `CharacterController.input` |
| `m_state` | `CharacterController.state` |

## Migration Steps

### Step 1: Create Entity with Components

Instead of:
```cpp
Character character(playerID, "Player1", spawnPos);
```

Use:
```cpp
struct Entity {
    PlayerID id;
    std::string name;

    // Components
    Transform transform;
    PhysicsBody physics;
    Collider collider;
    Health health;
    CharacterController controller;
    CombatController combat;

    Entity(PlayerID playerID, const std::string& entityName, const Vector3D& pos)
        : id(playerID)
        , name(entityName)
        , transform(pos)
        , physics(PhysicsBody::createCharacter())
        , collider(Collider::createCharacter())
        , health(Health::createCharacter())
        , controller(CharacterController::createDefault())
        , combat(CombatController::createMelee())
    {}
};
```

### Step 2: Replace Character Methods with System Calls

#### Physics

**Before:**
```cpp
character.applyMovement(deltaTime);
character.applyGravity(deltaTime);
```

**After:**
```cpp
// In PhysicsSystem::update()
physics.velocity.y += gravity * deltaTime;
transform.position += physics.velocity * deltaTime;
```

#### Combat

**Before:**
```cpp
if (character.tryAttack()) {
    // Attack started
}
character.takeDamage(damage, attackerID);
```

**After:**
```cpp
// In CombatSystem::update()
if (combat.canPerformAttack()) {
    combat.startAttack();
}
health.takeDamage(damage, attackerID);
```

### Step 3: Update Systems to Use Components

#### PhysicsSystem (Updated)
```cpp
void PhysicsSystem::update(float deltaTime) {
    for (Entity* entity : m_entities) {
        auto& transform = entity->transform;
        auto& physics = entity->physics;

        // Apply gravity
        if (physics.useGravity && !physics.isGrounded) {
            physics.velocity.y += config.gravity * deltaTime;
        }

        // Integrate velocity
        transform.position += physics.velocity * deltaTime;

        // Enforce bounds
        transform.position.x = std::clamp(transform.position.x,
            config.arenaMinX, config.arenaMaxX);
    }
}
```

#### CollisionSystem (Updated)
```cpp
void CollisionSystem::update(float deltaTime) {
    for (size_t i = 0; i < m_entities.size(); ++i) {
        for (size_t j = i + 1; j < m_entities.size(); ++j) {
            auto& entityA = m_entities[i];
            auto& entityB = m_entities[j];

            // Check if should collide
            if (!entityA->collider.shouldCollideWith(entityB->collider)) {
                continue;
            }

            // Broad phase (AABB)
            auto aabbA = entityA->collider.getAABB(entityA->transform.position);
            auto aabbB = entityB->collider.getAABB(entityB->transform.position);

            if (!aabbA.intersects(aabbB)) {
                continue;
            }

            // Narrow phase (shape-specific)
            if (checkCollision(entityA, entityB)) {
                resolveCollision(entityA, entityB);
            }
        }
    }
}
```

#### CombatSystem (Updated)
```cpp
void CombatSystem::update(float deltaTime) {
    for (Entity* entity : m_entities) {
        auto& combat = entity->combat;
        auto& health = entity->health;

        // Update timers
        combat.updateTimers(deltaTime);

        // Process attack request
        if (combat.attackRequested && combat.canPerformAttack()) {
            combat.startAttack();

            // Check for targets in range
            // Apply damage to targets
        }

        // Check death
        if (!health.isAlive() && entity->controller.state != CharacterState::Dead) {
            entity->controller.setState(CharacterState::Dead);
        }
    }
}
```

## Example: Complete Character Setup

```cpp
// Create entity
Entity player(1, "Player1", Vector3D(0, 0, 0));

// Configure components
player.transform.setYaw(M_PI / 4);  // Face northeast

player.physics.maxSpeed = 10.0f;
player.physics.useGravity = true;

player.collider.layer = CollisionLayer::Player;
player.collider.collidesWith = CollisionLayer::Wall | CollisionLayer::Enemy;

player.health.maximum = 100.0f;
player.health.armor = 10.0f;

player.controller.movementSpeed = 8.0f;
player.controller.jumpVelocity = 10.0f;

player.combat.baseDamage = 25.0f;
player.combat.attackRange = 2.0f;

// Register with systems
physicsSystem->addEntity(&player);
collisionSystem->addEntity(&player);
combatSystem->addEntity(&player);
```

## Example: Setting Input

**Before:**
```cpp
InputState input;
input.movementDirection = Vector3D(0, 0, 1);
input.isJumping = true;
character.setInput(input);
```

**After:**
```cpp
player.controller.input.movementDirection = Vector3D(0, 0, 1);
player.controller.input.isJumping = true;
```

## Example: Querying State

**Before:**
```cpp
if (character.isAlive()) {
    Vector3D pos = character.getPosition();
    float health = character.getStats().currentHealth;
}
```

**After:**
```cpp
if (player.health.isAlive()) {
    Vector3D pos = player.transform.position;
    float health = player.health.current;
}
```

## Benefits

### 1. Separation of Concerns
- Transform handles position/rotation
- Physics handles velocity/forces
- Combat handles damage/attacks
- Each component has ONE responsibility

### 2. Reusability
```cpp
// Projectile = Transform + PhysicsBody + Collider (no Health, no Controller)
Entity bullet(id, "Bullet", spawnPos);
bullet.physics = PhysicsBody::createProjectile();
bullet.collider = Collider::createProjectile();
// No health, no controller needed!

// Wall = Transform + Collider (no Physics, no Health)
Entity wall(id, "Wall", wallPos);
wall.collider = Collider::createWall(halfExtents);
wall.physics.isKinematic = true;
// No health, no controller needed!
```

### 3. Easy to Extend
```cpp
// Add new component type without modifying existing code
struct Shield {
    float durability;
    float regenRate;
    bool isActive;
};

// Add new system
class ShieldSystem : public System {
    void update(float deltaTime) {
        // Process shield logic
    }
};
```

### 4. Better for Projectiles & Walls
```cpp
// Projectile
Entity projectile;
projectile.transform = Transform(spawnPos);
projectile.physics = PhysicsBody::createProjectile();
projectile.collider = Collider::createProjectile();
// Done! No unnecessary health or combat components

// Wall
Entity wall;
wall.transform = Transform(wallPos);
wall.collider = Collider::createWall(halfExtents);
wall.physics.isKinematic = true;
// Done! Static object with just transform and collider
```

## Next Steps

1. Update `ArenaGame` to use entities with components
2. Update systems to operate on components instead of `Character*`
3. Create `Entity` class or use an ECS library
4. Add `ProjectileSystem` for projectile logic
5. Add `RaycastSystem` for line-of-sight checks

## Testing Components

```cpp
// Test Transform
Transform t(Vector3D(10, 0, 5));
t.setYaw(M_PI / 2);
assert(t.getForwardDirection().x > 0.9f);  // Facing right

// Test PhysicsBody
PhysicsBody p = PhysicsBody::createCharacter();
p.velocity = Vector3D(5, 0, 0);
assert(p.getSpeed() == 5.0f);

// Test Health
Health h(100.0f);
h.takeDamage(30.0f);
assert(h.current == 70.0f);
assert(h.isAlive());

// Test Collider
Collider c = Collider::createCharacter();
assert(c.layer == CollisionLayer::Player);
```
