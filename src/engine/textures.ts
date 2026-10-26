import * as THREE from "three";
import { Noise2D } from "../world/noise";

const cache = new Map<string, THREE.Texture>();

function canvasTexture(key: string, size: number, draw: (data: Uint8ClampedArray) => void): THREE.Texture {
  const cached = cache.get(key);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(size, size);
  draw(image.data);
  ctx.putImageData(image, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}

/** Fine grain used on stone architecture. */
export function stoneDetailTexture(): THREE.Texture {
  return canvasTexture("stone", 256, (data) => {
    const noise = new Noise2D(9173);
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const i = (y * 256 + x) * 4;
        const n = noise.fbm(x * 0.055, y * 0.055, 5) * 0.5 + 0.5;
        const grain = noise.noise(x * 0.42, y * 0.42) * 0.5 + 0.5;
        const crack = Math.abs(noise.fbm(x * 0.02, y * 0.02, 3)) < 0.018 ? -0.22 : 0;
        const v = Math.max(0, Math.min(1, n * 0.7 + grain * 0.3 + crack));
        // Near-white detail: the material colour should drive the hue and value,
        // otherwise dark stone multiplied by a mid-grey map renders as black.
        const c = 228 + (v - 0.5) * 56;
        data[i] = c;
        data[i + 1] = c;
        data[i + 2] = c;
        data[i + 3] = 255;
      }
    }
  });
}

/** Broad, soft variation used on terrain. */
export function groundDetailTexture(): THREE.Texture {
  return canvasTexture("ground", 256, (data) => {
    const noise = new Noise2D(4412);
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const i = (y * 256 + x) * 4;
        const n = noise.fbm(x * 0.03, y * 0.03, 4) * 0.5 + 0.5;
        const f = noise.noise(x * 0.5, y * 0.5) * 0.5 + 0.5;
        const v = n * 0.82 + f * 0.18;
        const c = 208 + (v - 0.5) * 88;
        data[i] = c;
        data[i + 1] = c;
        data[i + 2] = c;
        data[i + 3] = 255;
      }
    }
  });
}

/** Radial soft sprite for particles. */
export function particleSprite(): THREE.Texture {
  const key = "particle";
  const cached = cache.get(key);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}

export function disposeTextureCache(): void {
  for (const tex of cache.values()) tex.dispose();
  cache.clear();
}