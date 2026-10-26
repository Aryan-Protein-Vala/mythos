import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { WorldSpec } from "../world/types";
import type { Collider } from "./architecture";
import { Rng, hashString } from "../world/rng";

export interface NatureBuild {
  group: THREE.Group;
  colliders: Collider[];
  canopyMaterial: THREE.MeshStandardMaterial;
  dispose(): void;
}

function tinted(geometry: THREE.BufferGeometry, color: THREE.Color, variance = 0): THREE.BufferGeometry {
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);
  const c = color.clone();
  if (variance) c.multiplyScalar(1 + variance);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

export function buildNature(spec: WorldSpec): NatureBuild {
  const group = new THREE.Group();
  group.name = "nature";
  const colliders: Collider[] = [];
  const rng = new Rng(hashString(`${spec.seed}:props`));
  const water = spec.water.enabled ? spec.water.level : -999;

  // Bark sits in deep canopy shadow, so a whisper of self-lit colour stands in
  // for bounce light and keeps near trunks from reading as black slabs.
  const trunkColor = new THREE.Color(spec.vegetation.trunkColor);
  const trunkMaterial = new THREE.MeshStandardMaterial({
    color: trunkColor,
    emissive: trunkColor,
    emissiveIntensity: 0.11,
    roughness: 0.95,
    metalness: 0,
    flatShading: true,
  });
  const canopyMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.94,
    metalness: 0,
    flatShading: true,
  });
  const rockMaterial = new THREE.MeshStandardMaterial({
    color: spec.terrain.rockColor,
    roughness: 0.97,
    metalness: 0.03,
    flatShading: true,
  });
  const rubbleMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(spec.terrain.rockColor).multiplyScalar(0.8),
    roughness: 1,
    metalness: 0,
    flatShading: true,
  });
  const crystalMaterial = new THREE.MeshStandardMaterial({
    color: spec.geology.crystalColor,
    emissive: new THREE.Color(spec.geology.crystalColor),
    emissiveIntensity: 0.45,
    roughness: 0.15,
    metalness: 0.1,
    flatShading: true,
    transparent: true,
    opacity: 0.9,
  });
  const grassMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    metalness: 0,
    side: THREE.DoubleSide,
  });

  const trunks: THREE.BufferGeometry[] = [];
  const canopies: THREE.BufferGeometry[] = [];
  const rocks: THREE.BufferGeometry[] = [];
  const rubble: THREE.BufferGeometry[] = [];
  const crystals: THREE.BufferGeometry[] = [];
  const grass: THREE.BufferGeometry[] = [];
  const canopyBase = new THREE.Color(spec.vegetation.canopyColor);
  const grassBase = new THREE.Color(spec.vegetation.canopyColor).lerp(new THREE.Color("#8a9464"), 0.35);

  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const pos = new THREE.Vector3();

  const place = (
    bucket: THREE.BufferGeometry[],
    geometry: THREE.BufferGeometry,
    x: number,
    y: number,
    z: number,
    rotY: number,
    s: number,
    tiltX = 0,
  ) => {
    quat.setFromEuler(new THREE.Euler(tiltX, rotY, 0));
    scale.setScalar(s);
    pos.set(x, y, z);
    matrix.compose(pos, quat, scale);
    geometry.applyMatrix4(matrix);
    bucket.push(geometry);
  };

  const addTree = (x: number, y: number, z: number, rotY: number, s: number, dead: boolean) => {
    const trunkH = dead ? 7.5 : 8.5;
    const trunkRadius = dead ? 0.42 : 0.55;
    const trunk = new THREE.CylinderGeometry(trunkRadius * 0.62, trunkRadius, trunkH, 9, 1);
    place(trunks, trunk, x, y + (trunkH * s) / 2, z, rotY, s);

    if (dead) {
      for (let b = 0; b < 4; b++) {
        const angle = rng.range(0, Math.PI * 2);
        const len = rng.range(1.6, 3.4);
        const branch = new THREE.CylinderGeometry(0.08, 0.24, len, 6);
        const g = new THREE.Matrix4().compose(
          new THREE.Vector3(
            x + Math.cos(angle) * len * 0.32 * s,
            y + (trunkH - 0.6) * s + b * 0.32 * s,
            z + Math.sin(angle) * len * 0.32 * s,
          ),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(-1.2, 1.2), angle, rng.range(0.5, 1.1))),
          new THREE.Vector3(s, s, s),
        );
        branch.applyMatrix4(g);
        trunks.push(branch);
      }
      return;
    }

    const crownY = y + trunkH * s * 0.86;
    const blobs = 5;
    for (let b = 0; b < blobs; b++) {
      const angle = (b / blobs) * Math.PI * 2 + rotY;
      const radius = b === 0 ? 2.9 : rng.range(1.8, 2.9);
      const bx = x + (b === 0 ? 0 : Math.cos(angle) * 2.3) * s;
      const bz = z + (b === 0 ? 0 : Math.sin(angle) * 2.3) * s;
      const by = crownY + (b === 0 ? 1.9 : rng.range(-0.5, 1.6)) * s;
      const geo = new THREE.IcosahedronGeometry(radius, 1);
      const shade = 0.78 + rng.range(0, 0.45);
      tinted(geo, canopyBase, 0);
      const colors = geo.getAttribute("color") as THREE.BufferAttribute;
      for (let i = 0; i < colors.count; i++) {
        colors.setXYZ(i, canopyBase.r * shade, canopyBase.g * shade, canopyBase.b * shade);
      }
      const nonUniform = new THREE.Matrix4().compose(
        new THREE.Vector3(bx, by, bz),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(0, 0.4), angle, rng.range(0, 0.4))),
        new THREE.Vector3(s * 1.15, s * 0.92, s * 1.15),
      );
      geo.applyMatrix4(nonUniform);
      canopies.push(geo);
    }
    const radius = Math.max(0.5, trunkRadius * 1.5 * s);
    colliders.push({
      minX: x - radius,
      maxX: x + radius,
      minZ: z - radius,
      maxZ: z + radius,
      bottom: y,
      top: y + trunkH * s,
      walkable: false,
    });
  };

  const addPalm = (x: number, y: number, z: number, rotY: number, s: number) => {
    const segments = 7;
    const lean = rng.range(0.6, 1.6);
    for (let i = 0; i < segments; i++) {
      const t = i / segments;
      const seg = new THREE.CylinderGeometry(0.26 - t * 0.1, 0.3 - t * 0.09, 1.1, 7);
      const g = new THREE.Matrix4().compose(
        new THREE.Vector3(x + Math.sin(t * lean) * 2.4 * s, y + t * 7.4 * s + 0.55 * s, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, -Math.sin(t * lean) * 0.22)),
        new THREE.Vector3(s, s, s),
      );
      seg.applyMatrix4(g);
      trunks.push(seg);
    }
    for (let f = 0; f < 7; f++) {
      const angle = (f / 7) * Math.PI * 2 + rotY;
      const frond = new THREE.ConeGeometry(0.9, 4.2, 4, 1, false);
      frond.scale(1, 1, 0.18);
      const g = new THREE.Matrix4().compose(
        new THREE.Vector3(
          x + Math.sin(lean) * 2.4 * s + Math.cos(angle) * 1.6 * s,
          y + 7.4 * s + 0.4 * s,
          z + Math.sin(angle) * 1.6 * s,
        ),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2 - 0.32, -angle, 0, "YXZ")),
        new THREE.Vector3(s, s, s),
      );
      frond.applyMatrix4(g);
      tinted(frond, canopyBase, rng.range(-0.15, 0.2));
      canopies.push(frond);
    }
  };

  const vegFilter = spec.edits.vegetationDensity ?? 1;
  const rockFilter = spec.edits.rockDensity ?? 1;
  const vegKinds = new Set(["tree", "dead-tree", "palm", "grass"]);
  const rockKinds = new Set(["rock", "boulder", "crystal", "rubble"]);

  for (const p of spec.props) {
    const s = p.scale;
    // Deterministic thinning so the editor's density controls are real, reversible
    // and identical across reloads of the same world.
    const bucket = (hashString(`${spec.seed}:${p.id}`) % 1000) / 1000;
    if (spec.edits.vegetationDensity !== undefined && vegKinds.has(p.kind) && bucket > vegFilter) continue;
    if (spec.edits.rockDensity !== undefined && rockKinds.has(p.kind) && bucket > rockFilter) continue;
    switch (p.kind) {
      case "tree":
        addTree(p.x, p.y, p.z, p.rotY, s, false);
        break;
      case "dead-tree":
        addTree(p.x, p.y, p.z, p.rotY, s, true);
        break;
      case "palm":
        addPalm(p.x, p.y, p.z, p.rotY, s);
        break;
      case "rock": {
        const geo = new THREE.IcosahedronGeometry(1, 0);
        const nonUniform = new THREE.Matrix4().compose(
          new THREE.Vector3(p.x, p.y + 0.35 * s, p.z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(0, 1), p.rotY, rng.range(0, 1))),
          new THREE.Vector3(s * rng.range(0.8, 1.4), s * rng.range(0.55, 1.0), s * rng.range(0.8, 1.4)),
        );
        geo.applyMatrix4(nonUniform);
        rocks.push(geo);
        if (s > 1.1) {
          colliders.push({
            minX: p.x - s * 0.9,
            maxX: p.x + s * 0.9,
            minZ: p.z - s * 0.9,
            maxZ: p.z + s * 0.9,
            bottom: p.y,
            top: p.y + s * 0.9,
            walkable: false,
          });
        }
        break;
      }
      case "boulder": {
        const geo = new THREE.DodecahedronGeometry(1, 0);
        const nonUniform = new THREE.Matrix4().compose(
          new THREE.Vector3(p.x, p.y + 0.6 * s, p.z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(0, 0.8), p.rotY, rng.range(0, 0.8))),
          new THREE.Vector3(s * rng.range(1.0, 1.6), s * rng.range(0.8, 1.3), s * rng.range(1.0, 1.6)),
        );
        geo.applyMatrix4(nonUniform);
        rocks.push(geo);
        if (s > 0.7) {
          colliders.push({
            minX: p.x - s * 1.1,
            maxX: p.x + s * 1.1,
            minZ: p.z - s * 1.1,
            maxZ: p.z + s * 1.1,
            bottom: p.y,
            top: p.y + s * 1.1,
            walkable: false,
          });
        }
        break;
      }
      case "crystal": {
        for (let c = 0; c < 4; c++) {
          const shard = new THREE.OctahedronGeometry(0.5, 0);
          const nonUniform = new THREE.Matrix4().compose(
            new THREE.Vector3(
              p.x + rng.range(-0.8, 0.8) * s,
              p.y + 0.4 * s,
              p.z + rng.range(-0.8, 0.8) * s,
            ),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(-0.2, 0.2), rng.range(0, 3), rng.range(-0.2, 0.2))),
            new THREE.Vector3(s * 0.5, s * rng.range(0.9, 2.2), s * 0.5),
          );
          shard.applyMatrix4(nonUniform);
          crystals.push(shard);
        }
        break;
      }
      case "grass": {
        for (let b = 0; b < 5; b++) {
          const blade = new THREE.ConeGeometry(0.075, rng.range(0.6, 1.3), 3);
          const g = new THREE.Matrix4().compose(
            new THREE.Vector3(p.x + rng.range(-0.7, 0.7) * s, p.y + 0.4 * s, p.z + rng.range(-0.7, 0.7) * s),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(-0.22, 0.22), rng.range(0, 3), rng.range(-0.22, 0.22))),
            new THREE.Vector3(s, s, s),
          );
          blade.applyMatrix4(g);
          tinted(blade, grassBase, rng.range(-0.2, 0.25));
          grass.push(blade);
        }
        break;
      }
      case "rubble": {
        for (let b = 0; b < 4; b++) {
          const chunk = new THREE.BoxGeometry(
            rng.range(0.3, 1.1) * s,
            rng.range(0.15, 0.5) * s,
            rng.range(0.3, 1.0) * s,
          );
          const g = new THREE.Matrix4().compose(
            new THREE.Vector3(p.x + rng.range(-1, 1) * s, p.y + 0.16 * s, p.z + rng.range(-1, 1) * s),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(0, 0.5), rng.range(0, 3), rng.range(0, 0.5))),
            new THREE.Vector3(1, 1, 1),
          );
          chunk.applyMatrix4(g);
          rubble.push(chunk);
        }
        break;
      }
      case "obelisk": {
        const body = new THREE.CylinderGeometry(0.55, 0.85, 7, 4);
        const g = new THREE.Matrix4().compose(
          new THREE.Vector3(p.x, p.y + 3.4 * s, p.z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(-0.22, 0.22), p.rotY + Math.PI / 4, rng.range(-0.22, 0.22))),
          new THREE.Vector3(s, s, s),
        );
        body.applyMatrix4(g);
        rocks.push(body);
        colliders.push({
          minX: p.x - s,
          maxX: p.x + s,
          minZ: p.z - s,
          maxZ: p.z + s,
          bottom: p.y,
          top: p.y + 3.4 * s,
          walkable: false,
        });
        break;
      }
      case "island": {
        const geo = new THREE.CylinderGeometry(4 * s, 0.6 * s, 5 * s, 9);
        place(rocks, geo, p.x, p.y - 2.2 * s, p.z, p.rotY, 1);
        break;
      }
    }
  }

  const pushMerged = (geoms: THREE.BufferGeometry[], material: THREE.Material, castShadow: boolean) => {
    if (!geoms.length) return;
    const normalized = geoms.map((g) => {
      if (!g.index) return g;
      const next = g.toNonIndexed();
      g.dispose();
      return next;
    });
    const merged = normalized.length === 1 ? normalized[0] : mergeGeometries(normalized, false);
    if (normalized.length > 1) for (const g of normalized) g.dispose();
    if (!merged) return;
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    group.add(mesh);
  };

  pushMerged(trunks, trunkMaterial, true);
  pushMerged(canopies, canopyMaterial, true);
  pushMerged(rocks, rockMaterial, true);
  pushMerged(rubble, rubbleMaterial, true);
  pushMerged(crystals, crystalMaterial, false);
  pushMerged(grass, grassMaterial, false);

  // Props that ended up in the sea are culled from the collider set.
  const dry = colliders.filter((c) => c.top > water - 0.6);

  return {
    group,
    colliders: dry,
    canopyMaterial,
    dispose() {
      group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) mesh.geometry.dispose();
      });
      trunkMaterial.dispose();
      canopyMaterial.dispose();
      rockMaterial.dispose();
      rubbleMaterial.dispose();
      crystalMaterial.dispose();
      grassMaterial.dispose();
    },
  };
}