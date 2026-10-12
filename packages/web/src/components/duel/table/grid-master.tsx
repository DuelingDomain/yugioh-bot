"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { Search, X } from "lucide-react";
import type { DuelCard, DuelPromptOption, DuelSeatView } from "@yugidraft/shared/duels";
import { cardArtUrl, cardStatsText, LOCATION_DMZONE, zoneKey } from "../constants";
import { masterCard, masterDetailLines, masterStatus, withExact } from "../field";
import { masterActionParts, masterActionText, masterInUse, moveKind, masterSummonLine, useMasterSeats } from "../master-place";
import { anyLegal, anySelected, type DuelHoverHandler } from "../field-keys";
import type { InspectTarget } from "../inspector";
import type { DuelActivateHandler } from "./types";
import styles from "./grid-hud.module.css";

/**
 * The plate is narrow, so the buttons show short text: "Summon" over "500 LP", "Set" over "Free", and Activate without the
 * master's own name (see `masterActionParts`). The full option text stays as the tooltip, the accessible name has the
 * cost too. Attack keeps its short words. Nothing ends in an ellipsis: a long label wraps on a row of its own.
 */
function shortActionLabel(option: DuelPromptOption, view: DuelSeatView, showCost: boolean): ReactNode {
  const label = option.label;
  if (!showCost) {
    // The 1v1 plate keeps its short words and its full tooltip; its dock says the cost.
    const move = moveKind(option);
    if (move) return move;
    if (/^Attack directly\b/i.test(label)) return "Direct attack";
    if (/^Attack\b/i.test(label)) return "Attack";
    return label;
  }
  const { text, cost } = masterActionParts(option, view, true);
  if (cost === null) return /^Attack directly\b/i.test(text) ? "Direct attack" : /^Attack\b/i.test(text) ? "Attack" : text;
  return (
    <>
      {text}
      <span className={styles.masterActionDot}> · </span>
      <small className={styles.masterActionCost}>{cost}</small>
    </>
  );
}

/** The tall plate's card: at most the plate's inner width (152px wide, so 222px high), at least 195px high. */
const MASTER_ART_MAX = 222;
const MASTER_ART_MIN = 195;
/** The tall plate is for large screens only: a shorter window keeps the compact plate (the old token row). */
const MASTER_TALL_MIN_VIEW = 860;
/** The free gap kept between the plate top and the dock or the chain tower above it. */
const MASTER_ART_GAP = 12;
/**
 * The tall plate less its card (paddings, the gaps, the name, the summon line) and less its action rows, with some slack:
 * a safe estimate for the choice. The action rows (Summon and Set with Inspect, then one row per Activate, each wrapping onto
 * as many lines as its words need) are measured: the compact plate has the same width, so they have the same height.
 * One row of 30px gives the old 132px.
 */
const MASTER_TALL_REST = 102;

export type MasterForm = { tall: false } | { tall: true; art: number };

/**
 * Which plate fits. `viewHeight` is the window height; `room` is the height a tall card can have, that is the room
 * between the plate bottom and the lowest of the dock and the chain tower, less a gap and the rest of the tall plate.
 * The tall plate needs a large window and room for a card of at least 195px; else the plate is the compact token row.
 * The card never gets smaller than that: there is no size between the two forms.
 */
export function masterForm(viewHeight: number, room: number): MasterForm {
  if (viewHeight < MASTER_TALL_MIN_VIEW || room < MASTER_ART_MIN) return { tall: false };
  return { tall: true, art: Math.min(MASTER_ART_MAX, Math.floor(room)) };
}

/**
 * Picks the plate form from the free margin above the plate. The plate grows up from the bottom of the left margin;
 * the dock and the chain tower (live chains only, at most four rows) sit higher in the same margin. Before a measure
 * (first paint, tests) and on a second plate (data-slot="other"), the plate is compact.
 */
function useMasterForm(wrapRef: RefObject<HTMLDivElement | null>, artRef: RefObject<HTMLSpanElement | null>, shown: boolean): MasterForm {
  const [form, setForm] = useState<MasterForm>({ tall: false });
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const art = artRef.current;
    const layer = wrap?.parentElement;
    if (!shown || !wrap || !art || !layer || typeof ResizeObserver === "undefined") return;
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
      // A tall plate measures its own rest; a compact one uses the safe top value, so the choice never flips back.
      const actions = wrap.querySelector<HTMLElement>(`.${styles.masterActions}`)?.getBoundingClientRect().height ?? 30;
      const rest = wrap.dataset.form === "tall" ? box.height - art.getBoundingClientRect().height : MASTER_TALL_REST + actions;
      const next = masterForm(window.innerHeight, box.bottom - limit - MASTER_ART_GAP - rest);
      // The dock flyout and the hover preview end above a tall plate: they read its real height (grid-hud.module.css).
      if (wrap.dataset.form === "tall") layer.style.setProperty("--hud-master-tall-h", `${Math.ceil(box.height)}px`);
      else layer.style.removeProperty("--hud-master-tall-h");
      setForm((now) => (now.tall === next.tall && (!now.tall || !next.tall || now.art === next.art) ? now : next));
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
      layer.style.removeProperty("--hud-master-tall-h");
      window.removeEventListener("resize", schedule);
    };
  }, [wrapRef, artRef, shown]);
  return form;
}

/**
 * The Deck Master of the 4-way grid, as a plate at the bottom of the left margin beside your field. It shows the card,
 * its name and the actions that are legal now (Normal Summon, Set, Attack) with Inspect. It has two forms:
 * - compact (small screens, a long chain): a token row with a small card. The details flyout opens right above the
 *   plate, in the free margin.
 * - tall (large screens with free margin): the whole card at a readable size above the name. The details open inside
 *   the plate, over the card and the name, so they never cover the dock or the chain tower.
 * Both parts read the same real seat view as the Deck Master dock of the other tables.
 *
 * `slot="other"` is the second plate of a table that shows two masters (the rival of a 1v1 duel, the partner of a Tag
 * duel): it sits in the right margin, shows the card and opens the same details, and never offers actions.
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
  slot = "own",
  wide = false,
  showInUse = false,
  onToggle,
  onClose,
  onChooseAction,
  onActivate,
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
  slot?: "own" | "other";
  /**
   * The wide form (the 3-way plaza): the whole card beside its name and facts, the ability text under them and the
   * actions at the bottom. It does not measure the margin. It also stands in for the Deck Master Zone: the summon
   * flies out of it and the return flies back into it (data-master-dock, data-master-source).
   */
  wide?: boolean;
  /**
   * Draw the Deck Master Zone empty ("In use") while the master is on the field or anywhere out of its zone. The
   * multi-seat tables set it; the card comes back into the plate when the return flight lands (see MasterReturnFx).
   */
  showInUse?: boolean;
  onToggle: () => void;
  onClose: () => void;
  onChooseAction: (option: DuelPromptOption) => void;
  /** A prompt asks for this card: a click on the token picks it, as a click on the card on the field would. */
  onActivate?: DuelActivateHandler;
  onInspect: (target: InspectTarget) => void;
  onHoverCard?: DuelHoverHandler;
}) {
  const master = view?.deckMaster;
  const wrapRef = useRef<HTMLDivElement>(null);
  const artRef = useRef<HTMLSpanElement>(null);
  const form = useMasterForm(wrapRef, artRef, master != null && !wide);
  const seats = useMasterSeats();
  if (!view || !master) return null;
  const card = masterCard(view, seats);
  const keys = withExact(card, [zoneKey(view.seat, LOCATION_DMZONE, 0)]);
  const legal = anyLegal(keys, legalKeys);
  const selected = anySelected(keys, selectedKeys);
  const actions = local && canAct ? legalActionsFor(card, keys) : [];
  const status = masterStatus(view, seats);
  const inUse = showInUse && masterInUse(view, seats);
  const summonLine = showInUse ? masterSummonLine(view) : null;
  // A multi-seat plate is the zone of its seat; the 1v1 HUD keeps its rail as the anchor.
  const zoneAnchor = wide || showInUse;
  const stats = cardStatsText(master.card);
  const details = masterDetailLines(master.card);
  const ability = master.card.description?.trim() ?? "";
  // The wide and the tall plate both show the whole card and open the details inside the plate.
  const whole = wide || form.tall;

  // The second plate has its own test ids, so a table with two plates keeps them apart.
  const id = (name: string) => (slot === "other" ? name.replace("hud-master", "hud-other") : name);
  // A legal card that a prompt asks for is picked from the token (the details stay on Inspect).
  const pickable = legal && canAct && card != null && onActivate != null;
  const openCard = () => {
    if (card) onInspect({ type: "card", card });
    else onInspect({ type: "info", card: master.card });
  };

  const flyout = open ? (
    <aside className={styles.masterFly} role="dialog" aria-label={`${title} details`} data-testid={id("hud-master-flyout")}>
      <header>
        <b>{title}</b>
        <button type="button" className={styles.flyClose} aria-label="Close Deck Master details" data-testid={id("hud-master-close")} onClick={onClose}>
          <X size={16} strokeWidth={1.75} aria-hidden />
        </button>
      </header>
      <p className={styles.masterFlyName}>{master.card.name}</p>
      {details.map((line) => <p key={line} className={styles.masterFlyLine}>{line}</p>)}
      {stats ? <p className={styles.masterFlyLine}>{stats}</p> : null}
      <dl>
        <div><dt>Status</dt><dd data-testid={id("hud-master-status")}>{status}</dd></div>
        <div><dt>Returns</dt><dd data-testid={id("hud-master-returns")}>{master.returns}</dd></div>
        <div><dt>Next surcharge</dt><dd data-testid={id("hud-master-cost")}>{master.nextCost} LP</dd></div>
      </dl>
      <button type="button" className={styles.masterFlyCard} data-testid={id("hud-master-card")} onClick={openCard}>Card view</button>
    </aside>
  ) : null;

  return (
    <div ref={wrapRef} className={styles.masterWrap} data-hud-keep="" data-slot={slot} data-testid={id("hud-master")} data-form={wide ? "wide" : form.tall ? "tall" : "compact"}
      style={form.tall ? ({ "--hud-master-art-h": `${form.art}px` } as CSSProperties) : undefined}>
      {whole ? null : flyout}
      <section
        className={styles.master}
        aria-label={title}
        data-legal={legal ? "true" : "false"}
        data-selected={selected ? "true" : "false"}
        data-open={open ? "true" : "false"}
        data-away={status === "Elsewhere" ? "true" : "false"}
        data-in-use={inUse ? "true" : "false"}
      >
        <div className={styles.masterFace}>
          <button
            type="button"
            className={styles.masterToken}
            data-testid={id("hud-master-token")}
            aria-label={`${title}: ${master.card.name}${inUse ? `, in use (${status})` : ""}${summonLine ? `, ${summonLine}` : ""}`}
            aria-expanded={pickable ? undefined : open}
            onClick={(event) => (pickable ? onActivate(keys, card, event.currentTarget) : onToggle())}
            onMouseEnter={(event) => onHoverCard?.(card, event.currentTarget)}
            onMouseLeave={() => onHoverCard?.(null, null)}
            onFocus={(event) => onHoverCard?.(card, event.currentTarget)}
            onBlur={() => onHoverCard?.(null, null)}
          >
            {/* The plate is the Deck Master Zone of this seat: a summon flies out of it and a return flies back into it. */}
            <span ref={artRef} className={styles.masterArt} data-in-use={inUse ? "true" : undefined}
              data-master-dock={zoneAnchor ? view.seat : undefined} data-master-source={zoneAnchor ? view.seat : undefined}
              style={inUse ? undefined : { backgroundImage: whole
              // The small art sits under the full art, so the plate is never blank when the full image fails.
              ? `url(${cardArtUrl(master.card.code, "full")}), url(${cardArtUrl(master.card.code, "small")})`
              : `url(${cardArtUrl(master.card.code, "small")})` }} aria-hidden="true">
              {inUse ? <span className={styles.masterInUse} data-testid={id("hud-master-in-use")}>In use</span> : null}
            </span>
            <span className={styles.masterId}>
              <small>{local ? "Your Master" : "Deck Master"}</small>
              <b title={master.card.name}>{master.card.name}</b>
              {inUse && !wide ? <span className={styles.masterUse} data-testid={id("hud-master-use")}>In use · {status}</span> : null}
              {summonLine && !wide ? <span className={styles.masterSummon} data-testid={id("hud-master-summon")}>{summonLine}</span> : null}
              {wide ? (
                <span className={styles.masterFacts} data-testid={id("hud-master-facts")}>
                  {details.map((line) => <span key={line}>{line}</span>)}
                  {stats ? <span>{stats}</span> : null}
                  <span data-status={status === "Elsewhere" ? "away" : "home"}>{status}</span>
                  {summonLine ? <span className={styles.masterSummon} data-testid={id("hud-master-summon")}>{summonLine}</span> : null}
                </span>
              ) : null}
            </span>
          </button>
          {wide ? (
            <div className={styles.masterAbility} role="region" tabIndex={0} aria-label={`${master.card.name} ability`} data-testid={id("hud-master-ability")}>
              {ability ? ability : <span className={styles.masterAbilityNone}>This Deck Master has no effect text.</span>}
            </div>
          ) : null}
          {whole ? flyout : null}
        </div>
        <div className={styles.masterActions}>
          {/* Summon and Set share the row with Inspect; any other action (Activate) is last and takes a whole row. */}
          {[...actions.filter((o) => masterActionParts(o, view, true).move), null, ...actions.filter((o) => !masterActionParts(o, view, true).move)].map((option) =>
            option ? (
              <button key={option.id} type="button" data-primary={option === actions[0] ? "true" : "false"} data-kind={masterActionParts(option, view, true).move ? "move" : "other"}
                data-testid={id("hud-master-action")} aria-label={masterActionText(option, view, false)} title={option.label} disabled={!canAct}
                onClick={() => onChooseAction(option)}>
                <span className={styles.masterActionText}>{shortActionLabel(option, view, showInUse)}</span>
              </button>
            ) : (
              <button key="inspect" type="button" className={styles.masterInspect} data-testid={id("hud-master-inspect")} aria-label="Inspect" title="Inspect" onClick={onToggle}>
                <Search size={14} strokeWidth={1.75} aria-hidden />
                <span className={styles.masterInspectText}>Inspect</span>
              </button>
            ),
          )}
        </div>
      </section>
    </div>
  );
}
