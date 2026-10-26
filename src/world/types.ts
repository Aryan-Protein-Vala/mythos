/**
 * MYTHOS world specification.
 *
 * A world is described entirely by declarative data. The renderer materialises
 * that data using a fixed library of procedural building blocks — no generated
 * code is ever executed. This is what makes worlds exportable, diffable,
 * remixable and safe to import.
 */

export const SCHEMA_VERSION = 3 as const;

export type BiomeId = "volcanic" | "forest" | "desert" | "tundra" | "celestial";

export type TimeOfDay = "dawn" | "day" | "dusk" | "night" | "eclipse";

export type SkyKind = "eclipse" | "sun" | "moon" | "overcast" | "cloudsea";

export type ParticleKind = "embers" | "mist" | "snow" | "dust" | "fireflies" | "rain" | "none";

export type TerrainType = "islands" | "rolling" | "dunes" | "ice" | "plateau";

export type StoneMaterial = "obsidian" | "sandstone" | "granite" | "marble" | "ice" | "wood" | "metal";

export type StructureKind =
  | "pillar"
  | "arch"
  | "wall"
  | "stairs"
  | "tower"
  | "gate"
  | "platform"
  | "ruin"
  | "spire"
  | "temple"
  | "dome"
  | "monolith"
  | "bridge"
  | "throne"
  | "observatory"
  | "shrine"
  | "floating-isle";

export type PropKind =
  | "rock"
  | "boulder"
  | "crystal"
  | "tree"
  | "dead-tree"
  | "palm"
  | "grass"
  | "island"
  | "rubble"
  | "obelisk";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface StructureSpec {
  id: string;
  kind: StructureKind;
  x: number;
  y: number;
  z: number;
  rotY: number;
  scale: number;
  material: StoneMaterial;
  /** Landmark pieces respond to the editor's landmark scale / rotation controls. */
  landmark?: boolean;
  accent?: boolean;
}

export interface PropSpec {
  id: string;
  kind: PropKind;
  x: number;
  y: number;
  z: number;
  rotY: number;
  scale: number;
  color?: string;
}

export interface SkySpec {
  kind: SkyKind;
  top: string;
  horizon: string;
  sunColor: string;
  sunIntensity: number;
  sunAzimuth: number;
  sunElevation: number;
  discSize: number;
  corona: number;
  stars: number;
}

export interface FogSpec {
  color: string;
  /** Exponential-squared density. 0.0008 (clear) – 0.02 (opaque). */
  density: number;
}

export interface LightingSpec {
  keyIntensity: number;
  ambientIntensity: number;
  keyColor: string;
  ambientColor: string;
  accentColor: string;
  accentIntensity: number;
}

export interface ParticleSpec {
  kind: ParticleKind;
  density: number;
  color: string;
}

export interface AtmosphereSpec {
  sky: SkySpec;
  fog: FogSpec;
  lighting: LightingSpec;
  particles: ParticleSpec;
}

/** A flattened building pad carved into the terrain heightfield. */
export interface TerrainPad {
  x: number;
  z: number;
  radius: number;
  height: number;
  blend: number;
}

export interface TerrainSpec {
  type: TerrainType;
  pads: TerrainPad[];
  /** World edge length in metres. */
  size: number;
  roughness: number;
  amplitude: number;
  lowColor: string;
  highColor: string;
  rockColor: string;
  snow: number;
}

export interface WaterSpec {
  enabled: boolean;
  level: number;
  color: string;
  deepColor: string;
  waveHeight: number;
  roughness: number;
  opacity: number;
}

export interface VegetationSpec {
  density: number;
  scale: number;
  kinds: Array<"tree" | "dead-tree" | "palm" | "grass">;
  canopyColor: string;
  trunkColor: string;
}

export interface GeologySpec {
  rockDensity: number;
  crystalDensity: number;
  crystalColor: string;
}

export interface CameraSpec {
  fov: number;
  eyeHeight: number;
  speed: number;
  spawn: Vec3;
  lookAt: Vec3;
}

export interface AudioSpec {
  ambience: "wind" | "ocean" | "forest" | "desert" | "none";
  volume: number;
}

export type InteractionKind = "inspect" | "enter" | "activate" | "read" | "descend";

export interface InteractionSpec {
  id: string;
  kind: InteractionKind;
  /** Verb phrase shown in the hint, e.g. "Inspect the sealed reliquary". */
  label: string;
  /** Prose shown after interacting. */
  text: string;
  position: Vec3;
  radius: number;
  discoveryId?: string;
  eventId?: string;
}

export type DiscoveryKind = "artifact" | "secret" | "landmark" | "clue";

export interface DiscoverySpec {
  id: string;
  title: string;
  text: string;
  kind: DiscoveryKind;
}

export type EventKind = "eclipse-awakening" | "grove-bloom" | "frontier-signal";

export interface EventSpec {
  id: string;
  kind: EventKind;
  title: string;
  description: string;
  triggerId: string;
  discoveryId: string;
  /** Seconds the transition takes once triggered. */
  duration: number;
}

export interface GenerationSpec {
  method: "procedural" | "ai";
  presetId?: string;
  scale: "intimate" | "grand" | "vast";
  notes: string[];
}

/** Post-generation user overrides. Kept separate so the generated base survives. */
export interface WorldEdits {
  timeOfDay?: TimeOfDay;
  skyKind?: SkyKind;
  fogDensity?: number;
  fogColor?: string;
  keyIntensity?: number;
  ambientIntensity?: number;
  accentIntensity?: number;
  terrainRoughness?: number;
  terrainAmplitude?: number;
  vegetationDensity?: number;
  rockDensity?: number;
  waterColor?: string;
  waveHeight?: number;
  particleKind?: ParticleKind;
  particleDensity?: number;
  stoneColor?: string;
  landmarkScale?: number;
  landmarkRotation?: number;
  landmarkVisible?: boolean;
}

export interface ExplorationState {
  position: Vec3;
  yaw: number;
  pitch: number;
  discoveries: string[];
  eventStates: Record<string, "idle" | "active" | "resolved">;
}

export interface WorldSpec {
  schemaVersion: number;
  id: string;
  name: string;
  description: string;
  prompt: string;
  seed: string;
  biome: BiomeId;
  createdAt: number;
  updatedAt: number;
  timeOfDay: TimeOfDay;
  atmosphere: AtmosphereSpec;
  terrain: TerrainSpec;
  water: WaterSpec;
  vegetation: VegetationSpec;
  geology: GeologySpec;
  stone: StoneMaterial;
  stoneColor: string;
  accentColor: string;
  structures: StructureSpec[];
  props: PropSpec[];
  camera: CameraSpec;
  audio: AudioSpec;
  interactions: InteractionSpec[];
  discoveries: DiscoverySpec[];
  events: EventSpec[];
  generation: GenerationSpec;
  edits: WorldEdits;
  exploration: ExplorationState;
}

export interface SavedWorld {
  spec: WorldSpec;
  updatedAt: number;
}

export interface WorldSummary {
  id: string;
  name: string;
  description: string;
  biome: BiomeId;
  seed: string;
  updatedAt: number;
  createdAt: number;
  discoveryCount: number;
  totalDiscoveries: number;
  presetId?: string;
}

export type CreationPreferences = {
  scale: "intimate" | "grand" | "vast";
  atmosphere: "inherit" | "clear" | "haze" | "night" | "eclipse";
  method: "procedural" | "ai";
};