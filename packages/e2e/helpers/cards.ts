import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { duelDataDir } from "../stack/env.mjs";

// Card names resolve to passcodes through the read-only card database the duel host uses.
// Alternate arts (alias != 0) are skipped, so a name gives the one real card.
let byName: Map<string, number[]> | null = null;

function load(): Map<string, number[]> {
  if (byName) return byName;
  const db = new DatabaseSync(join(duelDataDir, "cards.cdb"), { readOnly: true });
  try {
    const rows = db
      .prepare("SELECT d.id AS id, t.name AS name FROM datas d JOIN texts t ON t.id = d.id WHERE d.alias = 0 ORDER BY d.id")
      .all() as { id: number; name: string }[];
    byName = new Map();
    for (const row of rows) byName.set(row.name, [...(byName.get(row.name) ?? []), row.id]);
    return byName;
  } finally {
    db.close();
  }
}

/** The passcode of a card, by exact printed name. Throws on an unknown or ambiguous name. */
export function cardCode(name: string): number {
  const codes = load().get(name);
  if (!codes?.length) throw new Error(`Unknown card name: ${name}`);
  if (codes.length > 1) throw new Error(`Ambiguous card name ${name}: ${codes.join(", ")}`);
  return codes[0];
}
