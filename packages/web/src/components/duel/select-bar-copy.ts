/**
 * Words for the centred pick surfaces (the on-board select bar and the card-grid header).
 *
 * Engine hints are long and printf-like ("Select the card(s) to use as Synchro Material", "Select a zone for
 * Blue-Eyes White Dragon"). The surface shows a short whole label as the title, the card or purpose on a
 * second line, and a progress line ("Pick 2 · 1/2 selected"). Nothing is cut with an ellipsis: the full engine
 * text stays in `full` and `tooltip` for the tooltip and the screen reader. Pure: no DOM, no prompt module.
 */
import type { DuelPrompt } from "@yugidraft/shared/duels";

export type BarKind = "zone" | "materials" | "discard" | "tribute" | "target" | "position" | "sum" | "cards";

export interface BarCopyInput {
  kind: DuelPrompt["kind"];
  /** Engine title with placeholders filled. */
  title: string;
  description?: string;
  /** Pick bounds (selectionBounds). */
  min: number;
  max: number;
  /** The engine sent no max, so `max` is only the number of options: not a real limit to show. */
  openEnded?: boolean;
  /** Cards chosen so far. */
  count: number;
  /** Chosen values of a sum pick, "4 + 4". */
  values?: string;
  /** Sum pick target. */
  target?: number;
  /** One card at a time: every pick is a step, so the count always shows. */
  toggling?: boolean;
  /** An attack-target pick: picking a card aims. */
  aiming?: boolean;
  /** Name of the card the prompt is about, when the engine says. */
  sourceName?: string | null;
  /** The prompt is a position pick (context "position"), whatever its title says. */
  position?: boolean;
}

export interface BarCopy {
  kind: BarKind;
  /** Short whole label, 18 characters or fewer for every standard prompt. */
  title: string;
  /** The card or purpose, or null. */
  detail: string | null;
  /** "Pick 2 · 1/2 selected". */
  progress: string;
  /** Second line: detail and progress. */
  sub: string;
  /** The engine title as it came. */
  full: string;
  /** Tooltip: the engine title and the description. */
  tooltip: string;
}

const MATERIAL_KIND = /\b(fusion|synchro|xyz|link|ritual|pendulum)\b/i;
const PURPOSE = /^select\s+(?:the\s+)?(?:\d+\s+(?:to\s+\d+\s+)?)?(?:face-?(?:up|down)\s+)?(?:card|monster|spell|trap|target)(?:s|\(s\))?\s+(?:to\s+|that\s+)(.+?)\.?$/i;
const ZONE_FOR = /^select\s+a\s+zone\s+for\s+(.+?)\.?$/i;
const POSITION_FOR = /\bfor\s+(.+?)\.?$/i;

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function classify(input: BarCopyInput): BarKind {
  const { kind, title } = input;
  if (kind === "places") return "zone";
  if (input.position) return "position";
  if (kind === "tribute" || /\b(?:tribute|release)\b/i.test(title)) return "tribute";
  if (/\bdiscard\b/i.test(title)) return "discard";
  if (/\bmaterial/i.test(title)) return "materials";
  if (input.aiming || /\btarget/i.test(title)) return "target";
  if (/\bposition\b/i.test(title)) return "position";
  if (kind === "sum") return "sum";
  return "cards";
}

function progressLine(input: BarCopyInput, kind: BarKind): string {
  const { min, max, count, values, target } = input;
  if (input.aiming) return "Point at a target, then confirm";
  if (input.kind === "sum" && target != null) return `Total ${target}${values ? ` · ${values}` : ""}`;
  if (input.kind === "tribute") return `${count} selected`;
  if (input.kind === "order") return `${count} of ${max} ordered`;
  if (!input.openEnded && min === max) {
    const steps = max > 1 || input.toggling || count > 0;
    return `Pick ${max}${steps ? ` · ${count}/${max} selected` : ""}`;
  }
  if (min <= 0) return `Pick up to ${max} · ${count} selected`;
  if (input.openEnded) return `Pick ${min} or more · ${count} selected`;
  return `Pick ${min} to ${max} · ${count} selected`;
}

export function selectBarCopy(input: BarCopyInput): BarCopy {
  const full = input.title.trim();
  const kind = classify(input);
  const exact = !input.openEnded && input.min === input.max && input.max > 0 ? input.max : null;
  const source = input.sourceName?.trim() || null;
  let title: string;
  let detail: string | null = null;

  switch (kind) {
    case "zone": {
      const disable = /\bdisable\b/i.test(full);
      const count = exact ?? 0;
      title = disable
        ? count > 1 ? `Disable ${count} zones` : count === 1 ? "Disable a zone" : "Disable zones"
        : count > 1 ? `Choose ${count} zones` : count === 1 ? "Choose a zone" : "Choose zones";
      detail = full.match(ZONE_FOR)?.[1] ?? (disable ? null : source);
      break;
    }
    case "tribute": {
      const need = input.kind === "tribute" ? input.min : exact;
      title = need != null && need > 0 ? `Tribute ${need}` : "Tribute";
      detail = source;
      break;
    }
    case "discard":
      title = exact != null ? `Discard ${exact}` : "Discard cards";
      detail = source;
      break;
    case "materials": {
      title = "Select materials";
      const made = full.match(MATERIAL_KIND)?.[1];
      detail = made ? `${capital(made.toLowerCase())} material` : source;
      break;
    }
    case "target":
      title = input.max > 1 && !input.aiming && exact !== 1 ? "Choose targets" : "Choose a target";
      detail = source;
      break;
    case "position":
      title = "Choose a position";
      detail = full.match(POSITION_FOR)?.[1] ?? source;
      break;
    case "sum":
      title = "Select cards";
      detail = source;
      break;
    default: {
      // A hint that is not a "Select ... card(s)" sentence is already a short label: keep it whole.
      if (!/^select\b/i.test(full)) {
        title = full || "Select cards";
        detail = source;
        break;
      }
      title = exact === 1 ? "Select a card" : exact != null ? `Select ${exact} cards` : "Select cards";
      const purpose = full.match(PURPOSE)?.[1];
      detail = purpose ? capital(purpose) : source;
    }
  }

  const progress = progressLine(input, kind);
  const description = input.description?.trim();
  return {
    kind,
    title,
    detail,
    progress,
    sub: detail ? `${detail} · ${progress}` : progress,
    full,
    tooltip: [full, description].filter(Boolean).join("\n"),
  };
}
