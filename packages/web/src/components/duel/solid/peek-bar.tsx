"use client";

import type { DuelCard, DuelCardInfo } from "@yugidraft/shared/duels";
import { attributeLabel, cardArtUrl, cardDetailsText, cardStatsText, isHiddenCard } from "../constants";
import type { InspectTarget } from "../inspector";
import docks from "./docks.module.css";
import { SvIcon } from "./icons";

function peekCard(target: InspectTarget | null): DuelCard | DuelCardInfo | null {
  if (target?.type === "card" || target?.type === "info") return target.card;
  return null;
}

/** "EARTH · Level 4 · 1400 / 1200" for a monster, "Spell / Quick-Play" for a spell or trap. */
function peekMeta(card: DuelCard | DuelCardInfo): string {
  const rank = cardDetailsText(card).split(" · ")[0] ?? "";
  const attribute = attributeLabel(card.attribute);
  return [attribute, rank, cardStatsText(card)].filter(Boolean).join(" · ");
}

/**
 * The mobile bar under the field: the card being inspected (thumb, name, one meta line) and two buttons that open
 * the Card and Log sheets (`setPane(tab)` plus `setMobileInspect(true)` in the room). It replaces the V1 mobile bar.
 */
export function PeekBar({ target, onCard, onLog }: { target: InspectTarget | null; onCard: () => void; onLog: () => void }) {
  const card = peekCard(target);
  const hidden = card ? isHiddenCard(card) : false;
  const name = target?.type === "pile" ? target.title : card ? (hidden ? "Face-down card" : (card.name ?? "Card")) : null;
  const meta = card && !hidden ? peekMeta(card) : target?.type === "pile" ? `${target.cards.length} cards` : "";
  const code = card && !hidden ? card.code : null;
  return (
    <div className={docks.peekBar} data-sv-peek="">
      {code != null ? <img className={docks.peekThumb} src={cardArtUrl(code)} alt="" draggable={false} /> : <span className={docks.peekThumbEmpty} aria-hidden="true" />}
      <div className={docks.peekText}>
        <span className={docks.peekName}>{name ?? "Tap a card to read it"}</span>
        {meta ? <span className={docks.peekMeta}>{meta}</span> : null}
      </div>
      <button type="button" className={docks.peekBtn} onClick={onCard}><SvIcon name="card" size={15} /> Card</button>
      <button type="button" className={docks.peekBtn} onClick={onLog}><SvIcon name="log" size={15} /> Log</button>
    </div>
  );
}
