"use client";

/**
 * The cube-night draft room: the full-screen layer shown while a draft is active.
 * Ported from the approved mock; the simulator is replaced by the live draft (see use-room-state.ts).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useDraftStore } from "@/lib/stores/draft-store";
import { Binder, type BinderHandle, type Tab } from "./binder";
import { CardReader } from "./card-reader";
import { Holo, type HoloTarget } from "./holo";
import { FullscreenLayer } from "./layer";
import { MotionMenu } from "./motion-menu";
import { animate, flight, motionOff, useMotionSetting, wait } from "./motion";
import { RoomBar } from "./room-bar";
import {
  EMPTY_FILTER,
  KINDS,
  attributeTint,
  dialModel,
  filterWords,
  isFiltering,
  joinNames,
  kindOf,
  matchesFilter,
  passLabel,
  seatPackSize,
  themeProgress,
  tint,
  toggled,
  urgencyFor,
  countKinds,
  type Kind,
  type RoomCard,
  type RoomConfigLike,
  type RoomFilter,
  type SeatState,
} from "./room-model";
import { SeatStrip, Seats, type FriendView } from "./seats";
import { measureTable } from "./table-geometry";
import { Table } from "./table";
import { Tray } from "./tray";
import { useMedia } from "./use-media";
import { usePick, type PickAttempt } from "./use-pick";
import { useRoomState } from "./use-room-state";

export interface DraftRoomProps {
  slug: string;
  name: string;
  config: RoomConfigLike;
  isParticipant: boolean;
}

const PHONE = "(max-width: 900px)";
const DRAWER = "(max-width: 1359px) and (min-width: 901px)";
// seconds left on the store clock at which a selected card is picked; early enough for the POST to beat the server sweep
const AUTO_PICK_AT = 2;

const parseNumberKey = (key: string): number | null => {
  if (key >= "1" && key <= "9") return Number(key);
  if (key.startsWith("Numpad") && key.length === 7 && key[6] >= "1" && key[6] <= "9") return Number(key[6]);
  return null;
};

const inField = (t: EventTarget | null) => t instanceof Element && !!t.closest("input, textarea, select");

export function DraftRoom({ slug, name, config, isParticipant }: DraftRoomProps) {
  const rs = useRoomState(slug, config, isParticipant);
  const { sizes, deal, turn, direction } = rs;
  const [motion, setMotion] = useMotionSetting();
  const phone = useMedia(PHONE);
  const drawer = useMedia(DRAWER);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const motionBtn = useRef<HTMLButtonElement>(null);
  const binderRef = useRef<BinderHandle>(null);
  const [stage, setStage] = useState<HTMLElement | null>(null);

  /* ---------- state ---------- */
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [peek, setPeek] = useState<{ card: RoomCard; tag: string } | null>(null);
  const [lastPick, setLastPick] = useState<RoomCard | null>(null);
  const [pickNote, setPickNote] = useState<string | null>(null);
  const sentPicks = useRef<{ stepKey: string | null; ids: Set<number> }>({ stepKey: null, ids: new Set() });
  const currentDeal = useRef(deal);
  currentDeal.current = deal;
  const [tab, setTab] = useState<Tab>("mine");
  const [filter, setFilter] = useState<RoomFilter>(EMPTY_FILTER);
  const [sheet, setSheet] = useState<"card" | "binder" | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [motionOpen, setMotionOpen] = useState(false);
  const [kbd, setKbd] = useState(false);
  const [newId, setNewId] = useState<number | null>(null);
  const [landed, setLanded] = useState<{ kind: Kind; seq: number } | null>(null);
  const [pending, setPending] = useState<ReadonlySet<number>>(new Set());
  const [ribbon, setRibbon] = useState<{ title: string; sub: string; tone: string; key: number } | null>(null);
  const [ribbonOn, setRibbonOn] = useState(false);
  const [passing, setPassing] = useState(false);
  const [positions, setPositions] = useState<Record<number, { x: number; y: number }>>({});
  const [size, setSize] = useState({ w: 1100, h: 700, diskH: 112 });
  const clicking = useRef(false);

  const theme = sizes.theme;
  const pool = useMemo(() => rs.pool.filter((c) => !pending.has(c.id)), [rs.pool, pending]);
  const poolCount = pool.length;
  const tp = themeProgress(poolCount, sizes);
  const phase: "main" | "extra" = theme && tp.inExtra ? "extra" : "main";
  const urgency = useDraftStore((s) => urgencyFor(s.timerSeconds, turn));

  /* ---------- geometry ---------- */
  useLayoutEffect(() => {
    if (!stage) return;
    const measure = () => {
      const r = stage.getBoundingClientRect();
      const diskH =
        parseFloat(getComputedStyle(rootRef.current ?? stage).getPropertyValue("--disk-h")) || 112;
      setSize((cur) =>
        Math.abs(cur.w - r.width) < 1 && Math.abs(cur.h - r.height) < 1 && cur.diskH === diskH
          ? cur
          : { w: r.width, h: r.height, diskH },
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [stage]);
  const geometry = useMemo(
    () => measureTable({ width: size.w, height: size.h, phone, theme, diskH: size.diskH }),
    [size, phone, theme],
  );

  const seatCount = rs.tableSeats.length;
  // friends are drawn upright in the room, pinned to where their anchor lands on the tilted table
  useLayoutEffect(() => {
    if (!stage) return;
    const place = () => {
      const sr = stage.getBoundingClientRect();
      const next: Record<number, { x: number; y: number }> = {};
      stage.querySelectorAll<HTMLElement>(".anchor[data-anchor]").forEach((a) => {
        const i = Number(a.dataset.anchor);
        if (!i) return;
        const r = a.getBoundingClientRect();
        next[i] = { x: Math.round(r.left - sr.left), y: Math.round(r.top - sr.top) };
      });
      setPositions((cur) => {
        const keys = Object.keys(next);
        const same = keys.length === Object.keys(cur).length && keys.every((k) => cur[+k]?.x === next[+k].x && cur[+k]?.y === next[+k].y);
        return same ? cur : next;
      });
    };
    place();
    const raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
  }, [stage, geometry, seatCount]);

  /* ---------- sheets ---------- */
  const binderOpen = phone ? sheet === "binder" : drawer ? drawerOpen : true;
  const openSheet = useCallback(
    (which: "card" | "binder") => {
      if (phone) {
        setSheet(which);
        setDrawerOpen(false);
      } else if (which === "binder" && drawer) setDrawerOpen(true);
    },
    [phone, drawer],
  );
  const closeSheets = useCallback(() => {
    setSheet(null);
    setDrawerOpen(false);
  }, []);
  const closeCardSheet = useCallback(() => setSheet((s) => (s === "card" ? null : s)), []);
  useEffect(() => {
    setSelectedId(null);
    closeSheets();
  }, [phone, drawer, closeSheets]);

  /* ---------- a new deal: forget the last selection ---------- */
  useEffect(() => {
    setSelectedId(null);
    setHoverId(null);
    setPeek(null);
    setPickNote(null);
    setPassing(false);
    closeCardSheet();
  }, [deal.seq, closeCardSheet]);
  useEffect(() => {
    if (selectedId != null && !rs.cards.some((c) => c.id === selectedId)) setSelectedId(null);
  }, [rs.cards, selectedId]);
  useEffect(() => {
    if (rs.settle > 0) setPassing(true);
  }, [rs.settle]);

  /* ---------- picking ---------- */
  const flightRef = useRef<{ card: RoomCard; from: DOMRect | null; to: DOMRect | null } | null>(null);
  const reconcilePick = useCallback((attempt: PickAttempt, pool: RoomCard[]) => {
    const card = pool.find((c) => attempt.packIds.has(c.id)) ?? null;
    setLastPick(card);
    if (currentDeal.current.stepKey !== attempt.stepKey) return;
    if (card) rs.picked(card.id);
    else rs.unpicked();
    const sentHere = sentPicks.current.stepKey === attempt.stepKey && card && sentPicks.current.ids.has(card.id);
    setPickNote(card && !sentHere ? `Time ran out. You got ${card.name}.` : null);
  }, [rs.picked, rs.unpicked]);

  // Polls also resolve picks made by the timer or another tab.
  useEffect(() => {
    if (deal.stepKey == null || deal.stepKey !== rs.stepKey || !deal.dealt.length) return;
    const packIds = new Set(deal.dealt.map((c) => c.id));
    if (rs.pool.some((c) => packIds.has(c.id))) {
      reconcilePick({ stepKey: deal.stepKey, packIds }, rs.pool);
    }
  }, [deal.stepKey, deal.dealt, rs.stepKey, rs.pool, reconcilePick]);

  const landCard = useCallback((card: RoomCard) => {
    setPending((cur) => {
      const next = new Set(cur);
      next.delete(card.id);
      return next;
    });
    setLanded((cur) => ({ kind: kindOf(card), seq: (cur?.seq ?? 0) + 1 }));
    setNewId(card.id);
  }, []);
  const hooks = useMemo(
    () => ({
      onSent: (cardId: number, attempt: PickAttempt) => {
        if (sentPicks.current.stepKey !== attempt.stepKey) {
          sentPicks.current = { stepKey: attempt.stepKey, ids: new Set() };
        }
        sentPicks.current.ids.add(cardId);
        const f = flightRef.current;
        flightRef.current = null;
        const card = f?.card ?? useDraftStore.getState().myPool.find((c) => c.id === cardId);
        if (!card) return;
        rs.picked(cardId);
        setSelectedId(null);
        setHoverId(null);
        setPeek(null);
        setLastPick(card);
        setPickNote(null);
        closeCardSheet();
        if (!f || !f.from || !f.to || motionOff()) {
          landCard(card);
          return;
        }
        setPending((cur) => new Set(cur).add(cardId));
        let landedOnce = false;
        const land = () => {
          if (landedOnce) return;
          landedOnce = true;
          landCard(card);
        };
        flight({
          layer: layerRef.current,
          from: f.from,
          to: f.to,
          src: card.imageUrlSmall || card.imageUrl,
          glow: tint(card).main,
          arc: window.matchMedia?.(PHONE).matches ? 60 : 140,
          duration: 640,
        }).then(land);
        // a hidden tab can stall animations: land anyway
        wait(1500).then(land);
      },
      onRejected: () => {
        rs.unpicked();
        setLastPick(null);
        setPickNote(null);
        setPending(new Set());
      },
      onReconciled: reconcilePick,
    }),
    // rs.picked / rs.unpicked are stable callbacks
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rs.picked, rs.unpicked, closeCardSheet, landCard, reconcilePick],
  );
  const { pick, pending: pickPending } = usePick(slug, hooks);

  const doPick = useCallback(
    (cardId: number): Promise<boolean> => {
      const root = rootRef.current;
      const card = deal.dealt.find((c) => c.id === cardId);
      if (!root || !card) return Promise.resolve(false);
      const el = root.querySelector<HTMLElement>(`.tcard[data-id="${cardId}"] .face`);
      const win = root.querySelector<HTMLElement>(`.slot[data-kind="${kindOf(card)}"] .win`);
      flightRef.current = {
        card,
        from: el ? el.getBoundingClientRect() : null,
        to: win ? win.getBoundingClientRect() : null,
      };
      return pick(cardId).then((sent) => {
        if (!sent) flightRef.current = null;
        return sent;
      });
    },
    [deal.dealt, pick],
  );

  useEffect(() => {
    if (rs.completed) setPending(new Set());
  }, [rs.completed]);

  /* ---------- time's nearly up: a selected card is the pick (hover alone never counts) ---------- */
  const lastCall = useDraftStore((s) => s.timerSeconds <= AUTO_PICK_AT);
  const autoPicked = useRef(-1);
  useEffect(() => {
    if (!lastCall || pickPending || turn !== "picking" || rs.completed || selectedId == null) return;
    if (autoPicked.current === deal.seq || !deal.dealt.some((c) => c.id === selectedId)) return;
    const seq = deal.seq;
    void doPick(selectedId).then((sent) => {
      if (sent) autoPicked.current = seq;
    });
  }, [lastCall, pickPending, turn, rs.completed, selectedId, deal.seq, deal.dealt, doPick]);

  /* ---------- selecting ---------- */
  const select = useCallback(
    (id: number | null, focus: boolean) => {
      if (turn !== "picking") return;
      setSelectedId(id);
      if (id == null) return;
      if (focus) {
        const el = rootRef.current?.querySelector<HTMLElement>(`.tcard[data-id="${id}"]`);
        if (el && document.activeElement !== el) el.focus({ preventScroll: true });
      }
      if (phone) openSheet("card");
    },
    [turn, phone, openSheet],
  );
  const onCardClick = useCallback(
    (card: RoomCard) => {
      if (turn !== "picking") return;
      if (phone) return select(card.id, false);
      if (selectedId === card.id) return doPick(card.id);
      select(card.id, false);
    },
    [turn, phone, selectedId, select, doPick],
  );
  const onCardFocus = useCallback(
    (card: RoomCard) => {
      if (!clicking.current) select(card.id, false);
    },
    [select],
  );
  const onCardPointerDown = useCallback(() => {
    clicking.current = true;
    setTimeout(() => (clicking.current = false), 0);
    setKbd(false);
  }, []);
  const onCardHover = useCallback(
    (card: RoomCard | null) => setHoverId(turn === "picking" && card ? card.id : null),
    [turn],
  );

  /* ---------- the hologram ---------- */
  const [holoTarget, setHoloTarget] = useState<HoloTarget | null>(null);
  const holoId = hoverId ?? selectedId;
  useLayoutEffect(() => {
    if (phone || turn !== "picking" || holoId == null) {
      setHoloTarget(null);
      return;
    }
    const card = rs.cards.find((c) => c.id === holoId);
    const el = rootRef.current?.querySelector<HTMLElement>(`.tcard[data-id="${holoId}"]`);
    setHoloTarget(card && el ? { card, el, partial: holoId !== selectedId } : null);
  }, [holoId, selectedId, phone, turn, rs.cards, geometry, deal.seq]);

  /* ---------- the filter: one lens for the binder and the table ---------- */
  const filtering = isFiltering(filter);
  const lens = useMemo(
    () => (filtering && turn !== "done" ? (card: RoomCard) => matchesFilter(card, filter) : null),
    [filtering, filter, turn],
  );
  const clearFilter = useCallback(() => setFilter(EMPTY_FILTER), []);
  const lensHits = lens ? rs.cards.filter(lens).length : 0;

  /* ---------- the ribbon ---------- */
  const ribbonSeq = useRef(0);
  useEffect(() => {
    if (deal.seq === 0) return;
    if (theme) {
      if (poolCount === 0 && deal.seq === 1) {
        setRibbon({ title: "Theme draft", sub: "Private packs. Nothing passes.", tone: "", key: ++ribbonSeq.current });
      } else if (sizes.extraSize > 0 && poolCount === sizes.cardsPerPlayer) {
        setRibbon({
          title: "Extra deck",
          sub: `Main deck done. Pick ${sizes.extraSize} for your Extra Deck.`,
          tone: "extra",
          key: ++ribbonSeq.current,
        });
      }
      return;
    }
    if (rs.pickStep === 1) {
      setRibbon({ title: `Pack ${rs.packRound}`, sub: passLabel(direction), tone: "", key: ++ribbonSeq.current });
    }
    // only a new deal raises the ribbon
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal.seq]);
  const ribbonRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ribbon) return;
    setRibbonOn(true);
    const r = ribbonRef.current;
    let alive = true;
    const hide = () => alive && setRibbonOn(false);
    if (motionOff() || !r) {
      wait(1300).then(hide);
    } else {
      Promise.all([
        animate(
          r,
          [
            { opacity: 0, transform: "scaleX(0.1)" },
            { opacity: 1, transform: "scaleX(1)", offset: 0.18 },
            { opacity: 1, transform: "scaleX(1)", offset: 0.82 },
            { opacity: 0, transform: "scaleX(1)" },
          ],
          { duration: 1500, easing: "cubic-bezier(0.2,0.8,0.25,1)" },
        ),
        animate(r.querySelector("b"), [{ letterSpacing: "0.14em", opacity: 0 }, { letterSpacing: "0.02em", opacity: 1 }], {
          duration: 420,
          delay: 80,
          fill: "backwards",
        }),
      ]).then(hide);
      wait(2200).then(hide);
    }
    return () => {
      alive = false;
    };
  }, [ribbon]);

  /* ---------- friends passing their packs ---------- */
  const packRect = useCallback(
    (seat: number): DOMRect | null => {
      const root = rootRef.current;
      if (!root) return null;
      const sel = phone ? `.chip-seat[data-seat="${seat}"] .mp` : `.seat[data-seat="${seat}"] .pk i`;
      return root.querySelector(sel)?.getBoundingClientRect() ?? null;
    },
    [phone],
  );
  const lastSettle = useRef(0);
  useEffect(() => {
    if (rs.settle === 0 || rs.settle === lastSettle.current) return;
    lastSettle.current = rs.settle;
    if (theme || motionOff() || rs.cards.length === 0 || poolCount >= sizes.cardsPerPlayer) return;
    const n = seatCount;
    const back = phase === "extra" ? "/duel/card-back-extra-hd.webp" : "/duel/card-back-main-hd.webp";
    for (let i = 1; i < n; i++) {
      const to = (i + direction + n) % n;
      const from = packRect(i);
      if (!from) continue;
      let dest: { left: number; top: number; width: number; height: number } | null;
      if (to === 0) {
        const z = rootRef.current?.querySelector(".dr-table")?.getBoundingClientRect();
        dest = z ? { left: z.left + z.width / 2 - from.width, top: z.top + z.height * 0.45, width: from.width * 2, height: from.height * 2 } : null;
      } else dest = packRect(to);
      if (!dest) continue;
      void flight({
        layer: layerRef.current,
        from,
        to: dest,
        src: back,
        glow: "228 182 79",
        arc: phone ? 26 : 70,
        duration: 640,
        swell: 0.3,
        keepRatio: true,
        rotate: direction * 12,
        className: "pack-ghost",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rs.settle]);

  /* ---------- derived views ---------- */
  const waitingOn = useMemo(
    () => rs.seats.filter((s) => !s.isCurrentPlayer && !s.hasPicked).map((s) => s.displayName),
    [rs.seats],
  );
  const friends: FriendView[] = useMemo(
    () =>
      rs.tableSeats
        .filter((t) => !t.isMe && t.seat)
        .map((t) => {
          const seat = t.seat!;
          const state: SeatState = passing ? "passing" : seat.hasPicked ? "picked" : "picking";
          return {
            index: t.index,
            seat,
            state,
            packN: seatPackSize({
              packSize: theme ? sizes.themePackSize : sizes.packSize,
              pickStep: rs.pickStep,
              hasPicked: seat.hasPicked,
            }),
          };
        }),
    [rs.tableSeats, passing, theme, sizes.themePackSize, sizes.packSize, rs.pickStep],
  );

  const dial = dialModel(pool, sizes);
  const poolCounts = useMemo(() => countKinds(pool), [pool]);
  const last = useMemo(() => {
    const out: Partial<Record<Kind, RoomCard>> = {};
    for (const c of [...pool].reverse()) {
      const k = kindOf(c);
      if (!out[k]) out[k] = c;
    }
    return out;
  }, [pool]);

  let status: React.ReactNode = null;
  if (isParticipant) {
    if (turn === "settling") {
      const willPass = !theme && rs.cards.length > 0 && poolCount < sizes.cardsPerPlayer;
      status = willPass
        ? `Everyone's in. Passing ${direction > 0 ? "left" : "right"}.`
        : theme
          ? "Everyone's in. Next round."
          : "Pack finished.";
    } else if (turn === "waiting" && waitingOn.length) {
      status = (
        <>
          Picked. Waiting on <em>{joinNames(waitingOn)}</em>
        </>
      );
    }
  }

  // the card in the reader
  const dealtCard = (id: number | null) => (id == null ? null : (rs.cards.find((c) => c.id === id) ?? null));
  const reading = turn === "picking" ? (dealtCard(hoverId) ?? dealtCard(selectedId)) : null;
  const peeking = peek && !hoverId ? peek : null;
  const showLast = !!lastPick && turn !== "picking";
  const readerCard = peeking?.card ?? reading ?? (showLast ? lastPick : null);
  const readerTag = peeking
    ? peeking.tag
    : reading
      ? reading.id === selectedId
        ? "Selected"
        : ""
      : showLast
        ? "Your pick"
        : "";
  const pickable = !!reading && turn === "picking";

  /* ---------- keys: 1-9 choose, arrows move, Enter picks, / searches, Esc closes ---------- */
  const latest = useRef({ rs, turn, selectedId, geometry, phone, drawer, binderOpen, motionOpen, doPick, select, openSheet, closeSheets });
  latest.current = { rs, turn, selectedId, geometry, phone, drawer, binderOpen, motionOpen, doPick, select, openSheet, closeSheets };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const L = latest.current;
      if (inField(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const num = parseNumberKey(e.key);
      if (num != null || e.key.startsWith("Arrow")) setKbd(true);
      if (e.key === "/") {
        e.preventDefault();
        if (L.phone || L.drawer) L.openSheet("binder");
        requestAnimationFrame(() => binderRef.current?.focusSearch());
        return;
      }
      const order = L.rs.cards.map((c) => c.id);
      if (num != null) {
        e.preventDefault();
        if (order[num - 1] != null) L.select(order[num - 1], true);
      } else if (e.key.startsWith("Arrow")) {
        e.preventDefault();
        if (!order.length) return;
        let i = Math.max(0, order.indexOf(L.selectedId ?? -1));
        const cols = order.length <= 4 ? order.length : L.geometry.cols;
        if (L.selectedId == null) i = 0;
        else if (e.key === "ArrowLeft") i = Math.max(0, i - 1);
        else if (e.key === "ArrowRight") i = Math.min(order.length - 1, i + 1);
        else if (e.key === "ArrowUp") i = Math.max(0, i - cols);
        else if (e.key === "ArrowDown") i = Math.min(order.length - 1, i + cols);
        L.select(order[i], true);
      } else if (e.key === "Enter") {
        // a focused button handles its own Enter
        if (e.target instanceof Element && e.target.closest("button")) return;
        if (L.selectedId != null && L.turn === "picking") {
          e.preventDefault();
          L.doPick(L.selectedId);
        }
      } else if (e.key === "Escape") {
        if (L.motionOpen) return;
        if (L.binderOpen && (L.phone || L.drawer)) return L.closeSheets();
        L.closeSheets();
        setSelectedId(null);
      }
    };
    const onDown = () => setKbd(false);
    document.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, []);

  /* ---------- binder, tray and dial ---------- */
  const showBinder = useCallback(
    (which: Tab) => {
      setTab(which);
      openSheet("binder");
    },
    [openSheet],
  );
  const onDial = () => {
    if (phone || drawer) {
      if (binderOpen) closeSheets();
      else showBinder("mine");
    } else binderRef.current?.focusSearch();
  };
  const onKind = (k: Kind) => {
    const next = toggled(filter.kinds, k);
    setFilter({ ...filter, kinds: next });
    if ((phone || drawer) && next.has(k) && !binderOpen) showBinder("mine");
  };

  const subline = theme
    ? `${rs.seats.length} at the table, private packs of ${sizes.themePackSize}`
    : `${rs.seats.length} at the table, ${sizes.packSize}-card packs`;
  const phaseDone = theme ? tp.drafted : 0;
  const attrs = {
    "data-turn": turn,
    "data-dir": String(direction),
    "data-phase": phase,
    "data-mode": theme ? "theme" : "booster",
    "data-urgency": urgency || undefined,
    "data-motion": motion,
    "data-kbd": kbd ? "" : undefined,
    "data-sheet": phone && sheet ? sheet : undefined,
    "data-binder": !phone && drawer && drawerOpen ? "" : undefined,
  };
  const pickConfig = useMemo(
    () => ({ theme, packSize: sizes.packSize, cardsPerPlayer: sizes.cardsPerPlayer }),
    [theme, sizes.packSize, sizes.cardsPerPlayer],
  );

  return (
    <FullscreenLayer ref={rootRef} label="Draft room" attrs={attrs}>
      <div className="room">
        <RoomBar
          ref={motionBtn}
          name={name}
          sub={subline}
          motion={motion}
          motionOpen={motionOpen}
          onMotion={() => setMotionOpen((v) => !v)}
          progress={Math.min(1, poolCount / Math.max(1, sizes.total))}
          where={{
            theme,
            extra: phase === "extra",
            packRound: rs.packRound,
            packsPerPlayer: sizes.packsPerPlayer,
            pickStep: rs.pickStep,
            packSize: sizes.packSize,
            direction,
            phaseDone,
            phaseOf: tp.of,
          }}
        />
        <SeatStrip friends={friends} />
        <div className="body">
          <CardReader
            card={readerCard}
            tag={readerTag}
            pickNote={showLast && !peeking ? pickNote : null}
            buttonHidden={!!peeking || turn === "done"}
            pickable={pickable}
            myTurn={turn === "picking"}
            waitingOn={waitingOn}
            showWaiting={!reading && !peeking && showLast}
            phone={phone}
            onPick={() => reading && doPick(reading.id)}
            onClose={() => {
              closeSheets();
              setSelectedId(null);
            }}
          />
          <div
            className="scrim"
            onClick={() => {
              const card = sheet === "card";
              closeSheets();
              if (card) setSelectedId(null);
            }}
          />
          <section className="stage" aria-label="Draft table" ref={setStage}>
            <Table
              geometry={geometry}
              deal={deal}
              theme={theme}
              phase={phase}
              turn={turn}
              direction={direction}
              seatCount={seatCount}
              settle={rs.settle}
              stepKey={rs.stepKey}
              pickSeconds={rs.pickSeconds}
              stackLabel={<small>{phase === "extra" ? "Extra deck pool" : "Main deck pool"}</small>}
              selectedId={selectedId}
              lens={lens}
              getLayer={() => layerRef.current}
              packRect={packRect}
              onCardClick={onCardClick}
              onCardFocus={onCardFocus}
              onCardPointerDown={onCardPointerDown}
              onCardHover={onCardHover}
            />
            <Seats friends={friends} positions={positions} theme={theme} />
            <Holo target={holoTarget} stage={stage} />
            <div className="notes">
              <div className="status" role="status" data-on={status ? "" : undefined}>
                {status}
              </div>
              <div className="wheel" hidden={!rs.wheel || theme}>
                {rs.wheel ? (
                  <>
                    <span className="lede">
                      <b>Back around.</b> {rs.wheel.cards.length} gone since pick {rs.wheel.from}
                    </span>
                    <span className="thumbs">
                      {rs.wheel.cards.slice(0, 6).map((c) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={c.id} src={c.imageUrlSmall || c.imageUrl} alt={c.name} title={c.name} />
                      ))}
                    </span>
                    <button type="button" onClick={() => showBinder("gone")}>
                      See what went
                    </button>
                  </>
                ) : null}
              </div>
            </div>
            <div className="lens" hidden={!lens}>
              <span>
                {rs.cards.length ? (
                  <>
                    <b>
                      {lensHits} of {rs.cards.length}
                    </b>{" "}
                    in this pack: {filterWords(filter)}
                  </>
                ) : (
                  <>Filter: {filterWords(filter)}</>
                )}
              </span>
              <button type="button" onClick={clearFilter}>
                Clear
              </button>
            </div>
            <div
              className="ribbon"
              ref={ribbonRef}
              data-tone={ribbon?.tone || undefined}
              style={{ visibility: ribbonOn ? "visible" : "hidden" }}
            >
              <b>{ribbon?.title}</b>
              <span>{ribbon?.sub}</span>
            </div>
            <Tray
              done={dial.done}
              of={dial.of}
              label={dial.label}
              phaseCounts={dial.counts}
              poolCounts={poolCounts}
              last={last}
              active={filter.kinds}
              landed={landed}
              onDial={onDial}
              onKind={onKind}
            />
          </section>
          <Binder
            ref={binderRef}
            tab={theme ? "mine" : tab}
            onTab={setTab}
            showGone={!theme}
            theme={theme}
            pool={pool}
            gone={rs.gone}
            packCards={rs.cards}
            filter={filter}
            onFilter={setFilter}
            pickConfig={pickConfig}
            target={sizes.total}
            newId={newId}
            phone={phone}
            onClose={closeSheets}
            onPeek={setPeek}
          />
        </div>
      </div>
      {motionOpen ? (
        <MotionMenu
          anchor={motionBtn.current}
          level={motion}
          onChoose={setMotion}
          onClose={() => setMotionOpen(false)}
        />
      ) : null}
      <div className="kit-fx" ref={layerRef} aria-hidden="true" />
    </FullscreenLayer>
  );
}
