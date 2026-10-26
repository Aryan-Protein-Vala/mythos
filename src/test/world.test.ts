import { describe, expect, it } from "vitest";
import { buildWorld } from "../world/builder";
import { parseExportedWorld, parseWorld, validateWorld } from "../world/schema";
import { resolveWorld } from "../world/resolve";
import { getPresetSpec, allPresetSpecs } from "../world/sampleWorlds";
import { serializeWorld } from "../storage/transfer";

describe("buildWorld", () => {
  it("is deterministic for a fixed seed and clock", () => {
    const a = buildWorld({ prompt: "a drowned obsidian palace under an eclipse", seed: "seed-a", now: 1 });
    const b = buildWorld({ prompt: "a drowned obsidian palace under an eclipse", seed: "seed-a", now: 1 });
    expect(a).toEqual(b);
  });

  it("diverges when the seed changes", () => {
    const a = buildWorld({ prompt: "a forest temple in the mist", seed: "seed-a", now: 1 });
    const b = buildWorld({ prompt: "a forest temple in the mist", seed: "seed-b", now: 1 });
    expect(a.structures).not.toEqual(b.structures);
  });

  it("always produces a spec that passes validation", () => {
    const prompts = [
      "a volcanic palace under a black sun",
      "a misty forest grove with ruins",
      "an observatory in an endless desert",
      "a frozen tundra with a monolith",
      "a marble city floating in the stars",
      "",
    ];
    for (const prompt of prompts) {
      const spec = buildWorld({ prompt, seed: "validate", now: 1 });
      const result = validateWorld(spec);
      expect(result.ok, result.issues.join(" ")).toBe(true);
    }
  });

  it("keeps every structure out of the terrain surface", () => {
    const spec = buildWorld({ prompt: "a volcanic palace", presetId: "obsidian-palace", now: 1 });
    const half = spec.terrain.size / 2;
    for (const s of spec.structures) {
      expect(Math.abs(s.x)).toBeLessThanOrEqual(half);
      expect(Math.abs(s.z)).toBeLessThanOrEqual(half);
      expect(Number.isFinite(s.y)).toBe(true);
    }
  });

  it("links interactions to real discoveries and events", () => {
    for (const { spec } of allPresetSpecs()) {
      const discoveryIds = new Set(spec.discoveries.map((d) => d.id));
      const eventIds = new Set(spec.events.map((e) => e.id));
      for (const i of spec.interactions) {
        if (i.discoveryId) expect(discoveryIds.has(i.discoveryId)).toBe(true);
        if (i.eventId) expect(eventIds.has(i.eventId)).toBe(true);
      }
    }
  });
});

describe("schema validation", () => {
  it("rejects a non-world payload", () => {
    const result = validateWorld({ nope: true });
    expect(result.ok).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("rejects out-of-range numbers", () => {
    const spec = structuredClone(getPresetSpec("obsidian-palace"));
    spec.terrain.size = -5;
    const result = validateWorld(spec);
    expect(result.ok).toBe(false);
  });

  it("throws a typed error from parseWorld", () => {
    expect(() => parseWorld({})).toThrow();
  });

  it("drops interactions pointing at missing discoveries", () => {
    const spec = structuredClone(getPresetSpec("forgotten-grove"));
    spec.discoveries = [];
    const result = validateWorld(spec);
    expect(result.ok).toBe(true);
    expect(result.spec!.interactions.length).toBe(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("clamps the spawn point inside the world", () => {
    const spec = structuredClone(getPresetSpec("last-frontier"));
    spec.camera.spawn = { x: 99999, y: 3, z: -99999 };
    const result = validateWorld(spec);
    const half = spec.terrain.size / 2;
    expect(result.spec!.camera.spawn.x).toBeLessThanOrEqual(half);
    expect(result.spec!.camera.spawn.z).toBeGreaterThanOrEqual(-half);
  });
});

describe("resolveWorld", () => {
  it("does not mutate its input", () => {
    const spec = getPresetSpec("forgotten-grove");
    const before = structuredClone(spec);
    const resolved = resolveWorld({ ...spec, edits: { timeOfDay: "night" } });
    expect(spec).toEqual(before);
    expect(resolved.atmosphere.sky.top).not.toBe(before.atmosphere.sky.top);
  });

  it("returns an equivalent spec with no edits", () => {
    const spec = getPresetSpec("last-frontier");
    const resolved = resolveWorld(spec);
    expect(resolved.atmosphere).toEqual(spec.atmosphere);
    expect(resolved.timeOfDay).toBe(spec.timeOfDay);
  });

  it("keeps the resolved spec valid", () => {
    const spec = getPresetSpec("obsidian-palace");
    for (const timeOfDay of ["dawn", "day", "dusk", "night", "eclipse"] as const) {
      const resolved = resolveWorld({ ...spec, edits: { timeOfDay } });
      expect(validateWorld(resolved).ok).toBe(true);
    }
  });
});

describe("export envelope", () => {
  it("round-trips a world through JSON", () => {
    const spec = getPresetSpec("obsidian-palace");
    const text = serializeWorld(spec);
    const { spec: parsed, warnings } = parseExportedWorld(text);
    expect(warnings).toEqual([]);
    expect(parsed.id).toBe(spec.id);
    expect(parsed.seed).toBe(spec.seed);
    expect(parsed.structures.length).toBe(spec.structures.length);
  });

  it("accepts a bare spec without an envelope", () => {
    const spec = getPresetSpec("forgotten-grove");
    const { spec: parsed } = parseExportedWorld(JSON.stringify(spec));
    expect(parsed.seed).toBe(spec.seed);
  });

  it("rejects malformed JSON", () => {
    expect(() => parseExportedWorld("{not json")).toThrow();
  });
});
