import { create } from "zustand";
import type { CreationPreferences, WorldEdits, WorldSpec, WorldSummary } from "../world/types";
import { buildWorld, duplicateWorld, remixWorld } from "../world/builder";
import { parseExportedWorld, WorldValidationError } from "../world/schema";
import { fetchArchitectStatus, generateBlueprint, requestRevision } from "../ai/client";
import { applyBlueprintNarrative, blueprintToInterpretation } from "../world/architect/blueprint";
import { applyRevision } from "../world/architect/revision";
import type { ArchitectFailureReason } from "../world/architect/protocol";
import {
  DEFAULT_PREFERENCES,
  deleteWorld as deleteRecord,
  listWorlds,
  loadPreferences,
  loadWorld,
  renameWorld as renameRecord,
  savePreferences,
  saveWorld as saveRecord,
  type Preferences,
} from "../storage/db";
import { downloadText, serializeWorld, worldFileName } from "../storage/transfer";

export type View = "atelier" | "world" | "library";

export interface Toast {
  id: number;
  tone: "info" | "success" | "error" | "warning";
  title: string;
  message?: string;
}

export interface DiscoveryMoment {
  id: string;
  title: string;
  text: string;
  kind: string;
  at: number;
}

interface MythosState {
  view: View;
  current: WorldSpec | null;
  dirty: boolean;
  saving: boolean;
  savedAt: number | null;
  library: WorldSummary[];
  libraryLoading: boolean;
  libraryError: string | null;
  prefs: Preferences;
  toasts: Toast[];
  discoveryMoment: DiscoveryMoment | null;
  lastGeneration: { prompt: string; prefs: CreationPreferences; presetId?: string } | null;

  /** AI World Architect availability, probed from the server route. */
  aiStatus: "unknown" | "available" | "unavailable";
  aiModel: string | null;
  revising: boolean;
  /** Snapshot enabling a single-level undo of the latest AI revision. */
  lastRevision: { before: WorldSpec; reply: string } | null;

  navigate: (view: View) => void;
  createWorld: (prompt: string, prefs: CreationPreferences, presetId?: string) => WorldSpec;
  checkAiStatus: () => Promise<void>;
  /**
   * AI-assisted creation. On any architect failure this falls back to the
   * procedural engine and says so via `note` — `method` is always truthful.
   */
  createWorldAi: (
    prompt: string,
    prefs: CreationPreferences,
    onStage?: (stage: 0 | 1 | 2) => void,
  ) => Promise<{ spec: WorldSpec; method: "ai" | "procedural"; note?: string; model?: string }>;
  reviseCurrent: (instruction: string) => Promise<boolean>;
  undoRevision: () => void;
  openWorld: (spec: WorldSpec, persist?: boolean) => void;
  updateEdits: (edits: WorldEdits) => void;
  clearEdits: () => void;
  renameCurrent: (name: string) => void;
  setExplorationState: (state: { position: { x: number; y: number; z: number }; yaw: number; pitch: number }) => void;
  remixCurrent: () => WorldSpec | null;
  saveCurrent: () => Promise<boolean>;
  recordDiscovery: (discoveryId: string) => void;
  triggerEvent: (eventId: string) => void;
  resetEvent: (eventId: string) => void;
  resetExploration: () => void;
  clearDiscoveryMoment: () => void;
  refreshLibrary: () => Promise<void>;
  openFromLibrary: (id: string) => Promise<boolean>;
  removeFromLibrary: (id: string) => Promise<void>;
  renameInLibrary: (id: string, name: string) => Promise<void>;
  duplicateInLibrary: (id: string) => Promise<void>;
  importWorldText: (text: string) => Promise<boolean>;
  exportCurrent: () => void;
  setPrefs: (partial: Partial<Preferences>) => void;
  toast: (tone: Toast["tone"], title: string, message?: string) => void;
  dismissToast: (id: number) => void;
}

let toastId = 1;
let thumbnailTimer: number | undefined;

function errorMessage(err: unknown): string {
  if (err instanceof WorldValidationError) return err.issues.join(" ");
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}

/** Human-safe phrasing for architect failures; never carries upstream text. */
function fallbackNote(reason: ArchitectFailureReason): string {
  switch (reason) {
    case "unavailable":
      return "The AI Architect is not configured on this server";
    case "rate_limited":
      return "The AI Architect is rate-limited right now";
    case "timeout":
      return "The AI Architect took too long to answer";
    case "empty":
      return "The AI Architect returned an empty plan";
    case "invalid":
      return "The AI Architect's plan failed validation";
    default:
      return "The AI Architect could not be reached";
  }
}

export const useMythos = create<MythosState>()((set, get) => ({
  view: "atelier",
  current: null,
  dirty: false,
  saving: false,
  savedAt: null,
  library: [],
  libraryLoading: false,
  libraryError: null,
  prefs: loadPreferences(),
  toasts: [],
  discoveryMoment: null,
  lastGeneration: null,
  aiStatus: "unknown",
  aiModel: null,
  revising: false,
  lastRevision: null,

  navigate(view) {
    set({ view });
  },

  createWorld(prompt, prefs, presetId) {
    const spec = buildWorld({ prompt, prefs, presetId });
    set({ lastGeneration: { prompt, prefs, presetId } });
    return spec;
  },

  async checkAiStatus() {
    const status = await fetchArchitectStatus();
    set({ aiStatus: status.available ? "available" : "unavailable", aiModel: status.model });
  },

  async createWorldAi(prompt, prefs, onStage) {
    onStage?.(0);
    const result = await generateBlueprint(prompt);
    if (!result.ok) {
      const spec = buildWorld({ prompt, prefs: { ...prefs, method: "procedural" } });
      set({ lastGeneration: { prompt, prefs } });
      return { spec, method: "procedural" as const, note: fallbackNote(result.reason) };
    }
    onStage?.(1);
    const built = buildWorld({
      prompt,
      prefs: { ...prefs, method: "ai" },
      interpretation: blueprintToInterpretation(result.blueprint),
      name: result.blueprint.name,
      description: result.blueprint.summary,
    });
    onStage?.(2);
    const spec = applyBlueprintNarrative(built, result.blueprint);
    set({ lastGeneration: { prompt, prefs } });
    return { spec, method: "ai" as const, model: result.model };
  },

  async reviseCurrent(instruction) {
    const current = get().current;
    const trimmed = instruction.trim();
    if (!current || !trimmed || get().revising) return false;
    set({ revising: true });
    try {
      const result = await requestRevision(trimmed, current);
      if (!result.ok) {
        set({ revising: false });
        get().toast("error", "Revision failed", `${fallbackNote(result.reason)}. The world is unchanged.`);
        return false;
      }
      const next = applyRevision(current, result.revision);
      set({
        current: next,
        dirty: true,
        revising: false,
        lastRevision: { before: current, reply: result.revision.reply },
      });
      const unsupported = result.revision.unsupported;
      get().toast(
        unsupported.length ? "warning" : "success",
        "World revised",
        unsupported.length ? `${result.revision.reply} Not possible: ${unsupported.join("; ")}.` : result.revision.reply,
      );
      return true;
    } catch (err) {
      set({ revising: false });
      get().toast("error", "Revision failed", `${errorMessage(err)} The world is unchanged.`);
      return false;
    }
  },

  undoRevision() {
    const last = get().lastRevision;
    const current = get().current;
    if (!last || !current) return;
    // Restore the pre-revision spec but keep anything the visitor has done since.
    set({ current: { ...last.before, exploration: current.exploration }, dirty: true, lastRevision: null });
    get().toast("info", "Revision undone", "The world is back to its previous state.");
  },

  openWorld(spec, persist = false) {
    set({
      current: structuredClone(spec),
      dirty: !persist,
      savedAt: persist ? spec.updatedAt : null,
      view: "world",
      discoveryMoment: null,
    });
  },

  updateEdits(edits) {
    const current = get().current;
    if (!current) return;
    const next: WorldSpec = {
      ...current,
      edits: { ...current.edits, ...edits },
      updatedAt: Date.now(),
    };
    set({ current: next, dirty: true });
  },

  clearEdits() {
    const current = get().current;
    if (!current) return;
    set({ current: { ...current, edits: {} }, dirty: true });
  },

  setExplorationState(state) {
    const current = get().current;
    if (!current) return;
    set({
      current: {
        ...current,
        exploration: { ...current.exploration, ...state },
      },
    });
  },

  renameCurrent(name) {
    const current = get().current;
    if (!current) return;
    const trimmed = name.trim().slice(0, 80);
    if (!trimmed || trimmed === current.name) return;
    set({ current: { ...current, name: trimmed, updatedAt: Date.now() }, dirty: true });
  },

  remixCurrent() {
    const current = get().current;
    if (!current) return null;
    try {
      const remixed = remixWorld(current);
      set({ current: remixed, dirty: true, savedAt: null, view: "world", discoveryMoment: null });
      get().toast("info", "Remixed", "A new seed, new placement, same idea.");
      return remixed;
    } catch (err) {
      get().toast("error", "Could not remix this world", errorMessage(err));
      return null;
    }
  },

  async saveCurrent() {
    const current = get().current;
    if (!current) return false;
    set({ saving: true });
    try {
      const saved = await saveRecord(current);
      set({ current: saved, dirty: false, saving: false, savedAt: saved.updatedAt });
      get().toast("success", "World saved", "Stored in this browser. You can reopen it from Worlds.");
      void get().refreshLibrary();

      // A thumbnail is a nicety, not part of the save contract. Generate it in
      // the background and write it back without touching save confirmation.
      window.clearTimeout(thumbnailTimer);
      thumbnailTimer = window.setTimeout(async () => {
        try {
          const { renderWorldThumbnail } = await import("../engine/WorldRenderer");
          const thumb = renderWorldThumbnail(current, 640, 420);
          await saveRecord({ ...current, updatedAt: saved.updatedAt }, thumb);
        } catch {
          /* thumbnail generation is best-effort */
        }
      }, 900);
      return true;
    } catch (err) {
      set({ saving: false });
      get().toast("error", "Save failed", errorMessage(err));
      return false;
    }
  },

  recordDiscovery(discoveryId) {
    const current = get().current;
    if (!current) return;
    if (current.exploration.discoveries.includes(discoveryId)) return;
    const discovery = current.discoveries.find((d) => d.id === discoveryId);
    const next: WorldSpec = {
      ...current,
      exploration: {
        ...current.exploration,
        discoveries: [...current.exploration.discoveries, discoveryId],
      },
      updatedAt: Date.now(),
    };
    set({
      current: next,
      dirty: true,
      discoveryMoment: discovery
        ? { id: discovery.id, title: discovery.title, text: discovery.text, kind: discovery.kind, at: Date.now() }
        : null,
    });
  },

  triggerEvent(eventId) {
    const current = get().current;
    if (!current) return;
    const event = current.events.find((e) => e.id === eventId);
    if (!event) return;
    const discoveries = current.exploration.discoveries.includes(event.discoveryId)
      ? current.exploration.discoveries
      : [...current.exploration.discoveries, event.discoveryId];
    const next: WorldSpec = {
      ...current,
      exploration: {
        ...current.exploration,
        discoveries,
        eventStates: { ...current.exploration.eventStates, [eventId]: "resolved" },
      },
      updatedAt: Date.now(),
    };
    set({ current: next, dirty: true });
  },

  resetEvent(eventId) {
    const current = get().current;
    if (!current) return;
    const event = current.events.find((e) => e.id === eventId);
    const next: WorldSpec = {
      ...current,
      exploration: {
        ...current.exploration,
        discoveries: event
          ? current.exploration.discoveries.filter((id) => id !== event.discoveryId)
          : current.exploration.discoveries,
        eventStates: { ...current.exploration.eventStates, [eventId]: "idle" },
      },
      updatedAt: Date.now(),
    };
    set({ current: next, dirty: true });
  },

  resetExploration() {
    const current = get().current;
    if (!current) return;
    const next: WorldSpec = {
      ...current,
      exploration: {
        ...current.exploration,
        discoveries: [],
        eventStates: Object.fromEntries(current.events.map((e) => [e.id, "idle" as const])),
      },
      updatedAt: Date.now(),
    };
    set({ current: next, dirty: true, discoveryMoment: null });
  },

  clearDiscoveryMoment() {
    set({ discoveryMoment: null });
  },

  async refreshLibrary() {
    set({ libraryLoading: true, libraryError: null });
    try {
      const library = await listWorlds();
      set({ library, libraryLoading: false });
    } catch (err) {
      set({ libraryLoading: false, libraryError: errorMessage(err) });
    }
  },

  async openFromLibrary(id) {
    try {
      const spec = await loadWorld(id);
      set({ current: spec, dirty: false, savedAt: spec.updatedAt, view: "world", discoveryMoment: null });
      return true;
    } catch (err) {
      get().toast("error", "Could not open world", errorMessage(err));
      return false;
    }
  },

  async removeFromLibrary(id) {
    try {
      await deleteRecord(id);
      const current = get().current;
      if (current?.id === id) set({ current: null, dirty: false });
      await get().refreshLibrary();
      get().toast("success", "World deleted", "It has been removed from this browser.");
    } catch (err) {
      get().toast("error", "Could not delete world", errorMessage(err));
    }
  },

  async renameInLibrary(id, name) {
    try {
      const updated = await renameRecord(id, name);
      const current = get().current;
      if (current?.id === id) set({ current: { ...current, name: updated.name } });
      await get().refreshLibrary();
    } catch (err) {
      get().toast("error", "Could not rename world", errorMessage(err));
    }
  },

  async duplicateInLibrary(id) {
    try {
      const source = await loadWorld(id);
      const copy = duplicateWorld(source);
      await saveRecord(copy);
      await get().refreshLibrary();
      get().toast("success", "World duplicated", `Saved as “${copy.name}”.`);
    } catch (err) {
      get().toast("error", "Could not duplicate world", errorMessage(err));
    }
  },

  async importWorldText(text) {
    try {
      const { spec, warnings } = parseExportedWorld(text);
      const existing = get().library.find((w) => w.id === spec.id);
      const prepared: WorldSpec = existing
        ? { ...spec, id: `w_import_${Date.now().toString(36)}`, name: `${spec.name} (Imported)` }
        : spec;
      const saved = await saveRecord(prepared);
      await get().refreshLibrary();
      set({ current: saved, dirty: false, savedAt: saved.updatedAt, view: "world" });
      get().toast(
        warnings.length ? "warning" : "success",
        "World imported",
        warnings[0] ?? `“${saved.name}” is ready to explore.`,
      );
      return true;
    } catch (err) {
      get().toast("error", "Import failed", errorMessage(err));
      return false;
    }
  },

  exportCurrent() {
    const current = get().current;
    if (!current) return;
    try {
      downloadText(worldFileName(current), serializeWorld(current));
      get().toast("success", "World exported", worldFileName(current));
    } catch (err) {
      get().toast("error", "Export failed", errorMessage(err));
    }
  },

  setPrefs(partial) {
    const prefs = { ...get().prefs, ...partial };
    savePreferences(prefs);
    set({ prefs });
  },

  toast(tone, title, message) {
    const id = toastId++;
    set({ toasts: [...get().toasts.slice(-3), { id, tone, title, message }] });
    window.setTimeout(() => get().dismissToast(id), tone === "error" ? 8000 : 5200);
  },

  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));

if (import.meta.env.DEV) {
  (window as unknown as { __mythosStore?: unknown }).__mythosStore = useMythos;
}

export { DEFAULT_PREFERENCES };