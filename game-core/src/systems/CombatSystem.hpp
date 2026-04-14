#pragma once

#include "System.hpp"
#include "../components/Transform.hpp"
#include "../components/PhysicsBody.hpp"
#include "../components/Health.hpp"
#include "../components/Stamina.hpp"
#include "../components/CombatController.hpp"
#include "../components/CharacterController.hpp"
#include "../components/GameModeComponent.hpp"
#include "../components/MatchStatsComponent.hpp"
#include "../components/InternalEventsComponent.hpp"
#include "../components/NetworkEventsComponent.hpp"
#include "../components/PlayerInfo.hpp"
#include "../events/InternalEvents.hpp"
#include "../events/NetworkEvents.hpp"
#include "../GameTypes.hpp"
#include "../Skills.hpp"
#include "../Helpers.hpp"

#include "../../entt/entt.hpp"
#include <queue>
#include <variant>
#include <cstdlib>
#include <random>

namespace ArenaGame {

// =============================================================================
// CombatSystem - Server-side ECS combat system
// =============================================================================
// Attack chain + skills driven entirely from CharacterController input.
// Damage is calculated server-side from CombatController preset data.
//
// Update order per frame:
//   1. updateCooldowns(dt)   — advance swing / chain / skill timers
//   2. processInputAttacks() — read input, trigger attacks/skills, queue hits
//   3. processDamage()       — apply queued hits to Health components
//
// Normal attack chain
// ─────────────────────────────────────────────────────────────────────────────
//   input.isAttacking && canPerformAttack()
//     → startAttack()  (gates next input for stage.duration)
//     → hitAllInRange(ctx, stage.range, stage.damageMultiplier)
//     → advanceChain() (stage++ or wrap to 0 on last/no-window stage)
//
//   If player does not re-press within attackChain[prev].chainWindow,
//   updateTimers() resets chainStage → 0.
//
// Skills
// ─────────────────────────────────────────────────────────────────────────────
//   input.isUsingAbility1/2 && canUseAbility1/2()
//     → set skillN CastTimer/HitPending on CombatController
//     → tickSkillSlot() fires deferred hit when castTimer reaches zero
//     → executeSkill(def, ctx)  (dispatches over SkillVariant)
// =============================================================================


// Returns final damage: baseDamage × stageMultiplier × globalMultiplier ± crit.
// stageMultiplier comes from AttackStage::damageMultiplier or SkillDefinition::dmgMultiplier.
inline float calculateCombatDamage(const Components::CombatController& cc, float stageMultiplier) {
	float dmg = cc.baseDamage * stageMultiplier * cc.damageMultiplier;
	thread_local std::mt19937 rng{std::random_device{}()};
	std::uniform_real_distribution<float> dist(0.0f, 1.0f);
	bool isCrit = dist(rng) < cc.criticalChance;
	return isCrit ? dmg * cc.criticalMultiplier : dmg;
}

// =============================================================================
// SkillContext - bundle passed to every skill / hit handler
// =============================================================================
// Carries all attacker state needed for skill execution and hit detection.
// PhysicsBody is included for future dash-style skills.

class CombatSystem;  // forward

struct PendingHit {
	entt::entity attacker;
	entt::entity victim;
	float        damage;
};

struct SkillContext {
	entt::registry&                  registry;
	entt::entity                     attackerEntity;
	Components::Transform&           attackerTransform;
	Components::PhysicsBody&         attackerPhysics;    // for dash / knockback skills
	Components::CharacterController& characterCon;
	Components::CombatController&    combatCon;
	std::queue<PendingHit>&          pendingHits;        // output: damage to apply
};

// =============================================================================
// CombatSystem
// =============================================================================

class CombatSystem : public System {
public:
	CombatSystem() = default;

	void update(float deltaTime) override;
	const char* getName() const override { return "CombatSystem"; }

	struct Config {
		bool friendlyFire = false;
	};

	const Config& getConfig() const { return m_config; }
	void setConfig(const Config& config) { m_config = config; }

	void clear() {
		while (!m_pendingHits.empty()) m_pendingHits.pop();
	}

private:
	Config m_config;
	std::queue<PendingHit> m_pendingHits;
	float m_deltaTime = 0.0f;  // cached for sub-phase methods

	// ── Top-level phases (called from update) ────────────────────────────
	void processInputAttacks();
	void processDamage();
	void updateCooldowns(float deltaTime);

	// ── updateCooldowns sub-phases (per entity) ──────────────────────────
	bool tryCancelSwingByMovement(entt::entity entity,
	                              Components::CombatController& combat,
	                              Components::CharacterController& controller);
	void handleSwingEnd(entt::entity entity,
	                    Components::CombatController& combat,
	                    Components::CharacterController& controller,
	                    Components::Health& health, Components::Transform& trans,
	                    Components::PhysicsBody& physics);
	void tickSkillSlot(float& castTimer, bool& hitPending, float& cooldownTimer,
	                   const SkillDefinition& def, entt::entity entity,
	                   Components::CombatController& combat,
	                   Components::CharacterController& controller,
	                   Components::Health& health, Components::Transform& trans,
	                   Components::PhysicsBody& physics);

	// ── processInputAttacks helpers ──────────────────────────────────────
	void triggerSkill(Components::CombatController& comcon,
	                  Components::CharacterController& charcon,
	                  const SkillDefinition& def,
	                  float& castTimer, bool& hitPending,
	                  Components::NetworkEventsComponent* ne,
	                  entt::entity entity, uint8_t slot);

	void startChannel(Components::CombatController& comcon,
	                  Components::CharacterController& charcon,
	                  const SkillDefinition& def,
	                  bool& channeling, float& channelElapsed, float& tickTimer,
	                  Components::NetworkEventsComponent* ne,
	                  entt::entity entity, uint8_t slot);

	void tickChannelSlot(bool& channeling, float& channelElapsed, float& tickTimer,
	                     float& cooldownTimer,
	                     const SkillDefinition& def, bool isHeld,
	                     entt::entity entity,
	                     Components::CombatController& combat,
	                     Components::CharacterController& controller,
	                     Components::Health& health,
	                     Components::Transform& trans,
	                     Components::PhysicsBody& physics,
	                     Components::Stamina* stamina);

	// ── Hit detection ────────────────────────────────────────────────────
	void hitAllInRange(SkillContext& ctx, float range, float dmgMultiplier);
	void hitInArc(SkillContext& ctx, float range, float dmgMultiplier, float attackAngle);
	void executeSkill(const SkillDefinition& skill, SkillContext& ctx);

	// ── Utilities ────────────────────────────────────────────────────────
	PlayerID getPlayerID(entt::entity entity) const {
		auto* info = m_registry->try_get<Components::PlayerInfo>(entity);
		return info ? info->playerID : 0;
	}

	// Apply/remove movement lock from a skill's params.
	static void applySkillMovementLock(Components::CharacterController& c, const SkillVariant& params);
	static void removeSkillMovementLock(Components::CharacterController& c, const SkillVariant& params);
};

// =============================================================================
// Implementation
// =============================================================================

inline void CombatSystem::update(float deltaTime) {
	updateCooldowns(deltaTime);
	processInputAttacks();
	processDamage();
}

// ── Movement lock helpers ────────────────────────────────────────────────────

inline void CombatSystem::applySkillMovementLock(
		Components::CharacterController& c, const SkillVariant& params) {
	auto apply = [&](float mult) {
		if (mult == 0.0f)
			c.canMove = false;
		else if (mult < 1.0f)
			c.activeMovementMultiplier = mult;
	};
	std::visit(overloaded{
		[&](const MeleeAOE& s)       { apply(s.movementMultiplier); },
		[&](const ChanneledCone& s)  { apply(s.movementMultiplier); }
	}, params);
}

inline void CombatSystem::removeSkillMovementLock(
		Components::CharacterController& c, const SkillVariant& params) {
	auto remove = [&](float mult) {
		if (mult == 0.0f)
			c.canMove = true;
		else if (mult > 0.0f && mult < 1.0f)
			c.activeMovementMultiplier = 1.0f;
	};
	std::visit(overloaded{
		[&](const MeleeAOE& s)       { remove(s.movementMultiplier); },
		[&](const ChanneledCone& s)  { remove(s.movementMultiplier); }
	}, params);
}

// ── Input processing ─────────────────────────────────────────────────────────

inline void CombatSystem::triggerSkill(
		Components::CombatController& comcon,
		Components::CharacterController& charcon,
		const SkillDefinition& def,
		float& castTimer, bool& hitPending,
		Components::NetworkEventsComponent* ne,
		entt::entity entity, uint8_t slot) {
	castTimer  = def.castDuration;
	hitPending = true;
	charcon.setState(CharacterState::Casting);
	applySkillMovementLock(charcon, def.params);
	if (ne) ne->events.push_back(NetEvents::SkillUsedEvent{ getPlayerID(entity), slot });
}

inline void CombatSystem::startChannel(
		Components::CombatController& comcon,
		Components::CharacterController& charcon,
		const SkillDefinition& def,
		bool& channeling, float& channelElapsed, float& tickTimer,
		Components::NetworkEventsComponent* ne,
		entt::entity entity, uint8_t slot) {
	channeling     = true;
	channelElapsed = 0.0f;
	tickTimer      = 0.0f;
	charcon.setState(CharacterState::Casting);
	applySkillMovementLock(charcon, def.params);
	if (ne) ne->events.push_back(NetEvents::SkillUsedEvent{ getPlayerID(entity), slot });
}

// Returns true if the skill variant is a held/channeled type.
inline bool isChanneledSkill(const SkillDefinition& def) {
	return std::holds_alternative<ChanneledCone>(def.params);
}

inline void CombatSystem::processInputAttacks() {
	using namespace Components;

	auto* ne = m_registry->try_get<NetworkEventsComponent>(m_gameManager);

	auto view = m_registry->view<CharacterController, CombatController, Health, Transform, PhysicsBody, Stamina>();

	view.each([&](entt::entity entity,
				  CharacterController& charcon,
				  CombatController&    comcon,
				  Health&              health,
				  Transform&           trans,
				  PhysicsBody&         physics,
				  Stamina&             stamina) {

		if (!health.isAlive()) return;

		// Buffer input while committed to an action. Last input wins (Skill2 > Skill1 > Attack).
		if (comcon.isAttacking || comcon.isAbility1Active() || comcon.isAbility2Active()) {
			if (charcon.input.isAttacking)      comcon.bufferedAction = CombatController::BufferedAction::Attack;
			if (charcon.input.isUsingAbility1)  comcon.bufferedAction = CombatController::BufferedAction::Skill1;
			if (charcon.input.isUsingAbility2)  comcon.bufferedAction = CombatController::BufferedAction::Skill2;
			return;
		}

		// Consume buffered action or live input.
		CombatController::BufferedAction toFire = comcon.bufferedAction;
		comcon.bufferedAction = CombatController::BufferedAction::None;

		// Discard buffered attack if chain is empty or stamina is insufficient
		if (toFire == CombatController::BufferedAction::Attack
				&& (comcon.attackChain.empty()
					|| !stamina.canAfford(comcon.currentStage().staminaCost)))
			toFire = CombatController::BufferedAction::None;
		if (toFire == CombatController::BufferedAction::Skill1
				&& !stamina.canAfford(comcon.ability1.staminaCost))
			toFire = CombatController::BufferedAction::None;
		if (toFire == CombatController::BufferedAction::Skill2
				&& !stamina.canAfford(comcon.ability2.staminaCost))
			toFire = CombatController::BufferedAction::None;

		const bool wantsAttack = charcon.input.isAttacking     || toFire == CombatController::BufferedAction::Attack;
		const bool wantsSkill1 = charcon.input.isUsingAbility1 || toFire == CombatController::BufferedAction::Skill1;
		const bool wantsSkill2 = charcon.input.isUsingAbility2 || toFire == CombatController::BufferedAction::Skill2;

		// Priority: Skill2 > Skill1 > Attack
		if (wantsSkill2 && comcon.canUseAbility2() && stamina.canAfford(comcon.ability2.staminaCost)) {
			if (isChanneledSkill(comcon.ability2)) {
				startChannel(comcon, charcon, comcon.ability2,
				             comcon.skill2Channeling, comcon.skill2ChannelElapsed,
				             comcon.skill2TickTimer, ne, entity, 2);
			} else {
				triggerSkill(comcon, charcon, comcon.ability2,
				             comcon.skill2CastTimer, comcon.skill2HitPending, ne, entity, 2);
			}

		} else if (wantsSkill1 && comcon.canUseAbility1() && stamina.canAfford(comcon.ability1.staminaCost)) {
			if (isChanneledSkill(comcon.ability1)) {
				startChannel(comcon, charcon, comcon.ability1,
				             comcon.skill1Channeling, comcon.skill1ChannelElapsed,
				             comcon.skill1TickTimer, ne, entity, 1);
			} else {
				triggerSkill(comcon, charcon, comcon.ability1,
				             comcon.skill1CastTimer, comcon.skill1HitPending, ne, entity, 1);
			}

		} else if (wantsAttack && comcon.canPerformAttack() && stamina.canAfford(comcon.currentStage().staminaCost)) {
			const AttackStage& stage = comcon.currentStage();
			uint8_t stageNum = static_cast<uint8_t>(comcon.chainStage);
			comcon.startAttack();
			comcon.hitPending = true;
			charcon.setState(CharacterState::Attacking);
			if (stage.movementMultiplier == 0.0f)
				charcon.canMove = false;
			if (ne) ne->events.push_back(NetEvents::AttackStartedEvent{ getPlayerID(entity), stageNum });
		}
	});
}

// ── Hit detection ────────────────────────────────────────────────────────────

inline void CombatSystem::hitAllInRange(SkillContext& ctx, float range, float dmgMultiplier) {
	auto targets = m_registry->view<Components::Transform, Components::Health>();

	targets.each([&](entt::entity target,
					 Components::Transform& targetTransform,
					 Components::Health&    targetHealth) {
		if (target == ctx.attackerEntity) return;
		if (!targetHealth.isAlive()) return;

		float dist = ctx.attackerTransform.position.distanceTo(targetTransform.position);
		if (dist > range) return;

		float dmg = calculateCombatDamage(ctx.combatCon, dmgMultiplier);
		ctx.pendingHits.push({ctx.attackerEntity, target, dmg});
	});
}

inline void CombatSystem::hitInArc(SkillContext& ctx, float range, float dmgMultiplier, float attackAngle) {
	auto targets = m_registry->view<Components::Transform, Components::Health>();
	Vector3D forward = ctx.attackerTransform.getForwardDirection();
	float cosAngle = std::cos(attackAngle);

	targets.each([&](entt::entity target,
					 Components::Transform& targetTransform,
					 Components::Health&    targetHealth) {
		if (target == ctx.attackerEntity) return;
		if (!targetHealth.isAlive()) return;

		float dist = ctx.attackerTransform.position.distanceTo(targetTransform.position);
		if (dist > range) return;

		Vector3D toTarget = (targetTransform.position - ctx.attackerTransform.position).normalized();
		if (forward.dot(toTarget) < cosAngle) return;

		float dmg = calculateCombatDamage(ctx.combatCon, dmgMultiplier);
		ctx.pendingHits.push({ctx.attackerEntity, target, dmg});
	});
}

inline void CombatSystem::executeSkill(const SkillDefinition& skill, SkillContext& ctx) {
	std::visit(overloaded {
		[&](const MeleeAOE& s) { hitAllInRange(ctx, s.range, s.dmgMultiplier); },
		// ChanneledCone is driven per-tick from tickChannelSlot, not via the
		// one-shot cast → executeSkill path. Nothing to do here.
		[&](const ChanneledCone&) { (void)ctx; }
	}, skill.params);
}

// ── Damage application ───────────────────────────────────────────────────────

inline void CombatSystem::processDamage() {
	auto* gmc   = m_registry->try_get<Components::GameModeComponent>(m_gameManager);
	auto* stats = m_registry->try_get<Components::MatchStatsComponent>(m_gameManager);
	auto* ie    = m_registry->try_get<Components::InternalEventsComponent>(m_gameManager);
	auto* ne    = m_registry->try_get<Components::NetworkEventsComponent>(m_gameManager);
	const bool trackStats = gmc && stats && gmc->matchStatus == MatchStatus::InProgress;

	while (!m_pendingHits.empty()) {
		PendingHit hit = m_pendingHits.front();
		m_pendingHits.pop();

		auto* health = m_registry->try_get<Components::Health>(hit.victim);
		if (!health || !health->isAlive()) continue;

		float hpBefore     = health->current;
		health->takeDamage(hit.damage, hit.attacker);
		float hpAfter      = health->current;
		float actualDamage = hpBefore - hpAfter;

		if (trackStats) {
			auto& aStats = stats->playerStats.try_emplace(hit.attacker).first->second;
			auto& vStats = stats->playerStats.try_emplace(hit.victim).first->second;
			aStats.damageDealt += actualDamage;
			vStats.damageTaken += actualDamage;

			if (ne && actualDamage > 0.0f)
				ne->events.push_back(NetEvents::DamageEvent{ getPlayerID(hit.attacker), getPlayerID(hit.victim), actualDamage });

			if (!health->isAlive()) {
				aStats.kills++;
				vStats.deaths++;
				if (ie) ie->events.push_back(Events::DeathEvent{ hit.attacker, hit.victim });
				if (ne) ne->events.push_back(NetEvents::DeathEvent{ getPlayerID(hit.attacker), getPlayerID(hit.victim) });
			}
		}

		if (!health->isAlive()) {
			if (auto* controller = m_registry->try_get<Components::CharacterController>(hit.victim)) {
				controller->setState(CharacterState::Dead);
				controller->canMove = false;
			}
			if (auto* physics = m_registry->try_get<Components::PhysicsBody>(hit.victim)) {
				physics->velocity.x = 0.0f;
				physics->velocity.z = 0.0f;
			}
		}
	}
}

// ── Timer updates (per-entity sub-phases) ────────────────────────────────────

inline bool CombatSystem::tryCancelSwingByMovement(
		entt::entity entity,
		Components::CombatController& combat,
		Components::CharacterController& controller) {
	if (!combat.isAttacking || !controller.hasMovementInput()) return false;

	combat.isAttacking = false;
	combat.swingTimer  = 0.0f;
	combat.hitPending  = false;
	if (!controller.isDead()) {
		controller.canMove = true;
		controller.restoreMovementState();
	}
	return true;
}

inline void CombatSystem::handleSwingEnd(
		entt::entity entity,
		Components::CombatController& combat,
		Components::CharacterController& controller,
		Components::Health& health,
		Components::Transform& trans,
		Components::PhysicsBody& physics) {
	if (!controller.isDead()) controller.canMove = true;

	if (combat.hitPending) {
		if (health.isAlive()) {
			SkillContext ctx{ *m_registry, entity, trans, physics, controller, combat, m_pendingHits };
			const AttackStage& stage = combat.currentStage();
			// Consume stamina for this swing stage (read BEFORE advanceChain)
			if (auto* stamina = m_registry->try_get<Components::Stamina>(entity))
				stamina->consume(stage.staminaCost);
			hitInArc(ctx, stage.range, stage.damageMultiplier, stage.attackAngle);
			combat.advanceChain();
		}
		combat.hitPending = false;
	}

	// Reset CharacterState unless player is re-triggering attack
	if (controller.state == CharacterState::Attacking && !controller.isDead()
			&& !controller.input.isAttacking) {
		controller.restoreMovementState();
	}
}

inline void CombatSystem::tickSkillSlot(
		float& castTimer, bool& hitPending, float& cooldownTimer,
		const SkillDefinition& def, entt::entity entity,
		Components::CombatController& combat,
		Components::CharacterController& controller,
		Components::Health& health,
		Components::Transform& trans,
		Components::PhysicsBody& physics) {
	if (castTimer <= 0.0f) return;

	castTimer -= m_deltaTime;
	if (castTimer > 0.0f) return;

	// Cast just finished
	castTimer     = 0.0f;
	cooldownTimer = def.cooldown;

	if (hitPending) {
		// Consume stamina when cast completes
		if (auto* stamina = m_registry->try_get<Components::Stamina>(entity))
			stamina->consume(def.staminaCost);
		if (health.isAlive()) {
			SkillContext ctx{ *m_registry, entity, trans, physics, controller, combat, m_pendingHits };
			executeSkill(def, ctx);
		}
		hitPending = false;
	}

	if (!controller.isDead()) {
		removeSkillMovementLock(controller, def.params);
		controller.restoreMovementState();
	}
}

inline void CombatSystem::tickChannelSlot(
		bool& channeling, float& channelElapsed, float& tickTimer,
		float& cooldownTimer,
		const SkillDefinition& def, bool isHeld,
		entt::entity entity,
		Components::CombatController& combat,
		Components::CharacterController& controller,
		Components::Health& health,
		Components::Transform& trans,
		Components::PhysicsBody& physics,
		Components::Stamina* stamina) {
	if (!channeling) return;

	const auto* channel = std::get_if<ChanneledCone>(&def.params);
	if (!channel) { channeling = false; return; }  // defensive

	// Drain stamina continuously
	if (stamina) stamina->consume(channel->staminaCostPerSec * m_deltaTime);

	channelElapsed += m_deltaTime;
	tickTimer      += m_deltaTime;

	// Fire damage ticks as often as the interval elapses.
	while (tickTimer >= channel->tickInterval && health.isAlive()) {
		tickTimer -= channel->tickInterval;
		SkillContext ctx{ *m_registry, entity, trans, physics, controller, combat, m_pendingHits };
		hitInArc(ctx, channel->range, channel->dmgPerTickMultiplier, channel->attackAngle);
	}

	// End conditions: released, stamina depleted, max duration, or death.
	const bool stamOut   = stamina && stamina->current <= 0.0f;
	const bool timedOut  = channelElapsed >= channel->maxDuration;
	const bool dead      = !health.isAlive();
	const bool shouldEnd = !isHeld || stamOut || timedOut || dead;

	if (!shouldEnd) return;

	channeling     = false;
	channelElapsed = 0.0f;
	tickTimer      = 0.0f;
	cooldownTimer  = def.cooldown;

	if (!controller.isDead()) {
		removeSkillMovementLock(controller, def.params);
		controller.restoreMovementState();
	}
}

inline void CombatSystem::updateCooldowns(float deltaTime) {
	using namespace Components;

	m_deltaTime = deltaTime;
	auto view = m_registry->view<CombatController, CharacterController, Health, Transform, PhysicsBody>();

	view.each([&](entt::entity entity, CombatController& combat, CharacterController& controller,
				  Health& health, Transform& trans, PhysicsBody& physics) {

		if (tryCancelSwingByMovement(entity, combat, controller)) return;

		const bool wasAttacking = combat.isAttacking;
		combat.updateTimers(deltaTime);

		if (wasAttacking && !combat.isAttacking)
			handleSwingEnd(entity, combat, controller, health, trans, physics);

		tickSkillSlot(combat.skill1CastTimer, combat.skill1HitPending, combat.skill1CooldownTimer,
		              combat.ability1, entity, combat, controller, health, trans, physics);
		tickSkillSlot(combat.skill2CastTimer, combat.skill2HitPending, combat.skill2CooldownTimer,
		              combat.ability2, entity, combat, controller, health, trans, physics);

		auto* stamina = m_registry->try_get<Stamina>(entity);
		// Slot 1 has no held input wired yet — channel never starts for it,
		// so isHeld=false is safe until a channeled skill1 is introduced.
		tickChannelSlot(combat.skill1Channeling, combat.skill1ChannelElapsed, combat.skill1TickTimer,
		                combat.skill1CooldownTimer, combat.ability1,
		                false,
		                entity, combat, controller, health, trans, physics, stamina);
		tickChannelSlot(combat.skill2Channeling, combat.skill2ChannelElapsed, combat.skill2TickTimer,
		                combat.skill2CooldownTimer, combat.ability2,
		                controller.input.isHoldingAbility2,
		                entity, combat, controller, health, trans, physics, stamina);
	});
}

} // namespace ArenaGame
