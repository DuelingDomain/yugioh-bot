export type ReleasedDatabaseTree = { truncated: boolean; tree: Array<{ path: string; type: string }> };

export function isReleasedDatabaseFile(path: string): boolean {
  return path === "cards.cdb" || /^release-[^/\\]*\.cdb$/.test(path);
}

export function sortDatabaseFiles(files: string[]): string[] {
  return files.sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : a < b ? -1 : a > b ? 1 : 0);
}

/** EDOPro sorts CDB filenames case-insensitively and replaces previously loaded rows.
 * Base first, then release-*.cdb in the same filename order.
 * See docs/deployment/engine-data-updates.md for the upstream implementation.
 */
export function releasedDatabaseFiles(tree: ReleasedDatabaseTree): string[] {
  if (tree.truncated) throw new Error("GitHub truncated the database tree; refusing incomplete released card data");
  const files = sortDatabaseFiles(tree.tree
    .filter(entry => entry.type === "blob" && isReleasedDatabaseFile(entry.path))
    .map(entry => entry.path));
  if (!files.includes("cards.cdb")) throw new Error("BabelCDB tree is missing cards.cdb");
  return files;
}
