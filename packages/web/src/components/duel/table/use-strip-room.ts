"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { WATCHED_SIZES } from "./measure-watch";
import { planStripRoom, STRIP_ROOM, type StripRoom } from "./strip-room";
import { occluderRects } from "./use-view-zoom";
import { sameRects, type Rect } from "./rect-util";

/** The board shows the same picture this many frames in a row: it stands still. */
const REST_FRAMES = 6;
/** The longest a measure waits for the board to stand still (a looping effect never does): then it measures anyway. */
const REST_MAX_MS = 1500;
/** The panel's own height besides its cards is rounded up to this many px, so a text that wraps by a line does not move the room again. */
const CHROME_STEP = 8;

export interface UseStripRoomOptions {
  rootRef: RefObject<HTMLElement | null>;
  /** The chain-response panel is open (a chain strip prompt on a board that floats its prompts). */
  active: boolean;
  /** Changes with each prompt: the room is planned again for it. */
  promptId: string;
  /** The number of cards in the response. */
  count: number;
  /** The board box (px). A change measures again. */
  box: { width: number; height: number };
  /** Where the room wants to sit (see planStripRoom). */
  anchor?: { x: number; y: number };
  /** CSS selectors of the key HUD, the soft HUD and your hand's cards. */
  keyHud: string;
  /** The HUD with your own actions (see StripRoomInput.controls). */
  controlsHud?: string;
  softHud: string;
  hand: string;
  /** The zone keys (see zoneKey) of the cards in the chain: the room never covers them while another place exists. */
  sourceKeys: readonly string[];
  /** Another HUD rect (the card pinned in the peek). */
  extraHud?: Rect | null;
  /** Anything that moves the board on screen (the camera view, a zoom, the hand): measured again at rest. */
  viewKey: string;
}

export interface UseStripRoom {
  room: StripRoom | undefined;
  /** The room is not measured yet: the panel waits (hidden) instead of showing at the wrong place first. */
  pending: boolean;
}

interface Measured {
  key: Rect[];
  controls: Rect[];
  soft: Rect[];
  hand: Rect | null;
  zones: Rect[];
  source: Rect[];
}

const rounded = (r: { x: number; y: number; width: number; height: number }): Rect => ({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });

/** The union of rects, or null for none. */
export function unionOf(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return { x, y, width: Math.max(...rects.map((r) => r.x + r.width)) - x, height: Math.max(...rects.map((r) => r.y + r.height)) - y };
}

/**
 * The room of a chain-response panel, measured and planned here for every board that uses it (FFA3, FFA4, Tag). It measures the HUD, your hand,
 * the zones that hold a card and the chain's cards when the board stands still (the same picture for REST_FRAMES frames, at most REST_MAX_MS), and
 * again when the box, the prompt, the view, your hand or the chain banner change. During a zoom or an effect it does not measure, so the room is
 * planned once at rest and the panel moves at most once. The real height of the panel besides its cards is read from it (a long title or a
 * second line of text), so Back and Pass never fall under the room's edge. The camera is never read or moved.
 */
export function useStripRoom(options: UseStripRoomOptions): UseStripRoom {
  const { rootRef, active, promptId, count, box, anchor, keyHud, controlsHud = "", softHud, hand, sourceKeys, extraHud, viewKey } = options;
  const [measured, setMeasured] = useState<Measured | null>(null);
  const [chrome, setChrome] = useState<number | null>(null);
  const sourceKey = sourceKeys.join(",");
  const lastPrompt = useRef("");
  // The panel's real chrome is read only once the room is applied: before that it sits in the narrow pair box and its text wraps taller.
  const roomed = useRef(false);

  useEffect(() => {
    if (!active) {
      setMeasured(null);
      setChrome(null);
      lastPrompt.current = "";
      return;
    }
    const root = rootRef.current;
    if (!root) return;
    const fresh = lastPrompt.current !== promptId;
    lastPrompt.current = promptId;
    if (fresh) setChrome(null);
    const board = () => root.getBoundingClientRect();
    const boxes = (selector: string) => Array.from(root.querySelectorAll<HTMLElement>(selector))
      .map((node) => node.getBoundingClientRect())
      .filter((r) => r.width > 1 && r.height > 1)
      .map((r) => rounded({ x: r.left - board().left, y: r.top - board().top, width: r.width, height: r.height }));
    // What the board looks like right now, cheap: the first zone, the first hand card and the key HUD. It is equal for REST_FRAMES frames at rest.
    const picture = () => {
      const bits: number[] = [];
      for (const node of [root.querySelector("[data-zones]"), root.querySelector(hand), ...Array.from(root.ownerDocument.querySelectorAll(keyHud)).slice(0, 4)]) {
        const r = node?.getBoundingClientRect();
        bits.push(r ? Math.round(r.left) : -1, r ? Math.round(r.top) : -1, r ? Math.round(r.width) : -1);
      }
      return bits.join(",");
    };
    // The room the stage keeps for the chain banner (data-chain-room, board px): the banner is drawn there after the plan, so the plan reads the room, not the banner's place of the moment.
    const reservedChain = (): Rect[] => {
      const holder = root.hasAttribute("data-chain-room") ? root : root.querySelector("[data-chain-room]");
      const [x, y, width, height] = (holder?.getAttribute("data-chain-room") ?? "").split(",").map(Number);
      return [x, y, width, height].every(Number.isFinite) && width > 1 && height > 1 ? [rounded({ x, y, width, height })] : [];
    };
    // The chain banner has a room reserved: it is drawn there, so the place it holds while it moves is left out and the room counts instead.
    const softRects = (): Rect[] => {
      const reserved = reservedChain();
      const rects = occluderRects(root, softHud).map(rounded);
      if (reserved.length === 0) return rects;
      const banner = occluderRects(root, "[data-chain-strip-wrap]").map(rounded);
      return [...rects.filter((r) => !banner.some((b) => sameRects([b], [r]))), ...reserved];
    };
    const measure = () => {
      const zones = boxes('[data-zones][data-occupied="true"]');
      const source = sourceKey === "" ? [] : sourceKey.split(",").flatMap((key) => boxes(`[data-zones~="${key}"]`));
      const next: Measured = {
        key: occluderRects(root, keyHud).map(rounded),
        controls: controlsHud === "" ? [] : occluderRects(root, controlsHud).map(rounded),
        soft: softRects(),
        hand: unionOf(boxes(`${hand}`)),
        zones,
        source,
      };
      setMeasured((current) => (current && sameRects(current.key, next.key) && sameRects(current.controls, next.controls) && sameRects(current.soft, next.soft) && sameRects(current.zones, next.zones) && sameRects(current.source, next.source) && ((current.hand === null && next.hand === null) || (current.hand !== null && next.hand !== null && sameRects([current.hand], [next.hand]))) ? current : next));
      // The panel's real height besides its cards, once the room is applied: it only grows, so a text that wraps differently in a new room cannot make the room flip back and forth.
      const panel = root.querySelector<HTMLElement>('[data-prompt-panel][data-tone="chain"][data-strip="true"]');
      const wrap = panel?.querySelector<HTMLElement>("[data-strip-wrap]");
      if (panel && wrap && roomed.current) {
        const real = Math.ceil((panel.getBoundingClientRect().height - wrap.getBoundingClientRect().height) / CHROME_STEP) * CHROME_STEP;
        if (real > 0) setChrome((current) => (current === null || real > current ? real : current));
      }
    };

    let frame = 0;
    let same = 0;
    let last = "";
    // When the first request of this burst came (0: none waits): every new request keeps it, so a board that never rests is measured after REST_MAX_MS at the latest.
    let started = 0;
    let hard: number | undefined;
    const stop = () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(hard);
      started = 0;
    };
    const finish = () => {
      stop();
      measure();
    };
    // Waits until the board stands still, then measures once.
    const settle = () => {
      window.cancelAnimationFrame(frame);
      same = 0;
      last = "";
      if (started === 0) {
        started = performance.now();
        hard = window.setTimeout(finish, REST_MAX_MS);
      }
      const step = () => {
        const now = picture();
        same = now === last ? same + 1 : 0;
        last = now;
        if (same >= REST_FRAMES || performance.now() - started >= REST_MAX_MS) {
          finish();
          return;
        }
        frame = window.requestAnimationFrame(step);
      };
      frame = window.requestAnimationFrame(step);
    };
    settle();
    // The hand, the zones, the chain banner and the panel mount or change size: measured again at rest. Watched without a legal target too.
    let sizes: ResizeObserver | null = null;
    let nodes: MutationObserver | null = null;
    if (typeof ResizeObserver !== "undefined") sizes = new ResizeObserver(settle);
    const follow = () => root.querySelectorAll(`${WATCHED_SIZES}, [data-chain-panel], ${hand}, [data-prompt-panel]`).forEach((node) => sizes?.observe(node));
    follow();
    if (typeof MutationObserver !== "undefined") {
      nodes = new MutationObserver(() => {
        follow();
        settle();
      });
      nodes.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-legal", "data-occupied", "data-chain-room"] });
    }
    return () => {
      stop();
      sizes?.disconnect();
      nodes?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, promptId, box.width, box.height, viewKey, keyHud, controlsHud, softHud, hand, sourceKey, rootRef]);

  const room = useMemo(() => {
    if (!active || !measured) return undefined;
    return planStripRoom({
      box,
      count,
      anchor,
      hud: extraHud ? [...measured.key, extraHud] : measured.key,
      controls: measured.controls,
      soft: measured.soft,
      hand: measured.hand,
      zones: measured.zones,
      source: measured.source,
      chrome: chrome === null ? undefined : Math.max(chrome, STRIP_ROOM.chrome),
    });
  }, [active, measured, box, count, anchor?.x, anchor?.y, extraHud, chrome]);

  useEffect(() => {
    roomed.current = room !== undefined;
  }, [room]);
  return { room, pending: active && measured === null };
}
