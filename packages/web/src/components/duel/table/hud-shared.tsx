import type { ReactNode } from "react";
import type { DuelAnswer, DuelCard, DuelClock, DuelPrompt, DuelSeatView, DuelSession } from "@yugidraft/shared/duels";
import { DuelClockDisplay } from "../room-settings";
import type { DuelHoverHandler } from "../field-keys";
import { optionsForCard } from "../prompts";
import { hasNoLegalMoves, type StationTrackProps } from "../station-track";
import type { HudMasterProps } from "./hud-layer";
import type { DuelActivateHandler } from "./types";

/**
 * Props the floating-HUD shells (the 4-way grid, the 1v1 room, the Tag Rooftop) build the same way. One copy here, so a
 * fix to the Deck Master plate or to the phase track lands on all of them.
 */

/** What a Deck Master plate reads from a table. */
export interface HudMasterSource {
  legalKeys: Set<string>;
  selectedKeys: Set<string>;
  canAct: boolean;
  prompt: DuelPrompt | null;
  onAnswer: (answer: DuelAnswer) => void;
  onActivate?: DuelActivateHandler;
  onHoverCard?: DuelHoverHandler;
}

/** The props of one Deck Master plate: the seat view, whether the plate is yours, and its title. */
export function hudMasterProps(source: HudMasterSource, view: DuelSeatView | undefined, local: boolean, title: string): HudMasterProps {
  const { prompt, canAct } = source;
  return {
    view,
    local,
    legalKeys: source.legalKeys,
    selectedKeys: source.selectedKeys,
    canAct,
    // The same actions the Deck Master rail of the classic page offers.
    legalActionsFor: (card: DuelCard | null, keys: string[]) =>
      canAct && prompt?.kind === "choice" && prompt.context?.type === "action" ? optionsForCard(prompt, card, keys) : [],
    title,
    onChooseAction: (option) => source.onAnswer({ choice: option.id }),
    onActivate: source.onActivate,
    onHoverCard: source.onHoverCard,
  };
}

/**
 * The HUD pill shows both clocks with a short name each, so a duelist reads the rival's time bank too. `null` when
 * the duel has no clock.
 */
export function hudClock(clock: DuelClock | null | undefined, session: DuelSession, reducedMotion: boolean): ReactNode {
  if (!clock) return null;
  return <DuelClockDisplay key={clock.serverNow} clock={clock} session={session} reducedMotion={reducedMotion} pill />;
}

type TrackShared = Pick<
  StationTrackProps,
  "phase" | "battleStep" | "turn" | "turnSeat" | "mySeat" | "playerName" | "actionOptions" | "canAct" | "noLegalMoves" | "onChoose" | "caption" | "reducedMotion" | "chainMode"
>;

/** The props of the phase track that every table builds from the same engine view and controller. */
export function stationTrackProps(source: {
  phase: StationTrackProps["phase"];
  battleStep?: StationTrackProps["battleStep"];
  turn: StationTrackProps["turn"];
  turnSeat: StationTrackProps["turnSeat"];
  mySeat: number | null;
  playerName: (seat: number) => string;
  /** The local seat holds the current prompt. */
  promptMine: boolean;
  actionOptions: StationTrackProps["actionOptions"];
  canAct: boolean;
  onAnswer: (answer: DuelAnswer) => void;
  caption: string | null;
  reducedMotion: boolean;
  chainMode?: StationTrackProps["chainMode"];
}): TrackShared {
  return {
    phase: source.phase,
    battleStep: source.battleStep,
    turn: source.turn,
    turnSeat: source.turnSeat,
    mySeat: source.mySeat,
    playerName: source.playerName,
    actionOptions: source.promptMine ? source.actionOptions : [],
    canAct: source.canAct,
    noLegalMoves: source.canAct && hasNoLegalMoves(source.actionOptions),
    onChoose: (id) => source.onAnswer({ choice: id }),
    caption: source.caption,
    reducedMotion: source.reducedMotion,
    chainMode: source.chainMode,
  };
}
