/** Storage identities stay stable so reviews, deep-job keys and saved chips survive display changes. */
export const BRIDGE_GROUP_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  Odion: "Temple of the Kings",
};

export function bridgeGroupName(id: string): string {
  return BRIDGE_GROUP_DISPLAY_NAMES[id] ?? id;
}

/** Accept official names and historical storage identities, including saved chip corrections. */
export function resolveBridgeGroup(name: string, groups: Record<string, unknown>): string | undefined {
  const normalized = name.trim().toLowerCase();
  return Object.keys(groups).find(id => id.toLowerCase() === normalized || bridgeGroupName(id).toLowerCase() === normalized);
}

/** Presentation happens after evidence validation; never translate a judge input or cache identity. */
export function displayBridgeGroups<T>(value: T): T {
  if (typeof value === "string") return value.replace(/\bOdion\b/g, BRIDGE_GROUP_DISPLAY_NAMES.Odion!) as T;
  if (Array.isArray(value)) return value.map(displayBridgeGroups) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, displayBridgeGroups(item)])) as T;
  return value;
}
