import { CreateAudioEngineAsync } from '@babylonjs/core/AudioV2/webAudio/webAudioEngine';
import type { AudioEngineV2, AudioBus, MainAudioBus } from '@babylonjs/core/AudioV2';
import type { Node } from '@babylonjs/core/node';

export type BusName = 'sfx' | 'music' | 'music_ingame' | 'ambient' | 'ui';

export class GameAudioEngine {
	private engine: AudioEngineV2 | null = null;
	private masterBus: MainAudioBus | null = null;
	private buses = new Map<BusName, AudioBus>();
	private initialized = false;

	async initialize(): Promise<void> {
		if (this.initialized) return;

		this.engine = await CreateAudioEngineAsync({
			listenerEnabled: true,
		});

		this.masterBus = await this.engine.createMainBusAsync('master');

		const sfxBus = await this.engine.createBusAsync('sfx', {
			outBus: this.masterBus,
			volume: 1.2,
		});
		const musicBus = await this.engine.createBusAsync('music', {
			outBus: this.masterBus,
			volume: 0.5,
		});
		const inGameMusicBus = await this.engine.createBusAsync('music_ingame', {
			outBus: this.masterBus,
			volume: 1.0,
		});
		const ambientBus = await this.engine.createBusAsync('ambient', {
			outBus: this.masterBus,
			volume: 1.0,
		});
		const uiBus = await this.engine.createBusAsync('ui', {
			outBus: this.masterBus,
			volume: 0.7,
		});

		this.buses.set('sfx', sfxBus);
		this.buses.set('music', musicBus);
		this.buses.set('music_ingame', inGameMusicBus);
		this.buses.set('ambient', ambientBus);
		this.buses.set('ui', uiBus);

		this.initialized = true;
	}

	getEngine(): AudioEngineV2 {
		if (!this.engine) throw new Error('GameAudioEngine not initialized');
		return this.engine;
	}

	getBus(name: BusName): AudioBus {
		const bus = this.buses.get(name);
		if (!bus) {
			console.warn(`[GameAudioEngine] Unknown bus "${name}", falling back to "sfx"`);
			return this.buses.get('sfx')!;
		}
		return bus;
	}

	attachListener(camera: Node): void {
		if (this.engine) {
			this.engine.listener.attach(camera);
		}
	}

	/** Set the master bus volume (0 silences everything downstream). */
	setMasterVolume(volume: number): void {
		if (this.masterBus) this.masterBus.volume = volume;
	}

	isInitialized(): boolean {
		return this.initialized;
	}

	dispose(): void {
		if (this.engine) {
			this.engine.dispose();
			this.engine = null;
			this.masterBus = null;
			this.buses.clear();
			this.initialized = false;
		}
	}
}
