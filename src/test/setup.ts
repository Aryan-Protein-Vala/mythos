import "fake-indexeddb/auto";

// The zustand store references `window` for toast timers. Tests run in node,
// so map window onto globalThis — close enough for timer access.
if (typeof globalThis.window === "undefined") {
  (globalThis as Record<string, unknown>).window = globalThis;
}
