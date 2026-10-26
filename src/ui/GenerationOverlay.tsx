import { Wordmark } from "./Wordmark";

const STAGES = ["Interpreting description", "Assembling environment", "Preparing exploration"];

const DEFAULT_NOTE = "Seeded geometry · validated specification · no external model call";

export function GenerationOverlay({
  stage,
  worldName,
  fading,
  stages = STAGES,
  note = DEFAULT_NOTE,
}: {
  stage: number;
  worldName?: string;
  fading?: boolean;
  /** Truthful stage labels; progress is stage-derived, never fabricated. */
  stages?: string[];
  note?: string;
}) {
  return (
    <div className={`gen ${fading ? "is-fading" : ""}`} role="status" aria-live="polite">
      <div className="gen__inner">
        <Wordmark compact />
        <p className="eyebrow gen__eyebrow">{worldName ? "Materialising" : "Building a world"}</p>
        <h1 className="gen__title display">{worldName ?? "A new place"}</h1>
        <ol className="gen__stages">
          {stages.map((label, index) => {
            const status = index < stage ? "done" : index === stage ? "current" : "pending";
            return (
              <li key={label} className={`gen__stage gen__stage--${status}`}>
                <span className="gen__dot" aria-hidden="true" />
                <span className="gen__label">{label}</span>
                <span className="gen__state">{status === "done" ? "done" : status === "current" ? "working" : ""}</span>
              </li>
            );
          })}
        </ol>
        <div className="gen__rule" aria-hidden="true">
          <span style={{ width: `${((stage + 0.4) / stages.length) * 100}%` }} />
        </div>
        <p className="gen__note">{note}</p>
      </div>
    </div>
  );
}