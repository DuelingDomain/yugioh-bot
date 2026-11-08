"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent } from "react";
import { REMOTE_FORMATS, normalizeRemoteFormat, previousYgoPhase, type RemoteRoom } from "@yugidraft/shared/remote";
import { fieldZoneAt, onMat, type FieldFormat } from "@yugidraft/vision";
import { ConnectionState } from "livekit-client";
import { duelFontClasses } from "@/components/duel/fonts";
import { SheetButton, sheetButtonClass, sheetPage } from "@/components/duel/sheet-ui";
import { SpectatorVideo } from "@/lib/remote/spectator-video";
import { publicTrackedTwin } from "@/lib/remote/field-track-cache";
import { watchVideoFrames } from "@/lib/remote/video-protocol";
import { useCardInfo } from "./catalog";
import { HandStrip } from "./hand-ui";
import { handCountOf, knownHandOf } from "./reveal-model";
import { CardPopover, type CardActions, type Subject } from "./card-view";
import { Rail, LpStrip } from "./chrome";
import { tabId } from "./api";
import { describeEvent } from "./describe";
import { LogDrawer, type LogEntry } from "./drawers";
import { Icon } from "./icons";
import { serverNow } from "./api";
import { matchOf } from "./match-model";
import { OpeningRollScreen } from "./opening-roll";
import { cardCode, cardName, cellsFor, COLORS, hasExtraZones, type TwinCard, type ZoneKey } from "./model";
import { PileViewer, type PileZone } from "./pile-viewer";
import type { PopAt, Rect } from "./popup";
import { useLayers } from "./use-layers";
import type { RoomController } from "./use-remote-room";
import s from "./remote-ui.module.css";
import v from "./spectator-table.module.css";

const NO_ACTIONS: CardActions = { canAdd: false, adding: false, onAdd: () => undefined, canAttack: false, attackHint: "", onAttack: () => undefined };
const fmtTime = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const DEFAULT_RATIO = 16 / 9;
const CARD_H = .24; const CARD_ASPECT = 59 / 86;

/** The leave links free the slot at once. A closed tab or a reload keeps it until the poll time ends, so a reload cannot lose it to the next person. */
const stopWatching = (slug: string) => fetch(`/api/remote/${slug}/spectate?tab=${tabId}`, { method: "DELETE", keepalive: true }).catch(() => undefined);

/** The page of a person who watches. It mounts no camera, no card reader, no field watcher and no voice. */
export function SpectatorScreen({ ctl, room }: { ctl: RoomController; room: RemoteRoom }) {
  if (room.status === "lobby") return <SpectatorLobby ctl={ctl} room={room} />;
  return <SpectatorTable room={room} />;
}

function SpectatorLobby({ ctl, room }: { ctl: RoomController; room: RemoteRoom }) {
  const open = room.seatCount - room.seats.length;
  return <div className={`${duelFontClasses} ${sheetPage}`} data-testid="spectator-lobby"><div className={v.lobby}>
    <h1 style={{ margin: 0 }}>Remote table</h1>
    <p role="status" style={{ margin: 0 }}><span className={v.badge} data-testid="spectator-badge">Spectator</span> Waiting for the table to start. {room.spectatorCount ?? 0} watching.</p>
    <ul>{room.seats.map(seat => <li key={seat.seat}><span>{seat.displayName}</span><span>{seat.ready ? "Ready" : "Not ready"}</span></li>)}</ul>
    {ctl.error ? <p role="alert">{ctl.error}</p> : null}
    {/* A private table has no seat for an admin who watches it: only a public table offers one. */}
    {open > 0 && room.visibility !== "private" ? <SheetButton kind="primary" disabled={ctl.busy} data-testid="spectator-join-seat" onClick={() => void ctl.operation("seat")}>Join · {open} open</SheetButton> : null}
    <a href="/duels" className={sheetButtonClass("quiet", "sm")} onClick={() => void stopWatching(room.slug)}>Back to duels</a>
  </div></div>;
}

function SpectatorFeed({ seat, name, video, online, stopped, frozen, onCard }: {
  seat: number; name: string; video: SpectatorVideo; online: boolean; stopped: boolean; frozen: (seat: number, value: boolean) => void;
  /** A click on the camera at a point of the frame (0..1). */ onCard: (seat: number, x: number, y: number, anchor: Rect, feed: Rect) => void;
}) {
  const snapshot = useSyncExternalStore(video.subscribe, video.getSnapshot, video.getSnapshot);
  const track = snapshot.feeds.find(feed => feed.seat === seat)?.video;
  const element = useRef<HTMLVideoElement>(null);
  const [ratio, setRatio] = useState(DEFAULT_RATIO);
  useEffect(() => {
    const target = element.current; if (!target || !track) return;
    track.attach(target);
    const stop = watchVideoFrames(target, stalled => frozen(seat, stalled));
    const measure = () => { if (target.videoWidth && target.videoHeight) setRatio(target.videoWidth / target.videoHeight); };
    target.addEventListener("loadedmetadata", measure); target.addEventListener("resize", measure); measure();
    return () => { stop(); track.detach(target); target.removeEventListener("loadedmetadata", measure); target.removeEventListener("resize", measure); frozen(seat, false); };
  }, [track, seat, frozen]);
  const click = (event: MouseEvent<HTMLDivElement>) => {
    const target = element.current; if (!target?.videoWidth) return;
    const box = target.getBoundingClientRect(), scale = Math.min(box.width / target.videoWidth, box.height / target.videoHeight);
    const width = target.videoWidth * scale, height = target.videoHeight * scale, left = box.left + (box.width - width) / 2, top = box.top + (box.height - height) / 2;
    const x = (event.clientX - left) / width, y = (event.clientY - top) / height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    const h = height * CARD_H, w = h * CARD_ASPECT;
    onCard(seat, x, y, { left: event.clientX - w / 2, right: event.clientX + w / 2, top: event.clientY - h / 2, bottom: event.clientY + h / 2 }, { left, top, right: left + width, bottom: top + height });
  };
  return <div className={s.feedcol} data-testid={`feed-col-${seat}`} style={{ "--vr": ratio } as CSSProperties}>
    <div className={s.cams} role="group" aria-label={`${name}'s field camera. Click a public card to see it.`} data-testid={`feed-${seat}`} data-layer-asked={video.layerName}>
      <div className={s.fcam} style={{ cursor: "default" }} onClick={click}>
        {track ? <video ref={element} autoPlay playsInline muted aria-hidden="true" /> : <div className={s.nofeed}>
          <span>{online ? `Waiting for ${name}'s camera.` : stopped ? "Table video is off." : "Connecting to table video…"}</span></div>}
      </div>
    </div>
  </div>;
}

function SpectatorTable({ room }: { room: RemoteRoom }) {
  const layers = useLayers();
  const state = room.state; const match = matchOf(room); const seatCount = room.seatCount;
  const ended = room.status === "ended";
  // During the opening die roll nobody has the turn yet: the roll screen says who chooses.
  const opening = match.phase === "duel" && match.opening && (match.opening.chosenSeat === undefined || match.opening.auto) && !state.ended && room.status === "active" ? match.opening : null;
  const turnSeat = match.opening && match.opening.chosenSeat === undefined && match.phase === "duel" ? -1 : state.turnSeat;
  const members = JSON.stringify(room.seats.map(({ seat, userId }) => ({ seat, userId })));
  // One connection for the page. It ends with the table.
  const [video, setVideo] = useState<SpectatorVideo | null>(null);
  useEffect(() => {
    if (ended) return;
    const controller = new SpectatorVideo({ slug: room.slug, guildId: room.guildId, members: JSON.parse(members) });
    setVideo(controller); void controller.connect();
    return () => { controller.dispose(); setVideo(null); };
    // The roster has its own effect: a change must keep the connection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.slug, room.guildId, ended]);
  useEffect(() => { video?.setMembers(JSON.parse(members)); }, [video, members]);
  const noVideo = { subscribe: () => () => undefined, snapshot: { connection: ConnectionState.Disconnected, feeds: [], error: "" } as ReturnType<SpectatorVideo["getSnapshot"]> };
  const snapshot = useSyncExternalStore(video?.subscribe ?? noVideo.subscribe, video?.getSnapshot ?? (() => noVideo.snapshot), () => noVideo.snapshot);
  const online = snapshot.connection === ConnectionState.Connected;
  const [, setFrozen] = useState<Record<number, boolean>>({});
  const onFrozen = useMemo(() => (seat: number, value: boolean) => setFrozen(old => old[seat] === value ? old : { ...old, [seat]: value }), []);

  const seatIds = room.seats.map(seat => seat.seat);
  const name = (seat: number) => room.seats.find(item => item.seat === seat)?.displayName ?? `Seat ${seat + 1}`;
  const lp = (seat: number) => state.seats[seat]?.resources.lp ?? 0;
  const [subject, setSubject] = useState<Subject | null>(null);
  const [popAt, setPopAt] = useState<PopAt>({ anchor: null, feed: null });
  const info = useCardInfo([...state.seats.flatMap(item => [...item.twin.map(cardCode), ...(item.knownHand ?? []).map(card => card.cardId)]), subject?.cardId]);
  const extraZones = hasExtraZones(room.format?.id);
  const format = (room.format?.id ?? state.deckChecks.format.id) as FieldFormat;

  /** Only a card the server sent as public opens. A face-down card has no id in this view, so it can open nothing. */
  const show = (seat: number, card: TwinCard | undefined, anchor: Rect, feed: Rect | null) => {
    const id = card?.faceUp !== false && card ? cardCode(card) : undefined; if (!card || !id) return;
    setSubject({ from: "camera", cardId: id, seat, ref: card.ref, name: card.name, notInDecklist: null, addErrors: [], via: "field" });
    setPopAt({ anchor, feed }); layers.open("card");
  };
  // A revealed card opens the same popover as a card on the field, next to the tray.
  const showKnown = (seat: number, card: { cardId: number; name: string }) => {
    const box = document.querySelector(`[data-testid="hand-strip-${seat}"]`)?.getBoundingClientRect(); if (!box) return;
    setSubject({ from: "camera", cardId: card.cardId, seat, name: card.name, notInDecklist: null, addErrors: [], via: "field" });
    setPopAt({ anchor: { left: box.left, right: box.right, top: box.top, bottom: box.bottom }, feed: null }); layers.open("card");
  };
  const onFeed = (seat: number, x: number, y: number, anchor: Rect, feed: Rect) => {
    if (!video) return;
    const twin = state.seats[seat]?.twin ?? [];
    const tracked = video.tracks.hit(seat, x, y), read = tracked ? publicTrackedTwin(tracked, twin) : undefined;
    let card = read ? twin.find(item => item.ref === read.ref) : undefined;
    const calibration = card ? undefined : video.tracks.calibration(seat);
    if (calibration?.orientation) {
      const zone = fieldZoneAt(onMat({ x, y }, calibration), calibration, format);
      const key = !zone ? null : zone === "FIELD" ? "f" : zone.startsWith("EMZ") ? `e${zone.slice(-1)}` : /^[MS][1-5]$/.test(zone) ? zone.toLowerCase() : null;
      card = key ? cellsFor(twin, extraZones)[key as ZoneKey]?.card : undefined;
    }
    show(seat, card, anchor, feed);
  };
  const [pile, setPile] = useState<{ seat: number; zone: PileZone } | null>(null);
  useEffect(() => { if (pile && layers.layer !== "pile" && layers.layer !== "card") setPile(null); }, [pile, layers.layer]);

  const nameOfCard = (id: number | undefined) => info(id)?.name;
  const refNameOf = (seat: number, ref: string) => { const card = state.seats[seat]?.twin.find(item => item.ref === ref); return card?.faceUp ? card.name ?? info(cardCode(card))?.name : undefined; };
  const entries: LogEntry[] = [...room.events].sort((a, b) => b.seq - a.seq).flatMap(event => {
    const line = describeEvent(event, name, nameOfCard, refNameOf);
    return line ? [{ id: event.id, time: fmtTime(event.at), kind: line.kind, text: line.text, fresh: false }] : [];
  });
  const nextSeat = (() => { if (turnSeat < 0) return -1; for (let i = 1; i <= seatCount; i++) { const seat = (turnSeat + i) % seatCount; if (!state.seats[seat]?.eliminated) return seat; } return turnSeat; })();
  const players = seatIds.map(seat => ({ seat, name: name(seat), color: COLORS[seat], eliminated: !!state.seats[seat]?.eliminated }));
  const startingLp = room.format?.settings.startingLP ?? 8000;
  const formatLabel = REMOTE_FORMATS.find(item => item.value === (room.format ?? normalizeRemoteFormat()).id)?.label ?? "";
  const note = ended ? `This table has ended.${state.winnerSeat !== null && state.winnerSeat !== undefined ? ` ${name(state.winnerSeat)} won.` : ""}`
    : match.phase === "siding" ? "The players are side decking." : match.phase === "result" ? "This game is over. The next game starts soon." : snapshot.error || null;

  return <div className={`${duelFontClasses} ${s.app} ${v.app}`} data-mode={seatCount === 2 ? "1v1" : String(seatCount)} data-wc="1" data-testid="spectator-table" data-status={room.status}>
    <div className={s.shell}>
      <header className={s.top}>
        <a className={s.logo} href="/duels" aria-label="Stop watching and return to the Duels page" onClick={() => void stopWatching(room.slug)}><span className={s.gem} /><b>Dueling Domain</b></a>
        <span className={`${s.crumb} ${v.hideNarrow}`}><b>Remote Duel</b> · Table {room.slug.slice(0, 8)}</span>
        <span className={v.badge} data-testid="spectator-badge">Spectator</span>
        <span className={`${s.cchip} ${v.hideNarrow}`}>{formatLabel} · {seatCount} players</span>
        <span className={v.watching} data-testid="spectator-count">{room.spectatorCount ?? 0} watching</span>
        <span className={s.sp} />
        <button type="button" className={s.tb} aria-haspopup="dialog" aria-expanded={layers.layer === "log"} data-layer-opener data-testid="log-button" onClick={event => layers.toggle("log", event.currentTarget)}><Icon name="log" /><span className={s.lbl}>Log</span></button>
        <a className={`${s.tb} ${v.leave}`} href="/duels" data-testid="spectator-leave" onClick={() => void stopWatching(room.slug)}>Stop watching</a>
      </header>
      <main className={s.stage} id="stage" tabIndex={-1} aria-label="Duel table">
        {note ? <p className={v.note} role="status" data-testid="spectator-note">{note}{!ended && snapshot.error && !online
          ? <button type="button" className={v.retry} data-testid="spectator-video-retry" onClick={() => video?.retry()}>Try again</button> : null}</p> : null}
        <LpStrip players={players} turnSeat={turnSeat} lp={lp} onJump={seat => document.querySelector(`[data-testid="seat-${seat}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" })} />
        {seatIds.map(seat => {
          const twin = state.seats[seat]?.twin ?? [];
          const field = twin.filter(card => ["monster", "extra-monster", "spell-trap", "field", "pendulum"].includes(card.zone));
          const shown = field.filter(card => card.faceUp !== false && cardCode(card)); const hiddenCount = field.filter(card => card.faceUp === false).length;
          const gy = twin.filter(card => card.zone === "graveyard").length, banished = twin.filter(card => card.zone === "banished").length;
          return <section key={seat} className={[s.seat, s[`s${seat}`], seat === turnSeat ? s.turn : "", state.seats[seat]?.eliminated ? s.out : ""].filter(Boolean).join(" ")} aria-label={`${name(seat)}'s seat`}
            style={{ "--c": COLORS[seat] } as CSSProperties} data-testid={`seat-${seat}`} data-turn={seat === turnSeat || undefined} data-view="camera" data-wc="1">
            <header className={s.sh}>
              <span className={s.pip} /><h2 className={s.nm} style={{ margin: 0 }}>{name(seat)}</h2>
              <span className={s.wcpiles} role="group" aria-label="Piles" data-testid={`wc-piles-${seat}`}>
                <button type="button" aria-label={`${name(seat)} Graveyard: ${gy} cards. Open`} onClick={event => { setPile({ seat, zone: "graveyard" }); layers.open("pile", event.currentTarget); }}>GY <b className={s.num}>{gy}</b></button>
                <button type="button" aria-label={`${name(seat)} Banished: ${banished} cards. Open`} onClick={event => { setPile({ seat, zone: "banished" }); layers.open("pile", event.currentTarget); }}>BAN <b className={s.num}>{banished}</b></button>
              </span>
              <span className={`${s.tag} ${s.turnt}`}>TURN</span><span className={`${s.tag} ${s.nextt}`}>NEXT</span>
              {state.seats[seat]?.eliminated ? <span className={s.tag}>OUT</span> : null}
            </header>
            <div className={s.sbody}>
              {video ? <SpectatorFeed seat={seat} name={name(seat)} video={video} online={online} stopped={!!snapshot.error} frozen={onFrozen} onCard={onFeed} /> : <div className={s.feedcol}><div className={s.cams} data-testid={`feed-${seat}`}><div className={s.nofeed}><span>Table video is off.</span></div></div></div>}
              <div className={`${s.fside} ${v.side}`}>
                <HandStrip seat={seat} name={name(seat)} hand={{ cards: knownHandOf(state, seat), count: handCountOf(state, seat), tray: true, onInspect: card => showKnown(seat, card) }} />
                <div className={v.stats}><span data-testid={`lp-${seat}`}>LP <b data-testid={`lp-value-${seat}`} aria-label={`${name(seat)}: ${lp(seat)} of ${startingLp} life points`}>{lp(seat)}</b></span></div>
                <ul className={v.cards} aria-label={`${name(seat)}'s public cards`} data-testid={`public-cards-${seat}`}>
                  {shown.map(card => <li key={card.ref}><button type="button" onClick={event => { const box = event.currentTarget.getBoundingClientRect(); show(seat, card, { left: box.left, right: box.right, top: box.top, bottom: box.bottom }, null); }}>{cardName(card, info(cardCode(card)))}</button></li>)}
                  {hiddenCount ? <li className={v.set} data-testid={`set-count-${seat}`}>{hiddenCount} Set</li> : null}
                </ul>
              </div>
            </div>
          </section>;
        })}
      </main>
      <Rail players={players} turnSeat={turnSeat} turn={state.turn} phase={state.phase} canAct={false} nextSeat={nextSeat} passHot={false} mine={false} onPhase={() => undefined} onPhaseBack={() => undefined} onPass={() => undefined} turnIn={false} backTo={previousYgoPhase(state)} />
    </div>
    <LogDrawer voiceFilter={false} open={layers.layer === "log"} entries={entries} onClose={() => layers.close("log")} rules={[`Format: ${formatLabel}`, `Starting LP: ${startingLp}`, "You are a spectator. You see public information only."]}
      seats={players.map(player => ({ seat: player.seat, name: player.name, color: player.color, turn: player.seat === turnSeat, lp: lp(player.seat), note: player.seat === turnSeat ? "Turn" : player.seat === nextSeat ? "Next" : "" }))} />
    {opening ? <OpeningRollScreen opening={opening} mySeat={-1} name={name} now={serverNow} out={state.seats.map(seat => !!seat.eliminated)} /> : null}
    {pile && state.seats[pile.seat] ? <PileViewer fieldHidden seat={pile.seat} name={name(pile.seat)} mine={false} twin={state.seats[pile.seat].twin} zone={pile.zone} onZone={zone => setPile({ seat: pile.seat, zone })} info={info} onOpenCard={(card, anchor) => show(pile.seat, card, anchor, null)} onClose={() => layers.close()} /> : null}
    {layers.layer === "card" && subject ? <CardPopover subject={subject} info={info(subject.cardId)} at={popAt} actions={NO_ACTIONS} onClose={() => layers.close("card")} /> : null}
  </div>;
}
