import { Color3, MeshBuilder, StandardMaterial, Vector3 } from '@babylonjs/core';
import type { Mesh, Scene } from '@babylonjs/core';

export interface SwingTrailConfig {
  baseColor: Color3; // tail end — dim/transparent
  tipColor: Color3;  // weapon end — bright
  maxWidth: number;  // ribbon half-width at newest point (world units)
}

interface TrailPoint {
  pos: Vector3;
  progress: number;
}

// Show the last 50% of the swing arc (progress units, not time)
const TAIL_FRACTION = 0.5;
const MIN_POINTS = 3;

export class SwingTrail {
  private config: SwingTrailConfig;
  private scene: Scene;
  private history: TrailPoint[] = [];
  private ribbon: Mesh | null = null;
  private material: StandardMaterial;
  private lastProgress = 0;

  constructor(scene: Scene, config: SwingTrailConfig) {
    this.scene = scene;
    this.config = config;

    this.material = new StandardMaterial('swingTrailMat', scene);
    this.material.backFaceCulling = false;
    this.material.disableLighting = true;
    this.material.emissiveColor = new Color3(1, 0, 0); // DEBUG: solid red
  }

  update(worldPos: Vector3 | null, swingProgress: number): void {
    console.log('[Trail] update called: progress=', swingProgress, 'pos=', worldPos?.toString());
    const wasActive = this.lastProgress > 0;
    this.lastProgress = swingProgress;

    if (swingProgress <= 0) {
      if (wasActive) {
        this.history = [];
        if (this.ribbon) this.ribbon.isVisible = false;
      }
      return;
    }

    if (!worldPos) {
      console.warn('[SwingTrail] no weapon position — trail skipped');
      return;
    }

    this.history.push({ pos: worldPos, progress: swingProgress });

    // Prune entries outside the rolling window (oldest 50% of arc)
    const cutoff = swingProgress - TAIL_FRACTION;
    let pruneCount = 0;
    while (pruneCount < this.history.length && this.history[pruneCount].progress < cutoff) {
      pruneCount++;
    }
    if (pruneCount > 0) this.history.splice(0, pruneCount);

    if (this.history.length < MIN_POINTS) return;

    this.rebuildRibbon();
  }

  private rebuildRibbon(): void {
    const n = this.history.length;

    // Build two parallel paths offset perpendicular to the swing arc in XZ.
    // A horizontal ribbon is clearly visible from the isometric camera (35° elevation).
    const path1: Vector3[] = [];
    const path2: Vector3[] = [];

    for (let i = 0; i < n; i++) {
      const age = i / (n - 1); // 0 = oldest, 1 = newest
      const halfWidth = this.config.maxWidth * age;
      const { pos } = this.history[i];

      // Direction of travel in XZ; use neighbour on endpoints
      let dx = 0, dz = 1;
      if (i < n - 1) {
        dx = this.history[i + 1].pos.x - pos.x;
        dz = this.history[i + 1].pos.z - pos.z;
      } else if (i > 0) {
        dx = pos.x - this.history[i - 1].pos.x;
        dz = pos.z - this.history[i - 1].pos.z;
      }
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len > 0.0001) { dx /= len; dz /= len; }

      // Perpendicular in XZ: (-dz, 0, dx)
      path1.push(new Vector3(pos.x - dz * halfWidth, pos.y, pos.z + dx * halfWidth));
      path2.push(new Vector3(pos.x + dz * halfWidth, pos.y, pos.z - dx * halfWidth));
    }

    // Recreate ribbon mesh (path count changes every frame due to rolling window)
    this.ribbon?.dispose(false, false);
    this.ribbon = MeshBuilder.CreateRibbon('swingTrail', {
      pathArray: [path1, path2],
    }, this.scene) as Mesh;
    this.ribbon.material = this.material;
    console.log('[Trail] ribbon verts=', this.ribbon.getTotalVertices(), 'n=', n);
  }

  dispose(): void {
    this.ribbon?.dispose();
    this.material.dispose();
    this.ribbon = null;
    this.history = [];
  }
}
