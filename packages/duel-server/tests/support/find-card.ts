/**
 * Look up card names and passcodes.
 *   DUEL_DATA_DIR=<dir> npx tsx tests/support/find-card.ts raigeki
 */
import { searchCatalog } from "./card-catalog.js";

const query = process.argv.slice(2).join(" ").trim();
if (!query) {
  console.error("Usage: npx tsx tests/support/find-card.ts <part of a card name>");
  process.exit(1);
}
const hits = searchCatalog(query, 40);
if (hits.length === 0) console.log(`No card name contains "${query}".`);
for (const card of hits) console.log(`${String(card.code).padStart(10)}  ${card.name}`);
