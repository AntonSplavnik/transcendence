#pragma once

#include "System.hpp"
#include "../components/Transform.hpp"
#include "../components/PhysicsBody.hpp"
#include "../components/CharacterController.hpp"
#include "../components/Stamina.hpp"
#include "../GameTypes.hpp"
#include "../../entt/entt.hpp"

namespace ArenaGame {

// =============================================================================
// CharacterControllerSystem - Processes character input and movement
// =============================================================================
// Handles player input and translates it into physics velocity
// - Reads CharacterController component for input
// - Updates PhysicsBody velocity based on movement input
// - Handles jumping, sprinting, and movement states
//
// Should run in earlyUpdate phase (before physics)
// =============================================================================

class CharacterControllerSystem : public System {
public:
	CharacterControllerSystem() = default;

	// System interface
	void earlyUpdate(float deltaTime) override;
	const char* getName() const override { return "CharacterControllerSystem"; }
	bool needsEarlyUpdate() const override { return true; }

private:
	void processCharacterMovement(
		Components::CharacterController& controller,
		Components::PhysicsBody& physics,
		Components::Transform& transform,
		Components::Stamina& stamina,
		float deltaTime
	);
};

// =============================================================================
// Implementation
// =============================================================================

inline void CharacterControllerSystem::earlyUpdate(float deltaTime) {
	// View: iterate entities with CharacterController, PhysicsBody, and Transform
	auto view = m_registry->view<
		Components::CharacterController,
		Components::PhysicsBody,
		Components::Transform,
		Components::Stamina
	>();

	view.each([&](Components::CharacterController& controller,
		Components::PhysicsBody& physics,
		Components::Transform& transform,
		Components::Stamina& stamina) {
		processCharacterMovement(controller, physics, transform, stamina, deltaTime);
		});
}

inline void CharacterControllerSystem::processCharacterMovement(
	Components::CharacterController& controller,
	Components::PhysicsBody& physics,
	Components::Transform& transform,
	Components::Stamina& stamina,
	float deltaTime
) {
	// Skip if movement is disabled or dead
	if (!controller.canMove || controller.isDead()) {
		return;
	}

	// Sprint gating: require stamina and not exhausted.
	if (controller.input.isSprinting && !stamina.isExhausted()) {
		float frameCost = stamina.sprintCostPerSec * deltaTime;
		if (stamina.canAfford(frameCost)) {
			stamina.consume(frameCost);
			controller.isSprinting = true;
		} else {
			// Force exhaustion so drainDelayTimer pauses regen — otherwise
			// the regen floor causes state to flicker Sprinting/Walking.
			stamina.current = 0.0f;
			stamina.exhausted = true;
			stamina.drainDelayTimer = stamina.drainDelay;
			controller.isSprinting = false;
		}
	} else {
		controller.isSprinting = false;
	}

	// Get movement input
	Vector3D moveDir = controller.getMovementDirection();
	float speed = controller.getEffectiveSpeed() * controller.activeMovementMultiplier;

	// Apply movement to horizontal velocity
	if (controller.hasMovementInput()) {
		// On ground: full control
		if (physics.isGrounded) {
			physics.velocity.x = moveDir.x * speed;
			physics.velocity.z = moveDir.z * speed;
		}
		// In air: limited control
		else {
			float airControl = controller.airControlFactor;
			physics.velocity.x += moveDir.x * speed * airControl * deltaTime;
			physics.velocity.z += moveDir.z * speed * airControl * deltaTime;
		}

		// Update state
		controller.setState(controller.isSprinting
			? CharacterState::Sprinting
			: CharacterState::Walking);
	} else {
		// No input - stop horizontal movement
		if (physics.isGrounded) {
			physics.velocity.x = 0.0f;
			physics.velocity.z = 0.0f;
			controller.setState(CharacterState::Idle);
		}
		// In air: keep momentum (can't stop mid-air without input)
	}

	// Handle jumping
	if (controller.input.isJumping && controller.canJump && physics.isGrounded
			&& stamina.canAfford(stamina.jumpCost)) {
		stamina.consume(stamina.jumpCost);
		physics.velocity.y = controller.jumpVelocity;
		// Keep state as Moving (no Jumping state in enum)
	}

	// Update rotation based on look direction (if enabled)
	if (controller.canRotate && controller.hasLookInput()) {
		Vector3D lookDir = controller.getLookDirection();
		// Calculate yaw from look direction
		float yaw = std::atan2(lookDir.x, lookDir.z);
		transform.setRotation(0.0f, yaw, 0.0f);
	}

	// Handle stunned/dead states (set by combat system)
	if (controller.isStunned() || controller.isDead()) {
		// Disable movement when stunned or dead
		physics.velocity.x = 0.0f;
		physics.velocity.z = 0.0f;
	}
}

} // namespace ArenaGame
