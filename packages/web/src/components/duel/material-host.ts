/**
 * Xyz materials in a pick (a detach cost, "detach 2 materials", a material of a Summon) are not cards on the board, so the
 * prompt lists them as card tiles. When the materials sit under more than one Xyz monster, each tile says which one. Next to
 * normal cards, a material says what it is.
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

/** Who is reading the prompt, to name an Xyz's owner: "your" and "opponent's" in 1v1, the player's name on a table of 3 or 4. */
export interface MaterialViewer {
  mySeat: number | null;
  /** Display name of a seat. Pass it only on a table of 3 or 4; 1v1 reads "your" / "opponent's". */
  nameOf?: (seat: number) => string;
}

function ownerText(controller: number, who: MaterialViewer): string {
  if (controller === who.mySeat) return "your";
  return who.nameOf ? `${who.nameOf(controller)}'s` : "opponent's";
}

/**
 * One note per option, in order. A material says "Under <Xyz name>" when the materials sit under two or more Xyz monsters
 * (one Xyz needs no line); the owner is added when the Xyz have different controllers, and "1 of 2" (first) when two of one
 * controller share a name. When one Xyz's materials share the prompt with other cards, they say "Xyz material" instead.
 * Any other option gets null.
 */
export function materialHostNotes(options: readonly DuelPromptOption[], who: MaterialViewer = { mySeat: null }): Array<MaterialHostNote | null> {
  const materials = options.filter(isMaterialOption);
  const hosts = new Map<string, NonNullable<DuelPromptOption["host"]>>();
  for (const option of materials) {
    const key = hostKey(option);
    if (key && option.host) hosts.set(key, option.host);
  }
  if (hosts.size < 2) {
    if (materials.length === 0 || materials.length === options.length) return options.map(() => null);
    const note = { detail: "Xyz material", title: "Xyz material" };
    return options.map((option) => (isMaterialOption(option) ? note : null));
  }
  const spread = new Set([...hosts.values()].map((host) => host.controller)).size > 1;
  // Hosts of one name and one controller, in the viewer's left-to-right order, to tell twins apart. The 1v1 board turns the
  // far side around (zone 4 sits at the left), so the opponent's twins count down; a table of 3 or 4 draws every row upright.
  const farSide = (controller: number) => !who.nameOf && who.mySeat != null && controller !== who.mySeat;
  const twins = new Map<string, string[]>();
  for (const [key, host] of [...hosts].sort((a, b) => (farSide(a[1].controller) ? b[1].sequence - a[1].sequence : a[1].sequence - b[1].sequence))) {
    const group = `${host.controller}:${host.name ?? ""}`;
    twins.set(group, [...(twins.get(group) ?? []), key]);
  }
  return options.map((option) => {
    if (!isMaterialOption(option) || !option.host) return null;
    const key = hostKey(option)!;
    const group = twins.get(`${option.host.controller}:${option.host.name ?? ""}`) ?? [];
    const nth = group.indexOf(key);
    // A host the viewer cannot see has no name: "a face-down Xyz", or "opponent's face-down Xyz" after an owner word.
    const owner = spread ? ownerText(option.host.controller, who) : null;
    const host = option.host.name ?? (owner ? "face-down Xyz" : "a face-down Xyz");
    // The count comes first: a narrow tile cuts the end of the line, and twins must still differ.
    const text = `${group.length > 1 ? `${nth + 1} of ${group.length} · ` : ""}Under ${owner ? `${owner} ` : ""}${host}`;
    return { detail: text, title: text };
  });
}
