import { Scene, Color3 } from '@babylonjs/core'
import { Weapon } from './Weapon'
import { Projectile } from './Projectile'
import type { Player } from '../entities/Player'
import type { Enemy } from '../entities/Enemy'
import { getSoundManager } from '../audio/SoundManager'

export class BowWeapon extends Weapon {
  private projectiles: Projectile[] = []
  private hitEnemiesThisFrame: Set<Enemy> = new Set()

  constructor(scene: Scene) {
    super(
      'Bow',
      '/assets/weapon_bow.png',
      {
        damage: 8, // Dégâts de base de l'arc (un peu moins que le melee car attaque à distance)
        attackSpeed: 1.5, // 50% plus rapide que l'attaque de base
        range: 5, // 5 cases de portée
        cooldown: 1000 // 1 seconde de base (sera réduit par attackSpeed)
      },
      scene
    )
  }

  attack(player: Player, enemies: Enemy[], currentTime: number): Enemy[] {
    if (!this.canAttack(currentTime)) {
      return []
    }

    // Trouver l'ennemi le plus proche dans la portée
    const playerPos = player.getGridPosition()
    let closestEnemy: Enemy | null = null
    let closestDistance = Infinity

    enemies.forEach(enemy => {
      const dx = enemy.gridPos.x - playerPos.x
      const dy = enemy.gridPos.y - playerPos.y
      const distance = Math.sqrt(dx * dx + dy * dy)
      
      // Si l'ennemi est dans la portée et plus proche que le précédent
      if (distance <= this.stats.range && distance < closestDistance && enemy.hp > 0) {
        closestDistance = distance
        closestEnemy = enemy
      }
    })

    // Si on a trouvé une cible, tirer une flèche
    if (closestEnemy) {
      this.lastAttackTime = currentTime
      const damage = this.calculateDamage(player)
      
      getSoundManager().play('arrow-shoot', 0.5);
      
      // Créer un projectile vers la cible
      const startPos = player.mesh.position.clone()
      const projectile = new Projectile(
        this.scene,
        startPos,
        closestEnemy,
        damage,
        new Color3(0.8, 0.6, 0.2) // Couleur dorée pour les flèches
      )
      
      this.projectiles.push(projectile)
    }

    return [] // Les dégâts seront appliqués quand le projectile touche
  }

  update(deltaTime: number, player?: Player, enemies?: Enemy[]): void {
    this.hitEnemiesThisFrame.clear()

    // Mettre à jour tous les projectiles
    this.projectiles = this.projectiles.filter(projectile => {
      const shouldRemove = projectile.update(deltaTime)
      
      // Si le projectile a touché sa cible
      const hitTarget = projectile.getHitTarget()
      if (hitTarget) {
        this.hitEnemiesThisFrame.add(hitTarget)
      }
      
      if (shouldRemove) {
        projectile.dispose()
        return false
      }
      return true
    })
  }

  // Récupérer les ennemis touchés ce frame pour appliquer les dégâts
  getHitEnemies(): Enemy[] {
    return Array.from(this.hitEnemiesThisFrame)
  }

  dispose(): void {
    this.projectiles.forEach(p => p.dispose())
    this.projectiles = []
  }
}
