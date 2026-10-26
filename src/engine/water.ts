import * as THREE from "three";
import type { WaterSpec } from "../world/types";

export interface WaterSystem {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  update(water: WaterSpec, fog: { color: string; density: number }, time: number): void;
  setEventGlow(strength: number, color: string): void;
  dispose(): void;
}

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uWaveHeight;
  varying vec3 vWorld;
  varying float vViewDistance;

  float wave(vec2 p, float t) {
    return sin(p.x * 0.115 + t * 0.55) * 0.55
         + sin(p.y * 0.165 - t * 0.43) * 0.35
         + sin((p.x + p.y) * 0.29 + t * 0.81) * 0.16;
  }

  void main() {
    vec3 pos = position;
    vec4 world = modelMatrix * vec4(pos, 1.0);
    world.y += wave(world.xz, uTime) * uWaveHeight;
    vWorld = world.xyz;
    vec4 mv = viewMatrix * world;
    vViewDistance = length(mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uWaveHeight;
  uniform vec3 uColor;
  uniform vec3 uDeep;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform vec3 uSkyHorizon;
  uniform float uRoughness;
  uniform float uOpacity;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform vec3 uEventColor;
  uniform float uEventGlow;

  varying vec3 vWorld;
  varying float vViewDistance;

  vec2 waveDerivative(vec2 p, float t) {
    float dx = cos(p.x * 0.115 + t * 0.55) * 0.115 * 0.55
             + cos((p.x + p.y) * 0.29 + t * 0.81) * 0.29 * 0.16;
    float dz = cos(p.y * 0.165 - t * 0.43) * 0.165 * 0.35
             + cos((p.x + p.y) * 0.29 + t * 0.81) * 0.29 * 0.16;
    return vec2(dx, dz);
  }

  void main() {
    vec3 viewDir = normalize(cameraPosition - vWorld);
    vec2 d = waveDerivative(vWorld.xz, uTime) * uWaveHeight * 2.4;
    vec3 normal = normalize(vec3(-d.x, 1.0 - uRoughness * 0.05, -d.y));

    float fresnel = pow(1.0 - clamp(dot(normal, viewDir), 0.0, 1.0), 3.2);
    vec3 base = mix(uDeep, uColor, clamp(normal.y, 0.0, 1.0));
    vec3 col = mix(base, uSkyHorizon * 0.85, fresnel * 0.72);

    vec3 sun = normalize(uSunDir);
    vec3 halfDir = normalize(sun + viewDir);
    float spec = pow(max(dot(normal, halfDir), 0.0), mix(180.0, 12.0, uRoughness));
    col += uSunColor * spec * (0.85 + uEventGlow * 1.4);

    // Glitter path beneath the sun / eclipse.
    vec3 sunFlat = normalize(vec3(sun.x, 0.0, sun.z));
    vec3 viewFlat = normalize(vec3(viewDir.x, 0.0, viewDir.z));
    float alignment = pow(max(dot(sunFlat, viewFlat), 0.0), 48.0);
    float ripple = 0.55 + 0.45 * sin(vWorld.x * 0.9 + vWorld.z * 1.37 + uTime * 1.2);
    col += uSunColor * alignment * ripple * 0.22 * (0.4 + uEventGlow);

    col += uEventColor * uEventGlow * 0.10 * (0.4 + fresnel);

    float fogFactor = 1.0 - exp(-pow(uFogDensity * vViewDistance, 2.0));
    col = mix(col, uFogColor, clamp(fogFactor, 0.0, 1.0));

    gl_FragColor = vec4(col, uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const waveVertex = vertexShader;
const waveFragment = fragmentShader;

export function createWater(water: WaterSpec, size: number, skyHorizon: string, fog: { color: string; density: number }): WaterSystem {
  const geometry = new THREE.PlaneGeometry(size * 2.4, size * 2.4, 96, 96);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uWaveHeight: { value: water.waveHeight },
      uColor: { value: new THREE.Color(water.color) },
      uDeep: { value: new THREE.Color(water.deepColor) },
      uSunColor: { value: new THREE.Color("#efe0c2") },
      uSunDir: { value: new THREE.Vector3(0, 0.4, -1) },
      uSkyHorizon: { value: new THREE.Color(skyHorizon) },
      uRoughness: { value: water.roughness },
      uOpacity: { value: water.opacity },
      uFogColor: { value: new THREE.Color(fog.color) },
      uFogDensity: { value: fog.density },
      uEventColor: { value: new THREE.Color(water.color) },
      uEventGlow: { value: 0 },
    },
    vertexShader: waveVertex,
    fragmentShader: waveFragment,
    transparent: true,
    depthWrite: false,
    toneMapped: true,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = water.level;
  mesh.name = "water";
  mesh.renderOrder = 1;
  mesh.receiveShadow = false;

  return {
    mesh,
    material,
    update(next, nextFog, time) {
      const u = material.uniforms;
      u.uTime.value = time;
      u.uWaveHeight.value = next.waveHeight;
      (u.uColor.value as THREE.Color).set(next.color);
      (u.uDeep.value as THREE.Color).set(next.deepColor);
      u.uRoughness.value = next.roughness;
      u.uOpacity.value = next.opacity;
      (u.uFogColor.value as THREE.Color).set(nextFog.color);
      u.uFogDensity.value = nextFog.density;
      mesh.position.y = next.level;
      mesh.visible = next.enabled;
    },
    setEventGlow(strength, color) {
      material.uniforms.uEventGlow.value = strength;
      (material.uniforms.uEventColor.value as THREE.Color).set(color);
      (material.uniforms.uSkyHorizon.value as THREE.Color).set(color);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

export function setWaterSun(water: WaterSystem, dir: THREE.Vector3, color: string, horizon: string) {
  (water.material.uniforms.uSunDir.value as THREE.Vector3).copy(dir);
  (water.material.uniforms.uSunColor.value as THREE.Color).set(color);
  (water.material.uniforms.uSkyHorizon.value as THREE.Color).set(horizon);
}