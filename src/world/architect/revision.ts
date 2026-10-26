/**
 * AI World Architect — natural-language revision.
 *
 * A revision is the only thing a follow-up instruction is allowed to change:
 * the same `WorldEdits` surface the human editor exposes, plus a truthful
 * `reply` and an `unsupported` list for requests the engine cannot honour
 * (per the directive: map to a supported equivalent or say so — never
 * pretend geometry exists).
 *
 * Applying a revision merges edits onto the current spec and re-validates
 * through `parseWorld`. Discoveries, event states, position and the generated
 * base all survive untouched.
 */

import { z } from "zod";
import { parseWorld } from "../schema";
import type { WorldEdits, WorldSpec } from "../types";

const clampNum = (min: number, max: number) => (v: number) => Math.min(max, Math.max(min, v));
const trimmed = (max: number) => (v: string) => v.trim().replace(/\s+/g, " ").slice(0, max);

const hexColor = z
  .string()
  .transform((s) => {
    const t = s.trim().toLowerCase();
    return t.startsWith("#") ? t : `#${t}`;
  })
  .pipe(z.string().regex(/^#[0-9a-f]{6}$/, "expected a #rrggbb colour"));

const TIMES = ["dawn", "day", "dusk", "night", "eclipse"] as const;
const SKIES = ["eclipse", "sun", "moon", "overcast", "cloudsea"] as const;
const PARTICLES = ["embers", "mist", "snow", "dust", "fireflies", "rain", "none"] as const;

/* ------------------------------------------------------------------ */
/*  Revision schema — mirrors WorldEdits, every number clamped         */
/* ------------------------------------------------------------------ */

export const revisionSchema = z.object({
  edits: z
    .object({
      timeOfDay: z.enum(TIMES).optional(),
      skyKind: z.enum(SKIES).optional(),
      fogDensity: z.number().transform(clampNum(0.0005, 0.03)).optional(),
      fogColor: hexColor.optional(),
      keyIntensity: z.number().transform(clampNum(0.05, 4)).optional(),
      ambientIntensity: z.number().transform(clampNum(0.05, 2.5)).optional(),
      accentIntensity: z.number().transform(clampNum(0, 8)).optional(),
      terrainRoughness: z.number().transform(clampNum(0.1, 1)).optional(),
      terrainAmplitude: z.number().transform(clampNum(0.2, 1.5)).optional(),
      vegetationDensity: z.number().transform(clampNum(0, 1)).optional(),
      rockDensity: z.number().transform(clampNum(0, 1)).optional(),
      waterColor: hexColor.optional(),
      waveHeight: z.number().transform(clampNum(0, 1.5)).optional(),
      particleKind: z.enum(PARTICLES).optional(),
      particleDensity: z.number().transform(clampNum(0, 1)).optional(),
      stoneColor: hexColor.optional(),
      landmarkScale: z.number().transform(clampNum(0.5, 2)).optional(),
      landmarkRotation: z.number().transform(clampNum(-180, 180)).optional(),
      landmarkVisible: z.boolean().optional(),
    })
    .prefault({}),
  /** One or two honest sentences: what changed, and what could not. */
  reply: z.string().transform(trimmed(280)).pipe(z.string().min(4)),
  /** Requests the engine cannot represent, stated plainly. */
  unsupported: z
    .array(z.string().transform(trimmed(120)))
    .default([])
    .transform((list) => list.slice(0, 4)),
});

export type WorldRevision = z.infer<typeof revisionSchema>;

/* ------------------------------------------------------------------ */
/*  Context sent to the model — compact, never the raw geometry        */
/* ------------------------------------------------------------------ */

export interface RevisionContext {
  name: string;
  prompt: string;
  biome: WorldSpec["biome"];
  timeOfDay: WorldSpec["timeOfDay"];
  atmosphere: {
    sky: WorldSpec["atmosphere"]["sky"];
    fog: WorldSpec["atmosphere"]["fog"];
    lighting: WorldSpec["atmosphere"]["lighting"];
    particles: WorldSpec["atmosphere"]["particles"];
  };
  terrain: { type: string; roughness: number; amplitude: number };
  water: { enabled: boolean; color: string; waveHeight: number };
  vegetation: { density: number };
  geology: { rockDensity: number };
  stone: string;
  stoneColor: string;
  hasLandmark: boolean;
  discoveries: string[];
  events: string[];
  currentEdits: WorldEdits;
}

export function revisionContext(spec: WorldSpec): RevisionContext {
  return {
    name: spec.name,
    prompt: spec.prompt,
    biome: spec.biome,
    timeOfDay: spec.timeOfDay,
    atmosphere: spec.atmosphere,
    terrain: { type: spec.terrain.type, roughness: spec.terrain.roughness, amplitude: spec.terrain.amplitude },
    water: { enabled: spec.water.enabled, color: spec.water.color, waveHeight: spec.water.waveHeight },
    vegetation: { density: spec.vegetation.density },
    geology: { rockDensity: spec.geology.rockDensity },
    stone: spec.stone,
    stoneColor: spec.stoneColor,
    hasLandmark: spec.structures.some((s) => s.landmark),
    discoveries: spec.discoveries.map((d) => d.title),
    events: spec.events.map((e) => e.title),
    currentEdits: spec.edits,
  };
}

/* ------------------------------------------------------------------ */
/*  Apply                                                              */
/* ------------------------------------------------------------------ */

/**
 * Merge revision edits into the spec. Exploration state (position,
 * discoveries, event states) is carried over untouched; `parseWorld`
 * re-validates the whole document before the renderer sees it.
 */
export function applyRevision(spec: WorldSpec, revision: WorldRevision): WorldSpec {
  const cleanEdits = Object.fromEntries(
    Object.entries(revision.edits).filter(([, value]) => value !== undefined),
  ) as WorldEdits;
  return parseWorld({
    ...spec,
    edits: { ...spec.edits, ...cleanEdits },
    updatedAt: Date.now(),
  });
}

/* ------------------------------------------------------------------ */
/*  JSON Schema for OpenRouter structured outputs                      */
/* ------------------------------------------------------------------ */

const hex = { type: "string", pattern: "^#?[0-9a-fA-F]{6}$" } as const;
const ranged = (min: number, max: number) => ({ type: "number", minimum: min, maximum: max }) as const;

export const REVISION_JSON_SCHEMA = {
  name: "mythos_world_revision",
  strict: false,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["edits", "reply", "unsupported"],
    properties: {
      edits: {
        type: "object",
        additionalProperties: false,
        description: "Only the fields the instruction asks to change.",
        properties: {
          timeOfDay: { type: "string", enum: TIMES },
          skyKind: { type: "string", enum: SKIES },
          fogDensity: ranged(0.0005, 0.03),
          fogColor: hex,
          keyIntensity: ranged(0.05, 4),
          ambientIntensity: ranged(0.05, 2.5),
          accentIntensity: ranged(0, 8),
          terrainRoughness: ranged(0.1, 1),
          terrainAmplitude: ranged(0.2, 1.5),
          vegetationDensity: ranged(0, 1),
          rockDensity: ranged(0, 1),
          waterColor: hex,
          waveHeight: ranged(0, 1.5),
          particleKind: { type: "string", enum: PARTICLES },
          particleDensity: ranged(0, 1),
          stoneColor: hex,
          landmarkScale: ranged(0.5, 2),
          landmarkRotation: ranged(-180, 180),
          landmarkVisible: { type: "boolean" },
        },
      },
      reply: { type: "string", description: "What changed and what could not, in 1–2 sentences." },
      unsupported: { type: "array", maxItems: 4, items: { type: "string" } },
    },
  },
} as const;
