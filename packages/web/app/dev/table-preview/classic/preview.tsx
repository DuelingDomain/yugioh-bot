"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { isDuelChainMode, type DuelChainMode } from "@yugidraft/shared/duels";
import { DeckSurrenderContext } from "@/components/duel/deck-surrender";
import { isBattlePhase } from "@/components/duel/constants";
import { DuelField } from "@/components/duel/field";
import { duelFontClasses } from "@/components/duel/fonts";
import { seatNamer } from "@/components/duel/multi-seat";
import { PhaseHub } from "@/components/duel/phase-hub";
import { PromptCenter } from "@/components/duel/prompt-center";
import { promptLegalKeys, type PromptDraft } from "@/components/duel/prompts";
import roomStyles from "@/components/duel/room.module.css";
import { hasNoLegalMoves, resolveBattleStep, StationTrack } from "@/components/duel/station-track";
import { SOLID_STATE_IDS, SOLID_STATE_LABEL, solidFixture, type SolidStateId } from "@/components/duel/solid/fixtures/states";
import { useDuelAnimationSpeed } from "@/components/duel/animation-speed-control";

const noop = () => {};
const NO_KEYS = new Set<string>();
const DRAFT: PromptDraft = {
  selected: [], setSelected: noop, counts: {}, setCounts: noop, value: 0, setValue: noop,
  cardCode: null, setCardCode: noop, highlight: 0, setHighlight: noop,
};
const DECK_SURRENDER = { seat: 0, available: false, busy: false, onSurrender: noop };

/** `?state=` names: the multiplayer previews' ids where they have a 1v1 twin, else the 1v1 fixture's own. */
const ALIAS: Readonly<Record<string, SolidStateId>> = {
  main: "m1", "battle-aim": "battle", "chain-2": "chains", "direct-attack": "battle", "target-pick": "m2",
};
export function classicStateId(raw: string | null | undefined): SolidStateId {
  if (raw && raw in ALIAS) return ALIAS[raw];
  return (SOLID_STATE_IDS as readonly string[]).includes(raw ?? "") ? (raw as SolidStateId) : "m1";
}

/**
 * The classic 1v1 room on fixture data: the room's own layout (header, board column, station track) with the real
 * DuelField, PhaseHub and StationTrack, and none of the room's network. Phase moves are logged, not sent.
 */
export function ClassicPreview({ stateId, chain: chainParam, reduced }: { stateId: string | null; chain: string | null; reduced: boolean }) {
  const id = classicStateId(stateId);
  const { room } = useMemo(() => solidFixture(id), [id]);
  const engine = room.engine!;
  useDuelAnimationSpeed(reduced);
  const [chain, setChain] = useState<DuelChainMode>(isDuelChainMode(chainParam) ? chainParam : "auto");
  const playerName = useMemo(() => seatNamer(room.session.seats), [room.session.seats]);
  const prompt = engine.prompt;
  const mySeat = room.mySeat;
  const legalKeys = useMemo(() => promptLegalKeys(prompt), [prompt]);
  const battle = isBattlePhase(engine.phase);
  const battleStep = battle ? resolveBattleStep(engine.phase, engine.battleStep ?? null) : null;
  const myTurn = engine.turnSeat === mySeat;
  const actionOptions = prompt?.context?.type === "action" ? prompt.options : [];
  const canAct = prompt != null && prompt.seat === mySeat && prompt.context?.type === "action";
  const chainPrompt = prompt?.context?.type === "chain";
  const trackCaption = chainPrompt ? prompt?.title : prompt == null ? null : canAct ? null : prompt.title;
  const choose = (optionId: string) => console.info("[table-preview] phase move", { state: id, optionId });
  const showChain = chainParam !== "none";

  return (
    <DeckSurrenderContext.Provider value={DECK_SURRENDER}>
      <div
        className={`${roomStyles.shell} ${duelFontClasses}`}
        data-table-preview="classic" data-state={id} data-duel-fx-speed-root data-fit="true"
        data-phase={battle ? "battle" : undefined} data-turn={myTurn ? "you" : "opp"} data-reduced={reduced ? "true" : "false"}
      >
        <header className={roomStyles.header}>
          <Link href="/dev/table-preview" style={{ color: "inherit" }}>Classic 1v1 preview</Link>
          <nav aria-label="Preview state" style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center", fontSize: 12 }}>
            {SOLID_STATE_IDS.map((sid) => (
              <Link key={sid} href={`/dev/table-preview/classic?state=${sid}${chainParam ? `&chain=${chainParam}` : ""}${reduced ? "&reduced=1" : ""}`}
                aria-current={sid === id ? "page" : undefined} style={{ color: sid === id ? "#c6b6ff" : "inherit" }}>
                {SOLID_STATE_LABEL[sid]}
              </Link>
            ))}
          </nav>
          <span />
        </header>
        <div className={roomStyles.layout}>
          <aside className={roomStyles.inspector} />
          <section className={roomStyles.boardColumn} aria-label="Duel field">
            <div className={roomStyles.board}>
              <DuelField
                engine={engine} mySeat={mySeat} masterRule={room.session.masterRule} reducedMotion={reduced} priorityLive
                legalKeys={legalKeys} selectedKeys={NO_KEYS} onActivate={noop} onInspect={noop}
                bottomName={playerName(mySeat ?? 0)} topName={playerName(1 - (mySeat ?? 0))}
                hub={
                  <PhaseHub
                    variant="band" phase={engine.phase} battleStep={battleStep} turn={engine.turn} turnSeat={engine.turnSeat}
                    mySeat={mySeat} playerName={playerName} actionOptions={canAct ? actionOptions : []} canAct={canAct}
                    onChoose={choose} reducedMotion={reduced}
                  />
                }
              />
              <PromptCenter
                prompt={prompt} mySeat={mySeat} active slug={`classic-preview-${id}`} busy={false} draft={DRAFT} onSubmit={noop}
                menuOpen={false} chain={engine.chain} aimLocked={false} reducedMotion={reduced} revision={engine.revision}
                battleStep={battleStep} revealed nameOf={playerName}
              />
            </div>
          </section>
        </div>
        <div className={roomStyles.track}>
          <StationTrack
            phase={engine.phase} battleStep={battleStep} turn={engine.turn} turnSeat={engine.turnSeat} mySeat={mySeat}
            playerName={playerName} actionOptions={canAct ? actionOptions : []} canAct={canAct}
            noLegalMoves={canAct && hasNoLegalMoves(actionOptions)} onChoose={choose} caption={trackCaption}
            reducedMotion={reduced} chainMode={showChain ? { mode: chain, onChange: setChain } : null} phases="hub"
          />
        </div>
      </div>
    </DeckSurrenderContext.Provider>
  );
}
