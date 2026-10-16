import {
  DEFAULT_GENESYS_POINT_CAP,
  MAX_GENESYS_POINT_CAP,
  type DuelMasterRule,
  type DuelEngineView,
  type DuelSettings,
  type GenesysSettings,
} from "@yugidraft/shared/duels";

/**
 * Genesys display helpers for the duel screens. Genesys is metadata on the settings (`settings.genesys`), never an engine
 * mode: `normal` stays "Standard" and `domain` stays "Domain". A missing or null field is an ordinary duel, so old rooms,
 * replays and lists read exactly as before.
 */
type WithSettings = { settings?: Pick<DuelSettings, "genesys"> | null };

/** The Genesys settings of a duel, or null when the duel is not a Genesys duel. */
export function genesysOf(source: WithSettings | null | undefined): GenesysSettings | null {
  return source?.settings?.genesys ?? null;
}

/** "Genesys" or "Genesys Domain" (a custom Domain table says "Custom Genesys Domain"); null when Genesys is off. */
export function genesysModeName(mode: "normal" | "domain", genesys: GenesysSettings | null | undefined, custom = false): string | null {
  if (!genesys) return null;
  if (mode !== "domain") return "Genesys";
  return custom ? "Custom Genesys Domain" : "Genesys Domain";
}

/** "100 pts", the point cap as a short badge. */
export function genesysCapShort(genesys: GenesysSettings): string {
  return `${genesys.pointCap} pts`;
}

/** "Genesys · 100 pts" or "Genesys Domain · 100 pts": the label with the cap, for headers and badges. */
export function genesysLabel(mode: "normal" | "domain", genesys: GenesysSettings | null | undefined, custom = false): string | null {
  const name = genesysModeName(mode, genesys, custom);
  return name && genesys ? `${name} · ${genesysCapShort(genesys)}` : null;
}

/** Draw the zones reported by the engine, including rebuilt replay views. */
export function boardMasterRule(masterRule: DuelMasterRule, field: DuelEngineView["field"] | null | undefined): DuelMasterRule {
  return field?.genesys === true && masterRule >= 3 ? 2 : masterRule;
}

export function sessionBoardRule(session: { masterRule: DuelMasterRule }, view: Pick<DuelEngineView, "field"> | null | undefined): DuelMasterRule {
  return boardMasterRule(session.masterRule, view?.field);
}

export type CapParse = { ok: true; value: number } | { ok: false; message: string };

/** Reads the point cap field. The cap is an integer from 0 to 1000; an empty field is not a cap. */
export function parseGenesysCap(text: string): CapParse {
  const trimmed = text.trim();
  const message = `Enter a whole number from 0 to ${MAX_GENESYS_POINT_CAP}.`;
  if (!/^\d+$/.test(trimmed)) return { ok: false, message };
  const value = Number(trimmed);
  return value <= MAX_GENESYS_POINT_CAP ? { ok: true, value } : { ok: false, message };
}

export { DEFAULT_GENESYS_POINT_CAP, MAX_GENESYS_POINT_CAP };
