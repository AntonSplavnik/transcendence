#pragma once

#include "System.hpp"
#include "Components/Transform.hpp"
#include <cstdio>
#include "Components/PhysicsBody.hpp"
#include "Components/Health.hpp"
#include "Components/CombatController.hpp"
#include "Components/CharacterController.hpp"
#include "GameTypes.hpp"
#include "Skills.hpp"
#include <entt/entt.hpp>
#include <queue>
#include <variant>
#include <cstdio>
#include <cstdlib>

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
//     → executeSkill(skill, ctx)  (dispatches over SkillVariant)
//     → useAbility1/2()           (starts cooldown timer)
// =============================================================================

// Visitor helper for std::visit over SkillVariant
template<typename... Ts>
struct overloaded : Ts... {
    using Ts::operator()...;
};
template<typename... Ts>
overloaded(Ts...) -> overloaded<Ts...>;

// Returns final damage: baseDamage × stageMultiplier × globalMultiplier ± crit.
// stageMultiplier comes from AttackStage::damageMultiplier or SkillDefinition::dmgMultiplier.
inline float calculateCombatDamage(const Components::CombatController& cc, float stageMultiplier) {
    float dmg = cc.baseDamage * stageMultiplier * cc.damageMultiplier;
    bool isCrit = (static_cast<float>(std::rand()) / RAND_MAX) < cc.criticalChance;
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

    void processInputAttacks();
    void processDamage();
    void updateCooldowns(float deltaTime);

    // Queue hits for all living, in-range targets (excludes attacker). Full 360°.
    void hitAllInRange(SkillContext& ctx, float range, float dmgMultiplier);

    // Queue hits for targets within a frontal arc. attackAngle is the half-angle in radians.
    void hitInArc(SkillContext& ctx, float range, float dmgMultiplier, float attackAngle);

    // Dispatch skill execution via SkillVariant visitor.
    void executeSkill(SkillDefinition& skill, SkillContext& ctx);
};

// =============================================================================
// Implementation
// =============================================================================

inline void CombatSystem::update(float deltaTime) {
    updateCooldowns(deltaTime);
    processInputAttacks();
    processDamage();
}

inline void CombatSystem::processInputAttacks() {
    using namespace Components;

    auto view = m_registry->view<
        CharacterController,
        CombatController,
        Health,
        Transform,
        PhysicsBody
    >();

    view.each([&](entt::entity entity,
                  CharacterController& charcon,
                  CombatController&    comcon,
                  Health&              health,
                  Transform&           trans,
                  PhysicsBody&         physics) {

        if (!health.isAlive()) return;

        SkillContext ctx {
            *m_registry, entity,
            trans, physics, charcon, comcon, m_pendingHits
        };

        // ── Normal attack ─────────────────────────────────────────────────
        if (charcon.input.isAttacking && comcon.canPerformAttack()) {
            const AttackStage& stage = comcon.currentStage();

            fprintf(stderr, "[COMBAT] ATTACK  entity=%u  chain_stage=%d  range=%.1f  dmg_mul=%.2f  base_dmg=%.1f\n",
                static_cast<unsigned>(entity), comcon.chainStage,
                stage.range, stage.damageMultiplier, comcon.baseDamage);

            comcon.startAttack();
            charcon.setState(CharacterState::Attacking);

            if (stage.movementMultiplier == 0.0f) {
                charcon.canMove = false;
            }

            hitInArc(ctx, stage.range, stage.damageMultiplier, stage.attackAngle);
            comcon.advanceChain();

            fprintf(stderr, "[COMBAT]         next_chain_stage=%d\n", comcon.chainStage);
        }

        // ── Ability 1 ─────────────────────────────────────────────────────
        if (charcon.input.isUsingAbility1 && comcon.canUseAbility1()) {
            fprintf(stderr, "[COMBAT] ABILITY1 entity=%u  cd=%.2f\n",
                static_cast<unsigned>(entity), comcon.ability1.timer);
            executeSkill(comcon.ability1, ctx);
            comcon.useAbility1();
            charcon.setState(CharacterState::Casting);
        }

        // ── Ability 2 ─────────────────────────────────────────────────────
        if (charcon.input.isUsingAbility2 && comcon.canUseAbility2()) {
            fprintf(stderr, "[COMBAT] ABILITY2 entity=%u  cd=%.2f\n",
                static_cast<unsigned>(entity), comcon.ability2.timer);
            executeSkill(comcon.ability2, ctx);
            comcon.useAbility2();
            charcon.setState(CharacterState::Casting);
        }
    });
}

inline void CombatSystem::hitAllInRange(SkillContext& ctx, float range, float dmgMultiplier) {
    auto targets = m_registry->view<Components::Transform, Components::Health>();

    targets.each([&](entt::entity target,
                     Components::Transform& targetTransform,
                     Components::Health&    targetHealth) {
        if (target == ctx.attackerEntity) return;
        if (!targetHealth.isAlive()) return;

        float dist = ctx.attackerTransform.position.distanceTo(targetTransform.position);
        if (dist <= range) {
            float dmg = calculateCombatDamage(ctx.combatCon, dmgMultiplier);
            fprintf(stderr, "[COMBAT] HIT_QUEUED  attacker=%u  target=%u  dist=%.2f  raw_dmg=%.2f\n",
                static_cast<unsigned>(ctx.attackerEntity), static_cast<unsigned>(target),
                dist, dmg);
            ctx.pendingHits.push({ctx.attackerEntity, target, dmg});
        }
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
        fprintf(stderr, "[COMBAT] HIT_QUEUED  attacker=%u  target=%u  dist=%.2f  raw_dmg=%.2f\n",
            static_cast<unsigned>(ctx.attackerEntity), static_cast<unsigned>(target),
            dist, dmg);
        ctx.pendingHits.push({ctx.attackerEntity, target, dmg});
    });
}

inline void CombatSystem::executeSkill(SkillDefinition& skill, SkillContext& ctx) {
    std::visit(overloaded{
        [&](MeleeAOE& s) {
            hitAllInRange(ctx, s.range, s.dmgMultiplier);
        }
    }, skill.params);
}

inline void CombatSystem::processDamage() {
    while (!m_pendingHits.empty()) {
        PendingHit hit = m_pendingHits.front();
        m_pendingHits.pop();

        auto* health = m_registry->try_get<Components::Health>(hit.victim);
        if (!health || !health->isAlive()) continue;

        float hpBefore = health->current;
        health->takeDamage(hit.damage, hit.attacker);
        float hpAfter  = health->current;

        fprintf(stderr, "[COMBAT] attacker=%u  victim=%u  raw=%.2f  dealt=%.2f  hp: %.1f -> %.1f / %.1f%s\n",
            static_cast<unsigned>(hit.attacker),
            static_cast<unsigned>(hit.victim),
            hit.damage,
            hpBefore - hpAfter,
            hpBefore, hpAfter, health->maximum,
            health->isAlive() ? "" : "  DEAD");

        if (!health->isAlive()) {
            if (auto* controller = m_registry->try_get<Components::CharacterController>(hit.victim)) {
                controller->setState(CharacterState::Dead);
                controller->canMove = false;
            }
        }
    }
}

inline void CombatSystem::updateCooldowns(float deltaTime) {
    using namespace Components;

    auto view = m_registry->view<CombatController, CharacterController>();

    view.each([&](entt::entity, CombatController& combat, CharacterController& controller) {
        const bool wasAttacking = combat.isAttacking;
        combat.updateTimers(deltaTime);

        // Restore movement when swing ends
        if (wasAttacking && !combat.isAttacking) {
            controller.canMove = true;
        }

        // Reset CharacterState when swing ends and player is not re-triggering
        if (!combat.isAttacking && controller.state == CharacterState::Attacking) {
            if (!controller.input.isAttacking) {
                controller.setState(controller.hasMovementInput()
                    ? CharacterState::Moving
                    : CharacterState::Idle);
            }
        }
    });
}

} // namespace ArenaGame
