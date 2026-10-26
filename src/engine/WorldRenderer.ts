import * as THREE from "three";
import type { EventSpec, InteractionSpec, WorldSpec } from "../world/types";
import { resolveWorld } from "../world/resolve";
import { assembleWorld, type BuiltWorld } from "./worldScene";
import { PlayerController, type ControllerState } from "./controls";

export interface RendererCallbacks {
  onNearby?(interaction: InteractionSpec | null): void;
  onLockChange?(locked: boolean): void;
  onPointerLockUnsupported?(): void;
  onFps?(fps: number): void;
  onContextLost?(): void;
  onPlayerChange?(state: ControllerState): void;
}

function structuralKey(spec: WorldSpec): string {
  return JSON.stringify({
    seed: spec.seed,
    terrain: spec.terrain,
    water: [spec.water.enabled, spec.water.level],
    structures: spec.structures.map((s) => [s.kind, s.x, s.y, s.z, s.rotY, s.scale, s.id]),
    props: spec.props.length,
    vegetation: spec.vegetation,
    stone: [spec.stone, spec.stoneColor],
    geology: spec.geology,
    particles: [spec.atmosphere.particles.kind, spec.atmosphere.particles.density],
    edits: [
      spec.edits.vegetationDensity ?? null,
      spec.edits.rockDensity ?? null,
      spec.edits.landmarkVisible ?? null,
      spec.edits.landmarkScale ?? null,
      spec.edits.landmarkRotation ?? null,
    ],
  });
}

export class WorldRenderer {
  private renderer: THREE.WebGLRenderer;
  private camera: THREE.PerspectiveCamera;
  private built: BuiltWorld;
  private controller: PlayerController;
  private spec: WorldSpec;
  private geomKey: string;
  private lastFrame = performance.now();
  private elapsed = 0;
  private raf = 0;
  private disposed = false;
  private nearby: InteractionSpec | null = null;
  private detectTimer = 0;
  private frames = 0;
  private fpsTimer = 0;
  private resizeObserver: ResizeObserver;
  private onLost: (e: Event) => void;

  constructor(
    private canvas: HTMLCanvasElement,
    spec: WorldSpec,
    private callbacks: RendererCallbacks = {},
  ) {
    this.spec = resolveWorld(spec);
    this.geomKey = structuralKey(this.spec);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
      alpha: false,
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.camera = new THREE.PerspectiveCamera(this.spec.camera.fov, 1, 0.1, 1800);
    this.built = assembleWorld(this.spec);
    this.built.setDiscovered(this.spec.exploration.discoveries);
    this.controller = new PlayerController(this.camera, canvas, this.spec, this.built.sampler, this.built.colliders, {
      onLockChange: (locked) => this.callbacks.onLockChange?.(locked),
      onCapability: (supported) => {
        if (!supported) this.callbacks.onPointerLockUnsupported?.();
      },
      onMove: (state) => this.callbacks.onPlayerChange?.(state),
    });

    // Restore the saved vantage point when a world is reopened.
    const saved = this.spec.exploration;
    if (saved && Number.isFinite(saved.position?.x)) {
      this.controller.teleport({
        x: saved.position.x,
        y: saved.position.y,
        z: saved.position.z,
        yaw: saved.yaw,
        pitch: saved.pitch,
      });
    }

    this.resize();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);

    this.onLost = (e: Event) => {
      e.preventDefault();
      this.callbacks.onContextLost?.();
    };
    canvas.addEventListener("webglcontextlost", this.onLost);

    this.loop();
  }

  private resize(): void {
    const parent = this.canvas.parentElement;
    const width = parent?.clientWidth || this.canvas.clientWidth || window.innerWidth;
    const height = parent?.clientHeight || this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min((now - this.lastFrame) / 1000, 0.08);
    this.lastFrame = now;
    this.elapsed += dt;

    this.controller.update(dt);

    this.detectTimer += dt;
    if (this.detectTimer > 0.1) {
      this.detectTimer = 0;
      this.detectNearby();
    }

    this.built.update(dt, this.elapsed, this.camera);
    this.renderer.render(this.built.scene, this.camera);

    this.frames++;
    this.fpsTimer += dt;
    if (this.fpsTimer >= 1) {
      this.callbacks.onFps?.(Math.round(this.frames / this.fpsTimer));
      this.frames = 0;
      this.fpsTimer = 0;
    }
  };

  private detectNearby(): void {
    if (!this.spec.interactions.length) {
      if (this.nearby) {
        this.nearby = null;
        this.callbacks.onNearby?.(null);
      }
      return;
    }
    const state = this.controller.state;
    const eye = new THREE.Vector3(state.x, state.y, state.z);
    const cosPitch = Math.cos(state.pitch);
    const forward = new THREE.Vector3(
      -Math.sin(state.yaw) * cosPitch,
      Math.sin(state.pitch),
      -Math.cos(state.yaw) * cosPitch,
    );

    let best: InteractionSpec | null = null;
    let bestScore = -Infinity;
    const temp = new THREE.Vector3();
    for (const interaction of this.spec.interactions) {
      temp.set(interaction.position.x, interaction.position.y, interaction.position.z);
      const distance = temp.distanceTo(eye);
      if (distance > interaction.radius + 2.4) continue;
      const toObject = temp.clone().sub(eye).normalize();
      const facing = toObject.dot(forward);
      if (facing < 0.15 && distance > interaction.radius * 0.55) continue;
      const score = facing * 2 - distance * 0.05;
      if (score > bestScore) {
        bestScore = score;
        best = interaction;
      }
    }

    if (best?.id !== this.nearby?.id) {
      this.nearby = best;
      this.callbacks.onNearby?.(best);
    }
  }

  getNearby(): InteractionSpec | null {
    return this.nearby;
  }

  setSpec(next: WorldSpec): void {
    const resolved = resolveWorld(next);
    const nextKey = structuralKey(resolved);
    const previousState = this.controller.state;
    const sameWorld = resolved.id === this.spec.id;
    this.spec = resolved;

    if (nextKey !== this.geomKey) {
      this.geomKey = nextKey;
      this.built.dispose();
      this.built = assembleWorld(resolved);
      this.built.setDiscovered(resolved.exploration.discoveries);
      this.built.setAtmosphere(resolved);
      this.controller.setWorld(resolved, this.built.sampler, this.built.colliders);
      if (sameWorld) {
        const ground = this.built.sampler.heightAt(previousState.x, previousState.z);
        this.controller.teleport({
          ...previousState,
          y: Math.max(previousState.y, ground + resolved.camera.eyeHeight),
        });
      }
      this.nearby = null;
      this.callbacks.onNearby?.(null);
    } else {
      this.built.setAtmosphere(resolved);
    }
  }

  setDiscovered(ids: string[]): void {
    this.built.setDiscovered(ids);
  }

  playEvent(event: EventSpec): void {
    this.built.playEvent(event.kind, event.duration);
  }

  resolveEvent(event: EventSpec): void {
    this.built.resolveEvent(event.kind);
  }

  resetEvent(): void {
    this.built.resetEvent();
  }

  focusInteraction(id: string): void {
    const interaction = this.spec.interactions.find((i) => i.id === id);
    if (interaction) this.controller.framePoint(interaction.position);
  }

  requestLock(): void {
    this.controller.requestLock();
  }

  exitLock(): void {
    this.controller.exitLock();
  }

  setReducedMotion(value: boolean): void {
    this.controller.reducedMotion = value;
  }

  setInputEnabled(enabled: boolean): void {
    this.controller.setInputEnabled(enabled);
  }

  getState(): ControllerState {
    return this.controller.state;
  }

  /** Dev/QA helper: move the player to a specific vantage point. */
  teleport(x: number, y: number, z: number, yaw?: number, pitch?: number): void {
    this.controller.teleport({
      x,
      y,
      z,
      yaw: yaw ?? this.controller.state.yaw,
      pitch: pitch ?? 0,
    });
  }

  get isLocked(): boolean {
    return this.controller.isPointerLocked;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener("webglcontextlost", this.onLost);
    this.controller.dispose();
    this.built.dispose();
    this.renderer.dispose();
  }
}

export function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(
      window.WebGLRenderingContext &&
        (canvas.getContext("webgl2") || canvas.getContext("webgl")),
    );
  } catch {
    return false;
  }
}

/**
 * Renders a one-shot establishing shot of a world with the real scene builder.
 * Used for preset tiles and library cards — never stock imagery.
 */
export function renderWorldThumbnail(spec: WorldSpec, width = 640, height = 420): string {
  const resolved = resolveWorld(spec);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: true,
    powerPreference: "default",
  });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.03;

  const built = assembleWorld(resolved, { preview: true, static: true });
  const camera = new THREE.PerspectiveCamera(resolved.camera.fov, width / height, 0.1, 1800);
  const spawn = resolved.camera.spawn;
  const look = resolved.camera.lookAt;
  const toLandmark = new THREE.Vector3(look.x - spawn.x, 0, look.z - spawn.z);
  const distance = toLandmark.length();
  const dir = toLandmark.normalize();
  const ground = built.sampler.heightAt(spawn.x, spawn.z);
  // Establishing shot: step back from the spawn point and rise just enough to
  // clear the foreground, keeping the horizon and the landmark in frame.
  const back = distance * 0.08;
  const lift = Math.min(12, distance * 0.07);
  const px = spawn.x - dir.x * back;
  const pz = spawn.z - dir.z * back;
  camera.position.set(px, Math.max(spawn.y + lift, ground + lift), pz);
  camera.lookAt(new THREE.Vector3(look.x, Math.max(look.y + 1.5, 5), look.z));
  built.update(0.016, 0.6, camera);
  renderer.render(built.scene, camera);
  const url = canvas.toDataURL("image/jpeg", 0.82);

  built.dispose();
  renderer.dispose();
  renderer.forceContextLoss();
  return url;
}