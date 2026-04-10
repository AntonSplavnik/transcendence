// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const BABYLON: any;

import type { Scene, Vector3 } from '@babylonjs/core';

export class GameHUD {
	private gui: any = null;
	private scene: Scene;
	private enemyBars: Map<number, { bg: any; fill: any }> = new Map();
	private localHealthFill: any = null;
	private cooldownBars: { attack: any; ability1: any; ability2: any };
	private getCharPosition: (id: number) => Vector3 | null;

	constructor(scene: Scene, getCharPosition: (playerId: number) => Vector3 | null) {
		this.scene = scene;
		this.getCharPosition = getCharPosition;

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const GUI = (BABYLON as any).GUI;
		this.gui = GUI.AdvancedDynamicTexture.CreateFullscreenUI('HUD', true, this.scene);

		// Update enemy bar positions every frame by projecting world-space position
		this.scene.onBeforeRenderObservable.add(() => {
			for (const [playerID, bar] of this.enemyBars.entries()) {
				const pos = this.getCharPosition(playerID);
				if (!pos) continue;
				bar.bg.moveToVector3(new BABYLON.Vector3(pos.x, pos.y + 2.4, pos.z), this.scene);
			}
		});

		// Local player health bar — bottom center
		const localBg = new GUI.Rectangle('local-hp-bg');
		localBg.width = '200px';
		localBg.height = '14px';
		localBg.cornerRadius = 3;
		localBg.color = '#00000099';
		localBg.thickness = 1;
		localBg.background = '#1a1a1a';
		localBg.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
		localBg.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
		localBg.top = '-28px';
		this.gui.addControl(localBg);

		const localFill = new GUI.Rectangle('local-hp-fill');
		localFill.width = '100%';
		localFill.height = '100%';
		localFill.cornerRadius = 0;
		localFill.color = 'transparent';
		localFill.thickness = 0;
		localFill.background = '#c0392b';
		localFill.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
		localBg.addControl(localFill);

		this.localHealthFill = localFill;

		// Cooldown bars — row below health bar
		const cdContainer = new GUI.StackPanel('cd-container');
		cdContainer.isVertical = false;
		cdContainer.height = '12px';
		cdContainer.width = '200px';
		cdContainer.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
		cdContainer.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
		cdContainer.top = '-10px';
		cdContainer.spacing = 4;
		this.gui.addControl(cdContainer);

		const makeCdBar = (name: string, color: string) => {
			const bg = new GUI.Rectangle(`cd-bg-${name}`);
			bg.width = '62px';
			bg.height = '10px';
			bg.cornerRadius = 2;
			bg.color = '#00000099';
			bg.thickness = 1;
			bg.background = '#1a1a1a';
			cdContainer.addControl(bg);

			const fill = new GUI.Rectangle(`cd-fill-${name}`);
			fill.width = '0%';
			fill.height = '100%';
			fill.cornerRadius = 0;
			fill.color = 'transparent';
			fill.thickness = 0;
			fill.background = color;
			fill.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
			bg.addControl(fill);

			return fill;
		};

		this.cooldownBars = {
			attack:   makeCdBar('attack',   '#e67e22'),
			ability1: makeCdBar('ability1', '#3498db'),
			ability2: makeCdBar('ability2', '#9b59b6'),
		};
	}

	updateLocalHealth(pct: number): void {
		if (this.localHealthFill) {
			this.localHealthFill.width = `${(Math.max(0, Math.min(1, pct)) * 100).toFixed(1)}%`;
		}
	}

	updateCooldowns(attack: number, ability1: number, ability2: number): void {
		this.cooldownBars.attack.width =
			`${(Math.max(0, Math.min(1, attack)) * 100).toFixed(1)}%`;
		this.cooldownBars.ability1.width =
			`${(Math.max(0, Math.min(1, ability1)) * 100).toFixed(1)}%`;
		this.cooldownBars.ability2.width =
			`${(Math.max(0, Math.min(1, ability2)) * 100).toFixed(1)}%`;
	}

	createEnemyBar(playerId: number): void {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const GUI = (BABYLON as any).GUI;

		const bg = new GUI.Rectangle(`enemy-hp-bg-${playerId}`);
		bg.width = '54px';
		bg.height = '5px';
		bg.cornerRadius = 2;
		bg.color = 'transparent';
		bg.thickness = 0;
		bg.background = '#1a1a1a';
		bg.isPointerBlocker = false;
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

		this.enemyBars.set(playerId, { bg, fill });
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
		if (this.gui) {
			this.gui.dispose();
		}
	}
}
