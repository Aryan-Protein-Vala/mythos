import type { BiomeId, CreationPreferences, ParticleKind, StoneMaterial, TerrainType, TimeOfDay } from "./types";

/**
 * Deterministic natural-language interpretation.
 *
 * This is the fallback "planner": it maps words to world parameters with an
 * explicit rule table. It never invents geometry — it produces an *intent*
 * which the builder turns into a validated specification.
 */

export interface Interpretation {
  biome: BiomeId;
  timeOfDay: TimeOfDay;
  stone: StoneMaterial;
  terrain: TerrainType;
  particle: ParticleKind;
  water: boolean;
  vegetation: number;
  rocky: number;
  scaleBias: number;
  /** Human-readable notes explaining what was detected. Shown in diagnostics. */
  notes: string[];
  /** Distinctive features the builder must honour. */
  features: {
    floating: boolean;
    eclipse: boolean;
    frozen: boolean;
    ruins: boolean;
    monumental: boolean;
    city: boolean;
    tree: boolean;
    ocean: boolean;
    desert: boolean;
    forest: boolean;
    observatory: boolean;
    cathedral: boolean;
    statues: boolean;
  };
  palette: {
    stone: string;
    accent: string;
    fog: string;
    skyTop: string;
    skyHorizon: string;
    water: string;
    waterDeep: string;
    terrainLow: string;
    terrainHigh: string;
    rock: string;
    canopy: string;
  };
}

type Rule = {
  id: string;
  words: string[];
  note: string;
  apply: (i: Interpretation) => void;
};

const VOLCANIC = {
  stone: "obsidian",
  accent: "#b69a66",
  fog: "#121417",
  skyTop: "#08090c",
  skyHorizon: "#1e1a17",
  water: "#0d1319",
  waterDeep: "#05090d",
  terrainLow: "#2a2a2c",
  terrainHigh: "#3a3632",
  rock: "#2f2f31",
  canopy: "#3a3a32",
} as const;

const FOREST = {
  stone: "granite",
  accent: "#c8b89a",
  fog: "#7d8a7c",
  skyTop: "#8e9a96",
  skyHorizon: "#c3c9bd",
  water: "#2f3f38",
  waterDeep: "#1a2620",
  terrainLow: "#3a3d2c",
  terrainHigh: "#5c5a41",
  rock: "#4c4b44",
  canopy: "#2f3a2a",
} as const;

const DESERT = {
  stone: "sandstone",
  accent: "#c8b89a",
  fog: "#c2ad8c",
  skyTop: "#7d8fa3",
  skyHorizon: "#d8c4a2",
  water: "#3a4a4e",
  waterDeep: "#233033",
  terrainLow: "#8a7455",
  terrainHigh: "#c2a97f",
  rock: "#7c6244",
  canopy: "#6b6a44",
} as const;

const TUNDRA = {
  stone: "ice",
  accent: "#c8b89a",
  fog: "#b9c4c9",
  skyTop: "#8fa3b3",
  skyHorizon: "#d6dee0",
  water: "#2c4a52",
  waterDeep: "#16292f",
  terrainLow: "#8d989c",
  terrainHigh: "#e6ecec",
  rock: "#6d7477",
  canopy: "#4a5a52",
} as const;

const CELESTIAL = {
  stone: "marble",
  accent: "#e9e6de",
  fog: "#a9adb5",
  skyTop: "#2c3547",
  skyHorizon: "#8f9aac",
  water: "#4a5c6b",
  waterDeep: "#2a3742",
  terrainLow: "#6a7078",
  terrainHigh: "#b9c0c4",
  rock: "#5a6068",
  canopy: "#3f4a44",
} as const;

const PALETTES = { VOLCANIC, FOREST, DESERT, TUNDRA, CELESTIAL };

export function emptyInterpretation(): Interpretation {
  return {
    biome: "volcanic",
    timeOfDay: "eclipse",
    stone: "obsidian",
    terrain: "islands",
    particle: "embers",
    water: true,
    vegetation: 0.05,
    rocky: 0.5,
    scaleBias: 1,
    notes: [],
    features: {
      floating: false,
      eclipse: false,
      frozen: false,
      ruins: false,
      monumental: false,
      city: false,
      tree: false,
      ocean: false,
      desert: false,
      forest: false,
      observatory: false,
      cathedral: false,
      statues: false,
    },
    palette: { ...VOLCANIC },
  };
}

function setBiome(i: Interpretation, biome: BiomeId, note: string) {
  i.biome = biome;
  i.notes.push(note);
  i.palette = { ...PALETTES[biome.toUpperCase() as keyof typeof PALETTES] };
  i.stone = i.palette.stone as StoneMaterial;
}

const RULES: Rule[] = [
  {
    id: "ocean",
    words: ["ocean", "sea", "water", "tide", "wave", "coast", "shore", "island", "abyss", "lake"],
    note: "Water body detected — shoreline and reflective surface enabled.",
    apply: (i) => {
      i.water = true;
      i.features.ocean = true;
    },
  },
  {
    id: "black-water",
    words: ["black ocean", "black sea", "dark ocean", "dark water", "ink", "obsidian sea"],
    note: "Dark water — near-black water with a low specular response.",
    apply: (i) => {
      i.water = true;
      i.features.ocean = true;
      i.palette.water = "#070a0e";
      i.palette.waterDeep = "#020407";
    },
  },
  {
    id: "forest",
    words: ["forest", "grove", "wood", "woodland", "jungle", "thicket", "canopy", "tree", "trees", "overgrown"],
    note: "Vegetation dominant — dense instanced canopy and mist.",
    apply: (i) => {
      setBiome(i, "forest", "Forest biome selected.");
      i.features.forest = true;
      i.features.tree = true;
      i.terrain = "rolling";
      i.vegetation = 0.85;
      i.rocky = 0.3;
      i.particle = "mist";
      i.timeOfDay = "day";
      i.water = false;
    },
  },
  {
    id: "ancient-tree",
    words: ["colossal tree", "giant tree", "ancient tree", "world tree", "inside a tree", "tree temple"],
    note: "Colossal tree — a monumental trunk landmark with an interior temple.",
    apply: (i) => {
      setBiome(i, "forest", "Colossal tree landmark.");
      i.features.tree = true;
      i.features.monumental = true;
      i.features.forest = true;
      i.terrain = "rolling";
      i.vegetation = 0.7;
      i.scaleBias = 1.6;
      i.timeOfDay = "day";
    },
  },
  {
    id: "desert",
    words: ["desert", "dune", "sand", "arid", "wasteland", "badlands", "frontier"],
    note: "Arid terrain — dunes, long sightlines, sparse vegetation.",
    apply: (i) => {
      setBiome(i, "desert", "Desert biome selected.");
      i.features.desert = true;
      i.terrain = "dunes";
      i.vegetation = 0.04;
      i.rocky = 0.6;
      i.particle = "dust";
      i.timeOfDay = "dusk";
      i.water = false;
    },
  },
  {
    id: "frozen",
    words: ["frozen", "ice", "snow", "glacier", "winter", "frost", "tundra", "arctic", "cold", "blizzard"],
    note: "Cold climate — snow cover, pale light, low contrast.",
    apply: (i) => {
      setBiome(i, "tundra", "Tundra biome selected.");
      i.features.frozen = true;
      i.terrain = "ice";
      i.vegetation = 0.06;
      i.particle = "snow";
      i.timeOfDay = "day";
    },
  },
  {
    id: "palace",
    words: ["palace", "castle", "citadel", "keep", "fortress", "court", "courtyard", "throne"],
    note: "Palatial architecture — towers, courtyards and a monumental hall.",
    apply: (i) => {
      i.features.monumental = true;
      i.features.ruins = i.features.ruins || true;
      i.scaleBias = Math.max(i.scaleBias, 1.25);
    },
  },
  {
    id: "temple",
    words: ["temple", "sanctuary", "shrine", "cathedral", "monastery", "chapel", "altar", "observatory"],
    note: "Sacred architecture — colonnade, inner sanctum and a focal altar.",
    apply: (i) => {
      i.features.ruins = true;
      i.features.cathedral = i.features.cathedral || true;
    },
  },
  {
    id: "observatory",
    words: ["observatory", "telescope", "astronomical", "dome", "star chart"],
    note: "Observatory — dome structure with an instrument.",
    apply: (i) => {
      i.features.observatory = true;
      i.features.ruins = true;
    },
  },
  {
    id: "city",
    words: ["city", "metropolis", "town", "skyscraper", "towers", "urban", "civilization"],
    note: "Urban fabric — repeated towers and a street grid.",
    apply: (i) => {
      i.features.city = true;
      i.features.ruins = true;
      i.scaleBias = Math.max(i.scaleBias, 1.15);
    },
  },
  {
    id: "ruins",
    words: ["ruin", "ruined", "abandoned", "broken", "collapsed", "forgotten", "derelict", "crumbling", "decayed"],
    note: "Ruined state — collapsed walls, scattered stone, weathered surfaces.",
    apply: (i) => {
      i.features.ruins = true;
    },
  },
  {
    id: "floating",
    words: ["floating", "hovering", "sky", "cloud", "above the", "levitating", "airship"],
    note: "Elevated structure — architecture raised on a suspended platform.",
    apply: (i) => {
      i.features.floating = true;
      i.features.monumental = true;
      i.scaleBias = Math.max(i.scaleBias, 1.3);
    },
  },
  {
    id: "eclipse",
    words: ["eclipse", "eclipsed", "dying sun", "black sun", "dark sun", "occulted", "ring of fire", "corona"],
    note: "Eclipse — occluded sun with corona and dimmed key light.",
    apply: (i) => {
      i.features.eclipse = true;
      i.timeOfDay = "eclipse";
      i.particle = i.particle === "none" ? "embers" : i.particle;
    },
  },
  {
    id: "moon",
    words: ["moon", "lunar", "night", "starlit", "stars", "midnight"],
    note: "Night sky — moon disc, stars, cool ambient light.",
    apply: (i) => {
      i.timeOfDay = "night";
    },
  },
  {
    id: "dusk",
    words: ["dusk", "sunset", "twilight", "evening", "amber", "golden hour", "dying"],
    note: "Dusk light — warm low sun and long shadows.",
    apply: (i) => {
      i.timeOfDay = "dusk";
    },
  },
  {
    id: "overcast",
    words: ["overcast", "grey", "gray", "misty", "foggy", "mist", "fog", "haze", "clouded"],
    note: "Heavy atmosphere — soft light and dense fog.",
    apply: (i) => {
      i.particle = "mist";
    },
  },
  {
    id: "statues",
    words: ["statue", "statues", "colossus", "monument", "sculpture", "monolith"],
    note: "Monumental statuary — oversized stone figures in the composition.",
    apply: (i) => {
      i.features.statues = true;
      i.features.monumental = true;
    },
  },
  {
    id: "crystal",
    words: ["crystal", "crystals", "shard", "geode", "prism"],
    note: "Crystalline geology — crystal formations scattered in the terrain.",
    apply: (i) => {
      i.rocky = Math.max(i.rocky, 0.6);
    },
  },
  {
    id: "volcanic",
    words: ["volcanic", "lava", "magma", "ash", "obsidian", "basalt", "black stone", "ember"],
    note: "Volcanic substrate — black stone, ash and embers.",
    apply: (i) => {
      setBiome(i, "volcanic", "Volcanic biome selected.");
      i.features.ruins = true;
      i.particle = "embers";
    },
  },
  {
    id: "celestial",
    words: ["celestial", "heaven", "angelic", "ethereal", "divine", "cloud sea", "sky temple"],
    note: "Celestial setting — pale stone above a cloud sea.",
    apply: (i) => {
      setBiome(i, "celestial", "Celestial biome selected.");
      i.features.floating = true;
      i.water = false;
      i.particle = "mist";
    },
  },
  {
    id: "vast",
    words: ["vast", "endless", "infinite", "colossal", "gigantic", "enormous", "monumental", "titanic"],
    note: "Scale cue — world dimensions and landmark scale increased.",
    apply: (i) => {
      i.scaleBias = Math.max(i.scaleBias, 1.35);
      i.features.monumental = true;
    },
  },
  {
    id: "intimate",
    words: ["small", "intimate", "quiet", "tiny", "secluded", "hidden"],
    note: "Intimacy cue — tighter world bounds and closer landmark.",
    apply: (i) => {
      i.scaleBias = Math.min(i.scaleBias, 0.85);
    },
  },
];

export function interpretPrompt(prompt: string): Interpretation {
  const text = ` ${prompt.toLowerCase().replace(/\s+/g, " ").trim()} `;
  const i = emptyInterpretation();
  if (!text.trim()) {
    i.notes.push("Empty description — defaulting to the volcanic eclipse archetype.");
    i.features.eclipse = true;
    return i;
  }

  const fired = new Set<string>();
  for (const rule of RULES) {
    if (rule.words.some((w) => text.includes(w))) {
      if (fired.has(rule.id)) continue;
      fired.add(rule.id);
      rule.apply(i);
    }
  }

  if (fired.size === 0) {
    i.notes.push("No known keywords matched — using a neutral island archetype.");
    i.features.ocean = true;
    i.palette = { ...VOLCANIC };
  }

  // Eclipse is visually dominant; keep it even if dusk was also mentioned.
  if (fired.has("eclipse")) i.timeOfDay = "eclipse";
  if (i.features.floating && i.features.ocean) i.palette.fog = "#0e1216";

  return i;
}

const SCALE_MULT = { intimate: 0.78, grand: 1, vast: 1.32 } as const;

export function applyPreferences(i: Interpretation, prefs: CreationPreferences): Interpretation {
  const out: Interpretation = {
    ...i,
    features: { ...i.features },
    palette: { ...i.palette },
    notes: [...i.notes],
  };
  out.scaleBias *= SCALE_MULT[prefs.scale];
  out.notes.push(`World scale: ${prefs.scale}.`);

  switch (prefs.atmosphere) {
    case "clear":
      out.particle = "none";
      out.timeOfDay = "day";
      out.notes.push("Clear atmosphere override.");
      break;
    case "haze":
      out.particle = "mist";
      out.notes.push("Haze atmosphere override.");
      break;
    case "night":
      out.timeOfDay = "night";
      out.notes.push("Night atmosphere override.");
      break;
    case "eclipse":
      out.timeOfDay = "eclipse";
      out.features.eclipse = true;
      out.notes.push("Eclipse atmosphere override.");
      break;
    case "inherit":
      break;
  }
  return out;
}

/** Short evocative name derived from the prompt, used when the user gave none. */
export function deriveName(prompt: string, biome: BiomeId): string {
  const t = prompt.toLowerCase();
  const candidates: Array<[RegExp, string]> = [
    [/obsidian|black stone/, "The Obsidian Palace"],
    [/colossal tree|world tree/, "The Forgotten Grove"],
    [/frozen|ice|glacier/, "The Frozen Vigil"],
    [/desert|dune|frontier/, "The Last Frontier"],
    [/city|metropolis/, "The Reclaimed City"],
    [/cathedral|cloud|floating/, "The Cathedral of Clouds"],
    [/observatory/, "The Ruined Observatory"],
    [/temple|sanctuary|shrine/, "The Hidden Sanctuary"],
    [/palace|castle|citadel/, "The Silent Citadel"],
  ];
  for (const [re, name] of candidates) if (re.test(t)) return name;
  const biomeNames: Record<BiomeId, string> = {
    volcanic: "The Ashen Reach",
    forest: "The Verdant Hollow",
    desert: "The Long Silence",
    tundra: "The Pale Expanse",
    celestial: "The Upper Reach",
  };
  return biomeNames[biome];
}