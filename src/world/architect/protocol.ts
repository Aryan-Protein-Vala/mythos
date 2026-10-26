/**
 * Wire protocol between the browser and the /api/architect server route.
 * Pure types — shared by the server core, the Vercel function, the dev
 * middleware, the browser client and the tests.
 */

import type { WorldBlueprint } from "./blueprint";
import type { RevisionContext, WorldRevision } from "./revision";

export interface ArchitectGenerateRequest {
  mode: "generate";
  prompt: string;
}

export interface ArchitectReviseRequest {
  mode: "revise";
  prompt: string;
  spec: RevisionContext;
}

export type ArchitectRequest = ArchitectGenerateRequest | ArchitectReviseRequest;

/**
 * Failure taxonomy. `unavailable` means the server has no credentials — the
 * client must keep procedural generation fully usable in that case. No
 * reason ever carries upstream payloads, so keys can never leak through them.
 */
export type ArchitectFailureReason = "unavailable" | "rate_limited" | "provider_error" | "timeout" | "empty" | "invalid";

export interface ArchitectFailure {
  ok: false;
  reason: ArchitectFailureReason;
  /** Short, human-safe detail authored by us — never upstream text. */
  detail?: string;
}

export interface ArchitectGenerateSuccess {
  ok: true;
  blueprint: WorldBlueprint;
  model: string;
}

export interface ArchitectReviseSuccess {
  ok: true;
  revision: WorldRevision;
  model: string;
}

export type ArchitectGenerateResult = ArchitectGenerateSuccess | ArchitectFailure;
export type ArchitectReviseResult = ArchitectReviseSuccess | ArchitectFailure;

export interface ArchitectStatus {
  available: boolean;
  model: string | null;
}
