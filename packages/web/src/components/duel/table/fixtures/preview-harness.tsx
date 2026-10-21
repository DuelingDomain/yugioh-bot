"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { isDuelChainMode, type DuelChainMode, type DuelEvent } from "@yugidraft/shared/duels";
import { BugReportHeaderButton } from "@/components/bug-report/bug-report-header-button";
import { Ban, Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HeaderToolLabel } from "../../header-tool-label";
import type { ChainModeControl } from "../../use-chain-mode";
import { useDuelAnimationSpeed } from "../../animation-speed-control";
import { duelFontClasses } from "../../fonts";
import type { CameraLockReason, CameraMode, TableController } from "../types";
import { TABLE_STATE_IDS, isTableStateId, type TableFixtureSet, type TableFixtureState } from "./common";
import { useFixtureController } from "./use-fixture-controller";
import { FieldCracksScope } from "../../field-cracks/context";
import { formatStartingLp } from "../../table-format";
import { engineAtStep, isSceneId, sceneSteps } from "./scenes";
import styles from "./preview-harness.module.css";

/**
 * Camera preset from the `cam` query: `home`, `overview`, `fly`, `focus:<seat>` or `look:<seat>`.
 * The stage turns it into its own CameraState (initialCamera) and applies `state.ui.camera` on top.
 */
export interface PreviewCam {
  mode: CameraMode;
  focusSeat: number | null;
  lookSeat: number | null;
}

const LOCK_REASONS: readonly CameraLockReason[] = ["chain", "battle", "direct", "destroy", "elimination"];

export function parsePreviewCam(raw: string | null | undefined): PreviewCam {
  const [kind, seatText] = (raw ?? "home").split(":");
  const seat = seatText != null && /^\d+$/.test(seatText) ? Number(seatText) : null;
  if (kind === "focus" && seat != null) return { mode: "focus", focusSeat: seat, lookSeat: null };
  if (kind === "look" && seat != null) return { mode: "look", focusSeat: null, lookSeat: seat };
  if (kind === "overview" || kind === "fly") return { mode: kind, focusSeat: null, lookSeat: null };
  return { mode: "home", focusSeat: null, lookSeat: null };
}

export function parsePreviewLock(raw: string | null | undefined): CameraLockReason | null {
  return LOCK_REASONS.find((reason) => reason === raw) ?? null;
}

/** What the preview URL asks for, handed to the stage next to the controller. */
export interface PreviewContext {
  cam: PreviewCam;
  /** `?lock=<reason>`: start the preview with the FX camera lock on. */
  lock: CameraLockReason | null;
  viewport: { width: number; height: number };
  reduced: boolean;
  /** `?chain=auto|always|off|none`: the chain response switch on the station track (local state, no server). Auto unless `none`. */
  chainMode: ChainModeControl | null;
  /** `?tools=live`: the buttons a live duel puts in the header (Report bug, Surrender, Cancel duel), so the top bar can be checked as it is in a game. */
  headerTools: ReactNode;
}

export type PreviewStageRenderer = (controller: TableController, state: TableFixtureState, preview: PreviewContext) => ReactNode;

export interface PreviewHarnessProps {
  set: TableFixtureSet;
  stateId: string | null;
  cam: string | null;
  lock?: string | null;
  /** The route of this mode, for the state links (for example "/dev/table-preview/ffa3"). */
  basePath?: string;
  renderStage: PreviewStageRenderer;
  tools?: ReactNode;
}

function useViewport(): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const read = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);
  return size;
}

/**
 * `?attack=<seat>:<seq>><target>` declares a late attack (after the first snapshot, as a live one) from the monster in
 * zone <seq> of <seat>: `2:0>3` is a direct attack on seat 3, `1:1>2:0` an attack on the monster in zone 0 of seat 2.
 * `?as=<seat>|spectator` picks the viewer. For screenshots of what a bystander, the target or a spectator reads.
 */
export function parseAttackParam(raw: string | null): DuelEvent | null {
  const match = raw?.match(/^(\d+):(\d+)>(\d+)(?::(\d+))?$/);
  if (!match) return null;
  const [seat, seq, target, targetSeq] = match.slice(1).map((part) => (part == null ? null : Number(part)));
  const zone = { controller: seat!, location: 4, sequence: seq! };
  return {
    id: 0, kind: "attack", seat: seat!, text: `Player ${seat! + 1} attacks Player ${target! + 1}`, zone,
    ...(targetSeq != null ? { target: { controller: target!, location: 4, sequence: targetSeq } } : { targetSeat: target! }),
  } as DuelEvent;
}

function useAttackOverride(state: TableFixtureState, query: URLSearchParams): TableFixtureState {
  const attack = query.get("attack");
  const as = query.get("as");
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!attack) return;
    const timer = setTimeout(() => setLate(true), 1200);
    return () => clearTimeout(timer);
  }, [attack]);
  return useMemo(() => {
    const engine = state.room.engine;
    const event = parseAttackParam(attack);
    let room = state.room;
    if (as != null) room = { ...room, mySeat: as === "spectator" ? null : Number(as) };
    if (event && late && engine) {
      const id = Math.max(0, ...engine.events.map((entry) => entry.id)) + 1;
      room = { ...room, engine: { ...engine, battleStep: "battle", events: [...engine.events, { ...event, id }] } };
    }
    return room === state.room ? state : { ...state, room };
  }, [state, attack, as, late]);
}

/** Wait before a scene starts, so the layers have measured the board (a live event arrives on a drawn table). */
const SCENE_START_MS = 1500;

/**
 * `?scene=smf|ko|mirror` plays a scripted batch of engine events on the fixture (see scenes.ts): the table layers play
 * them as they do in a duel. The viewer is the fixture's own (`?as=` changes it).
 */
function useSceneOverride(state: TableFixtureState, query: URLSearchParams): TableFixtureState {
  const scene = query.get("scene");
  const id = isSceneId(scene) ? scene : null;
  const seatCount = state.room.engine?.seats.length ?? 4;
  const steps = useMemo(() => (id ? sceneSteps(id, seatCount) : []), [id, seatCount]);
  const [count, setCount] = useState(0);
  useEffect(() => {
    setCount(0);
    if (!id) return;
    const timers = steps.map((step, index) => setTimeout(() => setCount(index + 1), SCENE_START_MS + step.at));
    return () => timers.forEach(clearTimeout);
  }, [id, steps]);
  return useMemo(() => {
    const engine = state.room.engine;
    if (!id || !engine || count === 0) return state;
    return { ...state, room: { ...state.room, engine: engineAtStep(engine, steps, count, state.room.mySeat ?? null) } };
  }, [state, id, steps, count]);
}

/**
 * `?lp=4000,2000,700` sets the life points of every seat (one value sets all; Tag reads one per team) and `&lpafter=2500` waits
 * that many ms first, so the field cracks can be watched as they spread. `&lp=` is how the crack stages are checked by eye.
 */
function useLpOverride(state: TableFixtureState, query: URLSearchParams, format: string): TableFixtureState {
  const raw = query.get("lp");
  const afterText = query.get("lpafter");
  const after = afterText != null && /^\d+$/.test(afterText) ? Number(afterText) : 0;
  const [late, setLate] = useState(after <= 0);
  useEffect(() => {
    if (after <= 0) return;
    const timer = setTimeout(() => setLate(true), after);
    return () => clearTimeout(timer);
  }, [after]);
  return useMemo(() => {
    const engine = state.room.engine;
    const list = (raw ?? "").split(",").map((part) => Number(part)).filter((value) => Number.isFinite(value));
    if (!engine || list.length === 0 || !late) return state;
    const seats = engine.seats.map((seat) => {
      const index = format === "tag" ? (seat.team ?? seat.seat % 2) : seat.seat;
      return { ...seat, lp: list[index % list.length] };
    });
    return { ...state, room: { ...state.room, engine: { ...engine, seats } } };
  }, [state, raw, late, format]);
}

/** Names as long as a Discord handle can be, so the seat strip and the clocks show how they fit. */
const LONG_NAMES = ["crimson_aegis_rider", "Practice Bot Number Two", "Draconis the Magnificent", "rattmann_the_third"];

/** `?names=long` gives every seat a long name (the top bar and the plates must cut them with an ellipsis). */
function useNamesOverride(state: TableFixtureState, query: URLSearchParams): TableFixtureState {
  const long = query.get("names") === "long";
  return useMemo(() => {
    const session = state.room.session;
    if (!long || !session) return state;
    const seats = session.seats.map((seat, index) => ({ ...seat, displayName: LONG_NAMES[index % LONG_NAMES.length] }));
    return { ...state, room: { ...state.room, session: { ...session, seats } } };
  }, [state, long]);
}

function HarnessBody({
  state,
  preview,
  renderStage,
  onToast,
}: {
  state: TableFixtureState;
  preview: PreviewContext;
  renderStage: PreviewStageRenderer;
  onToast: (message: string) => void;
}) {
  const controller = useFixtureController(state, { reducedMotion: preview.reduced, onToast });
  return <>{renderStage(controller, state, preview)}</>;
}

/** What a live duel puts in the header besides the sound switch. Nothing is sent: the buttons only open their own dialogs. */
export function PreviewHeaderTools({ room }: { room: TableFixtureState["room"] }) {
  return (
    <>
      <BugReportHeaderButton room={room} />
      <Button type="button" variant="danger" size="sm" title="Surrender"><HeaderToolLabel icon={Flag}>Surrender</HeaderToolLabel></Button>
      <Button type="button" variant="secondary" size="sm" title="Cancel duel"><HeaderToolLabel icon={Ban}>Cancel duel</HeaderToolLabel></Button>
    </>
  );
}

/** The preview frame: a thin top bar (state links, camera hint, viewport size) and the stage under it. */
export function PreviewHarness({ set, stateId, cam, lock, basePath, renderStage, tools }: PreviewHarnessProps) {
  const query = useSearchParams();
  const reduced = query.get("reduced") === "1";
  const viewport = useViewport();
  // The live room installs the speed hooks for its shells; the preview has no room, so it does.
  useDuelAnimationSpeed(reduced);
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((message: string) => {
    setToast(message);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2200);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const activeId = isTableStateId(stateId) ? stateId : "main";
  const state = useNamesOverride(useLpOverride(useSceneOverride(useAttackOverride((stateId != null ? set.extra?.[stateId] : undefined) ?? set.states[activeId], query), query), query, set.format), query);
  const chainFromUrl = query.get("chain");
  // The live room draws the switch for a seated player; so does the preview, on Auto, unless `?chain=none`.
  const [chain, setChain] = useState<DuelChainMode | null>(isDuelChainMode(chainFromUrl) ? chainFromUrl : chainFromUrl === "none" ? null : "auto");
  const preview: PreviewContext = {
    cam: parsePreviewCam(cam), lock: parsePreviewLock(lock), viewport, reduced,
    chainMode: chain ? { mode: chain, onChange: setChain } : null,
    headerTools: query.get("tools") === "live" ? <PreviewHeaderTools room={state.room} /> : undefined,
  };
  const base = basePath ?? `/dev/table-preview/${set.format}`;
  const fixture = query.get("fixture");
  const suffix = [fixture ? `fixture=${encodeURIComponent(fixture)}` : null, cam ? `cam=${encodeURIComponent(cam)}` : null, lock ? `lock=${encodeURIComponent(lock)}` : null, reduced ? "reduced=1" : null]
    .filter((part): part is string => part != null)
    .join("&");

  return (
    <div className={`${duelFontClasses} ${styles.root}`} data-table-preview={set.format} data-state={state.id}>
      <header className={styles.bar}>
        <Link href="/dev/table-preview" className={styles.title}>{set.title}</Link>
        <nav className={styles.states} aria-label="Preview state">
          {TABLE_STATE_IDS.map((id) => (
            <Link key={id} href={`${base}?state=${id}${suffix ? `&${suffix}` : ""}`} aria-current={id === state.id ? "page" : undefined}>
              {id}
            </Link>
          ))}
        </nav>
        {tools}
        <span className={styles.hint}>?cam=home|overview|fly|focus:&lt;seat&gt;|look:&lt;seat&gt; &middot; ?lock=&lt;reason&gt; &middot; ?reduced=1</span>
        <span className={styles.size}>{viewport.width}&times;{viewport.height}</span>
      </header>
      <main className={styles.stage}>
        <FieldCracksScope duelKey={`preview:${set.format}`} startLp={formatStartingLp(set.format, state.room.session?.settings ?? { startingLP: 8000 })}>
          <HarnessBody key={state.id} state={state} preview={preview} renderStage={renderStage} onToast={showToast} />
        </FieldCracksScope>
      </main>
      {toast ? <div className={styles.toast} role="status">{toast}</div> : null}
    </div>
  );
}

/**
 * The stage a mode shows until its real one is built: the state label, the turn and the seats from the fixture.
 * It needs no engine and no table code, so every route renders from the first commit.
 */
export function PlaceholderStage({ controller, state }: { controller: TableController; state: TableFixtureState }) {
  const { engine, nameOf, prompt } = controller;
  return (
    <section className={styles.placeholder} aria-label="Placeholder stage">
      <h2>{state.label}</h2>
      <p>
        Turn {engine.turn}, {engine.phase}, {nameOf(engine.turnSeat)} to play. Placeholder: the stage for this mode is not built yet.
      </p>
      <ul>
        {engine.seats.map((seat) => (
          <li key={seat.seat}>
            Seat {seat.seat}: {nameOf(seat.seat)} &middot; {seat.lp} LP &middot; hand {seat.hand.length}
            {seat.eliminated ? " · eliminated" : ""}
          </li>
        ))}
      </ul>
      {prompt ? <p>Prompt for {nameOf(prompt.seat)}: {prompt.title}</p> : null}
    </section>
  );
}
