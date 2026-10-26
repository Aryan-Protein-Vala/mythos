import { z } from "zod";
import { SCHEMA_VERSION, type WorldSpec } from "./types.js";
import { clamp } from "./noise.js";

export class WorldValidationError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(issues[0] ?? "Invalid world specification.");
    this.name = "WorldValidationError";
    this.issues = issues;
  }
}

const bounded = (min: number, max: number) => z.number().min(min).max(max);

const hex = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Expected a 6-digit hex colour")
  .transform((v) => v.toLowerCase());

const vec3 = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite(),
});

const material = z.enum(["obsidian", "sandstone", "granite", "marble", "ice", "wood", "metal"]);

const structureKind = z.enum([
  "pillar",
  "arch",
  "wall",
  "stairs",
  "tower",
  "gate",
  "platform",
  "ruin",
  "spire",
  "temple",
  "dome",
  "monolith",
  "bridge",
  "throne",
  "observatory",
  "shrine",
  "floating-isle",
]);

const propKind = z.enum([
  "rock",
  "boulder",
  "crystal",
  "tree",
  "dead-tree",
  "palm",
  "grass",
  "island",
  "rubble",
  "obelisk",
]);

const structureSchema = z.object({
  id: z.string().min(1).max(64),
  kind: structureKind,
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite(),
  rotY: z.number().finite(),
  scale: bounded(0.1, 12),
  material,
  landmark: z.boolean().optional(),
  accent: z.boolean().optional(),
});

const propSchema = z.object({
  id: z.string().min(1).max(64),
  kind: propKind,
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite(),
  rotY: z.number().finite(),
  scale: bounded(0.05, 24),
  color: hex.optional(),
});

const interactionSchema = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(["inspect", "enter", "activate", "read", "descend"]),
  label: z.string().min(1).max(120),
  text: z.string().min(1).max(2000),
  position: vec3,
  radius: bounded(0.5, 20),
  discoveryId: z.string().max(64).optional(),
  eventId: z.string().max(64).optional(),
});

const discoverySchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(120),
  text: z.string().min(1).max(2000),
  kind: z.enum(["artifact", "secret", "landmark", "clue"]),
});

const eventSchema = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(["eclipse-awakening", "grove-bloom", "frontier-signal"]),
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(2000),
  triggerId: z.string().min(1).max(64),
  discoveryId: z.string().min(1).max(64),
  duration: bounded(0.5, 30),
});

const editsSchema = z
  .object({
    timeOfDay: z.enum(["dawn", "day", "dusk", "night", "eclipse"]).optional(),
    skyKind: z.enum(["eclipse", "sun", "moon", "overcast", "cloudsea"]).optional(),
    fogDensity: bounded(0, 0.04).optional(),
    fogColor: hex.optional(),
    keyIntensity: bounded(0, 6).optional(),
    ambientIntensity: bounded(0, 3).optional(),
    accentIntensity: bounded(0, 12).optional(),
    terrainRoughness: bounded(0, 1).optional(),
    terrainAmplitude: bounded(0, 60).optional(),
    vegetationDensity: bounded(0, 1).optional(),
    rockDensity: bounded(0, 1).optional(),
    waterColor: hex.optional(),
    waveHeight: bounded(0, 4).optional(),
    particleKind: z.enum(["embers", "mist", "snow", "dust", "fireflies", "rain", "none"]).optional(),
    particleDensity: bounded(0, 1).optional(),
    stoneColor: hex.optional(),
    landmarkScale: bounded(0.4, 2.5).optional(),
    landmarkRotation: bounded(-180, 180).optional(),
    landmarkVisible: z.boolean().optional(),
  })
  .default({});

export const worldSchema = z.object({
  schemaVersion: z.number().int().min(1).max(SCHEMA_VERSION),
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(600),
  prompt: z.string().min(1).max(2000),
  seed: z.string().min(1).max(80),
  biome: z.enum(["volcanic", "forest", "desert", "tundra", "celestial"]),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
  timeOfDay: z.enum(["dawn", "day", "dusk", "night", "eclipse"]),
  atmosphere: z.object({
    sky: z.object({
      kind: z.enum(["eclipse", "sun", "moon", "overcast", "cloudsea"]),
      top: hex,
      horizon: hex,
      sunColor: hex,
      sunIntensity: bounded(0, 6),
      sunAzimuth: bounded(0, 360),
      sunElevation: bounded(1, 89),
      discSize: bounded(0.5, 16),
      corona: bounded(0, 1),
      stars: bounded(0, 1),
    }),
    fog: z.object({
      color: hex,
      density: bounded(0, 0.04),
    }),
    lighting: z.object({
      keyIntensity: bounded(0, 6),
      ambientIntensity: bounded(0, 3),
      keyColor: hex,
      ambientColor: hex,
      accentColor: hex,
      accentIntensity: bounded(0, 12),
    }),
    particles: z.object({
      kind: z.enum(["embers", "mist", "snow", "dust", "fireflies", "rain", "none"]),
      density: bounded(0, 1),
      color: hex,
    }),
  }),
  terrain: z.object({
    type: z.enum(["islands", "rolling", "dunes", "ice", "plateau"]),
    pads: z
      .array(
        z.object({
          x: z.number().finite(),
          z: z.number().finite(),
          radius: bounded(1, 400),
          height: z.number().finite().min(-40).max(80),
          blend: bounded(0.05, 2.5),
        }),
      )
      .max(24),
    size: bounded(80, 600),
    roughness: bounded(0, 1),
    amplitude: bounded(0, 60),
    lowColor: hex,
    highColor: hex,
    rockColor: hex,
    snow: bounded(0, 1),
  }),
  water: z.object({
    enabled: z.boolean(),
    level: z.number().finite().min(-20).max(40),
    color: hex,
    deepColor: hex,
    waveHeight: bounded(0, 4),
    roughness: bounded(0, 1),
    opacity: bounded(0, 1),
  }),
  vegetation: z.object({
    density: bounded(0, 1),
    scale: bounded(0.2, 5),
    kinds: z.array(z.enum(["tree", "dead-tree", "palm", "grass"])).max(4),
    canopyColor: hex,
    trunkColor: hex,
  }),
  geology: z.object({
    rockDensity: bounded(0, 1),
    crystalDensity: bounded(0, 1),
    crystalColor: hex,
  }),
  stone: material,
  stoneColor: hex,
  accentColor: hex,
  structures: z.array(structureSchema).max(400),
  props: z.array(propSchema).max(3000),
  camera: z.object({
    fov: bounded(45, 100),
    eyeHeight: bounded(0.8, 4),
    speed: bounded(1, 20),
    spawn: vec3,
    lookAt: vec3,
  }),
  audio: z.object({
    ambience: z.enum(["wind", "ocean", "forest", "desert", "none"]),
    volume: bounded(0, 1),
  }),
  interactions: z.array(interactionSchema).max(48),
  discoveries: z.array(discoverySchema).max(64),
  events: z.array(eventSchema).max(16),
  generation: z.object({
    method: z.enum(["procedural", "ai"]),
    presetId: z.string().max(64).optional(),
    scale: z.enum(["intimate", "grand", "vast"]),
    notes: z.array(z.string().max(400)).max(24),
  }),
  edits: editsSchema,
  exploration: z.object({
    position: vec3,
    yaw: z.number().finite(),
    pitch: z.number().finite(),
    discoveries: z.array(z.string().max(64)).max(64),
    eventStates: z.record(z.string(), z.enum(["idle", "active", "resolved"])),
  }),
});

export interface ValidationResult {
  ok: boolean;
  spec?: WorldSpec;
  issues: string[];
  warnings: string[];
}

/** Parse and sanitise an untrusted value into a renderable WorldSpec. */
export function validateWorld(input: unknown): ValidationResult {
  const parsed = worldSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 8).map((i) => {
      const path = i.path.length ? `${i.path.join(".")}: ` : "";
      return `${path}${i.message}`;
    });
    return { ok: false, issues, warnings: [] };
  }

  const spec = parsed.data as WorldSpec;
  const warnings: string[] = [];

  // Referential integrity: an interaction must not point at a missing discovery
  // or event, otherwise the renderer would advertise something that cannot happen.
  const discoveryIds = new Set(spec.discoveries.map((d) => d.id));
  const eventIds = new Set(spec.events.map((e) => e.id));
  spec.interactions = spec.interactions.filter((i) => {
    if (i.discoveryId && !discoveryIds.has(i.discoveryId)) {
      warnings.push(`Interaction "${i.label}" referenced a missing discovery and was removed.`);
      return false;
    }
    if (i.eventId && !eventIds.has(i.eventId)) {
      warnings.push(`Interaction "${i.label}" referenced a missing event and was removed.`);
      return false;
    }
    return true;
  });

  // Keep spawn inside the world.
  const half = spec.terrain.size / 2;
  spec.camera.spawn = {
    x: clamp(spec.camera.spawn.x, -half, half),
    y: clamp(spec.camera.spawn.y, -50, 200),
    z: clamp(spec.camera.spawn.z, -half, half),
  };

  return { ok: true, spec, issues: [], warnings };
}

export function parseWorld(input: unknown): WorldSpec {
  const result = validateWorld(input);
  if (!result.ok || !result.spec) throw new WorldValidationError(result.issues);
  return result.spec;
}

/** Shape of the JSON file MYTHOS exports and imports. */
export const exportSchema = z.object({
  format: z.literal("mythos.world"),
  formatVersion: z.number().int().min(1).max(1),
  exportedAt: z.number().finite(),
  spec: z.unknown(),
});

export function parseExportedWorld(text: string): { spec: WorldSpec; warnings: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new WorldValidationError(["That file is not valid JSON."]);
  }
  const envelope = exportSchema.safeParse(raw);
  const candidate = envelope.success ? envelope.data.spec : raw;
  const result = validateWorld(candidate);
  if (!result.ok || !result.spec) {
    throw new WorldValidationError([
      "This file does not contain a MYTHOS world specification.",
      ...result.issues.slice(0, 4),
    ]);
  }
  return { spec: result.spec, warnings: result.warnings };
}