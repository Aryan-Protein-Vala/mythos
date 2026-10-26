import * as THREE from "three";
import type { SkyKind, TimeOfDay, WorldEdits, WorldSpec } from "./types";

interface TimeLook {
  top: string;
  horizon: string;
  sunColor: string;
  keyScale: number;
  ambientScale: number;
  stars: number;
  corona: number;
  disc: number;
  fogTint: string;
  fogScale: number;
  fogStrength: number;
}

const TIME_LOOKS: Record<TimeOfDay, TimeLook> = {
  dawn: {
    top: "#2b3440",
    horizon: "#c79a78",
    sunColor: "#f3d3b2",
    keyScale: 0.9,
    ambientScale: 1.2,
    stars: 0.12,
    corona: 0.14,
    disc: 5.6,
    fogTint: "#8e7d6b",
    fogScale: 1.25,
    fogStrength: 0.55,
  },
  day: {
    top: "#8b9aa4",
    horizon: "#d6d0bd",
    sunColor: "#fff2da",
    keyScale: 1.9,
    ambientScale: 1.7,
    stars: 0,
    corona: 0,
    disc: 5,
    fogTint: "#c9c4b4",
    fogScale: 0.85,
    fogStrength: 0.4,
  },
  dusk: {
    top: "#262d3a",
    horizon: "#b97a50",
    sunColor: "#ff9d5c",
    keyScale: 1.1,
    ambientScale: 1,
    stars: 0.12,
    corona: 0.22,
    disc: 7.2,
    fogTint: "#6f5a48",
    fogScale: 1.05,
    fogStrength: 0.5,
  },
  night: {
    top: "#05070d",
    horizon: "#151d2a",
    sunColor: "#9db6d8",
    keyScale: 0.3,
    ambientScale: 0.62,
    stars: 0.95,
    corona: 0,
    disc: 5,
    fogTint: "#0a0f16",
    fogScale: 1.1,
    fogStrength: 0.75,
  },
  eclipse: {
    top: "#05060a",
    horizon: "#201814",
    sunColor: "#efe0c2",
    keyScale: 0.62,
    ambientScale: 0.9,
    stars: 0.4,
    corona: 1,
    disc: 9.5,
    fogTint: "#12151a",
    fogScale: 0.9,
    fogStrength: 0.55,
  },
};

function mix(base: string, target: string, t: number): string {
  return `#${new THREE.Color(base).lerp(new THREE.Color(target), t).getHexString()}`;
}

/** Returns a new specification with editor overrides resolved. Never mutates input. */
export function resolveWorld(spec: WorldSpec): WorldSpec {
  const edits: WorldEdits = spec.edits ?? {};
  const out: WorldSpec = structuredClone(spec);

  // --- Time of day -------------------------------------------------
  if (edits.timeOfDay && edits.timeOfDay !== spec.timeOfDay) {
    const look = TIME_LOOKS[edits.timeOfDay];
    const sky = out.atmosphere.sky;
    sky.top = mix(sky.top, look.top, 0.72);
    sky.horizon = mix(sky.horizon, look.horizon, 0.78);
    sky.sunColor = mix(sky.sunColor, look.sunColor, 0.8);
    sky.sunIntensity *= look.keyScale;
    sky.sunIntensity = Math.min(6, Math.max(0.05, sky.sunIntensity));
    sky.corona = Math.max(sky.corona * 0.3, look.corona);
    sky.stars = Math.max(sky.stars * 0.4, look.stars);
    sky.discSize = look.disc;
    out.atmosphere.lighting.keyIntensity = sky.sunIntensity;
    out.atmosphere.lighting.keyColor = sky.sunColor;
    out.atmosphere.lighting.ambientIntensity = Math.min(
      3,
      Math.max(0.06, spec.atmosphere.lighting.ambientIntensity * look.ambientScale),
    );
    out.atmosphere.fog.color = mix(out.atmosphere.fog.color, look.fogTint, look.fogStrength);
    out.atmosphere.fog.density = Math.min(0.04, out.atmosphere.fog.density * look.fogScale);
    out.timeOfDay = edits.timeOfDay;
  }

  // --- Sky preset ---------------------------------------------------
  if (edits.skyKind && edits.skyKind !== spec.atmosphere.sky.kind) {
    applySkyKind(out, edits.skyKind);
  }

  // --- Atmosphere overrides ----------------------------------------
  if (edits.fogDensity !== undefined) out.atmosphere.fog.density = edits.fogDensity;
  if (edits.fogColor) out.atmosphere.fog.color = edits.fogColor;
  if (edits.keyIntensity !== undefined) {
    out.atmosphere.lighting.keyIntensity = edits.keyIntensity;
    out.atmosphere.sky.sunIntensity = edits.keyIntensity;
  }
  if (edits.ambientIntensity !== undefined) out.atmosphere.lighting.ambientIntensity = edits.ambientIntensity;
  if (edits.accentIntensity !== undefined) out.atmosphere.lighting.accentIntensity = edits.accentIntensity;
  if (edits.particleKind) out.atmosphere.particles.kind = edits.particleKind;
  if (edits.particleDensity !== undefined) out.atmosphere.particles.density = edits.particleDensity;

  // --- Terrain ------------------------------------------------------
  if (edits.terrainRoughness !== undefined) out.terrain.roughness = edits.terrainRoughness;
  if (edits.terrainAmplitude !== undefined) out.terrain.amplitude = edits.terrainAmplitude;
  if (edits.rockDensity !== undefined) out.geology.rockDensity = edits.rockDensity;
  if (edits.vegetationDensity !== undefined) out.vegetation.density = edits.vegetationDensity;

  // --- Water --------------------------------------------------------
  if (edits.waterColor) {
    out.water.color = edits.waterColor;
    out.water.deepColor = mix(edits.waterColor, "#000000", 0.55);
  }
  if (edits.waveHeight !== undefined) out.water.waveHeight = edits.waveHeight;

  // --- Architecture -------------------------------------------------
  if (edits.stoneColor) {
    out.stoneColor = edits.stoneColor;
    out.terrain.rockColor = mix(edits.stoneColor, "#000000", 0.25);
  }
  const scale = edits.landmarkScale ?? 1;
  const rotation = THREE.MathUtils.degToRad(edits.landmarkRotation ?? 0);
  if (scale !== 1 || rotation !== 0) {
    out.structures = out.structures.map((s) =>
      s.landmark ? { ...s, scale: clampScale(s.scale * scale), rotY: s.rotY + rotation } : s,
    );
  }
  if (edits.landmarkVisible === false) {
    out.structures = out.structures.filter((s) => !s.landmark);
  }

  return out;
}

function clampScale(v: number): number {
  return Math.min(12, Math.max(0.1, v));
}

function applySkyKind(spec: WorldSpec, kind: SkyKind): void {
  const sky = spec.atmosphere.sky;
  sky.kind = kind;
  switch (kind) {
    case "eclipse":
      sky.corona = 1;
      sky.stars = Math.max(sky.stars, 0.35);
      sky.discSize = Math.max(sky.discSize, 9);
      sky.sunColor = "#efe0c2";
      sky.top = "#05060a";
      sky.horizon = "#201814";
      break;
    case "moon":
      sky.corona = 0;
      sky.stars = 1;
      sky.sunColor = "#c4d4e6";
      sky.top = "#05070d";
      sky.horizon = "#161f2c";
      sky.discSize = 5.5;
      break;
    case "overcast":
      sky.corona = 0;
      sky.stars = 0;
      sky.sunColor = "#e6e4da";
      sky.top = mix(sky.top, "#8f9799", 0.7);
      sky.horizon = mix(sky.horizon, "#c3c7c1", 0.75);
      sky.discSize = 3;
      break;
    case "cloudsea":
      sky.corona = 0;
      sky.stars = 0.08;
      sky.sunColor = "#f4ead6";
      sky.top = mix(sky.top, "#8798ae", 0.6);
      sky.horizon = mix(sky.horizon, "#e3dccb", 0.8);
      break;
    case "sun":
      sky.corona = 0;
      sky.stars = 0;
      sky.sunColor = "#fff2da";
      sky.top = mix(sky.top, "#7d94a6", 0.6);
      sky.horizon = mix(sky.horizon, "#d6cdb6", 0.7);
      break;
  }
}

export const TIME_OF_DAY_OPTIONS: Array<{ value: TimeOfDay; label: string }> = [
  { value: "dawn", label: "Dawn" },
  { value: "day", label: "Day" },
  { value: "dusk", label: "Dusk" },
  { value: "night", label: "Night" },
  { value: "eclipse", label: "Eclipse" },
];

export const SKY_OPTIONS: Array<{ value: SkyKind; label: string }> = [
  { value: "eclipse", label: "Eclipse" },
  { value: "sun", label: "Sun" },
  { value: "moon", label: "Moon" },
  { value: "overcast", label: "Overcast" },
  { value: "cloudsea", label: "Cloud sea" },
];