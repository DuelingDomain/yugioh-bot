import type { DuelEngineView } from "@yugidraft/shared/duels";

export type ProofBug = 1 | 2 | 4;
export interface ProofCase {
  id: string;
  bug: ProofBug;
  title: string;
  mySeat: number | null;
  engine: DuelEngineView;
  targetCode: number;
  targetName: string;
  replayFrom?: number;
  setZone?: string;
  materialViews?: DuelEngineView[];
  materialCodes?: number[];
  completedView?: DuelEngineView;
}
export interface ProofPageData { cases: ProofCase[] }
export interface ProofRead {
  historyRows: { text: string; icon: string | null; showsTargetArt: boolean }[];
  historyShowsTarget: boolean;
  revealShowsTarget: boolean;
  revealText: string;
  confirmationBannerCount: number;
  counterText: string | null;
  titleText: string | null;
  detailText: string | null;
  instructionText: string | null;
  counterMet: boolean | null;
  counterMarker: string | null;
  confirmEnabled: boolean | null;
  promptReady: boolean | null;
  promptText: string;
  fieldCardBack: boolean | null;
  fieldCardPosition: number | null;
  step: number;
  pendingAnswerPreview: boolean;
}
declare global {
  interface Window { readBugProof: () => ProofRead }
}
