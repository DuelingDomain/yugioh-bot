import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { StationTrack } from "@/components/sheet";
import { MetaLine } from "../meta-line";
import {
  draftHref,
  formatDay,
  kindLabel,
  liveTrack,
  pickLabel,
  playersLabel,
  type DraftListItem,
} from "./drafts-list-model";
import styles from "./drafts-list.module.css";

function Row({ draft, you, children }: { draft: DraftListItem; you?: boolean; children: ReactNode }) {
  const href = draftHref(draft);
  const cls = `tl-row ${styles.row}`;
  if (!href) {
    return (
      <div className={cls} data-you={you ? "" : undefined}>
        {children}
      </div>
    );
  }
  return (
    <Link href={href} className={cls} data-you={you ? "" : undefined}>
      {children}
    </Link>
  );
}

/** A draft that is running now. Render inside a `SheetRoot`. */
export function LiveDraftRow({ draft }: { draft: DraftListItem }) {
  const track = liveTrack(draft);
  const pick = pickLabel(draft.config.pickSeconds);
  const linked = Boolean(draftHref(draft));
  return (
    <Row draft={draft} you>
      <div className={styles.details}>
        <p className="tl-name">{draft.name}</p>
        <MetaLine className="tl-meta" items={[
          { content: <span className="live-pill">Drafting</span> },
          { content: kindLabel(draft.config) },
          { content: playersLabel(draft.playerCount) },
          ...(pick ? [{ content: pick }] : []),
        ]} />
      </div>
      <div className={`tl-prog ${styles.prog}`}>
        <StationTrack
          stations={track.stations}
          current={track.current}
          tone="mine"
          size="sm"
          label={`Progress of ${draft.name}`}
          caption={
            <>
              {track.caption[0]}
              <span className="sep">·</span>
              {track.caption[1]}
            </>
          }
        />
      </div>
      {linked && (
        <div className={`tl-side ${styles.side}`}>
          <span className="chip chip-pen">Open draft room</span>
          <ChevronRight className={`ic ${styles.chevron}`} aria-hidden="true" />
        </div>
      )}
    </Row>
  );
}

/** A draft that has not started. Render inside a `SheetRoot`. */
export function WaitingDraftRow({ draft }: { draft: DraftListItem }) {
  const created = formatDay(draft.createdAt, true);
  const linked = Boolean(draftHref(draft));
  return (
    <Row draft={draft}>
      <div className={styles.details}>
        <p className="tl-name">{draft.name}</p>
        <MetaLine className="tl-meta" items={[
          { content: <span className="status">
            <span className="lamp" data-s="open" aria-hidden="true" />
            Waiting to start
          </span> },
          {
            className: styles.joined,
            content: <span aria-label={`${playersLabel(draft.playerCount)} joined`}>{draft.playerCount} joined</span>,
          },
          { content: kindLabel(draft.config) },
          ...(created ? [{ content: `Created ${created}` }] : []),
        ]} />
      </div>
      <div className={`seats-mini ${styles.count}`} aria-hidden="true">
        <b>{draft.playerCount}</b>
        <small>joined</small>
      </div>
      {linked && (
        <div className={`tl-side ${styles.waitingSide}`}>
          <ChevronRight className={`ic ${styles.chevron}`} aria-hidden="true" />
        </div>
      )}
    </Row>
  );
}
