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
  /** Running sum, only when every selected card has one engine contribution. */
  total?: number;
  /** Sum pick target. */
  target?: number;
  sumMode?: DuelPrompt["sumMode"];
  /** Whether any combination of alternative engine contributions meets the sum. */
  sumMet?: boolean;
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
  /** The ask part of the progress: "Pick 2". Empty when the progress is only a count. */
  instruction: string;
  /** The count part of the progress, shown as a chip: "1/2 selected". Null when the progress has none. */
  counter: string | null;
  /** Numeric requirement state, separate from whether the engine offers Finish. */
  met: boolean | null;
  /** Cards still to pick before Confirm works ("Select 1 more"), or null when that is not a plain card count. */
  remaining: number | null;
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

/** Engine contributions may differ from printed Levels, or offer alternative Levels. */
export function sumSelectionValues(prompt: DuelPrompt, selected: readonly string[]): Pick<BarCopyInput, "values" | "total" | "sumMet"> {
  const contributions = selected.map((id) => prompt.options.find((option) => option.id === id)?.values ?? []);
  return {
    values: contributions.map((values) => values.length > 1 ? `(${values.join("/")})` : values[0]?.toString() ?? "?").join(" + "),
    total: contributions.every((values) => values.length === 1)
      ? contributions.reduce((sum, values) => sum + values[0], 0)
      : undefined,
    sumMet: prompt.target != null ? sumValuesMet(contributions, prompt.target, prompt.sumMode) : undefined,
  };
}

function sumValuesMet(contributions: number[][], target: number, mode: DuelPrompt["sumMode"]): boolean {
  if (mode === "at-least") return minimalSumMet(contributions, target);
  // Each card contributes exactly one of its engine values. Capping at the target bounds the search.
  let totals = new Set([0]);
  for (const values of contributions) {
    const next = new Set<number>();
    for (const total of totals) {
      for (const value of values) {
        const sum = total + value;
        if (sum <= target) next.add(sum);
      }
    }
    totals = next;
  }
  return totals.has(target);
}

/**
 * The core's check for an "at least" sum (playerop.cpp, SELECT_SUM with select_max), over required and chosen
 * cards alike: the highest values reach the target, and the lowest values minus the smallest one do not.
 */
function minimalSumMet(contributions: number[][], target: number): boolean {
  if (contributions.length === 0) return false;
  let highest = 0;
  let lowest = 0;
  let smallest = Infinity;
  for (const values of contributions) {
    const real = values.filter((value) => value > 0);
    const low = real.length ? Math.min(...real) : 0;
    highest += values.length ? Math.max(...values) : 0;
    lowest += low;
    smallest = Math.min(smallest, low);
  }
  return highest >= target && lowest - smallest < target;
}

export function synchroSelectionValues(prompt: DuelPrompt): Pick<BarCopyInput, "total"> {
  const selected = prompt.options.filter((option) => option.selected);
  // Without the engine's contribution a total would be wrong; the counter falls back to the selected count.
  if (selected.some((option) => option.synchroLevelVaries)) return { total: undefined };
  const levels = selected.map((option) => option.currentLevel ?? option.card?.level);
  return { total: levels.every((level) => level != null) ? levels.reduce<number>((sum, level) => sum + level!, 0) : undefined };
}

function synchroMaterials(input: BarCopyInput): boolean {
  return (input.kind === "sum" || input.kind === "toggle") && /\bsynchro material\b/i.test(input.title);
}

function oneAtATime(input: BarCopyInput): boolean {
  // 1/1 bounds a SelectUnselect step. Fixed multi-card script bounds still supply a total.
  return input.kind === "toggle" && !input.openEnded && input.min === 1 && input.max === 1;
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

function progressParts(input: BarCopyInput): { instruction: string; counter: string | null } {
  const { min, max, count, values, target } = input;
  if (input.aiming) return { instruction: "Point at a target, then confirm", counter: null };
  if (synchroMaterials(input)) {
    const running = input.total ?? (input.kind === "sum" ? values || "0" : undefined);
    return { instruction: "", counter: target != null && running != null
      ? `Level ${running} / ${target}` : `${count} selected` };
  }
  if (input.kind === "sum" && target != null) {
    // Ritual uses the generic Tribute hint; Synchro can also use SELECT_SUM for material Levels.
    const levels = /\b(?:level|synchro|ritual|tribute)\b/i.test(input.title);
    const running = values ? `${values}${input.total != null && count > 1 ? ` = ${input.total}` : ""}` : "0";
    return {
      instruction: `Total ${input.sumMode === "at-least" ? "at least " : ""}${target}`,
      counter: levels ? `Level total ${running}` : values || null,
    };
  }
  if (input.kind === "tribute") return { instruction: "", counter: `${count} selected` };
  if (input.kind === "order") return { instruction: "", counter: `${count} of ${max} ordered` };
  if (oneAtATime(input)) return { instruction: "", counter: `${count} selected` };
  if (!input.openEnded && min === max) {
    const steps = max > 1 || input.toggling || count > 0;
    return { instruction: `Pick ${max}`, counter: steps ? `${count}/${max} selected` : null };
  }
  if (min <= 0) return { instruction: `Pick up to ${max}`, counter: `${count} selected` };
  if (input.openEnded) return { instruction: `Pick ${min} or more`, counter: `${count} selected` };
  return { instruction: `Pick ${min} to ${max}`, counter: `${count} selected` };
}

/** Cards still needed to reach the minimum. Not for tribute (a value), sum, order or an aim: those have no plain count. */
function remainingCards(input: BarCopyInput): number | null {
  if (input.aiming || input.kind === "tribute" || input.kind === "sum" || input.kind === "order" || oneAtATime(input)) return null;
  const left = input.min - input.count;
  return left > 0 ? left : null;
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
      title = oneAtATime(input) ? "Choose a material" : "Select materials";
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

  const { instruction, counter } = progressParts(input);
  const progress = [instruction, counter].filter(Boolean).join(" · ");
  const description = input.description?.trim();
  return {
    kind,
    title,
    detail,
    progress,
    instruction,
    counter,
    met: (input.kind === "sum" || synchroMaterials(input)) && input.target != null
      ? input.sumMet ?? (input.total != null && (input.sumMode === "at-least" ? input.total >= input.target : input.total === input.target))
      : null,
    remaining: remainingCards(input),
    sub: detail ? `${detail} · ${progress}` : progress,
    full,
    tooltip: [full, description].filter(Boolean).join("\n"),
  };
}
