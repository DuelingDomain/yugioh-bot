"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";
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

/** The card on the plate: at most the plate's inner width (152px wide, so 222px high), at least a small token. */
const MASTER_ART_MAX = 222;
const MASTER_ART_MIN = 58;
/** The free gap kept between the plate top and the dock or the chain tower above it. */
const MASTER_ART_GAP = 12;

/**
 * Sizes the card on the plate to the free margin above it. The plate grows up from the bottom of the left margin; the
 * dock and the chain tower (live chains only, at most four rows) sit higher in the same margin. The card height is the
 * room between the plate bottom and the lowest of them, less a gap and the rest of the plate (name, actions), so the
 * plate never reaches them, whatever the screen height, the dock icons or the chain. Without a measure (first paint,
 * tests) the CSS default of `.masterWrap` applies.
 */
function useMasterArtFit(wrapRef: RefObject<HTMLDivElement | null>, artRef: RefObject<HTMLSpanElement | null>, shown: boolean) {
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const art = artRef.current;
    const layer = wrap?.parentElement;
    if (!shown || !wrap || !art || !layer || typeof ResizeObserver === "undefined") return;
    // A second plate (data-slot="other", high in the right margin) keeps its small card.
    if (wrap.dataset.slot === "other") return;
    let frame = 0;
    const fit = () => {
      frame = 0;
      const box = wrap.getBoundingClientRect();
      if (box.height === 0) return;
      let limit = layer.getBoundingClientRect().top;
      for (const el of layer.querySelectorAll<HTMLElement>(`:scope > .${styles.dock}, :scope > .${styles.tower}`)) {
        const rect = el.getBoundingClientRect();
        // Only what is in the plate's own column, above it.
        if (rect.height === 0 || rect.right <= box.left || rect.left >= box.right || rect.bottom > box.bottom) continue;
        limit = Math.max(limit, rect.bottom);
      }
      const rest = box.height - art.getBoundingClientRect().height;
      const room = Math.floor(box.bottom - limit - MASTER_ART_GAP - rest);
      const height = Math.max(MASTER_ART_MIN, Math.min(MASTER_ART_MAX, room));
      const next = `${height}px`;
      if (wrap.style.getPropertyValue("--hud-master-art-h") !== next) wrap.style.setProperty("--hud-master-art-h", next);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(fit);
    };
    const sizes = new ResizeObserver(schedule);
    const watch = () => {
      sizes.disconnect();
      sizes.observe(layer);
      sizes.observe(wrap);
      for (const el of layer.querySelectorAll<HTMLElement>(`:scope > .${styles.dock}, :scope > .${styles.tower}`)) sizes.observe(el);
      schedule();
    };
    // The chain tower comes and goes as a sibling of the plate.
    const children = new MutationObserver(watch);
    children.observe(layer, { childList: true });
    window.addEventListener("resize", schedule);
    watch();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      sizes.disconnect();
      children.disconnect();
      window.removeEventListener("resize", schedule);
      wrap.style.removeProperty("--hud-master-art-h");
    };
  }, [wrapRef, artRef, shown]);
}

/**
 * The Deck Master of the 4-way grid, as a tall plate at the bottom of the left margin beside your field. The plate shows
 * the whole card at a readable size, its name and the actions that are legal now (Normal Summon, Set, Attack) with
 * Inspect. A click on the token or Inspect opens the details (status, returns, next surcharge) in place of the card and
 * name, inside the plate, so the details never cover the dock, the chain tower or a field. Both parts read the same
 * real seat view as the Deck Master dock of the other tables.
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
  const wrapRef = useRef<HTMLDivElement>(null);
  const artRef = useRef<HTMLSpanElement>(null);
  useMasterArtFit(wrapRef, artRef, master != null);
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
    <div ref={wrapRef} className={styles.masterWrap} data-hud-keep="" data-testid="hud-master">
      <section
        className={styles.master}
        aria-label={title}
        data-legal={legal ? "true" : "false"}
        data-selected={selected ? "true" : "false"}
        data-open={open ? "true" : "false"}
        data-away={status === "Elsewhere" ? "true" : "false"}
      >
        <div className={styles.masterFace}>
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
            <span ref={artRef} className={styles.masterArt} style={{ backgroundImage: `url(${cardArtUrl(master.card.code, "full")})` }} aria-hidden="true" />
            <span className={styles.masterId}>
              <small>{title}</small>
              <b title={master.card.name}>{master.card.name}</b>
            </span>
          </button>
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
        </div>
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
