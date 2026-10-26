import type { TerrainPad, TerrainSpec } from "./types";
import { Noise2D, clamp, smoothstep } from "./noise";
import { hashString } from "./rng";

/**
 * Shared heightfield used by the terrain mesh, object placement and the player
 * controller. Deterministic for a given terrain spec + seed, so the camera can
 * never spawn under the ground it renders.
 */
export class TerrainSampler {
  private base: Noise2D;
  private detail: Noise2D;
  constructor(
    readonly seed: string,
    readonly terrain: TerrainSpec,
  ) {
    this.base = new Noise2D(hashString(seed) ^ 0x9e37);
    this.detail = new Noise2D(hashString(`${seed}:detail`));
  }

  /** Raw noise height before pads, in metres. */
  rawHeight(x: number, z: number): number {
    const t = this.terrain;
    const size = t.size;
    const u = x / size + 0.5;
    const v = z / size + 0.5;
    const amp = t.amplitude;
    const rough = t.roughness;

    // Digital elevation model, normalised to roughly -1..1.
    let h = 0;
    switch (t.type) {
      case "islands": {
        const mass = this.base.ridged(u * 2.6, v * 2.6, 4);
        const detail = this.detail.fbm(u * 7, v * 7, 4);
        h = (mass - 0.42) * 2.15 + detail * 0.22 * (0.4 + rough);
        break;
      }
      case "rolling": {
        const broad = this.base.fbm(u * 2.2, v * 2.2, 5);
        const detail = this.detail.fbm(u * 6.5, v * 6.5, 3);
        h = broad * 0.85 + detail * 0.22 * (0.3 + rough);
        break;
      }
      case "dunes": {
        const broad = this.base.fbm(u * 1.8, v * 1.8, 3);
        const ridge = Math.sin((u * 13 + v * 4.5) * Math.PI) * 0.5 + 0.5;
        const swell = this.detail.fbm(u * 4.2, v * 2.4, 3);
        h = broad * 0.45 + ridge * ridge * 0.55 + swell * 0.18;
        break;
      }
      case "ice": {
        const broad = this.base.fbm(u * 2.6, v * 2.6, 4);
        const fracture = this.detail.ridged(u * 9, v * 9, 3);
        h = broad * 0.35 + (fracture - 0.5) * 0.3 * (0.4 + rough);
        break;
      }
      case "plateau": {
        const mesa = this.base.fbm(u * 2.1, v * 2.1, 4);
        const step = Math.round(mesa * 4) / 4;
        h = step * 0.8 + this.detail.fbm(u * 8, v * 8, 3) * 0.18;
        break;
      }
    }

    // Radial falloff keeps the world readable and hides the mesh edge in fog.
    const dx = x / (size * 0.5);
    const dz = z / (size * 0.5);
    const r = Math.sqrt(dx * dx + dz * dz);
    const falloff = 1 - smoothstep(0.62, 1.02, r);
    h = h * amp * falloff;

    if (t.type === "islands" || t.type === "rolling") {
      // Carve a shallow basin so water reads as a horizon, not a puddle.
      h -= amp * 0.16 * falloff;
    }

    return h;
  }

  /** Height after building pads are blended in. */
  heightAt(x: number, z: number): number {
    let h = this.rawHeight(x, z);
    for (const pad of this.terrain.pads) {
      const d = Math.hypot(x - pad.x, z - pad.z);
      const inner = pad.radius;
      const outer = pad.radius * (1 + pad.blend);
      if (d > outer) continue;
      const w = 1 - smoothstep(inner, outer, d);
      h = h + (pad.height - h) * w;
    }
    return h;
  }

  normalAt(x: number, z: number): { x: number; y: number; z: number } {
    const e = 0.6;
    const hL = this.heightAt(x - e, z);
    const hR = this.heightAt(x + e, z);
    const hD = this.heightAt(x, z - e);
    const hU = this.heightAt(x, z + e);
    const nx = hL - hR;
    const nz = hD - hU;
    const ny = 2 * e;
    const len = Math.hypot(nx, ny, nz) || 1;
    return { x: nx / len, y: ny / len, z: nz / len };
  }

  /** Height including irregularity from props is intentionally ignored. */
  padHeight(pad: TerrainPad): number {
    return pad.height;
  }

  isWater(x: number, z: number, level: number): boolean {
    return this.heightAt(x, z) < level + 0.15;
  }

  slopeAt(x: number, z: number): number {
    const n = this.normalAt(x, z);
    return 1 - clamp(n.y, 0, 1);
  }
}