import * as THREE from "three";
import type { WorldSpec } from "../world/types";
import { TerrainSampler } from "../world/terrain";
import { Noise2D, clamp, smoothstep } from "../world/noise";
import { hashString } from "../world/rng";
import { groundDetailTexture } from "./textures";

export interface TerrainSystem {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  sampler: TerrainSampler;
  dispose(): void;
}

export function createTerrain(spec: WorldSpec, opts: { preview?: boolean } = {}): TerrainSystem {
  const t = spec.terrain;
  const sampler = new TerrainSampler(spec.seed, t);
  const meshSize = t.size * 1.9;
  const segments = opts.preview ? 128 : Math.round(clamp(meshSize / 2.0, 120, 240));

  const geometry = new THREE.PlaneGeometry(meshSize, meshSize, segments, segments);
  geometry.rotateX(-Math.PI / 2);

  const position = geometry.attributes.position as THREE.BufferAttribute;
  const count = position.count;
  const colors = new Float32Array(count * 3);

  const low = new THREE.Color(t.lowColor);
  const high = new THREE.Color(t.highColor);
  const rock = new THREE.Color(t.rockColor);
  const snow = new THREE.Color("#e8edee");
  const wet = new THREE.Color(t.lowColor).multiplyScalar(0.55);
  const variation = new Noise2D(hashString(`${spec.seed}:terrain-color`));
  const waterLevel = spec.water.enabled ? spec.water.level : -999;
  const tmp = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const y = sampler.heightAt(x, z);
    position.setY(i, y);

    const n = sampler.normalAt(x, z);
    const slope = 1 - clamp(n.y, 0, 1);
    const heightMix = smoothstep(-t.amplitude * 0.25, t.amplitude * 0.85, y);

    tmp.copy(low).lerp(high, heightMix);
    const grain = variation.fbm(x * 0.035, z * 0.035, 3) * 0.5 + 0.5;
    tmp.multiplyScalar(0.82 + grain * 0.36);
    tmp.lerp(rock, smoothstep(0.22, 0.55, slope) * 0.85);

    if (t.snow > 0.01) {
      const snowLine = t.amplitude * 0.22 + variation.noise(x * 0.02, z * 0.02) * 2.4;
      const snowMask = smoothstep(snowLine, snowLine + t.amplitude * 0.45, y) * (1 - smoothstep(0.3, 0.7, slope));
      tmp.lerp(snow, clamp(snowMask * t.snow, 0, 1));
    }

    if (spec.water.enabled) {
      const shore = 1 - smoothstep(0, 2.2, Math.abs(y - waterLevel));
      tmp.lerp(wet, shore * 0.55);
    }

    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }

  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const texture = groundDetailTexture().clone();
  texture.needsUpdate = true;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(t.size / 8, t.size / 8);

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: texture,
    roughness: spec.terrain.type === "ice" ? 0.55 : 0.96,
    metalness: 0.02,
    flatShading: false,
  });
  material.dithering = true;

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "terrain";
  mesh.receiveShadow = true;
  mesh.castShadow = false;

  return {
    mesh,
    material,
    sampler,
    dispose() {
      geometry.dispose();
      texture.dispose();
      material.dispose();
    },
  };
}