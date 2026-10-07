"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties } from "react";
import { seatsOfTeam, teamOfSeat } from "@yugidraft/shared/duels";
import { duelFontClasses } from "../fonts";
import { formatStartingLp } from "../table-format";
import { hexToRgbTriplet } from "../table/seat-angle";
import { SEAT_TONE_HEX, type SeatFieldProps, type SeatTone, type TagStageProps } from "../table/types";
import { useIsNarrow } from "../side-panel";
import { HelipadHub, type HubSeatTone } from "./helipad-hub";
import { OwnHand, PartnerHand } from "./tag-hand";
import {
  clampCenter,
  easeCam,
  easeFly,
  lockLabel,
  poseAt,
  ROOF_FIELD,
  roofFit,
  roofSlots,
  roofTransform,
  tweenProgress,
  type CameraEasing,
  type RoofCameraState,
  type RoofPose,
} from "./roof-camera";
import { Baton, RoofDecor, TeamStrip } from "./roof-world";
import { batonOrder, lastTeamDamage, responseWindow, rivalPickOptions, teamGlyph, teamLoss, teamLp } from "./tag-logic";
import { plateState, TeamLpPlate, type PlateMember } from "./team-lp-plate";
import styles from "./tag-stage.module.css";

export interface TagBoardProps extends Omit<TagStageProps, "camera"> {
  /**
   * The roof camera (`roofReducer`), not the table camera: it carries the pose the world eases to. A plain `CameraState`
   * has no pose, so the room drives this stage with `roofReducer` plus `lockForEvents`.
   */
  camera: RoofCameraState;
  /** Team names are not part of the engine view: the room passes them when it knows them. */
  teamNames?: readonly [string, string];
}

const TAG = "tag" as const;
const HALF_W = ROOF_FIELD.width / 2;
const HALF_H = ROOF_FIELD.height / 2;
/** The phase hub shows its full strip when the helipad is at least this wide on screen (px); under it, the short strip. */
const PHASE_HUB_LG_PAD = 380;
/** Space between the phase hub and the chain hub while both are on the helipad. */
const PHASE_HUB_GAP = 8;
/** Anchor above the far strip: the rival plate hangs from here. */
const FAR_ANCHOR_Y = -ROOF_FIELD.offsetY - ROOF_FIELD.height - 46;

interface Tween {
  from: RoofPose;
  to: RoofPose;
  start: number;
  dur: number;
  ease: CameraEasing;
}

function toneHex(tone: SeatTone | undefined): HubSeatTone {
  const hex = SEAT_TONE_HEX[tone ?? "violet"];
  return { rgb: hexToRgbTriplet(hex.main), ink: hex.ink };
}

/**
 * The 2v2 Rooftop stage: a 3D roof at night with the two team strips, the helipad baton in the middle, the team LP plates,
 * the chain hub and the hands. It draws the fields only through `renderSeatField`. FX, the prompt panel and any overlay
 * are slots over the whole box, so they measure the real screen position of `[data-zones]` and `[data-lp-seat]` nodes.
 */
export function TagStage({ controller, layout, camera, dispatchCamera, renderSeatField, fx, promptCenter, overlay, hub: phaseHub, teamNames }: TagBoardProps) {
  const { engine, room, viewerSeat, nameOf, legalKeys, selectedKeys, reducedMotion, prompt, promptSeat } = controller;
  const target = camera.pose;
  const anchor = layout.anchorSeat;
  const anchorTeam = teamOfSeat(TAG, anchor);
  const slotsOf = useMemo(() => roofSlots(anchor), [anchor]);
  const toneBySeat = useMemo(() => new Map(layout.slots.map((s) => [s.seat, s.tone] as const)), [layout.slots]);
  const toneOf = useCallback((seat: number) => toneHex(toneBySeat.get(seat)), [toneBySeat]);
  const teamName = (team: number) => teamNames?.[team] ?? `Team ${team + 1}`;
  const teamLabel = (team: number) => `${teamName(team)} ${teamGlyph(anchorTeam, team)}`;
  const spectator = viewerSeat == null;
  const viewerView = engine.seats.find((s) => s.seat === viewerSeat);
  const partnerSeat = viewerSeat == null ? null : (viewerSeat + 2) % 4;
  const partnerView = engine.seats.find((s) => s.seat === partnerSeat);

  const loss = teamLoss(engine);
  const window_ = responseWindow(engine, prompt, promptSeat);
  const picks = useMemo(() => (controller.seatPick ? new Map(controller.seatPick.options) : rivalPickOptions(engine, prompt)), [controller.seatPick, engine, prompt]);
  const pickSeats = controller.canAct ? [...picks.keys()] : [];
  const onPick = (seat: number) => {
    if (controller.seatPick) controller.seatPick.onPick(seat);
    else {
      const id = picks.get(seat);
      if (id != null) controller.onAnswer({ choice: id });
    }
  };
  const startLp = formatStartingLp(TAG, room.session.settings);
  const battle = engine.battleStep != null || controller.aim != null;
  const aimedSeat = controller.aim?.to.lpSeat ?? null;

  // ---------- camera ----------
  const rootRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const padRef = useRef<HTMLDivElement>(null);
  const farRef = useRef<HTMLDivElement>(null);
  const pillsRef = useRef<HTMLDivElement | null>(null);
  const hubRef = useRef<HTMLDivElement | null>(null);
  const phaseHubRef = useRef<HTMLDivElement | null>(null);
  const ownPlateRef = useRef<HTMLDivElement | null>(null);
  const farPlateRef = useRef<HTMLDivElement | null>(null);
  // apply() runs every frame of a camera tween: it reads the narrow flag from a ref, never from a new media query.
  const narrowRef = useRef(false);
  narrowRef.current = useIsNarrow();
  const poseRef = useRef<RoofPose>(target);
  const tweenRef = useRef<Tween | null>(null);
  const rafRef = useRef(0);

  const apply = useCallback(() => {
    const root = rootRef.current;
    const world = worldRef.current;
    if (!root || !world) return;
    const w = root.clientWidth;
    const h = root.clientHeight;
    if (w <= 0 || h <= 0) return;
    const handH = Math.max(
      root.querySelector<HTMLElement>("[data-hand-dock]")?.offsetHeight ?? 0,
      root.querySelector<HTMLElement>("[data-partner-hand]")?.offsetHeight ?? 0,
    );
    const narrow = narrowRef.current;
    let hudH = Math.max(ownPlateRef.current?.offsetHeight ?? 0, handH) + 10;
    if (narrow) {
      // A phone has no room for the plate and the hands side by side: the plate takes the bottom row, the own hand sits
      // above it and the partner hand above that (see the narrow block in the CSS). The band is as tall as the stack.
      const plateH = ownPlateRef.current?.offsetHeight ?? 0;
      const ownH = root.querySelector<HTMLElement>("[data-hand-dock]")?.offsetHeight ?? 0;
      root.style.setProperty("--plate-h", `${plateH}px`);
      root.style.setProperty("--hand-h", `${ownH}px`);
      const rootTop = root.getBoundingClientRect().top;
      const tops = [ownPlateRef.current, root.querySelector<HTMLElement>("[data-hand-dock]"), root.querySelector<HTMLElement>("[data-partner-hand]")]
        .filter((node): node is HTMLElement => node != null)
        .map((node) => node.getBoundingClientRect().top - rootTop);
      if (tops.length > 0) hudH = Math.max(hudH, h - Math.min(...tops) + 4);
    }
    const view = { left: 8, right: w - 8, top: 6, bottom: Math.max(60, h - hudH - 8) };
    const fit = roofFit(view) || 1;
    const cx = (view.left + view.right) / 2;
    const cy = (view.top + view.bottom) / 2;
    root.style.setProperty("--cx", `${cx.toFixed(1)}px`);
    root.style.setProperty("--cy", `${cy.toFixed(1)}px`);
    root.style.setProperty("--persp", `${(1400 * fit).toFixed(1)}px`);
    const pose = poseRef.current;
    world.style.transform = roofTransform(pose, fit);
    pillsRef.current?.style.setProperty("--flip", Math.cos((pose.yaw * Math.PI) / 180) < 0 ? "180deg" : "0deg");

    const box = root.getBoundingClientRect();
    const pad = padRef.current?.getBoundingClientRect();
    const far = farRef.current?.getBoundingClientRect();
    const hub = hubRef.current;
    const phases = phaseHubRef.current;
    // A camera that focuses a seat can leave the helipad out of the view. The hub then hides instead of sliding onto the
    // field it zoomed in on; the bottom bar still has the turn buttons.
    const padAt = pad ? { x: pad.left - box.left, y: pad.top - box.top } : null;
    const padSeen = padAt != null && padAt.x >= view.left && padAt.x <= view.right && padAt.y >= view.top && padAt.y <= view.bottom;
    if (phases) {
      if (padSeen) phases.removeAttribute("data-off");
      else phases.setAttribute("data-off", "true");
    }
    if (phases && pad && padSeen) {
      // The phase hub takes the middle of the helipad (the decoration under it is plain paint). The full strip needs the
      // pad's width; a smaller pad gets the short one. While the chain hub is open the two stack around the middle.
      const padSize = root.querySelector<SVGElement>("[data-roof='pad']")?.getBoundingClientRect().width ?? 0;
      phases.setAttribute("data-hub-size", padSize >= PHASE_HUB_LG_PAD ? "lg" : "sm");
      const stackH = phases.offsetHeight + (hub ? PHASE_HUB_GAP + hub.offsetHeight : 0);
      const at = clampCenter({ x: pad.left - box.left, y: pad.top - box.top }, { w: Math.max(phases.offsetWidth, hub?.offsetWidth ?? 0), h: stackH }, view);
      const top = at.y - stackH / 2;
      phases.style.left = `${at.x.toFixed(1)}px`;
      phases.style.top = `${(top + phases.offsetHeight / 2).toFixed(1)}px`;
      if (hub) {
        hub.style.left = `${at.x.toFixed(1)}px`;
        hub.style.top = `${(top + phases.offsetHeight + PHASE_HUB_GAP + hub.offsetHeight / 2).toFixed(1)}px`;
      }
    } else if (hub && pad) {
      const at = clampCenter({ x: pad.left - box.left, y: pad.top - box.top }, { w: hub.offsetWidth, h: hub.offsetHeight }, view);
      hub.style.left = `${at.x.toFixed(1)}px`;
      hub.style.top = `${at.y.toFixed(1)}px`;
    }
    const plate = farPlateRef.current;
    if (plate && far && pad) {
      const flipped = far.top > pad.top;
      const at = clampCenter({ x: far.left - box.left, y: 0 }, { w: plate.offsetWidth, h: 0 }, view);
      const desired = far.top - box.top - plate.offsetHeight - 4;
      const top = flipped ? view.top + 14 : Math.max(view.top + 14, desired);
      plate.style.left = `${(at.x - plate.offsetWidth / 2).toFixed(1)}px`;
      plate.style.top = `${top.toFixed(1)}px`;
    }
  }, []);

  const step = useCallback(() => {
    rafRef.current = 0;
    const tween = tweenRef.current;
    if (tween) {
      const t = tweenProgress(performance.now(), tween.start, tween.dur);
      poseRef.current = t >= 1 ? tween.to : poseAt(tween.from, tween.to, t, tween.ease);
      if (t >= 1) tweenRef.current = null;
    }
    apply();
    if (tweenRef.current) rafRef.current = requestAnimationFrame(step);
  }, [apply]);

  const { rev, dur, intro, from } = camera;
  useEffect(() => {
    if (reducedMotion || dur <= 0) {
      tweenRef.current = null;
      poseRef.current = target;
    } else {
      tweenRef.current = { from: from ?? poseRef.current, to: target, start: performance.now(), dur, ease: intro ? easeFly : easeCam };
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    step();
    // A tween starts when the camera reducer bumps `rev`; the pose itself is read from the same state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev]);

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  // The HUD changes size with the data: measure again after every render, and when the box changes.
  useLayoutEffect(() => {
    if (!tweenRef.current) apply();
  });
  useEffect(() => {
    const node = rootRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => apply());
    observer.observe(node);
    return () => observer.disconnect();
  }, [apply]);

  // End of an FX lock: the reducer restores the saved view on the first tick after the time.
  const lockUntil = camera.lock?.untilMs ?? null;
  useEffect(() => {
    // An open-ended lock (a preview lock, an infinite time) has no end to wait for. A timer over 2^31 ms would fire at once.
    if (lockUntil == null || !Number.isFinite(lockUntil)) return;
    const wait = Math.min(2 ** 31 - 1, Math.max(0, lockUntil - performance.now()) + 8);
    const timer = window.setTimeout(() => dispatchCamera({ type: "tick", nowMs: performance.now() }), wait);
    return () => window.clearTimeout(timer);
  }, [lockUntil, dispatchCamera]);

  // ---------- fields ----------
  const fieldHold = (seat: number) => {
    const slot = slotsOf[seat];
    const view = engine.seats.find((s) => s.seat === seat);
    if (!slot || !view) return null;
    const near = slot.near;
    const relation = spectator ? "other" : seat === viewerSeat ? "self" : teamOfSeat(TAG, seat) === teamOfSeat(TAG, viewerSeat) ? "partner" : "opponent";
    const props: SeatFieldProps = {
      engine,
      seat,
      viewerSeat,
      masterRule: room.session.masterRule,
      side: near ? "you" : "opp",
      // `data-side="you"` is the viewer's own field only (e2e own-zone locators); a spectator has none.
      dataSide: relation === "self" ? "you" : relation === "partner" ? "partner" : "opp",
      angleDeg: near ? 0 : 180,
      upright: camera.upright,
      tone: layout.slots.find((s) => s.seat === seat)?.tone ?? "violet",
      density: near ? "full" : "rival",
      hand: "none",
      emz: "own",
      showTally: false,
      usable: relation === "self",
      name: nameOf(seat),
      legalKeys,
      selectedKeys,
      reducedMotion,
      onActivate: controller.onActivate,
      onInspect: controller.onInspect,
      onHoverCard: controller.onHoverCard,
    };
    const transform = near
      ? `translate3d(${slot.x - HALF_W}px, ${slot.y - HALF_H}px, 2px)`
      : `translate3d(${slot.x}px, ${slot.y}px, 2px) rotate(180deg) translate(${-HALF_W}px, ${-HALF_H}px)`;
    return (
      <div
        key={seat}
        className={styles.fieldHold}
        data-field-hold={seat}
        data-relation={relation}
        data-out={view.eliminated || loss.lostTeam === teamOfSeat(TAG, seat) ? "true" : undefined}
        style={{ width: ROOF_FIELD.width, height: ROOF_FIELD.height, transform }}
      >
        {renderSeatField(props)}
      </div>
    );
  };

  // ---------- plates ----------
  const outSeats = useMemo(() => new Set(engine.seats.filter((s) => s.eliminated).map((s) => s.seat)), [engine.seats]);
  const plate = (team: number, near: boolean) => {
    const members: PlateMember[] = seatsOfTeam(TAG, team).map((seat, i) => {
      const view = engine.seats.find((s) => s.seat === seat);
      const tone = toneOf(seat);
      const pickIndex = pickSeats.indexOf(seat);
      const response = window_?.team === team ? (window_.members.find((m) => m.seat === seat)?.state ?? null) : null;
      return {
        seat,
        name: nameOf(seat),
        code: layout.slots.find((s) => s.seat === seat)?.code ?? `${team + 1}${i === 0 ? "A" : "B"}`,
        rgb: tone.rgb,
        ink: tone.ink,
        you: seat === viewerSeat,
        hand: view?.hand.length ?? 0,
        deck: view?.deckCount ?? 0,
        clockMs: room.clock?.remainingMs[seat] ?? null,
        clockRuns: seat === (promptSeat ?? engine.turnSeat),
        now: seat === engine.turnSeat,
        response,
        pickable: pickIndex >= 0,
        hotkey: pickIndex >= 0 ? pickIndex + 1 : null,
        locked: aimedSeat === seat,
      };
    });
    const out = loss.lostTeam === team;
    return (
      <TeamLpPlate
        teamName={teamName(team)}
        glyph={teamGlyph(anchorTeam, team)}
        near={near}
        lp={teamLp(engine, team)}
        startLp={startLp}
        state={plateState({ out, choosing: window_?.team === team, onTurn: teamOfSeat(TAG, engine.turnSeat) === team })}
        cracked={out && loss.cracking}
        damage={lastTeamDamage(engine, team)?.amount ?? null}
        members={members}
        hang={!near}
        reducedMotion={reducedMotion}
        onPick={onPick}
        plateRef={near ? (node) => { ownPlateRef.current = node; } : (node) => { farPlateRef.current = node; }}
      />
    );
  };

  const stops = batonOrder(engine.turnSeat);
  const rootStyle = {
    ["--hx" as string]: "50%",
  } as CSSProperties;

  return (
    <div
      ref={rootRef}
      className={`${styles.stage} ${duelFontClasses}`}
      style={rootStyle}
      data-table-stage="tag"
      data-tag-stage
      data-battle={battle ? "true" : "false"}
      data-spectator={spectator ? "true" : undefined}
      data-reduced-motion={reducedMotion ? "true" : "false"}
      data-camera-mode={camera.mode}
      data-camera-locked={camera.lock ? camera.lock.reason : undefined}
    >
      <div className={styles.persp}>
        <div className={styles.sky} aria-hidden="true">
          <div className={styles.stars} />
          <span className={styles.beam} data-n="1" style={{ left: "12%" }} />
          <span className={styles.beam} data-n="2" style={{ left: "58%" }} />
          <span className={styles.beam} data-n="3" style={{ left: "84%" }} />
        </div>
        <div ref={worldRef} className={styles.world} data-roof-world>
          <RoofDecor />
          <Baton
            stops={stops}
            anchorSeat={anchor}
            nameOf={nameOf}
            rgbOf={(seat) => toneOf(seat).rgb}
            out={outSeats}
            holderRef={(node) => { pillsRef.current = node; }}
          />
          <TeamStrip near glyph={teamGlyph(anchorTeam, anchorTeam)} teamName={teamName(anchorTeam)} out={loss.lostTeam === anchorTeam} />
          <TeamStrip near={false} glyph={teamGlyph(anchorTeam, 1 - anchorTeam)} teamName={teamName(1 - anchorTeam)} out={loss.lostTeam === 1 - anchorTeam} />
          {engine.seats.map((s) => fieldHold(s.seat))}
          <div ref={padRef} className={styles.anc} style={{ transform: "translate3d(0px, 0px, 2px)" }} />
          <div ref={farRef} className={styles.anc} style={{ transform: `translate3d(0px, ${FAR_ANCHOR_Y}px, 2px)` }} />
        </div>
      </div>
      <div className={styles.fog} aria-hidden="true" />
      <div className={styles.wash} aria-hidden="true" />
      {fx != null ? <div className={styles.slot}>{fx}</div> : null}
      {plate(anchorTeam, true)}
      {plate(1 - anchorTeam, false)}
      {phaseHub != null ? <div ref={phaseHubRef} className={styles.phaseHub} data-phase-hub-slot>{phaseHub}</div> : null}
      <HelipadHub
        chain={engine.chain}
        anchorSeat={anchor}
        nameOf={nameOf}
        toneOf={toneOf}
        response={window_}
        teamLabel={teamLabel}
        pick={pickSeats.length > 0 ? { seats: pickSeats, onPick, title: prompt?.title ?? "Choose a rival" } : null}
        hubRef={(node) => { hubRef.current = node; }}
      />
      {!spectator && viewerView ? (
        <OwnHand
            seat={viewerView.seat}
            cards={viewerView.hand}
            legalKeys={legalKeys}
            selectedKeys={selectedKeys}
            onActivate={controller.onActivate}
            onInspect={controller.onInspect}
            onHoverCard={controller.onHoverCard}
            reducedMotion={reducedMotion}
            label={`${nameOf(viewerView.seat)} hand`}
          />
      ) : null}
      {!spectator && partnerView ? (
        <PartnerHand
          seat={partnerView.seat}
          cards={partnerView.hand}
          legalKeys={legalKeys}
          onInspect={controller.onInspect}
          onHoverCard={controller.onHoverCard}
          label={`${nameOf(partnerView.seat)} hand`}
          partnerName={nameOf(partnerView.seat).split(" ")[0]}
        />
      ) : null}
      {camera.lock ? (
        <div className={styles.lockchip} data-lock-chip role="status">
          Camera locked &middot; {lockLabel(camera.lock.reason)}
        </div>
      ) : null}
      {/* PromptCenter measures its parent as the board (card scope, bar place): it must sit right in the stage root. */}
      {promptCenter}
      {overlay != null ? <div className={styles.slot}>{overlay}</div> : null}
    </div>
  );
}
