import type { WorldSpec, WorldSummary } from "../world/types";
import { parseWorld } from "../world/schema";

const DB_NAME = "mythos";
const DB_VERSION = 1;
const STORE = "worlds";

export interface WorldRecord {
  id: string;
  spec: WorldSpec;
  updatedAt: number;
  thumbnail?: string;
}

export class PersistenceError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "PersistenceError";
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new PersistenceError("This browser does not expose IndexedDB, so worlds cannot be saved."));
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(new PersistenceError("IndexedDB is unavailable in this context.", err));
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new PersistenceError("Could not open local storage for worlds.", request.error));
    request.onblocked = () =>
      reject(new PersistenceError("Local storage is blocked by another tab. Close it and try again."));
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      let result: T;
      const request = fn(store);
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = () => reject(new PersistenceError("The local database rejected the request.", request.error));
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(new PersistenceError("The save transaction failed.", tx.error));
      tx.onabort = () => reject(new PersistenceError("The save transaction was aborted.", tx.error));
    });
  } finally {
    db.close();
  }
}

export async function saveWorld(spec: WorldSpec, thumbnail?: string): Promise<WorldSpec> {
  const updated: WorldSpec = { ...spec, updatedAt: Date.now() };
  const record: WorldRecord = { id: updated.id, spec: updated, updatedAt: updated.updatedAt, thumbnail };
  await withStore("readwrite", (store) => store.put(record) as IDBRequest<IDBValidKey>);
  return updated;
}

export async function loadWorld(id: string): Promise<WorldSpec> {
  const record = await withStore<WorldRecord | undefined>("readonly", (store) => store.get(id));
  if (!record) throw new PersistenceError("That world no longer exists in this browser.");
  try {
    const spec = parseWorld(record.spec);
    return { ...spec, updatedAt: record.updatedAt };
  } catch (err) {
    throw new PersistenceError("This saved world is corrupt and could not be read.", err);
  }
}

export async function loadRecord(id: string): Promise<WorldRecord | undefined> {
  return withStore<WorldRecord | undefined>("readonly", (store) => store.get(id));
}

export async function deleteWorld(id: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(id) as unknown as IDBRequest<undefined>);
}

export async function listWorlds(): Promise<WorldSummary[]> {
  const records = await withStore<WorldRecord[]>("readonly", (store) => store.getAll());
  return records
    .filter((r) => r && r.spec)
    .map((r) => ({
      id: r.spec.id,
      name: r.spec.name,
      description: r.spec.description,
      biome: r.spec.biome,
      seed: r.spec.seed,
      updatedAt: r.updatedAt ?? r.spec.updatedAt,
      createdAt: r.spec.createdAt,
      discoveryCount: r.spec.exploration?.discoveries?.length ?? 0,
      totalDiscoveries: r.spec.discoveries?.length ?? 0,
      presetId: r.spec.generation?.presetId,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function renameWorld(id: string, name: string): Promise<WorldSpec> {
  const spec = await loadWorld(id);
  const next = { ...spec, name: name.trim().slice(0, 80) || spec.name, updatedAt: Date.now() };
  return saveWorld(next);
}

/* ------------------------------------------------------------------ */
/*  Small preferences (localStorage)                                   */
/* ------------------------------------------------------------------ */

export interface Preferences {
  soundEnabled: boolean;
  volume: number;
  reducedMotion: boolean;
  mouseSensitivity: number;
}

const PREF_KEY = "mythos:preferences";

export const DEFAULT_PREFERENCES: Preferences = {
  soundEnabled: false,
  volume: 0.45,
  reducedMotion: false,
  mouseSensitivity: 1,
};

export function loadPreferences(): Preferences {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (!raw) return { ...DEFAULT_PREFERENCES };
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return { ...DEFAULT_PREFERENCES, ...parsed };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function savePreferences(prefs: Preferences): void {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
  } catch {
    /* preferences are best-effort */
  }
}

export { openDb, DB_NAME, STORE };