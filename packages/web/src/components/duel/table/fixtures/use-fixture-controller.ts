"use client";

import { useCallback, useMemo, useState } from "react";
import type { DuelAnswer } from "@yugidraft/shared/duels";
import { seatNamer, seatPickFor } from "../../multi-seat";
import { promptLegalKeys, promptSelectedKeys, usePromptDraft } from "../../prompts";
import type { BattleAim, DuelActivateHandler, TableController } from "../types";
import type { TableFixtureState } from "./common";

export interface FixtureControllerOptions {
  reducedMotion?: boolean;
  /** Called with a short message after an answer; the preview harness shows it as a toast. */
  onToast?: (message: string) => void;
}

/**
 * A TableController for a fixture: the same shape the duel room builds from live state, with no engine behind it.
 * Answers go to the console and a toast. The aim is local state seeded from `state.ui.aim`.
 * Call it with a fresh `key` per fixture state (the preview harness does), so the prompt draft and the aim reset.
 */
export function useFixtureController(state: TableFixtureState, options: FixtureControllerOptions = {}): TableController {
  const { room } = state;
  const engine = room.engine;
  if (!engine) throw new Error(`Fixture state "${state.id}" has no engine view.`);
  const { reducedMotion = false, onToast } = options;

  const prompt = engine.prompt;
  const draft = usePromptDraft(prompt);
  const [aim, setAim] = useState<BattleAim | null>(state.ui?.aim ?? null);
  const seats = room.session.seats;

  const nameOf = useMemo(() => seatNamer(seats), [seats]);

  const onAnswer = useCallback(
    (answer: DuelAnswer) => {
      console.info("[table-preview] answer", { state: state.id, promptId: prompt?.id ?? null, answer });
      onToast?.("Answer sent (fixture)");
    },
    [onToast, prompt?.id, state.id],
  );

  const onActivate = useCallback<DuelActivateHandler>(
    (keys, card) => {
      console.info("[table-preview] activate", { state: state.id, keys, card: card?.name ?? null });
    },
    [state.id],
  );

  const onAim = useCallback(
    (to: BattleAim["to"] | null) => {
      setAim((current) => {
        if (to == null) return state.ui?.aim ?? null;
        return { mode: "aim", from: current?.from ?? state.ui?.aim?.from ?? null, to };
      });
    },
    [state.ui?.aim],
  );

  const legalKeys = useMemo(() => promptLegalKeys(prompt), [prompt]);
  const selectedKeys = useMemo(() => promptSelectedKeys(prompt, draft.selected), [prompt, draft.selected]);

  const seatPick = useMemo(() => seatPickFor(prompt, engine, onAnswer), [engine, onAnswer, prompt]);

  const onInspect = useCallback<TableController["onInspect"]>(
    (target) => console.info("[table-preview] inspect", { type: target.type }),
    [],
  );

  const viewerSeat = room.mySeat;
  return {
    room,
    engine,
    viewerSeat,
    nameOf,
    prompt,
    promptSeat: prompt?.seat ?? null,
    canAct: prompt != null && viewerSeat != null && prompt.seat === viewerSeat,
    busy: false,
    revealed: true,
    draft,
    legalKeys,
    selectedKeys,
    aim,
    seatPick,
    reducedMotion,
    onAnswer,
    onActivate,
    onInspect,
    onAim,
  };
}
