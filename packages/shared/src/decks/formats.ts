/** Pure deck text formats. Passcodes, copies, artwork ids and section order are retained. */
export type DeckSections = { main: number[]; extra: number[]; side: number[]; deckMaster?: number | null };
export type FormatIssue = { code: string; message: string; line?: number };

const sections = ["main", "extra", "side"] as const;
const validCode = (code: number): boolean => Number.isInteger(code) && code > 0 && code <= 0xffffffff;
const emptyDeck = (): DeckSections => ({ main: [], extra: [], side: [] });

/** YDKE has no Deck Master field. Ignore deckMaster; do not move it into Side. */
export function encodeYdke(deck: DeckSections): string {
  const parts = sections.map(section => {
    const bytes = new Uint8Array(deck[section].length * 4);
    const view = new DataView(bytes.buffer);
    deck[section].forEach((code, index) => {
      if (!validCode(code)) throw new Error(`Invalid ${section} passcode: ${code}`);
      view.setUint32(index * 4, code, true);
    });
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  });
  return `ydke://${parts.join("!")}!`;
}

/** Strict framing; padding may be omitted and the URL-safe alphabet is accepted. */
export function decodeYdke(uri: string): { deck: DeckSections } | { error: FormatIssue } {
  const fail = (code: string, message: string) => ({ error: { code, message } });
  const text = uri.trim();
  if (!/^ydke:\/\//i.test(text)) return fail("invalid_ydke", "Expected a ydke:// code.");
  const parts = text.slice(7).split("!");
  if (parts.length !== 4 || parts[3] !== "") {
    return fail("invalid_separators", "YDKE must contain three sections and a final !, with no trailing data.");
  }
  const deck = emptyDeck();
  for (const [index, section] of sections.entries()) {
    const part = parts[index];
    if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(part)) return fail("invalid_base64", `Invalid Base64 in ${section}.`);
    const standard = part.replace(/-/g, "+").replace(/_/g, "/");
    const unpadded = standard.replace(/=+$/, "");
    if (unpadded.length % 4 === 1) return fail("invalid_base64", `Invalid Base64 length in ${section}.`);
    const padded = unpadded + "=".repeat((4 - unpadded.length % 4) % 4);
    if (standard.includes("=") && standard !== padded) return fail("invalid_base64", `Invalid Base64 padding in ${section}.`);
    let binary: string;
    try {
      binary = atob(padded);
      if (btoa(binary) !== padded) return fail("invalid_base64", `Invalid Base64 unused bits in ${section}.`);
    } catch {
      return fail("invalid_base64", `Invalid Base64 in ${section}.`);
    }
    if (binary.length % 4 !== 0) return fail("partial_uint32", `Incomplete four-byte passcode in ${section}.`);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    const view = new DataView(bytes.buffer);
    for (let at = 0; at < bytes.length; at += 4) {
      const code = view.getUint32(at, true);
      if (code === 0) return fail("invalid_passcode", `Passcode zero in ${section} at card ${at / 4 + 1}.`);
      deck[section].push(code);
    }
  }
  return { deck };
}

/** Exact headers, comments, CRLF and BOM. Diagnostics use one-based source lines. */
export function parseYdk(text: string): { deck: DeckSections; issues: FormatIssue[] } {
  const deck = emptyDeck();
  const issues: FormatIssue[] = [];
  let section: typeof sections[number] | "deckmaster" | null = null;
  let masterLine: number | undefined;
  let masterCards = 0;
  let sawHeader = false;
  const issue = (code: string, message: string, line?: number) => issues.push({ code, message, ...(line === undefined ? {} : { line }) });
  const finishMaster = () => {
    if (section === "deckmaster" && masterCards !== 1) {
      issue("invalid_deck_master", "#deckmaster must contain exactly one valid passcode.", masterLine);
    }
  };
  text.split(/\r\n|\n|\r/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    const header = line.toLowerCase();
    if (["#main", "#extra", "!side", "#deckmaster"].includes(header)) {
      finishMaster();
      sawHeader = true;
      section = header.slice(1) as typeof section;
      if (section === "deckmaster") {
        if (masterLine !== undefined) issue("invalid_deck_master", "YDK contains multiple #deckmaster sections.", index + 1);
        masterLine = index + 1;
        masterCards = 0;
      }
      return;
    }
    if (line.startsWith("#") || line.startsWith("!")) return;
    const code = Number(line);
    if (!/^\d{1,10}$/.test(line) || !validCode(code)) {
      issue("invalid_passcode", `Invalid card passcode: ${line}`, index + 1);
      return;
    }
    if (section === null) {
      issue("missing_section", "Card passcodes must follow a YDK section header.", index + 1);
    } else if (section === "deckmaster") {
      masterCards++;
      if (deck.deckMaster == null) deck.deckMaster = code;
    } else {
      deck[section].push(code);
    }
  });
  finishMaster();
  if (!sawHeader && issues.length === 0) issue("invalid_ydk", "No YDK sections found.");
  return { deck, issues };
}

/** The saved-deck YDK layout, including the optional #deckmaster extension. */
export function serializeYdk(deck: DeckSections): string {
  const lines = ["#main", ...deck.main.map(String), "#extra", ...deck.extra.map(String), "!side", ...deck.side.map(String), ""];
  if (deck.deckMaster != null) lines.unshift("#deckmaster", String(deck.deckMaster));
  return lines.join("\n");
}

export function splitImportText(text: string, sourceName?: string): Array<{ name: string; text: string; kind: "ydk" | "ydke" }> {
  const lines = text.split(/\r\n|\n|\r/).map(line => line.trim()).filter(Boolean);
  if (lines.some(line => /^ydke:\/\//i.test(line))) {
    return lines.map((line, index) => ({ name: `Imported deck ${index + 1}`, text: line, kind: "ydke" }));
  }
  const name = (sourceName ?? "Untitled deck").split(/[\\/]/).pop()!
    .replace(/\.(ydk|ydke|txt)$/i, "").replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/_+/g, " ").replace(/\s+/g, " ").trim().slice(0, 100) || "Untitled deck";
  return [{ name, text, kind: "ydk" }];
}
