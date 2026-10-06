"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { engineFormat } from "../multi-seat";
import type { GridFinaleBoard } from "./grid-finale";
import type { UseGridFocus } from "./grid-focus";
import { ChainRoomContext, type ChainStripSize } from "./chain-room";
import { AttackLine } from "./attack-line";
import { FlyCity } from "./fly-city";
import { BAR_HUD, dockBarRoom, freeDockRoom, PICK_BAR, pickBarRoom, promptUnit } from "./grid-stage";
import { aliveLayout, boardBounds, chainBandRooms, chainStripInset, flyWorld, holoAnchor, hubPose, normalizeAngle, ringAngles, CAMERA_HINT, HUD_CORNER, portraitTable, promptRooms, ringPose, type HoloAnchor, type PromptRoom, seatPoses, slotPlan, stageFit, stageSpread, STAGE, wideHoloAnchors } from "./geometry";
import { holoStatus, HoloLp } from "./holo-lp";
import { lastSeatDamage } from "./seat-state";
import { Plaza } from "./plaza";
import { ExitingSeat, RivalField } from "./rival-field";
import { TurnRing } from "./turn-ring";
import { useFlyGestures } from "./use-fly-gestures";
import { useFlyWorld } from "./use-fly-world";
import { GLIDE_MS, useSeatExits } from "./use-seat-exits";
import { occluderRects, useViewZoom } from "./use-view-zoom";
import { ViewReset } from "./view-reset";
import { FOLLOW_ATTR, followShift } from "./view-zoom";
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

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
const sameRects = (a: readonly Rect[], b: readonly Rect[]) =>
  a.length === b.length && a.every((r, i) => r.x === b[i].x && r.y === b[i].y && r.width === b[i].width && r.height === b[i].height);
/** How long after a change the targets are measured again: the regroup glide and the crumble are over by then. */
const SETTLE_MS = 1500;
/** A last measure of the pick targets, after the fields have laid out (their entry runs without DOM changes). */
const LATE_MEASURE_MS = 400;
/** Box px from the left edge that the floating HUD's left column (the dock, the chain tower, the Deck Master plate) takes. */
const HUD_LEFT_COLUMN = 196;

/** What a click on a seat must leave alone: the controls and the legal targets inside a field. */
const CLICK_PASS = "button, a, [data-legal='true'], [data-holo]";

export interface TableStageViewProps extends TableStageProps {
  /** The stored camera mode, when the FX lock shows another one (a lock sends the view home). */
  wantMode?: CameraMode;
  /** The FX lock is on. */
  locked?: boolean;
  /** Seats that are out of the duel: a click on them does nothing. */
  out?: readonly number[];
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
export function TableStage({ controller, layout, camera, dispatchCamera, renderSeatField, fx, promptCenter, overlay, hub, masterChip, wantMode, locked = false, out = [], ring = true, placeLabels, centerPrompts = false }: TableStageViewProps) {
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
  const zoom = useViewZoom({
    rootRef,
    layerRef: perspRef,
    enabled: !fly && k > 0,
    reducedMotion,
    resetKey: `${camera.mode}|${camera.focusSeat ?? ""}|${camera.lookSeat ?? ""}|${outKey}|${portrait ? "portrait" : "wide"}`,
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
  // Free rooms for the prompts (a seat choice, "Activate?", the card-pick bar): off every board and plate, so a prompt that is
  // about a rival's field never covers it. In screen px of the board box; the prompt CSS and the select bar read them.
  const rooms = useMemo(() => {
    if (!(k > 0) || fly) return null;
    if (portrait) return { panel: null, bar: null, chain: chainSize ? { x: 6, y: 48, ...chainSize } : null };
    if (chainInset && chainSize) return chainBandRooms(chainSize, box);
    // A zoomed board keeps the rooms of the camera pose: the panel and the pick bar stay where they are at rest, clear
    // of every card there, and the pan can take any card out from under them (the safe frame of useViewZoom).
    const anchors = new Map(play.slots.map((slot) => [slot.seat, wideAnchors?.get(slot.seat) ?? holoAnchor(play, slot.seat, camera)] as const));
    const found = promptRooms({ layout: play, camera, poses, anchors, spread, meFooter: hasChip, box, k, chainSize });
    const dx = (box.width - STAGE.width * k) / 2;
    const dy = stageTop + (stageHeight - canvasHeight * k) / 2;
    const toBox = (room: PromptRoom | null) => room && { x: Math.round(dx + room.x * k), y: Math.round(dy + room.y * k), width: Math.round(room.width * k), height: Math.round(room.height * k) };
    return { panel: toBox(found.panel), bar: toBox(found.bar), chain: toBox(found.chain) };
  }, [play, camera, poses, spread, hasChip, k, fly, box, canvasHeight, wideAnchors, chainSize, chainInset, stageHeight, stageTop, portrait]);

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
  const [targets, setTargets] = useState<readonly Rect[]>([]);
  const [zones, setZones] = useState<readonly Rect[]>([]);
  const [hudRects, setHudRects] = useState<readonly Rect[]>([]);
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
      const rest = boxes('[data-zones]:not([data-legal="true"])');
      const hud = occluderRects(root, BAR_HUD).map((r) => ({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }));
      setTargets((current) => (sameRects(current, next) ? current : next));
      setZones((current) => (sameRects(current, rest) ? current : rest));
      setHudRects((current) => (sameRects(current, hud) ? current : hud));
    };
    let frame = window.requestAnimationFrame(measure);
    // Once the seats stand still: a regroup (the FINAL DUEL board) glides them to new places.
    const timer = window.setTimeout(measure, reducedMotion ? 0 : regroup ? GLIDE_MS : SETTLE_MS);
    // The fields can mount, mark their targets or finish their entry after this effect: measure again then.
    const observer = new MutationObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(measure);
    });
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-legal"] });
    const late = window.setTimeout(measure, LATE_MEASURE_MS);
    return () => {
      observer.disconnect();
      window.clearTimeout(late);
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [floating, nearBox, legalKey, reducedMotion, regroup, zoom.zoomed]);
  const barRoom = useMemo(() => {
    if (!floating) return undefined;
    // Zoomed: the bar docks at the bottom of the box, off the HUD (the timer, the responses, the master plate). The
    // pan can take any card out from under it (it is in VIEW_OCCLUDERS).
    if (zoom.zoomed) return freeDockRoom(box, hudRects) ?? dockBarRoom(box);
    if (!nearBox) return undefined;
    // The bar may run to the edge of your field (the 4-way keeps 12 px inside a pair): a short field has one row band
    // above and one below your monsters, and the bar fits in one of them.
    const edge = PICK_BAR.edge;
    // The other zones weigh far less than a target: the bar keeps off them too where your field has room.
    const found = pickBarRoom({ x: nearBox.x - edge, y: nearBox.y - edge, width: nearBox.width + 2 * edge, height: nearBox.height + 2 * edge }, targets, zones);
    const room = found?.split(",").map(Number);
    const hits = (list: readonly Rect[], pad: number) => (x: number, y: number, width: number, height: number) =>
      list.some((r) => r.x - pad < x + width && x < r.x + r.width + pad && r.y - pad < y + height && y < r.y + r.height + pad);
    const covers = hits(targets, PICK_BAR.clear);
    const coversZone = hits(zones, 0);
    if (room && !covers(room[0], room[1], room[2], room[3]) && !coversZone(room[0], room[1], room[2], room[3])) return found;
    // No clear place on your field: the free room off every board, unless that is under the HUD's left column; else a
    // clear place at the bottom of the box, off the hand and the HUD.
    const bar = rooms?.bar;
    const free = (x: number, y: number, width: number, height: number) =>
      !covers(x, y, width, height) && !coversZone(x, y, width, height) && !hits(hudRects, 0)(x, y, width, height);
    if (bar && bar.x >= HUD_LEFT_COLUMN && free(bar.x, bar.y, bar.width, bar.height)) {
      return `${bar.x},${bar.y},${bar.width},${bar.height}`;
    }
    return freeDockRoom(box, [...targets, ...zones, ...hudRects]) ?? found;
  }, [floating, zoom.zoomed, nearBox, targets, zones, hudRects, rooms?.bar, box]);

  // A prompt that opens, closes or moves changes the HUD insets: the view eases into the new clamps (no gap stays).
  const hudKey = `${controller.prompt?.id ?? ""}|${promptCenter ? 1 : 0}|${overlay ? 1 : 0}|${controller.seatPick ? 1 : 0}|${barRoom ?? ""}|${rooms?.panel ? `${rooms.panel.x},${rooms.panel.y}` : ""}`;
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

  const onSeatClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as Element | null;
    const slot = target?.closest?.("[data-seat-slot]");
    if (!slot || target?.closest?.(CLICK_PASS)) return;
    const seat = Number(slot.getAttribute("data-seat-slot"));
    if (!Number.isInteger(seat) || out.includes(seat)) return;
    if (fly) {
      dispatchCamera({ type: "flyTo", seat });
    } else if (seat !== layout.anchorSeat && !(camera.mode === "focus" && camera.focusSeat === seat) && !(looking && camera.lookSeat === seat)) {
      dispatchCamera({ type: "focus", seat });
    }
  };

  const canvas: CSSProperties & Record<string, string | number> = {
    width: STAGE.width,
    height: canvasHeight,
    transform: `translate(${(box.width - STAGE.width * k) / 2}px, ${stageTop + (stageHeight - canvasHeight * k) / 2}px) scale(${k})`,
    "--ss": tiltSupersample(k),
    "--spread": `${spread}px`,
  };
  const attackerSeat = controller.aim?.from ? Number(controller.aim.from.split(":")[0]) : null;
  const attackerTone = (attackerSeat != null ? tones.get(attackerSeat) : null) ?? "violet";
  const ringAt = ringPose(play, camera, spread);
  // The phase hub strip: the classic place, or at a wide table (home and look) the clear place nearest the ring or your field.
  // The place only depends on the camera's mode and target, so a fly-in drag (which changes only `camera.fly`) does not rescan.
  const hubAt = useMemo(
    () => (hub && threeWay && !portrait ? hubPose(play, camera, { box: fitBox, meFooter: hasChip, ...(centerPrompts ? { hud: HUD_CORNER } : {}) }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hub != null, threeWay, play, camera.mode, camera.focusSeat, camera.lookSeat, fitBox, hasChip, portrait, centerPrompts],
  );

  return (
    <div
      ref={rootRef}
      className={styles.board}
      data-portrait={portrait ? "true" : undefined}
      data-prompt-scope
      data-table-stage={layout.format}
      data-format={format}
      data-camera-mode={camera.mode}
      data-regroup={gliding && regroup ? "true" : undefined}
      data-camera-want={wantMode ?? camera.mode}
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
      data-bar-room={barRoom ?? (rooms?.bar ? `${rooms.bar.x},${rooms.bar.y},${rooms.bar.width},${rooms.bar.height}` : undefined)}
      style={rooms?.panel && !nearBox ? ({ "--room-x": `${rooms.panel.x}px`, "--room-y": `${rooms.panel.y}px`, "--room-w": `${rooms.panel.width}px`, "--room-h": `${rooms.panel.height}px` } as CSSProperties) : undefined}
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
            <div className={styles.wstage} onClick={onSeatClick}>
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
                return <RivalField key={slot.seat} pose={pose} field={field} render={renderSeatField} angleOffsetDeg={flyYaw} glide={gliding && regroup} />;
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
          const anchor = exit ? heldAnchors.current.get(slot.seat) ?? holoAnchor(from, slot.seat, camera) : (!fly && wideAnchors?.get(slot.seat)) || holoAnchor(from, slot.seat, camera);
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
      <ViewReset zoomed={zoom.zoomed} scale={zoom.view.s} onReset={zoom.reset} style={{ right: 10, top: stageTop + 10 }} />
      {fx ? <ChainRoomContext.Provider value={reserveChain ? setChainSize : null}><div className={styles.slot} data-slot="fx">{fx}</div></ChainRoomContext.Provider> : null}
      {promptCenter ? <div ref={promptRef} className={styles.slot} data-slot="prompt" data-seat-pick={picks ? "true" : undefined} data-prompt-dense={nearBox ? "true" : undefined} style={promptStyle}>{promptCenter}</div> : null}
      {overlay ? <div className={styles.slot} data-slot="overlay">{overlay}</div> : null}
    </div>
  );
}
