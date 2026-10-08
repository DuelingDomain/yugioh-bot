"use client";

/**
 * The chain on the board, shown once.
 *
 *  - Every link is one numbered medallion (a gold ring, the Chain Link number, a small chain-link
 *    glyph) on the card that activated, with a soft gold ring on the card. A new link drops in with
 *    a clink; the highest link is the largest and sits on top, so the order reads at a glance. A thin
 *    arc joins badge N to badge N-1, so the badges read as one chain. A link that activated from the
 *    hand, the GY, the Extra Deck or the banished pile sits on its slot, or on the hand / pile when
 *    the card has left that slot.
 *  - The "Now resolving" panel (a column in the free gutter left of the field, wide or narrow, or a strip
 *    when there is no room, on a phone or table, or a prompt meets the column) says which link is being
 *    resolved, what it does (the engine's description, else the card's printed text), whom it targets and
 *    what it did, over a list of EVERY link. A badge a prompt covers, or a link whose card is off the
 *    board, is still read there. After the chain ends the panel holds the last link and its result for a
 *    short recap (CHAIN_PANEL_TIMING). The strip is a real button that opens the panel as a sheet.
 *  - A target is marked on the board by coordinates only (a ring, "Target · N" and a dashed wire); the
 *    panel names a target only when it is a face-up public card (chain-narrate.ts). A card the viewer
 *    does not know is "A card": no art, no text, no passcode.
 *  - Screen readers get a visually hidden list ("Chain Link 2: card, Opponent") and a polite live
 *    announcement for each new link, resolution (with its effect and result), negation and the end of
 *    the chain.
 *  - Resolution: links resolve highest first, and it is shown on the badges and the stack rows (there
 *    is no centre banner for it). The resolving link takes a gold ring burst on its badge and a soft gold
 *    wash on its card; then its number gives way to a tick, the badge shrinks away and the arc to
 *    it fades. The next link down is marked "up next" (data-next). A negated link is slashed and
 *    greyed before it clears.
 *
 * Events play one beat at a time (see chainStepDelay, about 1.9 s for a resolving link), so a chain that
 * resolves inside one engine batch is still readable. The beat times are planned in chain-beats.ts,
 * which the banner layer reads for its sounds and the effect layers read to play a link's move or
 * destroy while, or just after, its badge beat. A page that loads mid-chain starts from the chain
 * as it stands. Everything visual sits on a pointer-transparent overlay, animates only transform
 * and opacity, and the badges follow their zones with `translate` (never layout). Reduced motion:
 * no burst, no movement and no wire; the state shows through colour and opacity, with a short hold
 * so the order stays readable.
 */
import { ChainRoomContext } from "./table/chain-room";
import { duelFxClock } from "./fx-clock";
import { useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { partnerSeatOf, type DuelChainLink, type DuelEvent, type DuelSeatView } from "@yugidraft/shared/duels";
import { X } from "lucide-react";
import { zoneKey } from "./constants";
import { collectFreshEvents, findZoneElement, maxEventId } from "./event-queue";
import {
  applyChainEvent,
  badgeCenter,
  chainAnchor,
  chainAnnouncement,
  chainCallout,
  chainEffectLead,
  chainFocusLink,
  chainLinkLabel,
  chainPanelForm,
  chainStateKey,
  chainWirePath,
  coveredFraction,
  deriveChainState,
  EMPTY_CHAIN,
  isChainEvent,
  nextToResolve,
  placeCallout,
  placeChips,
  projectChainNames,
  type CalloutPlace,
  type ChainAnchor,
  type ChainLinkState,
  type ChainPanelForm,
  type ChainState,
} from "./chain-state";
import { buildPanelView, buildStripView, chainOutcomes, rememberTargetNames, type TargetMemory, type Who } from "./chain-narrate";
import { ChainPanel, ChainStrip } from "./chain-panel";
import { CHAIN_PANEL_TIMING } from "./duel-timing";
import panelStyles from "./chain-panel.module.css";
import { chainBeatAt, chainBeatsEndAt, chainPromptHoldEndAt, planChainBeats, resetChainBeats } from "./chain-beats";
import { findFlipSequences } from "./flip-sequence";
import { holdPromptReveal } from "./prompt-reveal";
import { PriorityChips, type PrioritySlot } from "./priority-chips";
import baseStyles from "./chain-fx.module.css";
import { useSkinStyles } from "./skin";

export type ChainFxProps = {
  /** engine.events (a rolling window; ids only grow). */
  events: DuelEvent[];
  /** engine.chain: the snapshot chain, the fallback when the window lost a link. */
  chain: readonly DuelChainLink[];
  /** Changes when the room changes; the chain restarts from the live state. */
  duelKey: string;
  reducedMotion: boolean;
  mySeat: number | null;
  playerName: (seat: number) => string;
  /**
   * Tones of the seats of a table of 3 or 4. When set, each link names its owner ("You" or the player's name, never
   * "Opponent") and wears the owner's tone. Left out (1v1), nothing changes.
   */
  seatTones?: ReadonlyMap<number, { main: string; ink: string }>;
  /** Tables of 3 or 4 seats: who may answer the open chain, in order. The panel lists it under its head. */
  priority?: readonly PrioritySlot[];
  /** The duel is over (a result, or the session is not active): a chain that was open when it ended is cleared. */
  ended?: boolean;
  /** The format of a multi-seat table board ("ffa3", "ffa4", "tag"). A table always uses the strip. Left out (1v1), nothing changes. */
  table?: string;
  /** engine.seats: the viewer's redacted board. The panel names a target from it, only when the target is a face-up public card. */
  seats?: readonly DuelSeatView[];
  /** The local player has an open prompt that is not the chain response (`ownPromptOpen`): the panel shows the compact form. */
  promptOpen?: boolean;
};

/** A phone or a narrow window: the panel is the strip, whatever the gutter. */
const PHONE_QUERY = "(max-width: 900px)";

const clock = (): number => (typeof performance !== "undefined" ? duelFxClock.now() : duelFxClock.dateNow());

/**
 * Plays chain events one beat at a time and settles on the live chain when the beats run out.
 * The clock is the beat plan (chain-beats.ts), made in the render phase when a batch arrives, so
 * the banners, sounds and card effects of the same batch can wait for the same beats.
 */
export function useChainPlayback(
  events: readonly DuelEvent[],
  snapshot: readonly DuelChainLink[],
  duelKey: string,
  reducedMotion: boolean,
): ChainState {
  const [state, setState] = useState<ChainState>(() => deriveChainState(events, snapshot));
  const stateRef = useRef(state);
  const cursorRef = useRef<number>(maxEventId(events) ?? 0);
  const queueRef = useRef<DuelEvent[]>([]);
  const timerRef = useRef<number | null>(null);
  const keyRef = useRef(duelKey);
  const latest = useRef({ events, snapshot, reducedMotion });
  latest.current = { events, snapshot, reducedMotion };

  // Render phase on purpose (see BattleFx): SummonFx, MoveFx and the banners plan the same batch in
  // their effects, which run after this render, and read the plan. Planning is idempotent.
  const planBase = useRef<{ key: string; after: number } | null>(null);
  if (planBase.current == null || planBase.current.key !== duelKey) {
    planBase.current = { key: duelKey, after: maxEventId(events) ?? 0 };
    resetChainBeats(duelKey);
  }
  const after = planBase.current.after;
  const freshForPlan = events.filter((event) => event.id > after);
  if (freshForPlan.length > 0) planChainBeats(freshForPlan, { now: clock(), reduced: reducedMotion, duelKey });

  const commit = useCallback((next: ChainState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const pump = useCallback(() => {
    if (timerRef.current != null) return;
    const next = queueRef.current[0];
    if (!next) {
      // Out of beats: the live state is the truth.
      const live = deriveChainState(latest.current.events, latest.current.snapshot);
      if (chainStateKey(live) !== chainStateKey(stateRef.current)) commit(live);
      return;
    }
    const wait = (at: number) => {
      timerRef.current = duelFxClock.setTimeout(() => {
        timerRef.current = null;
        pump();
      }, Math.max(0, at - clock()));
    };
    const due = chainBeatAt(next.id);
    if (due - clock() > 8) {
      wait(due);
      return;
    }
    queueRef.current.shift();
    commit(applyChainEvent(stateRef.current, next));
    // Hold this beat until the next one is due, or until the last beat has had its hold.
    const following = queueRef.current[0];
    wait(following ? chainBeatAt(following.id) : chainBeatsEndAt());
  }, [commit]);

  useEffect(() => {
    if (keyRef.current !== duelKey) {
      keyRef.current = duelKey;
      if (timerRef.current != null) duelFxClock.clearTimeout(timerRef.current);
      timerRef.current = null;
      queueRef.current = [];
      cursorRef.current = maxEventId(events) ?? 0;
      commit(deriveChainState(events, snapshot));
      return;
    }
    const { nextCursor, fresh } = collectFreshEvents(events, cursorRef.current);
    cursorRef.current = nextCursor;
    const chainEvents = fresh.filter(isChainEvent);
    // An open response window needs the current targets immediately, including target-only
    // snapshot changes. Playback holds are for resolution; pending links follow the live chain.
    if (snapshot.length > 0 && stateRef.current.links.every((link) => link.status === "pending") &&
      [...queueRef.current, ...chainEvents].every((event) => event.kind === "activate" || event.kind === "target")) {
      if (timerRef.current != null) duelFxClock.clearTimeout(timerRef.current);
      timerRef.current = null;
      queueRef.current = [];
      const live = deriveChainState(events, snapshot);
      if (chainStateKey(live) !== chainStateKey(stateRef.current)) commit(live);
      return;
    }
    if (chainEvents.length > 0) {
      // Already planned in the render; this only fills a gap.
      planChainBeats(fresh, { now: clock(), reduced: latest.current.reducedMotion, duelKey });
      queueRef.current.push(...chainEvents);
      // The question after a chain waits until the chain has been played to its end.
      // A link that stops mid-resolution for a question holds it only until its effect may start (chainPromptHoldEndAt).
      if (chainEvents.some((event) => event.kind === "chain-resolving")) holdPromptReveal(chainPromptHoldEndAt(latest.current.reducedMotion) - clock());
    }
    pump();
  }, [events, snapshot, duelKey, commit, pump]);

  useEffect(
    () => () => {
      if (timerRef.current != null) duelFxClock.clearTimeout(timerRef.current);
      timerRef.current = null;
    },
    [],
  );

  return state;
}

/**
 * First element whose data-zones holds a key of this player and location (a pile keys each card). `found` holds
 * the answers of one frame: several links on one pile scan the page once.
 */
function findPileElement(controller: number, location: number, found: Map<string, HTMLElement | null>): HTMLElement | null {
  const key = `${controller}:${location}`;
  if (found.has(key)) return found.get(key) ?? null;
  const prefix = `${key}:`;
  let hit: HTMLElement | null = null;
  for (const el of document.querySelectorAll<HTMLElement>("[data-zones]")) {
    const keys = (el.dataset.zones ?? "").split(" ");
    if (keys.some((zone) => zone.startsWith(prefix))) { hit = el; break; }
  }
  found.set(key, hit);
  return hit;
}

function resolveAnchor(anchor: ChainAnchor, piles: Map<string, HTMLElement | null>): HTMLElement | null {
  const exact = findZoneElement(anchor.zone);
  if (exact) return exact;
  const fallback = anchor.fallback;
  if (!fallback) return null;
  if (fallback.kind === "hand") return document.querySelector<HTMLElement>(`[data-hand-seat="${fallback.controller}"]`);
  return findPileElement(fallback.controller, fallback.location, piles);
}

const OBSTACLES = "[data-prompt-panel], [data-prompt-surface], [data-feedback-cue]";

/** Mirrors .targetTag: it stands on the card's bottom edge, lifted 16 px per link, 3 px left of the ring. */
const TARGET_STEP = 16;
const TARGET_OUTSET = 3;
const TAG_FALLBACK = { width: 56, height: 16 };
/** A target ring hides when a panel covers more than this part of the card, its tag when it covers more than this part of it. */
const TARGET_COVERED = 0.3;
const TAG_COVERED = 0.15;
/** The top badge is drawn 1.16 times its size. */
const MAX_SCALE = 1.16;
/** A badge covered by more than this part of an open prompt is hidden. */
const BADGE_COVERED = 0.15;
const MIN_BADGE = 28;
const MAX_BADGE = 46;

type Box = { left: number; top: number; width: number; height: number };
/** One link as the read phase of a frame saw it; the write phase applies it. */
type PlacedLink = { link: ChainLinkState; slot: HTMLElement; box: Box | null; size: number; shift: number; half: "high" | "low"; callout: CalloutPlace | null; covered: boolean };
type PlacedMark = { link: ChainLinkState; mark: HTMLElement | undefined; wire: SVGPathElement | undefined; box: Box | null; covered: boolean };

/** The card's visible box: a Defense Position card is turned a quarter inside its portrait zone. */
function cardBox(overlay: DOMRect, zone: HTMLElement): Box | null {
  const rect = zone.getBoundingClientRect();
  if (rect.width < 4 || rect.height < 4 || overlay.width < 4) return null;
  const cx = rect.left - overlay.left + rect.width / 2;
  const cy = rect.top - overlay.top + rect.height / 2;
  const turned = zone.dataset.defense === "true" && rect.height > rect.width;
  const width = turned ? rect.height : rect.width;
  const height = turned ? rect.width : rect.height;
  return { left: cx - width / 2, top: cy - height / 2, width, height };
}

/**
 * The free width left of the board's leftmost zone, pile or LP panel: where the chain stack can stand without
 * covering the field. Reads layout, so it runs in the read phase and only a few times a second.
 */
function freeGutter(origin: DOMRect): number {
  let gutter = origin.width;
  for (const el of document.querySelectorAll<HTMLElement>("[data-zones], [data-lp-seat]")) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) continue;
    if (rect.right <= origin.left || rect.left >= origin.right || rect.bottom <= origin.top || rect.top >= origin.bottom) continue;
    gutter = Math.min(gutter, Math.max(0, rect.left - origin.left));
  }
  return gutter;
}
const GUTTER_EVERY_MS = 400;
/** The sheet opens this far under the strip and keeps this far above a prompt; it is never shorter than SHEET_MIN. */
const SHEET_GAP = 6;
const SHEET_MIN = 140;
/** From this board width the sheet is a dropdown of SHEET_WIDTH under the strip; below it, the whole width. */
const SHEET_WIDE_FROM = 900;
const SHEET_WIDTH = 480;
/** Below this much room under the strip, the sheet opens upward when there is more room above it. */
const SHEET_ROOMY = 460;

/** Two interlocked links. */
function ChainGlyph() {
  return (
    <svg className={baseStyles.glyph} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <g transform="rotate(-40 12 12)" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round">
        <rect x="1.5" y="8" width="12" height="8" rx="4" />
        <rect x="10.5" y="8" width="12" height="8" rx="4" />
      </g>
    </svg>
  );
}

/**
 * The links whose targets are marked on the board. They follow the live engine, so a replacement
 * occupant is never marked while old beats play and a chain end clears the rings at once. The
 * exception is a flip effect that answers an attack (flip-sequence.ts): its whole chain arrives in
 * one batch, the live chain is already empty, and the target would never show. Its link follows the
 * played beats instead: marked from the target beat, kept as chosen while the link resolves (the
 * engine publishes the target again after the card has moved), gone when the link resolves.
 */
export function targetLinksOf(live: ChainState, played: ChainState, sequenced: ReadonlyMap<number, number>, held: Map<number, ChainLinkState["targets"]>): ChainLinkState[] {
  const links = live.links.filter((link) => link.status !== "resolved");
  // A held target belongs to the activation that made it, so a later chain that reuses the link number gets none.
  const owners = new Set(sequenced.values());
  for (const id of [...held.keys()]) if (!owners.has(id)) held.delete(id);
  for (const link of played.links) {
    const owner = sequenced.get(link.index);
    if (owner == null) continue;
    if (link.status === "resolved") {
      held.delete(owner);
      continue;
    }
    if (link.status === "pending" || !held.has(owner)) held.set(owner, link.targets);
    const targets = held.get(owner) ?? [];
    if (targets.length === 0 || links.some((other) => other.index === link.index)) continue;
    links.push({ ...link, targets });
  }
  return links;
}

/** Link number -> id of the activation that owns it now, for the links that start a flip-effect sequence. */
export function sequenceOwners(events: readonly DuelEvent[]): Map<number, number> {
  const sequences = new Set(findFlipSequences(events).map((sequence) => sequence.activate.id));
  const latest = new Map<number, number>();
  for (const event of events) {
    if (event.kind === "activate" && typeof event.chainIndex === "number" && event.id >= (latest.get(event.chainIndex) ?? -Infinity)) latest.set(event.chainIndex, event.id);
  }
  const owners = new Map<number, number>();
  for (const [index, id] of latest) if (sequences.has(id)) owners.set(index, id);
  return owners;
}

export function ChainFx({ events, chain, duelKey, reducedMotion, mySeat, playerName, seatTones, priority, ended = false, table, seats, promptOpen = false }: ChainFxProps) {
  // Classic: the module's own classes (the same object). 3D mode: the same keys with the solid classes added.
  const styles = useSkinStyles(baseStyles, "chain");
  const skinned = styles !== baseStyles;
  const named = seatTones != null;
  // On Tag the partner's zones read "partner's"; every other seat that is not yours reads by name or "opponent's".
  const partner = table === "tag" && mySeat != null ? partnerSeatOf("tag", mySeat) : null;
  const namedChain = useMemo(() => projectChainNames(chain, seats), [chain, seats]);
  const played = useChainPlayback(events, namedChain, duelKey, reducedMotion);
  // A duel that ends mid-chain sends no "chain-end": nothing is left to resolve, so nothing stays on the board.
  const state = ended ? EMPTY_CHAIN : played;
  const who = useMemo<Who>(() => ({ mySeat, playerName, named, naming: { named, partner } }), [mySeat, playerName, named, partner]);

  // Recap: after "chain-end" the panel keeps the last link and its result for a moment, so the player can read what
  // just happened. The held state is derived while rendering (no frame without a panel between the end and the recap),
  // and a timer, on the pace clock, ends it. Never when the duel is over, the room changed, or a new chain opened.
  const lastOpen = useRef<{ key: string; state: ChainState }>({ key: duelKey, state: EMPTY_CHAIN });
  if (state.links.length > 0) lastOpen.current = { key: duelKey, state };
  const [expired, setExpired] = useState<ChainState | null>(null);
  const held = lastOpen.current.key === duelKey && lastOpen.current.state.links.length > 0 ? lastOpen.current.state : null;
  const recapState = state.links.length === 0 && !ended && held != null && expired !== held ? held : null;
  useEffect(() => {
    if (recapState == null) return undefined;
    const timer = duelFxClock.setTimeout(() => setExpired(recapState), reducedMotion ? CHAIN_PANEL_TIMING.recapReducedMs : CHAIN_PANEL_TIMING.recapMs);
    return () => duelFxClock.clearTimeout(timer);
  }, [recapState, reducedMotion]);
  const panelState = state.links.length > 0 ? state : recapState ?? EMPTY_CHAIN;
  const recapping = state.links.length === 0 && recapState != null;
  // Badges play historical resolution beats; targeting follows the live engine so a replacement
  // occupant is never marked while old beats play, and chain-end clears target rings immediately.
  const live = useMemo(() => (ended ? EMPTY_CHAIN : deriveChainState(events, namedChain)), [events, namedChain, ended]);
  const sequenceLinks = useMemo(() => sequenceOwners(events), [events]);
  const heldTargets = useRef({ key: duelKey, map: new Map<number, ChainLinkState["targets"]>() });
  if (heldTargets.current.key !== duelKey) heldTargets.current = { key: duelKey, map: new Map() };
  const targetLinks = targetLinksOf(live, state, sequenceLinks, heldTargets.current.map);
  const targetsKey = chainStateKey({ links: targetLinks, resolving: null });
  const targetLinksRef = useRef(targetLinks);
  targetLinksRef.current = targetLinks;
  const overlayRef = useRef<HTMLDivElement>(null);
  const frontRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const reportChainSize = useContext(ChainRoomContext);
  const measuredStrip = useRef("");
  useLayoutEffect(() => () => { measuredStrip.current = ""; reportChainSize?.(null); }, [reportChainSize]);
  const stripWrapRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (panelState.links.length === 0) { measuredStrip.current = ""; reportChainSize?.(null); }
  }, [panelState.links.length, reportChainSize]);
  const stripButtonRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const sheetId = useId();
  const [form, setForm] = useState<ChainPanelForm>("strip");
  const formRef = useRef<ChainPanelForm>("strip");
  const [sheetWanted, setSheetWanted] = useState(false);
  // The front layer lives in the duel's own root (the element that holds the pace slider's scope), not in the
  // fx slot. A slot or the board is a stacking context, and nothing inside one can rise above its siblings
  // (the prompt slot, the room's prompt dock); the root is above all of them. undefined = not looked up yet,
  // null = no root (a bare mount): the layer stays where it is.
  const [host, setHost] = useState<HTMLElement | null | undefined>(undefined);
  useLayoutEffect(() => {
    setHost(overlayRef.current?.closest<HTMLElement>("[data-duel-fx-speed-root]") ?? null);
  }, []);
  const slotRefs = useRef(new Map<number, HTMLElement>());
  const ringRefs = useRef(new Map<number, HTMLElement>());
  const tagRefs = useRef(new Map<number, HTMLElement>());
  const gutterRef = useRef({ at: Number.NEGATIVE_INFINITY, px: 0, phone: false });
  /** The full stack's last box, in board pixels: the chips test it to know whether the column would meet a prompt. */
  const fullBoxRef = useRef<Box | null>(null);
  const wireRefs = useRef(new Map<number, SVGPathElement>());
  const targetRefs = useRef(new Map<string, HTMLElement>());
  const targetWireRefs = useRef(new Map<string, SVGPathElement>());
  const arrowId = useId();
  const links = state.links;
  const linksKey = useMemo(() => chainStateKey(state), [state]);
  const linksRef = useRef(links);
  linksRef.current = links;

  // Keep every badge on its card: layout can move under us (resize, a hovered hand card, a summon).
  // Each frame reads the layout first and writes after, so the browser lays out at most once per frame.
  useLayoutEffect(() => {
    if (links.length === 0 && targetLinks.length === 0 && !recapping) return undefined;
    let raf = 0;
    const measure = () => {
      const overlay = overlayRef.current;
      if (!overlay) return;
      // ---- Read phase: no style write may happen before the last read. ----
      const origin = overlay.getBoundingClientRect();
      const front = frontRef.current;
      const hostRect = front && host ? host.getBoundingClientRect() : null;
      // Open prompt surfaces and the activation banner, in board pixels: the callout tag and the target marks keep
      // clear of them, so their text stays readable. `data-prompt-surface` marks what a panel is not: the select
      // bar, the "Response needed" pill and the phone prompt dock.
      // `prompts` is the same list without the banner: a banner passes in a second, so a badge or the stack that
      // moved for it would only flicker.
      const panels: Box[] = [];
      const prompts: Box[] = [];
      for (const panel of document.querySelectorAll<HTMLElement>(OBSTACLES)) {
        const rect = panel.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        const box = { left: rect.left - origin.left, top: rect.top - origin.top, width: rect.width, height: rect.height };
        panels.push(box);
        if (!panel.hasAttribute("data-feedback-cue")) prompts.push(box);
      }
      // The pile viewer mounts inside the board box, so it cannot rise above the front layer: hide the layer instead.
      const pileOpen = document.querySelector("[data-pile-viewer]") != null;
      let gutter = gutterRef.current.px;
      let phone = gutterRef.current.phone;
      const now = clock();
      if (front && now - gutterRef.current.at >= GUTTER_EVERY_MS) {
        gutter = freeGutter(origin);
        phone = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(PHONE_QUERY).matches;
        gutterRef.current = { at: now, px: gutter, phone };
      }
      const marks: PlacedMark[] = [];
      for (const link of targetLinksRef.current) {
        for (const target of link.targets) {
          const key = `${link.index}:${zoneKey(target.controller, target.location, target.sequence)}`;
          const zone = findZoneElement(target);
          const box = zone ? cardBox(origin, zone) : null;
          const mark = targetRefs.current.get(key);
          let covered = false;
          if (box) {
            // The ring hides under much of a panel; the "Target · N" tag, which carries the words, under a little.
            const tag = mark?.querySelector<HTMLElement>("[data-target-tag]");
            const w = tag?.offsetWidth || TAG_FALLBACK.width;
            const h = tag?.offsetHeight || TAG_FALLBACK.height;
            const tagBox = { left: box.left - TARGET_OUTSET, top: box.top + box.height - (link.index - 1) * TARGET_STEP - h, width: w, height: h };
            covered = coveredFraction(box, panels) > TARGET_COVERED || coveredFraction(tagBox, panels) > TAG_COVERED;
          }
          marks.push({ link, mark, wire: targetWireRefs.current.get(key), box, covered });
        }
      }
      // The panel is a column in the left gutter. A prompt surface that meets it turns it into the strip, which
      // dodges the prompt. Measured on the column itself while it stands; while it is the strip, on the column's last box.
      const panelEl = panelRef.current;
      const previous = formRef.current;
      if (front && panelEl && previous !== "strip") {
        const own = panelEl.getBoundingClientRect();
        if (own.width > 4 && own.height > 4) fullBoxRef.current = { left: own.left - origin.left, top: own.top - origin.top, width: own.width, height: own.height };
      }
      const blocked = fullBoxRef.current != null && coveredFraction(fullBoxRef.current, prompts) > 0;
      // Phones and tables always use the strip; so does a column that would meet a prompt.
      const next: ChainPanelForm = front ? chainPanelForm(gutter, previous, table != null || phone || blocked) : "wide";
      // The strip keeps clear of life-point plates, open panels and target cards.
      let stripSize: { width: number; height: number } | null = null;
      let roomReady = !reportChainSize;
      let chips: { left: number; top: number } | null = null;
      let sheet: { top: number; max: number; left: number; width: number; up: boolean } | null = null;
      const stripEl = stripWrapRef.current;
      if (front && next === "strip" && previous === "strip" && stripEl) {
        const obstacles = panels.slice();
        for (const { box } of marks) {
          if (box) obstacles.push({ left: box.left - TARGET_OUTSET, top: box.top - TARGET_OUTSET, width: box.width + TARGET_OUTSET * 2, height: box.height + TARGET_OUTSET * 2 });
        }
        for (const plate of document.querySelectorAll<HTMLElement>("[data-lp-seat], [data-team-plate]")) {
          const rect = plate.getBoundingClientRect();
          if (rect.width > 4 && rect.height > 4) obstacles.push({ left: rect.left - origin.left, top: rect.top - origin.top, width: rect.width, height: rect.height });
        }
        const own = stripEl.getBoundingClientRect();
        stripSize = { width: Math.ceil(own.width), height: Math.ceil(own.height) };
        const stage = overlay.closest<HTMLElement>("[data-table-stage]");
        const room = stage?.dataset.chainRoom?.split(",").map(Number);
        const glide = stage?.closest<HTMLElement>("[data-glide]")?.dataset.glide;
        roomReady = !reportChainSize || (room?.length === 4 && glide !== "drawer-in" && glide !== "drawer-out");
        chips = room?.length === 4 ? { left: room[0], top: room[1] }
          : placeChips({ width: own.width, height: own.height }, { width: origin.width, height: origin.height }, obstacles);
        // The sheet opens under the strip and never reaches an open prompt below it.
        const top = Math.min(chips.top + own.height + SHEET_GAP, Math.max(SHEET_GAP, origin.height - SHEET_MIN - SHEET_GAP));
        let limit = origin.height - SHEET_GAP;
        for (const box of prompts) {
          if (box.left < origin.width - SHEET_GAP && box.left + box.width > SHEET_GAP && box.top + box.height > top && box.top > top - 4) limit = Math.min(limit, box.top - SHEET_GAP);
        }
        // A wide board: a dropdown as wide as a panel, under the strip. A phone: the whole width.
        const wide = origin.width >= SHEET_WIDE_FROM;
        const width = wide ? Math.min(SHEET_WIDTH, origin.width - SHEET_GAP * 2) : origin.width - SHEET_GAP * 2;
        let left = wide ? Math.max(SHEET_GAP, Math.min(chips.left, origin.width - width - SHEET_GAP)) : SHEET_GAP;
        let sheetWidth = width;
        if (wide) {
          // The chain column in the left gutter stays readable: the dropdown starts to the right of it.
          for (const column of document.querySelectorAll<HTMLElement>("[data-chain-panel]")) {
            if (column.closest("[data-chain-sheet]")) continue;
            const rect = column.getBoundingClientRect();
            const edge = rect.right - origin.left + SHEET_GAP;
            if (rect.width > 4 && rect.height > 4 && edge > left && edge < origin.width / 2) left = edge;
          }
          sheetWidth = Math.min(width, origin.width - SHEET_GAP - left);
        }
        // Under the strip when there is room for a full detail; otherwise above it, when that side has more room. Above, the
        // sheet ends on the strip, or on the top of an open prompt that stands over the same columns.
        let bottom = chips.top - SHEET_GAP;
        for (const box of prompts) {
          if (box.left < left + sheetWidth && box.left + box.width > left && box.top < bottom && box.top + box.height > SHEET_GAP) bottom = Math.min(bottom, box.top - SHEET_GAP);
        }
        const below = Math.max(SHEET_MIN, limit - top);
        const above = Math.max(SHEET_MIN, bottom - SHEET_GAP);
        const up = wide && below < SHEET_ROOMY && above > below;
        sheet = up
          ? { top: Math.round(bottom), max: Math.round(above), left: Math.round(left), width: Math.round(sheetWidth), up }
          : { top: Math.round(top), max: Math.round(below), left: Math.round(left), width: Math.round(sheetWidth), up };
      }
      const stacked = new Map<HTMLElement, number>();
      const piles = new Map<string, HTMLElement | null>();
      const placed: PlacedLink[] = [];
      const centers = new Map<number, { x: number; y: number }>();
      let gap = MIN_BADGE;
      for (const link of linksRef.current) {
        const slot = slotRefs.current.get(link.index);
        if (!slot) continue;
        const anchor = chainAnchor(link);
        const zone = anchor ? resolveAnchor(anchor, piles) : null;
        const box = zone ? cardBox(origin, zone) : null;
        if (!zone || !box) {
          placed.push({ link, slot, box: null, size: 0, shift: 0, half: "high", callout: null, covered: false });
          continue;
        }
        const shift = stacked.get(zone) ?? 0;
        stacked.set(zone, shift + 1);
        const size = Math.round(Math.min(MAX_BADGE, Math.max(MIN_BADGE, box.width * 0.46)));
        gap = Math.max(gap, size);
        const center = badgeCenter(box, size, shift);
        centers.set(link.index, center);
        // A badge over an open prompt would hide its words: it steps back (the stack and the wire still say the link).
        const reach = (size * MAX_SCALE) / 2;
        const covered = coveredFraction({ left: center.x - reach, top: center.y - reach, width: reach * 2, height: reach * 2 }, prompts) > BADGE_COVERED;
        // The callout tag opens away from the nearer board edge, so it stays on screen.
        const half = box.top + box.height / 2 > origin.height / 2 ? "low" : "high";
        const tag = tagRefs.current.get(link.index);
        const callout = tag
          ? placeCallout({ card: box, board: { width: origin.width, height: origin.height }, tag: { width: tag.offsetWidth, height: tag.offsetHeight }, half, panels })
          : null;
        placed.push({ link, slot, box, size, shift, half, callout, covered });
      }
      // ---- Write phase. ----
      if (reportChainSize) {
        const width = stripSize?.width ?? 0;
        const height = stripSize?.height ?? 0;
        const key = `${width},${height}`;
        if (measuredStrip.current !== key) {
          measuredStrip.current = key;
          reportChainSize(width > 0 && height > 0 ? { width, height } : null);
        }
      }
      if (front) {
        front.dataset.roomReady = roomReady ? "true" : "false";
        const suspended = pileOpen ? "true" : "false";
        if (front.dataset.suspended !== suspended) front.dataset.suspended = suspended;
        if (formRef.current !== next) {
          formRef.current = next;
          setForm(next);
        }
        const dock = chips ? `${Math.round(chips.left)},${Math.round(chips.top)}` : "";
        if (front.dataset.dock !== dock) {
          front.dataset.dock = dock;
          if (chips) {
            front.style.setProperty("--chain-dock-left", `${Math.round(chips.left)}px`);
            front.style.setProperty("--chain-dock-top", `${Math.round(chips.top)}px`);
          } else {
            front.style.removeProperty("--chain-dock-left");
            front.style.removeProperty("--chain-dock-top");
          }
        }
        const sheetKey = sheet ? `${sheet.top},${sheet.max},${sheet.left},${sheet.width},${sheet.up ? "up" : "down"}` : "";
        if (front.dataset.sheet !== sheetKey) {
          front.dataset.sheet = sheetKey;
          if (sheet) {
            // Up: the sheet's bottom edge sits on this line; down: its top edge does.
            front.style.setProperty("--chain-sheet-top", sheet.up ? "auto" : `${sheet.top}px`);
            front.style.setProperty("--chain-sheet-bottom", sheet.up ? `${Math.max(SHEET_GAP, origin.height - sheet.top)}px` : "auto");
            front.style.setProperty("--chain-sheet-max", `${sheet.max}px`);
            front.style.setProperty("--chain-sheet-left", `${sheet.left}px`);
            front.style.setProperty("--chain-sheet-right", `${Math.max(SHEET_GAP, origin.width - sheet.left - sheet.width)}px`);
          } else {
            front.style.removeProperty("--chain-sheet-top");
            front.style.removeProperty("--chain-sheet-bottom");
            front.style.removeProperty("--chain-sheet-max");
            front.style.removeProperty("--chain-sheet-left");
            front.style.removeProperty("--chain-sheet-right");
          }
        }
        const px = String(Math.round(gutter));
        if (front.dataset.gutter !== px) {
          front.dataset.gutter = px;
          front.style.setProperty("--chain-gutter", `${px}px`);
        }
      }
      // The front layer sits over the board box, wherever the board is inside the root.
      if (front && host && hostRect) {
        const x = Math.round(origin.left - hostRect.left - host.clientLeft);
        const y = Math.round(origin.top - hostRect.top - host.clientTop);
        const geo = `${x},${y},${Math.round(origin.width)},${Math.round(origin.height)}`;
        if (front.dataset.geo !== geo) {
          front.dataset.geo = geo;
          front.style.width = `${origin.width}px`;
          front.style.height = `${origin.height}px`;
          front.style.translate = `${x}px ${y}px`;
        }
      }
      for (const { link, slot, box, size, shift, half, callout, covered } of placed) {
        const ring = ringRefs.current.get(link.index);
        if (!box) {
          if (slot.dataset.placed !== "false") slot.dataset.placed = "false";
          if (ring && ring.dataset.placed !== "false") ring.dataset.placed = "false";
          continue;
        }
        const geo = `${Math.round(box.left)},${Math.round(box.top)},${Math.round(box.width)},${Math.round(box.height)},${size},${shift},${half}`;
        // The badge (front layer) and the card ring and glow (back layer) share one box.
        for (const el of ring ? [slot, ring] : [slot]) {
          if (el.dataset.geo !== geo) {
            el.dataset.geo = geo;
            el.style.width = `${box.width}px`;
            el.style.height = `${box.height}px`;
            el.style.translate = `${box.left}px ${box.top}px`;
            el.style.setProperty("--b", `${size}px`);
            el.style.setProperty("--shift", String(shift));
            el.dataset.half = half;
          }
          if (el.dataset.placed !== "true") el.dataset.placed = "true";
        }
        const hide = covered ? "true" : "false";
        if (slot.dataset.covered !== hide) slot.dataset.covered = hide;
        // The callout tag stays on the board and off every open prompt panel (see placeCallout).
        const tag = tagRefs.current.get(link.index);
        if (tag && callout) {
          const place = `${callout.dx},${callout.side}`;
          if (tag.dataset.place !== place) {
            tag.dataset.place = place;
            tag.style.translate = `calc(-50% + ${callout.dx}px) 0`;
            tag.dataset.side = callout.side;
          }
        }
      }
      // The wire from badge N to badge N-1: only when both badges are on the board and apart.
      for (const [index, wire] of wireRefs.current) {
        const from = centers.get(index - 1);
        const to = centers.get(index);
        const d = from && to ? chainWirePath(from, to, gap * 1.1) : null;
        if (d == null) {
          if (wire.hasAttribute("d")) wire.removeAttribute("d");
        } else if (wire.getAttribute("d") !== d) {
          wire.setAttribute("d", d);
        }
      }
      for (const { link, mark, wire, box, covered } of marks) {
        if (mark) {
          mark.dataset.placed = box ? "true" : "false";
          mark.dataset.covered = covered ? "true" : "false";
          if (box) {
            const geo = `${box.left},${box.top},${box.width},${box.height}`;
            if (mark.dataset.geo !== geo) {
              mark.dataset.geo = geo;
              mark.style.width = `${box.width}px`;
              mark.style.height = `${box.height}px`;
              mark.style.translate = `${box.left}px ${box.top}px`;
            }
          }
        }
        if (wire) {
          const from = centers.get(link.index);
          const to = box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : null;
          const d = from && to ? chainWirePath(from, to, gap) : null;
          if (d && wire.getAttribute("d") !== d) wire.setAttribute("d", d);
          else if (!d && wire.hasAttribute("d")) wire.removeAttribute("d");
        }
      }
    };
    const tick = () => {
      measure();
      raf = duelFxClock.requestAnimationFrame(tick);
    };
    if (typeof requestAnimationFrame !== "function") {
      measure();
      return undefined;
    }
    tick();
    return () => duelFxClock.cancelAnimationFrame(raf);
  }, [linksKey, links.length, targetsKey, targetLinks.length, host, recapping, table, reportChainSize]);

  // What each link did, from the events of the open chain (or the one just ended, during its recap).
  const outcomes = useMemo(() => chainOutcomes(events, panelState, who), [events, panelState, who]);
  const outcomesRef = useRef(outcomes);
  outcomesRef.current = outcomes;

  // The resolving link says "Resolving..." until its effect has had time to play, then its result: paced from the
  // chain beats (the beat of its "chain-resolving" plus the effect lead), never from a clock of the panel's own.
  const resolvingIndex = state.resolving;
  const [readyFor, setReadyFor] = useState<number | null>(null);
  useEffect(() => {
    if (resolvingIndex == null) {
      setReadyFor(null);
      return undefined;
    }
    let beat = 0;
    for (const event of events) {
      if (event.kind === "chain-resolving" && event.chainIndex === resolvingIndex) beat = Math.max(beat, event.id);
    }
    const at = (beat ? chainBeatAt(beat) : 0) + chainEffectLead(reducedMotion);
    const wait = at - clock();
    if (wait <= 8) {
      setReadyFor(resolvingIndex);
      return undefined;
    }
    const timer = duelFxClock.setTimeout(() => setReadyFor(resolvingIndex), wait);
    return () => duelFxClock.clearTimeout(timer);
  }, [resolvingIndex, events, reducedMotion]);
  const resultsReady = recapping || (resolvingIndex != null && readyFor === resolvingIndex);

  // Live announcements for screen readers: what changed on this beat of the chain.
  const prevRef = useRef<ChainState>(EMPTY_CHAIN);
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    const said = chainAnnouncement(prevRef.current, state, mySeat, playerName, named, partner, (link) => {
      const outcome = outcomesRef.current.get(link.index);
      return outcome && outcome.tone !== "quiet" ? outcome.lines.join(", ") : null;
    });
    prevRef.current = state;
    if (said != null) setAnnouncement(said);
  }, [state, mySeat, playerName, named, partner]);

  // Target names the panel may say: remembered while the target is face-up on the viewer's board, so "Targets Gaia"
  // survives its destruction. Forgotten with the chain.
  const targetMemory = useRef<TargetMemory>(new Map());
  if (panelState.links.length === 0) targetMemory.current.clear();
  else {
    rememberTargetNames(targetMemory.current, live.links, seats);
    rememberTargetNames(targetMemory.current, panelState.links, seats);
  }

  const focus = chainFocusLink(state);
  const panelFocus = chainFocusLink(panelState);
  // Built once per change of the chain, not once per render: it holds the detail of every link. The target memory is
  // a stable map that the lines above fill, so the links it was filled from (live, panelState) are the dependencies.
  const view = useMemo(
    () => (panelFocus ? buildPanelView({ state: panelState, focus: panelFocus, outcomes, resultsReady, targets: targetMemory.current, who }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [panelState, panelFocus, outcomes, resultsReady, who, live.links, seats],
  );
  const stripView = useMemo(() => (view ? buildStripView(view) : null), [view]);
  const topIndex = links.length;
  const nextIndex = nextToResolve(state);
  const attrs = (link: ChainLinkState) => ({
    "data-status": link.status,
    "data-negated": link.negated ? "true" : "false",
    "data-top": link.index === topIndex ? "true" : "false",
    "data-next": link.index === nextIndex ? "true" : "false",
    "data-focus": focus?.index === link.index ? "true" : "false",
    // Only for the solid look (yours wear purple); the classic slot keeps its attributes.
    ...(skinned ? { "data-mine": mySeat != null && link.seat === mySeat ? "true" : "false" } : {}),
  });
  const showPanel = view != null;

  // The sheet: the strip's panel. It closes with the panel, and when the form is no longer the strip.
  const sheetOpen = sheetWanted && form === "strip" && view != null;
  const closeSheet = useCallback(() => setSheetWanted(false), []);
  useEffect(() => {
    if (!sheetOpen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // The sheet owns this Esc: later listeners (the Tag camera's way back to the overview) must not act on it too.
      event.preventDefault();
      setSheetWanted(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sheetOpen]);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (sheetOpen) closeRef.current?.focus();
    else if (wasOpen.current) stripButtonRef.current?.focus();
    wasOpen.current = sheetOpen;
  }, [sheetOpen]);
  const hasView = view != null;
  useEffect(() => {
    if (!hasView) setSheetWanted(false);
  }, [hasView]);

  // Front layer: the numbered badges, the callout and the chain stack. Above every other board layer (it is
  // portaled into the duel root, see `host`), so a prompt or a banner cannot cover the chain. What it must not
  // cover in turn (prompt surfaces, a pile viewer) the frame loop steps back from.
  const front = (
    <div ref={frontRef} className={`${styles.layer} ${styles.front}`} data-chain-fx="front" data-chain-front="true"
      data-portal={host ? "true" : undefined} data-table={table} data-size={form}
      data-room-ready={reportChainSize ? "false" : undefined}
      data-open={links.length > 0 ? "true" : "false"} data-recap={recapping ? "true" : undefined} data-reduced={reducedMotion ? "true" : "false"}>
      {links.map((link) => {
        const callout = chainCallout(link, mySeat, playerName, named);
        return (
          <div
            key={link.index}
            ref={(el) => {
              if (el) slotRefs.current.set(link.index, el);
              else slotRefs.current.delete(link.index);
            }}
            className={styles.slot}
            style={{ zIndex: link.index }}
            aria-hidden="true"
            data-placed="false"
            data-chain-link={link.index}
            {...attrs(link)}
          >
            <span className={styles.badge}>
              <span className={styles.num} data-chain-num="true">{link.index}</span>
              <svg className={styles.tick} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className={styles.chip}><ChainGlyph /></span>
            </span>
            {focus?.index === link.index ? (
              <span
                ref={(el) => {
                  if (el) tagRefs.current.set(link.index, el);
                  else tagRefs.current.delete(link.index);
                }}
                className={styles.tag} data-chain-callout={link.index} data-callout-key={`${link.index}:${link.status}`}>
                <b>{callout.label}</b>
                <span className={styles.tagName}>{callout.title}</span>
                <span className={styles.tagAction}>{callout.action}</span>
              </span>
            ) : null}
          </div>
        );
      })}
      {targetLinks.flatMap((link) => link.targets.map((target) => {
        const zone = zoneKey(target.controller, target.location, target.sequence);
        const key = `${link.index}:${zone}`;
        return <div key={key} ref={(el) => {
          if (el) targetRefs.current.set(key, el);
          else targetRefs.current.delete(key);
        }} className={styles.target} aria-hidden="true" data-placed="false" data-chain-target={link.index} data-target-zone={zone}
          style={{ "--target-offset": `${(link.index - 1) * TARGET_STEP}px` } as CSSProperties}>
          <span className={styles.targetRing} />
          <span className={styles.targetTag} data-target-tag>Target · {link.index}</span>
        </div>;
      }))}
      {showPanel && view && stripView ? (
        <div className={styles.dock}>
          {form === "strip" ? (
            <div ref={stripWrapRef} className={panelStyles.stripWrap} data-chain-panel="true" data-chain-strip-wrap="true" data-priority={priority?.length ? "true" : undefined}>
              <ChainStrip view={stripView} open={sheetOpen} controls={sheetId} onToggle={() => setSheetWanted((open) => !open)} buttonRef={stripButtonRef} />
              {priority && priority.length > 0 ? (
                <div className={panelStyles.prioRow} aria-hidden="true">
                  <PriorityChips order={priority} mySeat={mySeat} nameOf={playerName} seatTones={seatTones} compact />
                </div>
              ) : null}
            </div>
          ) : (
            <ChainPanel view={view} shape={form} compact={promptOpen} seatTones={seatTones} priority={priority} mySeat={mySeat} nameOf={playerName} panelRef={panelRef} />
          )}
        </div>
      ) : null}
      {sheetOpen && view ? (
        <>
          <div className={panelStyles.scrim} data-chain-scrim="true" onClick={closeSheet} aria-hidden="true" />
          <div id={sheetId} className={panelStyles.sheet} role="dialog" aria-label="Chain details" data-chain-sheet="true">
            <ChainPanel view={view} shape="sheet" seatTones={seatTones} mySeat={mySeat} nameOf={playerName} />
            <button ref={closeRef} type="button" className={panelStyles.close} aria-label="Close chain details" onClick={closeSheet}>
              <X size={16} strokeWidth={2.4} aria-hidden="true" />
            </button>
          </div>
        </>
      ) : null}
    </div>
  );

  return (
    <>
      <div className={styles.sr} data-chain-sr="true">
        {/* The wide and narrow columns are readable themselves (every row is a button), so the list would read each link twice. */}
        {links.length > 0 && !(form !== "strip" && view != null && stripView != null) ? (
          <ol aria-label="Current chain" data-chain-sr-list="true">
            {links.map((link) => (
              <li key={link.index} data-chain-sr-link={link.index}>{chainLinkLabel(link, mySeat, playerName, true, named, partner)}</li>
            ))}
          </ol>
        ) : null}
        <p role="status" aria-live="polite" aria-atomic="true" data-chain-live="true">{announcement}</p>
      </div>
      {/* Back layer: the card ring and glow and the badge wires. Under the prompt and the banners. */}
      <div ref={overlayRef} className={styles.layer} aria-hidden="true" data-chain-fx="true"
        data-open={links.length > 0 ? "true" : "false"} data-reduced={reducedMotion ? "true" : "false"}>
        {!reducedMotion ? (
          <svg className={styles.wires} data-chain-wires="true" aria-hidden="true" focusable="false">
            <defs>
              <marker id={arrowId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M0 0 L10 5 L0 10 Z" fill="var(--duel-pen-ink, #c6b6ff)" />
              </marker>
            </defs>
            {links.filter((link) => link.index > 1).map((link) => (
              <path
                key={link.index}
                ref={(el) => {
                  if (el) wireRefs.current.set(link.index, el);
                  else wireRefs.current.delete(link.index);
                }}
                className={styles.wire}
                data-chain-wire={link.index}
                data-status={link.status}
              />
            ))}
            {targetLinks.flatMap((link) => link.targets.map((target) => {
              const key = `${link.index}:${zoneKey(target.controller, target.location, target.sequence)}`;
              return <path key={key} ref={(el) => {
                if (el) targetWireRefs.current.set(key, el);
                else targetWireRefs.current.delete(key);
              }} className={styles.targetWire} markerEnd={`url(#${arrowId})`} data-chain-target-wire={link.index} />;
            }))}
          </svg>
        ) : null}
        {links.map((link) => (
          <div
            key={link.index}
            ref={(el) => {
              if (el) ringRefs.current.set(link.index, el);
              else ringRefs.current.delete(link.index);
            }}
            className={styles.slot}
            data-placed="false"
            data-chain-card={link.index}
            {...attrs(link)}
          >
            <span className={styles.glow} />
            <span className={styles.ring} />
            <span className={styles.wash} />
          </div>
        ))}
      </div>
      {host === undefined ? null : host ? createPortal(front, host) : front}
    </>
  );
}
