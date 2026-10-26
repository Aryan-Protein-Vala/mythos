import * as THREE from "three";
import type { EventKind, WorldSpec } from "../world/types";
import { TerrainSampler } from "../world/terrain";
import { buildArchitecture, createMaterials, type Collider, type WorldMaterialSet } from "./architecture";
import { buildNature, type NatureBuild } from "./nature";
import { createSky, type SkySystem } from "./sky";
import { createWater, setWaterSun, type WaterSystem } from "./water";
import { createTerrain, type TerrainSystem } from "./terrainMesh";
import { createBeam, createBeacon, createDriftMotes, createParticles, type Beacon, type ParticleSystem } from "./effects";

export interface BuiltWorld {
  scene: THREE.Scene;
  sampler: TerrainSampler;
  colliders: Collider[];
  sky: SkySystem;
  water: WaterSystem | null;
  terrain: TerrainSystem;
  particles: ParticleSystem | null;
  beacons: Map<string, Beacon>;
  accentLights: THREE.PointLight[];
  update(dt: number, time: number, camera: THREE.Camera): void;
  setDiscovered(ids: string[]): void;
  setAtmosphere(next: WorldSpec): void;
  playEvent(kind: EventKind, duration: number): void;
  resolveEvent(kind: EventKind): void;
  resetEvent(): void;
  isEventActive(): boolean;
  dispose(): void;
}

export interface AssembleOptions {
  preview?: boolean;
  /** Skip small animated detail for one-shot renders. */
  static?: boolean;
}

const EVENT_COLORS: Record<EventKind, string> = {
  "eclipse-awakening": "#ffc27a",
  "grove-bloom": "#ffe3a6",
  "frontier-signal": "#d6e8ef",
};

export function assembleWorld(spec: WorldSpec, opts: AssembleOptions = {}): BuiltWorld {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(spec.atmosphere.fog.color, spec.atmosphere.fog.density);

  const terrain = createTerrain(spec, { preview: opts.preview });
  scene.add(terrain.mesh);

  const sky = createSky(spec.atmosphere.sky);
  scene.add(sky.mesh);

  const materials: WorldMaterialSet = createMaterials(spec);
  const architecture = buildArchitecture(spec, materials);
  scene.add(architecture.group);

  const nature: NatureBuild = buildNature(spec);
  scene.add(nature.group);

  const water = spec.water.enabled ? createWater(spec.water, spec.terrain.size, spec.atmosphere.sky.horizon, spec.atmosphere.fog) : null;
  if (water) {
    scene.add(water.mesh);
    setWaterSun(water, sky.sunDirection, spec.atmosphere.sky.sunColor, spec.atmosphere.sky.horizon);
  }

  const particles = opts.static ? null : createParticles(spec.atmosphere.particles, spec.terrain.size);
  if (particles) scene.add(particles.points);

  const motes = opts.static ? null : createDriftMotes(spec);
  if (motes) scene.add(motes);

  const beacons = new Map<string, Beacon>();
  if (!opts.preview) for (const interaction of spec.interactions) {
    const beacon = createBeacon(
      new THREE.Vector3(interaction.position.x, interaction.position.y - 1.1, interaction.position.z),
      spec.accentColor,
    );
    beacons.set(interaction.id, beacon);
    scene.add(beacon.group);
  }

  // Lighting
  const hemi = new THREE.HemisphereLight(
    spec.atmosphere.sky.horizon,
    spec.terrain.lowColor,
    spec.atmosphere.lighting.ambientIntensity * 1.35,
  );
  scene.add(hemi);

  const ambient = new THREE.AmbientLight(spec.atmosphere.lighting.ambientColor, spec.atmosphere.lighting.ambientIntensity * 0.8);
  scene.add(ambient);

  const key = new THREE.DirectionalLight(spec.atmosphere.lighting.keyColor, spec.atmosphere.lighting.keyIntensity);
  key.position.copy(sky.sunDirection).multiplyScalar(140);
  key.position.y = Math.max(key.position.y, 26);
  key.target.position.set(0, 0, 0);
  key.castShadow = !opts.preview;
  if (key.castShadow) {
    key.shadow.mapSize.set(2048, 2048);
    const cam = key.shadow.camera as THREE.OrthographicCamera;
    cam.left = -95;
    cam.right = 95;
    cam.top = 95;
    cam.bottom = -95;
    cam.near = 10;
    cam.far = 360;
    key.shadow.bias = -0.0007;
    key.shadow.normalBias = 0.035;
  }
  scene.add(key);
  scene.add(key.target);

  // A soft fill opposite the key keeps shadowed faces readable without
  // flattening the silhouette.
  const fill = new THREE.DirectionalLight(
    spec.atmosphere.lighting.ambientColor,
    Math.max(0.5, spec.atmosphere.lighting.keyIntensity * 2.1),
  );
  fill.position.set(-sky.sunDirection.x * 110, 68, -sky.sunDirection.z * 110);
  fill.target.position.set(0, 0, 0);
  scene.add(fill);
  scene.add(fill.target);

  // Accent fires at architectural points.
  const accentLights: THREE.PointLight[] = [];
  const anchors = architecture.accentAnchors.slice(0, 7);
  for (const anchor of anchors) {
    const light = new THREE.PointLight(
      spec.atmosphere.lighting.accentColor,
      spec.atmosphere.lighting.accentIntensity * 16,
      30,
      2,
    );
    light.position.copy(anchor);
    scene.add(light);
    accentLights.push(light);
  }

  // Event staging: a drowned gate that rises, plus a column of light.
  let eventArch: THREE.Group | null = null;
  const primaryEvent = spec.events[0];
  if (primaryEvent && !opts.preview) {
    if (primaryEvent.kind === "eclipse-awakening" && spec.biome === "volcanic") {
      const archStructure = {
        id: "event-arch",
        kind: "arch" as const,
        x: spec.terrain.size * 0.235,
        y: spec.water.level - 8,
        z: spec.terrain.size * 0.035,
        rotY: 0.4,
        scale: 2.9,
        material: spec.stone,
      };
      const archBuild = buildArchitecture({ ...spec, structures: [archStructure] }, materials);
      eventArch = archBuild.group;
      eventArch.position.y = 0;
      scene.add(eventArch);
    }
  }

  const beam = primaryEvent && !opts.preview ? createBeam(EVENT_COLORS[primaryEvent.kind]) : null;
  if (beam && primaryEvent) {
    const trigger =
      spec.interactions.find((i) => i.eventId === primaryEvent.id) ??
      spec.interactions.find((i) => i.discoveryId === primaryEvent.discoveryId);
    const p = trigger?.position ?? { x: 0, y: spec.camera.spawn.y, z: 0 };
    beam.mesh.position.set(p.x, p.y - 1.5, p.z);
    scene.add(beam.mesh);
  }

  // --- Event visuals -------------------------------------------------
  let progress = 0;
  let target = 0;
  let kind: EventKind | null = primaryEvent?.kind ?? null;
  let speed = 1 / 6;
  let baseKey = key.intensity;
  let baseHemi = hemi.intensity;
  let baseAmbient = ambient.intensity;
  let baseAccent = spec.atmosphere.lighting.accentIntensity * 16;
  let baseCorona = spec.atmosphere.sky.corona;
  let baseFogDensity = spec.atmosphere.fog.density;
  const baseSunColor = new THREE.Color(spec.atmosphere.sky.sunColor);
  const baseHorizon = new THREE.Color(spec.atmosphere.sky.horizon);
  const accentColor = new THREE.Color(spec.accentColor);
  const eventColor = new THREE.Color(EVENT_COLORS[primaryEvent?.kind ?? "eclipse-awakening"]);


  const applyEvents = () => {
    if (!kind) return;
    const p = progress;
    const c = eventColor;
    key.intensity = baseKey * (1 + p * 0.55);
    hemi.intensity = baseHemi * (1 + p * 0.75);
    ambient.intensity = baseAmbient * (1 + p * 0.8);
    for (const light of accentLights) {
      light.intensity = baseAccent * (1 + p * 1.9);
      light.color.copy(accentColor).lerp(c, p * 0.75);
    }
    materials.accent.emissiveIntensity = 0.75 + p * 2.1;
    materials.accent.emissive.copy(accentColor).lerp(c, p * 0.6);

    sky.material.uniforms.uCorona.value = baseCorona + p * (kind === "eclipse-awakening" ? 1.5 : 0.55);
    (sky.material.uniforms.uSunColor.value as THREE.Color).copy(baseSunColor).lerp(c, p * 0.55);
    (sky.material.uniforms.uHorizon.value as THREE.Color).copy(baseHorizon).lerp(c, p * 0.18);
    (scene.fog as THREE.FogExp2).density = baseFogDensity * (1 - p * 0.35);

    getWater()?.setEventGlow(p * 1.1, `#${c.getHexString()}`);
    beam?.setStrength(p * 1.25);
    particles?.setBoost(p * 1.1);
    nature.canopyMaterial.emissive.set(c);
    nature.canopyMaterial.emissiveIntensity = p * (kind === "grove-bloom" ? 0.4 : 0.12);

    if (eventArch) {
      const eased = p * p * (3 - 2 * p);
      eventArch.position.y = eased * 8.5;
    }
  };

  function getWater() {
    return water;
  }

  // --- Animation -----------------------------------------------------

  const built: BuiltWorld = {
    scene,
    sampler: terrain.sampler,
    colliders: [...architecture.colliders, ...nature.colliders],
    sky,
    water,
    terrain,
    particles,
    beacons,
    accentLights,
    update(dt, time, camera) {
      sky.mesh.position.copy(camera.position);
      sky.material.uniforms.uTime.value = time;
      if (water) {
        water.update(spec.water, spec.atmosphere.fog, time);
        setWaterSun(water, sky.sunDirection, spec.atmosphere.sky.sunColor, spec.atmosphere.sky.horizon);
      }
      if (particles) particles.update(dt, time, camera);
      for (const beacon of beacons.values()) beacon.update(time);
      beam?.update(time);

      if (progress !== target) {
        const step = speed * dt;
        progress = target > progress ? Math.min(target, progress + step) : Math.max(target, progress - step);
        applyEvents();
      } else if (progress > 0) {
        applyEvents();
      }

      if (motes) {
        motes.rotation.y = time * 0.004;
        motes.position.y = Math.sin(time * 0.12) * 1.2;
      }
    },
    setAtmosphere(next) {
      sky.update(next.atmosphere.sky, 0);
      const fog = scene.fog as THREE.FogExp2;
      fog.color.set(next.atmosphere.fog.color);
      fog.density = next.atmosphere.fog.density;
      baseFogDensity = next.atmosphere.fog.density;
      key.color.set(next.atmosphere.lighting.keyColor);
      key.intensity = next.atmosphere.lighting.keyIntensity;
      fill.color.set(next.atmosphere.lighting.ambientColor);
      fill.intensity = Math.max(0.5, next.atmosphere.lighting.keyIntensity * 2.1);
      key.position.copy(sky.sunDirection).multiplyScalar(140);
      key.position.y = Math.max(key.position.y, 26);
      baseKey = key.intensity;
      hemi.color.set(next.atmosphere.sky.horizon);
      hemi.groundColor.set(next.terrain.lowColor);
      hemi.intensity = next.atmosphere.lighting.ambientIntensity * 1.35;
      baseHemi = hemi.intensity;
      ambient.color.set(next.atmosphere.lighting.ambientColor);
      ambient.intensity = next.atmosphere.lighting.ambientIntensity * 0.8;
      baseAmbient = ambient.intensity;
      baseAccent = next.atmosphere.lighting.accentIntensity * 16;
      for (const light of accentLights) light.intensity = baseAccent;
      baseCorona = next.atmosphere.sky.corona;
      baseSunColor.set(next.atmosphere.sky.sunColor);
      baseHorizon.set(next.atmosphere.sky.horizon);
      if (water) {
        water.update(next.water, next.atmosphere.fog, 0);
        setWaterSun(water, sky.sunDirection, next.atmosphere.sky.sunColor, next.atmosphere.sky.horizon);
      }
      applyEvents();
    },
    setDiscovered(ids) {
      for (const [id, beacon] of beacons) {
        const interaction = spec.interactions.find((i) => i.id === id);
        beacon.setDiscovered(Boolean(interaction?.discoveryId && ids.includes(interaction.discoveryId)));
      }
    },
    playEvent(nextKind, duration) {
      kind = nextKind;
      eventColor.set(EVENT_COLORS[nextKind]);
      target = 1;
      speed = 1 / Math.max(0.6, duration);
    },
    resolveEvent(nextKind) {
      kind = nextKind;
      eventColor.set(EVENT_COLORS[nextKind]);
      progress = 1;
      target = 1;
      applyEvents();
    },
    resetEvent() {
      target = 0;
      speed = 1 / 1.4;
      if (eventArch) eventArch.position.y = 8.5;
    },
    isEventActive() {
      return progress > 0.01;
    },
    dispose() {
      if (water) {
        scene.remove(water.mesh);
        water.dispose();
      }
      scene.remove(terrain.mesh);
      terrain.dispose();
      scene.remove(sky.mesh);
      sky.dispose();
      scene.remove(architecture.group);
      architecture.group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) mesh.geometry.dispose();
      });
      scene.remove(nature.group);
      nature.dispose();
      materials.dispose();
      if (particles) {
        scene.remove(particles.points);
        particles.dispose();
      }
      for (const beacon of beacons.values()) beacon.dispose();
      if (beam) {
        scene.remove(beam.mesh);
        beam.dispose();
      }
      if (eventArch) {
        scene.remove(eventArch);
        eventArch.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) mesh.geometry.dispose();
        });
      }
      if (motes) {
        scene.remove(motes);
        motes.geometry.dispose();
        (motes.material as THREE.Material).dispose();
      }
      key.dispose();
      fill.dispose();
      hemi.dispose();
      ambient.dispose();
      for (const light of accentLights) light.dispose();
      scene.clear();
    },
  };

  if (primaryEvent && spec.exploration.eventStates[primaryEvent.id] === "resolved") {
    built.resolveEvent(primaryEvent.kind);
  }

  return built;
}