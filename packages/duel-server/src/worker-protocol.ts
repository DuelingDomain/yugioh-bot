import type { DuelAnswer, DuelCardInfo, DuelDeck, DuelEngineView, DuelMasterRule, DuelMode, DuelSettings } from "@yugidraft/shared/duels";

export interface DuelWorkerCreateOptions {
  mode: DuelMode;
  decks: DuelDeck[];
  seed: string[];
  dataDirectory: string;
  masterRule?: DuelMasterRule;
  settings?: DuelSettings;
}

export type DuelWorkerRequest =
  | { id: number; op: "create"; options: DuelWorkerCreateOptions }
  | { id: number; op: "view"; seat: number | null }
  | { id: number; op: "answer"; seat: number; promptId: string; answer: DuelAnswer }
  | { id: number; op: "search"; query: string }
  | { id: number; op: "close" };

export type DuelWorkerResponse =
  | { id: number; ok: true; value?: DuelEngineView | DuelCardInfo[] }
  | { id: number; ok: false; error: string };
