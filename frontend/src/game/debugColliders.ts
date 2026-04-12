/**
 * Interactive collision editor for map colliders.
 * Toggle with Ctrl+Shift+C. Click shapes to select, drag gizmo to move.
 * Panel lets you edit properties, change shape, add/remove, and export JSON.
 *
 * Temporary — remove before shipping.
 */

import type { Scene, Mesh, Nullable, Observer, PointerInfo, GizmoManager } from '@babylonjs/core';
import type * as BabylonType from '@babylonjs/core';

declare const BABYLON: typeof BabylonType;

const COLLIDER_HEIGHT = 1.5;

interface ColliderDef {
	id: string;
	type: 'box' | 'cylinder';
	center: { x: number; y: number; z: number };
	halfExtents?: { x: number; y: number; z: number };
	radius?: number;
}

interface ColliderEntry {
	def: ColliderDef;
	mesh: Mesh;
}

export class DebugColliders {
	private entries: ColliderEntry[] = [];
	private active = false;
	private loaded = false;
	private scene: Scene;

	private selectedIndex = -1;
	private gizmoManager: GizmoManager | null = null;
	private pointerObs: Nullable<Observer<PointerInfo>> = null;
	private highlightMat: BabylonType.StandardMaterial | null = null;
	private defaultMat: BabylonType.StandardMaterial | null = null;

	private panel: HTMLDivElement | null = null;

	constructor(scene: Scene) {
		this.scene = scene;
	}

	async load(): Promise<void> {
		if (this.loaded) return;

		const res = await fetch('/data/map_colliders.json');
		const defs: ColliderDef[] = await res.json();

		this.defaultMat = new BABYLON.StandardMaterial('dbg-col-default', this.scene);
		this.defaultMat.wireframe = true;
		this.defaultMat.diffuseColor = new BABYLON.Color3(1, 0.2, 0.2);
		this.defaultMat.emissiveColor = new BABYLON.Color3(1, 0.2, 0.2);

		this.highlightMat = new BABYLON.StandardMaterial('dbg-col-highlight', this.scene);
		this.highlightMat.wireframe = true;
		this.highlightMat.diffuseColor = new BABYLON.Color3(0.2, 1, 0.2);
		this.highlightMat.emissiveColor = new BABYLON.Color3(0.2, 1, 0.2);

		for (const def of defs) {
			this.createEntry(def, false);
		}

		this.loaded = true;
	}

	toggle(): void {
		this.active = !this.active;

		for (const e of this.entries) {
			e.mesh.setEnabled(this.active);
			e.mesh.isPickable = this.active;
		}

		if (this.active) {
			this.setupGizmo();
			this.setupPicking();
			this.showPanel();
		} else {
			this.deselect();
			this.teardownGizmo();
			this.teardownPicking();
			this.hidePanel();
		}

		console.log(`[ColliderEditor] ${this.active ? 'opened' : 'closed'} (${this.entries.length} shapes)`);
	}

	dispose(): void {
		this.teardownGizmo();
		this.teardownPicking();
		this.hidePanel();
		for (const e of this.entries) e.mesh.dispose();
		this.entries = [];
		this.defaultMat?.dispose();
		this.highlightMat?.dispose();
	}

	// ── Entry management ───────────────────────────────────────────

	private createEntry(def: ColliderDef, enabled: boolean): ColliderEntry {
		const mesh = this.buildMesh(def);
		mesh.setEnabled(enabled);
		mesh.isPickable = enabled;
		const entry: ColliderEntry = { def, mesh };
		this.entries.push(entry);
		return entry;
	}

	private buildMesh(def: ColliderDef): Mesh {
		let mesh: Mesh;
		const name = `dbg-${def.id}-${Date.now()}`;

		if (def.type === 'box' && def.halfExtents) {
			mesh = BABYLON.MeshBuilder.CreateBox(name, {
				width: def.halfExtents.x * 2,
				height: COLLIDER_HEIGHT,
				depth: def.halfExtents.z * 2,
			}, this.scene);
		} else {
			const r = def.radius ?? 1;
			mesh = BABYLON.MeshBuilder.CreateCylinder(name, {
				diameter: r * 2,
				height: COLLIDER_HEIGHT,
				tessellation: 24,
			}, this.scene);
		}

		mesh.position.set(def.center.x, COLLIDER_HEIGHT / 2, def.center.z);
		mesh.material = this.defaultMat;
		return mesh;
	}

	private rebuildMesh(index: number): void {
		const entry = this.entries[index];
		const wasSelected = this.selectedIndex === index;
		entry.mesh.dispose();
		entry.mesh = this.buildMesh(entry.def);
		entry.mesh.setEnabled(true);
		entry.mesh.isPickable = true;
		if (wasSelected) {
			entry.mesh.material = this.highlightMat;
			this.gizmoManager?.attachToMesh(entry.mesh);
		}
	}

	private syncDefFromMesh(index: number): void {
		const entry = this.entries[index];
		entry.def.center.x = parseFloat(entry.mesh.position.x.toFixed(2));
		entry.def.center.z = parseFloat(entry.mesh.position.z.toFixed(2));
	}

	// ── Selection ──────────────────────────────────────────────────

	private select(index: number): void {
		if (this.selectedIndex === index) return;
		this.deselect();
		this.selectedIndex = index;
		const entry = this.entries[index];
		entry.mesh.material = this.highlightMat;
		this.gizmoManager?.attachToMesh(entry.mesh);
		this.updatePanel();
	}

	private deselect(): void {
		if (this.selectedIndex >= 0 && this.selectedIndex < this.entries.length) {
			this.entries[this.selectedIndex].mesh.material = this.defaultMat;
		}
		this.selectedIndex = -1;
		this.gizmoManager?.attachToMesh(null);
		this.updatePanel();
	}

	// ── Gizmo ──────────────────────────────────────────────────────

	private setupGizmo(): void {
		if (this.gizmoManager) return;
		this.gizmoManager = new BABYLON.GizmoManager(this.scene);
		this.gizmoManager.positionGizmoEnabled = true;
		this.gizmoManager.rotationGizmoEnabled = false;
		this.gizmoManager.scaleGizmoEnabled = false;
		this.gizmoManager.boundingBoxGizmoEnabled = false;
		this.gizmoManager.usePointerToAttachGizmos = false;

		// Lock Y axis — colliders are ground-plane only
		if (this.gizmoManager.gizmos.positionGizmo) {
			this.gizmoManager.gizmos.positionGizmo.yGizmo.isEnabled = false;

			const pg = this.gizmoManager.gizmos.positionGizmo;
			pg.onDragEndObservable.add(() => {
				if (this.selectedIndex >= 0) {
					this.syncDefFromMesh(this.selectedIndex);
					this.updatePanel();
				}
			});
		}
	}

	private teardownGizmo(): void {
		this.gizmoManager?.dispose();
		this.gizmoManager = null;
	}

	// ── Picking ────────────────────────────────────────────────────

	private setupPicking(): void {
		if (this.pointerObs) return;
		this.pointerObs = this.scene.onPointerObservable.add((info) => {
			if (info.type !== BABYLON.PointerEventTypes.POINTERTAP) return;
			const hit = info.pickInfo;
			if (!hit?.hit || !hit.pickedMesh) {
				this.deselect();
				return;
			}
			const idx = this.entries.findIndex((e) => e.mesh === hit.pickedMesh);
			if (idx >= 0) {
				this.select(idx);
			} else {
				this.deselect();
			}
		});
	}

	private teardownPicking(): void {
		if (this.pointerObs) {
			this.scene.onPointerObservable.remove(this.pointerObs);
			this.pointerObs = null;
		}
	}

	// ── HTML Panel ─────────────────────────────────────────────────

	private showPanel(): void {
		if (this.panel) return;

		const panel = document.createElement('div');
		panel.id = 'collider-editor-panel';
		panel.style.cssText = `
			position: fixed; top: 10px; right: 10px; width: 280px;
			background: rgba(20,20,30,0.92); color: #eee; font: 13px/1.5 monospace;
			border: 1px solid #555; border-radius: 6px; padding: 12px;
			z-index: 10000; max-height: 90vh; overflow-y: auto;
			pointer-events: auto; user-select: none;
		`;
		document.body.appendChild(panel);
		this.panel = panel;
		this.updatePanel();
	}

	private hidePanel(): void {
		this.panel?.remove();
		this.panel = null;
	}

	private updatePanel(): void {
		if (!this.panel) return;

		const sel = this.selectedIndex >= 0 ? this.entries[this.selectedIndex] : null;

		let html = `<div style="margin-bottom:8px;font-size:14px;font-weight:bold;color:#ffcc00">
			Collider Editor <span style="font-weight:normal;font-size:11px;color:#aaa">(Ctrl+Shift+C to close)</span>
		</div>`;

		html += `<div style="margin-bottom:8px;color:#aaa">${this.entries.length} colliders</div>`;

		// List
		html += `<div style="max-height:150px;overflow-y:auto;margin-bottom:10px;border:1px solid #444;border-radius:4px">`;
		for (let i = 0; i < this.entries.length; i++) {
			const e = this.entries[i];
			const isSel = i === this.selectedIndex;
			html += `<div data-action="select" data-idx="${i}" style="
				padding:3px 6px;cursor:pointer;
				background:${isSel ? '#335' : 'transparent'};
				border-bottom:1px solid #333;font-size:12px;
			">
				<span style="color:${e.def.type === 'box' ? '#88f' : '#f88'}">${e.def.type === 'box' ? '■' : '●'}</span>
				${this.escHtml(e.def.id)}
			</div>`;
		}
		html += `</div>`;

		// Selected properties
		if (sel) {
			const d = sel.def;
			html += `<div style="border:1px solid #555;border-radius:4px;padding:8px;margin-bottom:8px">`;
			html += `<div style="margin-bottom:6px;font-weight:bold;color:#ffcc00">${this.escHtml(d.id)}</div>`;

			// ID
			html += this.inputRow('ID', 'text', d.id, 'id');

			// Shape
			html += `<div style="display:flex;align-items:center;margin-bottom:4px">
				<label style="width:70px;color:#aaa;font-size:11px">Shape</label>
				<select data-action="shape" style="flex:1;background:#222;color:#eee;border:1px solid #555;padding:2px 4px;font:12px monospace">
					<option value="box" ${d.type === 'box' ? 'selected' : ''}>box</option>
					<option value="cylinder" ${d.type === 'cylinder' ? 'selected' : ''}>cylinder</option>
				</select>
			</div>`;

			// Position
			html += this.inputRow('X', 'number', d.center.x.toFixed(2), 'cx');
			html += this.inputRow('Z', 'number', d.center.z.toFixed(2), 'cz');

			// Shape-specific
			if (d.type === 'box' && d.halfExtents) {
				html += this.inputRow('HalfX', 'number', d.halfExtents.x.toFixed(2), 'hx');
				html += this.inputRow('HalfZ', 'number', d.halfExtents.z.toFixed(2), 'hz');
			} else if (d.type === 'cylinder') {
				html += this.inputRow('Radius', 'number', (d.radius ?? 1).toFixed(2), 'radius');
			}

			html += `<div style="display:flex;gap:4px;margin-top:8px">
				<button data-action="delete" style="${this.btnStyle('#a33')}">Delete</button>
			</div>`;
			html += `</div>`;
		} else {
			html += `<div style="color:#777;font-size:12px;margin-bottom:8px">Click a shape to select it</div>`;
		}

		// Bottom actions
		html += `<div style="display:flex;gap:4px">
			<button data-action="add-box" style="${this.btnStyle('#36a')}">+ Box</button>
			<button data-action="add-cyl" style="${this.btnStyle('#36a')}">+ Cylinder</button>
			<button data-action="export" style="${this.btnStyle('#593')}">Export JSON</button>
		</div>`;

		this.panel.innerHTML = html;
		this.bindPanelEvents();
	}

	private inputRow(label: string, type: string, value: string, field: string): string {
		const step = type === 'number' ? 'step="0.01"' : '';
		const dragCursor = type === 'number' ? 'cursor:ew-resize;' : '';
		return `<div style="display:flex;align-items:center;margin-bottom:4px">
			<label data-drag-label="${field}" style="width:70px;color:#aaa;font-size:11px;${dragCursor}user-select:none">${label}</label>
			<input data-field="${field}" type="${type}" value="${value}" ${step}
				style="flex:1;background:#222;color:#eee;border:1px solid #555;padding:2px 4px;font:12px monospace;width:0" />
		</div>`;
	}

	private btnStyle(bg: string): string {
		return `flex:1;padding:4px 8px;background:${bg};color:#fff;border:none;border-radius:3px;cursor:pointer;font:12px monospace`;
	}

	private escHtml(s: string): string {
		return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}

	private bindPanelEvents(): void {
		if (!this.panel) return;

		// Select from list
		this.panel.querySelectorAll<HTMLElement>('[data-action="select"]').forEach((el) => {
			el.addEventListener('click', (e) => {
				e.stopPropagation();
				this.select(parseInt(el.dataset.idx!, 10));
			});
		});

		// Shape change
		this.panel.querySelector<HTMLSelectElement>('[data-action="shape"]')?.addEventListener('change', (e) => {
			if (this.selectedIndex < 0) return;
			const newType = (e.target as HTMLSelectElement).value as 'box' | 'cylinder';
			const def = this.entries[this.selectedIndex].def;
			if (def.type === newType) return;

			if (newType === 'box') {
				const r = def.radius ?? 1;
				def.type = 'box';
				def.halfExtents = { x: r, y: 0, z: r };
				delete def.radius;
			} else {
				const hx = def.halfExtents?.x ?? 1;
				const hz = def.halfExtents?.z ?? 1;
				def.type = 'cylinder';
				def.radius = parseFloat(((hx + hz) / 2).toFixed(2));
				delete def.halfExtents;
			}
			this.rebuildMesh(this.selectedIndex);
			this.updatePanel();
		});

		// Field inputs
		this.panel.querySelectorAll<HTMLInputElement>('input[data-field]').forEach((input) => {
			input.addEventListener('change', () => {
				if (this.selectedIndex < 0) return;
				const entry = this.entries[this.selectedIndex];
				const field = input.dataset.field!;
				const val = input.type === 'number' ? parseFloat(input.value) : input.value;

				switch (field) {
					case 'id': entry.def.id = val as string; break;
					case 'cx':
						entry.def.center.x = val as number;
						entry.mesh.position.x = val as number;
						break;
					case 'cz':
						entry.def.center.z = val as number;
						entry.mesh.position.z = val as number;
						break;
					case 'hx':
						if (entry.def.halfExtents) entry.def.halfExtents.x = val as number;
						this.rebuildMesh(this.selectedIndex);
						break;
					case 'hz':
						if (entry.def.halfExtents) entry.def.halfExtents.z = val as number;
						this.rebuildMesh(this.selectedIndex);
						break;
					case 'radius':
						entry.def.radius = val as number;
						this.rebuildMesh(this.selectedIndex);
						break;
				}
				this.updatePanel();
			});
		});

		// Delete
		this.panel.querySelector('[data-action="delete"]')?.addEventListener('click', () => {
			if (this.selectedIndex < 0) return;
			this.entries[this.selectedIndex].mesh.dispose();
			this.entries.splice(this.selectedIndex, 1);
			this.selectedIndex = -1;
			this.gizmoManager?.attachToMesh(null);
			this.updatePanel();
		});

		// Add box
		this.panel.querySelector('[data-action="add-box"]')?.addEventListener('click', () => {
			const def: ColliderDef = {
				id: `new-box-${this.entries.length}`,
				type: 'box',
				center: { x: 0, y: 0, z: 0 },
				halfExtents: { x: 1, y: 0, z: 1 },
			};
			this.createEntry(def, true);
			this.select(this.entries.length - 1);
		});

		// Add cylinder
		this.panel.querySelector('[data-action="add-cyl"]')?.addEventListener('click', () => {
			const def: ColliderDef = {
				id: `new-cyl-${this.entries.length}`,
				type: 'cylinder',
				center: { x: 0, y: 0, z: 0 },
				radius: 1,
			};
			this.createEntry(def, true);
			this.select(this.entries.length - 1);
		});

		// Export
		this.panel.querySelector('[data-action="export"]')?.addEventListener('click', () => {
			this.exportJson();
		});

		// Drag-to-scrub on number labels
		this.panel.querySelectorAll<HTMLElement>('[data-drag-label]').forEach((label) => {
			const field = label.dataset.dragLabel!;
			const input = this.panel!.querySelector<HTMLInputElement>(`input[data-field="${field}"]`);
			if (!input || input.type !== 'number') return;

			let dragging = false;
			let startX = 0;
			let startVal = 0;

			const sensitivity = (field === 'cx' || field === 'cz') ? 0.05 : 0.02;

			const onMove = (e: MouseEvent) => {
				if (!dragging) return;
				const delta = (e.clientX - startX) * sensitivity;
				const newVal = parseFloat((startVal + delta).toFixed(2));
				input.value = newVal.toFixed(2);
				input.dispatchEvent(new Event('change'));
			};

			const onUp = () => {
				if (!dragging) return;
				dragging = false;
				document.body.style.cursor = '';
				window.removeEventListener('mousemove', onMove);
				window.removeEventListener('mouseup', onUp);
			};

			label.addEventListener('mousedown', (e) => {
				e.preventDefault();
				dragging = true;
				startX = e.clientX;
				startVal = parseFloat(input.value) || 0;
				document.body.style.cursor = 'ew-resize';
				window.addEventListener('mousemove', onMove);
				window.addEventListener('mouseup', onUp);
			});
		});
	}

	// ── Export ──────────────────────────────────────────────────────

	private exportJson(): void {
		// Sync all positions from meshes
		for (let i = 0; i < this.entries.length; i++) {
			this.syncDefFromMesh(i);
		}

		const output = this.entries.map((e) => {
			const d = e.def;
			if (d.type === 'box') {
				return {
					id: d.id,
					type: 'box',
					center: { x: d.center.x, y: 0.0, z: d.center.z },
					halfExtents: { x: d.halfExtents!.x, y: 0.0, z: d.halfExtents!.z },
				};
			}
			return {
				id: d.id,
				type: 'cylinder',
				center: { x: d.center.x, y: 0.0, z: d.center.z },
				radius: d.radius!,
			};
		});

		const json = JSON.stringify(output, null, 2);

		// Download as file
		const blob = new Blob([json], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'map_colliders.json';
		a.click();
		URL.revokeObjectURL(url);

		console.log('[ColliderEditor] Exported', this.entries.length, 'colliders');
	}
}
