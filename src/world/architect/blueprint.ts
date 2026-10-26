/**
 * AI World Architect — blueprint layer.
 *
 * A blueprint is the *plan* an external model produces for a world: theme,
 * biome, palette, atmosphere, scale and the written layer (names, discovery
 * prose, event text). It is deliberately small and forgiving:
 *
 *  - Every numeric field is clamped, every count is capped.
 *  - Unknown properties are stripped; invalid ones are rejected so the
 *    server can retry with feedback.
 *  - No code, URLs, asset paths or shader source can appear anywhere — the
 *    blueprint only ever selects from the engine's existing building blocks.
 *
 * The blueprint is converted into the same `Interpretation` the keyword
 * interpreter produces, so `buildWorld` — layouts, geometry, validation — is
 * shared verbatim between procedural and AI generation.
 */

import { z } from "zod";
import { biomePalette, emptyInterpretation, type Interpretation } from "../interpreter";
import { parseWorld } from "../schema";
import type { WorldSpec } from "../types";

/* ------------------------------------------------------------------ */
/*  Clamping helpers                                                   */
/* ------------------------------------------------------------------ */

const clampNum = (min: number, max: number) => (v: number) => Math.min(max, Math.max(min, v));

const trimmed = (max: number) => (v: string) => v.trim().replace(/\s+/g, " ").slice(0, max);

const hexColor = z
  .string()
  .transform((s) => {
    const t = s.trim().toLowerCase();
    return t.startsWith("#") ? t : `#${t}`;
  })
  .pipe(z.string().regex(/^#[0-9a-f]{6}$/, "expected a #rrggbb colour"));

/* ------------------------------------------------------------------ */
/*  Blueprint schema                                                   */
/* ------------------------------------------------------------------ */

const BIOMES = ["volcanic", "forest", "desert", "tundra", "celestial"] as const;
const TIMES = ["dawn", "day", "dusk", "night", "eclipse"] as const;
const STONES = ["obsidian", "sandstone", "granite", "marble", "ice", "wood", "metal"] as const;
const TERRAINS = ["islands", "rolling", "dunes", "ice", "plateau"] as const;
const PARTICLES = ["embers", "mist", "snow", "dust", "fireflies", "rain", "none"] as const;
const DISCOVERY_KINDS = ["artifact", "secret", "landmark", "clue"] as const;

export const MAX_DISCOVERIES = 5;
export const MAX_NOTES = 6;

const featureFlags = z
  .object({
    floating: z.boolean().default(false),
    eclipse: z.boolean().default(false),
    frozen: z.boolean().default(false),
    ruins: z.boolean().default(false),
    monumental: z.boolean().default(false),
    city: z.boolean().default(false),
    tree: z.boolean().default(false),
    ocean: z.boolean().default(false),
    desert: z.boolean().default(false),
    forest: z.boolean().default(false),
    observatory: z.boolean().default(false),
    cathedral: z.boolean().default(false),
    statues: z.boolean().default(false),
  })
  .prefault({});

const paletteOverrides = z
  .object({
    accent: hexColor.optional(),
    fog: hexColor.optional(),
    skyTop: hexColor.optional(),
    skyHorizon: hexColor.optional(),
    water: hexColor.optional(),
    waterDeep: hexColor.optional(),
    terrainLow: hexColor.optional(),
    terrainHigh: hexColor.optional(),
    rock: hexColor.optional(),
    canopy: hexColor.optional(),
  })
  .prefault({});

const discoveryDraft = z.object({
  title: z.string().transform(trimmed(60)).pipe(z.string().min(2)),
  text: z.string().transform(trimmed(320)).pipe(z.string().min(8)),
  kind: z.enum(DISCOVERY_KINDS),
});

export const blueprintSchema = z.object({
  name: z.string().transform(trimmed(60)).pipe(z.string().min(2)),
  /** One-paragraph world summary; becomes the spec description. */
  summary: z.string().transform(trimmed(280)).pipe(z.string().min(10)),
  biome: z.enum(BIOMES),
  timeOfDay: z.enum(TIMES),
  stone: z.enum(STONES),
  terrain: z.enum(TERRAINS),
  water: z.boolean(),
  /** World scale bias. 0.78 intimate – 1.5 colossal. */
  scale: z.number().transform(clampNum(0.78, 1.5)),
  vegetation: z.number().transform(clampNum(0, 1)),
  rocky: z.number().transform(clampNum(0, 1)),
  particles: z.enum(PARTICLES),
  features: featureFlags,
  palette: paletteOverrides,
  landmark: z.object({
    name: z.string().transform(trimmed(60)).pipe(z.string().min(2)),
    description: z.string().transform(trimmed(240)).pipe(z.string().min(8)),
  }),
  discoveries: z
    .array(discoveryDraft)
    .default([])
    .transform((list) => list.slice(0, MAX_DISCOVERIES)),
  event: z
    .object({
      title: z.string().transform(trimmed(60)).pipe(z.string().min(2)),
      description: z.string().transform(trimmed(280)).pipe(z.string().min(8)),
    })
    .nullish()
    .default(null),
  /** Short planner remarks surfaced in the world's generation notes. */
  notes: z
    .array(z.string().transform(trimmed(120)))
    .default([])
    .transform((list) => list.slice(0, MAX_NOTES)),
});

export type WorldBlueprint = z.infer<typeof blueprintSchema>;

/* ------------------------------------------------------------------ */
/*  Blueprint → engine intent                                          */
/* ------------------------------------------------------------------ */

/** Map a validated blueprint onto the same intent the keyword interpreter emits. */
export function blueprintToInterpretation(bp: WorldBlueprint): Interpretation {
  const i = emptyInterpretation();
  i.biome = bp.biome;
  i.timeOfDay = bp.timeOfDay;
  i.stone = bp.stone;
  i.terrain = bp.terrain;
  i.particle = bp.particles;
  i.water = bp.water;
  i.vegetation = bp.vegetation;
  i.rocky = bp.rocky;
  i.scaleBias = bp.scale;
  i.features = { ...i.features, ...bp.features };
  const base = biomePalette(bp.biome);
  for (const [key, value] of Object.entries(bp.palette)) {
    if (value !== undefined) (base as Record<string, string>)[key] = value;
  }
  i.palette = base;
  i.notes = ["Planned by the AI World Architect.", ...bp.notes];
  return i;
}

/**
 * Overlay the blueprint's written layer onto a built spec. Geometry, positions
 * and interaction wiring come from the proven deterministic layouts and are
 * never touched — only names and prose move. The result is re-validated
 * against the world schema before it is allowed near the renderer.
 */
export function applyBlueprintNarrative(spec: WorldSpec, bp: WorldBlueprint): WorldSpec {
  const next = structuredClone(spec);

  bp.discoveries.forEach((draft, index) => {
    const target = next.discoveries[index];
    if (!target) return;
    next.discoveries[index] = { ...target, title: draft.title, text: draft.text, kind: draft.kind };
  });

  if (bp.event && next.events.length > 0) {
    next.events[0] = { ...next.events[0], title: bp.event.title, description: bp.event.description };
  }

  const landmarkDiscovery = next.discoveries.find((d) => d.kind === "landmark");
  if (landmarkDiscovery && bp.landmark) {
    landmarkDiscovery.title = bp.landmark.name;
    landmarkDiscovery.text = bp.landmark.description;
  }

  return parseWorld(next);
}

/* ------------------------------------------------------------------ */
/*  JSON Schema for OpenRouter structured outputs                      */
/* ------------------------------------------------------------------ */

const hex = { type: "string", pattern: "^#?[0-9a-fA-F]{6}$" } as const;

/**
 * Loose (non-strict) JSON Schema mirroring `blueprintSchema`. Strict mode is
 * avoided deliberately: `openrouter/free` routes across providers with uneven
 * structured-output support, and the authoritative validation is the zod
 * parse server-side — this schema is a strong hint, not the gatekeeper.
 */
export const BLUEPRINT_JSON_SCHEMA = {
  name: "mythos_world_blueprint",
  strict: false,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "name",
      "summary",
      "biome",
      "timeOfDay",
      "stone",
      "terrain",
      "water",
      "scale",
      "vegetation",
      "rocky",
      "particles",
      "features",
      "palette",
      "landmark",
      "discoveries",
      "event",
      "notes",
    ],
    properties: {
      name: { type: "string", description: "Evocative world name, 2–60 chars." },
      summary: { type: "string", description: "One-paragraph world description, max 280 chars." },
      biome: { type: "string", enum: BIOMES },
      timeOfDay: { type: "string", enum: TIMES },
      stone: { type: "string", enum: STONES },
      terrain: { type: "string", enum: TERRAINS },
      water: { type: "boolean" },
      scale: { type: "number", minimum: 0.78, maximum: 1.5, description: "0.78 intimate, 1 grand, 1.5 colossal." },
      vegetation: { type: "number", minimum: 0, maximum: 1 },
      rocky: { type: "number", minimum: 0, maximum: 1 },
      particles: { type: "string", enum: PARTICLES },
      features: {
        type: "object",
        additionalProperties: false,
        properties: Object.fromEntries(
          [
            "floating",
            "eclipse",
            "frozen",
            "ruins",
            "monumental",
            "city",
            "tree",
            "ocean",
            "desert",
            "forest",
            "observatory",
            "cathedral",
            "statues",
          ].map((f) => [f, { type: "boolean" }]),
        ),
      },
      palette: {
        type: "object",
        additionalProperties: false,
        description: "Optional #rrggbb overrides on the biome palette.",
        properties: {
          accent: hex,
          fog: hex,
          skyTop: hex,
          skyHorizon: hex,
          water: hex,
          waterDeep: hex,
          terrainLow: hex,
          terrainHigh: hex,
          rock: hex,
          canopy: hex,
        },
      },
      landmark: {
        type: "object",
        additionalProperties: false,
        required: ["name", "description"],
        properties: {
          name: { type: "string" },
          description: { type: "string", description: "What the main landmark is and means." },
        },
      },
      discoveries: {
        type: "array",
        maxItems: MAX_DISCOVERIES,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "text", "kind"],
          properties: {
            title: { type: "string" },
            text: { type: "string", description: "Prose revealed on discovery, max 320 chars." },
            kind: { type: "string", enum: DISCOVERY_KINDS },
          },
        },
      },
      event: {
        anyOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["title", "description"],
            properties: {
              title: { type: "string" },
              description: { type: "string" },
            },
          },
          { type: "null" },
        ],
      },
      notes: { type: "array", maxItems: MAX_NOTES, items: { type: "string" } },
    },
  },
} as const;
