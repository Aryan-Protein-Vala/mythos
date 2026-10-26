/**
 * AI World Architect — test suite.
 *
 * Every model interaction is mocked: the OpenRouter HTTP call is injected
 * (`fetchImpl`) for the server core, and the browser's /api/architect fetch
 * is stubbed for store-level tests. No live API key is required anywhere.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_DISCOVERIES,
  applyBlueprintNarrative,
  blueprintSchema,
  blueprintToInterpretation,
} from "../world/architect/blueprint";
import { applyRevision, revisionContext, revisionSchema } from "../world/architect/revision";
import { architectStatus, extractJson, runArchitect } from "../server/architectCore";
import { buildWorld } from "../world/builder";
import { parseWorld, parseExportedWorld } from "../world/schema";
import { resolveWorld } from "../world/resolve";
import { serializeWorld } from "../storage/transfer";
import { loadWorld, saveWorld } from "../storage/db";
import { useMythos } from "../state/store";
import type { WorldBlueprint } from "../world/architect/blueprint";

/* ------------------------------------------------------------------ */
/*  Fixtures                                                           */
/* ------------------------------------------------------------------ */

const TUNDRA_BLUEPRINT = {
  name: "The Hollow Meridian",
  summary: "A drowned observatory on a frozen meridian line, beneath a low amber sun.",
  biome: "tundra",
  timeOfDay: "dusk",
  stone: "marble",
  terrain: "plateau",
  water: false,
  scale: 1.2,
  vegetation: 0.1,
  rocky: 0.7,
  particles: "snow",
  features: { monumental: true, observatory: true, frozen: true },
  palette: { accent: "#c8b89a", fog: "#aab4bb" },
  landmark: { name: "The Meridian Lens", description: "A great lens that once measured the turning sky." },
  discoveries: [
    { title: "The Frozen Index", text: "You read the catalogue frozen into the brass plate.", kind: "clue" },
    { title: "A Keeper's Oath", text: "You find the oath carved where the keepers swore it.", kind: "secret" },
  ],
  event: { title: "The Lens Turns", description: "Light returns to the dead instrument." },
  notes: ["Observatory requested", "Cold palette"],
};

const VOLCANIC_BLUEPRINT = {
  name: "The Ember Regatta",
  summary: "A harbour of black glass where ember-lit galleys drift between drowned towers.",
  biome: "volcanic",
  timeOfDay: "eclipse",
  stone: "obsidian",
  terrain: "islands",
  water: true,
  scale: 1.05,
  vegetation: 0.05,
  rocky: 0.6,
  particles: "embers",
  features: { monumental: true, ocean: true, eclipse: true, ruins: true },
  palette: { water: "#0a1016" },
  landmark: { name: "The Harbour Throne", description: "A seat for the tide that never comes." },
  discoveries: [
    { title: "The Mooring Bell", text: "You ring it once; the embers answer in kind.", kind: "artifact" },
  ],
  event: null,
  notes: ["Harbour theme"],
};

function openRouterResponse(content: unknown, status = 200): Response {
  const body = status === 200 ? { choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] } : { error: "upstream" };
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function buildAi(bp: WorldBlueprint, seed = "test-seed-1") {
  const built = buildWorld({
    prompt: "test prompt",
    prefs: { scale: "grand", atmosphere: "inherit", method: "ai" },
    interpretation: blueprintToInterpretation(bp),
    seed,
    name: bp.name,
    description: bp.summary,
  });
  return applyBlueprintNarrative(built, bp);
}

/* ------------------------------------------------------------------ */
/*  Blueprint schema                                                   */
/* ------------------------------------------------------------------ */

describe("blueprint schema", () => {
  it("parses a valid AI blueprint", () => {
    const bp = blueprintSchema.parse(TUNDRA_BLUEPRINT);
    expect(bp.name).toBe("The Hollow Meridian");
    expect(bp.biome).toBe("tundra");
    expect(bp.features.observatory).toBe(true);
    expect(bp.discoveries).toHaveLength(2);
  });

  it("rejects unsupported enum values", () => {
    expect(blueprintSchema.safeParse({ ...TUNDRA_BLUEPRINT, biome: "candyland" }).success).toBe(false);
    expect(blueprintSchema.safeParse({ ...TUNDRA_BLUEPRINT, timeOfDay: "teatime" }).success).toBe(false);
  });

  it("clamps numeric values and caps object counts", () => {
    const bp = blueprintSchema.parse({
      ...TUNDRA_BLUEPRINT,
      scale: 99,
      vegetation: -4,
      discoveries: Array.from({ length: 12 }, (_, i) => ({
        title: `Relic ${i}`,
        text: "You found it where the plan said it would be.",
        kind: "artifact",
      })),
    });
    expect(bp.scale).toBe(1.5);
    expect(bp.vegetation).toBe(0);
    expect(bp.discoveries).toHaveLength(MAX_DISCOVERIES);
  });

  it("normalises and validates colours", () => {
    const bp = blueprintSchema.parse({ ...TUNDRA_BLUEPRINT, palette: { fog: "AABBCC" } });
    expect(bp.palette.fog).toBe("#aabbcc");
    expect(
      blueprintSchema.safeParse({ ...TUNDRA_BLUEPRINT, palette: { fog: "url(http://evil.example/x.png)" } }).success,
    ).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  JSON extraction                                                    */
/* ------------------------------------------------------------------ */

describe("extractJson", () => {
  it("parses raw JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("unwraps code fences", () => {
    expect(extractJson('```json\n{"a":2}\n```')).toEqual({ a: 2 });
  });

  it("recovers the object from surrounding prose", () => {
    expect(extractJson('Here is the plan:\n{"a":3}\nHope this helps!')).toEqual({ a: 3 });
  });

  it("returns undefined for non-JSON", () => {
    expect(extractJson("no object here at all")).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/*  Server core (mocked OpenRouter)                                    */
/* ------------------------------------------------------------------ */

describe("architect core", () => {
  it("reports unavailability without credentials and never calls the network", async () => {
    const fetchImpl = vi.fn();
    expect(architectStatus({})).toEqual({ available: false, model: null });
    const result = await runArchitect({ mode: "generate", prompt: "a frozen observatory" }, { fetchImpl: fetchImpl as never });
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ ok: false, reason: "unavailable" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("accepts a valid structured response", async () => {
    const fetchImpl = vi.fn(async () => openRouterResponse(TUNDRA_BLUEPRINT));
    const result = await runArchitect(
      { mode: "generate", prompt: "a frozen observatory on a meridian" },
      { apiKey: "test-key", fetchImpl: fetchImpl as never },
    );
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("falls back to JSON-only mode when the provider rejects structured output", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(openRouterResponse({}, 400))
      .mockResolvedValueOnce(openRouterResponse(TUNDRA_BLUEPRINT));
    const result = await runArchitect(
      { mode: "generate", prompt: "a frozen observatory" },
      { apiKey: "test-key", fetchImpl: fetchImpl as never },
    );
    expect(result.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse((fetchImpl.mock.calls[1][1] as RequestInit).body as string);
    expect(secondBody.response_format).toBeUndefined();
  });

  it("retries once with feedback when validation fails, then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(openRouterResponse("this is not json"))
      .mockResolvedValueOnce(openRouterResponse(TUNDRA_BLUEPRINT));
    const result = await runArchitect(
      { mode: "generate", prompt: "a frozen observatory" },
      { apiKey: "test-key", fetchImpl: fetchImpl as never },
    );
    expect(result.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse((fetchImpl.mock.calls[1][1] as RequestInit).body as string);
    expect(secondBody.messages[1].content).toContain("rejected");
  });

  it("gives up after two attempts when content stays invalid", async () => {
    const fetchImpl = vi.fn(async () => openRouterResponse("still not json"));
    const result = await runArchitect(
      { mode: "generate", prompt: "a frozen observatory" },
      { apiKey: "test-key", fetchImpl: fetchImpl as never },
    );
    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({ ok: false, reason: "invalid" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry rate limits", async () => {
    const fetchImpl = vi.fn(async () => openRouterResponse({}, 429));
    const result = await runArchitect(
      { mode: "generate", prompt: "a frozen observatory" },
      { apiKey: "test-key", fetchImpl: fetchImpl as never },
    );
    expect(result.status).toBe(429);
    expect(result.body).toMatchObject({ ok: false, reason: "rate_limited" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("maps provider 5xx to provider_error without retrying", async () => {
    const fetchImpl = vi.fn(async () => openRouterResponse({}, 502));
    const result = await runArchitect(
      { mode: "generate", prompt: "a frozen observatory" },
      { apiKey: "test-key", fetchImpl: fetchImpl as never },
    );
    expect(result.body).toMatchObject({ ok: false, reason: "provider_error" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("maps aborts to timeout", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });
    const result = await runArchitect(
      { mode: "generate", prompt: "a frozen observatory" },
      { apiKey: "test-key", fetchImpl: fetchImpl as never },
    );
    expect(result.body).toMatchObject({ ok: false, reason: "timeout" });
  });

  it("classifies a body read aborted by the deadline as a timeout", async () => {
    const aborted = {
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => {
        throw new DOMException("aborted", "AbortError");
      },
    } as unknown as Response;
    const fetchImpl = vi.fn(async () => aborted);
    const result = await runArchitect(
      { mode: "generate", prompt: "a frozen observatory" },
      { apiKey: "test-key", fetchImpl: fetchImpl as never },
    );
    expect(result.status).toBe(504);
    expect(result.body).toMatchObject({ ok: false, reason: "timeout" });
  });

  it("retries once after an empty completion, then reports empty", async () => {
    const fetchImpl = vi.fn(async () => openRouterResponse("   "));
    const result = await runArchitect(
      { mode: "generate", prompt: "a frozen observatory" },
      { apiKey: "test-key", fetchImpl: fetchImpl as never },
    );
    expect(result.body).toMatchObject({ ok: false, reason: "empty" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries once when the provider returns an empty HTTP body", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 200 }))
      .mockResolvedValueOnce(openRouterResponse(TUNDRA_BLUEPRINT));
    const result = await runArchitect(
      { mode: "generate", prompt: "a frozen observatory" },
      { apiKey: "test-key", fetchImpl: fetchImpl as never },
    );
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("never leaks the API key into failure payloads", async () => {
    const key = "sk-or-v1-secret-that-must-not-leak";
    const fetchImpl = vi.fn(async () => openRouterResponse({}, 500));
    const result = await runArchitect(
      { mode: "generate", prompt: "a frozen observatory" },
      { apiKey: key, fetchImpl: fetchImpl as never },
    );
    expect(JSON.stringify(result.body)).not.toContain(key);
  });

  it("validates revisions through the same ladder", async () => {
    const revision = { edits: { fogDensity: 0.02, fogColor: "#8fa3b3" }, reply: "Colder air, denser fog.", unsupported: [] };
    const fetchImpl = vi.fn(async () => openRouterResponse(revision));
    const result = await runArchitect(
      { mode: "revise", prompt: "make it colder and foggier", spec: { name: "Test" } },
      { apiKey: "test-key", fetchImpl: fetchImpl as never },
    );
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true });
  });
});

/* ------------------------------------------------------------------ */
/*  Blueprint → renderer-compatible spec                               */
/* ------------------------------------------------------------------ */

describe("blueprint → world", () => {
  it("maps the blueprint onto engine intent", () => {
    const i = blueprintToInterpretation(blueprintSchema.parse(TUNDRA_BLUEPRINT));
    expect(i.biome).toBe("tundra");
    expect(i.timeOfDay).toBe("dusk");
    expect(i.features.monumental).toBe(true);
    expect(i.palette.fog).toBe("#aab4bb");
    expect(i.palette.rock).toBeTruthy(); // untouched overrides inherit the biome palette
    expect(i.notes[0]).toContain("AI World Architect");
  });

  it("builds a renderer-compatible, schema-valid spec marked as AI", () => {
    const spec = buildAi(blueprintSchema.parse(TUNDRA_BLUEPRINT));
    expect(spec.schemaVersion).toBe(3);
    expect(spec.generation.method).toBe("ai");
    expect(spec.structures.length).toBeGreaterThan(0);
    expect(spec.terrain.size).toBeGreaterThan(0);
    expect(() => parseWorld(structuredClone(spec))).not.toThrow();
    expect(() => resolveWorld(spec)).not.toThrow();
  });

  it("overlays the written layer without moving geometry", () => {
    const bp = blueprintSchema.parse(VOLCANIC_BLUEPRINT);
    const spec = buildAi(bp);
    expect(spec.name).toBe("The Ember Regatta");
    expect(spec.discoveries[0]?.title).toBe("The Mooring Bell");
    const landmark = spec.discoveries.find((d) => d.kind === "landmark");
    expect(landmark?.title).toBe("The Harbour Throne");
    // Interaction wiring still points at the same discovery ids.
    for (const interaction of spec.interactions) {
      if (interaction.discoveryId) {
        expect(spec.discoveries.some((d) => d.id === interaction.discoveryId)).toBe(true);
      }
    }
  });

  it("produces meaningfully different specs for distinct prompts", () => {
    const a = buildAi(blueprintSchema.parse(TUNDRA_BLUEPRINT), "seed-a");
    const b = buildAi(blueprintSchema.parse(VOLCANIC_BLUEPRINT), "seed-b");
    expect(a.biome).not.toBe(b.biome);
    expect(a.name).not.toBe(b.name);
    expect(a.timeOfDay).not.toBe(b.timeOfDay);
    expect(a.atmosphere.sky.top).not.toBe(b.atmosphere.sky.top);
  });
});

/* ------------------------------------------------------------------ */
/*  Revision                                                           */
/* ------------------------------------------------------------------ */

describe("revision", () => {
  it("clamps edit values", () => {
    const rev = revisionSchema.parse({ edits: { fogDensity: 99, landmarkScale: 0 }, reply: "Adjusted.", unsupported: [] });
    expect(rev.edits.fogDensity).toBe(0.03);
    expect(rev.edits.landmarkScale).toBe(0.5);
  });

  it("rejects unknown edit fields' bad values", () => {
    expect(revisionSchema.safeParse({ edits: { timeOfDay: "siesta" }, reply: "Napped.", unsupported: [] }).success).toBe(false);
  });

  it("sends a compact context — never the raw geometry", () => {
    const spec = buildAi(blueprintSchema.parse(TUNDRA_BLUEPRINT));
    const ctx = revisionContext(spec);
    expect(JSON.stringify(ctx)).not.toContain("structures");
    expect(ctx.currentEdits).toEqual({});
    expect(ctx.hasLandmark).toBe(true);
  });

  it("applies edits while preserving exploration and unrelated properties", () => {
    const spec = buildAi(blueprintSchema.parse(VOLCANIC_BLUEPRINT));
    const explored = {
      ...spec,
      exploration: {
        ...spec.exploration,
        discoveries: [spec.discoveries[0]!.id],
        position: { x: 1, y: 2, z: 3 },
      },
    };
    const rev = revisionSchema.parse({
      edits: { fogDensity: 0.018, particleKind: "mist" },
      reply: "Denser fog, softer air.",
      unsupported: [],
    });
    const next = applyRevision(explored, rev);
    expect(next.edits.fogDensity).toBeCloseTo(0.018);
    expect(next.edits.particleKind).toBe("mist");
    expect(next.exploration.discoveries).toEqual(explored.exploration.discoveries);
    expect(next.exploration.position).toEqual({ x: 1, y: 2, z: 3 });
    expect(next.name).toBe(spec.name);
    expect(next.structures).toEqual(spec.structures);
    expect(() => resolveWorld(next)).not.toThrow();
  });
});

/* ------------------------------------------------------------------ */
/*  Persistence & export of AI-generated worlds                        */
/* ------------------------------------------------------------------ */

describe("AI world persistence", () => {
  it("saves and reloads AI-generated worlds with their method intact", async () => {
    const spec = { ...buildAi(blueprintSchema.parse(TUNDRA_BLUEPRINT)), id: "w_ai_persist" };
    await saveWorld(spec);
    const loaded = await loadWorld("w_ai_persist");
    expect(loaded.generation.method).toBe("ai");
    expect(loaded.name).toBe("The Hollow Meridian");
  });

  it("round-trips through export/import", () => {
    const spec = buildAi(blueprintSchema.parse(VOLCANIC_BLUEPRINT));
    const { spec: imported, warnings } = parseExportedWorld(serializeWorld(spec));
    expect(warnings).toEqual([]);
    expect(imported.generation.method).toBe("ai");
    expect(imported.discoveries[0]?.title).toBe("The Mooring Bell");
  });
});

/* ------------------------------------------------------------------ */
/*  Store integration: fallback, AI success, revision + undo           */
/* ------------------------------------------------------------------ */

describe("store AI flow", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    useMythos.setState({ current: null, lastRevision: null, revising: false, aiStatus: "unknown", aiModel: null });
  });

  it("falls back to procedural generation when the architect is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: false, reason: "unavailable" }), { status: 503 })),
    );
    const result = await useMythos
      .getState()
      .createWorldAi("an ancient frozen observatory beneath amber dusk", { scale: "grand", atmosphere: "inherit", method: "ai" });
    expect(result.method).toBe("procedural");
    expect(result.note).toContain("not configured");
    expect(result.spec.generation.method).toBe("procedural");
    expect(() => parseWorld(structuredClone(result.spec))).not.toThrow();
  });

  it("builds an AI world through the store when the architect answers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true, blueprint: TUNDRA_BLUEPRINT, model: "openrouter/free" }))),
    );
    const stages: number[] = [];
    const result = await useMythos
      .getState()
      .createWorldAi("a frozen observatory on a meridian line", { scale: "grand", atmosphere: "inherit", method: "ai" }, (s) =>
        stages.push(s),
      );
    expect(result.method).toBe("ai");
    expect(result.spec.name).toBe("The Hollow Meridian");
    expect(result.spec.generation.method).toBe("ai");
    expect(stages).toEqual([0, 1, 2]);
  });

  it("revises the current world and undoes the revision reliably", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const body = JSON.parse(String((input as Request).body ?? "{}"));
        void body;
        return new Response(
          JSON.stringify({
            ok: true,
            revision: { edits: { fogDensity: 0.02 }, reply: "The fog rolls in.", unsupported: [] },
            model: "openrouter/free",
          }),
        );
      }),
    );
    const spec = buildAi(blueprintSchema.parse(VOLCANIC_BLUEPRINT));
    useMythos.setState({ current: spec });

    const ok = await useMythos.getState().reviseCurrent("make it much foggier");
    expect(ok).toBe(true);
    const revised = useMythos.getState().current!;
    expect(revised.edits.fogDensity).toBeCloseTo(0.02);
    expect(useMythos.getState().lastRevision?.reply).toBe("The fog rolls in.");

    useMythos.getState().undoRevision();
    const restored = useMythos.getState().current!;
    expect(restored.edits).toEqual({});
    expect(useMythos.getState().lastRevision).toBeNull();
  });

  it("keeps the world unchanged when a revision fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: false, reason: "rate_limited" }), { status: 429 })),
    );
    const spec = buildAi(blueprintSchema.parse(TUNDRA_BLUEPRINT));
    useMythos.setState({ current: spec });

    const ok = await useMythos.getState().reviseCurrent("make it snow harder");
    expect(ok).toBe(false);
    expect(useMythos.getState().current).toEqual(spec);
    expect(useMythos.getState().revising).toBe(false);
  });
});
