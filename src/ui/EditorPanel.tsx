import { useEffect, useState } from "react";
import { useMythos } from "../state/store";
import type { ParticleKind, SkyKind, TimeOfDay, WorldEdits, WorldSpec } from "../world/types";
import { SKY_OPTIONS, TIME_OF_DAY_OPTIONS } from "../world/resolve";
import { Button, IconButton, Section, Segmented, Select, Slider } from "./components";
import { Icon } from "./icons";

const PARTICLE_OPTIONS: Array<{ value: ParticleKind; label: string }> = [
  { value: "none", label: "None" },
  { value: "embers", label: "Embers" },
  { value: "mist", label: "Mist" },
  { value: "snow", label: "Snow" },
  { value: "dust", label: "Dust" },
  { value: "fireflies", label: "Fireflies" },
  { value: "rain", label: "Rain" },
];

type Committed = Pick<
  WorldEdits,
  "terrainRoughness" | "terrainAmplitude" | "vegetationDensity" | "rockDensity" | "landmarkScale" | "landmarkRotation" | "stoneColor" | "particleDensity"
>;

export function EditorPanel({
  open,
  onClose,
  spec,
  onRemix,
}: {
  open: boolean;
  onClose: () => void;
  spec: WorldSpec;
  onRemix: () => void;
}) {
  const updateEdits = useMythos((s) => s.updateEdits);
  const clearEdits = useMythos((s) => s.clearEdits);
  const saveCurrent = useMythos((s) => s.saveCurrent);
  const saving = useMythos((s) => s.saving);
  const dirty = useMythos((s) => s.dirty);

  const [draft, setDraft] = useState<Partial<Committed>>({});
  const edits = spec.edits;
  const editedCount = Object.keys(edits).length;

  useEffect(() => {
    setDraft({});
  }, [spec.id]);

  const set = (partial: WorldEdits) => updateEdits(partial);
  const commit = (partial: Committed) => {
    updateEdits(partial);
    setDraft((d) => ({ ...d, ...partial }));
  };
  const committed = <K extends keyof Committed>(key: K, fallback: number | string): NonNullable<Committed[K]> =>
    (draft[key] as NonNullable<Committed[K]>) ?? (edits[key] as NonNullable<Committed[K]>) ?? (fallback as NonNullable<Committed[K]>);

  return (
    <aside className={`editor ${open ? "is-open" : ""}`} aria-hidden={!open} aria-label="Environment editor">
      <header className="editor__head">
        <div>
          <p className="eyebrow">Environment</p>
          <h2 className="editor__title">Adjust the world</h2>
        </div>
        <div className="editor__head-actions">
          {editedCount > 0 ? <span className="editor__edited">{editedCount} adjusted</span> : null}
          <IconButton icon="close" label="Close editor" onClick={onClose} />
        </div>
      </header>

      <div className="editor__scroll">
        <Section title="Atmosphere">
          <div className="control-block">
            <span className="control-block__label">Time of day</span>
            <Segmented
              options={TIME_OF_DAY_OPTIONS}
              value={(edits.timeOfDay ?? spec.timeOfDay) as TimeOfDay}
              onChange={(value) => set({ timeOfDay: value })}
              ariaLabel="Time of day"
              size="sm"
            />
          </div>
          <Select
            label="Sky"
            options={SKY_OPTIONS}
            value={edits.skyKind ?? spec.atmosphere.sky.kind}
            onChange={(e) => set({ skyKind: e.target.value as SkyKind })}
          />
          <Slider
            label="Fog density"
            value={edits.fogDensity ?? spec.atmosphere.fog.density}
            min={0}
            max={0.03}
            step={0.0005}
            onChange={(v) => set({ fogDensity: v })}
            format={(v) => (v < 0.0035 ? "clear" : v < 0.008 ? "haze" : v < 0.014 ? "heavy" : "opaque")}
            defaultValue={spec.atmosphere.fog.density}
          />
          <div className="color-row">
            <span className="color-row__label">Fog colour</span>
            <div className="color-row__control">
              <input
                type="color"
                className="color-input"
                value={edits.fogColor ?? spec.atmosphere.fog.color}
                onChange={(e) => set({ fogColor: e.target.value })}
                aria-label="Fog colour"
              />
              <span className="mono color-row__value">{edits.fogColor ?? spec.atmosphere.fog.color}</span>
            </div>
          </div>
          <Slider
            label="Key light"
            value={edits.keyIntensity ?? spec.atmosphere.lighting.keyIntensity}
            min={0}
            max={4}
            step={0.02}
            onChange={(v) => set({ keyIntensity: v })}
            format={(v) => v.toFixed(2)}
            defaultValue={spec.atmosphere.lighting.keyIntensity}
          />
          <Slider
            label="Ambient light"
            value={edits.ambientIntensity ?? spec.atmosphere.lighting.ambientIntensity}
            min={0}
            max={2.5}
            step={0.02}
            onChange={(v) => set({ ambientIntensity: v })}
            format={(v) => v.toFixed(2)}
            defaultValue={spec.atmosphere.lighting.ambientIntensity}
          />
          <Slider
            label="Accent glow"
            value={edits.accentIntensity ?? spec.atmosphere.lighting.accentIntensity}
            min={0}
            max={8}
            step={0.05}
            onChange={(v) => set({ accentIntensity: v })}
            format={(v) => v.toFixed(1)}
            defaultValue={spec.atmosphere.lighting.accentIntensity}
          />
        </Section>

        <Section title="Terrain" defaultOpen={false}>
          <Slider
            label="Roughness"
            value={committed("terrainRoughness", spec.terrain.roughness) as number}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => setDraft((d) => ({ ...d, terrainRoughness: v }))}
            onCommit={(v) => commit({ terrainRoughness: v })}
            format={(v) => `${Math.round(v * 100)}%`}
            defaultValue={spec.terrain.roughness}
            hint="Rebuilds the heightfield when released."
          />
          <Slider
            label="Elevation"
            value={committed("terrainAmplitude", spec.terrain.amplitude) as number}
            min={0}
            max={40}
            step={0.5}
            onChange={(v) => setDraft((d) => ({ ...d, terrainAmplitude: v }))}
            onCommit={(v) => commit({ terrainAmplitude: v })}
            format={(v) => `${v.toFixed(0)} m`}
            defaultValue={spec.terrain.amplitude}
            hint="Rebuilds the heightfield when released."
          />
          <Slider
            label="Rock scatter"
            value={committed("rockDensity", 1) as number}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => setDraft((d) => ({ ...d, rockDensity: v }))}
            onCommit={(v) => commit({ rockDensity: v })}
            format={(v) => `${Math.round(v * 100)}%`}
            defaultValue={1}
            hint="Relative to the generated baseline."
          />
        </Section>

        <Section title="Environment" defaultOpen={false}>
          <Slider
            label="Vegetation"
            value={committed("vegetationDensity", 1) as number}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => setDraft((d) => ({ ...d, vegetationDensity: v }))}
            onCommit={(v) => commit({ vegetationDensity: v })}
            format={(v) => `${Math.round(v * 100)}%`}
            defaultValue={1}
            hint="Relative to the generated baseline."
          />
          {spec.water.enabled ? (
            <>
              <div className="color-row">
                <span className="color-row__label">Water colour</span>
                <div className="color-row__control">
                  <input
                    type="color"
                    className="color-input"
                    value={edits.waterColor ?? spec.water.color}
                    onChange={(e) => set({ waterColor: e.target.value })}
                    aria-label="Water colour"
                  />
                  <span className="mono color-row__value">{edits.waterColor ?? spec.water.color}</span>
                </div>
              </div>
              <Slider
                label="Wave height"
                value={edits.waveHeight ?? spec.water.waveHeight}
                min={0}
                max={1.5}
                step={0.01}
                onChange={(v) => set({ waveHeight: v })}
                format={(v) => (v < 0.08 ? "still" : v < 0.5 ? "calm" : "restless")}
                defaultValue={spec.water.waveHeight}
              />
            </>
          ) : (
            <p className="editor__note">This world has no water surface.</p>
          )}
          <Select
            label="Particles"
            options={PARTICLE_OPTIONS}
            value={edits.particleKind ?? spec.atmosphere.particles.kind}
            onChange={(e) => set({ particleKind: e.target.value as ParticleKind })}
          />
          <Slider
            label="Particle density"
            value={committed("particleDensity", spec.atmosphere.particles.density) as number}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => setDraft((d) => ({ ...d, particleDensity: v }))}
            onCommit={(v) => commit({ particleDensity: v })}
            format={(v) => `${Math.round(v * 100)}%`}
            defaultValue={spec.atmosphere.particles.density}
          />
        </Section>

        <Section title="Architecture" defaultOpen={false}>
          <Slider
            label="Landmark scale"
            value={committed("landmarkScale", 1) as number}
            min={0.4}
            max={2.2}
            step={0.01}
            onChange={(v) => setDraft((d) => ({ ...d, landmarkScale: v }))}
            onCommit={(v) => commit({ landmarkScale: v })}
            format={(v) => `${v.toFixed(2)}×`}
            defaultValue={1}
            hint="Rescales structures flagged as landmarks."
          />
          <Slider
            label="Landmark rotation"
            value={committed("landmarkRotation", 0) as number}
            min={-180}
            max={180}
            step={1}
            onChange={(v) => setDraft((d) => ({ ...d, landmarkRotation: v }))}
            onCommit={(v) => commit({ landmarkRotation: v })}
            format={(v) => `${v.toFixed(0)}°`}
            defaultValue={0}
          />
          <div className="color-row">
            <span className="color-row__label">Stone tone</span>
            <div className="color-row__control">
              <input
                type="color"
                className="color-input"
                value={edits.stoneColor ?? spec.stoneColor}
                onChange={(e) => setDraft((d) => ({ ...d, stoneColor: e.target.value }))}
                onBlur={(e) => commit({ stoneColor: e.target.value })}
                aria-label="Stone tone"
              />
              <span className="mono color-row__value">{edits.stoneColor ?? spec.stoneColor}</span>
            </div>
          </div>
          <Slider
            label="Landmark presence"
            value={edits.landmarkVisible === false ? 0 : 1}
            min={0}
            max={1}
            step={1}
            onChange={(v) => set({ landmarkVisible: v === 1 })}
            format={(v) => (v === 1 ? "visible" : "hidden")}
            defaultValue={1}
            hint="Hiding landmarks also removes their collision."
          />
        </Section>

        <p className="editor__note editor__note--footer">
          Changes are applied to the live scene and are not saved until you save the world.
        </p>
      </div>

      <footer className="editor__foot">
        <div className="editor__status">
          <span className={`status-dot ${dirty ? "status-dot--warn" : "status-dot--ok"}`} aria-hidden="true" />
          {dirty ? "Unsaved changes" : "All changes saved"}
        </div>
        <div className="editor__actions">
          <Button variant="ghost" compact icon="rotate" onClick={clearEdits} disabled={editedCount === 0}>
            Discard edits
          </Button>
          <Button variant="ghost" compact icon="plus" onClick={onRemix}>
            Remix
          </Button>
          <Button variant="primary" compact icon="save" loading={saving} onClick={() => void saveCurrent()}>
            Save
          </Button>
        </div>
        <p className="editor__hint">
          <Icon name="info" size={13} /> Atmosphere and lighting update instantly. Terrain, density and landmark
          changes rebuild only the affected layers.
        </p>
      </footer>
    </aside>
  );
}