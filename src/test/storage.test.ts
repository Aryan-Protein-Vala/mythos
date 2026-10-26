import { beforeEach, describe, expect, it } from "vitest";
import { getPresetSpec } from "../world/sampleWorlds";
import { deleteWorld, listWorlds, loadWorld, openDb, saveWorld, STORE } from "../storage/db";

beforeEach(async () => {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
});

describe("indexeddb persistence", () => {
  it("saves and loads a world", async () => {
    const spec = { ...getPresetSpec("obsidian-palace"), id: "w_test_save" };
    const saved = await saveWorld(spec);
    expect(saved.id).toBe("w_test_save");
    const loaded = await loadWorld("w_test_save");
    expect(loaded.name).toBe(spec.name);
    expect(loaded.seed).toBe(spec.seed);
    expect(loaded.structures.length).toBe(spec.structures.length);
  });

  it("lists saved worlds newest first", async () => {
    await saveWorld({ ...getPresetSpec("forgotten-grove"), id: "w_a", name: "A" });
    await new Promise((r) => setTimeout(r, 5));
    await saveWorld({ ...getPresetSpec("last-frontier"), id: "w_b", name: "B" });
    const list = await listWorlds();
    expect(list.map((w) => w.id)).toEqual(["w_b", "w_a"]);
    expect(list[0].name).toBe("B");
  });

  it("summarises discoveries", async () => {
    const spec = structuredClone(getPresetSpec("forgotten-grove"));
    spec.id = "w_found";
    spec.exploration.discoveries = spec.discoveries.slice(0, 2).map((d) => d.id);
    await saveWorld(spec);
    const list = await listWorlds();
    const entry = list.find((w) => w.id === "w_found");
    expect(entry?.discoveryCount).toBe(2);
    expect(entry?.totalDiscoveries).toBe(spec.discoveries.length);
  });

  it("deletes a world", async () => {
    await saveWorld({ ...getPresetSpec("last-frontier"), id: "w_gone" });
    await deleteWorld("w_gone");
    await expect(loadWorld("w_gone")).rejects.toThrow();
    expect((await listWorlds()).find((w) => w.id === "w_gone")).toBeUndefined();
  });

  it("overwrites an existing record on re-save", async () => {
    const spec = { ...getPresetSpec("last-frontier"), id: "w_same" };
    await saveWorld(spec);
    await saveWorld({ ...spec, name: "Renamed" });
    expect((await listWorlds()).filter((w) => w.id === "w_same").length).toBe(1);
    expect((await loadWorld("w_same")).name).toBe("Renamed");
  });
});
