import { phaseLabel } from "../constants";

/** The phase as the header names it: "Main Phase 1", "Battle Phase", "Damage Step". */
export function phaseTitle(phase: string | null | undefined): string {
  const label = phaseLabel(phase);
  switch (label) {
    case "Draw":
    case "Standby":
    case "Battle":
    case "End":
      return `${label} Phase`;
    case "Main 1":
      return "Main Phase 1";
    case "Main 2":
      return "Main Phase 2";
    case "Damage":
      return "Damage Step";
    case "Damage calculation":
      return "Damage Calculation";
    default:
      return label;
  }
}

/** A face-down or unnamed target reads as "face-down monster" in the attack confirm. */
export function targetName(option: { label?: string; card?: { name?: string | null } | null }): string {
  const name = option.card?.name?.trim();
  if (name) return name;
  return !option.label || /^Card \d+$/.test(option.label) ? "face-down monster" : option.label;
}

/** The first element a zone key marks on the page (the card button when it has one). */
export function zoneAnchor(key: string, scope: ParentNode = document): HTMLElement | null {
  const zone = scope.querySelector<HTMLElement>(`[data-zones~="${key}"]`);
  return zone?.querySelector<HTMLElement>("button") ?? zone;
}

/** Put the confirm on the side of the target away from the attacker, so it never covers the arrow. */
export function confirmSide(attackerKey: string | null, anchor: HTMLElement, scope: ParentNode = document): "above" | "below" {
  const from = attackerKey ? scope.querySelector(`[data-zones~="${attackerKey}"]`) : null;
  if (!from) return "above";
  return from.getBoundingClientRect().top > anchor.getBoundingClientRect().top ? "above" : "below";
}
