/** Bound GitHub-rendered copies; the artifact always retains the complete report. */
export function boundedReport(report: string, runUrl: string, maxBytes: number): string {
  if (Buffer.byteLength(report) <= maxBytes) return report;
  const warnings = report.match(/\n## Deployment\n[\s\S]*?(?=\n## |$)/)?.[0] ?? "";
  const golden = report.match(/\n## Golden hashes\n[\s\S]*?(?=\n## |$)/)?.[0] ?? "";
  const artwork = report.match(/\n## Artwork script safety\n[\s\S]*?(?=\n## |$)/)?.[0] ?? "";
  const footer = `\n\n_Report truncated. Full report: [run summary](${runUrl}#summary) and [engine-data-update-report artifact](${runUrl}#artifacts)._\n${warnings}${golden}${artwork}`;
  const bytes = Buffer.from(report);
  let end = maxBytes - Buffer.byteLength(footer);
  // Avoid cutting a UTF-8 character in half.
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--;
  return bytes.subarray(0, Math.max(0, end)).toString("utf8") + footer;
}

type Probe = { artworkScriptScanError?: string; artworkScriptFallbacks?: Array<{ passcode: number; main: number; requested?: number }>; errors: string[]; scriptsChecked: number; apiSymbolsChecked: number; globalsChecked: number; cardsChecked: number };
const safe = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/@|#(?=\d)/g, (match) => match === "@" ? "&#64;" : "&#35;").replace(/`/g, "\\`").replace(/[\r\n]+/g, " ");
export function withValidation(report: string, probe: Probe, overlayExit: number | "not run", overlayLog?: string): string {
  const section = ["## Core compatibility", "",
    "Best effort: installed **npm ocgcore-wasm@0.1.2**, the oldest live/default production Standard 1v1 core. Candidate constant.lua, utility.lua and changed Lua are loaded; generated assertions check Duel./Card./Effect./Group. names and uppercase globals. New/changed official cards are inserted into a deck to exercise initial_effect. Findings are advisory, not a compatibility guarantee or full effect playthrough.", "",
    `Checked ${probe.scriptsChecked} scripts, ${probe.apiSymbolsChecked} API names, ${probe.globalsChecked} globals and ${probe.cardsChecked} cards. Probe errors: ${probe.errors.length}.`, "",
    ...(probe.errors.length ? probe.errors.map((error) => `- ${safe(error)}`) : ["No probe errors found."]), "",
  ].join("\n");
  let result = report.replace(/probe errors [^,\n]+, overlay check exit [^\n]+/, `probe errors ${probe.errors.length}, overlay check exit ${overlayExit}`)
    .replace(/## Core compatibility\n[\s\S]*?(?=\n## |$)/, section);
  if (overlayLog !== undefined) {
    result += `\n## Overlay generator check\n\nExit code: ${overlayExit} (0 = passed; otherwise human review required).\n\n${overlayLog.split(/\r?\n/).map((line) => `    ${line}`).join("\n")}\n\nThis check does not replace stock-hash conflict review.\n`;
  }
  const fallbacks = probe.artworkScriptFallbacks ?? [];
  result += "\n## Artwork script safety\n\n";
  if (probe.artworkScriptScanError) {
    result = `BLOCKING: artwork script safety scan failed.\n${result}`;
    result += `BLOCKING: scan failed: ${safe(probe.artworkScriptScanError)}\n`;
  } else if (fallbacks.length) {
    const blocking = `BLOCKING: ${fallbacks.length} artwork script fallback(s).`;
    result = `${blocking}\n${result}`;
    result += `${blocking} The core keeps the alternate self_code, so GetID() differs from the main script's context. Supply and validate explicit artwork scripts before publishing this bundle.\n\n`;
    result += fallbacks.map(({ passcode, main, requested = passcode }) => `- c${requested}.lua → c${main}.lua${requested === passcode ? "" : ` (card ${passcode})`}`).join("\n") + "\n";
  } else result += "No artwork script fallbacks found.\n";
  return result;
}

type PreviewIdentity = { code: number; name: string; type: number };
/** Card-level review survives filename deletion and temporary-to-official ID changes. */
export function prereleaseUpdateReport(previous: PreviewIdentity[], next: {
  prerelease: PreviewIdentity[]; released: PreviewIdentity[]; remaps: Record<string, number>;
  drops: Array<PreviewIdentity & { file: string; reason: string; keptCode?: number }>;
}): string {
  const key = (card: PreviewIdentity) => `${card.name.trim().toLowerCase()}\0${card.type}`;
  const official = new Map(next.released.map(card => [key(card), card]));
  const oldIds = new Set(previous.map(card => card.code)), newIds = new Set(next.prerelease.map(card => card.code));
  const added = next.prerelease.filter(card => !oldIds.has(card.code));
  const gone = previous.filter(card => !newIds.has(card.code));
  const graduated = gone.filter(card => official.has(key(card)));
  const removed = gone.filter(card => !official.has(key(card)));
  const lines = (cards: PreviewIdentity[], target = false) => cards.length ? cards.map(card =>
    `- ${card.code}${target ? ` → ${next.remaps[card.code] ?? official.get(key(card))!.code}` : ""} ${safe(card.name)}`) : ["None."];
  return ["## Prerelease cards", "", `Added prerelease cards (${added.length})`, "", ...lines(added), "",
    `Removed prerelease cards (${removed.length})`, "", ...lines(removed), "",
    `Graduated prerelease cards (${graduated.length})`, "", ...lines(graduated,true), "",
    `Dropped prerelease rows (${next.drops.length})`, "",
    ...(next.drops.length ? next.drops.map(card => `- ${card.code}${card.keptCode ? ` → ${card.keptCode}` : ""} ${safe(card.name)} (${safe(card.file)}): ${safe(card.reason)}`) : ["None."]), "",
    "The bundle retains historical remaps. Withdrawn cards with no released match remain saved and are reported as unknown/illegal.", ""].join("\n");
}
