#pragma once

#include "../GameTypes.hpp"

namespace ArenaGame {
namespace Components {

// =============================================================================
// CharacterController - Input handling and movement settings
// =============================================================================
// Pure data component - logic handled by CharacterSystem
// Stores input state and movement configuration for player-controlled entities
//
// Usage:
//   CharacterController controller;
//   controller.input.movementDirection = Vector3D(0, 0, 1); // Move forward
//   controller.input.isJumping = true;
// =============================================================================

struct CharacterController {
    // Current input state (set by player or AI)
    InputState input;

    // Movement configuration
    float movementSpeed;        // Base movement speed (m/s)
    float sprintMultiplier;     // Speed multiplier when sprinting
    float crouchMultiplier;     // Speed multiplier when crouching
    float jumpVelocity;         // Initial upward velocity when jumping

    // Movement state
    bool isSprinting;
    bool isCrouching;
    bool canJump;
    bool canMove;
    bool canRotate;

    // Air control
    float airControlFactor;     // How much control player has while airborne (0.0-1.0)

    // Movement smoothing (for better feel)
    float acceleration;         // How fast to reach target speed
    float deceleration;         // How fast to slow down

    // State machine (optional - can be used by CharacterSystem)
    CharacterState state;

    // Constructors
    CharacterController()
        : input()
        , movementSpeed(GameConfig::CHARACTER_MOVE_SPEED)
        , sprintMultiplier(1.5f)
        , crouchMultiplier(0.5f)
        , jumpVelocity(GameConfig::JUMP_VELOCITY)
        , isSprinting(false)
        , isCrouching(false)
        , canJump(true)
        , canMove(true)
        , canRotate(true)
        , airControlFactor(0.3f)
        , acceleration(100.0f)
        , deceleration(100.0f)
        , state(CharacterState::Idle)
    {}

    // Helper methods
    void clearInput() {
        input = InputState();
    }

    void setInput(const InputState& newInput) {
        input = newInput;
    }

    bool hasMovementInput() const {
        return input.movementDirection.lengthSquared() > 0.001f;
    }

    bool hasLookInput() const {
        return input.lookDirection.lengthSquared() > 0.001f;
    }

    Vector3D getMovementDirection() const {
        if (!hasMovementInput()) {
            return Vector3D(0.0f, 0.0f, 0.0f);
        }
        return input.movementDirection.normalized();
    }

    Vector3D getLookDirection() const {
        if (!hasLookInput()) {
            return Vector3D(0.0f, 0.0f, 1.0f); // Default forward
        }
        return input.lookDirection.normalized();
    }

    // Get effective movement speed (base * modifiers)
    float getEffectiveSpeed() const {
        float speed = movementSpeed;

        if (isSprinting) {
            speed *= sprintMultiplier;
        } else if (isCrouching) {
            speed *= crouchMultiplier;
        }

        return speed;
    }

    // State queries
    bool isIdle() const { return state == CharacterState::Idle; }
    bool isMoving() const { return state == CharacterState::Moving; }
    bool isAttacking() const { return state == CharacterState::Attacking; }
    bool isStunned() const { return state == CharacterState::Stunned; }
    bool isDead() const { return state == CharacterState::Dead; }

    void setState(CharacterState newState) {
        state = newState;
    }

    // Enable/disable capabilities
    void disableMovement() { canMove = false; }
    void enableMovement() { canMove = true; }

    void disableJump() { canJump = false; }
    void enableJump() { canJump = true; }

    void disableRotation() { canRotate = false; }
    void enableRotation() { canRotate = true; }

    // Static factory methods
    static CharacterController createDefault() {
        return CharacterController();
    }

    static CharacterController createFast() {
        CharacterController controller;
        controller.movementSpeed = GameConfig::CHARACTER_MOVE_SPEED * 1.5f;
        controller.jumpVelocity = GameConfig::JUMP_VELOCITY * 1.2f;
        return controller;
    }

    static CharacterController createSlow() {
        CharacterController controller;
        controller.movementSpeed = GameConfig::CHARACTER_MOVE_SPEED * 0.7f;
        controller.jumpVelocity = GameConfig::JUMP_VELOCITY * 0.8f;
        return controller;
    }

    static CharacterController createAI() {
        CharacterController controller;
        controller.canJump = false;  // AI doesn't jump by default
        controller.airControlFactor = 0.0f;
        return controller;
    }
};

} // namespace Components
} // namespace ArenaGame
