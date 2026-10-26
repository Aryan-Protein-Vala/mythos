import { useEffect, useMemo, useRef, useState } from "react";
import { useMythos } from "../state/store";
import type { WorldSpec, WorldSummary } from "../world/types";
import { allPresetSpecs } from "../world/sampleWorlds";
import { loadWorld } from "../storage/db";
import { downloadText, serializeWorld, worldFileName } from "../storage/transfer";
import { Button, IconButton, Modal, TextInput } from "./components";
import { WorldThumb } from "./Thumbnail";
import { Wordmark } from "./Wordmark";
import { Icon } from "./icons";
import { BIOME_LABEL, formatWhen } from "./format";

export function Library({ onOpenSettings }: { onOpenSettings: () => void }) {
  const library = useMythos((s) => s.library);
  const loading = useMythos((s) => s.libraryLoading);
  const error = useMythos((s) => s.libraryError);
  const refresh = useMythos((s) => s.refreshLibrary);
  const navigate = useMythos((s) => s.navigate);
  const openFromLibrary = useMythos((s) => s.openFromLibrary);
  const openWorld = useMythos((s) => s.openWorld);
  const remove = useMythos((s) => s.removeFromLibrary);
  const rename = useMythos((s) => s.renameInLibrary);
  const duplicate = useMythos((s) => s.duplicateInLibrary);
  const importWorldText = useMythos((s) => s.importWorldText);
  const toast = useMythos((s) => s.toast);

  const [query, setQuery] = useState("");
  const [specs, setSpecs] = useState<Record<string, WorldSpec>>({});
  const [renaming, setRenaming] = useState<WorldSummary | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleting, setDeleting] = useState<WorldSummary | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const samples = useMemo(() => allPresetSpecs(), []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        library.map(async (summary) => {
          if (specs[summary.id]) return [summary.id, specs[summary.id]] as const;
          try {
            const spec = await loadWorld(summary.id);
            return [summary.id, spec] as const;
          } catch {
            return null;
          }
        }),
      );
      if (cancelled) return;
      const next: Record<string, WorldSpec> = { ...specs };
      for (const entry of entries) if (entry) next[entry[0]] = entry[1];
      setSpecs(next);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library]);

  const filtered = library.filter((world) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      world.name.toLowerCase().includes(q) ||
      world.description.toLowerCase().includes(q) ||
      world.biome.includes(q)
    );
  });

  const exportWorld = async (world: WorldSummary) => {
    try {
      const spec = specs[world.id] ?? (await loadWorld(world.id));
      downloadText(worldFileName(spec), serializeWorld(spec));
      toast("success", "World exported", worldFileName(spec));
    } catch (err) {
      toast("error", "Export failed", err instanceof Error ? err.message : "Could not read that world.");
    }
  };

  const handleImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      await importWorldText(text);
    } catch (err) {
      toast("error", "Import failed", err instanceof Error ? err.message : "Could not read that file.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="library view-enter">
      <header className="atelier__nav">
        <button className="wordmark-link" onClick={() => navigate("atelier")} aria-label="Back to the Atelier">
          <Wordmark />
        </button>
        <nav className="atelier__links" aria-label="Primary">
          <button className="nav-link" onClick={() => navigate("atelier")}>
            Create
          </button>
          <button className="nav-link is-active" aria-current="page">
            Worlds
          </button>
          <button className="nav-link" onClick={onOpenSettings}>
            Settings
          </button>
        </nav>
      </header>

      <main className="library__main">
        <header className="library__head">
          <div>
            <p className="eyebrow">The archive</p>
            <h1 className="display library__title">Worlds</h1>
            <p className="library__lede">
              Everything you have saved in this browser. Worlds are local, portable JSON — export one to
              keep it, import it anywhere MYTHOS runs.
            </p>
          </div>
          <div className="library__tools">
            <div className="search">
              <Icon name="search" size={15} />
              <input
                className="search__input"
                placeholder="Search worlds"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search saved worlds"
              />
              {query ? (
                <button className="search__clear" onClick={() => setQuery("")} aria-label="Clear search">
                  <Icon name="close" size={13} />
                </button>
              ) : null}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="visually-hidden"
              onChange={(e) => handleImport(e.target.files?.[0])}
            />
            <Button icon="upload" onClick={() => fileRef.current?.click()}>
              Import
            </Button>
            <Button variant="primary" icon="plus" onClick={() => navigate("atelier")}>
              New world
            </Button>
          </div>
        </header>

        {error ? (
          <div className="banner banner--error" role="alert">
            <Icon name="info" size={16} />
            <span>{error}</span>
            <Button variant="ghost" compact onClick={() => refresh()}>
              Retry
            </Button>
          </div>
        ) : null}

        {loading && library.length === 0 ? (
          <div className="library__loading">
            <span className="spinner" aria-hidden="true" />
            <span>Reading local archive…</span>
          </div>
        ) : library.length === 0 ? (
          <section className="empty">
            <div className="empty__frame">
              <span className="empty__mark" aria-hidden="true" />
              <h2 className="empty__title">The archive is empty</h2>
              <p className="empty__text">
                Describe a place in the Atelier and save it. It will be stored here, in this browser, with its
                seed, discoveries and edits intact.
              </p>
              <Button variant="primary" iconRight="arrow-right" onClick={() => navigate("atelier")}>
                Create the first world
              </Button>
            </div>
          </section>
        ) : filtered.length === 0 ? (
          <div className="library__nomatch">
            <p>No saved worlds match “{query}”.</p>
            <Button variant="ghost" onClick={() => setQuery("")}>
              Clear search
            </Button>
          </div>
        ) : (
          <div className="world-grid">
            {filtered.map((world) => {
              const spec = specs[world.id];
              return (
                <article className="world-card" key={world.id}>
                  <button className="world-card__media" onClick={() => openFromLibrary(world.id)} aria-label={`Open ${world.name}`}>
                    {spec ? (
                      <WorldThumb spec={spec} />
                    ) : (
                      <div className={`thumb recent__swatch--${world.biome}`} aria-hidden="true">
                        <div className="thumb__pending">
                          <span className="thumb__pending-line" />
                        </div>
                      </div>
                    )}
                    <span className="world-card__open">
                      <Icon name="play" size={13} /> Open
                    </span>
                  </button>
                  <div className="world-card__body">
                    <div className="world-card__title-row">
                      <h2 className="world-card__name">{world.name}</h2>
                      <span className="world-card__biome">{BIOME_LABEL[world.biome] ?? world.biome}</span>
                    </div>
                    <p className="world-card__desc">{world.description}</p>
                    <div className="world-card__meta">
                      <span>{formatWhen(world.updatedAt)}</span>
                      <span className="dot" aria-hidden="true" />
                      <span>
                        {world.discoveryCount}/{world.totalDiscoveries} discoveries
                      </span>
                      <span className="dot" aria-hidden="true" />
                      <span className="mono world-card__seed">{world.seed}</span>
                    </div>
                    <div className="world-card__actions">
                      <Button variant="secondary" compact onClick={() => openFromLibrary(world.id)}>
                        Open
                      </Button>
                      <div className="world-card__icons">
                        <IconButton
                          icon="pencil"
                          label={`Rename ${world.name}`}
                          onClick={() => {
                            setRenaming(world);
                            setRenameValue(world.name);
                          }}
                        />
                        <IconButton icon="copy" label={`Duplicate ${world.name}`} onClick={() => duplicate(world.id)} />
                        <IconButton icon="download" label={`Export ${world.name}`} onClick={() => exportWorld(world)} />
                        <IconButton icon="trash" label={`Delete ${world.name}`} onClick={() => setDeleting(world)} />
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <section className="builtin">
          <div className="builtin__head">
            <h2 className="builtin__title">Built-in places</h2>
            <span className="builtin__note">Shipped with MYTHOS · not saved to your archive</span>
          </div>
          <div className="builtin__grid">
            {samples.map(({ preset, spec }) => (
              <button key={preset.id} className="builtin__card" onClick={() => openWorld(structuredClone(spec))}>
                <span className="builtin__media">
                  <WorldThumb spec={spec} />
                </span>
                <span className="builtin__text">
                  <span className="builtin__name">{preset.name}</span>
                  <span className="builtin__tagline">{preset.tagline}</span>
                </span>
                <Icon name="arrow-right" size={15} />
              </button>
            ))}
          </div>
        </section>
      </main>

      <footer className="atelier__footer library__footer">
        <span>MYTHOS · local archive</span>
        <span className="atelier__footer-mid">
          {library.length} saved {library.length === 1 ? "world" : "worlds"} · IndexedDB
        </span>
        <span>Schema v3</span>
      </footer>

      <Modal
        open={Boolean(renaming)}
        onClose={() => setRenaming(null)}
        title="Rename world"
        subtitle="The name is stored with the world and appears wherever it is referenced."
        width={420}
        footer={
          <div className="modal__footer-row">
            <Button variant="ghost" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={async () => {
                if (!renaming) return;
                const value = renameValue.trim();
                if (!value) return;
                await rename(renaming.id, value);
                setRenaming(null);
              }}
            >
              Save name
            </Button>
          </div>
        }
      >
        <TextInput
          label="World name"
          value={renameValue}
          maxLength={80}
          autoFocus
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && renaming && renameValue.trim()) {
              void rename(renaming.id, renameValue.trim()).then(() => setRenaming(null));
            }
          }}
        />
      </Modal>

      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Delete this world?"
        width={420}
        footer={
          <div className="modal__footer-row">
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              icon="trash"
              onClick={async () => {
                if (!deleting) return;
                await remove(deleting.id);
                setDeleting(null);
              }}
            >
              Delete permanently
            </Button>
          </div>
        }
      >
        <p className="modal__prose">
          <strong>{deleting?.name}</strong> and its discovered state will be removed from this browser.
          Export it first if you want to keep a copy.
        </p>
      </Modal>
    </div>
  );
}