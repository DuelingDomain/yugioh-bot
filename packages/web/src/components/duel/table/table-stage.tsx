"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowUp } from "lucide-react";
import { flushSync } from "react-dom";
import { engineFormat } from "../multi-seat";
import type { GridFinaleBoard } from "./grid-finale";
import type { UseGridFocus } from "./grid-focus";
import { ChainRoomContext, type ChainStripSize } from "./chain-room";
import { AttackLine } from "./attack-line";
import { FlyCity } from "./fly-city";
import { onCrumbleStart } from "./crumble-gate";
import { watchMeasure } from "./measure-watch";
import { BAR_HUD, promptUnit } from "./grid-stage";
import { planPickBarRoom } from "./pick-bar-room";
import { isChainStripPrompt } from "../prompt-center";
import { aliveLayout, boardBounds, chainBandRooms, chainStripInset, flyWorld, holoAnchor, hubPose, isOwnFocus, normalizeAngle, ringAngles, CAMERA_HINT, HUD_CORNER, portraitTable, promptRooms, ringPose, type HoloAnchor, type PromptRoom, seatPoses, slotPlan, stageFit, stageSpread, STAGE, wideHoloAnchors } from "./geometry";
import { holoStatus, HoloLp } from "./holo-lp";
import { lastSeatDamage } from "./seat-state";
import { Plaza } from "./plaza";
import { ExitingSeat, RivalField } from "./rival-field";
import { TurnRing } from "./turn-ring";
import { useFlyGestures } from "./use-fly-gestures";
import { useFlyWorld } from "./use-fly-world";
import { GLIDE_MS, useSeatExits } from "./use-seat-exits";
import { occluderRects, useViewZoom } from "./use-view-zoom";
import { ROOF_ZOOM_MS } from "../tag/roof-camera";
import { zoneKey } from "../constants";
import { sameRects, type Rect } from "./rect-util";
import { useStripRoom } from "./use-strip-room";
import { ViewReset } from "./view-reset";
import { clearRoom, FOLLOW_ATTR, fitItemRect, fitRoom, followShift, VIEW_IDENTITY, type FitItem, type View } from "./view-zoom";
import type { CameraMode, SeatFieldProps, SeatPose, SeatTone, TableStageProps } from "./types";
import styles from "./table-stage.module.css";

/**
 * How many times larger the tilted world plane is laid out than drawn (see `.wstage` in table-stage.module.css).
 * A layer under the perspective is rasterized at a low fixed density, so this is the texel density of the fly-in view:
 * about two texels per screen pixel at the camera's home zoom, in steps of a quarter so a resize does not relayout every pixel.
 */
export function tiltSupersample(k: number): number {
  return Math.min(4, Math.max(1.5, Math.round(k * 2 * 4) / 4));
}

/** How long after a change the targets are measured again: the regroup glide and the crumble are over by then. */
const SETTLE_MS = 1500;

/** Your hand: it stays at its 1x place and size under the zoom of your own field (the view hook counters the zoom on it). */
const OWN_HAND = '[data-hand-seat][data-side="you"]';
/** A chip at the edge of the board box that points to a field off the screen: box px of its centre, and the arrow's turn. */
interface RivalHint {
  seat: number;
  x: number;
  y: number;
  angle: number;
}
/** The chip sits this far from the side edges; at the top edge it sits `HINT_TOP` from it, above the moved plates; at the bottom edge it clears the hand by `HINT_BAND`. */
const HINT_EDGE = 76;
const HINT_TOP = 24;
const HINT_BAND = 96;
function edgeHint(centre: { x: number; y: number }, box: { width: number; height: number }): Omit<RivalHint, "seat"> {
  const mid = { x: box.width / 2, y: box.height / 2 };
  const dx = centre.x - mid.x;
  const dy = centre.y - mid.y;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
  const x = Math.min(box.width - HINT_EDGE, Math.max(HINT_EDGE, centre.x));
  const y = centre.y < 0 ? HINT_TOP : Math.min(box.height - HINT_BAND, Math.max(HINT_TOP, centre.y));
  return { x: Math.round(x), y: Math.round(y), angle: Math.round(angle) };
}
/** The air (px) a prompt room keeps off the HUD. */
const HUD_AIR = 8;
/** The least size of a prompt room that still holds the seat choice (px). */
const PANEL_MIN = { width: 220, height: 170 } as const;
/** The HUD a chain-response panel keeps off unless the box leaves no place: the life plates, the phase strip and ring, the Reset control, the top bar. */
/** The rest of the HUD a chain-response panel keeps off while a place exists: it draws over the panel (the corners, the chain banner, the plates, the chip). */
/** The turn actions and the response switch (bottom right): the panel keeps off them. */
const STRIP_CONTROLS_HUD = "[data-testid='hud-corner']";
const STRIP_SOFT_HUD = "[data-grid-controls], [data-camera-panel], [data-testid='hud-master'], [data-opponent-bar], [data-table-chrome], [data-camera-chip], [data-chain-panel], [data-testid='chain-tower']";
const KEY_HUD = "[data-holo], [data-hub-slot], [data-turn-ring], [data-view-reset], [data-testid='hud-top']";
/** The card pinned in the peek (the fit keeps clear of it). */
const PINNED_PEEK = '[data-testid="hover-preview"][data-pinned="true"]';
/** The most a chip takes (the CSS max-width, 152 px, keeps it inside the box at the nearest it sits to a side edge). */
const HINT_SIZE = { width: 152, height: 28 } as const;
/**
 * Slides a chip along its edge to the first place that is clear of `blocks` (the Reset control, the legal targets): at a top or bottom
 * edge it slides sideways, at a side it slides up and down. With no clear place it stays at `base`.
 */
function clearHint(base: { x: number; y: number; angle: number }, box: { width: number; height: number }, blocks: readonly Rect[]): { x: number; y: number } {
  const hits = (x: number, y: number) => blocks.some((b) => x - HINT_SIZE.width / 2 < b.x + b.width + 6 && x + HINT_SIZE.width / 2 > b.x - 6 && y - HINT_SIZE.height / 2 < b.y + b.height + 6 && y + HINT_SIZE.height / 2 > b.y - 6);
  if (!hits(base.x, base.y)) return base;
  const sideways = Math.abs(Math.cos(((base.angle - 90) * Math.PI) / 180)) < Math.abs(Math.sin(((base.angle - 90) * Math.PI) / 180));
  for (let step = 1; step <= 40; step++) {
    for (const sign of [-1, 1]) {
      const d = sign * step * 16;
      const x = sideways ? Math.min(box.width - HINT_EDGE, Math.max(HINT_EDGE, base.x + d)) : base.x;
      const y = sideways ? base.y : Math.min(box.height - HINT_BAND, Math.max(HINT_TOP, base.y + d));
      if (!hits(x, y)) return { x, y };
    }
  }
  return base;
}
/** A fit at or under this scale shows no zoom: the camera does not enter focus for it. */
const NO_ZOOM = 1.02;
/** The size of a rival's LP plate on the stage, for the fit of a zoom (see holo-lp.module.css). */
const RIVAL_PLATE = { width: 196, height: 100 } as const;

export interface TableStageViewProps extends TableStageProps {
  /** The stored camera mode, when the FX lock shows another one (a lock sends the view home). */
  wantMode?: CameraMode;
  /** The FX lock is on. */
  locked?: boolean;
  /** Seats that are out of the duel: a click on them does nothing. */
  out?: readonly number[];
  /** The seat that holds the targets the viewer must pick: its field is ringed. The camera stays where it is. */
  targetSeat?: number | null;
  /** Draw the turn ring (default true on a 3-way table). */
  ring?: boolean;
  /** The focus of the 4-way grid, owned by the shell so the turn strip can drive it. The plaza stage ignores it. */
  grid?: UseGridFocus;
  /** Place of every seat that left, as text ("3rd"), for the chip on its panel while it fades. */
  placeLabels?: ReadonlyMap<number, string>;
  /** 4-way grid: the last two seats, laid out as one full board in the middle (the 1v1 composition), or null. */
  gridFinale?: GridFinaleBoard | null;
  /** 4-way grid: draws the phase hub for a place ("band" = the shared EMZ band, "center" = middle of the table). */
  gridHub?: (place: "band" | "center") => ReactNode;
  /** 4-way grid: where the hub sits. */
  hubPlace?: "band" | "center";
  /**
   * The floating HUD on a 3-way plaza: every prompt sits in the middle of the near field (yours, or the anchor's), as in
   * the 4-way grid and the 1v1 room, at a size that follows that field, and the pick bar in a clear place on it.
   */
  centerPrompts?: boolean;
}

/**
 * The stage of a 3 or 4 seat table. A 1100 by 860 canvas is scaled to fit the board box it sits in. The plaza, the
 * seat fields and the turn ring live in a world (`wstage`) that the fly-in camera turns, tilts and zooms; the holo LP
 * panels, the tethers and the attack line sit over the world, flat on the canvas. FX, the prompt panel and any
 * overlay are slots over the whole box, so they measure the real screen position of `[data-zones]` and
 * `[data-lp-seat]` nodes. `camera` is the camera to draw (the shell passes the effective one).
 */
export function TableStage({ controller, layout, camera: viewCamera, dispatchCamera, renderSeatField, fx, promptCenter, overlay, hub, masterChip, wantMode, locked = false, out = [], targetSeat = null, ring = true, placeLabels, centerPrompts = false }: TableStageViewProps) {
  const { engine, room, viewerSeat, nameOf, legalKeys, selectedKeys, reducedMotion } = controller;
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const perspRef = useRef<HTMLDivElement>(null);
  const tetherRef = useRef<SVGSVGElement>(null);
  const [measuredChainSize, setChainSize] = useState<ChainStripSize | null>(null);
  const [box, setBox] = useState({ width: 0, height: 0, screenWidth: 0 });

  useLayoutEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const measure = () => setBox((prev) => {
      const next = { width: node.clientWidth, height: node.clientHeight, screenWidth: window.innerWidth };
      return prev.width === next.width && prev.height === next.height && prev.screenWidth === next.screenWidth ? prev : next;
    });
    const read = () => measure();
    read();
    // The board box changes with a drawer opening beside it: draw the new fit in the same frame, so the stage
    // never shows one frame of the old fit clipped by the new box. The microtask runs before the frame paints, and
    // keeps flushSync out of any render or effect that happens to be running.
    const observer = new ResizeObserver(() => queueMicrotask(() => flushSync(measure)));
    observer.observe(node);
    window.addEventListener("resize", read);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", read);
    };
  }, []);

  // The seats still in the duel. A 3-way table regroups when one leaves (face to face); a 4-way table keeps its places.
  const outKey = out.join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const outSet = useMemo(() => new Set(out), [outKey]);
  const play = useMemo(() => aliveLayout(layout, outSet), [layout, outSet]);
  // Your own field zoomed stays zoomed when a seat goes out: the table regroups face to face under the same camera zoom (the camera
  // never zooms by itself). The seats are placed as at home, and the view is fitted again to the new field once they stand still.
  const ownKept = play !== layout && isOwnFocus(layout, viewCamera) && play.slots.some((slot) => slot.seat === layout.anchorSeat);
  const camera = useMemo(() => (ownKept ? { ...viewCamera, mode: "home" as const, focusSeat: null } : viewCamera), [ownKept, viewCamera]);

  // The seat poses measure fields. Their hand rows extend below the 860px field canvas.
  const portrait = useMemo(() => portraitTable(play, camera, box.screenWidth), [play, camera, box.screenWidth]);
  const reserveChain = (layout.format === "ffa3" || layout.format === "ffa4") && (box.screenWidth > 640 || portrait != null);
  const chainSize = reserveChain ? measuredChainSize : null;
  const promptRef = useRef<HTMLDivElement>(null);
  const [phonePromptHeight, setPhonePromptHeight] = useState(0);
  useLayoutEffect(() => {
    if (!portrait) { setPhonePromptHeight(0); return; }
    const node = promptRef.current;
    if (!node) return;
    const measure = () => {
      const panel = node.querySelector<HTMLElement>("[data-prompt-panel]");
      setPhonePromptHeight(panel ? Math.ceil(panel.getBoundingClientRect().height) + 8 : 0);
    };
    measure();
    const observer = new ResizeObserver(measure);
    const observePanels = () => {
      observer.disconnect();
      for (const panel of node.querySelectorAll("[data-prompt-panel]")) observer.observe(panel);
      measure();
    };
    const mutations = new MutationObserver(observePanels);
    mutations.observe(node, { childList: true, subtree: true });
    observePanels();
    return () => { observer.disconnect(); mutations.disconnect(); };
  }, [portrait, promptCenter]);
  const canvasHeight = portrait?.height ?? STAGE.height + 96;
  const chainInset = useMemo(() => portrait && chainSize ? chainSize.height + 12 : chainStripInset({ layout: play, camera, box, chainSize, meFooter: masterChip != null }), [play, camera, box, chainSize, masterChip != null, portrait]);
  // The seat switcher and camera status belong to the phone chrome, outside the fitted table.
  const stageTop = chainInset + (portrait ? 44 : 0);
  const stageHeight = Math.max(0, box.height - stageTop - (portrait ? 40 + phonePromptHeight : 0));
  const fitBox = useMemo(() => ({ ...box, height: stageHeight * STAGE.height / canvasHeight }), [box, stageHeight, canvasHeight]);
  const k = portrait ? Math.min(box.width / portrait.width, stageHeight / portrait.height) : stageFit(fitBox);
  // Only a table that regroups glides; a table that keeps its places has nothing to move.
  const regroup = play !== layout;
  const threeWay = slotPlan(play, { mode: "home" }) != null;
  const fly = camera.mode === "fly" && threeWay;
  // The city is heavy: it mounts the first time the fly-in shows and stays (the fade out needs it).
  const [cityOn, setCityOn] = useState(fly);
  if (fly && !cityOn) setCityOn(true);
  const rawPoses = useMemo(() => portrait?.poses ?? seatPoses(play, camera, fitBox), [play, camera, fitBox, portrait]);
  // Zoom and pan of the board under a flat camera (view-zoom.ts): the plaza, the fields and the ring zoom; the holo
  // panels, the hub and the prompts stay. The fly-in view keeps its own orbit and zoom. A new camera view resets it.
  const zoomFrame = useMemo(
    () => ({ x: (box.width - STAGE.width * k) / 2, y: stageTop + (stageHeight - canvasHeight * k) / 2, k }),
    [box.width, k, stageTop, stageHeight, canvasHeight],
  );
  // Your own field enlarged (3-way) is a camera zoom of this board layer: the seats stay home, and your hand (HUD) stays at its size and place.
  const ownZoom = !fly && !portrait && (ownKept || isOwnFocus(play, camera));
  // The zoom out eases: your hand and the moved plates keep their place until the view is back at the camera pose.
  const [ownHold, setOwnHold] = useState(false);
  // The view the last fit aimed at: the rooms (panel, bar, chain) clear the field at THIS view, not at the live one, so a pan or a
  // refit does not move them again (a room that moves with the view would move the view back: a loop).
  const [fitted, setFitted] = useState<View | null>(null);
  // The chips that point to a rival field off the screen (measured below); they are HUD (data-zoom-occluder), so the pan keeps clear of them.
  const [rivalHints, setRivalHints] = useState<readonly RivalHint[]>([]);
  const zoom = useViewZoom({
    rootRef,
    layerRef: perspRef,
    enabled: !fly && k > 0,
    fixed: ownZoom || ownHold ? OWN_HAND : undefined,
    reducedMotion,
    resetKey: `${viewCamera.mode}|${viewCamera.focusSeat ?? ""}|${viewCamera.lookSeat ?? ""}|${portrait ? "portrait" : "wide"}`,
    frame: zoomFrame,
  });
  // How much plaza a wide box shows beyond each side of the 1100 px stage; zero for a box that is not wider.
  const spread = useMemo(() => portrait ? 0 : stageSpread(fitBox), [fitBox, portrait]);

  // A seat turns by the short way between two places: the angle it draws is the previous one plus the smallest turn.
  const turned = useRef(new Map<number, number>());
  const poses = useMemo(() => {
    const next = new Map<number, SeatPose>();
    for (const [seat, pose] of rawPoses) {
      const before = turned.current.get(seat);
      const rotateDeg = before == null ? pose.rotateDeg : before + normalizeAngle(pose.rotateDeg - before);
      turned.current.set(seat, rotateDeg);
      next.set(seat, rotateDeg === pose.rotateDeg ? pose : { ...pose, rotateDeg });
    }
    return next;
  }, [rawPoses]);

  // Docked holo panels of a wide table (home and look); other cameras keep the panels of the 1100 px stage.
  const hasChip = masterChip != null;
  const hint = useMemo(() => ({ width: CAMERA_HINT.width / (k || 1), height: CAMERA_HINT.height / (k || 1) }), [k]);
  const hudCorner = useMemo(() => (centerPrompts ? { width: HUD_CORNER.width / (k || 1), height: HUD_CORNER.height / (k || 1) } : undefined), [centerPrompts, k]);
  const wideAnchors = useMemo(() => portrait?.anchors ?? wideHoloAnchors(play, camera, poses, spread, hasChip, k > 0 ? { hint, hud: hudCorner } : undefined), [play, camera, poses, spread, hasChip, k, hint, hudCorner, portrait]);
  // Your own field zoomed: the rivals' plates sit above its top corners (they follow the board at their own size), so the field
  // can grow to the width the free box gives it. They stay there until the view is back at the camera pose, then glide home.
  const plateAnchors = useMemo(() => {
    if (!(ownZoom || ownHold) || portrait) return wideAnchors;
    const mine = poses.get(layout.anchorSeat);
    if (!mine) return wideAnchors;
    const b = boardBounds(mine);
    const next = new Map(wideAnchors ?? play.slots.map((slot) => [slot.seat, holoAnchor(play, slot.seat, camera)] as const));
    play.slots.forEach((slot, place) => {
      if (slot.seat === layout.anchorSeat) return;
      const old = next.get(slot.seat);
      next.set(slot.seat, { ...(old ?? { me: false, beam: "none" as const }), x: place === 1 ? b.l : b.r - RIVAL_PLATE.width, y: b.t - RIVAL_PLATE.height - 14, me: false, beam: "none" });
    });
    return next;
  }, [ownZoom, ownHold, portrait, wideAnchors, poses, play, layout.anchorSeat, camera]);
  // The phase hub strip: the classic place, or at a wide table (home and look) the clear place nearest the ring or your field.
  // The place only depends on the camera's mode and target, so a fly-in drag (which changes only `camera.fly`) does not rescan.
  const hubAt = useMemo(
    () => (hub && threeWay && !portrait ? hubPose(play, camera, { box: fitBox, meFooter: hasChip, ...(centerPrompts ? { hud: HUD_CORNER } : {}) }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hub != null, threeWay, play, camera.mode, camera.focusSeat, camera.lookSeat, fitBox, hasChip, portrait, centerPrompts],
  );
  // What a zoom of your own field keeps on screen (board-box px at the camera pose): the field, and the plates and the phase strip
  // that follow it at their own size (followShift).
  const fitItems = useMemo(() => {
    if (!ownZoom && !ownHold) return [];
    const field = poses.get(layout.anchorSeat);
    if (!field || portrait) return [];
    const f = zoomFrame;
    const toBox = (x: number, y: number, width: number, height: number) => ({ x: f.x + x * f.k, y: f.y + y * f.k, width: width * f.k, height: height * f.k });
    const bounds = boardBounds(field);
    const out: FitItem[] = [{ rect: toBox(bounds.l, bounds.t, bounds.r - bounds.l, bounds.b - bounds.t) }];
    for (const slot of play.slots) {
      const at = plateAnchors?.get(slot.seat) ?? holoAnchor(play, slot.seat, camera);
      const width = at.me ? 212 : RIVAL_PLATE.width;
      const height = at.me ? 128 : RIVAL_PLATE.height;
      out.push({ rect: toBox(at.x, at.y, width, height), anchor: { x: f.x + (at.x + width / 2) * f.k, y: f.y + (at.y + 34) * f.k } });
    }
    if (hubAt) out.push({ rect: toBox(hubAt.x - hubAt.width / 2, hubAt.y - hubAt.height / 2, hubAt.width, hubAt.height), anchor: { x: f.x + hubAt.x * f.k, y: f.y + hubAt.y * f.k } });
    return out;
  }, [ownZoom, ownHold, poses, layout.anchorSeat, portrait, zoomFrame, play, plateAnchors, camera, hubAt]);
  // The fixed HUD over the board (the corners, the Deck Master plate, the camera chip, the plates) and the card pinned in the peek: no prompt room
  // stands on them. Measured with the targets below.
  const [hudRects, setHudRects] = useState<readonly Rect[]>([]);
  const [pinnedRect, setPinnedRect] = useState<Rect | null>(null);
  // Your hand and the legal targets are in the way too: a prompt room never covers a card the player can click.
  const [handRect, setHandRect] = useState<Rect | null>(null);
  const [targets, setTargets] = useState<readonly Rect[]>([]);
  // Free rooms for the prompts (a seat choice, "Activate?", the card-pick bar): off every board and plate, so a prompt that is
  // about a rival's field never covers it. In screen px of the board box; the prompt CSS and the select bar read them.
  const rooms = useMemo(() => {
    if (!(k > 0) || fly) return null;
    if (portrait) return { panel: null, bar: null, chain: chainSize ? { x: 6, y: 48, ...chainSize } : null };
    if (chainInset && chainSize) return chainBandRooms(chainSize, box);
    // A zoomed board keeps the rooms of the camera pose: the panel and the pick bar stay where they are at rest, clear
    // of every card there, and the pan can take any card out from under them (the safe frame of useViewZoom).
    const anchors = new Map(play.slots.map((slot) => [slot.seat, plateAnchors?.get(slot.seat) ?? holoAnchor(play, slot.seat, camera)] as const));
    const found = promptRooms({ layout: play, camera, poses, anchors, spread, meFooter: hasChip, box, k, chainSize });
    const dx = (box.width - STAGE.width * k) / 2;
    const dy = stageTop + (stageHeight - canvasHeight * k) / 2;
    const toBox = (room: PromptRoom | null) => room && { x: Math.round(dx + room.x * k), y: Math.round(dy + room.y * k), width: Math.round(room.width * k), height: Math.round(room.height * k) };
    // No free room for the panel: the CSS puts it at the lower left (its fallback rules). When the HUD or the zoomed field stands there (the Deck
    // Master plate), the panel gets a room beside it instead. A clear fallback stays with the CSS.
    const own = { x: 10, y: box.height - Math.round(box.height * 0.12) - Math.round(box.height * 0.45), width: Math.round(Math.min(320, Math.max(220, box.width * 0.27))), height: Math.round(box.height * 0.45) };
    // The HUD, your hand and the legal targets, with a little air: a room that ends 1 px from the chip would look as if it touched it.
    const airy = [...hudRects, ...(pinnedRect ? [pinnedRect] : []), ...(handRect ? [handRect] : []), ...targets].map((r) => ({ x: r.x - HUD_AIR, y: r.y - HUD_AIR, width: r.width + 2 * HUD_AIR, height: r.height + 2 * HUD_AIR }));
    // `tiers`: the obstacles to keep clear of, most first. When no place is clear of all of them, the panel keeps clear of the next set (the
    // zoomed field comes before the HUD: a panel over an empty zone is better than a panel over a plate that hides a row).
    const settle = (...tiers: (readonly Rect[])[]) => {
      const panel = toBox(found.panel);
      // The panel is about 150 px high with two rivals to choose: a smaller room is clear where the full one is not.
      let placed: Rect | null = null;
      for (const obstacles of tiers) {
        placed = fitRoom(panel ?? own, obstacles, box, PANEL_MIN);
        if (placed) break;
      }
      return { panel: panel ? placed ?? panel : placed && !sameRects([placed], [own]) ? placed : null, bar: toBox(found.bar), chain: toBox(found.chain) };
    };
    // Your own field zoomed: the rooms are planned at the camera pose, where the field is smaller. Each room moves off the zoomed
    // field and the plates that follow it (the view is read at rest; the rooms follow when the zoom ends).
    if (!(ownZoom || ownHold) || !fitted || fitted.s <= NO_ZOOM || fitItems.length === 0) return settle(airy);
    const view = fitted;
    // The zoomed field, and the HUD that stays on screen (the Deck Master plate, the chip, the responses, a pinned peek).
    const hud = airy;
    const obstacles = [...fitItems.map((item) => fitItemRect(item, view)), ...hud];
    const mapped = settle(obstacles, hud);
    const move = (room: Rect | null) => (room ? clearRoom(room, obstacles, box) : room);
    return { panel: mapped.panel, bar: move(mapped.bar), chain: move(mapped.chain) };
  }, [play, camera, poses, spread, hasChip, k, fly, box, canvasHeight, plateAnchors, chainSize, chainInset, stageHeight, stageTop, portrait, ownZoom, ownHold, fitItems, fitted, hudRects, pinnedRect, handRect, targets]);

  // The floating HUD: the prompts sit in the middle of the near field (the first seat of the table: you, or the anchor), in
  // box px; --pr-* carry that box to the prompt CSS. The pick bar finds a clear place on that field (never over a target);
  // when the field is full of targets, the free room off every board takes it.
  // While the board is zoomed the prompts keep their dock (the HUD stays put), and the pick bar docks off the HUD.
  const floating = centerPrompts && !fly && !portrait && k > 0;
  const near = floating && !zoom.zoomed ? poses.get(play.slots[0]?.seat ?? -1) : undefined;
  const nearBox = useMemo(() => {
    if (!near) return null;
    const b = boardBounds(near);
    const dx = (box.width - STAGE.width * k) / 2;
    const dy = stageTop + (stageHeight - canvasHeight * k) / 2;
    return { x: Math.round(dx + b.l * k), y: Math.round(dy + b.t * k), width: Math.round((b.r - b.l) * k), height: Math.round((b.b - b.t) * k) };
  }, [near, box.width, k, stageTop, stageHeight, canvasHeight]);
  const promptStyle = nearBox
    ? ({
        ["--pr-cx" as string]: `${Math.round(nearBox.x + nearBox.width / 2)}px`,
        ["--pr-cy" as string]: `${Math.round(nearBox.y + nearBox.height / 2)}px`,
        ["--pr-w" as string]: `${nearBox.width}px`,
        ["--pr-h" as string]: `${nearBox.height}px`,
        ["--pr-unit" as string]: `${promptUnit(nearBox.height, false)}px`,
      } as CSSProperties)
    : undefined;
  const [cards, setCards] = useState<readonly Rect[]>([]);
  // A pan or zoom by hand moves every zone on screen: the targets are measured again when it comes to rest (the camera is not touched, only the
  // bar room). The count of the player's moves, not the view: the refit clamp that follows a new bar room moves the view and must not measure again.
  const handMoves = zoom.zoomed ? zoom.handMoves() : 0;
  const legalKey = [...legalKeys].sort().join(",");
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !floating) return;
    const measure = () => {
      const board = root.getBoundingClientRect();
      const boxes = (selector: string) => Array.from(root.querySelectorAll<HTMLElement>(selector))
        .map((node) => node.getBoundingClientRect())
        .filter((r) => r.width > 1 && r.height > 1)
        .map((r) => ({ x: Math.round(r.left - board.left), y: Math.round(r.top - board.top), width: Math.round(r.width), height: Math.round(r.height) }));
      const next = boxes('[data-legal="true"]');
      // The life-point plates are HUD too: the docked bar keeps off them.
      const hud = occluderRects(root, `${BAR_HUD}, [data-holo], [data-camera-chip], [data-hub-slot], [data-turn-ring], [data-chain-panel], [data-testid="chain-tower"]`).map((r) => ({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }));
      setTargets((current) => (sameRects(current, next) ? current : next));
      // Zones that hold a card or a pile: the bar keeps off them while a clear place exists.
      const held = boxes('[data-zones][data-occupied="true"]:not([data-legal="true"])');
      setCards((current) => (sameRects(current, held) ? current : held));
      setHudRects((current) => (sameRects(current, hud) ? current : hud));
      // Your hand (HUD under an own-field zoom): the pick bar keeps off it.
      const hand = boxes(`${OWN_HAND} [data-hand-card]`);
      const union = hand.length === 0 ? null : (() => {
        const x = Math.min(...hand.map((r) => r.x));
        const y = Math.min(...hand.map((r) => r.y));
        return { x, y, width: Math.max(...hand.map((r) => r.x + r.width)) - x, height: Math.max(...hand.map((r) => r.y + r.height)) - y };
      })();
      setHandRect((current) => (current && union && sameRects([current], [union]) ? current : union));
    };
    // Once the seats stand still (a regroup, the FINAL DUEL board, glides them to new places); watched while a pick is open.
    const stop = watchMeasure(root, measure, { settleMs: reducedMotion ? 0 : regroup ? GLIDE_MS : SETTLE_MS, watch: legalKey !== "" });
    if (!regroup || reducedMotion) return stop;
    // A crumble that waited for the battle (crumble-gate.ts) starts late and the regroup glide with it: measure again when it ends.
    let again: number | undefined;
    const off = onCrumbleStart(() => {
      window.clearTimeout(again);
      again = window.setTimeout(measure, GLIDE_MS);
    });
    return () => {
      stop();
      off();
      window.clearTimeout(again);
    };
  }, [floating, nearBox, legalKey, reducedMotion, regroup, zoom.zoomed, ownZoom, handMoves]);
  // The card-pick bar: the clear place nearest the middle of the box, always inside it, off the legal targets, your live hand (and a card
  // raised from it) and the HUD, and off the cards on the board while a clear place exists (see pick-bar-room.ts). The same plan holds at
  // home, in rival focus and in your own zoom: the camera never moves for it.
  const barRoom = useMemo(() => {
    if (!floating) return undefined;
    if (!zoom.zoomed && !nearBox) return undefined;
    return planPickBarRoom({ box, targets, hand: handRect, hud: pinnedRect ? [...hudRects, pinnedRect] : hudRects, cards });
  }, [floating, zoom.zoomed, handRect, nearBox, targets, cards, hudRects, pinnedRect, box]);

  // The chain-response panel (every option a card): a wide room of its own, big enough for large cards, wholly inside the box, off the HUD,
  // the chain's cards and your hand (it may cover the field). At home it starts from the middle of your field, in your own zoom from the middle
  // of the box. It is measured and planned at rest, once (use-strip-room.ts); the camera never moves for it.
  const stripCount = controller.prompt && isChainStripPrompt(controller.prompt) ? controller.prompt.options.length : 0;
  const stripAnchor = useMemo(() => (nearBox ? { x: nearBox.x + nearBox.width / 2, y: nearBox.y + nearBox.height / 2 } : undefined), [nearBox]);
  const sourceKeys = useMemo(() => engine.chain.flatMap((link) => (link.zone ? [zoneKey(link.zone.controller, link.zone.location, link.zone.sequence)] : [])), [engine.chain]);
  const { room: stripRoom, pending: stripPending } = useStripRoom({
    rootRef,
    active: floating && stripCount > 0,
    promptId: controller.prompt?.id ?? "",
    count: stripCount,
    box,
    anchor: stripAnchor,
    keyHud: KEY_HUD,
    controlsHud: STRIP_CONTROLS_HUD,
    softHud: STRIP_SOFT_HUD,
    hand: `${OWN_HAND} [data-hand-card]`,
    sourceKeys,
    extraHud: pinnedRect,
    viewKey: `${zoom.zoomed ? 1 : 0}|${ownZoom ? 1 : 0}|${handMoves}|${regroup ? 1 : 0}|${Math.round(zoom.view.s * 100)}|${Math.round(zoom.view.x)},${Math.round(zoom.view.y)}`,
  });
  const stripKey = stripRoom ? `${stripRoom.x},${stripRoom.y},${stripRoom.width},${stripRoom.height}` : "";

  // A prompt that opens, closes or moves changes the HUD insets: the view eases into the new clamps (no gap stays).
  const hudKey = `${controller.prompt?.id ?? ""}|${promptCenter ? 1 : 0}|${overlay ? 1 : 0}|${controller.seatPick ? 1 : 0}|${barRoom ?? ""}|${stripKey}|${rooms?.panel ? `${rooms.panel.x},${rooms.panel.y}` : ""}|${rivalHints.map((h) => h.seat).join(",")}`;
  const { refit } = zoom;
  useEffect(() => {
    const frame = window.requestAnimationFrame(refit);
    return () => window.cancelAnimationFrame(frame);
  }, [hudKey, refit]);

  const world = useMemo(() => flyWorld(play, camera.fly), [play, camera.fly]);
  const tones = useMemo(() => new Map<number, SeatTone>(layout.slots.map((slot) => [slot.seat, slot.tone])), [layout.slots]);
  const looking = camera.mode === "look";
  // A seat that leaves crumbles at the pose it had; the seats that stay glide to their new places.
  const { exits, gliding, finish } = useSeatExits({
    out,
    seats: engine.seats,
    poses,
    faceUpHand: (seat) => layout.slots.find((slot) => slot.seat === seat)?.relation === "self" && !looking,
    enabled: layout.format !== "tag",
    regroups: regroup,
    resetKey: `${room.session.slug}:${room.series?.gameNumber ?? 0}`,
  });
  // The docked anchors the panels had before the seats regrouped: the panel of a seat that leaves fades there.
  const heldAnchors = useRef(new Map<number, HoloAnchor>());
  const shownAnchors = new Map<number, HoloAnchor>();
  useLayoutEffect(() => {
    if (!(gliding && regroup)) heldAnchors.current = shownAnchors;
  });
  useFlyWorld({
    active: fly,
    target: world,
    free: camera.fly.free === true,
    reducedMotion,
    canvasRef,
    worldRef,
    tetherRef,
    viewerSeat: layout.anchorSeat,
    flySeat: camera.fly.targetSeat,
    tones,
  });
  useFlyGestures(rootRef, fly, dispatchCamera);

  const format = engineFormat(engine);
  const masterRule = room.session.masterRule;
  const picks = controller.seatPick;
  const pickOrder = picks ? play.slots.map((slot) => slot.seat).filter((seat) => picks.options.has(seat)) : [];
  const promptSeat = controller.prompt?.seat ?? null;
  const flyYaw = fly ? world.yawDeg : 0;

  const plaza3 = layout.format === "ffa3" && layout.slots.length === 3;

  // A click on a field never moves the camera, in any mode (a misclick would zoom or fly in): the seat buttons, the Zoom my field
  // button and the keys do, and Enter or a screen reader's click on a field box (see `reach`). A card keeps its own click.

  const canvas: CSSProperties & Record<string, string | number> = {
    width: STAGE.width,
    height: canvasHeight,
    transform: `translate(${(box.width - STAGE.width * k) / 2}px, ${stageTop + (stageHeight - canvasHeight * k) / 2}px) scale(${k})`,
    "--ss": tiltSupersample(k),
    "--stage-k": k,
    "--spread": `${spread}px`,
  };
  const attackerSeat = controller.aim?.from ? Number(controller.aim.from.split(":")[0]) : null;
  const attackerTone = (attackerSeat != null ? tones.get(attackerSeat) : null) ?? "violet";
  const ringAt = ringPose(play, camera, spread);
  // Your own field enlarged: the camera eases (360 ms, as the Tag camera) to the zoom that fits the field, and the plates and the
  // phase strip that follow it, into the free box between the HUD parts. Leaving it eases back. A resize while it stays refits at once.
  const ownFit = useRef(false);
  // A new fit of the field after a resize (or the entry) always: the box is new. The chain strip is not a resize (it changes the frame, not the
  // box). A pinned peek, the master chip, the hub or the chain strip moving change the free box: they refit with an ease (never a snap),
  // but only when the player has not moved the view by hand (a refit on a prompt or a hover would undo that pan or zoom).
  const fitKey = `${ownZoom ? 1 : 0}|${Math.round(box.width)}|${Math.round(box.height)}`;
  useEffect(() => {
    const root = rootRef.current;
    if (!ownZoom || !root) {
      setPinnedRect(null);
      return;
    }
    let frame = 0;
    const read = () => {
      frame = 0;
      const node = (shell ?? root.ownerDocument).querySelector<HTMLElement>(PINNED_PEEK);
      const r = node?.getBoundingClientRect();
      const board = root.getBoundingClientRect();
      const next = r && r.width > 2 && r.height > 2 ? { x: Math.round(r.left - board.left), y: Math.round(r.top - board.top), width: Math.round(r.width), height: Math.round(r.height) } : null;
      setPinnedRect((current) => (current === next || (current && next && sameRects([current], [next])) ? current : next));
    };
    // The peek lives in the table shell (beside the stage): the watch stays inside it, not on the whole page.
    const shell = root.closest<HTMLElement>("[data-table-shell]");
    const observer = new MutationObserver(() => {
      if (!frame) frame = window.requestAnimationFrame(read);
    });
    observer.observe(shell ?? root, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-pinned"] });
    // The peek slides in: the rect is read again when its own transition ends, so it is not the rect of the first frame.
    const onEnd = (event: Event) => {
      if (!frame && event.target instanceof Element && event.target.closest(PINNED_PEEK)) frame = window.requestAnimationFrame(read);
    };
    (shell ?? root).addEventListener("transitionend", onEnd);
    read();
    return () => {
      observer.disconnect();
      (shell ?? root).removeEventListener("transitionend", onEnd);
      window.cancelAnimationFrame(frame);
    };
  }, [ownZoom]);
  // The chain strip moves the stage frame (its top, its scale): the field that was fitted moves with it, so the fit is made again (eased).
  // The pinned peek counts by its side and its rect in steps of 16 px: the slide and a settled peek are one refit, and a peek that is a few px off never refits.
  const peekKey = pinnedRect ? `${pinnedRect.x + pinnedRect.width / 2 < box.width / 2 ? "l" : "r"}${[pinnedRect.x, pinnedRect.y, pinnedRect.width, pinnedRect.height].map((v) => Math.round(v / 16)).join(",")}` : "0";
  // The seats of a table that regroups glide to their new places: a fit made before they stand still would aim at a field that is still moving.
  const regrouping = gliding && regroup;
  const softKey = `${peekKey}|${hasChip ? 1 : 0}|${hubAt ? `${Math.round(hubAt.x)},${Math.round(hubAt.y)}` : ""}|${Math.round(chainInset)}|${regrouping ? "g" : "s"}`;
  const lastFitKey = useRef("");
  // A seat went out while the field was zoomed: the first fit after the glide is the refit to the new field.
  const afterRegroup = useRef(false);
  const { zoomFit, zoomTo, byHand, refit: clampToBox } = zoom;
  useLayoutEffect(() => {
    const root = rootRef.current;
    const was = ownFit.current;
    if (ownZoom && was && regrouping) {
      afterRegroup.current = true;
      return;
    }
    ownFit.current = ownZoom;
    const hard = !was || lastFitKey.current !== fitKey;
    lastFitKey.current = fitKey;
    if (!root) return;
    if (!ownZoom) {
      if (was) zoomTo(VIEW_IDENTITY, ROOF_ZOOM_MS);
      return;
    }
    if (fitItems.length === 0) return;
    // A pinned peek, the chip, the hub or the chain strip moved: the player's own pan or zoom stays.
    if (!hard && byHand()) {
      // The player's own zoom level stays after an elimination; the view is only kept clear of the new field's edge.
      if (afterRegroup.current) clampToBox();
      afterRegroup.current = false;
      return;
    }
    afterRegroup.current = false;
    const items = fitItems;
    // Your hand stays where it is: the free box ends above it.
    const box = root.getBoundingClientRect();
    const cards = Array.from(root.querySelectorAll<HTMLElement>(`${OWN_HAND} [data-hand-card]`)).map((node) => node.getBoundingClientRect());
    const avoid = cards.length > 0 ? [{ x: Math.min(...cards.map((r) => r.left)) - box.left, y: Math.min(...cards.map((r) => r.top)) - box.top, width: Math.max(...cards.map((r) => r.right)) - Math.min(...cards.map((r) => r.left)), height: box.bottom - Math.min(...cards.map((r) => r.top)) }] : [];
    // The chain strip across the top (a window with no room for it beside the field): the fit keeps clear of it.
    if (chainInset > 0 && !portrait) avoid.push({ x: 0, y: 0, width: box.width, height: chainInset + 8 });
    // A card pinned in the peek is stable: the fit keeps clear of it (read from the DOM; the hover peek moves away by itself).
    const pinned = document.querySelector<HTMLElement>(PINNED_PEEK);
    if (pinned) {
      const r = pinned.getBoundingClientRect();
      if (r.width > 2 && r.height > 2) avoid.push({ x: r.left - box.left, y: r.top - box.top, width: r.width, height: r.height });
    }
    // The entry and a soft refit ease; a resize lands at once.
    const target = zoomFit(items, avoid, !was || !hard ? ROOF_ZOOM_MS : 0);
    setFitted(target);
    // The entry into a window with no room to enlarge the field (the fit is the camera scale): nothing to zoom, so the camera stays home.
    // On a resize later the camera never moves by itself: the focus stays, at about 1x.
    if (!was && target.s <= NO_ZOOM) dispatchCamera({ type: "home" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, softKey]);
  // The view came back to the camera pose by itself (the reset button, a double click, a wheel out): the camera follows it home.
  const zoomedOnce = useRef(false);
  useEffect(() => {
    if (ownZoom) setOwnHold(true);
    else if (!zoom.zoomed) {
      setOwnHold(false);
      setFitted(null);
    }
  }, [ownZoom, zoom.zoomed]);
  useEffect(() => {
    if (!ownZoom) {
      zoomedOnce.current = false;
      return;
    }
    if (zoom.zoomed) zoomedOnce.current = true;
    else if (zoomedOnce.current) {
      zoomedOnce.current = false;
      dispatchCamera({ type: "home" });
    }
  }, [ownZoom, zoom.zoomed, dispatchCamera]);

  // A prompt or an aim that is about a rival's field (the legal targets, a seat choice, the aim): the camera does not move by itself,
  // so while your own field is zoomed and that field is off the screen, a chip at the edge points to it. A click on it zooms out.
  const rivalSeats = useMemo(() => {
    const seats = new Set<number>();
    const add = (seat: number | null | undefined) => {
      if (seat != null && Number.isFinite(seat) && seat !== layout.anchorSeat) seats.add(seat);
    };
    for (const key of legalKeys) add(Number(key.split(":")[0]));
    for (const key of controller.aim?.to.zones ?? []) add(Number(key.split(":")[0]));
    add(controller.aim?.to.lpSeat);
    add(targetSeat);
    for (const seat of picks?.options.keys() ?? []) add(seat);
    return [...seats].sort((x, y) => x - y);
  }, [legalKeys, controller.aim, targetSeat, picks, layout.anchorSeat]);
  const rivalSeatKey = ownZoom ? rivalSeats.join(",") : "";
  useEffect(() => {
    const root = rootRef.current;
    if (!root || rivalSeatKey === "") {
      setRivalHints((current) => (current.length === 0 ? current : []));
      return;
    }
    const frame = requestAnimationFrame(() => {
      const bounds = root.getBoundingClientRect();
      const found: RivalHint[] = [];
      // What the chip keeps clear of: the Reset control and the legal targets (board-box px).
      const blocks = [...Array.from(root.querySelectorAll<HTMLElement>("[data-view-reset], [data-legal='true']"))]
        .map((node) => node.getBoundingClientRect())
        .filter((r) => r.width > 2 && r.height > 2)
        .map((r) => ({ x: r.left - bounds.left, y: r.top - bounds.top, width: r.width, height: r.height }));
      for (const seat of rivalSeatKey.split(",").map(Number)) {
        const slot = root.querySelector<HTMLElement>(`[data-seat-slot="${seat}"]`);
        if (!slot) continue;
        const r = slot.getBoundingClientRect();
        const area = Math.max(1, r.width * r.height);
        const seen = Math.max(0, Math.min(r.right, bounds.right) - Math.max(r.left, bounds.left)) * Math.max(0, Math.min(r.bottom, bounds.bottom) - Math.max(r.top, bounds.top));
        // Most of the field is on screen: nothing to point at.
        if (seen / area > 0.5) continue;
        const size = { width: bounds.width, height: bounds.height };
        const base = edgeHint({ x: r.left + r.width / 2 - bounds.left, y: r.top + r.height / 2 - bounds.top }, size);
        found.push({ seat, ...base, ...clearHint(base, size, blocks) });
      }
      setRivalHints((current) => (JSON.stringify(current) === JSON.stringify(found) ? current : found));
    });
    return () => cancelAnimationFrame(frame);
  }, [rivalSeatKey, zoom.view, box.width, box.height, rootRef]);

  return (
    <div
      ref={rootRef}
      className={styles.board}
      tabIndex={-1}
      data-portrait={portrait ? "true" : undefined}
      data-prompt-scope
      data-table-stage={layout.format}
      data-format={format}
      data-camera-mode={viewCamera.mode}
      data-regroup={gliding && regroup ? "true" : undefined}
      data-camera-want={wantMode ?? viewCamera.mode}
      data-camera-lock={locked ? "true" : undefined}
      data-fly={fly ? "true" : "false"}
      data-upright={camera.upright ? "true" : "false"}
      data-stage-scale={k.toFixed(3)}
      data-stage-spread={spread}
      data-ready={k > 0 ? "true" : "false"}
      data-battle={engine.phase === "battle" ? "true" : undefined}
      data-chain-room={rooms?.chain ? `${rooms.chain.x},${rooms.chain.y},${rooms.chain.width},${rooms.chain.height}` : undefined}
      data-prompt-center={nearBox ? "true" : undefined}
      data-panel-room={rooms?.panel && !nearBox ? "true" : undefined}
      data-room-snug={rooms?.panel && !nearBox && (rooms.panel.width < 262 || rooms.panel.height < 300) ? "true" : undefined}
      data-bar-clamp={barRoom ? "true" : undefined}
      data-bar-room={barRoom ?? (rooms?.bar ? `${rooms.bar.x},${rooms.bar.y},${rooms.bar.width},${rooms.bar.height}` : undefined)}
      data-strip-room={stripRoom ? "true" : undefined}
      data-strip-pending={stripPending ? "true" : undefined}
      style={stripRoom || (rooms?.panel && !nearBox) ? ({ ...(stripRoom ? { "--sr-x": `${stripRoom.x}px`, "--sr-y": `${stripRoom.y}px`, "--sr-w": `${stripRoom.width}px`, "--sr-h": `${stripRoom.height}px`, "--sr-card": `${stripRoom.card}px` } : {}), ...(rooms?.panel && !nearBox ? { "--room-x": `${rooms.panel.x}px`, "--room-y": `${rooms.panel.y}px`, "--room-w": `${rooms.panel.width}px`, "--room-h": `${rooms.panel.height}px` } : {}) } as CSSProperties) : undefined}
    >
      <div ref={canvasRef} className={styles.canvas} style={canvas} data-fly-capable={threeWay ? "true" : undefined}>
        {threeWay ? (
          <>
            <div className={styles.sky} aria-hidden="true" />
            <div className={styles.fog} aria-hidden="true" />
          </>
        ) : null}
        <div ref={perspRef} className={styles.persp} data-view-layer>
          <div ref={worldRef} className={styles.world} data-world>
            {threeWay && cityOn ? <FlyCity /> : null}
            <div className={styles.wstage}>
              <Plaza
                layout={play}
                poses={poses}
                fly={fly}
                hidden={outSet}
                exits={exits.map((exit) => ({ seat: exit.seat, tone: tones.get(exit.seat) ?? "violet", pose: exit.pose }))}
                glide={gliding && regroup}
                reducedMotion={reducedMotion}
              />
              {ring && !portrait && threeWay ? (
                <TurnRing
                  layout={play}
                  numbering={layout}
                  engine={engine}
                  angles={ringAngles(play, camera)}
                  pose={ringAt}
                  promptSeat={promptSeat}
                  locked={locked}
                />
              ) : null}
              {exits.map((exit) => (
                <ExitingSeat
                  key={`exit${exit.seat}`}
                  pose={exit.pose}
                  tone={tones.get(exit.seat) ?? "violet"}
                  view={exit.view}
                  masterRule={masterRule}
                  faceUpHand={exit.faceUpHand}
                  angleOffsetDeg={flyYaw}
                  reducedMotion={reducedMotion}
                  onDone={() => finish(exit.seat)}
                />
              ))}
              {play.slots.map((slot) => {
                const pose = poses.get(slot.seat);
                if (!pose || outSet.has(slot.seat)) return null;
                const place = play.slots.indexOf(slot);
                const self = slot.relation === "self";
                const you = pose.slot ? pose.slot === "home" : place === 0;
                const field: Omit<SeatFieldProps, "angleDeg" | "scale"> = {
                  engine,
                  seat: slot.seat,
                  viewerSeat,
                  masterRule,
                  side: you ? "you" : "opp",
                  upright: camera.upright,
                  tone: slot.tone,
                  density: you ? "full" : "rival",
                  hand: self && !looking ? "face" : "backs",
                  emz: "own",
                  showTally: false,
                  usable: !looking && (slot.relation === "self" || slot.relation === "opponent"),
                  name: nameOf(slot.seat),
                  legalKeys,
                  selectedKeys,
                  reducedMotion,
                  onActivate: controller.onActivate,
                  onInspect: controller.onInspect,
                  onHoverCard: controller.onHoverCard,
                };
                const enlarged = viewCamera.mode === "focus" && viewCamera.focusSeat === slot.seat;
                const reach = plaza3 && !fly && !locked && !out.includes(slot.seat)
                  ? { label: `${nameOf(slot.seat)}${slot.seat === layout.anchorSeat ? " (you)" : ""}'s field`, onToggle: () => dispatchCamera({ type: "enlarge", seat: slot.seat }) }
                  : undefined;
                return <RivalField key={slot.seat} pose={pose} field={field} render={renderSeatField} angleOffsetDeg={flyYaw} glide={gliding && regroup} enlarged={enlarged} reach={reach} targeted={targetSeat === slot.seat} />;
              })}
            </div>
          </div>
        </div>
        <svg ref={tetherRef} className={styles.tethers} viewBox="0 0 1100 860" aria-hidden="true" />
        {[
          // A seat that left keeps its panel where its place stays (a 4-way table); where the seats regroup (a 3-way
          // table, face to face) the panel of the seat that left fades away and is gone.
          ...play.slots.map((slot) => ({ slot, place: play.slots.indexOf(slot), exit: false, from: play })),
          ...exits.flatMap((exit) => {
            const slot = layout.slots.find((entry) => entry.seat === exit.seat);
            return slot && !play.slots.includes(slot) ? [{ slot, place: layout.slots.indexOf(slot), exit: true, from: layout }] : [];
          }),
        ].map(({ slot, place, exit, from }) => {
          const view = engine.seats.find((entry) => entry.seat === slot.seat);
          if (!view) return null;
          // In the fly-in view a panel follows its board; a seat that left has none, so its panel waits for the flat view.
          if (fly && !exit && outSet.has(slot.seat)) return null;
          // The panel of a seat that is leaving fades where it was docked: it keeps the anchor it had before the seats regrouped.
          const anchor = exit ? heldAnchors.current.get(slot.seat) ?? holoAnchor(from, slot.seat, camera) : (!fly && plateAnchors?.get(slot.seat)) || holoAnchor(from, slot.seat, camera);
          if (!exit) shownAnchors.set(slot.seat, anchor);
          const pickable = !exit && picks?.options.has(slot.seat) === true;
          const index = pickOrder.indexOf(slot.seat);
          return (
            <HoloLp
              key={slot.seat}
              seat={slot.seat}
              name={nameOf(slot.seat)}
              tone={slot.tone}
              lp={view.lp}
              handCount={view.hand.length}
              deckCount={view.deckCount}
              clockMs={room.clock?.remainingMs[slot.seat] ?? null}
              status={holoStatus(engine, slot.seat, promptSeat)}
              me={anchor.me}
              x={anchor.x}
              y={anchor.y}
              beam={fly ? "none" : threeWay ? anchor.beam : place === 0 ? "none" : "down"}
              floating={fly}
              master={slot.relation === "self" ? null : view.deckMaster?.card ?? null}
              onInspectMaster={(card) => controller.onInspect({ type: "info", card })}
              lastDamage={lastSeatDamage(engine.events, slot.seat)}
              legal={pickable}
              hotkey={pickable && index >= 0 ? index + 1 : null}
              onPick={() => picks?.onPick(slot.seat)}
              onHover={(hover) => controller.onAim?.(hover ? { lpSeat: slot.seat } : null)}
              exiting={exit}
              placeLabel={placeLabels?.get(slot.seat) ?? null}
              glide={gliding && regroup && !exit}
              footer={!exit && anchor.me ? masterChip : null}
              footerTight={anchor.footerTight}
              reducedMotion={reducedMotion}
              follow
            />
          );
        })}
        {hubAt ? (
          <div
            className={styles.hub}
            data-hub-slot="true"
            {...{ [FOLLOW_ATTR]: "" }}
            data-hub-size={hubAt.size}
            style={{
              width: hubAt.width,
              height: hubAt.height,
              transform: `translate(${hubAt.x - hubAt.width / 2}px, ${hubAt.y - hubAt.height / 2}px)`,
              // Under a zoom the hub keeps its size and follows the ring it sits on (followShift, as its transform glides
              // it to its place). Always on: the follow is the 1x place at 1x, so the first zoom frame moves it too.
              translate: followShift(hubAt.x, hubAt.y),
            }}
          >
            {hub}
          </div>
        ) : null}
        {controller.aim?.from ? <AttackLine aim={controller.aim} tone={attackerTone} /> : null}
      </div>
      {rivalHints.map((hint) => (
        <button
          key={hint.seat}
          type="button"
          className={styles.rivalHint}
          data-rival-hint={hint.seat}
          data-reduced={reducedMotion ? "true" : undefined}
          data-zoom-occluder
          style={{ left: hint.x, top: hint.y }}
          title={`Targets are on ${nameOf(hint.seat)}'s field. Zoom out to see them.`}
          onClick={() => dispatchCamera({ type: "home" })}
        >
          <ArrowUp size={13} strokeWidth={2.4} aria-hidden style={{ transform: `rotate(${hint.angle}deg)` }} />
          <span className={styles.rivalName}>{nameOf(hint.seat)}</span>
        </button>
      ))}
      <ViewReset zoomed={zoom.zoomed} scale={zoom.view.s} onReset={zoom.reset} board={rootRef} style={{ right: 10, top: stageTop + 10 }} />
      {fx ? <ChainRoomContext.Provider value={reserveChain ? setChainSize : null}><div className={styles.slot} data-slot="fx">{fx}</div></ChainRoomContext.Provider> : null}
      {promptCenter ? <div ref={promptRef} className={styles.slot} data-slot="prompt" data-seat-pick={picks ? "true" : undefined} data-prompt-dense={nearBox ? "true" : undefined} style={promptStyle}>{promptCenter}</div> : null}
      {overlay ? <div className={styles.slot} data-slot="overlay">{overlay}</div> : null}
    </div>
  );
}
