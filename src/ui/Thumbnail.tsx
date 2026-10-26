import { useEffect, useState } from "react";
import type { WorldSpec } from "../world/types";

const STORAGE_KEY = "mythos:thumbnails";
const memory = new Map<string, string>();
let chain: Promise<unknown> = Promise.resolve();

function readStored(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function writeStored(key: string, dataUrl: string): void {
  try {
    const all = readStored();
    all[key] = dataUrl;
    const keys = Object.keys(all);
    if (keys.length > 14) delete all[keys[0]];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* cache is best effort */
  }
}

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Bump when the establishing-shot framing changes so stale previews are rebuilt. */
const THUMBNAIL_VERSION = 3;

export function thumbnailKey(spec: WorldSpec): string {
  return `${spec.id}:${spec.seed}:${spec.updatedAt}:v${THUMBNAIL_VERSION}`;
}

export function useWorldThumbnail(spec: WorldSpec | null, enabled = true): string | null {
  const key = spec ? thumbnailKey(spec) : "";
  const [src, setSrc] = useState<string | null>(() => (key ? (memory.get(key) ?? readStored()[key] ?? null) : null));

  useEffect(() => {
    if (!spec || !enabled) return;
    const cacheKey = thumbnailKey(spec);
    const existing = memory.get(cacheKey) ?? readStored()[cacheKey];
    if (existing) {
      memory.set(cacheKey, existing);
      setSrc(existing);
      return;
    }
    let cancelled = false;
    enqueue(async () => {
      const { renderWorldThumbnail } = await import("../engine/WorldRenderer");
      return renderWorldThumbnail(spec, 640, 420);
    })
      .then((url) => {
        memory.set(cacheKey, url);
        writeStored(cacheKey, url);
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [key, enabled, spec]);

  return src;
}

interface WorldThumbProps {
  spec: WorldSpec;
  className?: string;
  eager?: boolean;
}

export function WorldThumb({ spec, className = "", eager }: WorldThumbProps) {
  const src = useWorldThumbnail(spec, true);
  const style = {
    background: `linear-gradient(165deg, ${spec.atmosphere.sky.top} 0%, ${spec.atmosphere.sky.horizon} 55%, ${spec.terrain.lowColor} 100%)`,
  };
  return (
    <div className={`thumb ${className}`} style={src ? undefined : style}>
      {src ? (
        <img src={src} alt="" className="thumb__img" loading={eager ? "eager" : "lazy"} draggable={false} />
      ) : (
        <div className="thumb__pending" aria-hidden="true">
          <span className="thumb__pending-line" />
        </div>
      )}
      <div className="thumb__scrim" aria-hidden="true" />
    </div>
  );
}