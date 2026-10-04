import { chainModeOf, type DuelAnswer } from "@yugidraft/shared/duels";
import { eliminationCodeOf, type EngineGame } from "./engine.js";

/**
 * The journal commands that answer no prompt: an elimination (`eliminate:<reason>`) and a chain response mode change
 * (`chain-mode:<mode>`). Their promptId is a sentinel, so a replay checks only the revision for them.
 */
export function isPromptlessCommand(promptId: string): boolean {
  return eliminationCodeOf(promptId) !== null || chainModeOf(promptId) !== null;
}

/** Apply one journaled command to a game, the way a recover does. */
export function applyJournaledCommand(game: EngineGame, seat: number, command: { promptId: string; answer: DuelAnswer }): void {
  const elimination = eliminationCodeOf(command.promptId);
  const mode = chainModeOf(command.promptId);
  if (mode !== null) game.setChainMode(seat, mode);
  else if (elimination !== null) game.eliminate(seat, elimination);
  else game.answer(seat, command.promptId, command.answer);
}
