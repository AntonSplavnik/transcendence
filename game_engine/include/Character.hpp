#pragma once

#include "GameTypes.hpp"
#include <string>

namespace ArenaGame {

// =============================================================================
// Character - Represents a player character in the arena
// =============================================================================

class Character {
public:
    Character(PlayerID playerID, const std::string& name, const Vector3D& spawnPos);

    // Core update function - call this every physics tick
    void update(float deltaTime);

    // Input handling
    void setInput(const InputState& input);
    const InputState& getInput() const { return m_input; }

    // Movement
    void applyMovement(float deltaTime);
    void applyGravity(float deltaTime);
    void setPosition(const Vector3D& pos) { m_position = pos; }
    const Vector3D& getPosition() const { return m_position; }
    const Vector3D& getVelocity() const { return m_velocity; }
    bool isGrounded() const { return m_isGrounded; }

    // Combat
    bool tryAttack();  // Returns true if attack was initiated
    void takeDamage(float damage, PlayerID attackerID);
    void die();
    void respawn(const Vector3D& spawnPos);

    // State queries
    bool isAlive() const { return m_stats.isAlive(); }
    bool canMove() const { return m_state == CharacterState::Idle || m_state == CharacterState::Moving; }
    bool canAttack() const;

    // Getters
    PlayerID getPlayerID() const { return m_playerID; }
    const std::string& getName() const { return m_name; }
    CharacterState getState() const { return m_state; }
    const CharacterStats& getStats() const { return m_stats; }
    CharacterStats& getStats() { return m_stats; }
    Cylinder getCollisionCylinder() const;
    float getYaw() const { return m_yaw; }  // Horizontal rotation

    // Setters
    void setState(CharacterState state) { m_state = state; }

private:
    // Identity
    PlayerID m_playerID;
    std::string m_name;

    // Transform
    Vector3D m_position;
    Vector3D m_velocity;
    float m_yaw;       // Horizontal rotation (radians, around Y axis)
    float m_pitch;     // Vertical rotation (radians, for aiming)

    // Stats
    CharacterStats m_stats;

    // State
    CharacterState m_state;
    InputState m_input;
    bool m_isGrounded;

    // Combat timing
    float m_attackCooldown;
    float m_lastAttackTime;

    // Internal helpers
    void updateRotation();
    void applyFriction(float deltaTime);
    void clampVelocity();
};

// =============================================================================
// Character Implementation
// =============================================================================

inline Character::Character(PlayerID playerID, const std::string& name, const Vector3D& spawnPos)
    : m_playerID(playerID)
    , m_name(name)
    , m_position(spawnPos)
    , m_velocity(0.0f, 0.0f, 0.0f)
    , m_yaw(0.0f)
    , m_pitch(0.0f)
    , m_stats()
    , m_state(CharacterState::Idle)
    , m_input()
    , m_isGrounded(false)
    , m_attackCooldown(0.0f)
    , m_lastAttackTime(0.0f)
{
    m_attackCooldown = 1.0f / m_stats.attackSpeed;
}

inline void Character::update(float deltaTime) {
    if (!isAlive()) {
        m_state = CharacterState::Dead;
        return;
    }

    // Update attack cooldown
    if (m_lastAttackTime > 0.0f) {
        m_lastAttackTime -= deltaTime;
        if (m_lastAttackTime < 0.0f) {
            m_lastAttackTime = 0.0f;
        }
    }

    // Always apply gravity
    applyGravity(deltaTime);

    // Handle state-specific behavior
    switch (m_state) {
        case CharacterState::Idle:
        case CharacterState::Moving:
            applyMovement(deltaTime);
            break;

        case CharacterState::Attacking:
            // Attacking animation/state
            // Can still move while attacking
            applyMovement(deltaTime);
            // TODO: Check if attack animation is complete
            m_state = CharacterState::Idle;
            break;

        case CharacterState::Stunned:
            // Cannot move or act while stunned
            break;

        case CharacterState::Dead:
            // Dead, waiting for respawn
            break;

        default:
            break;
    }

    updateRotation();
}

inline void Character::setInput(const InputState& input) {
    m_input = input;
}

inline void Character::applyMovement(float deltaTime) {
    if (!canMove()) {
        return;
    }

    // Handle jump input
    if (m_input.isJumping && m_isGrounded) {
        m_velocity.y = GameConfig::JUMP_VELOCITY;
        m_isGrounded = false;
    }

    // Apply horizontal movement (XZ plane)
    Vector3D horizontalInput = m_input.movementDirection.horizontalProjection();

    if (horizontalInput.lengthSquared() > 0.0f) {
        Vector3D direction = horizontalInput.normalized();
        Vector3D acceleration = direction * m_stats.movementSpeed;

        // Only update horizontal velocity (X and Z)
        m_velocity.x = acceleration.x;
        m_velocity.z = acceleration.z;
        m_state = CharacterState::Moving;
    } else {
        // No input, apply friction to horizontal movement only
        applyFriction(deltaTime);

        Vector3D horizontalVel(m_velocity.x, 0.0f, m_velocity.z);
        if (horizontalVel.lengthSquared() < GameConfig::MIN_VELOCITY * GameConfig::MIN_VELOCITY) {
            m_velocity.x = 0.0f;
            m_velocity.z = 0.0f;
            if (m_isGrounded) {
                m_state = CharacterState::Idle;
            }
        }
    }

    // Clamp horizontal velocity to max speed
    clampVelocity();

    // Update position
    m_position += m_velocity * deltaTime;

    // Keep character within arena bounds (horizontal)
    m_position.x = std::max(GameConfig::CHARACTER_RADIUS,
                           std::min(GameConfig::ARENA_WIDTH - GameConfig::CHARACTER_RADIUS, m_position.x));
    m_position.z = std::max(GameConfig::CHARACTER_RADIUS,
                           std::min(GameConfig::ARENA_LENGTH - GameConfig::CHARACTER_RADIUS, m_position.z));

    // Keep character above ground
    if (m_position.y <= GameConfig::GROUND_Y) {
        m_position.y = GameConfig::GROUND_Y;
        m_velocity.y = 0.0f;
        m_isGrounded = true;
    }
}

inline bool Character::tryAttack() {
    if (!canAttack()) {
        return false;
    }

    m_state = CharacterState::Attacking;
    m_lastAttackTime = m_attackCooldown;
    return true;
}

inline bool Character::canAttack() const {
    return isAlive() &&
           m_state != CharacterState::Stunned &&
           m_state != CharacterState::Dead &&
           m_lastAttackTime <= 0.0f;
}

inline void Character::takeDamage(float damage, PlayerID attackerID) {
    if (!isAlive()) {
        return;
    }

    m_stats.takeDamage(damage);

    if (!m_stats.isAlive()) {
        die();
    }
}

inline void Character::die() {
    m_state = CharacterState::Dead;
    m_velocity = Vector3D(0.0f, 0.0f, 0.0f);
    m_stats.currentHealth = 0.0f;
}

inline void Character::applyGravity(float deltaTime) {
    if (!m_isGrounded) {
        m_velocity.y += GameConfig::GRAVITY * deltaTime;
    }
}

inline void Character::respawn(const Vector3D& spawnPos) {
    m_position = spawnPos;
    m_velocity = Vector3D(0.0f, 0.0f, 0.0f);
    m_stats.currentHealth = m_stats.maxHealth;
    m_state = CharacterState::Idle;
    m_lastAttackTime = 0.0f;
    m_isGrounded = false;
}

inline Cylinder Character::getCollisionCylinder() const {
    return Cylinder(m_position, GameConfig::CHARACTER_COLLISION_RADIUS, GameConfig::CHARACTER_HEIGHT);
}

inline void Character::updateRotation() {
    // Update facing direction based on look direction, movement, or target
    if (m_input.hasTarget) {
        Vector3D direction = (m_input.targetPosition - m_position).normalized();
        m_yaw = std::atan2(direction.x, direction.z);  // Note: atan2(x, z) for Y-up coordinate system
    } else if (m_input.lookDirection.lengthSquared() > 0.0f) {
        Vector3D lookDir = m_input.lookDirection.normalized();
        m_yaw = std::atan2(lookDir.x, lookDir.z);
    } else {
        // Use movement direction
        Vector3D horizontalVel(m_velocity.x, 0.0f, m_velocity.z);
        if (horizontalVel.lengthSquared() > 0.0f) {
            m_yaw = std::atan2(horizontalVel.x, horizontalVel.z);
        }
    }
}

inline void Character::applyFriction(float deltaTime) {
    // Only apply friction to horizontal movement
    m_velocity.x *= GameConfig::FRICTION;
    m_velocity.z *= GameConfig::FRICTION;
}

inline void Character::clampVelocity() {
    // Only clamp horizontal velocity (X and Z)
    Vector3D horizontalVel(m_velocity.x, 0.0f, m_velocity.z);
    float speedSquared = horizontalVel.lengthSquared();
    float maxSpeed = m_stats.movementSpeed;

    if (speedSquared > maxSpeed * maxSpeed) {
        Vector3D clamped = horizontalVel.normalized() * maxSpeed;
        m_velocity.x = clamped.x;
        m_velocity.z = clamped.z;
    }
}

} // namespace ArenaGame
