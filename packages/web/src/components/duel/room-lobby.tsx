"use client";

import { useState } from "react";
import Link from "next/link";
import { Bot, CheckCircle2, CircleDashed, Lock, Globe, Swords, UserPlus, type LucideIcon } from "lucide-react";
import { isCustomDomain, type DuelDeck, type DuelRoom, type DuelSeat } from "@yugidraft/shared/duels";
import { DeckCardPreview } from "./deck-card-preview";
import { DeckEditor } from "./deck-editor";
import { formatLabel as tableFormatLabel, formatSeatCount, seatGroups, tagSeatCode } from "./table-format";
import { DuelSettingsSummary, RoomInvite } from "./room-settings";
import { cx, SheetButton, sheetButtonClass, sheetPage } from "./sheet-ui";
import ui from "./sheet-ui.module.css";
import styles from "./room-lobby.module.css";

function SeatCard({
  index, taken, mine, code, onAddBot, botBusy,
}: {
  index: number;
  taken: DuelSeat | undefined;
  mine: boolean;
  code: string | null;
  /** Set only when the viewer may fill this empty seat with a practice bot. */
  onAddBot?: (seat: number) => void;
  botBusy: boolean;
}) {
  const seatLabel = `Seat ${index + 1}${code ? ` · ${code}` : ""}`;
  if (!taken) {
    return (
      <li className={cx(styles.seat, styles.seatOpen)}>
        <span className={styles.avatar} aria-hidden><UserPlus size={17} strokeWidth={1.5} /></span>
        <span className={styles.seatText}>
          <span className={styles.seatName}>Open seat</span>
          <span className={styles.seatMeta}>{seatLabel}</span>
        </span>
        <span className={styles.seatActions}>
          <span className={styles.status}><CircleDashed size={15} strokeWidth={1.6} aria-hidden />Waiting</span>
          {onAddBot ? (
            <SheetButton size="sm" kind="quiet" disabled={botBusy} onClick={() => onAddBot(index)} aria-label={`Add bot to seat ${index + 1}`}>
              <Bot size={14} strokeWidth={1.6} aria-hidden />Add bot
            </SheetButton>
          ) : null}
        </span>
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
          {seatLabel}{mine ? " · You" : taken.isBot ? " · Practice bot" : ""}
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
  /** `seat` is the 0-based empty seat the organizer picked. */
  onAddBot: (seat?: number) => void;
  onReady: (deck: DuelDeck) => void;
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
  const seatCount = formatSeatCount(session.format);
  const canStart = isOrganizer && occupied === seatCount && readyCount === seatCount && session.status === "lobby";
  const canAddBot = isOrganizer && occupied >= 1 && occupied < seatCount && session.status === "lobby";
  const groups = seatGroups(session.format);
  const everyoneWord = seatCount === 2 ? "Both seats" : `All ${seatCount} seats`;

  const formatLabel = session.mode === "domain"
    ? isCustomDomain(session.masterRule, session.settings) ? "Custom Domain" : (session.format && session.format !== "1v1" ? "Domain · singleton" : "Domain 1v1 · singleton")
    : `Master Rule ${session.masterRule}`;
  const isPrivate = session.settings.visibility === "private";
  const showPreview = mySeat != null;

  return (
    <div className={cx(sheetPage, styles.page)}>
      <div className={cx(styles.wrap, showPreview && styles.wrapWide)}>
        <header className={styles.head}>
          <div className={styles.titleBlock}>
            <h1 className={ui.title}>{session.name}</h1>
            <p className={styles.chips}>
              <span className={cx(ui.chip, ui.chipAccent)}>{tableFormatLabel(session.format)}</span>
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

        <div className={cx(styles.layout, showPreview && styles.layoutPreview)}>
          {showPreview ? (
            <aside className={cx(styles.panel, styles.preview)} aria-label="Card preview">
              <DeckCardPreview code={previewCode} />
            </aside>
          ) : null}
          <div className={styles.main}>
            <section className={styles.panel} aria-label="Seats">
              {groups.map((group) => (
                <div key={group.title ?? "seats"} className={styles.group} data-team={group.title ? "true" : undefined}>
                  {group.title ? <h2 className={styles.groupTitle}>{group.title}</h2> : null}
                  <ul className={styles.seats} data-count={group.seats.length}>
                    {group.seats.map((seat) => (
                      <SeatCard
                        key={seat}
                        index={seat}
                        taken={session.seats.find((item) => item.seat === seat)}
                        mine={seat === mySeat}
                        code={tagSeatCode(session.format, seat)}
                        onAddBot={canAddBot ? onAddBot : undefined}
                        botBusy={busy}
                      />
                    ))}
                  </ul>
                </div>
              ))}
              {mySeat != null ? (
                <p className={styles.help} role="status">
                  {myMeta?.ready
                    ? `Your deck is ready. ${everyoneWord} must be ready before the organizer starts.`
                    : "Import your deck, then click Ready with this deck. Deck needed means no valid deck has been submitted yet."}
                </p>
              ) : null}
              {actionError ? <p role="alert" className={ui.alert}>{actionError}</p> : null}
              <div className={styles.footer}>
                {mySeat == null ? (
                  <SheetButton kind="primary" size="lg" loading={busy} disabled={busy || occupied >= seatCount} onClick={onJoin}>
                    Join table
                  </SheetButton>
                ) : canStart ? (
                  <SheetButton kind="primary" size="lg" loading={busy} disabled={busy} onClick={onStart}>
                    Start duel<Swords size={17} strokeWidth={1.6} aria-hidden />
                  </SheetButton>
                ) : isOrganizer ? (
                  <p className={styles.startHint}>Start unlocks when {seatCount === 2 ? "both seats are" : `all ${seatCount} seats are`} ready.</p>
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
                  onPreviewCard={setPreviewCode}
                />
              </section>
            ) : null}
          </div>

          <aside className={styles.aside}>
            <section className={styles.panel}>
              <DuelSettingsSummary session={session} />
            </section>
            {canAddBot ? (
              <section className={cx(styles.panel, styles.bot)} aria-label="Practice bot">
                <h2 className={ui.sectionTitle}>Practice bot</h2>
                <p className={ui.hint}>
                  Fill an empty seat with a basic bot and a supplied {session.mode === "domain" ? "Domain" : "40-card"} deck.
                  It makes legal moves automatically; it is not a competitive AI.
                </p>
                <SheetButton loading={busy} disabled={busy} onClick={() => onAddBot()}>
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
