import type { EngineCoreInfo, EngineDiagnostic, EngineStartupScript } from "./engine.js";
import type { DuelAnswer, DuelCardInfo, DuelDeck, DuelEngineView, DuelFormat, DuelMasterRule, DuelMode, DuelSettings } from "@yugidraft/shared/duels";

export interface DuelWorkerCreateOptions {
  mode: DuelMode;
  decks: DuelDeck[];
  seed: string[];
  dataDirectory: string;
  masterRule?: DuelMasterRule;
  settings?: DuelSettings;
  /** Seat and team layout; `decks` holds one deck per seat. Default `1v1`. */
  format?: DuelFormat;
  /** Lua chunks that run before the duel starts (hand scenarios). */
  startupScripts?: EngineStartupScript[];
}

export type DuelWorkerRequest =
  | { id: number; op: "create"; options: DuelWorkerCreateOptions }
  | { id: number; op: "view"; seat: number | null }
  | { id: number; op: "answer"; seat: number; promptId: string; answer: DuelAnswer }
  | { id: number; op: "search"; query: string }
  | { id: number; op: "eliminate"; seat: number; reason: number }
  | { id: number; op: "diagnostics" }
  | { id: number; op: "close" };

export type DuelWorkerResponse =
  | { id: number; ok: true; value?: DuelEngineView | DuelCardInfo[] | EngineDiagnostic[]; info?: EngineCoreInfo }
  | { id: number; ok: false; error: string };
