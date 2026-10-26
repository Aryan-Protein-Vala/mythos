import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { StructureSpec, WorldSpec } from "../world/types";
import { stoneDetailTexture } from "./textures";

export interface Collider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  bottom: number;
  top: number;
  walkable: boolean;
}

export type MaterialKey = "stone" | "stoneDark" | "stoneLight" | "accent" | "metal" | "crystal";

interface Piece {
  geometry: THREE.BufferGeometry;
  material: MaterialKey;
}

export interface StructureBuild {
  group: THREE.Group;
  colliders: Collider[];
  accentAnchors: THREE.Vector3[];
}

/* ------------------------------------------------------------------ */
/*  Materials                                                          */
/* ------------------------------------------------------------------ */

export interface WorldMaterialSet {
  stone: THREE.MeshStandardMaterial;
  stoneDark: THREE.MeshStandardMaterial;
  stoneLight: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  crystal: THREE.MeshStandardMaterial;
  byKey: Record<MaterialKey, THREE.MeshStandardMaterial>;
  dispose(): void;
}

function stoneMaterial(color: string, roughness: number, metalness: number, tiling: number): THREE.MeshStandardMaterial {
  const map = stoneDetailTexture().clone();
  map.needsUpdate = true;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(tiling, tiling);
  const m = new THREE.MeshStandardMaterial({
    color,
    map,
    roughness,
    metalness,
    flatShading: true,
  });
  m.userData.map = map;
  return m;
}

export function createMaterials(spec: WorldSpec): WorldMaterialSet {
  const base = new THREE.Color(spec.stoneColor);
  const dark = base.clone().multiplyScalar(0.62);
  const light = base.clone().lerp(new THREE.Color("#ffffff"), 0.16);
  const isIce = spec.stone === "ice";
  const isObsidian = spec.stone === "obsidian";
  const isMarble = spec.stone === "marble";
  const isMetal = spec.stone === "metal";

  const stone = stoneMaterial(`#${base.getHexString()}`, isObsidian ? 0.5 : isIce ? 0.42 : 0.88, isObsidian ? 0.14 : isMetal ? 0.7 : 0.04, isObsidian ? 3 : 2);
  const stoneDark = stoneMaterial(`#${dark.getHexString()}`, isObsidian ? 0.7 : 0.92, isObsidian ? 0.04 : 0.03, 2.4);
  const stoneLight = stoneMaterial(`#${light.getHexString()}`, isMarble ? 0.55 : 0.8, 0.06, 1.6);
  const accent = new THREE.MeshStandardMaterial({
    color: spec.accentColor,
    emissive: new THREE.Color(spec.accentColor),
    emissiveIntensity: 0.75,
    roughness: 0.42,
    metalness: 0.55,
  });
  const metal = new THREE.MeshStandardMaterial({
    color: "#5a5449",
    metalness: 0.85,
    roughness: 0.38,
    flatShading: true,
  });
  const crystal = new THREE.MeshStandardMaterial({
    color: spec.geology.crystalColor,
    emissive: new THREE.Color(spec.geology.crystalColor),
    emissiveIntensity: 0.5,
    roughness: 0.12,
    metalness: 0.1,
    transparent: true,
    opacity: 0.92,
    flatShading: true,
  });

  return {
    stone,
    stoneDark,
    stoneLight,
    accent,
    metal,
    crystal,
    byKey: { stone, stoneDark, stoneLight, accent, metal, crystal },
    dispose() {
      for (const m of [stone, stoneDark, stoneLight, accent, metal, crystal]) {
        const map = m.userData.map as THREE.Texture | undefined;
        if (map) map.dispose();
        m.dispose();
      }
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Local geometry helpers                                             */
/* ------------------------------------------------------------------ */

/** World units one texture tile should cover before the material's own repeat. */
const UV_TILE = 7;

function scaleBoxUvs(geo: THREE.BoxGeometry, w: number, h: number, d: number): void {
  const uv = geo.getAttribute("uv") as THREE.BufferAttribute;
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z, four vertices each.
  const spans: Array<[number, number]> = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let face = 0; face < spans.length; face++) {
    const [su, sv] = spans[face];
    const uScale = Math.max(1, su / UV_TILE);
    const vScale = Math.max(1, sv / UV_TILE);
    for (let corner = 0; corner < 4; corner++) {
      const i = face * 4 + corner;
      uv.setXY(i, uv.getX(i) * uScale, uv.getY(i) * vScale);
    }
  }
  uv.needsUpdate = true;
}

class Assembler {
  pieces: Piece[] = [];
  colliders: Collider[] = [];
  accentAnchors: THREE.Vector3[] = [];
  private worldMatrix: THREE.Matrix4;

  constructor(private spec: StructureSpec) {
    this.worldMatrix = new THREE.Matrix4().compose(
      new THREE.Vector3(spec.x, spec.y, spec.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, spec.rotY, 0)),
      new THREE.Vector3(spec.scale, spec.scale, spec.scale),
    );
  }

  add(
    material: MaterialKey,
    geometry: THREE.BufferGeometry,
    x = 0,
    y = 0,
    z = 0,
    rx = 0,
    ry = 0,
    rz = 0,
  ): void {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
      new THREE.Vector3(1, 1, 1),
    );
    // Mixing indexed primitives (box/cylinder) with non-indexed ones
    // (polyhedra) breaks mergeGeometries, so normalise every piece.
    let geo = geometry;
    if (geo.index) {
      geo = geo.toNonIndexed();
      geometry.dispose();
    }
    geo.applyMatrix4(m);
    geo.applyMatrix4(this.worldMatrix);
    this.pieces.push({ geometry: geo, material });
  }

  box(material: MaterialKey, w: number, h: number, d: number, x = 0, y = 0, z = 0, ry = 0): void {
    const geo = new THREE.BoxGeometry(w, h, d);
    // Box UVs are normalised per face, so a 24 m deck would stretch one texture
    // tile across its whole length and read as marble veining. Scale them by the
    // face's world size so detail density stays constant across every piece.
    scaleBoxUvs(geo, w, h, d);
    this.add(material, geo, x, y, z, 0, ry, 0);
  }

  cylinder(
    material: MaterialKey,
    rt: number,
    rb: number,
    h: number,
    x = 0,
    y = 0,
    z = 0,
    seg = 14,
    ry = 0,
  ): void {
    this.add(material, new THREE.CylinderGeometry(rt, rb, h, seg), x, y, z, 0, ry, 0);
  }

  /** Local footprint collider (axis aligned in structure space). */
  collide(cx: number, cz: number, width: number, depth: number, bottom: number, top: number, walkable = false): void {
    const s = this.spec.scale;
    const corners = [
      new THREE.Vector3((cx - width / 2) * s, 0, (cz - depth / 2) * s),
      new THREE.Vector3((cx + width / 2) * s, 0, (cz - depth / 2) * s),
      new THREE.Vector3((cx - width / 2) * s, 0, (cz + depth / 2) * s),
      new THREE.Vector3((cx + width / 2) * s, 0, (cz + depth / 2) * s),
    ];
    const rot = new THREE.Matrix4().makeRotationY(this.spec.rotY);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const c of corners) {
      c.applyMatrix4(rot);
      minX = Math.min(minX, c.x + this.spec.x);
      maxX = Math.max(maxX, c.x + this.spec.x);
      minZ = Math.min(minZ, c.z + this.spec.z);
      maxZ = Math.max(maxZ, c.z + this.spec.z);
    }
    this.colliders.push({
      minX,
      maxX,
      minZ,
      maxZ,
      bottom: this.spec.y + bottom * s,
      top: this.spec.y + top * s,
      walkable,
    });
  }

  anchor(x: number, y: number, z: number): void {
    const p = new THREE.Vector3(x, y, z).applyMatrix4(this.worldMatrix);
    this.accentAnchors.push(p);
  }

  finish(root: THREE.Group, materials: WorldMaterialSet): Collider[] {
    const buckets = new Map<MaterialKey, THREE.BufferGeometry[]>();
    for (const p of this.pieces) {
      if (!buckets.has(p.material)) buckets.set(p.material, []);
      buckets.get(p.material)!.push(p.geometry);
    }
    for (const [key, geoms] of buckets) {
      if (!geoms.length) continue;
      const merged = geoms.length === 1 ? geoms[0] : mergeGeometries(geoms, false);
      if (geoms.length > 1) for (const g of geoms) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, materials.byKey[key]);
      mesh.castShadow = key !== "accent" && key !== "crystal";
      mesh.receiveShadow = true;
      if (key === "accent") mesh.userData.accent = true;
      root.add(mesh);
    }
    return this.colliders;
  }
}

/* ------------------------------------------------------------------ */
/*  Structure catalogue                                                */
/* ------------------------------------------------------------------ */

function buildPillar(a: Assembler): void {
  a.box("stoneDark", 2.9, 0.55, 2.9, 0, 0.27, 0);
  a.box("stone", 2.4, 0.35, 2.4, 0, 0.68, 0);
  a.cylinder("stone", 0.78, 0.92, 6.1, 0, 3.9, 0, 12);
  a.box("stoneLight", 2.1, 0.42, 2.1, 0, 7.12, 0);
  a.box("stoneDark", 2.45, 0.3, 2.45, 0, 7.45, 0);
  a.collide(0, 0, 2.9, 2.9, 0, 7.6);
}

function buildArch(a: Assembler): void {
  for (const x of [-2.9, 2.9]) {
    a.box("stoneDark", 1.9, 0.5, 1.9, x, 0.25, 0);
    a.box("stone", 1.55, 4.6, 1.55, x, 2.8, 0);
    a.collide(x, 0, 1.9, 1.9, 0, 5.1);
  }
  const torus = new THREE.TorusGeometry(2.9, 0.62, 8, 26, Math.PI);
  a.add("stone", torus, 0, 5.05, 0, 0, 0, 0);
  a.box("stoneLight", 1.1, 1.0, 1.9, 0, 6.9, 0);
  a.anchor(0, 5.6, 0);
}

function buildWall(a: Assembler): void {
  a.box("stone", 8.6, 3.4, 0.95, 0, 1.7, 0);
  for (let i = -2; i <= 2; i++) {
    a.box("stoneDark", 0.85, 0.85, 0.95, i * 1.6, 3.8, 0);
  }
  a.box("stoneDark", 9.2, 0.5, 1.2, 0, 0.25, 0);
  a.collide(0, 0, 8.6, 1.2, 0, 4.2);
}

function buildStairs(a: Assembler): void {
  const steps = 7;
  for (let i = 0; i < steps; i++) {
    const h = 0.34 * (i + 1);
    const z = 2.4 - i * 0.78;
    a.box("stone", 5.6, h, 0.85, 0, h / 2, z);
    a.collide(0, z, 5.6, 0.85, 0, h, true);
  }
}

function buildTower(a: Assembler): void {
  a.box("stoneDark", 7.2, 1.1, 7.2, 0, 0.55, 0);
  a.cylinder("stone", 3.1, 3.45, 11.5, 0, 6.6, 0, 16);
  a.cylinder("stoneLight", 3.35, 3.2, 0.7, 0, 12.6, 0, 16);
  for (let i = 0; i < 9; i++) {
    const angle = (i / 9) * Math.PI * 2;
    a.box("stoneDark", 0.9, 1.05, 0.9, Math.cos(angle) * 3.0, 13.4, Math.sin(angle) * 3.0, angle);
  }
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + 0.4;
    a.box("accent", 0.28, 2.4, 0.28, Math.cos(angle) * 3.12, 6.4, Math.sin(angle) * 3.12, angle);
  }
  a.anchor(0, 12.8, 0);
  a.collide(0, 0, 7.2, 7.2, 0, 14);
}

function buildGate(a: Assembler): void {
  for (const x of [-4.6, 4.6]) {
    a.box("stoneDark", 2.9, 1.0, 3.2, x, 0.5, 0);
    a.box("stone", 2.35, 8.4, 2.5, x, 5.2, 0);
    a.box("stoneLight", 2.7, 0.55, 2.8, x, 9.55, 0);
    a.collide(x, 0, 2.9, 3.2, 0, 10);
  }
  a.box("stone", 11.6, 1.25, 2.9, 0, 9.9, 0);
  a.box("stoneDark", 12.2, 0.45, 3.2, 0, 10.8, 0);
  a.box("accent", 4.4, 0.16, 0.2, 0, 9.32, -1.5);
  a.anchor(0, 9.9, 0);
}

function buildPlatform(a: Assembler): void {
  a.box("stone", 30, 1.5, 30, 0, -0.75, 0);
  a.box("stoneDark", 31.4, 0.5, 31.4, 0, -1.55, 0);
  a.box("stoneLight", 30.6, 0.18, 30.6, 0, 0.03, 0);
  // corner plinths
  for (const [x, z] of [
    [-13.5, -13.5],
    [13.5, -13.5],
    [-13.5, 13.5],
    [13.5, 13.5],
  ]) {
    a.box("stoneDark", 2.0, 1.1, 2.0, x, 0.5, z);
  }
  a.collide(0, 0, 30, 30, -1.6, 0, true);
}

function buildRuin(a: Assembler): void {
  a.box("stone", 6.4, 2.9, 0.85, 0, 1.45, 0, 0.06);
  a.box("stoneDark", 5.2, 1.4, 0.75, 1.8, 3.5, 0, -0.04);
  a.box("stone", 1.5, 1.4, 0.75, -3.1, 3.6, 0);
  a.cylinder("stone", 0.62, 0.7, 4.4, -5.2, 0.55, 2.4, 10, 1.2);
  a.add("stone", new THREE.CylinderGeometry(0.6, 0.72, 3.0, 10), 4.4, 0.4, 2.8, Math.PI / 2, 0.4, 0);
  a.collide(0, 0, 6.4, 1.4, 0, 4.4);
  a.collide(-5.2, 2.4, 1.6, 1.6, 0, 1.2);
}

function buildSpire(a: Assembler): void {
  a.box("stoneDark", 5.4, 0.9, 5.4, 0, 0.45, 0);
  a.cylinder("stone", 0.35, 2.3, 15.5, 0, 8.6, 0, 8);
  a.cylinder("accent", 0.1, 0.42, 2.4, 0, 17.1, 0, 8);
  a.collide(0, 0, 5.4, 5.4, 0, 4);
}

function buildTemple(a: Assembler): void {
  a.box("stoneDark", 29, 0.9, 25, 0, 0.45, 0);
  a.box("stone", 26, 0.9, 22, 0, 1.35, 0);
  a.box("stoneLight", 22.5, 0.7, 18.5, 0, 2.15, 0);
  // colonnade
  const xs = [-9.5, -4.75, 0, 4.75, 9.5];
  for (const x of xs) {
    a.box("stoneDark", 1.7, 0.35, 1.7, x, 2.65, 7.2);
    a.cylinder("stone", 0.62, 0.78, 7.4, x, 6.5, 7.2, 10);
    a.box("stoneLight", 1.6, 0.36, 1.6, x, 10.35, 7.2);
    a.collide(x, 7.2, 1.7, 1.7, 2.5, 10.5);
  }
  // side walls
  for (const x of [-10.6, 10.6]) {
    a.box("stone", 1.5, 8.2, 15, x, 6.4, -0.6);
    a.collide(x, -0.6, 1.8, 15, 2.5, 10.5);
  }
  // back wall
  a.box("stone", 21.5, 7.6, 1.4, 0, 6.1, -8.2);
  a.collide(0, -8.2, 21.5, 1.6, 2.5, 9.9);
  // roof
  a.box("stoneDark", 24, 1.15, 19.5, 0, 11.4, 0);
  a.box("stoneLight", 25, 0.4, 20.5, 0, 10.75, 0);
  // inner dais
  a.box("stoneDark", 9, 0.6, 6, 0, 2.75, -3.4);
  // accent strips at the threshold
  for (const x of [-10.6, 10.6]) {
    a.box("accent", 0.18, 3.6, 0.18, x + (x > 0 ? -0.85 : 0.85), 5.4, 6.4);
  }
  a.anchor(0, 3.0, -2);
  a.anchor(0, 7.0, -5.5);
}

function buildDome(a: Assembler): void {
  a.cylinder("stoneLight", 5.0, 5.0, 1.2, 0, 0.6, 0, 20);
  a.add("stone", new THREE.SphereGeometry(5.0, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2), 0, 1.2, 0);
  a.add("stoneDark", new THREE.TorusGeometry(5.0, 0.28, 6, 24), 0, 1.2, 0, Math.PI / 2, 0, 0);
  // dark slit in the dome
  a.box("stoneDark", 0.9, 4.4, 0.6, 0, 4.2, 3.6);
}

function buildMonolith(a: Assembler): void {
  a.box("stoneDark", 4.2, 0.9, 4.2, 0, 0.45, 0);
  a.add("metal", new THREE.CylinderGeometry(0.85, 1.55, 9.2, 4), 0, 5.4, 0, 0, Math.PI / 4, 0);
  a.box("accent", 0.14, 4.4, 0.14, 0, 5.4, 1.08);
  a.collide(0, 0, 4.2, 4.2, 0, 9.8);
  a.anchor(0, 5.2, 0);
}

function buildBridge(a: Assembler): void {
  a.box("stone", 5.0, 0.75, 24, 0, -0.35, 0);
  for (const z of [-8.4, 0, 8.4]) {
    a.box("stoneDark", 3.8, 9.2, 2.6, 0, -5.1, z);
  }
  a.box("stone", 5.2, 0.14, 24, 0, 0.04, 0);
  for (const x of [-2.35, 2.35]) {
    a.box("stoneDark", 0.5, 1.15, 24, x, 0.5, 0);
    for (let i = -2; i <= 2; i++) {
      a.box("stone", 0.75, 1.4, 0.75, x, 1.1, i * 5.2);
    }
  }
  for (const z of [-8, 0, 8]) {
    a.add("stoneDark", new THREE.TorusGeometry(3.1, 0.42, 6, 16, Math.PI), 0, -0.8, z, 0, Math.PI / 2, Math.PI);
  }
  a.collide(0, 0, 5.2, 24, -3, 0, true);
}

function buildThrone(a: Assembler): void {
  a.box("stoneDark", 5.4, 0.6, 4.4, 0, 0.3, 0);
  a.box("stone", 2.9, 0.9, 2.0, 0, 1.05, 0);
  a.box("stone", 3.0, 3.6, 0.65, 0, 2.4, -1.0);
  a.box("stoneLight", 3.3, 0.3, 0.9, 0, 4.2, -1.0);
  for (const x of [-1.5, 1.5]) {
    a.box("stoneDark", 0.55, 1.1, 2.0, x, 1.5, 0);
  }
  a.box("accent", 0.22, 2.6, 0.22, 0, 3.6, -1.45);
  a.anchor(0, 4.3, -1.2);
  a.collide(0, 0, 5.4, 4.4, 0, 0.9, true);
  a.anchor(0, 4.4, -1);
}

function buildObservatory(a: Assembler): void {
  a.box("stoneDark", 14, 1.2, 14, 0, 0.6, 0);
  a.cylinder("stone", 5.2, 5.6, 8.4, 0, 5.4, 0, 20);
  a.cylinder("stoneLight", 5.5, 5.4, 0.6, 0, 9.9, 0, 20);
  // dome shell with an opening
  a.add("stone", new THREE.SphereGeometry(5.2, 20, 12, 0.5, Math.PI * 2 - 1.0, 0, Math.PI / 2), 0, 9.9, 0);
  a.box("accent", 0.5, 0.5, 9.5, 0, 12.4, 0.4);
  a.add(
    "metal",
    new THREE.CylinderGeometry(0.42, 0.62, 9.5, 10),
    0,
    13.4,
    -0.6,
    Math.PI / 3.1,
    0,
    0,
  );
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    a.box("accent", 0.16, 2.2, 0.16, Math.cos(angle) * 5.3, 5.6, Math.sin(angle) * 5.3);
  }
  a.collide(0, 0, 14, 14, 0, 10);
  a.anchor(0, 12, 0);
}

function buildShrine(a: Assembler): void {
  a.box("stoneDark", 4.6, 0.5, 4.6, 0, 0.25, 0);
  a.box("stone", 2.4, 1.15, 2.4, 0, 1.05, 0);
  a.box("stoneLight", 2.7, 0.18, 2.7, 0, 1.68, 0);
  for (const [x, z] of [
    [-1.9, -1.9],
    [1.9, -1.9],
    [-1.9, 1.9],
    [1.9, 1.9],
  ]) {
    a.box("stone", 0.42, 3.6, 0.42, x, 2.2, z);
  }
  a.box("stoneDark", 5.0, 0.4, 5.0, 0, 4.15, 0);
  a.box("accent", 0.35, 0.35, 0.35, 0, 1.85, 0);
  a.collide(0, 0, 4.6, 4.6, 0, 1.8);
  a.anchor(0, 2.2, 0);
}

function buildFloatingIsle(a: Assembler): void {
  a.cylinder("stoneDark", 7.2, 2.4, 3.2, 0, -1.6, 0, 12);
  a.add("stoneDark", new THREE.ConeGeometry(2.4, 5.0, 12), 0, -5.6, 0, Math.PI, 0, 0);
  a.cylinder("stone", 7.4, 7.0, 1.0, 0, 0.5, 0, 12);
  a.cylinder("stoneLight", 7.0, 7.0, 0.16, 0, 1.05, 0, 12);
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2;
    a.cylinder("stone", 0.4, 0.55, 4.4, Math.cos(angle) * 4.4, 3.3, Math.sin(angle) * 4.4, 8);
  }
  a.anchor(0, 2.4, 0);
}

const BUILDERS: Record<StructureSpec["kind"], (a: Assembler) => void> = {
  pillar: buildPillar,
  arch: buildArch,
  wall: buildWall,
  stairs: buildStairs,
  tower: buildTower,
  gate: buildGate,
  platform: buildPlatform,
  ruin: buildRuin,
  spire: buildSpire,
  temple: buildTemple,
  dome: buildDome,
  monolith: buildMonolith,
  bridge: buildBridge,
  throne: buildThrone,
  observatory: buildObservatory,
  shrine: buildShrine,
  "floating-isle": buildFloatingIsle,
};

export function buildArchitecture(
  spec: WorldSpec,
  materials: WorldMaterialSet,
  filter: (s: StructureSpec) => boolean = () => true,
): StructureBuild {
  const group = new THREE.Group();
  group.name = "architecture";
  const colliders: Collider[] = [];
  const accentAnchors: THREE.Vector3[] = [];

  for (const s of spec.structures) {
    if (!filter(s)) continue;
    const a = new Assembler(s);
    BUILDERS[s.kind](a);
    colliders.push(...a.finish(group, materials));
    accentAnchors.push(...a.accentAnchors);
  }

  return { group, colliders, accentAnchors };
}