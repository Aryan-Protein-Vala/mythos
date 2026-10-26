import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useMythos } from "../state/store";
import { WorldRenderer, isWebGLAvailable } from "../engine/WorldRenderer";
import type { InteractionSpec } from "../world/types";
import { ambience } from "../audio/ambience";
import { Button, IconButton, Kbd, Modal } from "./components";
import { Icon } from "./icons";
import { Wordmark } from "./Wordmark";
import { GenerationOverlay } from "./GenerationOverlay";
import { EditorPanel } from "./EditorPanel";
import { WorldPanel, type PanelTab } from "./WorldPanel";

interface Notice {
  eyebrow: string;
  title: string;
  text: string;
  revisiting?: boolean;
}

const KIND_EYEBROW: Record<string, string> = {
  artifact: "Artifact recorded",
  secret: "Secret recorded",
  landmark: "Landmark observed",
  clue: "Clue recorded",
};

export function WorldView() {
  const spec = useMythos((s) => s.current);
  const prefs = useMythos((s) => s.prefs);
  const setPrefs = useMythos((s) => s.setPrefs);
  const dirty = useMythos((s) => s.dirty);
  const saving = useMythos((s) => s.saving);
  const navigate = useMythos((s) => s.navigate);
  const remixCurrent = useMythos((s) => s.remixCurrent);
  const exportCurrent = useMythos((s) => s.exportCurrent);
  const aiStatus = useMythos((s) => s.aiStatus);
  const checkAiStatus = useMythos((s) => s.checkAiStatus);
  const revising = useMythos((s) => s.revising);
  const reviseCurrent = useMythos((s) => s.reviseCurrent);
  const undoRevision = useMythos((s) => s.undoRevision);
  const lastRevision = useMythos((s) => s.lastRevision);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<WorldRenderer | null>(null);
  const specRef = useRef(spec);
  specRef.current = spec;

  const [stage, setStage] = useState(0);
  const [ready, setReady] = useState(false);
  const [fading, setFading] = useState(false);
  const [overlayHidden, setOverlayHidden] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [nearby, setNearby] = useState<InteractionSpec | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<PanelTab>("world");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [eventBanner, setEventBanner] = useState<{ title: string; text: string } | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [hud, setHud] = useState({ bearing: 0 });
  const [hintsDim, setHintsDim] = useState(false);
  const [lockSupported, setLockSupported] = useState(true);
  const [reviseText, setReviseText] = useState("");

  const worldId = spec?.id;

  // Probe the architect route once so the revision control only appears when real.
  useEffect(() => {
    if (aiStatus === "unknown") void checkAiStatus();
  }, [aiStatus, checkAiStatus]);

  /* ---- renderer lifecycle ---------------------------------------- */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let renderer: WorldRenderer | null = null;

    if (!isWebGLAvailable()) {
      setFatal(
        "This browser does not provide WebGL, which MYTHOS needs to build a world. Try a recent version of Chrome, Edge, Firefox or Safari with hardware acceleration enabled.",
      );
      return;
    }

    setStage(1);
    const raf = requestAnimationFrame(() => {
      if (cancelled) return;
      const current = useMythos.getState().current;
      if (!current) return;
      try {
        renderer = new WorldRenderer(canvas, current, {
          onNearby: (interaction) => setNearby(interaction),
          onLockChange: (isLocked) => setLocked(isLocked),
          onPointerLockUnsupported: () => setLockSupported(false),
          onContextLost: () =>
            setFatal("The graphics context was lost. Your world is still in memory — reload the page to rebuild it."),
        });
        rendererRef.current = renderer;
        if (import.meta.env.DEV) {
          (window as unknown as { __mythosRenderer?: WorldRenderer }).__mythosRenderer = renderer;
        }
        renderer.setReducedMotion(useMythos.getState().prefs.reducedMotion);
        setStage(2);
        requestAnimationFrame(() => {
          if (cancelled) return;
          setStage(3);
          setReady(true);
          window.setTimeout(() => setFading(true), 420);
          window.setTimeout(() => setOverlayHidden(true), 1400);
        });
      } catch (err) {
        console.error("[mythos] renderer failed", err);
        setFatal(
          "The world could not be drawn. This usually means WebGL is disabled or the graphics driver rejected the scene.",
        );
      }
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      renderer?.dispose();
      rendererRef.current = null;
    };
    // Rebuild only when a different world is opened.
  }, [worldId]);

  /* ---- live edits ------------------------------------------------- */
  const editSig = spec
    ? JSON.stringify(spec.edits) +
      "|" +
      spec.atmosphere.particles.kind +
      "|" +
      spec.atmosphere.particles.density
    : "";
  useEffect(() => {
    if (!ready) return;
    const current = specRef.current;
    if (current) rendererRef.current?.setSpec(current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editSig, ready]);

  const discoverySig = spec?.exploration.discoveries.join(",") ?? "";
  useEffect(() => {
    rendererRef.current?.setDiscovered(discoverySig ? discoverySig.split(",") : []);
  }, [discoverySig]);

  /* ---- heading readout -------------------------------------------- */
  useEffect(() => {
    if (!ready) return;
    const id = window.setInterval(() => {
      const state = rendererRef.current?.getState();
      if (!state) return;
      const raw = (-state.yaw * 180) / Math.PI;
      setHud({ bearing: ((raw % 360) + 360) % 360 });
    }, 220);
    return () => window.clearInterval(id);
  }, [ready]);

  useEffect(() => {
    const timer = window.setTimeout(() => setHintsDim(true), 10000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    rendererRef.current?.setReducedMotion(prefs.reducedMotion);
    document.documentElement.classList.toggle("reduced-motion", prefs.reducedMotion);
    return () => document.documentElement.classList.remove("reduced-motion");
  }, [prefs.reducedMotion]);

  /* ---- audio ------------------------------------------------------ */
  useEffect(() => {
    if (!spec) return;
    if (prefs.soundEnabled) {
      ambience.setEnabled(true);
      ambience.setKind(spec.audio.ambience);
      ambience.setVolume(prefs.volume);
    } else {
      ambience.setEnabled(false);
    }
  }, [prefs.soundEnabled, prefs.volume, spec?.audio.ambience, spec]);

  useEffect(() => () => ambience.setEnabled(false), []);

  /* ---- activation ------------------------------------------------- */
  const activate = useCallback((interaction: InteractionSpec) => {
    const store = useMythos.getState();
    const current = store.current;
    const renderer = rendererRef.current;
    if (!current) return;
    const discovery = interaction.discoveryId
      ? current.discoveries.find((d) => d.id === interaction.discoveryId)
      : undefined;
    const event = interaction.eventId ? current.events.find((e) => e.id === interaction.eventId) : undefined;

    if (event && discovery) {
      const state = current.exploration.eventStates[event.id];
      if (state === "resolved") {
        setNotice({
          eyebrow: "Already opened",
          title: discovery.title,
          text: `${discovery.text} Reset the event from World details to experience the sequence again.`,
          revisiting: true,
        });
        return;
      }
      renderer?.playEvent(event);
      store.triggerEvent(event.id);
      renderer?.setDiscovered([...new Set([...current.exploration.discoveries, event.discoveryId])]);
      setNearby(null);
      setEventBanner({ title: event.title, text: event.description });
      window.setTimeout(() => setEventBanner(null), 9500);
      return;
    }

    if (discovery) {
      const already = current.exploration.discoveries.includes(discovery.id);
      if (!already) {
        store.recordDiscovery(discovery.id);
        renderer?.setDiscovered([...current.exploration.discoveries, discovery.id]);
      }
      setNotice({
        eyebrow: already ? "Revisited" : (KIND_EYEBROW[discovery.kind] ?? "Discovery recorded"),
        title: discovery.title,
        text: discovery.text,
        revisiting: already,
      });
      return;
    }

    setNotice({ eyebrow: "Examination", title: interaction.label, text: interaction.text });
  }, []);

  /* ---- keyboard --------------------------------------------------- */
  const anyPanelOpen = editorOpen || panelOpen;
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setInputEnabled(!anyPanelOpen);
    if (anyPanelOpen) renderer.exitLock();
  }, [anyPanelOpen, ready]);

  const save = useCallback(async () => {
    const renderer = rendererRef.current;
    const store = useMythos.getState();
    if (renderer) {
      const state = renderer.getState();
      store.setExplorationState({
        position: { x: state.x, y: state.y, z: state.z },
        yaw: state.yaw,
        pitch: state.pitch,
      });
    }
    await useMythos.getState().saveCurrent();
  }, []);

  const leave = useCallback(() => {
    rendererRef.current?.exitLock();
    ambience.setEnabled(false);
    setLeaveOpen(false);
    navigate("atelier");
  }, [navigate]);

  const requestBack = useCallback(() => {
    rendererRef.current?.exitLock();
    if (useMythos.getState().dirty) setLeaveOpen(true);
    else leave();
  }, [leave]);

  const openPanel = useCallback((tab: PanelTab) => {
    rendererRef.current?.exitLock();
    setPanelTab(tab);
    setPanelOpen(true);
    setEditorOpen(false);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
        return;
      }

      if (e.key === "Escape") {
        if (leaveOpen) setLeaveOpen(false);
        else if (notice) setNotice(null);
        else if (panelOpen) setPanelOpen(false);
        else if (editorOpen) setEditorOpen(false);
        return;
      }

      if (anyPanelOpen) return;

      if (e.code === "KeyE") {
        const interaction = rendererRef.current?.getNearby();
        if (interaction) {
          e.preventDefault();
          activate(interaction);
        }
      } else if (e.code === "KeyJ") {
        e.preventDefault();
        openPanel("discoveries");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activate, anyPanelOpen, editorOpen, leaveOpen, notice, openPanel, panelOpen, save]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 13000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const submitRevision = (e: FormEvent) => {
    e.preventDefault();
    const instruction = reviseText.trim();
    if (!instruction || revising) return;
    rendererRef.current?.exitLock();
    void reviseCurrent(instruction).then((ok) => {
      if (ok) setReviseText("");
    });
  };

  if (!spec) return null;

  const found = spec.exploration.discoveries.length;
  const total = spec.discoveries.length;
  const cardinal = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(hud.bearing / 45) % 8];

  return (
    <div className="world view-enter">
      <div className="world__canvas">
        <canvas ref={canvasRef} className="world__webgl" aria-label={`${spec.name}, an explorable 3D world`} />
        <div className="world__vignette" aria-hidden="true" />

        {ready && !fatal ? (
          <>
            <header className="world-bar">
              <div className="world-bar__left">
                <button className="world-back" onClick={requestBack} aria-label="Return to the Atelier">
                  <Icon name="arrow-left" size={17} />
                </button>
                <div className="world-bar__title-group">
                  <Wordmark compact />
                  <span className="world-bar__rule" aria-hidden="true" />
                  <h1 className="world-bar__title">{spec.name}</h1>
                  <span
                    className={`world-method ${spec.generation.method === "ai" ? "world-method--ai" : ""}`}
                    title={
                      spec.generation.method === "ai"
                        ? "Planned by the AI World Architect, built by the local engine"
                        : "Generated by the local procedural engine"
                    }
                  >
                    {spec.generation.method === "ai" ? "AI Architect" : "Procedural"}
                  </span>
                  {dirty ? (
                    <span className="world-bar__dirty">
                      <span className="status-dot status-dot--warn" aria-hidden="true" /> Unsaved
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="world-bar__actions">
                <button className="bar-btn" onClick={() => void save()} disabled={saving}>
                  {saving ? <span className="btn__spinner" aria-hidden="true" /> : <Icon name="save" size={15} />}
                  <span>{saving ? "Saving" : dirty ? "Save" : "Saved"}</span>
                </button>
                <button
                  className={`bar-btn ${editorOpen ? "is-active" : ""}`}
                  onClick={() => {
                    rendererRef.current?.exitLock();
                    setPanelOpen(false);
                    setEditorOpen((v) => !v);
                  }}
                  aria-pressed={editorOpen}
                >
                  <Icon name="sliders" size={15} />
                  <span>Environment</span>
                </button>
                <button className={`bar-btn ${panelOpen && panelTab === "discoveries" ? "is-active" : ""}`} onClick={() => openPanel("discoveries")}>
                  <Icon name="book" size={15} />
                  <span>
                    Journal <span className="bar-btn__count">{found}/{total}</span>
                  </span>
                </button>
                <IconButton
                  icon="dots"
                  label="World details and export"
                  className={panelOpen && panelTab === "world" ? "is-active" : ""}
                  onClick={() => openPanel("world")}
                />
                <IconButton
                  icon={prefs.soundEnabled ? "sound" : "sound-off"}
                  label={prefs.soundEnabled ? "Mute ambient sound" : "Enable ambient sound"}
                  onClick={() => {
                    const next = !prefs.soundEnabled;
                    setPrefs({ soundEnabled: next });
                    if (next) {
                      ambience.setEnabled(true);
                      ambience.setKind(spec.audio.ambience);
                      ambience.setVolume(prefs.volume);
                    } else {
                      ambience.setEnabled(false);
                    }
                  }}
                />
              </div>
            </header>

            {!locked ? (
              <div className="engage" aria-hidden="true">
                <span className="engage__ring" />
                <p className="engage__title">{lockSupported ? "Click to look around" : "Drag to look around"}</p>
                <p className="engage__sub">
                  {lockSupported ? "WASD to move · Esc releases the cursor" : "Pointer lock is unavailable in this browser"}
                </p>
              </div>
            ) : (
              <div className="reticle" aria-hidden="true">
                <span />
              </div>
            )}

            {aiStatus === "available" ? (
              <form className="revise" onSubmit={submitRevision}>
                <Icon name="pencil" size={14} />
                <input
                  className="revise__input"
                  value={reviseText}
                  onChange={(e) => setReviseText(e.target.value)}
                  placeholder="Revise this world… “colder, foggier, taller landmark”"
                  maxLength={280}
                  disabled={revising}
                  aria-label="Revise this world with a natural-language instruction"
                />
                {lastRevision ? (
                  <button type="button" className="revise__undo" onClick={undoRevision} title={lastRevision.reply}>
                    <Icon name="rotate" size={13} /> Undo
                  </button>
                ) : null}
                <button type="submit" className="revise__go" disabled={revising || !reviseText.trim()}>
                  {revising ? "Revising…" : "Revise"}
                </button>
              </form>
            ) : null}

            <div className={`world-hints ${hintsDim ? "is-dim" : ""}`}>
              <span className="world-hints__item">
                <Kbd>W</Kbd>
                <Kbd>A</Kbd>
                <Kbd>S</Kbd>
                <Kbd>D</Kbd> Move
              </span>
              <span className="world-hints__item">
                <Kbd>Shift</Kbd> Faster
              </span>
              <span className="world-hints__item">
                <Kbd>E</Kbd> Interact
              </span>
              <span className="world-hints__item">
                <Kbd>Esc</Kbd> Release
              </span>
            </div>

            <div className="world-stack">
              {eventBanner ? (
                <div className="event-banner">
                  <p className="eyebrow">World event</p>
                  <h2 className="event-banner__title">{eventBanner.title}</h2>
                  <p className="event-banner__text">{eventBanner.text}</p>
                </div>
              ) : null}

              {notice ? (
                <article className="notice">
                  <div className="notice__head">
                    <p className="eyebrow">{notice.revisiting ? "Revisited" : notice.eyebrow}</p>
                    <IconButton icon="close" label="Dismiss" onClick={() => setNotice(null)} />
                  </div>
                  <h2 className="notice__title">{notice.title}</h2>
                  <p className="notice__text">{notice.text}</p>
                  {!notice.revisiting ? (
                    <p className="notice__foot">
                      <Icon name="book" size={13} /> Recorded in the journal
                    </p>
                  ) : null}
                </article>
              ) : null}

              {nearby ? (
                <button className="prompt" onClick={() => activate(nearby)}>
                  <span className="prompt__key">{nearby.kind === "enter" ? "↵" : "E"}</span>
                  <span className="prompt__label">{nearby.label}</span>
                </button>
              ) : null}
            </div>

            <div className="compass" aria-hidden="true">
              <div className="compass__dial" style={{ transform: `rotate(${-hud.bearing}deg)` }}>
                <span className="compass__n">N</span>
                <span className="compass__e">E</span>
                <span className="compass__s">S</span>
                <span className="compass__w">W</span>
                <span className="compass__tick compass__tick--ne" />
                <span className="compass__tick compass__tick--se" />
                <span className="compass__tick compass__tick--sw" />
                <span className="compass__tick compass__tick--nw" />
              </div>
              <span className="compass__needle" />
              <span className="compass__readout mono">
                {cardinal} {Math.round(hud.bearing)}°
              </span>
            </div>

            <EditorPanel
              open={editorOpen}
              onClose={() => setEditorOpen(false)}
              spec={spec}
              onRemix={() => {
                const remixed = remixCurrent();
                if (remixed) setEditorOpen(false);
              }}
            />

            <WorldPanel
              open={panelOpen}
              tab={panelTab}
              onTab={setPanelTab}
              onClose={() => setPanelOpen(false)}
              spec={spec}
              renderer={rendererRef.current}
              onExport={exportCurrent}
              onBack={requestBack}
            />
          </>
        ) : null}

        {fatal ? (
          <div className="world-fatal">
            <div className="world-fatal__card">
              <p className="eyebrow">Rendering unavailable</p>
              <h2 className="world-fatal__title">The world could not be built</h2>
              <p className="world-fatal__text">{fatal}</p>
              <div className="world-fatal__actions">
                <Button variant="primary" onClick={leave}>
                  Return to the Atelier
                </Button>
                <Button variant="ghost" onClick={() => window.location.reload()}>
                  Reload
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {!overlayHidden && !fatal ? (
          <GenerationOverlay stage={stage} worldName={spec.name} fading={fading} />
        ) : null}
      </div>

      <Modal
        open={leaveOpen}
        onClose={() => setLeaveOpen(false)}
        title="Leave this world?"
        subtitle="Your changes have not been written to the archive."
        width={440}
        footer={
          <div className="modal__footer-row">
            <Button variant="ghost" onClick={() => setLeaveOpen(false)}>
              Stay
            </Button>
            <Button variant="danger" onClick={leave}>
              Discard and leave
            </Button>
            <Button
              variant="primary"
              loading={saving}
              onClick={async () => {
                await save();
                leave();
              }}
            >
              Save and leave
            </Button>
          </div>
        }
      >
        <p className="modal__prose">
          <strong>{spec.name}</strong> has edits or discoveries that exist only in this session. Save them to
          keep the world exactly as you left it.
        </p>
      </Modal>
    </div>
  );
}