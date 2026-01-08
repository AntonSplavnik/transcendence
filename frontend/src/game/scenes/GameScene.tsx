import { useEffect, useRef, useState } from 'react'
import { Engine, Scene, FreeCamera, Vector3, HemisphericLight, Color3 } from '@babylonjs/core'
import { Player } from '../entities/Player'
import { Enemy } from '../entities/Enemy'
import { MapGenerator } from '../world/MapGenerator'
import PerkChoice from '../components/PerkChoice'
import { WeaponHUD } from '../components/WeaponHUD'
import type { Perk } from '../systems/PerkSystem'
import { initGameSounds } from '../audio/SoundManager'

interface GameSceneProps {
  onLeave?: (kills: number) => void
}

function GameScene({ onLeave }: GameSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<Engine | null>(null)
  const sceneRef = useRef<Scene | null>(null)
  const playerRef = useRef<Player | null>(null)
  
  // State pour afficher l'XP dans le HUD
  const [playerXP, setPlayerXP] = useState(0)
  const [playerLevel, setPlayerLevel] = useState(1)
  const [totalDamage, setTotalDamage] = useState(0)
  const [currentLevelXP, setCurrentLevelXP] = useState(0)
  const [nextLevelXP, setNextLevelXP] = useState(0)
  const [attackDamage, setAttackDamage] = useState(10)
  const [maxLife, setMaxLife] = useState(100)
  const [life, setLife] = useState(100)
  const [attackSpeed, setAttackSpeed] = useState(1.0)
  const [playerSpeed, setPlayerSpeed] = useState<number>(0.08)
  
  // State pour le panneau technique
  const [techPanelOpen, setTechPanelOpen] = useState(false)
  const [monstersKilled, setMonstersKilled] = useState(0)
  
  // State pour le choix de perks
  const [availablePerks, setAvailablePerks] = useState<Perk[] | null>(null)

  // State pour les armes équipées
  const [equippedWeapons, setEquippedWeapons] = useState<Array<{ name: string; icon: string }>>([])

  // State pour le Game Over
  const [isGameOver, setIsGameOver] = useState(false)
  const [gameStartTime, setGameStartTime] = useState<number>(0)
  const [gameEndTime, setGameEndTime] = useState<number>(0)

  useEffect(() => {
    if (!canvasRef.current) return

    setGameStartTime(Date.now())
    initGameSounds();

    // Create Babylon engine and scene
    const engine = new Engine(canvasRef.current, true)
    engineRef.current = engine

    const scene = new Scene(engine)
    sceneRef.current = scene

    // Désactiver le système de lumière par défaut pour un éclairage complètement uniforme
    const light = new HemisphericLight('light', new Vector3(0, 1, 0), scene)
    light.intensity = 1.0
    light.groundColor = new Color3(1, 1, 1) // Même couleur en haut et en bas = pas de gradient
    light.specular = new Color3(0, 0, 0) // Désactiver les reflets spéculaires

    // Generate map (ground + grid + walls)
    const mapGenerator = new MapGenerator(scene)
    mapGenerator.generateMap()

    // Create player at a random walkable position
    const playerSpawn = mapGenerator.getRandomWalkablePosition()
    const player = new Player(scene, playerSpawn.x, playerSpawn.y)
    playerRef.current = player

    // Configurer le callback pour le choix de perks
    player.onPerkChoiceReady = (perks: Perk[]) => {
      // Si le tableau est vide, fermer l'UI
      if (perks.length === 0) {
        setAvailablePerks(null)
      } else {
        setAvailablePerks(perks)
      }
    }

    // Camera setup (follows player with offset)
    const cameraOffsetY = 20
    const cameraOffsetZ = -10
    const camera = new FreeCamera('camera', new Vector3(0, cameraOffsetY, cameraOffsetZ), scene)
    camera.setTarget(player.getPosition())
    camera.attachControl(canvasRef.current, true)

    // Spawn enemies at random walkable positions
    const enemies: Enemy[] = []
    for (let i = 0; i < 5; i++) {
      const spawnPos = mapGenerator.getRandomWalkablePosition()
      enemies.push(new Enemy(scene, spawnPos.x, spawnPos.y))
    }

    // Wave spawning system
    let waveNumber = 1
    let lastWaveTime = Date.now()
    const WAVE_INTERVAL = 10000 // 10 secondes
    const MAX_MONSTERS_ON_MAP = 200 // Limite de monstres sur la map

    // Fonction pour calculer le nombre de monstres en fonction de la wave et du niveau
    const calculateMonsterCount = (wave: number, playerLevel: number): number => {
      const baseMonsters = 5
      const waveScaling = Math.floor(wave * 1.5) // Croissance modérée par wave
      const levelScaling = Math.floor(playerLevel * 0.8) // Croissance modérée par niveau
      const exponentialBonus = Math.floor(Math.pow(wave / 10, 1.3)) // Bonus exponentiel léger
      
      return baseMonsters + waveScaling + levelScaling + exponentialBonus
    }

    const spawnWave = () => {
      const monsterCount = calculateMonsterCount(waveNumber, player.getLevel())
      console.log(`🌊 Wave ${waveNumber} spawning ${monsterCount} monsters! (Player Level: ${player.getLevel()})`)
      
      for (let i = 0; i < monsterCount; i++) {
        // Spawn à une position aléatoire walkable
        const spawnPos = mapGenerator.getRandomWalkablePosition()
        enemies.push(new Enemy(scene, spawnPos.x, spawnPos.y))
      }

      waveNumber++
    }

    // Input handling
    const inputState: { [key: string]: boolean } = {}
    const keyDown = (e: KeyboardEvent) => { inputState[e.key.toLowerCase()] = true }
    const keyUp = (e: KeyboardEvent) => { inputState[e.key.toLowerCase()] = false }
    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)

    // Game loop
    engine.runRenderLoop(() => {
      // Check if it's time to spawn a new wave
      const currentTime = Date.now()
      if (currentTime - lastWaveTime >= WAVE_INTERVAL) {
        // Vérifier qu'on ne dépasse pas la limite de monstres
        if (enemies.length < MAX_MONSTERS_ON_MAP) {
          spawnWave()
          lastWaveTime = currentTime
        } else {
          console.log(`⚠️ Wave ${waveNumber} retardée: trop de monstres sur la map (${enemies.length}/${MAX_MONSTERS_ON_MAP})`)
          // On remet le timer pour réessayer dans 2 secondes
          lastWaveTime = currentTime - WAVE_INTERVAL + 2000
        }
      }

      // Calculate deltaTime for smooth updates
      const deltaTime = scene.getEngine().getDeltaTime()

      // Update player (movement avec collision de murs)
      player.move(inputState, mapGenerator)
      
      // Update player (armes, animations, cooldowns)
      // Passer les ennemis pour les armes qui en ont besoin (comme OrbWeapon)
      player.update(deltaTime, enemies)

      // Player auto-attack avec toutes les armes
      const hitEnemies = player.autoAttack(enemies)
      
      // Deal damage to hit enemies
      hitEnemies.forEach(enemy => {
        const damage = player.getAttackDamage()
        const isDead = enemy.takeDamage(damage)
        
        // Incrémenter les dégâts totaux
        player.addDamage(damage)
        
        if (isDead) {
          // Gain XP for killing enemy
          player.gainXP(10)
          
          // Increment monster kill counter
          setMonstersKilled(prev => prev + 1)
          
          // Remove dead enemy
          const index = enemies.indexOf(enemy)
          if (index > -1) {
            enemies.splice(index, 1)
            enemy.dispose()
          }
        }
      })

      // Update enemies (AI with wall collision)
      enemies.forEach(enemy => {
        enemy.update(player.getPosition(), mapGenerator, enemies)
        
        // Les ennemis attaquent le joueur au corps à corps
        enemy.tryAttackPlayer(player.getPosition(), (damage) => {
          const isDead = player.takeDamage(damage)
          if (isDead) {
            console.log('💀 Le joueur est mort!')
            setIsGameOver(true)
            setGameEndTime(Date.now())
            engine.stopRenderLoop() // Arrêter le jeu
          }
        })
      })

      // Update fountains (vérifier si le joueur est dessus)
      const playerGridPos = player.getGridPosition()
      mapGenerator.fountains.forEach(fountain => {
        const isOnFountain = fountain.checkPlayerProximity(playerGridPos)
        
        if (isOnFountain && fountain.hasCharge) {
          // Le joueur est sur la fontaine
          if (!fountain.isActivating) {
            fountain.startActivation()
          }
          
          // Mettre à jour l'activation
          const { completed } = fountain.update()
          if (completed) {
            // Soigner le joueur complètement
            player.fullHeal()
          }
        } else if (fountain.isActivating) {
          // Le joueur a quitté la fontaine
          fountain.cancelActivation()
        }
      })

      // Update chests (vérifier si le joueur est dessus)
      mapGenerator.chests.forEach(chest => {
        if (chest.isOpened()) return // Ignorer les coffres déjà ouverts
        
        const isOnChest = chest.checkPlayerProximity(playerGridPos)
        
        if (isOnChest) {
          // Le joueur est sur le coffre
          if (!chest.isActivating) {
            chest.startActivation()
          }
          
          // Mettre à jour l'activation
          const { completed, weaponDrop } = chest.update()
          if (completed && weaponDrop) {
            // Donner l'arme au joueur
            player.equipWeapon(weaponDrop)
          }
        } else if (chest.isActivating) {
          // Le joueur a quitté le coffre
          chest.cancelActivation()
        }
      })

      // Update camera to follow player
      camera.position.x = player.getPosition().x
      camera.position.y = player.getPosition().y + cameraOffsetY
      camera.position.z = player.getPosition().z + cameraOffsetZ
      camera.setTarget(player.getPosition())

      // Update HUD stats
      setPlayerXP(player.getXP())
      setPlayerLevel(player.getLevel())
      setTotalDamage(player.getTotalDamage())
      setCurrentLevelXP(player.getCurrentLevelXP())
      setNextLevelXP(player.getNextLevelXP())
      setAttackDamage(player.getAttackDamage())
      setMaxLife(player.getMaxLife())
      setLife(player.getLife())
      setAttackSpeed(player.getAttackSpeed())
  setPlayerSpeed(player.speed)
      setEquippedWeapons(player.getEquippedWeapons())

      scene.render()
    })

    // Cleanup
    return () => {
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('keyup', keyUp)
      player.dispose()
      enemies.forEach(enemy => enemy.dispose())
      mapGenerator.dispose()
      // lightingSystem.dispose() // Désactivé
      scene.dispose()
      engine.dispose()
    }
  }, [])

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
      
      {/* Menu de choix de perks (affiché lors d'un level-up) */}
      {availablePerks && (
        <PerkChoice
          perks={availablePerks}
          onSelectPerk={(perk) => {
            // Appliquer le perk au joueur
            if (playerRef.current) {
              playerRef.current.applyPerk(perk)
            }
            // NE PAS mettre null ici - applyPerk() gère l'affichage du prochain
            // setAvailablePerks(null)
          }}
        />
      )}
      
      {/* HUD des armes équipées */}
      <WeaponHUD weapons={equippedWeapons} maxWeapons={3} />
      
      {/* HUD gauche (stats principales) */}
      <div style={{ 
        position: 'absolute', 
        top: 10, 
        left: 10, 
        color: 'white', 
        background: 'rgba(0,0,0,0.7)', 
        padding: '15px', 
        borderRadius: '8px',
        fontFamily: 'monospace'
      }}>
        <div style={{ color: '#ff4444' }}>LIFE: {life} / {maxLife}</div>
        <div style={{ color: '#4488ff' }}>XP: {playerXP - currentLevelXP} / {nextLevelXP - currentLevelXP}</div>
        <div style={{ color: '#ffcc00' }}>LEVEL: {playerLevel}</div>
        <div style={{ fontSize: '0.85em', marginTop: '10px', opacity: 0.8, color: 'white' }}>
          <div>Auto-attack: 1s</div>
          <div>Waves: 10s</div>
        </div>
      </div>

      {/* Bouton pour ouvrir/fermer le panneau technique */}
      <div
        onClick={() => setTechPanelOpen(!techPanelOpen)}
        style={{
          position: 'absolute',
          top: 10,
          right: 10,
          width: '240px',
          background: 'rgba(0,0,0,0.85)',
          color: '#00ff00',
          padding: '12px 15px',
          borderRadius: '8px',
          fontFamily: 'monospace',
          fontSize: '14px',
          border: '2px solid rgba(0,255,0,0.3)',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          userSelect: 'none'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(0,0,0,0.95)'
          e.currentTarget.style.borderColor = 'rgba(0,255,0,0.6)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'rgba(0,0,0,0.85)'
          e.currentTarget.style.borderColor = 'rgba(0,255,0,0.3)'
        }}
      >
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          fontWeight: 'bold'
        }}>
          <span>📊 Technical Data</span>
          <span style={{ fontSize: '12px', opacity: 0.7 }}>
            {techPanelOpen ? '▲' : '▼'}
          </span>
        </div>

        {/* Contenu du panneau (visible seulement si ouvert) */}
        {techPanelOpen && (
          <div style={{
            marginTop: '12px',
            paddingTop: '12px',
            borderTop: '1px solid rgba(0,255,0,0.3)',
            animation: 'slideDown 0.3s ease'
          }}>
            {/* Section PLAYER DATA */}
            <div style={{ marginBottom: '15px' }}>
              <div style={{ 
                fontSize: '12px', 
                fontWeight: 'bold', 
                color: '#00ff00',
                marginBottom: '8px',
                letterSpacing: '1px'
              }}>
                PLAYER DATA
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Attack damage:</span>
                  <span style={{ color: '#ff8844', fontWeight: 'bold' }}>{attackDamage}</span>
                </div>
                
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Attack speed:</span>
                  <span style={{ color: '#44ff88', fontWeight: 'bold' }}>{attackSpeed.toFixed(1)}x</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Move speed:</span>
                  <span style={{ color: '#88ff44', fontWeight: 'bold' }}>{playerSpeed.toFixed(2)}</span>
                </div>
                
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Max life:</span>
                  <span style={{ color: '#ff4488', fontWeight: 'bold' }}>{maxLife}</span>
                </div>
              </div>
            </div>

            {/* Ligne de séparation */}
            <div style={{ 
              borderTop: '1px solid rgba(0,255,0,0.3)',
              marginBottom: '12px'
            }}></div>

            {/* Section RUN STATISTICS */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Monsters killed:</span>
                <span style={{ color: '#ff4444', fontWeight: 'bold' }}>{monstersKilled}</span>
              </div>
              
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Total damage:</span>
                <span style={{ color: '#ffaa44', fontWeight: 'bold' }}>{totalDamage}</span>
              </div>
              
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Total XP earned:</span>
                <span style={{ color: '#44aaff', fontWeight: 'bold' }}>{playerXP}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Écran de Game Over */}
      {isGameOver && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          backgroundColor: 'rgba(0, 0, 0, 0.85)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000,
          animation: 'fadeIn 0.5s ease'
        }}>
          <div style={{
            backgroundColor: 'rgba(20, 20, 20, 0.95)',
            border: '3px solid #ff4444',
            borderRadius: '15px',
            padding: '40px',
            maxWidth: '500px',
            width: '90%',
            fontFamily: 'monospace',
            color: 'white',
            boxShadow: '0 0 30px rgba(255, 68, 68, 0.5)',
            animation: 'slideIn 0.5s ease'
          }}>
            {/* Titre */}
            <h1 style={{
              textAlign: 'center',
              color: '#ff4444',
              fontSize: '48px',
              margin: '0 0 30px 0',
              textShadow: '0 0 10px rgba(255, 68, 68, 0.8)',
              letterSpacing: '3px'
            }}>
              GAME OVER
            </h1>

            {/* Statistiques de la partie */}
            <div style={{
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              padding: '20px',
              borderRadius: '10px',
              marginBottom: '30px',
              border: '1px solid rgba(0, 255, 0, 0.3)'
            }}>
              <h2 style={{
                color: '#00ff00',
                fontSize: '20px',
                marginTop: 0,
                marginBottom: '20px',
                textAlign: 'center',
                letterSpacing: '2px'
              }}>
                RUN STATISTICS
              </h2>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '16px' }}>
                  <span>⏱️ Time survived:</span>
                  <span style={{ color: '#44aaff', fontWeight: 'bold' }}>
                    {(() => {
                      const duration = Math.floor((gameEndTime - gameStartTime) / 1000)
                      const minutes = Math.floor(duration / 60)
                      const seconds = duration % 60
                      return `${minutes}:${seconds.toString().padStart(2, '0')}`
                    })()}
                  </span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '16px' }}>
                  <span>⚔️ Monsters killed:</span>
                  <span style={{ color: '#ff4444', fontWeight: 'bold' }}>{monstersKilled}</span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '16px' }}>
                  <span>💥 Total damage:</span>
                  <span style={{ color: '#ffaa44', fontWeight: 'bold' }}>{totalDamage}</span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '16px' }}>
                  <span>⭐ Level reached:</span>
                  <span style={{ color: '#ffcc00', fontWeight: 'bold' }}>{playerLevel}</span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '16px' }}>
                  <span>💎 Total XP earned:</span>
                  <span style={{ color: '#4488ff', fontWeight: 'bold' }}>{playerXP}</span>
                </div>
              </div>
            </div>

            {/* Boutons */}
            <div style={{
              display: 'flex',
              gap: '15px',
              justifyContent: 'center'
            }}>
              <button
                onClick={() => window.location.reload()}
                style={{
                  backgroundColor: '#00aa00',
                  color: 'white',
                  border: '2px solid #00ff00',
                  padding: '15px 30px',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontFamily: 'monospace',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  boxShadow: '0 0 10px rgba(0, 255, 0, 0.3)'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#00ff00'
                  e.currentTarget.style.transform = 'scale(1.05)'
                  e.currentTarget.style.boxShadow = '0 0 20px rgba(0, 255, 0, 0.6)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#00aa00'
                  e.currentTarget.style.transform = 'scale(1)'
                  e.currentTarget.style.boxShadow = '0 0 10px rgba(0, 255, 0, 0.3)'
                }}
              >
                PLAY AGAIN
              </button>

              <button
                onClick={() => onLeave?.(monstersKilled)}
                style={{
                  backgroundColor: '#aa0000',
                  color: 'white',
                  border: '2px solid #ff4444',
                  padding: '15px 30px',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontFamily: 'monospace',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  boxShadow: '0 0 10px rgba(255, 68, 68, 0.3)'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#ff4444'
                  e.currentTarget.style.transform = 'scale(1.05)'
                  e.currentTarget.style.boxShadow = '0 0 20px rgba(255, 68, 68, 0.6)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#aa0000'
                  e.currentTarget.style.transform = 'scale(1)'
                  e.currentTarget.style.boxShadow = '0 0 10px rgba(255, 68, 68, 0.3)'
                }}
              >
                MAIN MENU
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default GameScene