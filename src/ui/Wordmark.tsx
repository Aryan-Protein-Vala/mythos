export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`wordmark ${compact ? "wordmark--compact" : ""}`} aria-label="MYTHOS">
      <svg className="wordmark__glyph" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9.1" fill="none" stroke="currentColor" strokeWidth="1.1" opacity="0.65" />
        <circle cx="13.6" cy="10.6" r="7.2" fill="var(--ink)" stroke="none" />
        <circle cx="11.2" cy="13.3" r="2.05" fill="currentColor" opacity="0.9" />
      </svg>
      <span className="wordmark__text">MYTHOS</span>
    </span>
  );
}