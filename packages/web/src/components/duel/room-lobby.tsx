"use client";

import { useState } from "react";
import Link from "next/link";
import { Bot, CheckCircle2, CircleDashed, Lock, Globe, Swords, UserPlus, X, type LucideIcon } from "lucide-react";
import { isCustomDomain, type DuelDeck, type DuelRoom, type DuelSeat } from "@yugidraft/shared/duels";
import { DeckCardPreview } from "./deck-card-preview";
import { DeckEditor } from "./deck-editor";
import { shouldCheckDeck, startButtonLabel } from "./start-flow";
import { SeriesBadges } from "./series-banner";
import { deckCounts } from "./side-deck-model";
import { DuelSettingsSummary, RoomInvite } from "./room-settings";
import { practiceBotNote } from "./series-model";
import { cx, SheetButton, sheetButtonClass, sheetPage } from "./sheet-ui";
import ui from "./sheet-ui.module.css";
import styles from "./room-lobby.module.css";
import seriesStyles from "./series.module.css";

function SeatCard({ index, taken, mine, waitLabel, onTakeSeat, onRemoveBot, removeBusy }: {
  index: number;
  taken: DuelSeat | undefined;
  mine: boolean;
  waitLabel: string;
  onTakeSeat?: (seat: number) => void;
  /** Set only for the organizer of a lobby table: shows the quiet remove control on the bot's seat. */
  onRemoveBot?: () => void;
  removeBusy?: boolean;
}) {
  if (!taken) {
    return (
      <li className={cx(styles.seat, styles.seatOpen)}>
        <span className={styles.avatar} aria-hidden><UserPlus size={17} strokeWidth={1.5} /></span>
        <span className={styles.seatText}>
          <span className={styles.seatName}>Open seat</span>
          <span className={styles.seatMeta}>Seat {index + 1}</span>
        </span>
        {onTakeSeat ? (
          <SheetButton className={styles.seatAction} kind="primary" size="sm" disabled={removeBusy} onClick={() => onTakeSeat(index)}>
            Take seat {index + 1}
          </SheetButton>
        ) : (
          <span className={styles.status}><CircleDashed size={15} strokeWidth={1.6} aria-hidden />Waiting</span>
        )}
      </li>
    );
  }
  const Icon: LucideIcon = taken.ready ? CheckCircle2 : CircleDashed;
  return (
    <li className={styles.seat} data-ready={taken.ready ? "true" : "false"} data-mine={mine ? "true" : undefined}>
      <span className={styles.avatar} aria-hidden>
        {taken.isBot ? <Bot size={18} strokeWidth={1.5} /> : (taken.displayName.trim()[0] ?? "?").toUpperCase()}
      </span>
      <span className={styles.seatText}>
        <span className={styles.seatName}>{taken.displayName}</span>
        <span className={styles.seatMeta}>
          Seat {index + 1}{mine ? " · You" : taken.isBot ? " · Practice bot" : ""}
        </span>
      </span>
      <span className={cx(styles.status, taken.ready && styles.statusReady)}>
        <Icon size={15} strokeWidth={1.7} aria-hidden />
        {taken.ready ? "Ready" : waitLabel}
      </span>
      {taken.isBot && onRemoveBot ? (
        <button type="button" className={styles.seatRemove} onClick={onRemoveBot} disabled={removeBusy}
          aria-label="Remove practice bot" title="Remove practice bot">
          <X size={15} strokeWidth={1.7} aria-hidden />
        </button>
      ) : null}
    </li>
  );
}

/** The table before the duel starts: seats, settings, practice bot, deck import and start. */
export function RoomLobby({
  room,
  slug,
  busy,
  starting = false,
  actionError,
  onDeckLocked,
  onTakeSeat,
  onAddBot,
  onRemoveBot,
  onReady,
  onMarkReady,
  onStart,
  onCancel,
  onLeave,
}: {
  room: DuelRoom;
  slug: string;
  busy: boolean;
  /** Start duel was clicked and the server has not answered yet. */
  starting?: boolean;
  actionError: string | null;
  /** A deck check was refused because the duel already started: refresh the room. */
  onDeckLocked?: () => void;
  onTakeSeat: (seat: number) => void;
  onAddBot: () => void;
  /** Organizer only: takes the practice bot out of its seat so a human can join. */
  onRemoveBot: () => void;
  onReady: (deck: DuelDeck) => void;
  /** Tournament games: ready up with the registered deck. */
  onMarkReady?: () => void;
  onStart: () => void;
  onCancel: () => void;
  onLeave: () => void;
}) {
  const session = room.session;
  const mySeat = room.mySeat;
  const [previewCode, setPreviewCode] = useState<number | null>(null);
  const occupied = session.seats.length;
  const readyCount = session.seats.filter((seat) => seat.ready).length;
  const myMeta = mySeat != null ? session.seats.find((seat) => seat.seat === mySeat) : undefined;
  const isOrganizer = myMeta?.playerId === session.organizerPlayerId;

  const formatLabel = session.mode === "domain"
    ? isCustomDomain(session.masterRule, session.settings) ? "Custom Domain" : "Domain 1v1 · singleton"
    : `Master Rule ${session.masterRule}`;
  const isPrivate = session.settings.visibility === "private";
  const series = room.series;
  const seatsLocked = session.status !== "lobby" || starting || room.opening != null || session.seriesId != null || series != null;
  const tournamentGame = series != null && series.tournamentId != null;
  const lockedDeck = tournamentGame && mySeat != null;
  // A series game starts by itself once both players are ready, so the organizer has no Start button.
  const autoStart = series != null;
  const showPreview = mySeat != null && !lockedDeck;
  const seriesCancel = series != null && mySeat != null && occupied >= 2;
  const showBotPanel = isOrganizer && occupied < 2 && !seatsLocked;
  // A Best of 3 against the bot is a full match, and a Best of 1 is one game. Neither counts, ranked or not.
  const botNote = series == null && (session.bestOf === 3 || session.ranked === true) && (showBotPanel || session.seats.some((seat) => seat.isBot))
    ? <p className={ui.hint} data-testid="practice-bot-note">{practiceBotNote(session.bestOf === 3 ? 3 : 1)}</p>
    : null;
  const canStart = !autoStart && isOrganizer && occupied >= 2 && readyCount >= 2 && session.status === "lobby";

  return (
    <div className={cx(sheetPage, styles.page)}>
      <div className={cx(styles.wrap, showPreview && styles.wrapWide)}>
        <header className={styles.head}>
          <div className={styles.titleBlock}>
            <h1 className={ui.title}>{session.name}</h1>
            <p className={styles.chips}>
              <span className={cx(ui.chip, ui.chipAccent)}>{formatLabel}</span>
              <span className={ui.chip}>Lobby</span>
              {series ? <SeriesBadges series={series} showGame /> : null}
              <span className={ui.chip}>
                {isPrivate ? <Lock size={13} strokeWidth={1.6} aria-hidden /> : <Globe size={13} strokeWidth={1.6} aria-hidden />}
                {isPrivate ? "Private" : "Public"}
              </span>
            </p>
          </div>
          <div className={styles.headActions}>
            <RoomInvite room={room} slug={slug} />
            <Link href="/duels" className={sheetButtonClass("quiet", "sm")}>All tables</Link>
          </div>
        </header>

        <div className={cx(styles.layout, showPreview && styles.layoutPreview)}>
          {showPreview ? (
            <aside className={cx(styles.panel, styles.preview)} aria-label="Card preview">
              <DeckCardPreview code={previewCode} />
            </aside>
          ) : null}
          <div className={styles.main}>
            <section className={styles.panel} aria-label="Seats">
              <ul className={styles.seats}>
                {[0, 1].map((seat) => (
                  <SeatCard key={seat} index={seat} taken={session.seats.find((item) => item.seat === seat)} mine={seat === mySeat} waitLabel={tournamentGame ? "Not ready" : "Deck needed"}
                    onTakeSeat={mySeat == null && !seatsLocked ? onTakeSeat : undefined}
                    onRemoveBot={isOrganizer && !seatsLocked ? onRemoveBot : undefined} removeBusy={busy} />
                ))}
              </ul>
              {mySeat != null ? (
                <p className={styles.help} role="status">
                  {tournamentGame
                    ? myMeta?.ready
                      ? "You are ready. The game starts when both players are ready."
                      : "Your registered deck is locked for this tournament. Click Ready when you can play."
                    : myMeta?.ready
                      ? autoStart ? "Your deck is ready. The game starts when both players are ready." : "Your deck is ready. Both seats must be ready before the organizer starts."
                      : "Import your deck, then click Ready with this deck. Deck needed means no valid deck has been submitted yet."}
                </p>
              ) : (
                <p className={styles.help} role="status">
                  {series || session.seriesId != null ? "You are watching this match. Seats are fixed."
                    : seatsLocked ? "You are watching. Seats are locked because the duel is starting."
                    : occupied >= 2 ? "This table is full. You are watching."
                    : "You are watching. Take an open seat to play, then choose your deck."}
                </p>
              )}
              {actionError ? <p role="alert" className={ui.alert}>{actionError}</p> : null}
              <div className={styles.footer}>
                {mySeat != null && canStart ? (
                  <SheetButton kind="primary" size="lg" loading={busy} disabled={busy} onClick={onStart}>
                    {startButtonLabel(starting)}{starting ? null : <Swords size={17} strokeWidth={1.6} aria-hidden />}
                  </SheetButton>
                ) : lockedDeck ? (
                  <SheetButton kind="primary" size="lg" loading={busy} disabled={busy || myMeta?.ready || !onMarkReady} onClick={onMarkReady}>
                    Ready<CheckCircle2 size={17} strokeWidth={1.6} aria-hidden />
                  </SheetButton>
                ) : autoStart && mySeat != null ? (
                  <p className={styles.startHint}>Starts when both players are ready</p>
                ) : isOrganizer ? (
                  <p className={styles.startHint}>Start unlocks when both seats are ready.</p>
                ) : null}
                {seriesCancel ? (
                  <SheetButton kind="quiet" disabled={busy} onClick={onCancel}>Cancel series</SheetButton>
                ) : isOrganizer ? (
                  <SheetButton kind="quiet" disabled={busy} onClick={onCancel}>Cancel table</SheetButton>
                ) : mySeat != null && !seatsLocked ? (
                  <SheetButton kind="quiet" disabled={busy} onClick={onLeave}>Watch instead</SheetButton>
                ) : null}
              </div>
            </section>

            {lockedDeck ? (
              <section className={cx(styles.panel, seriesStyles.lockedDeck)} aria-label="Registered deck">
                <h2 className={ui.sectionTitle}>Registered deck (locked)</h2>
                {room.myDeck ? (
                  <dl className={seriesStyles.lockedCounts}>
                    {(["main", "extra", "side"] as const).map((key) => (
                      <div key={key}><dt style={{ display: "inline" }}>{key[0].toUpperCase() + key.slice(1)}</dt><dd style={{ display: "inline" }}><b>{deckCounts(room.myDeck!)[key]}</b></dd></div>
                    ))}
                  </dl>
                ) : (
                  <p className={ui.hint}>Your registered deck loads when the game opens.</p>
                )}
                <p className={ui.hint}>The deck you registered for this tournament is used for every game. You cannot change it here.</p>
              </section>
            ) : mySeat != null ? (
              <section className={cx(styles.panel, styles.deckPanel)} aria-label="Deck import">
                <DeckEditor
                  slug={slug}
                  mode={session.mode}
                  settings={session.settings}
                  initial={room.myDeck}
                  busy={busy}
                  locked={starting || !shouldCheckDeck(session.status)}
                  onLocked={onDeckLocked}
                  onReady={onReady}
                  onPreviewCard={setPreviewCode}
                />
              </section>
            ) : null}
          </div>

          <aside className={styles.aside}>
            <section className={styles.panel}>
              <DuelSettingsSummary session={session} />
            </section>
            {showBotPanel ? (
              <section className={cx(styles.panel, styles.bot)} aria-label="Practice bot">
                <h2 className={ui.sectionTitle}>Practice bot</h2>
                <p className={ui.hint}>
                  Play solo against a basic bot with a supplied {session.mode === "domain" ? "Domain" : "40-card"} deck.
                  It makes legal moves automatically; it is not a competitive AI.
                </p>
                <SheetButton loading={busy} disabled={busy} onClick={onAddBot}>
                  <Bot size={16} strokeWidth={1.6} aria-hidden />Add practice bot
                </SheetButton>
                {botNote}
              </section>
            ) : botNote ? (
              <section className={styles.panel}>{botNote}</section>
            ) : null}
          </aside>
        </div>
      </div>
    </div>
  );
}
