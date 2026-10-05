"use client";

import { Search, X } from "lucide-react";
import type { DuelCard, DuelPromptOption, DuelSeatView } from "@yugidraft/shared/duels";
import { cardArtUrl, cardStatsText, LOCATION_DMZONE, zoneKey } from "../constants";
import { masterCard, masterDetailLines, masterStatus, withExact } from "../field";
import { anyLegal, anySelected, type DuelHoverHandler } from "../field-keys";
import type { InspectTarget } from "../inspector";
import styles from "./grid-hud.module.css";

/**
 * The plate is narrow, so the buttons show a short word. The full option text ("Normal Summon Sage with Eyes of Blue")
 * stays as the accessible name and the tooltip. Normal Summon, Set and Attack get a short word; other labels are shown
 * as they are and end in an ellipsis when they are too long.
 */
function shortActionLabel(label: string): string {
  if (/^Normal Summon\b/i.test(label)) return "Summon";
  if (/^Set\b/i.test(label)) return "Set";
  if (/^Attack directly\b/i.test(label)) return "Direct attack";
  if (/^Attack\b/i.test(label)) return "Attack";
  return label;
}

/**
 * The Deck Master of the 4-way grid, as a token plate in the left margin beside your field. The plate shows the card,
 * its name and the actions that are legal now (Normal Summon, Set) with Inspect. A click on the token or Inspect opens
 * the details flyout (status, returns, next surcharge) right above the plate, in the free margin, so it never covers a
 * field. Both parts read the same real seat view as the Deck Master dock of the other tables.
 */
export function GridMasterToken({
  view,
  local,
  legalKeys,
  selectedKeys,
  canAct,
  legalActionsFor,
  open,
  title,
  onToggle,
  onClose,
  onChooseAction,
  onInspect,
  onHoverCard,
}: {
  view: DuelSeatView | undefined;
  /** The plate is yours: it offers actions. A spectator's plate only shows the card. */
  local: boolean;
  legalKeys: Set<string>;
  selectedKeys: Set<string>;
  canAct: boolean;
  legalActionsFor: (card: DuelCard | null, keys: string[]) => DuelPromptOption[];
  open: boolean;
  title: string;
  onToggle: () => void;
  onClose: () => void;
  onChooseAction: (option: DuelPromptOption) => void;
  onInspect: (target: InspectTarget) => void;
  onHoverCard?: DuelHoverHandler;
}) {
  const master = view?.deckMaster;
  if (!view || !master) return null;
  const card = masterCard(view);
  const keys = withExact(card, [zoneKey(view.seat, LOCATION_DMZONE, 0)]);
  const legal = anyLegal(keys, legalKeys);
  const selected = anySelected(keys, selectedKeys);
  const actions = local && canAct ? legalActionsFor(card, keys) : [];
  const status = masterStatus(view);
  const stats = cardStatsText(master.card);
  const details = masterDetailLines(master.card);

  const openCard = () => {
    if (card) onInspect({ type: "card", card });
    else onInspect({ type: "info", card: master.card });
  };

  return (
    <div className={styles.masterWrap} data-hud-keep="" data-testid="hud-master">
      {open ? (
        <aside className={styles.masterFly} role="dialog" aria-label={`${title} details`} data-testid="hud-master-flyout">
          <header>
            <b>{title}</b>
            <button type="button" className={styles.flyClose} aria-label="Close Deck Master details" data-testid="hud-master-close" onClick={onClose}>
              <X size={16} strokeWidth={1.75} aria-hidden />
            </button>
          </header>
          <p className={styles.masterFlyName}>{master.card.name}</p>
          {details.map((line) => <p key={line} className={styles.masterFlyLine}>{line}</p>)}
          {stats ? <p className={styles.masterFlyLine}>{stats}</p> : null}
          <dl>
            <div><dt>Status</dt><dd data-testid="hud-master-status">{status}</dd></div>
            <div><dt>Returns</dt><dd data-testid="hud-master-returns">{master.returns}</dd></div>
            <div><dt>Next surcharge</dt><dd data-testid="hud-master-cost">{master.nextCost} LP</dd></div>
          </dl>
          <button type="button" className={styles.masterFlyCard} data-testid="hud-master-card" onClick={openCard}>Card view</button>
        </aside>
      ) : null}
      <section
        className={styles.master}
        aria-label={title}
        data-legal={legal ? "true" : "false"}
        data-selected={selected ? "true" : "false"}
        data-open={open ? "true" : "false"}
        data-away={status === "Elsewhere" ? "true" : "false"}
      >
        <button
          type="button"
          className={styles.masterToken}
          data-testid="hud-master-token"
          aria-label={`${title}: ${master.card.name}`}
          aria-expanded={open}
          onClick={onToggle}
          onMouseEnter={(event) => onHoverCard?.(card, event.currentTarget)}
          onMouseLeave={() => onHoverCard?.(null, null)}
          onFocus={(event) => onHoverCard?.(card, event.currentTarget)}
          onBlur={() => onHoverCard?.(null, null)}
        >
          <span className={styles.masterArt} style={{ backgroundImage: `url(${cardArtUrl(master.card.code, "small")})` }} aria-hidden="true" />
          <span className={styles.masterId}>
            <small>{title}</small>
            <b title={master.card.name}>{master.card.name}</b>
          </span>
        </button>
        {local ? (
          <div className={styles.masterActions}>
            {actions.map((option, index) => (
              <button key={option.id} type="button" data-primary={index === 0 ? "true" : "false"} data-testid="hud-master-action"
                aria-label={option.label} title={option.label} disabled={!canAct} onClick={() => onChooseAction(option)}>
                <span className={styles.masterActionText}>{shortActionLabel(option.label)}</span>
              </button>
            ))}
            <button type="button" className={styles.masterInspect} data-testid="hud-master-inspect" aria-label="Inspect" title="Inspect" onClick={onToggle}>
              <Search size={14} strokeWidth={1.75} aria-hidden />
              <span className={styles.masterInspectText}>Inspect</span>
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
