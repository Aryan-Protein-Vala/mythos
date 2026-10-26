import { useState } from "react";
import { useMythos } from "../state/store";
import { Button, Kbd, Modal, Slider, Toggle } from "./components";
import { Icon } from "./icons";

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const prefs = useMythos((s) => s.prefs);
  const setPrefs = useMythos((s) => s.setPrefs);
  const library = useMythos((s) => s.library);
  const [clearing, setClearing] = useState(false);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Settings"
      subtitle="Stored locally in this browser."
      width={560}
      footer={
        <div className="modal__footer-row">
          <span className="muted-small">MYTHOS · procedural engine · schema v3</span>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      }
    >
      <div className="settings">
        <div className="settings__group">
          <h3 className="settings__heading">Experience</h3>
          <Toggle
            label="Ambient sound"
            description="Procedural wind, water and forest noise. Starts after you enter a world."
            checked={prefs.soundEnabled}
            onChange={(v) => setPrefs({ soundEnabled: v })}
          />
          <Slider
            label="Volume"
            value={prefs.volume}
            min={0}
            max={1}
            step={0.01}
            disabled={!prefs.soundEnabled}
            onChange={(v) => setPrefs({ volume: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <Toggle
            label="Reduce motion"
            description="Removes head bob and shortens interface transitions."
            checked={prefs.reducedMotion}
            onChange={(v) => setPrefs({ reducedMotion: v })}
          />
        </div>

        <div className="settings__group">
          <h3 className="settings__heading">Controls</h3>
          <dl className="keys">
            <div>
              <dt>
                <Kbd>W</Kbd> <Kbd>A</Kbd> <Kbd>S</Kbd> <Kbd>D</Kbd>
              </dt>
              <dd>Move</dd>
            </div>
            <div>
              <dt>
                <Kbd>Mouse</Kbd>
              </dt>
              <dd>Look · click to lock the cursor, Esc to release</dd>
            </div>
            <div>
              <dt>
                <Kbd>E</Kbd>
              </dt>
              <dd>Interact with what is in front of you</dd>
            </div>
            <div>
              <dt>
                <Kbd>Shift</Kbd>
              </dt>
              <dd>Move faster</dd>
            </div>
            <div>
              <dt>
                <Kbd>Space</Kbd>
              </dt>
              <dd>Step up or jump</dd>
            </div>
          </dl>
          <p className="settings__note">
            If the browser blocks pointer lock, hold the left mouse button and drag to look around.
          </p>
        </div>

        <div className="settings__group">
          <h3 className="settings__heading">Generation</h3>
          <p className="settings__note">
            This build generates worlds entirely on your device with the procedural engine. No API key is
            required, and no prompt or world data leaves the browser. Model-assisted generation can be added
            through a server-side provider; it is not configured here, so the interface reports
            <span className="settings__inline"> procedural </span> on every world.
          </p>
        </div>

        <div className="settings__group">
          <h3 className="settings__heading">Local data</h3>
          <p className="settings__note">
            {library.length === 0
              ? "No worlds are saved in this browser yet."
              : `${library.length} world${library.length === 1 ? "" : "s"} saved in IndexedDB.`}{" "}
            Export anything you want to keep before clearing browser storage.
          </p>
          <div className="settings__actions">
            <Button
              variant="danger"
              icon="trash"
              loading={clearing}
              onClick={async () => {
                if (!window.confirm("Delete every saved world from this browser? This cannot be undone.")) return;
                setClearing(true);
                const store = useMythos.getState();
                for (const world of store.library) {
                  await store.removeFromLibrary(world.id);
                }
                setClearing(false);
              }}
            >
              Delete all saved worlds
            </Button>
          </div>
        </div>

        <div className="settings__group settings__group--quiet">
          <h3 className="settings__heading">About</h3>
          <p className="settings__note">
            MYTHOS turns a written description into a validated world specification, then materialises it
            from a fixed library of procedural building blocks. Every world is seeded and reproducible.
          </p>
          <div className="settings__credits">
            <span>
              <Icon name="globe" size={14} /> Local · no network inference
            </span>
            <span>Three.js · React · TypeScript</span>
          </div>
        </div>
      </div>
    </Modal>
  );
}