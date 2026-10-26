import type { WorldSpec } from "./types";
import { buildWorld } from "./builder";
import { PRESETS, findPreset } from "./presets";

/**
 * Fixed seeds keep the three built-in tiles identical between sessions, so the
 * preview on the Atelier matches the place you actually enter.
 */
const PRESET_SEEDS: Record<string, string> = {
  "obsidian-palace": "obsidian-7c31",
  "forgotten-grove": "grove-2f9d",
  "last-frontier": "frontier-5a80",
};

const cache = new Map<string, WorldSpec>();

export function getPresetSpec(presetId: string): WorldSpec {
  const cached = cache.get(presetId);
  if (cached) return cached;
  const preset = findPreset(presetId);
  if (!preset) throw new Error(`Unknown preset: ${presetId}`);
  const spec = buildWorld({
    prompt: preset.prompt,
    presetId,
    seed: PRESET_SEEDS[presetId] ?? `${presetId}-0001`,
    name: preset.name,
    prefs: { scale: "grand", atmosphere: "inherit", method: "procedural" },
  });
  cache.set(presetId, spec);
  return spec;
}

export function allPresetSpecs(): Array<{ preset: (typeof PRESETS)[number]; spec: WorldSpec }> {
  return PRESETS.map((preset) => ({ preset, spec: getPresetSpec(preset.id) }));
}

export function invalidatePresetCache(): void {
  cache.clear();
}