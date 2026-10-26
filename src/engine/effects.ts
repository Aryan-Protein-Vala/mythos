import * as THREE from "three";
import type { ParticleSpec, WorldSpec } from "../world/types";
import { particleSprite } from "./textures";
import { Rng, hashString } from "../world/rng";

type Mode = ParticleSpec["kind"];

interface ParticleOptions {
  count: number;
  size: number;
  speed: number;
  opacity: number;
  additive: boolean;
  flicker: number;
  spread: number;
  height: number;
  wind: number;
}

const PRESETS: Record<Exclude<Mode, "none">, ParticleOptions> = {
  embers: { count: 340, size: 0.13, speed: 1.15, opacity: 0.9, additive: true, flicker: 0.55, spread: 1, height: 26, wind: 0.22 },
  mist: { count: 80, size: 13, speed: 0.16, opacity: 0.055, additive: false, flicker: 0, spread: 1.1, height: 10, wind: 0.4 },
  snow: { count: 900, size: 0.11, speed: 1.5, opacity: 0.85, additive: false, flicker: 0, spread: 1, height: 32, wind: 0.5 },
  dust: { count: 380, size: 0.09, speed: 0.5, opacity: 0.35, additive: false, flicker: 0, spread: 1.2, height: 18, wind: 0.9 },
  fireflies: { count: 130, size: 0.16, speed: 0.35, opacity: 0.95, additive: true, flicker: 0.95, spread: 0.8, height: 8, wind: 0.25 },
  rain: { count: 1100, size: 0.07, speed: 5.5, opacity: 0.4, additive: false, flicker: 0, spread: 1, height: 30, wind: 0.2 },
};

export interface ParticleSystem {
  points: THREE.Points;
  update(dt: number, time: number, camera: THREE.Camera): void;
  setBoost(value: number): void;
  dispose(): void;
}

export function createParticles(spec: ParticleSpec, size: number): ParticleSystem | null {
  if (spec.kind === "none" || spec.density <= 0.01) return null;
  const p = PRESETS[spec.kind];
  const count = Math.max(24, Math.round(p.count * (0.35 + spec.density)));
  const rng = new Rng(hashString(`${spec.kind}:${spec.density}:${size}`));
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const sizes = new Float32Array(count);
  const velocities = new Float32Array(count);
  const radius = size * 0.42 * p.spread;
  const height = p.height;

  for (let i = 0; i < count; i++) {
    positions[i * 3] = rng.range(-radius, radius);
    positions[i * 3 + 1] = rng.range(0, height);
    positions[i * 3 + 2] = rng.range(-radius, radius);
    seeds[i] = rng.next();
    sizes[i] = p.size * rng.range(0.55, 1.6);
    velocities[i] = p.speed * rng.range(0.55, 1.45);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, height / 2, 0), radius + height);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTex: { value: particleSprite() },
      uColor: { value: new THREE.Color(spec.color) },
      uOpacity: { value: p.opacity },
      uPixelRatio: { value: Math.min(1.75, globalThis.devicePixelRatio || 1) },
      uFlicker: { value: p.flicker },
      uTime: { value: 0 },
      uBoost: { value: 0 },
    },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aSeed;
      uniform float uPixelRatio;
      uniform float uTime;
      uniform float uFlicker;
      uniform float uBoost;
      varying float vFlicker;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float flick = 1.0 + uFlicker * sin(uTime * 1.7 + aSeed * 41.0) * 0.5;
        vFlicker = flick * (1.0 + uBoost * 0.4);
        gl_PointSize = aSize * (1.0 + uBoost) * uPixelRatio * (330.0 / max(0.35, -mv.z));
        gl_PointSize = clamp(gl_PointSize, 1.0, 220.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uTex;
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vFlicker;
      void main() {
        vec4 tex = texture2D(uTex, gl_PointCoord);
        float alpha = tex.a * uOpacity * vFlicker;
        if (alpha < 0.002) discard;
        gl_FragColor = vec4(uColor, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: p.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.name = `particles-${spec.kind}`;

  const mode = spec.kind;
  const posAttr = geometry.getAttribute("position") as THREE.BufferAttribute;

  return {
    points,
    update(dt, time, camera) {
      const d = Math.min(dt, 0.05);
      const arr = posAttr.array as Float32Array;
      points.position.set(camera.position.x, camera.position.y - 5, camera.position.z);
      material.uniforms.uTime.value = time;

      for (let i = 0; i < count; i++) {
        const iy = i * 3 + 1;
        const seed = seeds[i];
        if (mode === "embers" || mode === "fireflies") {
          arr[iy] += velocities[i] * d;
          arr[i * 3] += Math.sin(time * 0.7 + seed * 20) * p.wind * d;
          arr[i * 3 + 2] += Math.cos(time * 0.6 + seed * 17) * p.wind * d;
          if (arr[iy] > height) {
            arr[iy] = 0;
            arr[i * 3] = rng.range(-radius, radius);
            arr[i * 3 + 2] = rng.range(-radius, radius);
          }
        } else if (mode === "snow" || mode === "rain") {
          arr[iy] -= velocities[i] * d;
          arr[i * 3] += Math.sin(time * 0.8 + seed * 12) * p.wind * d;
          arr[i * 3 + 2] += Math.cos(time * 0.5 + seed * 9) * p.wind * 0.4 * d;
          if (arr[iy] < 0) {
            arr[iy] = height;
            arr[i * 3] = rng.range(-radius, radius);
            arr[i * 3 + 2] = rng.range(-radius, radius);
          }
        } else if (mode === "dust") {
          arr[i * 3] += velocities[i] * p.wind * d;
          arr[i * 3 + 2] += Math.sin(time * 0.3 + seed * 8) * 0.3 * d;
          arr[iy] += Math.sin(time * 0.5 + seed * 13) * 0.18 * d;
          if (arr[i * 3] > radius) arr[i * 3] = -radius;
          if (arr[iy] > height) arr[iy] = 0;
          if (arr[iy] < 0) arr[iy] = height;
        } else if (mode === "mist") {
          arr[i * 3] += velocities[i] * p.wind * d;
          arr[i * 3 + 2] += Math.sin(time * 0.15 + seed * 10) * 0.12 * d;
          if (arr[i * 3] > radius) {
            arr[i * 3] = -radius;
            arr[i * 3 + 2] = rng.range(-radius, radius);
          }
        }
      }
      posAttr.needsUpdate = true;
    },
    setBoost(value) {
      material.uniforms.uBoost.value = value;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Interaction beacons                                                */
/* ------------------------------------------------------------------ */

export interface Beacon {
  group: THREE.Group;
  update(time: number): void;
  setDiscovered(v: boolean): void;
  dispose(): void;
}

export function createBeacon(position: THREE.Vector3, color: string, active = true): Beacon {
  const group = new THREE.Group();
  group.position.copy(position);

  const ringMaterial = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: active ? 0.5 : 0.22,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.035, 6, 40), ringMaterial);
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  const coreMaterial = new THREE.MeshStandardMaterial({
    color,
    emissive: new THREE.Color(color),
    emissiveIntensity: 1.4,
    roughness: 0.3,
    metalness: 0.4,
    transparent: true,
    opacity: 0.95,
  });
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.13, 0), coreMaterial);
  core.position.y = 1.15;
  group.add(core);

  const light = new THREE.PointLight(color, active ? 22 : 6, 12, 2);
  light.position.y = 1.3;
  group.add(light);

  return {
    group,
    update(time) {
      core.rotation.y = time * 0.7;
      core.position.y = 1.15 + Math.sin(time * 1.1) * 0.08;
      ringMaterial.opacity = (active ? 0.4 : 0.16) + Math.sin(time * 1.4) * 0.09;
    },
    setDiscovered(v) {
      ringMaterial.opacity = v ? 0.1 : 0.5;
      light.intensity = v ? 6 : 22;
      coreMaterial.emissiveIntensity = v ? 0.35 : 1.4;
    },
    dispose() {
      ring.geometry.dispose();
      ringMaterial.dispose();
      core.geometry.dispose();
      coreMaterial.dispose();
      light.dispose();
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Event beam                                                         */
/* ------------------------------------------------------------------ */

export interface Beam {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  setStrength(v: number): void;
  update(time: number): void;
  dispose(): void;
}

export function createBeam(color: string, height = 90): Beam {
  const geometry = new THREE.CylinderGeometry(2.4, 4.2, height, 24, 1, true);
  geometry.translate(0, height / 2, 0);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uStrength: { value: 0 },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uStrength;
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        float vertical = smoothstep(0.0, 0.18, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
        float bands = 0.75 + 0.25 * sin(vUv.y * 24.0 - uTime * 1.6);
        float edge = pow(sin(vUv.x * 3.14159), 2.0);
        float alpha = vertical * bands * edge * uStrength * 0.5;
        if (alpha < 0.002) discard;
        gl_FragColor = vec4(uColor, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "event-beam";
  mesh.visible = false;
  return {
    mesh,
    material,
    setStrength(v) {
      mesh.visible = v > 0.01;
      material.uniforms.uStrength.value = v;
    },
    update(time) {
      material.uniforms.uTime.value = time;
      mesh.rotation.y = time * 0.05;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Distant floating debris / birds for life                           */
/* ------------------------------------------------------------------ */

export function createDriftMotes(spec: WorldSpec): THREE.Points | null {
  if (spec.atmosphere.particles.kind === "snow") return null;
  const count = 90;
  const rng = new Rng(hashString(`${spec.seed}:motes`));
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const angle = rng.range(0, Math.PI * 2);
    const r = rng.range(20, spec.terrain.size * 0.4);
    positions[i * 3] = Math.cos(angle) * r;
    positions[i * 3 + 1] = rng.range(8, 45);
    positions[i * 3 + 2] = Math.sin(angle) * r;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: new THREE.Color(spec.atmosphere.sky.sunColor),
    size: 0.32,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    map: particleSprite(),
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.name = "drift-motes";
  return points;
}