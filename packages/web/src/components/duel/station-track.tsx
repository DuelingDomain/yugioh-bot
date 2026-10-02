"use client";

import type { CSSProperties, ReactNode } from "react";
import { ArrowRight, Check, Hourglass, Lock } from "lucide-react";
import type { DuelPromptOption } from "@yugidraft/shared/duels";
import { phaseLabel } from "./constants";
import { duelFontClasses } from "./fonts";
import styles from "./station-track.module.css";


/* ---------- Battle Phase steps ---------- */

/** Sub-steps of the Battle Phase, as the engine reports them (DuelEngineView.battleStep). */
export type BattleStep = "start" | "battle" | "damage" | "damage-calculation" | "end";

export const BATTLE_STEPS: ReadonlyArray<{ id: BattleStep; name: string; short: string; hint: string }> = [
  { id: "start", name: "Start Step", short: "Start", hint: "Battle Phase begins — Quick Effects and Traps can be activated before any attack" },
  { id: "battle", name: "Battle Step", short: "Battle", hint: "Attack declared — you can respond with Quick Effects and Traps" },
  { id: "damage", name: "Damage Step", short: "Damage", hint: "Only cards that change ATK/DEF or Counter Traps can be activated" },
  { id: "damage-calculation", name: "Damage Calculation", short: "Calc", hint: "Damage is being calculated; only damage-calculation effects apply" },
  { id: "end", name: "End Step", short: "End", hint: "Battle done — respond before the next attack or the end of the Battle Phase" },
];

/** Raw engine phase strings that already name a battle step (used when the view carries no battleStep). */
const PHASE_STEP: Record<string, BattleStep> = {
  battle_start: "start",
  battle_step: "battle",
  damage: "damage",
  damage_cal: "damage-calculation",
  damagecal: "damage-calculation",
  damagecalculation: "damage-calculation",
};

/**
 * The battle step to show: the engine's `battleStep` first, else what the raw phase string says.
 * A plain "battle" phase without a step is unknown (null): the strip shows with nothing lit.
 */
export function resolveBattleStep(
  phase: string | null | undefined,
  battleStep: BattleStep | null | undefined,
): BattleStep | null {
  if (battleStep) return battleStep;
  if (phase == null) return null;
  const key = String(phase).trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (PHASE_STEP[key]) return PHASE_STEP[key];
  const label = phaseLabel(phase);
  if (label === "Damage") return "damage";
  if (label === "Damage calculation") return "damage-calculation";
  return null;
}

export function battleStepInfo(step: BattleStep | null | undefined): (typeof BATTLE_STEPS)[number] | null {
  if (!step) return null;
  return BATTLE_STEPS.find((entry) => entry.id === step) ?? null;
}

export function battleStepLabel(step: BattleStep | null | undefined): string | null {
  return battleStepInfo(step)?.name ?? null;
}

/* ---------- Station track ---------- */

/** One seat of a table of 3 or more duelists, as the strip next to the buttons shows it. */
export type StationSeatChip = {
  seat: number;
  name: string;
  /** Seat colour (hex): the dot and the edge. */
  tone: { main: string; ink: string };
  you: boolean;
  status: "active" | "turn" | "choosing" | "next" | "leaving" | "eliminated";
};

export type StationTrackProps = {
  /** Raw engine phase (engine.phase). Use phaseLabel() from ./constants to normalise. */
  phase: string | null | undefined;
  /** Battle Phase sub-step from the engine view (engine.battleStep); null outside the Battle Phase. */
  battleStep?: BattleStep | null;
  turn: number | null | undefined;
  /** Seat whose turn it is (engine.turnSeat). */
  turnSeat: number | null | undefined;
  /** Local seat, or null for a spectator. */
  mySeat: number | null;
  playerName: (seat: number) => string;
  /** Options of the local seat's current "action" prompt, else []. Phase moves have ids "to_bp", "to_m2", "to_ep". */
  actionOptions: DuelPromptOption[];
  /** The local seat may submit an answer right now. */
  canAct: boolean;
  /** The action prompt offers nothing but phase moves: End Turn should glow. */
  noLegalMoves: boolean;
  onChoose: (optionId: string) => void;
  /** Clock element for the turn player, rendered by the caller (DuelClockDisplay). */
  clock?: ReactNode;
  /** Caption override for non-action moments, e.g. "Respond to the chain". */
  caption?: string | null;
  reducedMotion: boolean;
  /** Tables of 3 or more seats: the duelists in turn order, each with its colour and standing. */
  seatStrip?: readonly StationSeatChip[];
  /** Tables of 3 or more seats: attacks are still shut. Shows "No attack until turn N". */
  attackLock?: { firstTurn: number; turnsLeft: number } | null;
};

type PhaseMove = "to_bp" | "to_m2" | "to_ep";

type Station = {
  code: string;
  name: string;
  /** What the local player can do while this station is current on their turn. */
  hint: string;
  /** Phase move (option id) that enters this station. */
  action?: PhaseMove;
};

const STATIONS: readonly Station[] = [
  { code: "DP", name: "Draw", hint: "Draw a card for the turn" },
  { code: "SP", name: "Standby", hint: "Standby Phase effects resolve" },
  { code: "M1", name: "Main 1", hint: "Summon or Set a monster, activate or Set Spells and Traps" },
  { code: "BP", name: "Battle", hint: "Choose an attacker, or move on", action: "to_bp" },
  { code: "M2", name: "Main 2", hint: "Summon, Set or activate more, then end your turn", action: "to_m2" },
  { code: "EP", name: "End", hint: "End Phase effects resolve, then the turn passes", action: "to_ep" },
];

const BATTLE = 3;

/** Normalised phaseLabel() -> station index. Damage steps belong to the Battle station. */
const STATION_INDEX: Record<string, number> = {
  Draw: 0,
  Standby: 1,
  "Main 1": 2,
  Battle: BATTLE,
  Damage: BATTLE,
  "Damage calculation": BATTLE,
  "Main 2": 4,
  End: 5,
};

/** Which phase move is the primary button, in order of preference, per current station. */
function primaryPreference(current: number): readonly PhaseMove[] {
  if (current === BATTLE) return ["to_m2", "to_ep"];
  if (current === 4 || current === 5) return ["to_ep"];
  if (current < 0) return ["to_bp", "to_m2", "to_ep"];
  return ["to_bp", "to_ep"];
}

const PRIMARY_LABEL: Record<PhaseMove, string> = {
  to_bp: "To Battle",
  to_m2: "To Main 2",
  to_ep: "End Turn",
};

type CaptionParts = { at?: string; body?: string; next?: string; note?: string };

function BattleSteps({ step, mine }: { step: BattleStep | null; mine: boolean }) {
  const currentIndex = step ? BATTLE_STEPS.findIndex((entry) => entry.id === step) : -1;
  const info = battleStepInfo(step);
  return (
    <div className={styles.steps} data-tone={mine ? "mine" : "theirs"} aria-label="Battle Phase steps">
      <ol className={styles.stepList} role="list">
        {BATTLE_STEPS.map((entry, index) => {
          const state = currentIndex < 0 ? "unknown" : index < currentIndex ? "done" : index === currentIndex ? "current" : "ahead";
          return (
            <li key={entry.id} className={styles.step} data-state={state} aria-current={state === "current" ? "step" : undefined}
              title={entry.name}>
              <i className={styles.stepDot} aria-hidden="true" />
              <span className={styles.stepName}>{entry.short}</span>
              <span className={styles.srOnly}>{entry.name}{state === "current" ? ", current step" : state === "done" ? ", done" : ""}</span>
            </li>
          );
        })}
      </ol>
      <span className={styles.stepHint}>
        {info ? (
          <>
            <b className={styles.stepNow}>{info.name}</b>
            <span className={styles.stepSep} aria-hidden="true"> · </span>
            <span className={styles.stepText}>{info.hint}</span>
          </>
        ) : (
          <span className={styles.stepText}>Battle Phase · Quick Effects and Traps can respond between steps</span>
        )}
      </span>
    </div>
  );
}

export function StationTrack({
  phase,
  battleStep,
  turn,
  turnSeat,
  mySeat,
  playerName,
  actionOptions,
  canAct,
  noLegalMoves,
  onChoose,
  clock,
  caption,
  reducedMotion,
  seatStrip,
  attackLock,
}: StationTrackProps) {
  const current = STATION_INDEX[phaseLabel(phase)] ?? -1;
  const spectator = mySeat == null;
  const myTurn = !spectator && turnSeat === mySeat;
  const tone = myTurn ? "mine" : "theirs";
  const turnName = turnSeat != null ? playerName(turnSeat) : "—";
  const inBattle = current === BATTLE;
  const step = inBattle ? resolveBattleStep(phase, battleStep) : null;

  // Phase moves the local seat may take right now.
  const offered = new Map<string, DuelPromptOption>();
  if (canAct) for (const option of actionOptions) offered.set(option.id, option);

  const primaryId = primaryPreference(current).find((id) => offered.has(id));
  const primary = primaryId ? offered.get(primaryId) : undefined;
  const endTurn = offered.get("to_ep");
  const showSecondary = Boolean(primary && endTurn && primaryId !== "to_ep");
  const nextIndex = primaryId ? STATIONS.findIndex((station) => station.action === primaryId) : -1;

  // No turn player means no live duel (finished record or engine view missing).
  const noTurn = turnSeat == null;
  const waitLabel = canAct ? "Respond first" : myTurn ? "Waiting" : noTurn ? "No active turn" : `${turnName}'s turn`;

  const custom = caption?.trim();
  const parts: CaptionParts = (() => {
    if (custom) return { note: custom };
    const at = STATIONS[current]?.name;
    if (noTurn) return { at, body: "No active turn" };
    if (!myTurn) return { at, body: spectator ? `${turnName}'s turn · watching` : `${turnName}'s turn` };
    if (!canAct) return { at, body: "Waiting" };
    if (!primary && offered.size === 0) return { at, body: "Respond to the prompt first" };
    const following = nextIndex >= 0 ? nextIndex : current >= 0 && current < STATIONS.length - 1 ? current + 1 : -1;
    return { at, body: STATIONS[current]?.hint, next: following >= 0 ? STATIONS[following].name : undefined };
  })();
  const captionText = parts.note
    ?? [parts.at, parts.body, parts.next ? `Next: ${parts.next}` : undefined].filter(Boolean).join(" · ");

  const glowId = noLegalMoves && endTurn ? "to_ep" : null;

  const stackStyle = { "--i": Math.max(0, current) } as CSSProperties;

  return (
    <nav
      aria-label="Duel phases"
      className={`${styles.root} ${duelFontClasses}`}
      data-tone={tone}
      data-phase={STATIONS[current]?.code ?? "none"}
      data-step={step ?? undefined}
      data-reduced={reducedMotion ? "true" : "false"}
      data-seats={seatStrip && seatStrip.length > 0 ? "true" : undefined}
    >
      <div className={styles.seat}>
        <span className={styles.lamp} aria-hidden="true" />
        <div className={styles.seatText}>
          <strong className={styles.seatName} title={turnName}>{turnName}</strong>
          <span className={styles.seatTurn}>Turn {turn ?? "—"}</span>
        </div>
        {myTurn ? <span className={styles.srOnly}>Your turn</span> : null}
        {clock ? <div className={styles.clockSlot}>{clock}</div> : null}
      </div>

      <div className={styles.rail}>
        <div className={styles.stack} style={stackStyle} data-idle={current < 0 ? "true" : "false"}>
          <span className={styles.railLine} aria-hidden="true" />
          <span className={styles.railDone} aria-hidden="true" />
          <span className={styles.pool} aria-hidden="true" />
          <ol className={styles.plates} role="list">
            {STATIONS.map((station, index) => {
              const state = index < current ? "done" : index === current ? "current" : "ahead";
              const option = station.action ? offered.get(station.action) : undefined;
              const isNext = nextIndex === index && index !== current;
              const inner = (
                <>
                  <b className={styles.code}>{station.code}</b>
                  <small className={styles.name}>{station.name}</small>
                  {state === "done" ? (
                    <span className={styles.tick} aria-hidden="true"><Check strokeWidth={2} /></span>
                  ) : null}
                </>
              );
              const common = {
                className: styles.plate,
                "data-state": state,
                "data-next": isNext ? "true" : "false",
                "aria-current": state === "current" ? ("step" as const) : undefined,
              };
              return (
                <li key={station.code} className={styles.item}>
                  {option ? (
                    <button type="button" {...common} aria-label={option.label} onClick={() => onChoose(option.id)}>
                      {inner}
                    </button>
                  ) : (
                    <span {...common}>
                      {inner}
                      {state !== "ahead" || isNext ? (
                        <span className={styles.srOnly}>
                          {state === "done" ? ", done" : state === "current" ? ", current phase" : ", next"}
                        </span>
                      ) : null}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
        {inBattle ? (
          <div className={styles.caption} aria-live="polite" aria-atomic="true" title={captionText}>
            {parts.note ? <span className={styles.capNote}>{parts.note}<span aria-hidden="true"> · </span></span> : null}
            <BattleSteps step={step} mine={myTurn} />
          </div>
        ) : (
          <p className={styles.caption} aria-live="polite" aria-atomic="true" title={captionText}>
            {parts.note ? <span className={styles.capNote}>{parts.note}</span> : null}
            {parts.at ? <b className={styles.capAt}>{parts.at}</b> : null}
            {parts.body ? (
              <span className={styles.capBody}>
                {parts.at ? <span aria-hidden="true"> · </span> : null}
                <span>{parts.body}</span>
              </span>
            ) : null}
            {parts.next ? (
              <span className={styles.capNext}>
                <span aria-hidden="true"> · </span>
                <span>Next: {parts.next}</span>
              </span>
            ) : null}
          </p>
        )}
      </div>

      <div className={styles.actions}>
        {attackLock ? (
          <span className={styles.lock} data-testid="attack-lock" title={`Attacks open on turn ${attackLock.firstTurn}`}>
            <Lock strokeWidth={2} aria-hidden="true" />
            <span>No attack until turn {attackLock.firstTurn}</span>
          </span>
        ) : null}
        {seatStrip && seatStrip.length > 0 ? (
          <ol className={styles.strip} role="list" aria-label="Turn order">
            {seatStrip.map((chip) => (
              <li
                key={chip.seat}
                className={styles.chip}
                data-status={chip.status}
                data-you={chip.you ? "true" : undefined}
                style={{ "--seat-main": chip.tone.main, "--seat-ink": chip.tone.ink } as CSSProperties}
                title={`${chip.name}${chip.status === "turn" ? " · turn" : chip.status === "eliminated" ? " · out" : ""}`}
                aria-current={chip.status === "turn" || chip.status === "choosing" ? "true" : undefined}
              >
                <i className={styles.chipDot} aria-hidden="true" />
                <span className={styles.chipName}>{chip.you ? "You" : chip.name.split(" ")[0]}</span>
                <span className={styles.srOnly}>{chip.you ? `${chip.name} (you)` : chip.name}{chip.status === "turn" ? ", turn" : chip.status === "eliminated" ? ", out" : ""}</span>
              </li>
            ))}
          </ol>
        ) : null}
        {showSecondary && endTurn ? (
          <button
            type="button"
            className={styles.secondary}
            aria-label="End Turn"
            title={endTurn.label}
            data-glow={glowId === "to_ep" ? "true" : "false"}
            onClick={() => onChoose(endTurn.id)}
          >
            <span className={styles.onlyWide}>End Turn</span>
            <span className={styles.onlyNarrow} aria-hidden="true">End</span>
          </button>
        ) : null}
        {primary && primaryId ? (
          <button
            type="button"
            className={styles.primary}
            title={primary.label}
            data-glow={glowId === primaryId ? "true" : "false"}
            onClick={() => onChoose(primary.id)}
          >
            <span className={styles.primaryLabel}>{PRIMARY_LABEL[primaryId]}</span>
            <ArrowRight strokeWidth={2} aria-hidden="true" />
          </button>
        ) : (
          <button type="button" className={styles.primary} disabled aria-disabled="true" data-wait="true">
            <span className={styles.primaryLabel} title={waitLabel}>{waitLabel}</span>
            <Hourglass strokeWidth={2} aria-hidden="true" />
          </button>
        )}
      </div>
    </nav>
  );
}
