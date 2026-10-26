import { Component, Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { useMythos } from "./state/store";
import { Atelier } from "./ui/Atelier";
import { Library } from "./ui/Library";
import { SettingsModal } from "./ui/SettingsModal";
import { Toasts } from "./ui/Toasts";
import { Button } from "./ui/components";

// The world view carries the whole three.js engine. Load it on first entry so
// the atelier and library paint without it.
const WorldView = lazy(() => import("./ui/WorldView").then((m) => ({ default: m.WorldView })));

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("[mythos] interface error", error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="world-fatal">
        <div className="world-fatal__card">
          <p className="eyebrow">Interface error</p>
          <h2 className="world-fatal__title">Something broke in the atelier</h2>
          <p className="world-fatal__text">
            Your saved worlds are stored separately and are not affected. Reloading usually restores the
            interface.
          </p>
          <pre className="settings__note mono" style={{ whiteSpace: "pre-wrap", maxHeight: 140, overflow: "auto" }}>
            {this.state.error.message}
          </pre>
          <div className="world-fatal__actions">
            <Button variant="primary" onClick={() => window.location.reload()}>
              Reload MYTHOS
            </Button>
          </div>
        </div>
      </div>
    );
  }
}

export default function App() {
  const view = useMythos((s) => s.view);
  const current = useMythos((s) => s.current);
  const refresh = useMythos((s) => s.refreshLibrary);
  const reducedMotion = useMythos((s) => s.prefs.reducedMotion);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    document.documentElement.classList.toggle("reduced-motion", reducedMotion);
  }, [reducedMotion]);

  return (
    <Boundary>
      <div className="app">
        {view === "world" && current ? (
          <Suspense
            fallback={
              <div className="view-loading">
                <span className="eyebrow">Entering the world…</span>
              </div>
            }
          >
            <WorldView />
          </Suspense>
        ) : view === "library" ? (
          <Library onOpenSettings={() => setSettingsOpen(true)} />
        ) : (
          <Atelier onOpenSettings={() => setSettingsOpen(true)} />
        )}
      </div>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <Toasts />
    </Boundary>
  );
}