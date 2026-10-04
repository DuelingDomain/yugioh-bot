import { create } from "zustand";
import type { CardSummary } from "@/lib/card-types";

export type DraftCardDetail = CardSummary & {
  /** Catalog (YGOPRODeck) id, distinct from the draft card instance id. */
  passcode: number;
  /** Archetype from the card catalog, when it has one. */
  archetype?: string | null;
  /** Monster type from the duel engine ("Dragon"). Absent when the engine could not be reached. */
  race?: string | null;
  /** Spell or trap kind from the duel engine ("Quick-Play", "Counter"). Absent when the engine could not be reached. */
  spellTrapType?: string | null;
  /** Copies of this card the viewer already holds in the draft (draft room only). */
  held?: number;
  /** The viewer holds the per-player maximum of this card, so it cannot be picked. */
  blocked?: boolean;
  /** Every card in this pack is capped for the viewer and no legal swap exists, so the pick stays in their pool only. */
  forced?: boolean;
};

export interface Seat {
  seatIndex: number;
  playerId: number;
  displayName: string;
  hasPicked: boolean;
  isCurrentPlayer: boolean;
}

export interface DraftState {
  slug: string;
  packRound: number;
  pickStep: number;
  currentPack: DraftCardDetail[];
  myPool: DraftCardDetail[];
  seats: Seat[];
  timerSeconds: number;
  isMyTurn: boolean;
  /** Nothing in the pack could be taken this step, so the pick was passed. */
  passed: boolean;
  completed: boolean;
  pickSeconds: number;
  previewCardId: number | null;
  selectedCardId: number | null;
  highlightedIndex: number;
}

export interface DraftActions {
  setFromServer: (state: Partial<DraftState>) => void;
  pickCard: (cardId: number) => void;
  tick: () => void;
  setPreviewCard: (cardId: number | null) => void;
  setSelectedCard: (cardId: number | null) => void;
  setHighlightedIndex: (index: number) => void;
}

const initialState: DraftState = {
  slug: "",
  packRound: 1,
  pickStep: 1,
  currentPack: [],
  myPool: [],
  seats: [],
  timerSeconds: 0,
  isMyTurn: false,
  passed: false,
  completed: false,
  pickSeconds: 60,
  previewCardId: null,
  selectedCardId: null,
  highlightedIndex: -1,
};

function haveSameCardIds(currentPack: DraftCardDetail[], nextPack: DraftCardDetail[]) {
  if (currentPack.length !== nextPack.length) {
    return false;
  }

  return currentPack.every((card, index) => card.id === nextPack[index]?.id);
}

export const useDraftStore = create<DraftState & DraftActions>((set) => ({
  ...initialState,

  setFromServer: (partial) =>
    set((state) => {
      const nextState = {
        ...state,
        ...partial,
      };
      const nextPack = partial.currentPack ?? state.currentPack;
      const nextIsMyTurn = partial.isMyTurn ?? state.isMyTurn;
      const nextCompleted = partial.completed ?? state.completed;
      const packChanged = partial.currentPack !== undefined && !haveSameCardIds(state.currentPack, partial.currentPack);
      const selectedStillAvailable =
        nextState.selectedCardId !== null && nextPack.some((card) => card.id === nextState.selectedCardId);
      const highlightedStillAvailable =
        nextState.highlightedIndex >= 0 && nextState.highlightedIndex < nextPack.length;

      if (!nextIsMyTurn || nextCompleted || packChanged || !selectedStillAvailable) {
        nextState.selectedCardId = null;
      }

      if (!nextIsMyTurn || nextCompleted || packChanged || !nextPack.some((card) => card.id === nextState.previewCardId)) {
        nextState.previewCardId = null;
      }

      if (!nextIsMyTurn || nextCompleted || packChanged || !highlightedStillAvailable) {
        nextState.highlightedIndex = -1;
      }

      return nextState;
    }),

  pickCard: (cardId) =>
    set((state) => {
      const card = state.currentPack.find((c) => c.id === cardId);
      if (!card || card.blocked || !state.isMyTurn) return state;

      return {
        ...state,
        currentPack: state.currentPack.filter((c) => c.id !== cardId),
        myPool: [...state.myPool, card],
        isMyTurn: false,
        previewCardId: null,
        selectedCardId: null,
        highlightedIndex: -1,
      };
    }),

  tick: () =>
    set((state) => ({
      ...state,
      timerSeconds: Math.max(0, state.timerSeconds - 1),
    })),

  setPreviewCard: (cardId) =>
    set((state) => ({
      ...state,
      previewCardId: cardId,
    })),

  setSelectedCard: (cardId) =>
    set((state) => ({
      ...state,
      selectedCardId: cardId,
    })),

  setHighlightedIndex: (index) =>
    set((state) => ({
      ...state,
      highlightedIndex: index,
    })),
}));
