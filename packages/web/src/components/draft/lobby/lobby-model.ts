/**
 * Pure helpers for the draft lobby (board b22): why Start is disabled, what Start says it will do,
 * and the setup rows. Kept free of React so the rules can be tested on their own.
 */

import { formatPickSeconds } from "../pick-time";

export interface LobbyConfig {
  mode?: "booster" | "theme";
  cardsPerPlayer?: number;
  packSize?: number;
  packsPerPlayer?: number;
  pickSeconds?: number;
  alternatePassDirection?: boolean;
  randomizeSeats?: boolean;
  copyLimit?: boolean;
  themeSelection?: "host_assigned" | "random" | "player_pick";
  uniqueThemes?: boolean;
  themePackSize?: number;
  extraDeckEnabled?: boolean;
  extraDeckSize?: number;
  burnUnpicked?: boolean;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The reason Start can't be pressed, or null when it can. Mirrors what the server would reject. */
export function startBlocker(args: {
  playerCount: number;
  isTheme: boolean;
  themeCount: number;
  uniqueThemes: boolean;
}): string | null {
  const { playerCount, isTheme, themeCount, uniqueThemes } = args;
  if (playerCount < 2) return `Need ${plural(2 - playerCount, "more player")} to start.`;
  if (isTheme && themeCount === 0) return "Add a theme first.";
  if (isTheme && uniqueThemes && themeCount < playerCount) {
    const missing = playerCount - themeCount;
    return `Add ${plural(missing, "more theme")}. Each of the ${playerCount} players needs their own.`;
  }
  return null;
}

export function themeExtraOn(config: LobbyConfig): boolean {
  return config.extraDeckEnabled ?? true;
}

export function packsOf(config: LobbyConfig): number {
  const cards = config.cardsPerPlayer ?? 40;
  const size = config.packSize ?? 15;
  return config.packsPerPlayer ?? Math.max(1, Math.ceil(cards / Math.max(1, size)));
}

/** The sentence under Start, as plain parts so the component can bold the key figure. */
export function startSummary(config: LobbyConfig, playerCount: number): { before: string; strong: string; after: string } {
  if (config.mode === "theme") {
    const main = config.cardsPerPlayer ?? 40;
    const extra = themeExtraOn(config) ? config.extraDeckSize ?? 15 : 0;
    const gives =
      config.themeSelection === "random"
        ? `Gives each of the ${playerCount} players a random theme. Everyone then drafts `
        : config.themeSelection === "host_assigned"
          ? `Gives each of the ${playerCount} players the theme the host set for them. Everyone then drafts `
          : `Gives each of the ${playerCount} players a theme. Anyone without one gets one at random. Everyone then drafts `;
    return {
      before: gives,
      strong: extra > 0 ? `${main} main deck and ${extra} Extra deck cards` : `${main} main deck cards`,
      after: ". Nobody can join after this.",
    };
  }
  // Drafts made before seat shuffling have no randomizeSeats, and the server seats them in join order.
  const shuffled = config.randomizeSeats === true ? " Seats are shuffled." : "";
  return {
    before: "Deals ",
    strong: `${plural(packsOf(config), "pack")} of ${config.packSize ?? 15}`,
    after: ` to each of the ${playerCount} players.${shuffled} Nobody can join after this.`,
  };
}

export interface SetupRow {
  label: string;
  value: string;
}

export function setupRows(config: LobbyConfig): SetupRow[] {
  const seconds = config.pickSeconds ? formatPickSeconds(config.pickSeconds) : "—";
  if (config.mode === "theme") {
    const unique = config.uniqueThemes ?? true;
    const selection = config.themeSelection ?? "player_pick";
    const themes =
      selection === "random"
        ? unique ? "Random, all different" : "Random"
        : selection === "host_assigned"
          ? "Host assigns"
          : unique ? "Players pick, all different" : "Players pick";
    return [
      { label: "Themes", value: themes },
      { label: "Main deck", value: `${config.cardsPerPlayer ?? 40} picks` },
      { label: "Extra deck", value: themeExtraOn(config) ? `${config.extraDeckSize ?? 15} picks` : "Off" },
      { label: "Each pick", value: `${config.themePackSize ?? 3} choices` },
      { label: "Pick duration", value: seconds },
      { label: "Copy limit", value: config.copyLimit === false ? "Off" : "3 per card" },
      { label: "Passed cards", value: config.burnUnpicked ? "Burned" : "Can come back" },
    ];
  }
  const rows: SetupRow[] = [
    { label: "Each player", value: `${config.cardsPerPlayer ?? 40} cards` },
    { label: "Packs", value: `${plural(packsOf(config), "pack")} of ${config.packSize ?? "—"}` },
    { label: "Pick duration", value: seconds },
  ];
  if (config.alternatePassDirection) rows.push({ label: "Passing", value: "Left, then right" });
  rows.push({ label: "Copy limit", value: config.copyLimit === false ? "Off" : "3 per card" });
  rows.push({ label: "Seats", value: config.randomizeSeats === true ? "Shuffled at the start" : "In join order" });
  return rows;
}

export function initialOf(name: string): string {
  const ch = Array.from(name.trim())[0];
  return ch ? ch.toUpperCase() : "?";
}

/** Splits a preflight line ("Despia: 38 main ...") into its cube name and the rest. */
export function splitPreflight(message: string, cubeNames: string[]): { name: string | null; rest: string } {
  for (const name of cubeNames) {
    if (message.startsWith(`${name}:`)) return { name, rest: message.slice(name.length + 1).trim() };
  }
  const m = /^([^:]{1,80}):\s+(.*)$/s.exec(message);
  return m ? { name: m[1], rest: m[2] } : { name: null, rest: message };
}

export interface PreflightIssue {
  name: string | null;
  shortfall: { kind: "main" | "extra"; have: number; need: number } | null;
  raw: string;
}

/** Keep unknown server messages intact so new preflight checks remain visible. */
export function parsePreflight(message: string, cubeNames: string[]): PreflightIssue {
  const { name, rest } = splitPreflight(message, cubeNames);
  const main = /^Main pool has (\d+) cards? but needs at least (\d+)/.exec(rest);
  const extra = /^Extra pool has (\d+) cards? but needs (\d+)/.exec(rest);
  const match = main ?? extra;
  return {
    name,
    shortfall: name && match ? { kind: main ? "main" : "extra", have: Number(match[1]), need: Number(match[2]) } : null,
    raw: message,
  };
}

export function mainShortfallSummary(names: string[]): string | null {
  if (names.length === 0) return null;
  const joined = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${joined} can't be drafted yet. ${names.length === 1 ? "Its main pool is" : "Their main pools are"} too small.`;
}

export function mainShortfallFix(count: number): string {
  return count > 1
    ? "Add cards to those cubes, or remove those themes."
    : "Add cards to the cube, or remove the theme.";
}

export function extraShortfallSummary(count: number): string | null {
  if (count === 0) return null;
  return `${plural(count, "theme")} may run short on Extra deck cards, so ${count === 1 ? "that player" : "those players"} could end with fewer. You can start anyway.`;
}
