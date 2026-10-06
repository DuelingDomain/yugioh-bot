// TODO: dedupe with scripts/released-card-data.ts after feat/engine-release-cdbs merges.
// Keep this selection identical to releasedDatabaseFiles there: root released
// databases only, ordered as EDOPro loads them (base first).
export function isReleasedDatabaseFile(path: string): boolean {
  return path === "cards.cdb" || /^release-[^/\\]*\.cdb$/.test(path);
}

export function sortDatabaseFiles(files: string[]): string[] {
  return files.sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : a < b ? -1 : a > b ? 1 : 0);
}
