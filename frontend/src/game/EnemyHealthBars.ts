import type * as BabylonType from '@babylonjs/core';
import type { Observer, Scene, Vector3 } from '@babylonjs/core';
import type { AdvancedDynamicTexture, Rectangle } from '@babylonjs/gui';
import { ENEMY_BAR_Y_OFFSET } from './constants';

declare const BABYLON: typeof BabylonType & { GUI: typeof import('@babylonjs/gui') };

export class EnemyHealthBars {
	private gui: AdvancedDynamicTexture | null = null;
	private scene: Scene;
	private enemyBars: Map<number, { bg: Rectangle; fill: Rectangle; positioned: boolean }> =
		new Map();
	private getCharPosition: (id: number) => Vector3 | null;
	private enemyBarObserver: Observer<Scene> | null = null;
	private localPlayerID: number;

	constructor(
		scene: Scene,
		localPlayerID: number,
		getCharPosition: (playerId: number) => Vector3 | null,
	) {
		this.scene = scene;
		this.localPlayerID = localPlayerID;
		this.getCharPosition = getCharPosition;

		const GUI = BABYLON.GUI;
		this.gui = GUI.AdvancedDynamicTexture.CreateFullscreenUI('HUD', true, this.scene);

		const dpr = window.devicePixelRatio || 1;
		if (dpr > 1) {
			this.gui.renderScale = 1 / dpr;
		}

		this.enemyBarObserver = this.scene.onBeforeRenderObservable.add(() => {
			for (const [playerID, bar] of this.enemyBars.entries()) {
				const pos = this.getCharPosition(playerID);
				if (!pos) continue;
				bar.bg.moveToVector3(
					new BABYLON.Vector3(pos.x, pos.y + ENEMY_BAR_Y_OFFSET, pos.z),
					this.scene,
				);
				if (!bar.positioned) {
					bar.positioned = true;
					bar.bg.isVisible = true;
				}
			}
		});
	}

	createEnemyBar(playerId: number): void {
		if (playerId === this.localPlayerID) return;
		if (this.enemyBars.has(playerId)) return;
		if (!this.gui) return;
		const GUI = BABYLON.GUI;

		const bg = new GUI.Rectangle(`enemy-hp-bg-${playerId}`);
		bg.width = '54px';
		bg.height = '5px';
		bg.cornerRadius = 2;
		bg.color = 'transparent';
		bg.thickness = 0;
		bg.background = '#1a1a1a';
		bg.isPointerBlocker = false;
		bg.isVisible = false;
		this.gui.addControl(bg);

		const fill = new GUI.Rectangle(`enemy-hp-fill-${playerId}`);
		fill.width = '100%';
		fill.height = '100%';
		fill.cornerRadius = 0;
		fill.color = 'transparent';
		fill.thickness = 0;
		fill.background = '#c0392b';
		fill.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
		bg.addControl(fill);

		this.enemyBars.set(playerId, { bg, fill, positioned: false });
	}

	removeEnemyBar(playerId: number): void {
		const bar = this.enemyBars.get(playerId);
		if (bar) {
			bar.bg.dispose();
			this.enemyBars.delete(playerId);
		}
	}

	updateEnemyHealth(playerId: number, pct: number, isDead: boolean): void {
		const bar = this.enemyBars.get(playerId);
		if (bar) {
			bar.bg.isVisible = !isDead;
			if (!isDead) {
				bar.fill.width = `${(Math.max(0, Math.min(1, pct)) * 100).toFixed(1)}%`;
			}
		}
	}

	dispose(): void {
		if (this.enemyBarObserver) {
			this.scene.onBeforeRenderObservable.remove(this.enemyBarObserver);
			this.enemyBarObserver = null;
		}
		if (this.gui) {
			this.gui.dispose();
		}
	}
}
