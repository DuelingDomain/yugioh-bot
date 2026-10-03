import { ChevronRight } from "lucide-react";
import { FloorRow, LiveDot, StageLine, svButtonClass } from "@/components/sheet";
import { Gem, Pieces } from "../draft-frame";
import {
  draftHref,
  formatDay,
  kindLabel,
  liveStages,
  pickLabel,
  playersLabel,
  type DraftListItem,
} from "./drafts-list-model";
import styles from "./drafts-list.module.css";

/** A draft that is running now. Render inside a `FloorList` in a `SheetRoot`. */
export function LiveDraftRow({ draft }: { draft: DraftListItem }) {
  const stages = liveStages(draft);
  const pick = pickLabel(draft.config.pickSeconds);
  const href = draftHref(draft) ?? undefined;
  return (
    <FloorRow
      you
      href={href}
      className={styles.row}
      cols="minmax(0, 1fr) minmax(240px, 330px) auto"
      phoneCols="minmax(0, 1fr) auto"
      phoneAreas={'"id act" "prog prog"'}
    >
      <div className={styles.id} style={{ gridArea: "id" }}>
        <p className={`sv-cell-name ${styles.name}`}>{draft.name}</p>
        <Pieces
          items={[
            { key: "live", content: <LiveDot label="Drafting" />, strong: true },
            { key: "kind", content: kindLabel(draft.config) },
            { key: "players", content: playersLabel(draft.playerCount) },
            ...(pick ? [{ key: "pick", content: pick }] : []),
          ]}
        />
      </div>
      <div className={styles.prog} style={{ gridArea: "prog" }}>
        <StageLine steps={stages.steps} label={`Progress of ${draft.name}`} />
        <p className={styles.cap}>{stages.caption}</p>
      </div>
      {href && (
        <span className={styles.actCell} style={{ gridArea: "act" }}>
          <span className={`${svButtonClass("ghost")} ${styles.act}`}>Open draft room</span>
        </span>
      )}
    </FloorRow>
  );
}

/** A draft that has not started. Render inside a `FloorList` in a `SheetRoot`. */
export function WaitingDraftRow({ draft }: { draft: DraftListItem }) {
  const created = formatDay(draft.createdAt, true);
  const href = draftHref(draft) ?? undefined;
  return (
    <FloorRow
      href={href}
      className={styles.row}
      cols="minmax(0, 1fr) auto 18px"
      phoneCols="minmax(0, 1fr) auto"
      phoneAreas={'"id n"'}
    >
      <div className={styles.id} style={{ gridArea: "id" }}>
        <p className={`sv-cell-name ${styles.name}`}>{draft.name}</p>
        <Pieces
          items={[
            { key: "status", content: <><Gem />Waiting to start</>, strong: true },
            { key: "kind", content: kindLabel(draft.config) },
            ...(created ? [{ key: "created", content: `Created ${created}` }] : []),
          ]}
        />
      </div>
      <span className={styles.joined} style={{ gridArea: "n" }}>
        <b className="sv-cell-num">{draft.playerCount}</b> joined
      </span>
      {href && <ChevronRight className={styles.chevron} aria-hidden="true" />}
    </FloorRow>
  );
}
