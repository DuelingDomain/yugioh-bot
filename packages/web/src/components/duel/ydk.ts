import type { DuelDeck } from "@yugidraft/shared/duels";

/** A passcode is 1 to 10 plain digits: no hex, exponent, sign or decimal point. */
function parseCode(line: string): number | null {
  if (!/^\d{1,10}$/.test(line)) return null;
  const code = Number(line);
  return code > 0 ? code : null;
}

export interface DeckMasterSelection {
  deck: DuelDeck;
  masterOrigin: { section: "main" | "extra" | "side"; index: number } | null;
}

export function parseYdk(text: string): DuelDeck {
  const main: number[] = [];
  const extra: number[] = [];
  const side: number[] = [];
  let deckMaster: number | undefined;
  let section: "main" | "extra" | "side" | "deckmaster" | null = null;
  let sawDeckMaster = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const lower = line.toLowerCase();
    if (lower === "#deckmaster" || lower.startsWith("#deckmaster")) {
      if (sawDeckMaster) {
        throw new Error("YDK contains multiple #deckmaster sections.");
      }
      sawDeckMaster = true;
      section = "deckmaster";
      continue;
    }
    if (lower === "#main" || lower.startsWith("#main")) {
      section = "main";
      continue;
    }
    if (lower === "#extra" || lower.startsWith("#extra")) {
      section = "extra";
      continue;
    }
    if (lower === "!side" || lower.startsWith("!side")) {
      section = "side";
      continue;
    }
    if (line.startsWith("#") || line.startsWith("!")) continue;
    const code = parseCode(line);
    if (section === "deckmaster") {
      if (code == null) {
        throw new Error("Invalid Deck Master id in #deckmaster.");
      }
      if (deckMaster != null) {
        throw new Error("YDK #deckmaster must contain exactly one card id.");
      }
      deckMaster = code;
      continue;
    }
    if (code == null || section == null) continue;
    if (section === "extra") extra.push(code);
    else if (section === "side") side.push(code);
    else main.push(code);
  }

  if (deckMaster != null) return { main, extra, side, deckMaster };
  return { main, extra, side };
}

function decodeYdkeList(part: string): number[] {
  if (!part) return [];
  const binary = atob(part);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const codes: number[] = [];
  const view = new DataView(bytes.buffer);
  for (let offset = 0; offset + 4 <= bytes.byteLength; offset += 4) {
    const code = view.getUint32(offset, true);
    if (code > 0) codes.push(code);
  }
  return codes;
}

export function parseYdke(text: string): DuelDeck {
  const payload = text.trim().replace(/^ydke:\/\//i, "");
  const [mainPart = "", extraPart = "", sidePart = ""] = payload.split("!");
  return {
    main: decodeYdkeList(mainPart),
    extra: decodeYdkeList(extraPart),
    side: decodeYdkeList(sidePart),
  };
}

export function parseDeckText(text: string): DuelDeck {
  const trimmed = text.trim();
  if (trimmed.toLowerCase().startsWith("ydke://")) return parseYdke(trimmed);
  return parseYdk(trimmed);
}

export function applyDomainMaster(deck: DuelDeck): DuelDeck {
  if (deck.deckMaster != null) return deck;
  if (deck.side.length > 1) {
    throw new Error("Domain has no Side Deck. Only a single Deck Master may be imported from the Side section.");
  }
  if (deck.side.length === 1) {
    return { main: deck.main, extra: deck.extra, side: [], deckMaster: deck.side[0] };
  }
  return deck;
}

export function selectDomainMaster(state: DeckMasterSelection, code?: number): DeckMasterSelection {
  if (code !== undefined && code === state.deck.deckMaster) return state;

  let restored: DuelDeck;
  if (state.deck.deckMaster != null && state.masterOrigin != null) {
    const { section, index } = state.masterOrigin;
    const next = state.deck[section].slice();
    next.splice(Math.min(Math.max(0, index), next.length), 0, state.deck.deckMaster);
    restored = { main: state.deck.main, extra: state.deck.extra, side: state.deck.side, [section]: next };
  } else if (state.deck.deckMaster !== undefined) {
    restored = { main: state.deck.main, extra: state.deck.extra, side: state.deck.side };
  } else {
    restored = state.deck;
  }

  if (code === undefined) return { deck: restored, masterOrigin: null };

  for (const section of ["main", "extra", "side"] as const) {
    const index = restored[section].indexOf(code);
    if (index < 0) continue;
    const next = restored[section].slice();
    next.splice(index, 1);
    return {
      deck: { ...restored, [section]: next, deckMaster: code },
      masterOrigin: { section, index },
    };
  }

  return { deck: { ...restored, deckMaster: code }, masterOrigin: null };
}

export function serializeYdk(deck: DuelDeck): string {
  const lines = [
    "#main",
    ...deck.main.map(String),
    "#extra",
    ...deck.extra.map(String),
    "!side",
    ...deck.side.map(String),
    "",
  ];
  if (deck.deckMaster != null) lines.unshift("#deckmaster", String(deck.deckMaster));
  return lines.join("\n");
}
