"use client";

import Link from "next/link";
import { Bot, CheckCircle2, CircleDashed, Lock, Globe, Swords, UserPlus, type LucideIcon } from "lucide-react";
import { isCustomDomain, type DuelDeck, type DuelRoom, type DuelSeat } from "@yugidraft/shared/duels";
import { DeckEditor } from "./deck-editor";
import { DuelSettingsSummary, RoomInvite } from "./room-settings";
import { cx, SheetButton, sheetButtonClass, sheetPage } from "./sheet-ui";
import ui from "./sheet-ui.module.css";
import styles from "./room-lobby.module.css";

function SeatCard({ index, taken, mine }: { index: number; taken: DuelSeat | undefined; mine: boolean }) {
  if (!taken) {
    return (
      <li className={cx(styles.seat, styles.seatOpen)}>
        <span className={styles.avatar} aria-hidden><UserPlus size={17} strokeWidth={1.5} /></span>
        <span className={styles.seatText}>
          <span className={styles.seatName}>Open seat</span>
          <span className={styles.seatMeta}>Seat {index + 1}</span>
        </span>
        <span className={styles.status}><CircleDashed size={15} strokeWidth={1.6} aria-hidden />Waiting</span>
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
        {taken.ready ? "Ready" : "Deck needed"}
      </span>
    </li>
  );
}

/** The table before the duel starts: seats, settings, practice bot, deck import and start. */
export function RoomLobby({
  room,
  slug,
  busy,
  actionError,
  onJoin,
  onAddBot,
  onReady,
  onStart,
  onCancel,
  onLeave,
}: {
  room: DuelRoom;
  slug: string;
  busy: boolean;
  actionError: string | null;
  onJoin: () => void;
  onAddBot: () => void;
  onReady: (deck: DuelDeck) => void;
  onStart: () => void;
  onCancel: () => void;
  onLeave: () => void;
}) {
  const session = room.session;
  const mySeat = room.mySeat;
  const occupied = session.seats.length;
  const readyCount = session.seats.filter((seat) => seat.ready).length;
  const myMeta = mySeat != null ? session.seats.find((seat) => seat.seat === mySeat) : undefined;
  const isOrganizer = myMeta?.playerId === session.organizerPlayerId;
  const canStart = isOrganizer && occupied >= 2 && readyCount >= 2 && session.status === "lobby";

  const formatLabel = session.mode === "domain"
    ? isCustomDomain(session.masterRule, session.settings) ? "Custom Domain" : "Domain 1v1 · singleton"
    : `Master Rule ${session.masterRule}`;
  const isPrivate = session.settings.visibility === "private";

  return (
    <div className={cx(sheetPage, styles.page)}>
      <div className={styles.wrap}>
        <header className={styles.head}>
          <div className={styles.titleBlock}>
            <h1 className={ui.title}>{session.name}</h1>
            <p className={styles.chips}>
              <span className={cx(ui.chip, ui.chipAccent)}>{formatLabel}</span>
              <span className={ui.chip}>Lobby</span>
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

        <div className={styles.layout}>
          <div className={styles.main}>
            <section className={styles.panel} aria-label="Seats">
              <ul className={styles.seats}>
                {[0, 1].map((seat) => (
                  <SeatCard key={seat} index={seat} taken={session.seats.find((item) => item.seat === seat)} mine={seat === mySeat} />
                ))}
              </ul>
              {mySeat != null ? (
                <p className={styles.help} role="status">
                  {myMeta?.ready
                    ? "Your deck is ready. Both seats must be ready before the organizer starts."
                    : "Import your deck, then click Ready with this deck. Deck needed means no valid deck has been submitted yet."}
                </p>
              ) : null}
              {actionError ? <p role="alert" className={ui.alert}>{actionError}</p> : null}
              <div className={styles.footer}>
                {mySeat == null ? (
                  <SheetButton kind="primary" size="lg" loading={busy} disabled={busy || occupied >= 2} onClick={onJoin}>
                    Join table
                  </SheetButton>
                ) : canStart ? (
                  <SheetButton kind="primary" size="lg" loading={busy} disabled={busy} onClick={onStart}>
                    Start duel<Swords size={17} strokeWidth={1.6} aria-hidden />
                  </SheetButton>
                ) : isOrganizer ? (
                  <p className={styles.startHint}>Start unlocks when both seats are ready.</p>
                ) : null}
                {isOrganizer ? (
                  <SheetButton kind="quiet" disabled={busy} onClick={onCancel}>Cancel table</SheetButton>
                ) : mySeat != null ? (
                  <SheetButton kind="quiet" disabled={busy} onClick={onLeave}>Leave table</SheetButton>
                ) : null}
              </div>
            </section>

            {mySeat != null ? (
              <section className={cx(styles.panel, styles.deckPanel)} aria-label="Deck import">
                <DeckEditor
                  slug={slug}
                  mode={session.mode}
                  settings={session.settings}
                  initial={room.myDeck}
                  busy={busy}
                  onReady={onReady}
                />
              </section>
            ) : null}
          </div>

          <aside className={styles.aside}>
            <section className={styles.panel}>
              <DuelSettingsSummary session={session} />
            </section>
            {isOrganizer && occupied < 2 ? (
              <section className={cx(styles.panel, styles.bot)} aria-label="Practice bot">
                <h2 className={ui.sectionTitle}>Practice bot</h2>
                <p className={ui.hint}>
                  Play solo against a basic bot with a supplied {session.mode === "domain" ? "Domain" : "40-card"} deck.
                  It makes legal moves automatically; it is not a competitive AI.
                </p>
                <SheetButton loading={busy} disabled={busy} onClick={onAddBot}>
                  <Bot size={16} strokeWidth={1.6} aria-hidden />Add practice bot
                </SheetButton>
              </section>
            ) : null}
          </aside>
        </div>
      </div>
    </div>
  );
}
