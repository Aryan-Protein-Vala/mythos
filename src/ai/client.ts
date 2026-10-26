/**
 * Browser client for the AI World Architect.
 *
 * Talks only to our own /api/architect route. There is no credential in this
 * file, none in browser storage, and failure results carry only the server's
 * sanitised reason codes.
 */

import { revisionContext } from "../world/architect/revision";
import type {
  ArchitectFailure,
  ArchitectGenerateResult,
  ArchitectReviseResult,
  ArchitectStatus,
} from "../world/architect/protocol";
import type { WorldSpec } from "../world/types";

async function post<T>(body: unknown): Promise<T> {
  const res = await fetch("/api/architect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

function unreachable(): ArchitectFailure {
  return { ok: false, reason: "provider_error", detail: "The architect route could not be reached." };
}

export async function fetchArchitectStatus(): Promise<ArchitectStatus> {
  try {
    const res = await fetch("/api/architect", { method: "GET", cache: "no-store" });
    if (!res.ok) return { available: false, model: null };
    return (await res.json()) as ArchitectStatus;
  } catch {
    return { available: false, model: null };
  }
}

export async function generateBlueprint(prompt: string): Promise<ArchitectGenerateResult> {
  try {
    return await post<ArchitectGenerateResult>({ mode: "generate", prompt });
  } catch {
    return unreachable();
  }
}

export async function requestRevision(instruction: string, spec: WorldSpec): Promise<ArchitectReviseResult> {
  try {
    return await post<ArchitectReviseResult>({ mode: "revise", prompt: instruction, spec: revisionContext(spec) });
  } catch {
    return unreachable();
  }
}
