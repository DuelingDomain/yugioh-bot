import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import opentype from "opentype.js";

const assets = new URL("../../../assets/welcome/", import.meta.url);
const fontFiles = ["chakra-petch-500-latin.ttf", "chakra-petch-700-latin.ttf", "russo-one-400-latin.ttf"]
  .map(name => fileURLToPath(new URL(`fonts/${name}`, assets)));
let resources: { template: string; nameFont: opentype.Font } | undefined;
function loadResources() {
  return resources ??= { template: readFileSync(new URL("first-pull.svg", assets), "utf8"), nameFont: opentype.loadSync(fontFiles[2]) };
}
const xml = (text: string) => text.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);

function fitName(input: string, font: opentype.Font) {
  // The bundled Latin subset intentionally excludes emoji and unsupported scripts.
  // Decompose accents first so otherwise readable names retain their base letters.
  const clean = [...input.slice(0, 512).normalize("NFKD")
    .replace(/\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u200d\ufe0e\ufe0f\u20e3]|[\p{M}\p{C}]/gu, "")]
    .filter(char => font.charToGlyphIndex(char) !== 0).join("").replace(/\s+/g, " ").trim() || "Duelist";
  const measure = (text: string, size: number) => font.getAdvanceWidth(text, size, { kerning: true });
  const size = Math.max(28, Math.min(66, Math.floor(66 * 520 / Math.max(1, measure(clean, 66)))));
  let text = clean;
  if (measure(text, size) > 520) {
    const chars = [...text];
    do { chars.pop(); text = `${chars.join("").trimEnd()}…`; } while (chars.length && measure(text, size) > 520);
  }
  return { text, size };
}

const AVATAR_LIMIT = 512 * 1024;
async function avatarData(url: string, signal?: AbortSignal): Promise<string | undefined> {
  try {
    const response = await fetch(url, { signal: AbortSignal.any([AbortSignal.timeout(2500), ...(signal ? [signal] : [])]), redirect: "error" });
    if (!response.ok) { await response.body?.cancel(); return; }
    if (!response.body) return;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      if (Number(response.headers.get("content-length")) > AVATAR_LIMIT) return;
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > AVATAR_LIMIT) return;
        chunks.push(next.value);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const bytes = Buffer.concat(chunks);
    if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return;
    // Bound the decoded bitmap too, even if the PNG compresses extremely well.
    if (![bytes.readUInt32BE(16), bytes.readUInt32BE(20)].every(value => value > 0 && value <= 1024)) return;
    return `data:image/png;base64,${bytes.toString("base64")}`;
  } catch { return; }
}

export interface WelcomeCardInput { displayName: string; number: number; avatarUrl: string; signal?: AbortSignal }
function renderIsolated(svg: string, fallbackSvg: string, avatar: string | undefined, signal?: AbortSignal): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("render.cjs", assets), {
      workerData: { svg, fallbackSvg, avatar, fontFiles },
      // Do not inherit application instrumentation or development loader flags.
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 32 },
    });
    let png: Buffer | undefined;
    let failure: unknown;
    const abort = () => { void worker.terminate(); };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    worker.once("message", (bytes: Uint8Array) => { png = Buffer.from(bytes); });
    worker.once("error", error => { failure = error; });
    // Wait for exit, so all native bitmaps are released before the next render.
    worker.once("exit", code => {
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) reject(signal.reason);
      else if (failure) reject(failure);
      else if (code !== 0 || !png) reject(new Error("Welcome render worker failed"));
      else resolve(png);
    });
  });
}

let queue: Promise<unknown> = Promise.resolve();
/** One native render/download at a time, shared by joins and owner previews. */
export function renderWelcomeCard(input: WelcomeCardInput): Promise<Buffer> {
  const task = queue.then(async () => {
    input.signal?.throwIfAborted();
    const { template, nameFont } = loadResources();
    const name = fitName(input.displayName, nameFont);
    const avatar = await avatarData(input.avatarUrl, input.signal);
    input.signal?.throwIfAborted();
    const initials = name.text.split(/[\s_]+/).map(word => [...word][0]).slice(0, 2).join("").toUpperCase();
    const image = `<image href="${xml(avatar ?? "")}" x="202" y="147.5" width="196" height="184" clip-path="url(#Bart)" preserveAspectRatio="xMidYMid slice"/>`;
    const placeholder = `<defs><linearGradient id="initials" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#5B4BA8"/><stop offset="1" stop-color="#1F2A4D"/></linearGradient></defs><g clip-path="url(#Bart)"><rect x="202" y="147.5" width="196" height="184" fill="url(#initials)"/><circle cx="355" cy="170" r="90" fill="#fff" opacity=".07"/><text x="300" y="267" text-anchor="middle" font-family="Russo One" font-size="68" fill="#E8ECF4">${xml(initials)}</text></g>`;
    const tokens: Record<string, string> = { AVATAR: avatar ? image : placeholder, NAME: xml(name.text), NAME_SIZE: String(name.size), NUMBER: String(input.number) };
    const svg = template.replace(/\{\{(AVATAR|NAME|NAME_SIZE|NUMBER)\}\}/g, (_, key: string) => tokens[key]);
    const fallbackSvg = template.replace(/\{\{(AVATAR|NAME|NAME_SIZE|NUMBER)\}\}/g, (_, key: string) => key === "AVATAR" ? placeholder : tokens[key]);
    return renderIsolated(svg, fallbackSvg, avatar, input.signal);
  });
  queue = task.catch(() => {});
  return task;
}
