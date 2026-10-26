import * as THREE from "three";
import type { WorldSpec } from "../world/types";
import type { Collider } from "./architecture";
import type { TerrainSampler } from "../world/terrain";
import { clamp } from "../world/noise";

export interface ControllerState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface ControllerCallbacks {
  onLockChange?(locked: boolean): void;
  onCapability?(supported: boolean): void;
  onMove?(state: ControllerState): void;
}

const PLAYER_RADIUS = 0.42;
const STEP_HEIGHT = 0.62;
const GRAVITY = 23;

export class PlayerController {
  private keys = new Set<string>();
  private yawValue = 0;
  private pitchValue = 0;
  private position = new THREE.Vector3();
  private velocityY = 0;
  private grounded = true;
  private lastSafe = new THREE.Vector3();
  private safeTimer = 0;
  private bobPhase = 0;
  private locking = false;
  private dragging = false;
  private lastPointer = { x: 0, y: 0 };
  private disposed = false;

  private spec: WorldSpec;
  private sampler: TerrainSampler;
  private colliders: Collider[];

  lockedPointer = false;
  reducedMotion = false;
  private inputEnabled = true;

  constructor(
    private camera: THREE.PerspectiveCamera,
    private dom: HTMLCanvasElement,
    spec: WorldSpec,
    sampler: TerrainSampler,
    colliders: Collider[],
    private callbacks: ControllerCallbacks = {},
  ) {
    this.spec = spec;
    this.sampler = sampler;
    this.colliders = colliders;
    this.position.set(spec.camera.spawn.x, spec.camera.spawn.y - spec.camera.eyeHeight, spec.camera.spawn.z);
    this.yawValue = spec.exploration.yaw;
    this.pitchValue = 0;
    this.lastSafe.copy(this.position);
    this.bind();
    this.applyCamera();
  }

  get isPointerLocked(): boolean {
    return this.lockedPointer;
  }

  get state(): ControllerState {
    return {
      x: this.position.x,
      y: this.position.y + this.spec.camera.eyeHeight,
      z: this.position.z,
      yaw: this.yawValue,
      pitch: this.pitchValue,
    };
  }

  setWorld(spec: WorldSpec, sampler: TerrainSampler, colliders: Collider[]): void {
    this.spec = spec;
    this.sampler = sampler;
    this.colliders = colliders;
    this.position.set(spec.camera.spawn.x, spec.camera.spawn.y - spec.camera.eyeHeight, spec.camera.spawn.z);
    this.yawValue = spec.exploration.yaw;
    this.pitchValue = 0;
    this.lastSafe.copy(this.position);
    this.applyCamera();
  }

  teleport(state: ControllerState): void {
    this.position.set(state.x, state.y - this.spec.camera.eyeHeight, state.z);
    this.yawValue = state.yaw;
    this.pitchValue = state.pitch;
    this.lastSafe.copy(this.position);
    this.applyCamera();
  }

  /** Focus near an interaction point without entering pointer lock. */
  framePoint(target: { x: number; y: number; z: number }): void {
    const angle = Math.atan2(target.x - this.position.x, target.z - this.position.z);
    this.yawValue = angle;
    const flat = Math.hypot(target.x - this.position.x, target.z - this.position.z);
    this.pitchValue = clamp(Math.atan2(target.y - this.state.y, Math.max(flat, 0.01)), -0.5, 0.5);
    this.applyCamera();
  }

  private bind(): void {
    this.dom.addEventListener("click", this.onCanvasClick);
    document.addEventListener("pointerlockchange", this.onPointerLockChange);
    document.addEventListener("pointerlockerror", this.onPointerLockError);
    document.addEventListener("mousemove", this.onMouseMove);
    this.dom.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    const supported = typeof this.dom.requestPointerLock === "function";
    this.callbacks.onCapability?.(supported);
  }

  requestLock = (): void => {
    if (this.locking || this.lockedPointer) return;
    this.locking = true;
    try {
      const result = this.dom.requestPointerLock() as unknown as Promise<void> | undefined;
      if (result && typeof result.catch === "function") {
        result.catch(() => {
          this.locking = false;
          this.callbacks.onCapability?.(false);
        });
      }
    } catch {
      this.locking = false;
      this.callbacks.onCapability?.(false);
    }
  };

  exitLock = (): void => {
    if (document.pointerLockElement === this.dom) document.exitPointerLock();
  };

  private onCanvasClick = (): void => {
    if (this.callbacks && !this.lockedPointer) this.requestLock();
  };

  private onPointerLockChange = (): void => {
    this.lockedPointer = document.pointerLockElement === this.dom;
    this.locking = false;
    this.callbacks.onLockChange?.(this.lockedPointer);
  };

  private onPointerLockError = (): void => {
    this.locking = false;
    this.callbacks.onCapability?.(false);
    this.callbacks.onLockChange?.(false);
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (this.lockedPointer) return;
    if (e.button !== 0) return;
    this.dragging = true;
    this.lastPointer = { x: e.clientX, y: e.clientY };
  };

  private onMouseUp = (): void => {
    this.dragging = false;
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (this.lockedPointer) {
      const sensitivity = 0.0022;
      this.yawValue -= e.movementX * sensitivity;
      this.pitchValue = clamp(this.pitchValue - e.movementY * sensitivity, -1.4, 1.4);
      this.applyCamera();
      return;
    }
    if (!this.dragging) return;
    const dx = e.clientX - this.lastPointer.x;
    const dy = e.clientY - this.lastPointer.y;
    this.lastPointer = { x: e.clientX, y: e.clientY };
    this.yawValue -= dx * 0.0032;
    this.pitchValue = clamp(this.pitchValue - dy * 0.0032, -1.4, 1.4);
    this.applyCamera();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
    this.keys.add(e.code);
    if (e.code === "Space" && this.grounded && this.lockedPointer) {
      this.velocityY = 6.2;
      this.grounded = false;
      e.preventDefault();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onBlur = (): void => {
    this.keys.clear();
    this.dragging = false;
  };

  private isBlocked(x: number, z: number, feet: number): boolean {
    const r = PLAYER_RADIUS;
    for (const c of this.colliders) {
      if (x + r < c.minX || x - r > c.maxX || z + r < c.minZ || z - r > c.maxZ) continue;
      if (c.top <= feet + STEP_HEIGHT) continue;
      if (c.bottom >= feet + 1.75) continue;
      if (c.walkable) {
        if (feet + STEP_HEIGHT >= c.top) continue;
        return true;
      }
      return true;
    }
    return false;
  }

  private supportAt(x: number, z: number, feet: number): { height: number; onPlatform: boolean } {
    let height = this.sampler.heightAt(x, z);
    let onPlatform = false;
    const r = PLAYER_RADIUS * 0.9;
    for (const c of this.colliders) {
      if (!c.walkable) continue;
      if (x + r < c.minX || x - r > c.maxX || z + r < c.minZ || z - r > c.maxZ) continue;
      if (c.top > feet + STEP_HEIGHT) continue;
      if (c.top > height) {
        height = c.top;
        onPlatform = true;
      }
    }
    return { height, onPlatform };
  }

  private applyCamera(): void {
    const bob = this.reducedMotion ? 0 : Math.sin(this.bobPhase) * 0.028;
    this.camera.position.set(
      this.position.x,
      this.position.y + this.spec.camera.eyeHeight + bob,
      this.position.z,
    );
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.y = this.yawValue;
    this.camera.rotation.x = this.pitchValue;
    this.camera.rotation.z = 0;
  }

  setInputEnabled(enabled: boolean): void {
    this.inputEnabled = enabled;
    if (!enabled) this.keys.clear();
  }

  update(dt: number): void {
    if (this.disposed) return;
    const capped = Math.min(dt, 0.06);
    let forward = 0;
    let strafe = 0;
    if (this.inputEnabled && this.keys.has("KeyW") || this.keys.has("ArrowUp")) forward += 1;
    if (this.inputEnabled && (this.keys.has("KeyS") || this.keys.has("ArrowDown"))) forward -= 1;
    if (this.inputEnabled && (this.keys.has("KeyD") || this.keys.has("ArrowRight"))) strafe += 1;
    if (this.inputEnabled && (this.keys.has("KeyA") || this.keys.has("ArrowLeft"))) strafe -= 1;

    const moving = forward !== 0 || strafe !== 0;
    const sprint = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
    const slow = this.keys.has("AltLeft") || this.keys.has("AltRight");
    const speed = this.spec.camera.speed * (sprint ? 1.8 : slow ? 0.42 : 1);

    if (moving) {
      const len = Math.hypot(forward, strafe) || 1;
      const sin = Math.sin(this.yawValue);
      const cos = Math.cos(this.yawValue);
      const dx = ((-sin * forward) / len + (cos * strafe) / len) * speed * capped;
      const dz = ((-cos * forward) / len + (-sin * strafe) / len) * speed * capped;

      const feet = this.position.y;
      const waterLimit = this.spec.water.enabled ? this.spec.water.level + 0.12 : -Infinity;

      const attempt = (nx: number, nz: number) => {
        if (this.isBlocked(nx, nz, feet)) return false;
        const support = this.supportAt(nx, nz, feet).height;
        if (!this.grounded && this.velocityY > 0.2) return true;
        if (support <= waterLimit && support < feet - 0.4) return false;
        return true;
      };

      const nx = this.position.x + dx;
      const nz = this.position.z + dz;
      let moved = false;
      if (attempt(nx, nz)) {
        this.position.x = nx;
        this.position.z = nz;
        moved = true;
      } else if (attempt(nx, this.position.z)) {
        this.position.x = nx;
        moved = true;
      } else if (attempt(this.position.x, nz)) {
        this.position.z = nz;
        moved = true;
      }

      if (moved) {
        this.bobPhase += capped * speed * (sprint ? 2.2 : 1.6);
      }
      // Push back inside the world boundary.
      const half = this.spec.terrain.size * 0.48;
      this.position.x = clamp(this.position.x, -half, half);
      this.position.z = clamp(this.position.z, -half, half);
    }

    const support = this.supportAt(this.position.x, this.position.z, this.position.y);
    const waterLimit = this.spec.water.enabled ? this.spec.water.level + 0.12 : -Infinity;

    if (this.grounded) {
      if (support.height <= waterLimit && !support.onPlatform) {
        this.position.copy(this.lastSafe);
        this.velocityY = 0;
      } else if (support.height >= this.position.y - 0.65) {
        this.position.y = support.height;
        this.velocityY = 0;
      } else {
        this.grounded = false;
      }
    }

    if (!this.grounded) {
      this.velocityY -= GRAVITY * capped;
      this.position.y += this.velocityY * capped;
      if (this.position.y <= support.height) {
        this.position.y = support.height;
        this.velocityY = 0;
        this.grounded = true;
        if (support.height <= waterLimit && !support.onPlatform) {
          this.position.copy(this.lastSafe);
        }
      }
      if (this.position.y < -60) {
        this.position.copy(this.lastSafe);
        this.velocityY = 0;
        this.grounded = true;
      }
    }

    // Record a safe recovery point only while standing on solid, dry ground.
    this.safeTimer += capped;
    if (this.safeTimer > 0.5) {
      this.safeTimer = 0;
      if (support.height > waterLimit && support.height > this.sampler.heightAt(this.position.x, this.position.z) - 6) {
        this.lastSafe.set(this.position.x, support.height, this.position.z);
      }
    }

    this.applyCamera();
    this.callbacks.onMove?.(this.state);
  }

  dispose(): void {
    this.disposed = true;
    this.dom.removeEventListener("click", this.onCanvasClick);
    document.removeEventListener("pointerlockchange", this.onPointerLockChange);
    document.removeEventListener("pointerlockerror", this.onPointerLockError);
    document.removeEventListener("mousemove", this.onMouseMove);
    this.dom.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    if (document.pointerLockElement === this.dom) document.exitPointerLock();
  }
}