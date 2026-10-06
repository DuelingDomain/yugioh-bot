"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Volume2 } from "lucide-react";
import type { DuelCard } from "@yugidraft/shared/duels";
import type { BattleAim } from "../../battle-fx";
import { Sheet } from "@/components/ui/sheet";
import { DuelAnimationSpeedControl, useDuelAnimationSpeed } from "../../animation-speed-control";
import { DuelCardTextSizeControl } from "../../card-text-size-control";
import type { BoardTilt, BoardView } from "../../board-view";
import { AttackConfirm, CardActionMenu, confirmSide, targetName, zoneAnchor } from "../../card-interactions";
import { isBattlePhase, LOCATION_HAND, phaseTitle, zoneKey } from "../../constants";
import { DeckSurrenderContext } from "../../deck-surrender";
import { duelFontClasses } from "../../fonts";
import { DeckMasterRail } from "../../field";
import { DuelHistoryRail } from "../../history-rail";
import { CardInspector } from "../../inspector";
import { seatNamer } from "../../multi-seat";
import { PromptCenter } from "../../prompt-center";
import { optionsForCard, promptLegalKeys, type PromptDraft } from "../../prompts";
import { DuelClockDisplay, DuelSoundControls } from "../../room-settings";
import roomStyles from "../../room.module.css";
import { CardTabEmpty, DESKTOP_PANES, desktopPane, mobilePanes, SidePanel, SideTabs, type SidePane } from "../../side-panel";
import { battleStepLabel, hasNoLegalMoves, resolveBattleStep, StationTrack } from "../../station-track";
import { MatchSheetLog } from "../../text-log";
import type { DuelPreferences } from "../../preferences";
import { buildAttackPreview } from "../attack-preview";
import { SolidRoom } from "../solid-room";
import { SOLID_CARDS } from "./cards";
import { SOLID_STATE_IDS, SOLID_STATE_LABEL, solidFixture, type SolidStateId } from "./states";
import styles from "./preview-room.module.css";

const noop = () => {};
const NO_KEYS = new Set<string>();
const DRAFT: PromptDraft = {
  selected: [], setSelected: noop, counts: {}, setCounts: noop, value: 0, setValue: noop,
  cardCode: null, setCardCode: noop, highlight: 0, setHighlight: noop,
};
const DECK_SURRENDER = { seat: 0, available: false, busy: false, onSurrender: noop };

type MenuState = { anchor: HTMLElement; title: string; options: ReturnType<typeof optionsForCard> };
type ConfirmState = { anchor: HTMLElement; name: string; prefer: "above" | "below" };

/**
 * The 3D mode board on fixture data (spec section 4, W8). It builds the same slot nodes `DuelRoomView` builds, with the
 * real components and none of the room's network, and hands them to the real `SolidRoom`. Nothing is sent anywhere.
 */
export function SolidPreviewRoom({ stateId, flat, reduced }: { stateId: SolidStateId; flat: boolean; reduced: boolean }) {
  const fixture = useMemo(() => solidFixture(stateId), [stateId]);
  const { room, history, ui } = fixture;
  const engine = room.engine!;
  const slug = `solid-preview-${stateId}`;
  const boardRef = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState<BoardTilt>(flat ? "flat" : "tilt");
  const [pane, setPane] = useState<SidePane>(ui.pane ?? "card");
  const [mobileInspect, setMobileInspect] = useState(false);
  const [sound, setSound] = useState(true);
  const [volume, setVolume] = useState(0.7);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  useDuelAnimationSpeed(reduced);
  useEffect(() => { setTilt(flat ? "flat" : "tilt"); }, [flat]);

  const view: BoardView = useMemo(() => ({ mode: "3d", tilt, setMode: noop, setTilt }), [tilt]);
  const preferences: DuelPreferences = useMemo(() => ({
    soundEnabled: sound, setSoundEnabled: setSound, soundVolume: volume, setSoundVolume: setVolume,
    motion: reduced ? "reduced" : "full", setMotion: noop, reducedMotion: reduced, shake: "medium", setShake: noop,
  }), [sound, volume, reduced]);

  const playerName = useMemo(() => seatNamer(room.session.seats), [room.session.seats]);
  const prompt = engine.prompt;
  const legalKeys = useMemo(() => promptLegalKeys(prompt), [prompt]);
  const domain = room.session.mode === "domain";
  const mySeat = room.mySeat;
  const battle = isBattlePhase(engine.phase);
  const battleStep = battle ? resolveBattleStep(engine.phase, engine.battleStep ?? null) : null;
  const stepName = battleStepLabel(battleStep);
  const headerPhase = battle ? `Battle Phase${stepName ? ` · ${stepName}` : ""}` : phaseTitle(engine.phase);
  const myTurn = engine.turnSeat === mySeat;
  const turnText = myTurn ? "Your turn" : `${playerName(engine.turnSeat)}'s turn`;
  const actionOptions = prompt?.context?.type === "action" ? prompt.options : [];
  const canAct = prompt != null && prompt.seat === mySeat && prompt.context?.type === "action";
  const myHand = engine.seats[mySeat ?? 0].hand;
  // The battle state shows the locked attack arrow on the plane, so the plane path can be checked by eye.
  const battleAim: BattleAim | null = ui.confirm ? { mode: "locked", from: ui.confirm.attacker, to: { zones: [ui.confirm.target] } } : null;
  const legalActionsFor = (card: DuelCard | null, keys: string[]) => (canAct && prompt ? optionsForCard(prompt, card, keys) : []);

  // The menu and the attack confirm anchor on live board nodes, so they open once the board has laid out.
  useEffect(() => {
    setMenu(null);
    setConfirm(null);
    if (ui.menuHand == null && !ui.confirm) return undefined;
    let tries = 0;
    let timer = 0;
    const open = () => {
      if (ui.menuHand != null && prompt) {
        const card = myHand[ui.menuHand] as DuelCard | undefined;
        const anchor = card?.handId ? document.querySelector<HTMLElement>(`[data-hand-id="${card.handId}"]`) : null;
        if (card && anchor) {
          const keys = [zoneKey(card.controller, LOCATION_HAND, card.sequence)];
          setMenu({ anchor, title: card.name ?? "Card", options: optionsForCard(prompt, card, keys) });
          return;
        }
      }
      if (ui.confirm) {
        const anchor = zoneAnchor(ui.confirm.target);
        if (anchor) {
          setConfirm({ anchor, name: targetName({ card: SOLID_CARDS.battleOx }), prefer: confirmSide(ui.confirm.attacker, anchor) });
          return;
        }
      }
      if (++tries < 40) timer = window.setTimeout(open, 100);
    };
    timer = window.setTimeout(open, 150);
    return () => window.clearTimeout(timer);
  }, [stateId, ui, prompt, myHand]);

  const inspectCard = SOLID_CARDS[ui.inspect.card];
  const cardPanel = <CardInspector target={{ type: "info", card: inspectCard }} />;
  const masterRail = domain ? (
    <DeckMasterRail engine={engine} mySeat={mySeat} legalKeys={legalKeys} selectedKeys={NO_KEYS} canAct={canAct}
      legalActionsFor={legalActionsFor} onActivate={noop} onChooseAction={noop} onInspect={noop} />
  ) : null;
  const logPanel = (
    <div className={roomStyles.logPane}>
      <DuelHistoryRail key={slug} events={history} engine={engine} mySeat={mySeat} playerName={playerName}
        onInspectCard={noop} reducedMotion={reduced} />
      <details className={roomStyles.textLog}>
        <summary>Text log</summary>
        <MatchSheetLog entries={engine.log ?? []} playerName={playerName} players={room.session.seats.map((seat) => seat.displayName).join(" v ")} />
      </details>
    </div>
  );
  const settingsPanel = (
    <div className={roomStyles.options}>
      <h2>Presentation</h2>
      <DuelAnimationSpeedControl />
      <DuelCardTextSizeControl />
      <DuelSoundControls enabled={sound} volume={volume} onEnabledChange={setSound} onVolumeChange={setVolume} />
      <p>Preview only. Nothing here is sent to a duel.</p>
      <Link href="/dev/solid-preview">All states</Link>
    </div>
  );
  const sidePanes = (inAside: boolean) => (
    <>
      <SidePanel pane="card" selected={inAside ? desktopPane(pane) : pane} semantic={inAside}>{cardPanel ?? <CardTabEmpty />}</SidePanel>
      <SidePanel pane="log" selected={inAside ? desktopPane(pane) : pane} semantic={inAside} keepMounted>{logPanel}</SidePanel>
      <SidePanel pane="settings" selected={inAside ? desktopPane(pane) : pane} semantic={inAside}>{settingsPanel}</SidePanel>
      {inAside ? null : <SidePanel pane="masters" selected={pane} semantic={false}><div className={roomStyles.mastersSheet}>{masterRail}</div></SidePanel>}
    </>
  );
  const tabs = (mobile = false) => (
    <SideTabs panes={mobile ? mobilePanes(domain) : DESKTOP_PANES} selected={mobile ? pane : desktopPane(pane)} unread={0} mobile={mobile}
      onSelect={(tab) => { setPane(tab); if (mobile) setMobileInspect(true); }} />
  );

  const trackCaption = prompt == null ? null : canAct ? null : prompt.title;
  const chainPrompt = prompt?.context?.type === "chain";
  const renderBoard = (field: React.ReactNode) => (
    <>
      {field}
      <PromptCenter prompt={prompt} mySeat={mySeat} active slug={slug} busy={false} draft={DRAFT} onSubmit={noop}
        menuOpen={menu != null} chain={engine.chain} aimLocked={confirm != null} reducedMotion={reduced}
        revision={engine.revision} battleStep={battleStep} revealed nameOf={playerName} />
    </>
  );

  return (
    <DeckSurrenderContext.Provider value={DECK_SURRENDER}>
      <SolidRoom
        slug={slug}
        boardRef={boardRef}
        dealWait={false}
        domain={domain}
        battle={battle}
        spectator={false}
        myTurn={myTurn}
        reducedMotion={reduced}
        view={view}
        preferences={preferences}
        engine={engine}
        mySeat={mySeat}
        playerName={playerName}
        format={domain ? "Domain · Normal" : "MR5 · Normal"}
        turnText={turnText}
        headerPhase={headerPhase}
        battleStep={battleStep}
        wordmark={<Link href="/duels">Duelists Kingdom</Link>}
        spectatorTag={null}
        seriesLabel={null}
        connectionStatus={
          <span className={roomStyles.connectionStatus} role="status" aria-live="polite" data-live="true">
            <i className={roomStyles.liveDot} aria-hidden />
            <span className={roomStyles.connectionText}>Live duel</span>
          </span>
        }
        headerTools={
          <button type="button" className={`${roomStyles.tool} ${roomStyles.pref}`} aria-label={`Sound effects ${sound ? "on" : "off"}`}
            onClick={() => setSound(!sound)}>
            <Volume2 size={16} strokeWidth={1.75} aria-hidden /><span>Sound <b>{sound ? "On" : "Off"}</b></span>
          </button>
        }
        seriesBanner={null}
        noticesNode={null}
        inspectorNode={<>{tabs()}<div className={roomStyles.sideContent}>{sidePanes(true)}</div></>}
        promptDockNode={null}
        masterRail={masterRail}
        legalActionsFor={legalActionsFor}
        onChooseAction={noop}
        battleAim={battleAim}
        trackNode={
          <StationTrack phase={engine.phase} battleStep={battleStep} turn={engine.turn} turnSeat={engine.turnSeat} mySeat={mySeat}
            playerName={playerName} actionOptions={canAct ? actionOptions : []} canAct={canAct}
            noLegalMoves={canAct && hasNoLegalMoves(actionOptions)} onChoose={noop} caption={chainPrompt ? prompt?.title : trackCaption}
            reducedMotion={reduced} />
        }
        mobileTabs={tabs(true)}
        overlaysNode={
          <>
            {menu ? <CardActionMenu anchor={menu.anchor} title={menu.title} options={menu.options} busy={false} onClose={() => setMenu(null)}
              onChoose={() => setMenu(null)} /> : null}
            {confirm ? <AttackConfirm anchor={confirm.anchor} targetName={confirm.name} busy={false} prefer={confirm.prefer}
              preview={ui.confirm ? buildAttackPreview(engine, ui.confirm.attacker, ui.confirm.target, playerName) : undefined}
              onConfirm={() => setConfirm(null)} onBack={() => setConfirm(null)} /> : null}
            <Sheet open={mobileInspect} onClose={() => setMobileInspect(false)}
              className="bg-[color:var(--ink-1)] border-t border-[color:var(--gold-b)] rounded-t-[16px] md:rounded-t-none"
              title={pane === "card" ? "Card" : pane === "log" ? "Duel log" : pane === "masters" ? "Deck Masters" : "Settings"}>
              {sidePanes(false)}
            </Sheet>
            <nav className={`${styles.switcher} ${duelFontClasses}`} aria-label="Preview states" data-preview-switcher="">
              <details>
                <summary>States</summary>
                <ul>
                  {SOLID_STATE_IDS.map((id) => (
                    <li key={id}>
                      <Link href={`/dev/solid-preview?state=${id}${flat ? "&view=flat" : ""}${reduced ? "&reduced=1" : ""}`}
                        aria-current={id === stateId ? "page" : undefined}>{SOLID_STATE_LABEL[id]}</Link>
                    </li>
                  ))}
                </ul>
              </details>
            </nav>
          </>
        }
        fieldProps={{
          engine, mySeat, masterRule: room.session.masterRule, reducedMotion: reduced, priorityLive: true,
          legalKeys, selectedKeys: NO_KEYS, onActivate: noop, onInspect: noop,
          bottomName: playerName(mySeat ?? 0), topName: playerName(1 - (mySeat ?? 0)),
        }}
        renderBoard={renderBoard}
        renderClock={(seat) => room.clock ? <DuelClockDisplay clock={room.clock} session={room.session} seats={[seat]} /> : null}
        inspect={{ type: "info", card: inspectCard }}
        pane={pane}
        setPane={setPane}
        setMobileInspect={setMobileInspect}
        boardQuiet={() => true}
        onBeforeViewChange={() => { setMenu(null); setConfirm(null); }}
      />
    </DeckSurrenderContext.Provider>
  );
}
