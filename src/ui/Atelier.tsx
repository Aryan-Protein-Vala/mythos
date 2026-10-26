import { useMemo, useState } from "react";
import { useMythos } from "../state/store";
import { allPresetSpecs } from "../world/sampleWorlds";
import { remixWorld } from "../world/builder";
import { SAMPLE_PROMPTS } from "../world/presets";
import type { CreationPreferences, WorldSpec } from "../world/types";
import { Button, IconButton, Segmented, Tag } from "./components";
import { WorldThumb } from "./Thumbnail";
import { Wordmark } from "./Wordmark";
import { Icon } from "./icons";
import { formatWhen } from "./format";

const SCALE_OPTIONS: Array<{ value: CreationPreferences["scale"]; label: string }> = [
  { value: "intimate", label: "Intimate" },
  { value: "grand", label: "Grand" },
  { value: "vast", label: "Vast" },
];

const ATMOSPHERE_OPTIONS: Array<{ value: CreationPreferences["atmosphere"]; label: string }> = [
  { value: "inherit", label: "Follow the description" },
  { value: "clear", label: "Clear" },
  { value: "haze", label: "Haze" },
  { value: "night", label: "Night" },
  { value: "eclipse", label: "Eclipse" },
];

export function Atelier({ onOpenSettings }: { onOpenSettings: () => void }) {
  const createWorld = useMythos((s) => s.createWorld);
  const openWorld = useMythos((s) => s.openWorld);
  const navigate = useMythos((s) => s.navigate);
  const library = useMythos((s) => s.library);
  const toast = useMythos((s) => s.toast);

  const [prompt, setPrompt] = useState("");
  const [scale, setScale] = useState<CreationPreferences["scale"]>("grand");
  const [atmosphere, setAtmosphere] = useState<CreationPreferences["atmosphere"]>("inherit");
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const samples = useMemo(() => allPresetSpecs(), []);
  const recent = library.slice(0, 4);

  const submit = () => {
    const trimmed = prompt.trim();
    if (trimmed.length < 8) {
      setError("Write at least a sentence — a place, a structure, a quality of light.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const spec = createWorld(trimmed, { scale, atmosphere, method: "procedural" });
      openWorld(spec);
    } catch (err) {
      setSubmitting(false);
      setError(err instanceof Error ? err.message : "The world could not be generated.");
    }
  };

  const enter = (spec: WorldSpec) => {
    openWorld(structuredClone(spec));
  };

  const remix = (spec: WorldSpec) => {
    const remixed = remixWorld(spec);
    openWorld(remixed);
    toast("info", "Remixed", "Same idea, a different placement and seed.");
  };

  return (
    <div className="atelier view-enter">
      <header className="atelier__nav">
        <Wordmark />
        <nav className="atelier__links" aria-label="Primary">
          <button className="nav-link is-active" aria-current="page">
            Create
          </button>
          <button className="nav-link" onClick={() => navigate("library")}>
            Worlds
            {library.length > 0 ? <span className="nav-link__count">{library.length}</span> : null}
          </button>
          <button className="nav-link" onClick={onOpenSettings}>
            Settings
          </button>
        </nav>
      </header>

      <main className="atelier__main">
        <section className="atelier__create">
          <p className="eyebrow">Interactive world generation</p>
          <h1 className="display atelier__headline">
            Imagine a place
            <br />
            that doesn’t exist.
          </h1>
          <p className="atelier__lede">
            Describe a place in plain language. MYTHOS reads the description into a validated world
            specification, then builds it as somewhere you can walk.
          </p>

          <div className={`brief ${error ? "has-error" : ""}`}>
            <div className="brief__head">
              <label htmlFor="brief" className="brief__label">
                The brief
              </label>
              <span className="brief__meta">{prompt.trim().length} / 1200</span>
            </div>
            <textarea
              id="brief"
              className="brief__input"
              rows={5}
              maxLength={1200}
              value={prompt}
              placeholder="An abandoned palace above a black ocean, beneath a dying sun. Broken arches emerge from the mist. A sealed chamber waits beneath the central courtyard…"
              onChange={(e) => {
                setPrompt(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
              }}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "brief-error" : undefined}
            />
            <div className="brief__foot">
              <div className="brief__examples">
                <span className="brief__examples-label">Try</span>
                {[
                  { label: "Hidden temple", prompt: SAMPLE_PROMPTS[4] },
                  { label: "Cathedral of clouds", prompt: SAMPLE_PROMPTS[1] },
                  { label: "Field of statues", prompt: SAMPLE_PROMPTS[0] },
                ].map((example) => (
                  <button
                    key={example.label}
                    className="example-chip"
                    onClick={() => {
                      setPrompt(example.prompt);
                      setError(null);
                    }}
                    title={example.prompt}
                  >
                    {example.label}
                  </button>
                ))}
              </div>
              <span className="brief__hint">
                <kbd className="kbd">⌘</kbd>
                <kbd className="kbd">↵</kbd> to create
              </span>
            </div>
            {error ? (
              <p className="brief__error" id="brief-error" role="alert">
                {error}
              </p>
            ) : null}
          </div>

          <div className="atelier__controls">
            <div className="control">
              <span className="control__label">World scale</span>
              <Segmented options={SCALE_OPTIONS} value={scale} onChange={setScale} ariaLabel="World scale" size="sm" />
            </div>
            <div className="control">
              <span className="control__label">Atmosphere</span>
              <div className="control__select">
                <select
                  className="select select--sm"
                  value={atmosphere}
                  onChange={(e) => setAtmosphere(e.target.value as CreationPreferences["atmosphere"])}
                  aria-label="Atmosphere"
                >
                  {ATMOSPHERE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <Icon name="chevron-down" size={13} />
              </div>
            </div>
            <button className={`link-toggle ${advanced ? "is-open" : ""}`} onClick={() => setAdvanced(!advanced)}>
              <Icon name="chevron-right" size={14} />
              Creative controls
            </button>
          </div>

          {advanced ? (
            <div className="advanced">
              <div className="advanced__row">
                <span className="advanced__label">Generation method</span>
                <Tag tone="accent">Procedural engine</Tag>
                <span className="advanced__note">
                  Deterministic and local. Model-assisted generation is not configured in this build, so
                  these worlds never call an external service.
                </span>
              </div>
              <div className="advanced__row">
                <span className="advanced__label">Reproducibility</span>
                <span className="advanced__note">
                  Every world carries a seed. The same seed and specification rebuild the same geometry.
                </span>
              </div>
            </div>
          ) : null}

          <div className="atelier__actions">
            <Button variant="primary" iconRight="arrow-right" onClick={submit} loading={submitting} disabled={submitting}>
              Create world
            </Button>
            <span className="atelier__assurance">
              <Icon name="globe" size={14} /> Runs entirely on this device · no API key
            </span>
          </div>

          {recent.length > 0 ? (
            <div className="recent">
              <div className="recent__head">
                <h2 className="recent__title">Recent</h2>
                <button className="link-btn" onClick={() => navigate("library")}>
                  All worlds <Icon name="arrow-right" size={13} />
                </button>
              </div>
              <div className="recent__list">
                {recent.map((world) => (
                  <button
                    key={world.id}
                    className="recent__item"
                    onClick={() => useMythos.getState().openFromLibrary(world.id)}
                  >
                    <span className={`recent__swatch recent__swatch--${world.biome}`} aria-hidden="true" />
                    <span className="recent__text">
                      <span className="recent__name">{world.name}</span>
                      <span className="recent__meta">
                        {world.biome} · {formatWhen(world.updatedAt)}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        <aside className="atelier__samples" aria-label="Built-in worlds">
          <div className="samples__head">
            <h2 className="samples__title">Begin from a known place</h2>
            <span className="samples__count">03 built-in</span>
          </div>
          {samples.map(({ preset, spec }) => (
            <article className="sample" key={preset.id}>
              <button className="sample__media" onClick={() => enter(spec)} aria-label={`Enter ${preset.name}`}>
                <WorldThumb spec={spec} eager={preset.id === "obsidian-palace"} />
                <span className="sample__setting">{preset.setting}</span>
              </button>
              <div className="sample__body">
                <div className="sample__text">
                  <h3 className="sample__name">{preset.name}</h3>
                  <p className="sample__tagline">{preset.tagline}</p>
                </div>
                <div className="sample__actions">
                  <Button variant="secondary" compact iconRight="arrow-right" onClick={() => enter(spec)}>
                    Enter
                  </Button>
                  <IconButton icon="rotate" label={`Remix ${preset.name}`} onClick={() => remix(spec)} />
                </div>
              </div>
            </article>
          ))}
        </aside>
      </main>

      <footer className="atelier__footer">
        <span>MYTHOS · v0.1</span>
        <span className="atelier__footer-mid">
          Procedural engine · seeded · schema v3
        </span>
        <span>{library.length} saved {library.length === 1 ? "world" : "worlds"}</span>
      </footer>
    </div>
  );
}

