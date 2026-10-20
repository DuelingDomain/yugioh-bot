/** Free first-print release facts. This command never initializes an AI client. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { cleanReleaseMonth } from "@yugidraft/shared/cards/effects";
import { writeEffectArtifactCandidate } from "./artifact-output.js";

export const RELEASE_ENDPOINT = "https://db.ygoprodeck.com/api/v7/cardinfo.php?misc=yes";
const DATA = "packages/shared/data/effects", sha = (value: string) => createHash("sha256").update(value).digest("hex");
export interface ReleaseRow { id: number; name: string; aliases: number[]; tcgDate: string | null; ocgDate: string | null; quality: string }
interface ApiSet { set_name: string; set_code?: string; tcg_date?: string }
interface ApiCard { id: number; name: string; card_sets?: { set_name: string; set_code?: string }[]; card_images?: { id: number }[]; misc_info?: { tcg_date?: string; ocg_date?: string; beta_name?: string; beta_id?: number }[] }
export interface ReleaseCorrection { id: number; region: "tcg" | "ocg"; previous: string; month: string; sourceMonth?: string; firstSetMonth?: string }
interface Bulk { endpoint: string; fetchedAt: number; sourceSha256: string; cards: ApiCard[]; sets: ApiSet[] }
interface Options { root: string; outputDirectory: string; cacheDirectory: string; baseSha: string; endpoint?: string; backoffMs?: number; timeoutMs?: number }
const validId = (id: number) => Number.isSafeInteger(id) && id > 0 && id <= 0xffffffff;
const validBulk = (value: Bulk, endpoint: string): boolean => value.endpoint === endpoint && Number.isFinite(value.fetchedAt) && /^[a-f0-9]{64}$/.test(value.sourceSha256) &&
  Array.isArray(value.sets) && value.sets.every(set => typeof set.set_name === "string") && Array.isArray(value.cards) && value.cards.length > 0 && value.cards.every(card => validId(card.id) && typeof card.name === "string" && !!card.name &&
    (card.misc_info === undefined || Array.isArray(card.misc_info)) && (card.card_images === undefined || (Array.isArray(card.card_images) && card.card_images.every(image => validId(image.id)))));

async function bulk(options: Options): Promise<Bulk> {
  const endpoint = options.endpoint ?? RELEASE_ENDPOINT, cache = join(options.cacheDirectory, "ygoprodeck-releases.json");
  try {
    const cached = JSON.parse(readFileSync(cache, "utf8")) as Bulk;
    if (validBulk(cached, endpoint) && Date.now() >= cached.fetchedAt && Date.now() - cached.fetchedAt < 86_400_000) return cached;
  } catch { /* Missing or invalid cache: fetch one bulk response. */ }
  let failure: unknown, delay = options.backoffMs ?? 1_000;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise(resolve => setTimeout(resolve, delay));
    try {
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(options.timeoutMs ?? 30_000) });
      if (!response.ok) {
        const retry = response.headers.get("retry-after");
        const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : retry ? (Date.parse(retry) - Date.now()) / 1_000 : 0;
        delay = Math.max(delay, Math.min(60_000, Math.max(0, seconds) * 1_000) || 0);
        await response.body?.cancel();
        throw new Error(`YGOPRODeck HTTP ${response.status}`);
      }
      const text = await response.text();
      const setResponse = await fetch(new URL("cardsets.php", endpoint), { signal: AbortSignal.timeout(options.timeoutMs ?? 30_000) });
      if (!setResponse.ok) throw new Error(`YGOPRODeck set HTTP ${setResponse.status}`);
      const setText = await setResponse.text();
      const value: Bulk = { endpoint, fetchedAt: Date.now(), sourceSha256: sha(text + "\n" + setText), cards: JSON.parse(text).data, sets: JSON.parse(setText) };
      if (!validBulk(value, endpoint)) throw new Error("Invalid YGOPRODeck bulk response");
      mkdirSync(options.cacheDirectory, { recursive: true });
      writeFileSync(cache + ".tmp", JSON.stringify(value)); renameSync(cache + ".tmp", cache);
      return value;
    } catch (error) { failure = error; delay = Math.min(60_000, Math.max(delay, (options.backoffMs ?? 1_000) * 2 ** attempt)); }
  }
  throw failure;
}

function fill(rows: ReleaseRow[], cards: ApiCard[], sets: ApiSet[]) {
  const setDates = new Map(sets.map(set => [set.set_name, cleanReleaseMonth(set.tcg_date, "tcg")]));
  const corrections: ReleaseCorrection[] = [], flags: { id: number; region: string; sourceMonth?: string; storedMonth?: string; firstSetMonth: string }[] = [];
  const byId = new Map(rows.map(row => [row.id, row])), families = new Map<number, ReleaseRow>(), names = new Map<string, ReleaseRow | null>();
  for (const row of rows) {
    for (const id of [row.id, ...row.aliases]) families.set(id, byId.get(id) ?? row);
    names.set(row.name, names.has(row.name) ? null : row);
  }
  const filled = new Set<number>();
  let filledMonths = 0, newRecords = 0;
  for (const card of cards) {
    const ids = [card.id, ...(card.card_images ?? []).map(image => image.id), ...(card.misc_info ?? []).flatMap(info => validId(info.beta_id ?? 0) ? [info.beta_id!] : [])];
    const info = card.misc_info ?? [];
    const family = byId.get(card.id) ?? ids.map(id => families.get(id)).find(Boolean) ?? names.get(card.name) ?? info.map(value => names.get(value.beta_name ?? "")).find(Boolean);
    const month = (region: "tcg" | "ocg") => info.map(value => cleanReleaseMonth(region === "tcg" ? value.tcg_date : value.ocg_date, region)).filter((value): value is string => !!value).sort()[0];
    const sourceTcg = month("tcg"), ocg = month("ocg");
    // The set endpoint dates TCG sets. Never assign those months to the OCG.
    const firstSetMonth = (card.card_sets ?? []).filter(set => !set.set_code || /-(?:EN|E|NA|EU|AE|SP|FR|DE|IT|PT)\d/i.test(set.set_code)).map(set => setDates.get(set.set_name)).filter((value): value is string => !!value).sort()[0];
    const tcg = [sourceTcg, firstSetMonth].filter((value): value is string => !!value).sort()[0];
    if (firstSetMonth && ((sourceTcg && sourceTcg > firstSetMonth) || (family?.tcgDate && family.tcgDate > firstSetMonth))) flags.push({ id: family?.id ?? card.id, region: "tcg", sourceMonth: sourceTcg, storedMonth: family?.tcgDate ?? undefined, firstSetMonth });
    if (!tcg && !ocg) continue;
    const row = family ?? { id: card.id, name: card.name, aliases: [...new Set(ids.filter(id => id !== card.id))], tcgDate: null, ocgDate: null, quality: "ok" };
    let changed = false;
    for (const [key, region, value] of [["tcgDate", "tcg", tcg], ["ocgDate", "ocg", ocg]] as const) {
      const previous = cleanReleaseMonth(row[key], region);
      if (value && (!previous || value < previous)) {
        if (previous) corrections.push({ id: row.id, region, previous, month: value, sourceMonth: month(region), ...(region === "tcg" && firstSetMonth ? { firstSetMonth } : {}) });
        row[key] = value; filledMonths++; changed = true;
      }
    }
    if (changed) filled.add(row.id);
    if (!family) {
      rows.push(row); byId.set(row.id, row); newRecords++;
      for (const id of ids) families.set(id, row);
      names.set(row.name, row);
    }
  }
  return { rows, corrections, flags, filledCards: filled.size, filledMonths, newRecords,
    newest: rows.filter(row => filled.has(row.id)).sort((a, b) => ([b.tcgDate, b.ocgDate].filter(Boolean).sort().at(-1) ?? "").localeCompare([a.tcgDate, a.ocgDate].filter(Boolean).sort().at(-1) ?? "") || a.id - b.id).slice(0, 10) };
}

/** Stage a complete candidate before replacing any tag output. Failure leaves tags usable. */
export async function refreshReleaseCandidate(options: Options) {
  let stage: string | undefined;
  try {
    const source = await bulk(options);
    const rows = JSON.parse(gunzipSync(readFileSync(join(options.root, DATA, "releases.json.gz"))).toString()) as ReleaseRow[];
    const result = fill(rows, source.cards, source.sets);
    if (!result.filledCards) return { status: "unchanged", filledCards: 0, filledMonths: 0, newRecords: 0, newest: [], corrections: [], flags: result.flags };
    const reportPath = join(options.outputDirectory, "report.json");
    const report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, "utf8")) : { mode: "release-only", accepted: [], acceptedProfiles: [] };
    stage = mkdtempSync(join(tmpdir(), "effect-release-fill-"));
    const candidate = writeEffectArtifactCandidate({ ...options, outputDirectory: stage, accepted: report.accepted ?? [], acceptedProfiles: report.acceptedProfiles ?? [],
      releases: { rows: result.rows, sourceSha256: source.sourceSha256 } });
    report.releaseCorrections = result.corrections;
    report.releaseFlags = result.flags;
    // Publication permits only additions or evidenced earlier first prints.
    const publisherPath = "../ci/publish-effect-tags.mjs";
    const { validateEffectCandidate } = await import(publisherPath);
    writeFileSync(join(stage, "report.json"), JSON.stringify(report));
    validateEffectCandidate(options.root, stage);
    mkdirSync(options.outputDirectory, { recursive: true });
    for (const file of [...candidate.files, `${DATA}/popularity.json.gz`]) {
      mkdirSync(dirname(join(options.outputDirectory, file)), { recursive: true });
      copyFileSync(join(stage, file), join(options.outputDirectory, file));
    }
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
    copyFileSync(join(stage, "update.json"), join(options.outputDirectory, "update.json"));
    const { rows: _rows, ...counts } = result;
    const summary = { status: "updated", ...counts };
    writeFileSync(join(options.outputDirectory, "releases-report.json"), JSON.stringify(summary, null, 2) + "\n");
    const reportMd = join(options.outputDirectory, "report.md");
    const previous = existsSync(reportMd) ? readFileSync(reportMd, "utf8") : "Effect release update.\n";
    writeFileSync(reportMd, previous + `\nRelease months: ${result.filledCards} cards, ${result.filledMonths} months, ${result.newRecords} new IDs. No paid release calls.\n`);
    return summary;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`Release step skipped: ${reason}`);
    return { status: "skipped", reason, filledCards: 0, filledMonths: 0, newRecords: 0, newest: [], corrections: [], flags: [] };
  } finally { if (stage) rmSync(stage, { recursive: true, force: true }); }
}

async function main() {
  const { values } = parseArgs({ options: { apply: { type: "boolean", default: false }, output: { type: "string" }, cache: { type: "string" } } });
  const root = process.cwd(), outputDirectory = resolve(values.output ?? ".status/effect-releases");
  const result = await refreshReleaseCandidate({ root, outputDirectory, cacheDirectory: resolve(values.cache ?? ".status/ygoprodeck-cache"),
    baseSha: process.env.EFFECT_BASE_SHA ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() });
  if (values.apply && result.status === "updated") {
    const publisherPath = "../ci/publish-effect-tags.mjs";
    const { validateEffectCandidate } = await import(publisherPath);
    const candidate = validateEffectCandidate(root, outputDirectory);
    for (const file of candidate.files) copyFileSync(join(outputDirectory, file), join(root, file));
  }
  console.log(JSON.stringify(result, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.warn(`Release step skipped: ${error.message}`); });
