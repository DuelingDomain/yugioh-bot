"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { X } from "lucide-react";
import type { DuelMasterRule, SandboxCardEntry, SandboxDuelistId } from "@yugidraft/shared/duels";
import { cn } from "@/lib/utils";
import { gridCells, gridWorld, gridFocusLayout, pairDrawer, type CellState, type GridCell, type GridCellRect } from "@/components/duel/table/grid-layout";
import { SEAT_Z, seatPoses, tableLayout } from "@/components/duel/table/geometry";
import { SEAT_TONE_HEX, type SeatTone, type TableLayout } from "@/components/duel/table/types";
import { hexToRgbTriplet } from "@/components/duel/table/seat-angle";
import {
  getEntry,
  seatIndex,
  seatsOf,
  slotCount,
  type CardLoc,
  type PileZone,
  type SandboxBuilderState,
  type SlotZone,
} from "./board-model";
import { zoneName, type AddTarget } from "./placement";
import { PileRow } from "./pile-row";
import { CardPopover } from "./slot-popover";
import { LpField, MONSTER_LABEL, sameLoc, type SeatBoardActions } from "./seat-board";
import { CardThumb, useDropTarget, ZoneSlot, type CardInfoMap } from "./zone-slot";
import seatStyles from "./builder.module.css";
import styles from "./table-view.module.css";

/**
 * The sandbox table: every seat of a 3-way or 4-way board where it stands in a real duel. It reuses the geometry of
 * the duel table (`duel/table`): the 3-way plaza places (`seatPoses`) and the 4-way 2x2 grid (`gridFocusLayout`), with
 * the facing seats 0+1 and 2+3 sharing one row of Extra Monster Zones. A field is a native box of 653 px (3-way) or
 * 829 px (4-way) by 380 px that is turned and scaled to its place, so one set of zone cells serves both.
 *
 * Clicks use the builder flow: `actions.onSlot`, the card popover (drawn in a fixed layer, because a scaled and turned
 * stage would shrink it) and `PileRow` in a drawer for Hand, Deck, Extra Deck, GY and Banished.
 */

const STAGE_W = 1100;
/** The stage is 860 px high for the 3-way plaza. The 4-way grid is wide and low, so it gets a lower stage and a bigger scale. */
const stageHeight = (format: string | undefined): number => (format === "ffa4" ? 560 : 860);
/** The native field box: height in px at card height SEAT_Z, and the lane under it (hand strip, piles, plate). */
const BOX_H = 380;
const LANE_GAP = 7;
const LANE_H = 74;
const TILE_H = BOX_H + LANE_GAP + LANE_H;
const PLATE_W = 213;
const NARROW_W = 653;
const WIDE_W = 829;
const STACK_BELOW = 640;
const FALLBACK_WIDTH = 960;
const BADGE_MIN_W = 118;
const BADGE_H = 56;

/** The piles in the lane under a field, after the hand strip. The Graveyard sits at the right of the Monster row. */
const LANE_PILES: readonly PileZone[] = ["deck", "extra", "banished"];

interface TilePlace {
  seat: SandboxDuelistId;
  /** Centre of the field box in stage px. */
  x: number;
  y: number;
  /** Stage scale of the field and its turn. */
  scale: number;
  rotateDeg: number;
  boxWidth: number;
  /** Place name, for tests and the page: home, vL, vR (3-way) or bl, tl, tr, br (4-way). */
  place: string;
  /** 4-way only: the column (0 left, 1 right) and whether this field draws the shared Extra Monster row. */
  column: 0 | 1 | null;
  drawer: boolean;
  tone: SeatTone;
}

function seatId(seat: number): SandboxDuelistId {
  return `p${seat}` as SandboxDuelistId;
}

/** Where every seat stands. 3-way: the plaza places. 4-way: the 2x2 grid, with the drawer of each pair. */
export function tablePlaces(state: SandboxBuilderState): TilePlace[] {
  const format = state.board.format;
  const out = new Set(state.board.eliminated ?? []);
  if (format === "ffa4") {
    const layout = tableLayout("ffa4", fakeEngine("ffa4", 4), 0);
    const cells = gridCells(layout);
    const states = new Map<number, CellState>(cells.map((cell) => [cell.seat, out.has(seatId(cell.seat)) ? "empty" : "live"]));
    const drawerOf = (column: 0 | 1) => pairDrawer(cells, states, column);
    const rowOf = (column: 0 | 1): 0 | 1 => {
      const seat = drawerOf(column);
      return cells.find((cell) => cell.seat === seat)?.row ?? 1;
    };
    const masterRule = (state.board.masterRule ?? 5) as DuelMasterRule;
    const grid = gridFocusLayout(gridWorld(masterRule), { width: STAGE_W, height: stageHeight("ffa4") }, null, { homeColumn: 0, drawerRow: [rowOf(0), rowOf(1)] });
    return cells.map((cell: GridCell) => {
      const rect: GridCellRect = grid.cells[cell.column * 2 + cell.row];
      const tone = layout.slots.find((slot) => slot.seat === cell.seat)?.tone ?? "violet";
      return {
        seat: seatId(cell.seat),
        x: rect.rect.x + rect.rect.width / 2,
        y: rect.rect.y + rect.rect.height / 2,
        scale: rect.rect.width / WIDE_W,
        rotateDeg: cell.rotateDeg,
        boxWidth: WIDE_W,
        place: cell.quadrant,
        column: cell.column,
        drawer: drawerOf(cell.column) === cell.seat,
        tone,
      };
    });
  }
  const layout = tableLayout("ffa3", fakeEngine("ffa3", 3), 0);
  const poses = seatPoses(layout, { mode: "home" });
  return layout.slots.map((slot) => {
    const pose = poses.get(slot.seat)!;
    return {
      seat: seatId(slot.seat),
      x: pose.x,
      y: pose.y,
      scale: pose.scale,
      rotateDeg: pose.rotateDeg,
      boxWidth: NARROW_W,
      place: pose.slot ?? "home",
      column: null,
      drawer: true,
      tone: slot.tone,
    };
  });
}

function fakeEngine(format: "ffa3" | "ffa4", count: number): Parameters<typeof tableLayout>[1] {
  return { format, seats: Array.from({ length: count }, (_, seat) => ({ seat })) } as unknown as Parameters<typeof tableLayout>[1];
}

/** Point of a field (relative to the centre of its box, native px) on the stage. */
function toStage(place: TilePlace, lx: number, ly: number): { x: number; y: number } {
  const turn = (place.rotateDeg * Math.PI) / 180;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  return { x: place.x + place.scale * (lx * cos - ly * sin), y: place.y + place.scale * (lx * sin + ly * cos) };
}

export interface SandboxTableViewProps {
  state: SandboxBuilderState;
  infos: CardInfoMap;
  armedCode: number | null;
  target: AddTarget;
  open: CardLoc | null;
  actions: SeatBoardActions;
  /** The seat quick add goes to. Its field gets a ring. */
  activeSeat?: SandboxDuelistId;
  /** A click on a seat badge, a pile or a pile chip picks that seat as the quick add seat. */
  onSelectSeat?: (seat: SandboxDuelistId) => void;
  /**
   * The In/Out toggle of a seat. The builder model has no `toggleEliminated` action yet: the owner of the model
   * supplies it (flip the seat in `board.eliminated` and clear its cards). Without it the toggle is disabled.
   */
  onToggleEliminated?: (seat: SandboxDuelistId) => void;
}

export function SandboxTableView({ state, infos, armedCode, target, open, actions, activeSeat, onSelectSeat, onToggleEliminated }: SandboxTableViewProps) {
  const { board } = state;
  const format = board.format;
  const rootRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [pile, setPile] = useState<{ seat: SandboxDuelistId; zone: PileZone } | null>(null);
  const [emzOwner, setEmzOwner] = useState<Partial<Record<0 | 1, SandboxDuelistId>>>({});
  // `width` is the room of the view (phone or not). `frameWidth` is the stage frame, which the height of the window caps.
  const width = useWidth(rootRef);
  const frameWidth = useWidth(frameRef, width);

  const seats = seatsOf(format);
  const out = useMemo(() => new Set(board.eliminated ?? []), [board.eliminated]);
  const places = useMemo(() => tablePlaces(state), [state]);
  const placeOf = useMemo(() => new Map(places.map((place) => [place.seat, place])), [places]);
  const stack = width < STACK_BELOW;
  const grid = format === "ffa4";
  const emz = slotCount(board, "monster") > 5;
  const domain = board.mode === "domain";
  const k = frameWidth / STAGE_W;
  const stageH = stageHeight(format);

  // The popover of an open slot is drawn in a fixed layer next to the slot, at full size.
  const openEntry = open ? getEntry(state, open) : null;
  const openIsSlot = open !== null && !isPile(open.zone) && openEntry !== null;
  const anchor = useAnchorRect(rootRef, openIsSlot ? open : null, [width, state]);

  // The pile drawer closes when its seat is gone.
  useEffect(() => {
    if (pile && !seats.includes(pile.seat)) setPile(null);
  }, [pile, seats]);

  function slotCell(seat: SandboxDuelistId, zone: SlotZone, index: number, label: string, outSeat: boolean): ReactNode {
    const loc: CardLoc = { seat, zone, index };
    const entry = getEntry(state, loc);
    return (
      <ZoneSlot
        key={`${seat}-${zone}-${index}`}
        label={label}
        zone={zone}
        loc={loc}
        entry={entry}
        info={entry === null ? undefined : infos.get(typeof entry === "number" ? entry : entry.card)}
        armed={armedCode !== null && !outSeat}
        active={sameLoc(open, loc)}
        disabled={outSeat}
        onActivate={() => {
          if (outSeat) return;
          onSelectSeat?.(seat);
          actions.onSlot(loc);
        }}
        onDropDrag={(drag) => {
          if (!outSeat) actions.onDropOnLoc(drag, loc);
        }}
      />
    );
  }

  /** The shared Extra Monster Zone `index` (5 or 6) of a facing pair: whoever holds a card there, else the chosen owner. */
  function sharedEmz(drawer: SandboxDuelistId, index: 5 | 6, column: 0 | 1): ReactNode {
    const partner = seatId(seatIndex(drawer) ^ 1);
    const pair = [drawer, partner].filter((seat) => !out.has(seat));
    const holders = pair.filter((seat) => getEntry(state, { seat, zone: "monster", index }) !== null);
    const chosen = emzOwner[column];
    const empty = chosen && pair.includes(chosen) ? chosen : drawer;
    const shown = holders.length > 0 ? holders : [empty];
    return (
      <div className={styles.emzCell} data-count={shown.length} data-emz-index={index}>
        {shown.map((seat) => slotCell(seat, "monster", index, MONSTER_LABEL[index], false))}
      </div>
    );
  }

  function pileChip(seat: SandboxDuelistId, zone: PileZone, variant: "side" | "lane", outSeat: boolean): ReactNode {
    const cards = ((board[seat]?.[zone] as readonly SandboxCardEntry[] | undefined) ?? []);
    return (
      <PileChip
        key={`${seat}-${zone}`}
        seat={seat}
        zone={zone}
        cards={cards}
        infos={infos}
        variant={variant}
        isTarget={target === zone && activeSeat === seat}
        isOpen={pile?.seat === seat && pile.zone === zone}
        disabled={outSeat}
        onOpen={() => {
          onSelectSeat?.(seat);
          actions.onSelectTarget(zone);
          setPile((current) => (current && current.seat === seat && current.zone === zone ? null : { seat, zone }));
        }}
        onDropDrag={(drag) => actions.onDropOnLoc(drag, { seat, zone, index: cards.length })}
      />
    );
  }

  function renderTile(place: TilePlace): ReactNode {
    const { seat } = place;
    const outSeat = out.has(seat);
    const hand = ((board[seat]?.hand as readonly SandboxCardEntry[] | undefined) ?? []);
    const drawEmz = emz && (!grid || place.drawer);
    // A phone stacks the fields at the narrow width, so the cards stay big enough to hit.
    const bw = stack ? NARROW_W : place.boxWidth;
    const flip = !stack && place.rotateDeg === 180;
    const style = {
      "--zw": bw === WIDE_W ? "112px" : "77px",
      "--tone": hexToRgbTriplet(SEAT_TONE_HEX[place.tone].main),
      "--turn": `${place.rotateDeg}deg`,
      width: `${bw}px`,
      height: `${TILE_H}px`,
      ...(stack
        ? { transform: `scale(${(width - 4) / bw})`, transformOrigin: "0 0" }
        : {
            left: `${place.x - bw / 2}px`,
            top: `${place.y - BOX_H / 2}px`,
            transform: `rotate(${place.rotateDeg}deg) scale(${place.scale})`,
            transformOrigin: `${bw / 2}px ${BOX_H / 2}px`,
            zIndex: place.drawer ? 2 : 1,
          }),
    } as unknown as CSSProperties;
    return (
      <div
        key={seat}
        className={styles.tile}
        style={style}
        data-seat-tile={seat}
        data-place={place.place}
        data-x={Math.round(place.x)}
        data-y={Math.round(place.y)}
        data-rotate={Math.round(place.rotateDeg)}
        data-drawer={grid && place.drawer ? "true" : undefined}
        data-out={outSeat ? "true" : undefined}
        data-flip={flip ? "true" : undefined}
        data-active={activeSeat === seat ? "true" : undefined}
      >
        <div className={styles.box} role="group" aria-label={`Field of ${seat.toUpperCase()}${outSeat ? ", out" : ""}`} inert={outSeat || undefined}>
          {drawEmz ? (
            <>
              <div className={styles.emzL}>
                {grid ? sharedEmz(seat, 5, place.column ?? 0) : slotCell(seat, "monster", 5, MONSTER_LABEL[5], outSeat)}
              </div>
              <div className={styles.emzR}>
                {grid ? sharedEmz(seat, 6, place.column ?? 0) : slotCell(seat, "monster", 6, MONSTER_LABEL[6], outSeat)}
              </div>
              {grid ? (
                <button
                  type="button"
                  className={styles.emzOwner}
                  data-turn={place.rotateDeg === 180 ? "true" : undefined}
                  title="An empty shared Extra Monster Zone takes cards for this seat. Click to switch."
                  aria-label={`Shared Extra Monster Zones, empty zones take cards for ${(emzOwner[place.column ?? 0] ?? seat).toUpperCase()}. Switch seat`}
                  onClick={() => {
                    const column = place.column ?? 0;
                    const partner = seatId(seatIndex(seat) ^ 1);
                    const current = emzOwner[column] ?? seat;
                    const next = current === seat ? partner : seat;
                    if (!out.has(next)) setEmzOwner((owners) => ({ ...owners, [column]: next }));
                  }}
                >
                  EMZ {(emzOwner[place.column ?? 0] ?? seat).toUpperCase()}
                </button>
              ) : null}
            </>
          ) : grid && emz && stack ? (
            <p className={styles.shared}>Extra Monster Zones are shared with {seatId(seatIndex(seat) ^ 1).toUpperCase()}.</p>
          ) : null}
          <div className={styles.fieldCell}>{slotCell(seat, "field", 0, "Field", outSeat)}</div>
          {[0, 1, 2, 3, 4].map((i) => <div key={`m${i}`} className={styles.mCell} style={{ gridColumn: i + 2 }}>{slotCell(seat, "monster", i, MONSTER_LABEL[i], outSeat)}</div>)}
          <div className={styles.graveCell}>{pileChip(seat, "grave", "side", outSeat)}</div>
          <div className={styles.pendL}>{slotCell(seat, "pendulum", 0, "Pendulum L", outSeat)}</div>
          {[0, 1, 2, 3, 4].map((i) => <div key={`s${i}`} className={styles.sCell} style={{ gridColumn: i + 2 }}>{slotCell(seat, "spell", i, `Spell/Trap ${i + 1}`, outSeat)}</div>)}
          <div className={styles.pendR}>{slotCell(seat, "pendulum", 1, "Pendulum R", outSeat)}</div>
        </div>
        <div className={styles.lane} data-stack={stack ? "true" : undefined} inert={outSeat || undefined}>
          <button
            type="button"
            className={styles.hand}
            data-open={pile?.seat === seat && pile.zone === "hand" ? "true" : undefined}
            aria-pressed={pile?.seat === seat && pile.zone === "hand"}
            aria-label={`Hand of ${seat.toUpperCase()}, ${hand.length} ${hand.length === 1 ? "card" : "cards"}. Open hand`}
            onClick={() => {
              onSelectSeat?.(seat);
              actions.onSelectTarget("hand");
              setPile((current) => (current && current.seat === seat && current.zone === "hand" ? null : { seat, zone: "hand" }));
            }}
          >
            {hand.slice(0, 9).map((entry, index) => {
              const code = typeof entry === "number" ? entry : entry.card;
              return <span key={`${index}-${code}`} className={styles.handCard}><CardThumb code={code} name={infos.get(code)?.name} /></span>;
            })}
            <span className={cn("num", styles.handCount)}>{hand.length}</span>
          </button>
          {LANE_PILES.map((zone) => pileChip(seat, zone, "lane", outSeat))}
          {domain ? (
            <div className={styles.dm}>
              {slotCell(seat, "deckMaster", 0, "Deck Master", outSeat)}
            </div>
          ) : null}
        </div>
        {outSeat ? <div className={styles.outLabel} aria-hidden>Out</div> : null}
      </div>
    );
  }

  function badge(place: TilePlace): ReactNode {
    const { seat } = place;
    const outSeat = out.has(seat);
    const index = seatIndex(seat);
    // The badge sits on the plate side of the lane. A field turned 180 has it on the left of the screen, as the grid does.
    const flip = place.rotateDeg === 180;
    const side = flip ? 1 : -1;
    const at = toStage(place, side * (place.boxWidth / 2 - PLATE_W / 2), BOX_H / 2 + LANE_GAP + LANE_H / 2);
    const tone = hexToRgbTriplet(SEAT_TONE_HEX[place.tone].main);
    const badgeW = Math.max(BADGE_MIN_W, PLATE_W * place.scale * k - 4);
    const x = Math.min(Math.max(at.x * k, badgeW / 2 + 3), STAGE_W * k - badgeW / 2 - 3);
    const y = Math.min(Math.max(at.y * k, BADGE_H / 2 + 3), stageH * k - BADGE_H / 2 - 3);
    const style = (stack ? { "--tone": tone } : { left: `${x}px`, top: `${y}px`, width: `${badgeW}px`, "--tone": tone }) as unknown as CSSProperties;
    return (
      <div
        key={`badge-${seat}`}
        className={styles.badge}
        style={style}
        data-seat-badge={seat}
        data-out={outSeat ? "true" : undefined}
        data-active={activeSeat === seat ? "true" : undefined}
      >
        <div className={styles.badgeRow}>
          <button type="button" className={styles.badgeName} onClick={() => onSelectSeat?.(seat)} aria-label={`Pick ${seat.toUpperCase()} for quick add`} aria-pressed={activeSeat === seat}>
            {seat.toUpperCase()}{index === 0 ? <span> You</span> : null}
          </button>
          <button
            type="button"
            className={styles.toggle}
            role="switch"
            aria-checked={!outSeat}
            aria-label={`${seat.toUpperCase()} is ${outSeat ? "out" : "in"}. Switch to ${outSeat ? "in" : "out"}`}
            disabled={!onToggleEliminated}
            title={onToggleEliminated ? (outSeat ? "Put this seat back in the duel" : "Take this seat out of the duel") : "Not available yet"}
            onClick={() => onToggleEliminated?.(seat)}
          >
            <span data-on={!outSeat ? "true" : undefined}>In</span>
            <span data-on={outSeat ? "true" : undefined}>Out</span>
          </button>
        </div>
        <LpField state={state} seat={seat} act={actions.act} />
      </div>
    );
  }

  const ordered = seats.map((seat) => placeOf.get(seat)).filter((place): place is TilePlace => place !== undefined);
  const pileSetup = pile ? board[pile.seat] : undefined;
  const pileCards: readonly SandboxCardEntry[] = pile ? ((pileSetup?.[pile.zone] as readonly SandboxCardEntry[] | undefined) ?? []) : [];
  const openIndex = pile && open && open.seat === pile.seat && open.zone === pile.zone ? open.index : null;
  const deckSize = board.deckSize ?? 20;

  return (
    <div className={styles.root} ref={rootRef} data-format={format} data-layout={stack ? "stack" : "table"}>
      {stack ? (
        <div className={styles.stackList}>
          {ordered.map((place) => (
            <section key={place.seat} className={styles.stackItem}>
              {badge(place)}
              <div className={styles.stackTile} style={{ height: `${TILE_H * ((width - 4) / NARROW_W)}px` }}>{renderTile(place)}</div>
            </section>
          ))}
        </div>
      ) : (
        <div className={styles.frame} ref={frameRef} style={{ height: `${stageH * k}px`, maxWidth: `calc((100dvh - var(--sbx-table-chrome)) * ${STAGE_W / stageH})` }}>
          <div className={styles.stage} style={{ transform: `scale(${k})` }} data-table={format}>
            <div className={styles.floor} aria-hidden />
            {ordered.map(renderTile)}
          </div>
          <div className={styles.badges}>{ordered.map(badge)}</div>
        </div>
      )}

      {pile ? (
        <div className={styles.drawer} data-sbx-slot role="group" aria-label={`Pile drawer of ${pile.seat.toUpperCase()}`}>
          <div className={styles.drawerHead}>
            <strong>{pile.seat.toUpperCase()}</strong>
            <button type="button" className={seatStyles.iconBtn} aria-label="Close pile" onClick={() => setPile(null)}><X size={14} aria-hidden /></button>
          </div>
          <PileRow
            seat={pile.seat}
            zone={pile.zone}
            cards={pileCards}
            infos={infos}
            isTarget={target === pile.zone && activeSeat === pile.seat}
            armedCode={armedCode}
            note={pile.zone === "deck" ? <>+ {Math.max(0, deckSize - pileCards.length)} filler <span className="sr">cards below</span></> : undefined}
            openIndex={openIndex}
            onSelectTarget={() => {
              onSelectSeat?.(pile.seat);
              actions.onSelectTarget(pile.zone);
            }}
            onToggleCard={(i) => actions.onOpen(openIndex === i ? null : { seat: pile.seat, zone: pile.zone, index: i })}
            onAddArmed={() => {
              onSelectSeat?.(pile.seat);
              actions.onAddArmedToPile(pile.zone);
            }}
            onClear={() => actions.act({ type: "clearZone", seat: pile.seat, zone: pile.zone })}
            onDropDrag={(drag, i) => actions.onDropOnLoc(drag, { seat: pile.seat, zone: pile.zone, index: i })}
            renderPopover={(i) => {
              const loc: CardLoc = { seat: pile.seat, zone: pile.zone, index: i };
              const entry = getEntry(state, loc);
              return entry === null ? null : (
                <CardPopover loc={loc} entry={entry} infos={infos} armedCode={armedCode} onAction={actions.act} onClose={() => actions.onOpen(null)} onAddMaterialByName={actions.onAddMaterialByName} />
              );
            }}
          />
        </div>
      ) : null}

      {openIsSlot && open && openEntry !== null ? (
        <div
          className={styles.popLayer}
          data-sbx-slot
          style={{ left: anchor.left, top: anchor.top, width: anchor.width, height: anchor.height }}
        >
          <CardPopover
            loc={open}
            entry={openEntry}
            infos={infos}
            armedCode={armedCode}
            onAction={actions.act}
            onClose={() => actions.onOpen(null)}
            onAddMaterialByName={actions.onAddMaterialByName}
          />
        </div>
      ) : null}
    </div>
  );
}

/** The width of an element, kept current. `fallback` stands in before the first measure (and in a test DOM with no layout). */
function useWidth(ref: React.RefObject<HTMLElement | null>, fallback = FALLBACK_WIDTH): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  });
  return width > 0 ? width : fallback;
}

function isPile(zone: string): zone is PileZone {
  return zone === "hand" || zone === "deck" || zone === "grave" || zone === "banished" || zone === "extra";
}

/** The screen rect of the slot of an open card, kept current while the window changes. */
function useAnchorRect(root: React.RefObject<HTMLElement | null>, loc: CardLoc | null, deps: readonly unknown[]) {
  const [rect, setRect] = useState({ left: 0, top: 0, width: 0, height: 0 });
  const key = loc ? `${loc.seat}:${loc.zone}:${loc.index}` : null;
  useLayoutEffect(() => {
    if (!key) return;
    const measure = () => {
      const el = root.current?.querySelector(`[data-sbx-loc="${key}"]`);
      if (!el) return;
      const box = el.getBoundingClientRect();
      setRect((prev) => (prev.left === box.left && prev.top === box.top && prev.width === box.width && prev.height === box.height ? prev : { left: box.left, top: box.top, width: box.width, height: box.height }));
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, root, ...deps]);
  return rect;
}

const CHIP_NAME: Record<PileZone, string> = { hand: "Hand", deck: "Deck", extra: "Extra", grave: "GY", banished: "Banish" };

/** A pile of a field as a small stack: the top card and the count. A click opens it in the drawer. */
function PileChip({ seat, zone, cards, infos, variant, isTarget, isOpen, disabled, onOpen, onDropDrag }: {
  seat: SandboxDuelistId;
  zone: PileZone;
  cards: readonly SandboxCardEntry[];
  infos: CardInfoMap;
  variant: "side" | "lane";
  isTarget: boolean;
  isOpen: boolean;
  disabled: boolean;
  onOpen: () => void;
  onDropDrag: (drag: Parameters<Parameters<typeof useDropTarget>[0]>[0]) => void;
}) {
  const drop = useDropTarget(onDropDrag);
  const top = cards[cards.length - 1];
  const code = top === undefined ? 0 : typeof top === "number" ? top : top.card;
  const title = zoneName(zone);
  return (
    <button
      type="button"
      className={styles.chip}
      data-variant={variant}
      data-zone={zone}
      data-has={cards.length > 0 ? "true" : undefined}
      data-target={isTarget ? "true" : undefined}
      data-open={isOpen ? "true" : undefined}
      data-over={drop.over ? "true" : undefined}
      disabled={disabled}
      aria-pressed={isOpen}
      aria-label={`${title} of ${seat.toUpperCase()}, ${cards.length} ${cards.length === 1 ? "card" : "cards"}. Open ${title}`}
      title={`${title} (${cards.length})`}
      onClick={onOpen}
      {...drop.props}
    >
      {code ? <span className={styles.chipArt}><CardThumb code={code} name={infos.get(code)?.name} /></span> : null}
      <span className={styles.chipName}>{CHIP_NAME[zone]}</span>
      <span className={cn("num", styles.chipCount)}>{cards.length}</span>
    </button>
  );
}
