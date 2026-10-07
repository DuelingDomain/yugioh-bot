import type Database from "better-sqlite3";
import { CARD_TYPE_BITS as T } from "../duels/card-query.js";

/** Metadata for graduated catalog references comes from the installed engine,
 * so an offline startup never copies the translated preview name/type forward. */
export function remapTargetMetadata(engine: Database.Database, targets: Iterable<number>): Map<number, Record<string, string | number | null>> {
  const columns = new Set((engine.prepare("PRAGMA table_info(datas)").all() as { name: string }[]).map(row => row.name));
  const texts = new Set((engine.prepare("PRAGMA table_info(texts)").all() as { name: string }[]).map(row => row.name));
  const metadata = new Map<number, Record<string, string | number | null>>();
  if (!texts.has("name") || !columns.has("type")) return metadata;
  const find = engine.prepare(`SELECT d.type,t.name${texts.has("desc") ? ",t.desc" : ""}${["atk", "def", "level", "attribute"].filter(field => columns.has(field)).map(field => `,d.${field}`).join("")} FROM datas d JOIN texts t USING(id) WHERE d.id=?`);
  for (const target of new Set(targets)) {
    const row = find.get(target) as { type: number; name: string; desc?: string; atk?: number; def?: number; level?: number; attribute?: number } | undefined;
    if (!row) continue;
    const type = row.type;
    const base = type & T.link ? "Link" : type & T.xyz ? "XYZ" : type & T.synchro ? "Synchro" : type & T.fusion ? "Fusion" : type & T.ritual ? "Ritual" : undefined;
    const frame = base?.toLowerCase() ?? (type & T.normal ? "normal" : "effect");
    const info: Record<string, string | number | null> = { name: row.name,
      type: type & T.spell ? "Spell Card" : type & T.trap ? "Trap Card" : [base, type & T.pendulum ? "Pendulum" : undefined, type & T.tuner ? "Tuner" : undefined, type & T.effect ? "Effect" : !base ? "Normal" : undefined, "Monster"].filter(Boolean).join(" "),
      frame_type: type & T.spell ? "spell" : type & T.trap ? "trap" : `${frame}${type & T.pendulum ? "_pendulum" : ""}`,
    };
    if (row.desc !== undefined) info.effect_text = row.desc;
    if (row.atk !== undefined) info.atk = row.atk;
    if (row.def !== undefined) info.def = type & T.link ? null : row.def;
    if (row.level !== undefined) info.level = row.level & 0xff;
    if (row.attribute !== undefined) info.attribute = ({ 1: "EARTH", 2: "WATER", 4: "FIRE", 8: "WIND", 16: "LIGHT", 32: "DARK", 64: "DIVINE" } as Record<number, string>)[row.attribute] ?? null;
    metadata.set(target, info);
  }
  return metadata;
}
