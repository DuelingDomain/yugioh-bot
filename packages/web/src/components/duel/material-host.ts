/**
 * Xyz materials in a pick (a detach cost, "detach 2 materials", a material of a Summon) are not cards on the board, so the
 * prompt lists them as card tiles. When the materials sit under more than one Xyz monster, each tile says which one.
 */
import type { DuelPromptOption } from "@yugidraft/shared/duels";
import { LOCATION_OVERLAY } from "./constants";

export interface MaterialHostNote {
  /** The one short line under the tile. */
  detail: string;
  /** The same line, for the tooltip. */
  title: string;
}

/** True for an Xyz material: it sits under an Xyz monster and cannot be clicked on the board. */
export function isMaterialOption(option: DuelPromptOption): boolean {
  return option.location != null && (option.location & LOCATION_OVERLAY) !== 0;
}

function hostKey(option: DuelPromptOption): string | null {
  const host = option.host;
  return host ? `${host.controller}:${host.location}:${host.sequence}` : null;
}

function zoneText(option: DuelPromptOption): string {
  const sequence = option.host?.sequence ?? 0;
  return sequence >= 5 ? "Extra Monster Zone" : `Zone ${sequence + 1}`;
}

/**
 * One note per option, in order: "Under <Xyz name>" for a material, null for any other option. Only set when the
 * materials come from two or more Xyz monsters; one Xyz needs no line. Two Xyz of one name add their zone.
 */
export function materialHostNotes(options: readonly DuelPromptOption[]): Array<MaterialHostNote | null> {
  const hosts = new Set<string>();
  for (const option of options) {
    const key = isMaterialOption(option) ? hostKey(option) : null;
    if (key) hosts.add(key);
  }
  if (hosts.size < 2) return options.map(() => null);
  // Which Xyz names are shared by more than one host.
  const namesOf = new Map<string, Set<string>>();
  for (const option of options) {
    const key = isMaterialOption(option) ? hostKey(option) : null;
    if (!key) continue;
    const name = option.host?.name ?? "an Xyz monster";
    const keys = namesOf.get(name) ?? new Set<string>();
    keys.add(key);
    namesOf.set(name, keys);
  }
  return options.map((option) => {
    if (!isMaterialOption(option) || !option.host) return null;
    const name = option.host.name ?? "an Xyz monster";
    const shared = (namesOf.get(name)?.size ?? 0) > 1;
    const sameSeat = new Set(options.filter((other) => other.host).map((other) => other.host!.controller)).size < 2;
    const where = shared ? ` (${sameSeat ? "" : `P${option.host.controller + 1} `}${zoneText(option)})` : "";
    const text = `Under ${name}${where}`;
    return { detail: text, title: text };
  });
}
