import type { BiomeId } from "./types";

export interface WorldPreset {
  id: string;
  name: string;
  tagline: string;
  description: string;
  prompt: string;
  biome: BiomeId;
  /** Short label used on tiles. */
  setting: string;
}

export const PRESETS: WorldPreset[] = [
  {
    id: "obsidian-palace",
    name: "The Obsidian Palace",
    tagline: "A black court above a black sea",
    description:
      "An abandoned palace of black stone above an endless dark ocean, beneath a dying sun. Broken arches emerge from the mist. A sealed chamber waits beneath the central courtyard.",
    prompt:
      "An abandoned obsidian palace built from black stone above an endless dark ocean, beneath a dying sun. Broken arches emerge from the mist. A sealed chamber lies beneath the central courtyard.",
    biome: "volcanic",
    setting: "Volcanic / eclipse",
  },
  {
    id: "forgotten-grove",
    name: "The Forgotten Grove",
    tagline: "Oversized trees swallowing an old sanctuary",
    description:
      "An ancient forest of colossal trees, where ruined stonework is slowly reclaimed by root and moss. Mist drifts between the trunks, and a concealed shrine keeps its own weather.",
    prompt:
      "An ancient forgotten forest of colossal trees with ruined stone structures and overgrown pathways, soft overcast light and mist between the trees. A concealed sanctuary hides behind the roots.",
    biome: "forest",
    setting: "Ancient forest / mist",
  },
  {
    id: "last-frontier",
    name: "The Last Frontier",
    tagline: "An observatory at the edge of a black desert",
    description:
      "An expansive desert of red dunes and enormous geological shelves, where an abandoned observatory points a broken instrument at a distant celestial body. Monuments stand half-buried in sand.",
    prompt:
      "An expansive desert with massive geological formations and an abandoned observatory, broken stone monuments and long atmospheric sightlines. A distant celestial object hangs over the dunes, and a sealed relic sleeps beneath the instrument.",
    biome: "desert",
    setting: "Desert / observatory",
  },
];

export function findPreset(id: string | undefined): WorldPreset | undefined {
  return PRESETS.find((p) => p.id === id);
}

export const SAMPLE_PROMPTS = [
  "A frozen civilization buried beneath a field of enormous broken statues.",
  "A cathedral floating above an endless sea of clouds.",
  "A deserted futuristic city slowly being reclaimed by nature.",
  "A ruined observatory at the edge of a black desert, with a gigantic eclipsed moon overhead.",
  "A forgotten temple hidden inside a colossal ancient tree.",
];