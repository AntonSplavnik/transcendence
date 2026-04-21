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
	// Dead players must not move — zero velocity and bail out
	if (controller.isDead()) {
		physics.velocity.x = 0.0f;
		physics.velocity.z = 0.0f;
		return;
	}

	// Skip if movement is disabled (stunned, rooted cast, etc.). Zero
	// horizontal velocity so prior momentum doesn't carry the character
	// through the root — otherwise pressing a rooting skill while running
	// leaves the player sliding for the length of the cast.
	if (!controller.canMove) {
		physics.velocity.x = 0.0f;
		physics.velocity.z = 0.0f;
		return;
	}

	// Sprint gating: require movement input, stamina, and not exhausted.
	if (controller.input.isSprinting && controller.hasMovementInput() && !stamina.isExhausted()) {
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
	bool hasInput = controller.hasMovementInput();

	// Target horizontal velocity (zero if no input — we decelerate toward rest).
	float targetVx = hasInput ? moveDir.x * speed : 0.0f;
	float targetVz = hasInput ? moveDir.z * speed : 0.0f;

	// Apply movement to horizontal velocity
	if (physics.isGrounded) {
		// Smooth toward target using accel (input) or decel (no input).
		// This replaces the old instant velocity snap, which made 8-direction
		// keyboard input feel stiff: direction changes now curve, stops slide.
		float rate = hasInput ? controller.acceleration : controller.deceleration;
		float dvx = targetVx - physics.velocity.x;
		float dvz = targetVz - physics.velocity.z;
		float distSq = dvx * dvx + dvz * dvz;
		float maxStep = rate * deltaTime;
		if (distSq <= maxStep * maxStep) {
			physics.velocity.x = targetVx;
			physics.velocity.z = targetVz;
		} else {
			float inv = maxStep / std::sqrt(distSq);
			physics.velocity.x += dvx * inv;
			physics.velocity.z += dvz * inv;
		}
	} else if (hasInput) {
		// In air: limited additive control (unchanged — air feel is separate).
		float airControl = controller.airControlFactor;
		physics.velocity.x += moveDir.x * speed * airControl * deltaTime;
		physics.velocity.z += moveDir.z * speed * airControl * deltaTime;
	}
	// In air with no input: keep momentum.

	// Update movement state. While coasting to a stop, stay in Walking until
	// horizontal speed drops below a small threshold so animations don't pop
	// to Idle mid-slide.
	// CombatSystem owns the Casting state during channels/casts with
	// movementMultiplier > 0 (canMove stays true); don't stamp over it.
	if (controller.state == CharacterState::Casting) {
		// preserved
	} else if (hasInput) {
		controller.setState(controller.isSprinting
			? CharacterState::Sprinting
			: CharacterState::Walking);
	} else if (physics.isGrounded) {
		float horizSpeedSq = physics.velocity.x * physics.velocity.x
		                   + physics.velocity.z * physics.velocity.z;
		controller.setState(horizSpeedSq < 0.01f  // ~0.1 m/s
			? CharacterState::Idle
			: CharacterState::Walking);
	}

	// Handle jumping
	if (controller.input.isJumping && controller.canJump && physics.isGrounded
			&& stamina.canAfford(stamina.jumpCost)) {
		stamina.consume(stamina.jumpCost);
		physics.velocity.y = controller.jumpVelocity;
		// Keep state as Moving (no Jumping state in enum)
	}

	// Update rotation based on look direction (if enabled).
	// Smoothly step current yaw toward the target using rotationSpeed (rad/s),
	// taking the shortest arc around ±π. Instant setRotation used to make the
	// character's facing flip the moment the player changed keys — the single
	// biggest contributor to the "8-direction snap" feel.
	if (controller.canRotate && controller.hasLookInput()) {
		Vector3D lookDir = controller.getLookDirection();
		float targetYaw  = std::atan2(lookDir.x, lookDir.z);
		float currentYaw = transform.getYaw();

		// Shortest angular distance, wrapped to (-π, π].
		constexpr float kPi    = 3.14159265358979323846f;
		constexpr float kTwoPi = 2.0f * kPi;
		float diff = targetYaw - currentYaw;
		while (diff >  kPi) diff -= kTwoPi;
		while (diff < -kPi) diff += kTwoPi;

		float maxStep = controller.rotationSpeed * deltaTime;
		if (std::fabs(diff) <= maxStep) {
			transform.setYaw(targetYaw);
		} else {
			transform.setYaw(currentYaw + (diff > 0.0f ? maxStep : -maxStep));
		}
	}

	// Handle stunned state (set by combat system)
	if (controller.isStunned()) {
		physics.velocity.x = 0.0f;
		physics.velocity.z = 0.0f;
	}
}

} // namespace ArenaGame
