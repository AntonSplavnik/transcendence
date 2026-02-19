import type { SoundDefinition } from './SoundBank';

export const SOUND_DEFINITIONS: SoundDefinition[] = [
  {
    id: 'player_jump',
    variations: ['/sounds/sfx/jump_01.wav', '/sounds/sfx/jump_02.wav', '/sounds/sfx/jump_03.wav'],
    volume: { min: 0.7, max: 0.85 },
    pitch: { min: 0.95, max: 1.05 },
    bus: 'sfx',
    spatial: true,
    maxDistance: 50,
    refDistance: 5,
    cooldown: 100,
    priority: 5,
  },
  {
    id: 'player_land',
    variations: ['/sounds/sfx/land_01.wav', '/sounds/sfx/land_02.wav'],
    volume: { min: 0.3, max: 1.0 },
    pitch: { min: 0.9, max: 1.1 },
    bus: 'sfx',
    spatial: true,
    maxDistance: 50,
    refDistance: 5,
    cooldown: 50,
    priority: 6,
  },
];
