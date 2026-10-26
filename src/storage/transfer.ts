import type { WorldSpec } from "../world/types";
import { parseExportedWorld } from "../world/schema";

export interface ExportEnvelope {
  format: "mythos.world";
  formatVersion: 1;
  exportedAt: number;
  generator: string;
  spec: WorldSpec;
}

export function serializeWorld(spec: WorldSpec): string {
  const envelope: ExportEnvelope = {
    format: "mythos.world",
    formatVersion: 1,
    exportedAt: Date.now(),
    generator: "MYTHOS procedural engine",
    spec,
  };
  return JSON.stringify(envelope, null, 2);
}

export function worldFileName(spec: WorldSpec): string {
  const slug = spec.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `${slug || "mythos-world"}-${spec.seed}.mythos.json`;
}

export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function readJsonFile(file: File): Promise<{ spec: WorldSpec; warnings: string[] }> {
  if (file.size > 6 * 1024 * 1024) {
    throw new Error("That file is too large to be a MYTHOS world (limit 6 MB).");
  }
  if (!/\.json$/i.test(file.name) && file.type !== "application/json") {
    throw new Error("Please choose a .json world file exported from MYTHOS.");
  }
  const text = await file.text();
  return parseExportedWorld(text);
}