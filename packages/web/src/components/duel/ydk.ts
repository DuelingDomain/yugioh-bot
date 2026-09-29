import type { DuelDeck } from "@yugidraft/shared/duels";

function parseCode(line: string): number | null {
  const code = Number(line);
  if (!Number.isInteger(code) || code <= 0) return null;
  return code;
}

export function parseYdk(text: string): DuelDeck {
  const main: number[] = [];
  const extra: number[] = [];
  const side: number[] = [];
  let section: "main" | "extra" | "side" | null = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const lower = line.toLowerCase();
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
    if (code == null || section == null) continue;
    if (section === "extra") extra.push(code);
    else if (section === "side") side.push(code);
    else main.push(code);
  }

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

export function applyDomainMaster(deck: DuelDeck, explicitMaster?: number): DuelDeck {
  if (deck.side.length > 1) {
    throw new Error("Domain has no Side Deck. Only a single Deck Master may be imported from the Side section.");
  }
  if (deck.side.length === 1) {
    const sideMaster = deck.side[0];
    if (explicitMaster == null || explicitMaster === sideMaster) {
      return { main: deck.main, extra: deck.extra, side: [], deckMaster: sideMaster };
    }
    return { main: deck.main, extra: deck.extra, side: [], deckMaster: explicitMaster };
  }
  return {
    main: deck.main,
    extra: deck.extra,
    side: [],
    deckMaster: explicitMaster ?? deck.deckMaster,
  };
}

export function serializeYdk(deck: DuelDeck): string {
  return [
    "#main",
    ...deck.main.map(String),
    "#extra",
    ...deck.extra.map(String),
    "!side",
    ...deck.side.map(String),
    "",
  ].join("\n");
}
