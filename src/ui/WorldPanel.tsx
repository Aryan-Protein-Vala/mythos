import { useEffect, useRef, useState } from "react";
import { useMythos } from "../state/store";
import type { WorldSpec } from "../world/types";
import type { WorldRenderer } from "../engine/WorldRenderer";
import { Button, IconButton, Tag } from "./components";
import { Icon } from "./icons";
import { BIOME_LABEL } from "./format";

const KIND_LABEL: Record<string, string> = {
  artifact: "Artifact",
  secret: "Secret",
  landmark: "Landmark",
  clue: "Clue",
};

export type PanelTab = "world" | "discoveries";

export function WorldPanel({
  open,
  tab,
  onTab,
  onClose,
  spec,
  renderer,
  onExport,
  onBack,
}: {
  open: boolean;
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  onClose: () => void;
  spec: WorldSpec;
  renderer: WorldRenderer | null;
  onExport: () => void;
  onBack: () => void;
}) {
  const saveCurrent = useMythos((s) => s.saveCurrent);
  const saving = useMythos((s) => s.saving);
  const renameCurrent = useMythos((s) => s.renameCurrent);
  const resetExploration = useMythos((s) => s.resetExploration);
  const resetEvent = useMythos((s) => s.resetEvent);
  const importWorldText = useMythos((s) => s.importWorldText);
  const removeFromLibrary = useMythos((s) => s.removeFromLibrary);
  const library = useMythos((s) => s.library);
  const toast = useMythos((s) => s.toast);
  const navigate = useMythos((s) => s.navigate);

  const [name, setName] = useState(spec.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => setName(spec.name), [spec.name]);
  useEffect(() => setConfirmDelete(false), [spec.id]);

  const found = new Set(spec.exploration.discoveries);
  const isSaved = library.some((w) => w.id === spec.id);
  const progress = spec.discoveries.filter((d) => found.has(d.id)).length;

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      await importWorldText(await file.text());
    } catch (err) {
      toast("error", "Import failed", err instanceof Error ? err.message : "Could not read that file.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <aside className={`panel ${open ? "is-open" : ""}`} aria-hidden={!open} aria-label="World details">
      <header className="panel__head">
        <div className="panel__tabs" role="tablist" aria-label="World details">
          <button
            role="tab"
            aria-selected={tab === "world"}
            className={`panel__tab ${tab === "world" ? "is-active" : ""}`}
            onClick={() => onTab("world")}
          >
            World
          </button>
          <button
            role="tab"
            aria-selected={tab === "discoveries"}
            className={`panel__tab ${tab === "discoveries" ? "is-active" : ""}`}
            onClick={() => onTab("discoveries")}
          >
            Discoveries
            <span className="panel__tab-count">
              {progress}/{spec.discoveries.length}
            </span>
          </button>
        </div>
        <IconButton icon="close" label="Close panel" onClick={onClose} />
      </header>

      <div className="panel__scroll">
        {tab === "world" ? (
          <>
            <section className="panel__section">
              <p className="eyebrow">World name</p>
              <input
                className="panel__name-input"
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => renameCurrent(name)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                aria-label="World name"
              />
              <p className="panel__prompt">“{spec.prompt}”</p>
              <div className="panel__tags">
                <Tag tone="accent">{BIOME_LABEL[spec.biome] ?? spec.biome}</Tag>
                <Tag>{spec.generation.method === "ai" ? "Model-assisted" : "Procedural"}</Tag>
                <Tag tone={spec.exploration.eventStates[spec.events[0]?.id] === "resolved" ? "warning" : "neutral"}>
                  {spec.water.enabled ? "Water" : "Dry"}
                </Tag>
              </div>
            </section>

            <section className="panel__section">
              <h3 className="panel__heading">Specification</h3>
              <dl className="meta-grid">
                <div>
                  <dt>Seed</dt>
                  <dd className="mono">{spec.seed}</dd>
                </div>
                <div>
                  <dt>Schema</dt>
                  <dd className="mono">v{spec.schemaVersion}</dd>
                </div>
                <div>
                  <dt>Structures</dt>
                  <dd>{spec.structures.length}</dd>
                </div>
                <div>
                  <dt>Objects</dt>
                  <dd>{spec.props.length}</dd>
                </div>
                <div>
                  <dt>Sky</dt>
                  <dd>{spec.atmosphere.sky.kind}</dd>
                </div>
                <div>
                  <dt>Time</dt>
                  <dd>{spec.timeOfDay}</dd>
                </div>
              </dl>
              <details className="panel__details">
                <summary>Detection notes</summary>
                <ul className="notes">
                  {(spec.generation.notes.length ? spec.generation.notes : ["No keyword notes for this world."]).map(
                    (note) => (
                      <li key={note}>{note}</li>
                    ),
                  )}
                </ul>
              </details>
            </section>

            <section className="panel__section">
              <h3 className="panel__heading">Events</h3>
              {spec.events.map((event) => {
                const state = spec.exploration.eventStates[event.id] ?? "idle";
                return (
                  <div className="event-row" key={event.id}>
                    <div>
                      <p className="event-row__title">{event.title}</p>
                      <p className="event-row__state">
                        {state === "resolved" ? "Resolved in this world" : "Not yet triggered"}
                      </p>
                    </div>
                    {state === "resolved" ? (
                      <Button
                        compact
                        variant="ghost"
                        icon="rotate"
                        onClick={() => {
                          resetEvent(event.id);
                          if (spec.events[0]?.id === event.id) renderer?.resetEvent();
                          toast("info", "Event reset", "The chamber is sealed again. Return to it to repeat the sequence.");
                        }}
                      >
                        Reset
                      </Button>
                    ) : null}
                  </div>
                );
              })}
            </section>

            <section className="panel__section">
              <h3 className="panel__heading">Exchange</h3>
              <div className="panel__buttons">
                <Button icon="download" onClick={onExport}>
                  Export JSON
                </Button>
                <Button icon="upload" onClick={() => fileRef.current?.click()}>
                  Import JSON
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/json,.json"
                  className="visually-hidden"
                  onChange={(e) => importFile(e.target.files?.[0])}
                />
              </div>
              <p className="panel__note">
                The export contains the complete world specification, seed, edits and discovered state — it can
                be imported on another machine.
              </p>
            </section>

            <section className="panel__section">
              <h3 className="panel__heading">Maintenance</h3>
              <div className="panel__buttons">
                <Button icon="save" loading={saving} onClick={() => void saveCurrent()}>
                  Save world
                </Button>
                <Button
                  variant="ghost"
                  icon="rotate"
                  onClick={() => {
                    resetExploration();
                    renderer?.resetEvent();
                    toast("info", "World reset", "Discoveries cleared. The event can be triggered again.");
                  }}
                >
                  Reset discoveries
                </Button>
              </div>
              {isSaved ? (
                confirmDelete ? (
                  <div className="panel__confirm">
                    <p>Delete “{spec.name}” from this browser?</p>
                    <div className="panel__confirm-actions">
                      <Button variant="ghost" compact onClick={() => setConfirmDelete(false)}>
                        Keep it
                      </Button>
                      <Button
                        variant="danger"
                        compact
                        icon="trash"
                        onClick={async () => {
                          await removeFromLibrary(spec.id);
                          navigate("library");
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button className="danger-link" onClick={() => setConfirmDelete(true)}>
                    <Icon name="trash" size={14} /> Delete this saved world
                  </button>
                )
              ) : (
                <p className="panel__note">Not saved yet. Use Save world to keep it in the archive.</p>
              )}
            </section>
          </>
        ) : (
          <>
            <section className="panel__section">
              <div className="progress-head">
                <p className="eyebrow">Field journal</p>
                <span className="progress-head__count">
                  {progress} of {spec.discoveries.length}
                </span>
              </div>
              <div className="progress-bar" aria-hidden="true">
                <span style={{ width: `${(progress / Math.max(1, spec.discoveries.length)) * 100}%` }} />
              </div>
              <p className="panel__note">
                Only discoveries you actually trigger are recorded. Undiscovered entries stay sealed.
              </p>
            </section>

            <section className="panel__section">
              <div className="discoveries">
                {spec.discoveries.map((discovery) => {
                  const isFound = found.has(discovery.id);
                  return (
                    <article className={`discovery ${isFound ? "is-found" : "is-sealed"}`} key={discovery.id}>
                      <div className="discovery__head">
                        <span className="discovery__kind">{KIND_LABEL[discovery.kind] ?? discovery.kind}</span>
                        {isFound ? (
                          <span className="discovery__mark" aria-label="Discovered">
                            <Icon name="check" size={13} />
                          </span>
                        ) : (
                          <span className="discovery__mark discovery__mark--sealed" aria-label="Undiscovered">
                            <Icon name="eye" size={13} />
                          </span>
                        )}
                      </div>
                      <h3 className="discovery__title">{isFound ? discovery.title : "Undiscovered"}</h3>
                      <p className="discovery__text">
                        {isFound ? discovery.text : "Find this place in the world to record it."}
                      </p>
                    </article>
                  );
                })}
              </div>
            </section>

            <section className="panel__section">
              <h3 className="panel__heading">Reset</h3>
              <Button
                variant="ghost"
                icon="rotate"
                onClick={() => {
                  resetExploration();
                  renderer?.resetEvent();
                  toast("info", "Journal cleared", "All discoveries have been removed from this world.");
                }}
              >
                Clear the journal
              </Button>
            </section>
          </>
        )}
      </div>

      <footer className="panel__foot">
        <Button variant="ghost" icon="arrow-left" onClick={onBack}>
          Atelier
        </Button>
        <span className="panel__foot-note">Esc closes panels · E interacts</span>
      </footer>
    </aside>
  );
}