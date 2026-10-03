import Database from "better-sqlite3";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Adds the pre-errata Firewall input only to a private test data directory. */
export function createPrivateTableData(source: string): { directory: string; cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), "private-table-data-"));
  const cleanup = () => rmSync(directory, { recursive: true, force: true });
  try {
    for (const name of readdirSync(source)) {
      if (name !== "cards.cdb" && name !== "card-scripts")
        symlinkSync(join(source, name), join(directory, name));
    }
    copyFileSync(join(source, "cards.cdb"), join(directory, "cards.cdb"));
    const scripts = join(directory, "card-scripts");
    // The engine indexes real directories. It does not enter directory links.
    const linkScripts = (from: string, to: string) => {
      mkdirSync(to, { recursive: true });
      for (const entry of readdirSync(from, { withFileTypes: true })) {
        if (entry.isDirectory()) linkScripts(join(from, entry.name), join(to, entry.name));
        else if (join(to, entry.name) !== join(scripts, "official/c5043020.lua"))
          symlinkSync(join(from, entry.name), join(to, entry.name));
      }
    };
    linkScripts(join(source, "card-scripts"), scripts);
    copyFileSync(join(source, "card-scripts/pre-errata/c5043020.lua"), join(scripts, "official/c5043020.lua"));
    const db = new Database(join(directory, "cards.cdb"));
    try {
      db.exec("INSERT OR REPLACE INTO datas SELECT 5043020,ot,0,setcode,type,atk,def,level,race,attribute,category FROM datas WHERE id=5043010");
      db.exec("INSERT OR REPLACE INTO texts SELECT 5043020,'Firewall Dragon (pre-errata)',desc,str1,str2,str3,str4,str5,str6,str7,str8,str9,str10,str11,str12,str13,str14,str15,str16 FROM texts WHERE id=5043010");
      if (!db.prepare("SELECT id FROM datas WHERE id=5043020").get())
        throw new Error("The private table fixture needs Firewall Dragon 5043010 in the source database.");
    } finally { db.close(); }
    return { directory, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}
