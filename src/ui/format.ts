export function formatWhen(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export const BIOME_LABEL: Record<string, string> = {
  volcanic: "Volcanic",
  forest: "Forest",
  desert: "Desert",
  tundra: "Tundra",
  celestial: "Celestial",
};

export function titleCase(value: string): string {
  return value.replace(/(^|[-\s])\w/g, (m) => m.toUpperCase());
}