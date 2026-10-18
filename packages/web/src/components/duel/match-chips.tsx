import { Globe, Lock } from "lucide-react";
import type { DuelListItem } from "@yugidraft/shared/duels";
import { genesysCapShort, genesysOf } from "./genesys";
import { TABLE_TYPE_LABELS } from "./table-format";
import ui from "./sheet-ui.module.css";

const MATCH_FORMAT_LABELS: Record<DuelListItem["matchFormat"], string> = {
  standard: "Standard",
  domain: "Domain",
  genesys: "Genesys",
  "genesys-domain": "Genesys Domain",
};

/** "Standard", "Domain", "Genesys · 100 pts" or "Genesys Domain · 100 pts". */
export function matchFormatLabel(duel: Pick<DuelListItem, "matchFormat" | "settings">): string {
  const name = MATCH_FORMAT_LABELS[duel.matchFormat];
  const genesys = genesysOf(duel);
  return genesys && duel.matchFormat.startsWith("genesys") ? `${name} · ${genesysCapShort(genesys)}` : name;
}

/**
 * The match type of a table as three quiet chips in a fixed order: card rules, table type, visibility. They are
 * plain text with no hover state, and each keeps its own space, so none moves or covers another.
 */
export function MatchChips({ duel }: { duel: Pick<DuelListItem, "matchFormat" | "tableType" | "visibility" | "settings"> }) {
  const isPrivate = duel.visibility === "private";
  return (
    <>
      <span className={ui.chip} data-testid="match-format-chip">{matchFormatLabel(duel)}</span>
      <span className={ui.chip} data-testid="match-table-chip">{TABLE_TYPE_LABELS[duel.tableType]}</span>
      <span className={ui.chip} data-testid="match-visibility-chip">
        {isPrivate ? <Lock size={13} strokeWidth={1.6} aria-hidden /> : <Globe size={13} strokeWidth={1.6} aria-hidden />}
        {isPrivate ? "Private" : "Public"}
      </span>
    </>
  );
}
