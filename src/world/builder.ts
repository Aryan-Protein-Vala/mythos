import type {
  AtmosphereSpec,
  BiomeId,
  CreationPreferences,
  DiscoverySpec,
  EventSpec,
  InteractionSpec,
  ParticleKind,
  PropSpec,
  SkyKind,
  StoneMaterial,
  StructureKind,
  StructureSpec,
  TerrainPad,
  TimeOfDay,
  Vec3,
  WorldSpec,
} from "./types";
import { SCHEMA_VERSION } from "./types";
import { applyPreferences, deriveName, interpretPrompt, type Interpretation } from "./interpreter";
import { Rng, hashString, makeSeed } from "./rng";
import { TerrainSampler } from "./terrain";
import { parseWorld } from "./schema";
import { findPreset } from "./presets";

const BIOME_STONE: Record<BiomeId, StoneMaterial> = {
  volcanic: "obsidian",
  forest: "granite",
  desert: "sandstone",
  tundra: "ice",
  celestial: "marble",
};

const BIOME_TERRAIN_AMPLITUDE: Record<BiomeId, number> = {
  volcanic: 17,
  forest: 9,
  desert: 15,
  tundra: 7,
  celestial: 11,
};

const BIOME_FOG: Record<BiomeId, number> = {
  volcanic: 0.0068,
  forest: 0.0125,
  desert: 0.0045,
  tundra: 0.009,
  celestial: 0.0155,
};

interface TimePalette {
  top: string;
  horizon: string;
  sunColor: string;
  sunIntensity: number;
  ambientIntensity: number;
  ambientColor: string;
  elevation: number;
  azimuth: number;
  stars: number;
  corona: number;
  discSize: number;
  fogScale: number;
}

function timePalette(time: TimeOfDay, biome: BiomeId, i: Interpretation): TimePalette {
  const soft = biome === "forest";
  switch (time) {
    case "dawn":
      return {
        top: "#2b3542",
        horizon: "#c99a76",
        sunColor: "#f2cfae",
        sunIntensity: 1.55,
        ambientIntensity: soft ? 0.8 : 0.5,
        ambientColor: "#8b97a0",
        elevation: 9,
        azimuth: 84,
        stars: 0.12,
        corona: 0.12,
        discSize: 5.5,
        fogScale: 1.2,
      };
    case "day":
      return {
        top: soft ? "#7f8c88" : i.palette.skyTop,
        horizon: soft ? "#c9cec3" : i.palette.skyHorizon,
        sunColor: soft ? "#f2efe4" : "#fff1d8",
        sunIntensity: soft ? 1.15 : 2.35,
        ambientIntensity: soft ? 1.05 : 0.72,
        ambientColor: soft ? "#aeb8ab" : "#9aa6ad",
        elevation: soft ? 52 : 40,
        azimuth: 128,
        stars: 0,
        corona: 0,
        discSize: soft ? 4 : 6,
        fogScale: 1,
      };
    case "dusk":
      return {
        top: "#252d3b",
        horizon: "#b8794f",
        sunColor: "#ff9d5c",
        sunIntensity: 1.75,
        ambientIntensity: 0.5,
        ambientColor: "#6f6257",
        elevation: 6,
        azimuth: 262,
        stars: 0.1,
        corona: 0.2,
        discSize: 6,
        fogScale: 1.1,
      };
    case "night":
      return {
        top: "#05070d",
        horizon: "#151d2a",
        sunColor: "#9db6d8",
        sunIntensity: 0.42,
        ambientIntensity: 0.32,
        ambientColor: "#3c4a60",
        elevation: 34,
        azimuth: 208,
        stars: 0.95,
        corona: 0,
        discSize: 5,
        fogScale: 1.15,
      };
    case "eclipse":
    default:
      return {
        top: "#05060a",
        horizon: biome === "volcanic" ? "#1d1512" : "#141a20",
        sunColor: "#efe0c2",
        sunIntensity: 1.35,
        ambientIntensity: biome === "volcanic" ? 1.15 : 0.6,
        ambientColor: "#a49b8a",
        elevation: 23,
        azimuth: 191,
        stars: 0.4,
        corona: 1,
        discSize: 6.2,
        fogScale: 1,
      };
  }
}

function skyKindFor(time: TimeOfDay, i: Interpretation): SkyKind {
  if (i.features.eclipse || time === "eclipse") return "eclipse";
  if (time === "night") return "moon";
  if (i.features.floating && !i.water && i.biome === "celestial") return "cloudsea";
  if (i.biome === "forest" && (time === "day" || time === "dawn")) return "overcast";
  if (time === "day" && i.biome === "desert") return "sun";
  return "sun";
}

function atmosphereFor(i: Interpretation, time: TimeOfDay, rng: Rng): AtmosphereSpec {
  const t = timePalette(time, i.biome, i);
  const skyKind = skyKindFor(time, i);
  const top = skyKind === "eclipse" ? t.top : t.top;
  const horizon = t.horizon;
  const fog =
    time === "eclipse"
      ? i.palette.fog
      : time === "night"
        ? "#0c1118"
        : i.biome === "desert"
          ? "#c3ad8b"
          : i.biome === "forest"
            ? "#9aa79a"
            : i.palette.fog;

  const particle: ParticleKind =
    time === "eclipse" ? (i.biome === "forest" ? "mist" : "embers") : i.particle;

  return {
    sky: {
      kind: skyKind,
      top,
      horizon,
      sunColor: t.sunColor,
      sunIntensity: t.sunIntensity,
      sunAzimuth: t.azimuth + rng.range(-8, 8),
      sunElevation: t.elevation,
      discSize: t.discSize * (i.features.monumental ? 1.15 : 1),
      corona: t.corona,
      stars: t.stars,
    },
    fog: {
      color: fog,
      density: Math.min(0.03, BIOME_FOG[i.biome] * t.fogScale),
    },
    lighting: {
      keyIntensity: t.sunIntensity,
      ambientIntensity: t.ambientIntensity,
      keyColor: t.sunColor,
      ambientColor: t.ambientColor,
      accentColor: i.palette.accent,
      accentIntensity: i.biome === "volcanic" ? 4.2 : i.biome === "celestial" ? 5 : 2.6,
    },
    particles: {
      kind: particle,
      density: i.biome === "forest" ? 0.55 : particle === "embers" ? 0.4 : 0.45,
      color:
        particle === "embers"
          ? "#e6a05a"
          : particle === "snow"
            ? "#eef4f7"
            : particle === "dust"
              ? "#d8c19b"
              : particle === "fireflies"
                ? "#d8d0a0"
                : "#cfd6d2",
    },
  };
}

class Layout {
  structures: StructureSpec[] = [];
  props: PropSpec[] = [];
  interactions: InteractionSpec[] = [];
  discoveries: DiscoverySpec[] = [];
  events: EventSpec[] = [];
  pads: TerrainPad[] = [];
  spawn: Vec3 = { x: 0, y: 2, z: 0 };
  lookAt: Vec3 = { x: 0, y: 4, z: -20 };
  camera: { fov: number; eyeHeight: number; speed: number } = { fov: 66, eyeHeight: 1.7, speed: 6.8 };
  /** Eye height for spawns that stand on a structure rather than the terrain. */
  spawnSurface: number | null = null;
  private counter = 0;

  constructor(private sampler: TerrainSampler) {}

  pad(x: number, z: number, radius: number, height: number, blend = 0.9): void {
    this.pads.push({ x, z, radius, height, blend });
  }

  ground(x: number, z: number): number {
    return this.sampler.heightAt(x, z);
  }

  structure(
    kind: StructureKind,
    x: number,
    z: number,
    opts: {
      y?: number;
      rotY?: number;
      scale?: number;
      material?: StoneMaterial;
      landmark?: boolean;
      accent?: boolean;
    } = {},
  ): StructureSpec {
    const s: StructureSpec = {
      id: `s${++this.counter}`,
      kind,
      x,
      y: opts.y ?? this.ground(x, z),
      z,
      rotY: opts.rotY ?? 0,
      scale: opts.scale ?? 1,
      material: opts.material ?? "obsidian",
      landmark: opts.landmark,
      accent: opts.accent,
    };
    this.structures.push(s);
    return s;
  }

  prop(
    kind: PropSpec["kind"],
    x: number,
    z: number,
    opts: { y?: number; rotY?: number; scale?: number; color?: string } = {},
  ): PropSpec {
    const p: PropSpec = {
      id: `p${this.counter}`,
      kind,
      x,
      y: opts.y ?? this.ground(x, z),
      z,
      rotY: opts.rotY ?? 0,
      scale: opts.scale ?? 1,
      color: opts.color,
    };
    this.props.push(p);
    return p;
  }
}

function addInteraction(
  l: Layout,
  o: Omit<InteractionSpec, "position"> & { position: Vec3 },
) {
  l.interactions.push(o);
}

/* ------------------------------------------------------------------ */
/*  THE OBSIDIAN PALACE                                                */
/* ------------------------------------------------------------------ */

function layoutObsidian(l: Layout, i: Interpretation, rng: Rng, waterLevel: number, size: number): void {
  const stone: StoneMaterial = "obsidian";
  const base = Math.max(l.ground(0, 0) + 1.5, waterLevel + 7.8);

  // Drown the shelf, then raise the palace island out of it.
  l.pad(0, 0, size * 0.62, waterLevel - 3, 0.12);
  l.pad(0, 0, 22, base, 0.2);

  const deckY = base - 0.5;

  // Courtyard: two stacked platforms.
  l.structure("platform", 0, 2, { y: base, scale: 1.05, material: stone });
  l.structure("platform", 0, -8, { y: base + 1.6, scale: 0.72, material: stone });

  // Gate + colonnade.
  l.structure("gate", 0, 12, { y: base, scale: 1.35, material: stone, landmark: true });
  for (const z of [-2, -8, -14, -20]) {
    for (const x of [-12.5, 12.5]) {
      l.structure("pillar", x, z, { y: base + (z < -6 ? 1.6 : 0), scale: 1.55, material: stone });
    }
  }

  // Monumental hall.
  l.structure("temple", 0, -30, { y: base + 1.6, scale: 1.8, material: stone, landmark: true });
  l.structure("tower", -24, -27, { y: base, scale: 1.9, material: stone, landmark: true, accent: true });
  l.structure("tower", 24, -27, { y: base, scale: 1.55, material: stone, landmark: true });
  l.structure("tower", -35, -4, { y: base - 0.2, scale: 1.15, material: stone });
  l.structure("throne", 0, -35, { y: base + 2.4, scale: 1.15, material: stone, accent: true });
  l.structure("wall", -18, -18, { y: base + 1.6, scale: 1.1, rotY: 0.2, material: stone });
  l.structure("wall", 18, -18, { y: base + 1.6, scale: 1.1, rotY: -0.2, material: stone });
  l.structure("ruin", -21, 6, { y: base, scale: 1.2, rotY: 0.4, material: stone });
  l.structure("monolith", 8.4, 8.4, { y: base, scale: 0.85, rotY: -0.35, material: stone, accent: true });
  l.structure("ruin", 20, 9, { y: base, scale: 0.95, rotY: -0.8, material: stone });

  // Causeway on piers, stairs up to the island, drowned pylons framing it.
  l.structure("bridge", 0, 36, { y: deckY, scale: 1, rotY: 0, material: stone });
  l.structure("stairs", 0, 24, { y: base - 1.6, scale: 1.15, material: stone });
  // Drowned pylons frame the approach without blocking the sightline to the hall.
  l.structure("pillar", -14, 40, { y: waterLevel - 1.8, scale: 1.45, material: stone, accent: true });
  l.structure("pillar", 14, 40, { y: waterLevel - 1.8, scale: 1.45, material: stone, accent: true });
  l.structure("pillar", -20, 55, { y: waterLevel - 2.2, scale: 1.2, material: stone });
  l.structure("pillar", 20, 55, { y: waterLevel - 2.2, scale: 1.2, material: stone });

  // Broken arches rising out of the black sea.
  const archSpots: Array<[number, number, number]> = [
    [-52, 12, 1.7],
    [48, 20, 1.5],
    [-64, -26, 1.9],
    [66, -18, 1.6],
    [-38, 52, 1.2],
    [40, 58, 1.35],
  ];
  for (const [x, z, sc] of archSpots) {
    l.structure("arch", x, z, { y: waterLevel - 1.6, scale: sc, rotY: rng.range(-0.5, 0.5), material: stone });
  }

  // Distant ruins on the horizon ring.
  for (let k = 0; k < 8; k++) {
    const angle = (k / 8) * Math.PI * 2 + rng.range(-0.2, 0.2);
    const r = size * rng.range(0.3, 0.42);
    l.structure(k % 2 ? "ruin" : "arch", Math.cos(angle) * r, Math.sin(angle) * r, {
      y: waterLevel - 2.2,
      scale: rng.range(1.1, 2.1),
      rotY: angle,
      material: stone,
    });
  }

  // Sealed reliquary — the special-event trigger.
  l.structure("monolith", -7.6, 14.5, { y: base, scale: 1.05, material: "metal", accent: true, landmark: true });
  l.structure("monolith", -10.4, 15.4, { y: base, scale: 0.6, material: stone });
  l.structure("monolith", -4.9, 15.2, { y: base, scale: 0.55, material: stone });

  // Props: basalt, rubble, rare dead trees — never in the sea.
  for (let k = 0; k < 26; k++) {
    const angle = rng.range(0, Math.PI * 2);
    const r = rng.range(11, 30);
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    if (l.ground(x, z) < waterLevel + 0.7) continue;
    l.prop(rng.chance(0.35) ? "boulder" : "rock", x, z, {
      scale: rng.range(0.5, 1.8),
      rotY: rng.range(0, Math.PI * 2),
      color: i.palette.rock,
    });
  }
  for (let k = 0; k < 26; k++) {
    const x = rng.range(-size * 0.3, size * 0.3);
    const z = rng.range(-size * 0.36, size * 0.36);
    if (l.ground(x, z) < waterLevel + 0.6) continue;
    l.prop(rng.chance(0.4) ? "rubble" : "rock", x, z, {
      scale: rng.range(0.6, 1.6),
      rotY: rng.range(0, 6.28),
      color: i.palette.rock,
    });
  }
  for (let k = 0; k < 9; k++) {
    const angle = rng.range(0, Math.PI * 2);
    const r = rng.range(26, size * 0.36);
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    if (l.ground(x, z) < waterLevel + 0.8) continue;
    l.prop("dead-tree", x, z, {
      scale: rng.range(1.2, 2.6),
      rotY: rng.range(0, 6.28),
      color: i.palette.canopy,
    });
  }
  for (let k = 0; k < 12; k++) {
    const angle = rng.range(0, Math.PI * 2);
    const r = rng.range(14, 24);
    l.prop("rubble", Math.cos(angle) * r, Math.sin(angle) * r, {
      scale: rng.range(0.4, 1.1),
      rotY: rng.range(0, 6.28),
    });
  }

  // Discoveries.
  l.discoveries.push(
    {
      id: "reliquary",
      title: "The Sealed Reliquary",
      kind: "artifact",
      text: "A three-sided monolith of cold metal, its seams traced with amber that does not flicker. The seal is not a lock — it is a held breath, waiting for someone to release it.",
    },
    {
      id: "inscription",
      title: "The Cartographer's Inscription",
      kind: "clue",
      text: "\"We built upward because the sea would not hold us. When the crown goes dark, the sea will remind us why.\" Beneath it, a smaller hand has scratched: the chamber listens.",
    },
    {
      id: "throne",
      title: "The Throne of the Drowned King",
      kind: "landmark",
      text: "Black stone worn smooth at the arms. The seat is tilted a few degrees, as though the palace settled long ago and nobody came to correct it. From here the whole dead court is visible.",
    },
  );

  l.events.push({
    id: "eclipse-awakening",
    kind: "eclipse-awakening",
    title: "The Eclipse Answers",
    description:
      "The reliquary opens. The dying sun's corona tightens to a ring, the sea goes flat and bright, and the drowned gate in the east finally lifts from the water.",
    triggerId: "reliquary-trigger",
    discoveryId: "reliquary",
    duration: 7,
  });

  addInteraction(l, {
    id: "reliquary-trigger",
    kind: "activate",
    label: "Open the sealed reliquary",
    text: "The seam gives way. Somewhere below the courtyard, a mechanism older than the palace begins to turn.",
    position: { x: -7.6, y: base + 1.4, z: 15.6 },
    radius: 4.5,
    discoveryId: "reliquary",
    eventId: "eclipse-awakening",
  });
  addInteraction(l, {
    id: "inscription-read",
    kind: "read",
    label: "Read the inscription",
    text: "The letters are cut deep and filled with something darker than the stone.",
    position: { x: 8.4, y: base + 1.3, z: 9.2 },
    radius: 3.6,
    discoveryId: "inscription",
  });
  addInteraction(l, {
    id: "throne-sit",
    kind: "inspect",
    label: "Examine the throne",
    text: "Cold. Perfectly balanced. It was built for someone who intended to stay.",
    position: { x: 0, y: base + 2.6, z: -33.5 },
    radius: 4,
    discoveryId: "throne",
  });

  // Stand on the island terrace, just inside the gate: the courtyard, the
  // colonnade and the hall all read from here in one composition.
  l.spawn = { x: 0, y: deckY + 1.72, z: 47 };
  l.spawnSurface = deckY + 1.72;
  l.lookAt = { x: 0, y: base + 2.6, z: -26 };
  l.camera = { fov: 64, eyeHeight: 1.7, speed: 7.2 };
}

/* ------------------------------------------------------------------ */
/*  THE FORGOTTEN GROVE                                                */
/* ------------------------------------------------------------------ */

function layoutGrove(l: Layout, i: Interpretation, rng: Rng, size: number): void {
  const stone: StoneMaterial = "granite";
  const centreH = l.ground(0, 0) + 0.8;
  l.pad(0, 0, size * 0.13, centreH, 1.4);
  l.pad(0, size * 0.2, size * 0.05, l.ground(0, size * 0.2) + 0.4, 1.6);

  const base = centreH;

  l.structure("platform", 0, -3, { y: base, scale: 0.9, material: stone });
  l.structure("temple", 0, -13, { y: base, scale: 1.35, rotY: 0.05, material: stone, landmark: true });
  l.structure("dome", 0, -13, { y: base + 6.4, scale: 1.15, material: stone });
  l.structure("stairs", 0, 9, { y: base - 0.3, scale: 1, material: stone });
  for (const x of [-8, -4, 4, 8]) {
    l.structure("pillar", x, 1, { y: base, scale: 1.25, rotY: rng.range(-0.05, 0.05), material: stone });
  }
  l.structure("arch", 0, 6, { y: base, scale: 1.2, material: stone });
  l.structure("ruin", -15, 4, { y: l.ground(-15, 4), scale: 1.4, rotY: 0.7, material: stone });
  l.structure("ruin", 16, -2, { y: l.ground(16, -2), scale: 1.1, rotY: -0.5, material: stone });
  l.structure("wall", -13, -14, { y: l.ground(-13, -14), scale: 0.9, rotY: 0.5, material: stone });
  l.structure("shrine", 0, -6, { y: base, scale: 1, material: stone, accent: true, landmark: true });
  l.structure("monolith", -12, 12, { y: l.ground(-12, 12), scale: 1.6, rotY: 0.9, material: stone });

  // Ancestor stones leading in.
  for (let k = 0; k < 6; k++) {
    const z = 16 + k * 5;
    const x = k % 2 === 0 ? -6.5 : 6.5;
    l.structure("pillar", x, z, { y: l.ground(x, z), scale: 0.85, rotY: rng.range(0, 0.4), material: stone });
  }

  // Colossal trees.
  const treeSpots: Array<[number, number, number]> = [
    [-24, -20, 6.2],
    [27, -14, 5.4],
    [-30, 8, 4.6],
    [24, 18, 5.9],
    [-14, 26, 3.8],
    [36, 2, 4.2],
    [-38, -4, 3.4],
    [10, -32, 5.1],
    [-22, 34, 4.4],
  ];
  for (const [x, z, s] of treeSpots) {
    l.prop("tree", x, z, {
      scale: s,
      rotY: rng.range(0, 6.28),
      color: i.palette.canopy,
    });
  }
  for (let k = 0; k < 46; k++) {
    const angle = rng.range(0, Math.PI * 2);
    const r = rng.range(20, size * 0.36);
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    if (Math.hypot(x, z) < 17) continue;
    l.prop("tree", x, z, {
      scale: rng.range(1.4, 3.6),
      rotY: rng.range(0, 6.28),
      color: i.palette.canopy,
    });
  }
  for (let k = 0; k < 44; k++) {
    const x = rng.range(-size * 0.4, size * 0.4);
    const z = rng.range(-size * 0.4, size * 0.4);
    l.prop(rng.chance(0.5) ? "rock" : "boulder", x, z, {
      scale: rng.range(0.5, 1.7),
      rotY: rng.range(0, 6.28),
      color: i.palette.rock,
    });
  }
  for (let k = 0; k < 90; k++) {
    const angle = rng.range(0, Math.PI * 2);
    const r = rng.range(4, 34);
    l.prop("grass", Math.cos(angle) * r, Math.sin(angle) * r, {
      scale: rng.range(0.7, 1.6),
      rotY: rng.range(0, 6.28),
      color: i.palette.canopy,
    });
  }
  for (let k = 0; k < 16; k++) {
    const angle = rng.range(0, Math.PI * 2);
    const r = rng.range(8, 28);
    l.prop("rubble", Math.cos(angle) * r, Math.sin(angle) * r, { scale: rng.range(0.4, 1.2) });
  }

  l.discoveries.push(
    {
      id: "altar",
      title: "The Root Altar",
      kind: "artifact",
      text: "A slab of pale stone, threaded through by roots that have grown into the carving rather than around it. The bowl at its centre is warm, and the moss inside is blooming out of season.",
    },
    {
      id: "carving",
      title: "The Keepers' Carving",
      kind: "clue",
      text: "A row of figures holding something above their heads. The last figure is missing its hands. Beneath them, one word has been cut and recut a dozen times until it is unreadable.",
    },
    {
      id: "statue",
      title: "The Fallen Keeper",
      kind: "landmark",
      text: "The statue lies face down in the loam, half swallowed. Its shoulders are wider than the doorway of the shrine, and the roots have decided to keep it.",
    },
  );
  l.events.push({
    id: "grove-bloom",
    kind: "grove-bloom",
    title: "The Grove Wakes",
    description:
      "The sanctuary answers. Light gathers under the canopy, the mist thins, and every dormant bloom in the grove opens at once.",
    triggerId: "altar-touch",
    discoveryId: "altar",
    duration: 6,
  });

  addInteraction(l, {
    id: "altar-touch",
    kind: "activate",
    label: "Touch the root altar",
    text: "The stone is warm. The roots tighten, very slightly, like a hand closing.",
    position: { x: 0, y: base + 1.5, z: -6 },
    radius: 4,
    discoveryId: "altar",
    eventId: "grove-bloom",
  });
  addInteraction(l, {
    id: "carving-read",
    kind: "read",
    label: "Study the carving",
    text: "The figures are not praying. They are holding something still.",
    position: { x: -13.5, y: l.ground(-13, -14) + 2, z: -13 },
    radius: 4,
    discoveryId: "carving",
  });
  addInteraction(l, {
    id: "statue-inspect",
    kind: "inspect",
    label: "Examine the fallen keeper",
    text: "The stone is warm on one side only. Nothing in the grove explains why.",
    position: { x: -12, y: l.ground(-12, 12) + 2.4, z: 12 },
    radius: 4.5,
    discoveryId: "statue",
  });

  l.spawn = { x: 0, y: l.ground(0, size * 0.2) + 1.7, z: size * 0.2 };
  l.lookAt = { x: 0, y: base + 4, z: -13 };
  l.camera = { fov: 62, eyeHeight: 1.7, speed: 6.2 };
}

/* ------------------------------------------------------------------ */
/*  THE LAST FRONTIER                                                  */
/* ------------------------------------------------------------------ */

function layoutFrontier(l: Layout, i: Interpretation, rng: Rng, size: number): void {
  const stone: StoneMaterial = "sandstone";
  const centreH = l.ground(0, 0) + 3.6;
  l.pad(0, 0, size * 0.145, centreH, 0.5);
  const approachH = l.ground(0, size * 0.24);
  l.pad(0, size * 0.24, size * 0.05, approachH, 1.3);
  l.pad(-size * 0.115, size * 0.16, 8, l.ground(-size * 0.115, size * 0.16), 1.4);

  const base = centreH;

  l.structure("platform", 0, -6, { y: base, scale: 0.95, material: stone });
  l.structure("observatory", 0, -18, { y: base, scale: 1.9, material: stone, landmark: true, accent: true });
  l.structure("dome", 0, -18, { y: base + 8.2, scale: 1.55, material: stone, landmark: true });
  l.structure("stairs", 0, 7, { y: base - 0.2, scale: 1.15, material: stone });
  l.structure("gate", 0, 12, { y: base, scale: 1.1, material: stone });

  // Avenue of broken pillars reaching into the desert.
  for (let k = 0; k < 7; k++) {
    const z = 20 + k * 6.5;
    const tilt = rng.range(-0.08, 0.08);
    for (const x of [-8, 8]) {
      l.structure("pillar", x + rng.range(-0.6, 0.6), z, {
        y: l.ground(x, z),
        scale: rng.range(1.1, 1.6) * (k > 4 ? 0.85 : 1),
        rotY: tilt,
        material: stone,
      });
    }
  }

  // Monuments.
  l.structure("monolith", 26, -2, { y: l.ground(26, -2), scale: 2.6, rotY: 0.2, material: stone, landmark: true });
  l.structure("monolith", -29, 8, { y: l.ground(-29, 8), scale: 2.1, rotY: -0.4, material: stone });
  l.structure("monolith", 18, 34, { y: l.ground(18, 34), scale: 1.3, rotY: 0.8, material: stone });
  l.structure("arch", -18, -24, { y: l.ground(-18, -24), scale: 1.8, rotY: 0.4, material: stone });
  l.structure("ruin", 22, -22, { y: l.ground(22, -22), scale: 1.5, rotY: -0.7, material: stone });
  l.structure("ruin", -34, -12, { y: l.ground(-34, -12), scale: 1.9, rotY: 0.2, material: stone });
  l.structure("tower", -24, -20, { y: base - 1, scale: 1.1, material: stone });
  l.structure("bridge", 0, 24, { y: base - 0.4, scale: 1, material: stone });
  l.structure("spire", 14, -8, { y: base, scale: 1.3, material: stone, accent: true });

  // Buried instrument / sealed vault.
  l.structure("monolith", 0, 2, { y: base, scale: 0.95, material: "metal", accent: true, landmark: true });

  // Desert scatter.
  for (let k = 0; k < 70; k++) {
    const x = rng.range(-size * 0.42, size * 0.42);
    const z = rng.range(-size * 0.42, size * 0.42);
    if (Math.hypot(x, z) < 14) continue;
    l.prop(rng.chance(0.55) ? "rock" : "boulder", x, z, {
      scale: rng.range(0.5, 2.2),
      rotY: rng.range(0, 6.28),
      color: i.palette.rock,
    });
  }
  for (let k = 0; k < 18; k++) {
    const angle = rng.range(0, Math.PI * 2);
    const r = rng.range(16, size * 0.38);
    l.prop("dead-tree", Math.cos(angle) * r, Math.sin(angle) * r, {
      scale: rng.range(0.9, 1.8),
      rotY: rng.range(0, 6.28),
      color: i.palette.canopy,
    });
  }
  for (let k = 0; k < 12; k++) {
    const angle = rng.range(0, Math.PI * 2);
    const r = rng.range(12, 30);
    l.prop("rubble", Math.cos(angle) * r, Math.sin(angle) * r, { scale: rng.range(0.5, 1.4) });
  }
  for (let k = 0; k < 8; k++) {
    const angle = rng.range(0, Math.PI * 2);
    const r = rng.range(30, size * 0.36);
    l.prop("obelisk", Math.cos(angle) * r, Math.sin(angle) * r, {
      scale: rng.range(0.6, 1.4),
      rotY: rng.range(0, 6.28),
      color: i.palette.rock,
    });
  }

  l.discoveries.push(
    {
      id: "vault",
      title: "The Sealed Vault",
      kind: "artifact",
      text: "A metal cap flush with the bedrock, ringed by seven notches and one that does not belong. Something under it is still keeping time.",
    },
    {
      id: "starchart",
      title: "The Last Star Chart",
      kind: "clue",
      text: "Etched into the observatory floor: a sky that does not match the one overhead. One bright point has been drilled through the stone entirely.",
    },
    {
      id: "witness",
      title: "The Witness Stone",
      kind: "landmark",
      text: "A monolith taller than the observatory, its face polished to a mirror by centuries of sand. In it, the eclipse looks back.",
    },
  );
  l.events.push({
    id: "frontier-signal",
    kind: "frontier-signal",
    title: "The Instrument Turns",
    description:
      "The vault opens. The observatory's broken instrument swings toward the eclipsed body above, and a column of pale light marks the alignment.",
    triggerId: "vault-open",
    discoveryId: "vault",
    duration: 6.5,
  });

  addInteraction(l, {
    id: "vault-open",
    kind: "activate",
    label: "Turn the sealed vault",
    text: "The cap rotates a quarter turn and stops, as though it had been waiting for exactly that much effort.",
    position: { x: 0, y: base + 1.4, z: 2 },
    radius: 4.2,
    discoveryId: "vault",
    eventId: "frontier-signal",
  });
  addInteraction(l, {
    id: "starchart-read",
    kind: "read",
    label: "Read the star chart",
    text: "Seven hundred years of patient engraving, and one correction made in a hurry.",
    position: { x: 0, y: base + 1.4, z: -12.5 },
    radius: 4,
    discoveryId: "starchart",
  });
  addInteraction(l, {
    id: "witness-inspect",
    kind: "inspect",
    label: "Look into the witness stone",
    text: "Your reflection is there. So is the eclipse. Neither one moves when you do.",
    position: { x: 26, y: l.ground(26, -2) + 3, z: -2 },
    radius: 5,
    discoveryId: "witness",
  });

  l.spawn = { x: 0, y: base - 0.375 + 1.72, z: 34 };
  l.spawnSurface = base - 0.375 + 1.72;
  l.lookAt = { x: 0, y: base + 4.5, z: -18 };
  l.camera = { fov: 70, eyeHeight: 1.7, speed: 7 };
}

/* ------------------------------------------------------------------ */
/*  GENERIC BIOMES (tundra, celestial, and unmatched prompts)          */
/* ------------------------------------------------------------------ */

function layoutTundra(l: Layout, i: Interpretation, rng: Rng, size: number): void {
  const stone: StoneMaterial = "ice";
  const centreH = l.ground(0, 0) + 1.2;
  l.pad(0, 0, size * 0.14, centreH, 0.9);
  l.pad(0, size * 0.21, size * 0.05, l.ground(0, size * 0.21) + 0.6, 1.3);
  const base = centreH;

  l.structure("temple", 0, -10, { y: base, scale: 1.5, material: stone, landmark: true });
  l.structure("platform", 0, 0, { y: base, scale: 0.85, material: stone });
  l.structure("stairs", 0, 9, { y: base - 0.2, scale: 1, material: stone });
  l.structure("arch", 0, 5, { y: base, scale: 1.4, material: stone });
  for (const x of [-9, 9]) l.structure("pillar", x, 1, { y: base, scale: 1.35, material: stone });
  l.structure("monolith", 17, 4, { y: l.ground(17, 4), scale: 2.2, rotY: 0.3, material: stone });
  l.structure("ruin", -19, -4, { y: l.ground(-19, -4), scale: 1.3, rotY: 0.5, material: stone });

  // Buried colossal statues.
  for (let k = 0; k < 7; k++) {
    const angle = (k / 7) * Math.PI * 2 + 0.3;
    const r = rng.range(22, size * 0.3);
    l.prop("obelisk", Math.cos(angle) * r, Math.sin(angle) * r, {
      scale: rng.range(1.4, 3),
      rotY: angle + rng.range(-0.4, 0.4),
      color: i.palette.rock,
    });
  }
  for (let k = 0; k < 60; k++) {
    const angle = rng.range(0, Math.PI * 2);
    const r = rng.range(14, size * 0.4);
    l.prop(rng.chance(0.3) ? "crystal" : "rock", Math.cos(angle) * r, Math.sin(angle) * r, {
      scale: rng.range(0.5, 1.8),
      rotY: rng.range(0, 6.28),
      color: i.palette.rock,
    });
  }

  l.discoveries.push(
    {
      id: "vigil",
      title: "The Frozen Vigil",
      kind: "artifact",
      text: "A figure of pale stone, kneeling, hands open. The ice has taken everything except the outline of a face turned deliberately toward the sky.",
    },
    {
      id: "ledger",
      title: "The Buried Ledger",
      kind: "clue",
      text: "Names, cut in rows, each followed by the same two words. The last row is empty except for a handprint pressed into the stone while it was still soft.",
    },
    {
      id: "colossus",
      title: "The Broken Colossus",
      kind: "landmark",
      text: "It was meant to be seen from a great distance, and it still is — though the head has been gone long enough that the snow has built a new one.",
    },
  );
  l.events.push({
    id: "vigil-thaw",
    kind: "grove-bloom",
    title: "The Vigil Ends",
    description:
      "The altar gives way. Frost lifts off the statues in a single breath, and the frozen light above the plateau turns warm.",
    triggerId: "vigil-touch",
    discoveryId: "vigil",
    duration: 6,
  });

  addInteraction(l, {
    id: "vigil-touch",
    kind: "activate",
    label: "Touch the frozen vigil",
    text: "The ice over the hands is thinner than the rest. It gives without a sound.",
    position: { x: 0, y: base + 1.6, z: -4 },
    radius: 4.2,
    discoveryId: "vigil",
    eventId: "vigil-thaw",
  });
  addInteraction(l, {
    id: "ledger-read",
    kind: "read",
    label: "Read the buried ledger",
    text: "The stone has been polished by wind until the names have no edges left.",
    position: { x: -19, y: l.ground(-19, -4) + 1.8, z: -4 },
    radius: 4,
    discoveryId: "ledger",
  });
  addInteraction(l, {
    id: "colossus-inspect",
    kind: "inspect",
    label: "Examine the colossus",
    text: "From the base, it is impossible to tell whether it is wreckage or architecture.",
    position: { x: 17, y: l.ground(17, 4) + 2.6, z: 4 },
    radius: 5,
    discoveryId: "colossus",
  });

  l.spawn = { x: 0, y: l.ground(0, size * 0.21) + 1.7, z: size * 0.21 };
  l.lookAt = { x: 0, y: base + 4, z: -10 };
  l.camera = { fov: 64, eyeHeight: 1.7, speed: 6.6 };
}

function layoutCelestial(l: Layout, i: Interpretation, rng: Rng, size: number): void {
  const stone: StoneMaterial = "marble";
  const centreH = l.ground(0, 0) + 2;
  l.pad(0, 0, size * 0.13, centreH, 0.7);
  l.pad(0, size * 0.19, size * 0.045, l.ground(0, size * 0.19) + 1, 1.2);
  const base = centreH;

  l.structure("temple", 0, -12, { y: base, scale: 1.7, material: stone, landmark: true });
  l.structure("dome", 0, -12, { y: base + 7.6, scale: 1.4, material: stone });
  l.structure("platform", 0, -4, { y: base, scale: 0.8, material: stone });
  l.structure("stairs", 0, 6, { y: base - 0.2, scale: 1.1, material: stone });
  l.structure("arch", 0, 2, { y: base, scale: 1.6, material: stone });
  for (const x of [-9, 9]) {
    for (const z of [-6, 2]) l.structure("pillar", x, z, { y: base, scale: 1.5, material: stone });
  }
  l.structure("bridge", 0, 20, { y: base - 0.6, scale: 1, material: stone });
  l.structure("spire", -16, -6, { y: base, scale: 1.5, material: stone, accent: true });
  l.structure("spire", 17, -4, { y: base, scale: 1.2, material: stone });
  l.structure("floating-isle", -26, 10, { y: base + 10, scale: 1.4, material: stone });
  l.structure("floating-isle", 28, -14, { y: base + 16, scale: 1.1, material: stone });
  l.structure("ruin", 22, 8, { y: l.ground(22, 8), scale: 1.2, rotY: -0.6, material: stone });

  for (let k = 0; k < 40; k++) {
    const angle = rng.range(0, Math.PI * 2);
    const r = rng.range(14, size * 0.38);
    l.prop(rng.chance(0.4) ? "rock" : "crystal", Math.cos(angle) * r, Math.sin(angle) * r, {
      scale: rng.range(0.6, 2),
      rotY: rng.range(0, 6.28),
      color: i.palette.rock,
    });
  }

  l.discoveries.push(
    {
      id: "choir",
      title: "The Cloud Choir",
      kind: "landmark",
      text: "Six stone throats cut into the parapet, tuned to different depths. The wind does the rest, and it is never quite the same chord twice.",
    },
    {
      id: "orrery",
      title: "The Small Orrery",
      kind: "artifact",
      text: "A brass model of a system with one sun too many. The extra sphere is the only part that still turns.",
    },
    {
      id: "margins",
      title: "The Margin Notes",
      kind: "clue",
      text: "Cut into the floor in a careful, cramped hand: \"We did not leave. We were asked to stop looking down.\"",
    },
  );
  l.events.push({
    id: "cloud-tide",
    kind: "eclipse-awakening",
    title: "The Cloud Tide",
    description:
      "The orrery locks. The cloud sea below the cathedral slows, brightens, and begins to climb.",
    triggerId: "orrery-touch",
    discoveryId: "orrery",
    duration: 6,
  });
  addInteraction(l, {
    id: "orrery-touch",
    kind: "activate",
    label: "Turn the small orrery",
    text: "The brass is warm. Somewhere below the platform, something very large adjusts its position.",
    position: { x: 0, y: base + 1.5, z: -4 },
    radius: 4,
    discoveryId: "orrery",
    eventId: "cloud-tide",
  });
  addInteraction(l, {
    id: "margins-read",
    kind: "read",
    label: "Read the margin notes",
    text: "The letters are cut at a height that suggests someone was kneeling.",
    position: { x: 9, y: base + 1.4, z: 2 },
    radius: 3.8,
    discoveryId: "margins",
  });
  addInteraction(l, {
    id: "choir-inspect",
    kind: "inspect",
    label: "Listen at the cloud choir",
    text: "The chord bends toward you and then away, as though it had been addressed to someone else.",
    position: { x: -16, y: base + 3.4, z: -6 },
    radius: 4.5,
    discoveryId: "choir",
  });

  l.spawn = { x: 0, y: l.ground(0, size * 0.19) + 1.7, z: size * 0.19 };
  l.lookAt = { x: 0, y: base + 5, z: -12 };
  l.camera = { fov: 66, eyeHeight: 1.7, speed: 6.4 };
}

function layoutGeneric(l: Layout, i: Interpretation, rng: Rng, waterLevel: number, size: number): void {
  const stone = BIOME_STONE[i.biome];
  const centreH = Math.max(l.ground(0, 0) + 1, waterLevel + 4);
  l.pad(0, 0, size * 0.13, centreH, 0.8);
  l.pad(0, size * 0.19, size * 0.045, Math.max(l.ground(0, size * 0.19), waterLevel + 1.2), 1.2);
  const base = centreH;

  l.structure("platform", 0, 0, { y: base, scale: 0.9, material: stone });
  l.structure("temple", 0, -12, { y: base, scale: 1.4, material: stone, landmark: true });
  l.structure("stairs", 0, 8, { y: base - 0.2, scale: 1, material: stone });
  l.structure("gate", 0, 4, { y: base, scale: 1.1, material: stone });
  for (const x of [-9, 9]) l.structure("pillar", x, -2, { y: base, scale: 1.3, material: stone });
  for (let k = 0; k < 5; k++) {
    const angle = (k / 5) * Math.PI * 2 + 0.4;
    const r = rng.range(26, size * 0.3);
    l.structure(rng.chance(0.5) ? "ruin" : "arch", Math.cos(angle) * r, Math.sin(angle) * r, {
      y: l.ground(Math.cos(angle) * r, Math.sin(angle) * r),
      scale: rng.range(1, 1.8),
      rotY: angle,
      material: stone,
    });
  }
  l.structure("bridge", 0, 22, { y: base - 0.4, scale: 1, material: stone });

  for (let k = 0; k < 60; k++) {
    const angle = rng.range(0, Math.PI * 2);
    const r = rng.range(13, size * 0.4);
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    if (l.ground(x, z) < waterLevel + 0.4) continue;
    l.prop(rng.chance(0.5) ? "rock" : "boulder", x, z, {
      scale: rng.range(0.5, 1.9),
      rotY: rng.range(0, 6.28),
      color: i.palette.rock,
    });
  }
  const vegCount = Math.round(40 + 70 * i.vegetation);
  for (let k = 0; k < vegCount; k++) {
    const angle = rng.range(0, Math.PI * 2);
    const r = rng.range(12, size * 0.4);
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    if (l.ground(x, z) < waterLevel + 0.6) continue;
    l.prop("tree", x, z, { scale: rng.range(0.8, 2.8), rotY: rng.range(0, 6.28), color: i.palette.canopy });
  }
  for (let k = 0; k < 10; k++) {
    const angle = rng.range(0, Math.PI * 2);
    const r = rng.range(12, 26);
    l.prop("rubble", Math.cos(angle) * r, Math.sin(angle) * r, { scale: rng.range(0.4, 1.2) });
  }

  l.discoveries.push(
    {
      id: "seal",
      title: "The Old Seal",
      kind: "artifact",
      text: "A circle of metal set into the floor, its edge worn bright by hands that are no longer here.",
    },
    {
      id: "record",
      title: "The Weathered Record",
      kind: "clue",
      text: "Most of the inscription is gone. What remains reads: \"...and when the light returns, do not...\"",
    },
    {
      id: "vantage",
      title: "The Vantage",
      kind: "landmark",
      text: "The highest remaining platform. Everything you would need to defend, and everything you would need to abandon, is visible from here.",
    },
  );
  l.events.push({
    id: "seal-open",
    kind: "eclipse-awakening",
    title: "The Seal Answers",
    description:
      "The seal turns. The atmosphere thickens with light, and the structure below the courtyard begins to move.",
    triggerId: "seal-touch",
    discoveryId: "seal",
    duration: 6,
  });
  addInteraction(l, {
    id: "seal-touch",
    kind: "activate",
    label: "Break the old seal",
    text: "It gives with a sound like a held note released.",
    position: { x: 0, y: base + 1.4, z: 1.5 },
    radius: 4,
    discoveryId: "seal",
    eventId: "seal-open",
  });
  addInteraction(l, {
    id: "record-read",
    kind: "read",
    label: "Read the weathered record",
    text: "The stone has been rained on for a very long time.",
    position: { x: -9, y: base + 1.6, z: -2 },
    radius: 3.8,
    discoveryId: "record",
  });
  addInteraction(l, {
    id: "vantage-inspect",
    kind: "inspect",
    label: "Survey from the vantage",
    text: "Nothing moves. Then, far out, something does.",
    position: { x: 0, y: base + 2.2, z: -12 },
    radius: 4.5,
    discoveryId: "vantage",
  });

  l.spawn = { x: 0, y: l.ground(0, size * 0.19) + 1.7, z: size * 0.19 };
  l.lookAt = { x: 0, y: base + 4, z: -12 };
  l.camera = { fov: 66, eyeHeight: 1.7, speed: 6.8 };
}

/* ------------------------------------------------------------------ */
/*  Remix / duplicate helpers used by the editor                       */
/* ------------------------------------------------------------------ */

export interface BuildRequest {
  prompt: string;
  presetId?: string;
  prefs?: CreationPreferences;
  seed?: string;
  name?: string;
  id?: string;
  now?: number;
}

export function buildWorld(req: BuildRequest): WorldSpec {
  const now = req.now ?? Date.now();
  const preset = findPreset(req.presetId);
  const prompt = (req.prompt || preset?.prompt || "").trim();
  const prefs: CreationPreferences = req.prefs ?? { scale: "grand", atmosphere: "inherit", method: "procedural" };

  const base = interpretPrompt(prompt);
  const i = preset ? applyPreferences(interpretPrompt(`${prompt} ${preset.prompt}`), prefs) : applyPreferences(base, prefs);

  // Presets nudge the interpretation to guarantee their authored identity.
  if (preset?.id === "obsidian-palace") {
    i.biome = "volcanic";
    i.features.eclipse = true;
    i.timeOfDay = "eclipse";
    i.features.ocean = true;
    i.water = true;
  }
  if (preset?.id === "forgotten-grove") {
    i.biome = "forest";
    i.features.forest = true;
    i.features.tree = true;
    i.vegetation = 0.9;
    i.timeOfDay = prefs.atmosphere === "inherit" ? "day" : i.timeOfDay;
    i.water = false;
  }
  if (preset?.id === "last-frontier") {
    i.biome = "desert";
    i.features.desert = true;
    i.features.observatory = true;
    i.timeOfDay = prefs.atmosphere === "inherit" ? "dusk" : i.timeOfDay;
    i.water = false;
  }

  const seed = req.seed ?? makeSeed(i.biome);
  const rng = new Rng(seed);
  const atmosphere = atmosphereFor(i, i.timeOfDay, rng);

  const scaleBias = Math.min(1.5, Math.max(0.7, i.scaleBias));
  const size = Math.round(Math.min(420, Math.max(130, 196 * scaleBias)));
  const terrainType = i.terrain;
  const amplitude = BIOME_TERRAIN_AMPLITUDE[i.biome] * (i.features.monumental ? 1.12 : 1);

  const waterEnabled = i.water || i.features.ocean || (i.biome === "volcanic" && !i.features.desert);
  const waterLevel = terrainType === "islands" ? 0.6 : waterEnabled ? -amplitude * 0.34 : -12;

  const baseTerrain = {
    type: terrainType,
    pads: [] as TerrainPad[],
    size,
    roughness: Math.min(1, Math.max(0.1, 0.55 * (i.features.ruins ? 1.1 : 1))),
    amplitude,
    lowColor: i.palette.terrainLow,
    highColor: i.palette.terrainHigh,
    rockColor: i.palette.rock,
    snow: i.biome === "tundra" ? 0.9 : i.biome === "volcanic" ? 0.04 : i.biome === "desert" ? 0 : 0.12,
  };

  const layout = new Layout(new TerrainSampler(seed, baseTerrain));

  if (preset?.id === "obsidian-palace" || (i.biome === "volcanic" && (i.features.monumental || i.features.ocean))) {
    layoutObsidian(layout, i, rng, waterLevel, size);
  } else if (preset?.id === "forgotten-grove" || (i.biome === "forest" && i.features.monumental)) {
    layoutGrove(layout, i, rng, size);
  } else if (preset?.id === "last-frontier" || (i.biome === "desert" && i.features.monumental)) {
    layoutFrontier(layout, i, rng, size);
  } else if (i.biome === "forest") {
    layoutGrove(layout, i, rng, size);
  } else if (i.biome === "desert") {
    layoutFrontier(layout, i, rng, size);
  } else if (i.biome === "tundra") {
    layoutTundra(layout, i, rng, size);
  } else if (i.biome === "celestial") {
    layoutCelestial(layout, i, rng, size);
  } else {
    layoutGeneric(layout, i, rng, waterLevel, size);
  }

  const terrain = { ...baseTerrain, pads: layout.pads };
  const wetSampler = new TerrainSampler(seed, terrain);
  // Structures author absolute heights against the padded heightfield, so they
  // are left untouched here. Props are scattered relative to the ground and are
  // re-seated on the padded surface.
  for (const p of layout.props) {
    p.y = wetSampler.heightAt(p.x, p.z);
  }

  const spawnY =
    layout.spawnSurface ?? Math.max(wetSampler.heightAt(layout.spawn.x, layout.spawn.z), waterLevel) + 1.7;

  const name = req.name?.trim() || preset?.name || deriveName(prompt, i.biome);
  const description = preset?.description ?? describe(prompt, i);

  const spec: WorldSpec = {
    schemaVersion: SCHEMA_VERSION,
    id: req.id ?? `w_${hashString(`${seed}:${now}`).toString(36)}`,
    name,
    description,
    prompt: prompt || preset?.prompt || "A world without a description.",
    seed,
    biome: i.biome,
    createdAt: now,
    updatedAt: now,
    timeOfDay: i.timeOfDay,
    atmosphere,
    terrain,
    water: {
      enabled: waterEnabled,
      level: waterEnabled ? waterLevel : -12,
      color: i.palette.water,
      deepColor: i.palette.waterDeep,
      waveHeight: i.biome === "volcanic" ? 0.32 : 0.22,
      roughness: i.biome === "volcanic" ? 0.42 : 0.55,
      opacity: 0.94,
    },
    vegetation: {
      density: Math.min(1, i.vegetation),
      scale: i.features.monumental && i.biome === "forest" ? 1.5 : 1,
      kinds: i.biome === "forest" ? ["tree", "grass"] : ["tree", "dead-tree"],
      canopyColor: i.palette.canopy,
      trunkColor: i.biome === "forest" ? "#463b2e" : "#3a332b",
    },
    geology: {
      rockDensity: i.rocky,
      crystalDensity: i.biome === "tundra" ? 0.35 : i.biome === "volcanic" ? 0.12 : 0.05,
      crystalColor: i.biome === "tundra" ? "#9fc6cf" : i.biome === "volcanic" ? "#b96f3f" : i.palette.accent,
    },
    stone: preset ? BIOME_STONE[preset.biome] : i.stone,
    stoneColor: i.biome === "volcanic" ? "#4c4e55" : i.palette.terrainHigh,
    accentColor: i.palette.accent,
    structures: layout.structures,
    props: layout.props,
    camera: {
      ...layout.camera,
      spawn: { x: layout.spawn.x, y: spawnY, z: layout.spawn.z },
      lookAt: layout.lookAt,
    },
    audio: {
      ambience: i.biome === "volcanic" ? "ocean" : i.biome === "desert" ? "desert" : i.biome === "forest" ? "forest" : "wind",
      volume: 0.5,
    },
    interactions: layout.interactions,
    discoveries: layout.discoveries,
    events: layout.events,
    generation: {
      method: req.prefs?.method === "ai" ? "ai" : "procedural",
      presetId: req.presetId,
      scale: prefs.scale,
      notes: i.notes.slice(0, 12),
    },
    edits: {},
    exploration: {
      position: { x: layout.spawn.x, y: spawnY, z: layout.spawn.z },
      yaw: Math.atan2(layout.spawn.x - layout.lookAt.x, layout.spawn.z - layout.lookAt.z),
      pitch: 0,
      discoveries: [],
      eventStates: Object.fromEntries(layout.events.map((e) => [e.id, "idle" as const])),
    },
  };

  return parseWorld(spec);
}

function describe(prompt: string, i: Interpretation): string {
  const first = prompt.trim().replace(/\s+/g, " ").split(/(?<=\.)\s/)[0] ?? prompt;
  const clipped = first.length > 220 ? `${first.slice(0, 217)}…` : first;
  const mood =
    i.biome === "forest"
      ? "Old growth, colder light, and stone that has stopped arguing with the roots."
      : i.biome === "desert"
        ? "Long sightlines, dry air, and monuments that were built to outlast their names."
        : i.biome === "tundra"
          ? "Pale light, buried architecture, and a silence with weight to it."
          : i.biome === "celestial"
            ? "Pale stone, thin air, and nothing solid beneath the horizon."
            : "Black water, black stone, and a sun that has already made its decision.";
  return `${clipped} ${mood}`;
}

/** New seed, same theme. Produces genuinely different geometry and placement. */
export function remixWorld(spec: WorldSpec, now = Date.now()): WorldSpec {
  const remixed = buildWorld({
    prompt: spec.prompt,
    presetId: spec.generation.presetId,
    seed: makeSeed(spec.biome, `${spec.seed}:${now}`),
    name: spec.name,
    now,
    prefs: {
      scale: spec.generation.scale,
      atmosphere: "inherit",
      method: spec.generation.method,
    },
    id: `w_${hashString(`${spec.name}:${now}:remix`).toString(36)}`,
  });
  // Preserve authored discoveries? No — a remix is a new place. Fresh state.
  return remixed;
}

export function duplicateWorld(spec: WorldSpec, now = Date.now()): WorldSpec {
  return parseWorld({
    ...structuredClone(spec),
    id: `w_${hashString(`${spec.id}:${now}:copy`).toString(36)}`,
    name: `${spec.name} (Copy)`,
    createdAt: now,
    updatedAt: now,
    exploration: {
      position: { ...spec.camera.spawn },
      yaw: spec.exploration.yaw,
      pitch: 0,
      discoveries: [],
      eventStates: Object.fromEntries(spec.events.map((e) => [e.id, "idle" as const])),
    },
  });
}