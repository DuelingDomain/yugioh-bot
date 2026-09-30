"use client";

import { useEffect, useState } from "react";
import { DUEL_BANLIST_OPTIONS, isCustomDomain, type DuelClock, type DuelRoom, type DuelSession } from "@yugidraft/shared/duels";
import { Check, Link2 } from "lucide-react";
import { SheetButton } from "./sheet-ui";
import styles from "./room.module.css";
import own from "./room-settings.module.css";

export function DuelSettingsSummary({ session }: { session: DuelSession }) {
  const { settings } = session;
  const values = [
    ["Format", session.mode === "domain" ? isCustomDomain(session.masterRule, settings) ? "Custom Domain" : "Domain 1v1" : "Standard 1v1"],
    ["Visibility", settings.visibility === "private" ? "Invite only" : "Discord server members"],
    ["Engine", `Automatic · Master Rule ${session.masterRule}`],
    ["Banlist", DUEL_BANLIST_OPTIONS.find((option) => option.id === settings.banlist)?.label ?? settings.banlist],
    ["Card pool", settings.cardPool === "both" ? "TCG + OCG" : settings.cardPool.toUpperCase()],
    ["Turn timer", settings.turnSeconds === 0 ? "Unlimited" : `${settings.turnSeconds} seconds per player`],
    ["Starting LP", settings.startingLP.toLocaleString("en-US")],
    ["Starting hand", `${settings.startingHand} ${settings.startingHand === 1 ? "card" : "cards"}`],
    ["Draw Phase", `${settings.drawPerTurn} ${settings.drawPerTurn === 1 ? "card" : "cards"}`],
    ["Timeout", settings.turnSeconds === 0 ? "No timer" : settings.timeout === "loss" ? "Lose on timeout" : "Continue at zero"],
    ["Deck validation", settings.validateDeck ? "Valid decks only" : "Format checks off; engine safety enforced"],
    ["Opening order", settings.shuffleDeck ? "Shuffled" : "Imported order"],
  ];
  return (
    <section aria-label="Game settings" className={own.settings}>
      <div className={own.settingsHead}>
        <h2 className={own.settingsTitle}>Game settings</h2>
      </div>
      <dl className={own.grid}>
        {values.map(([label, value]) => (
          <div key={label} className={own.row}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className={own.note}>Settings are locked and retained in match history.</p>
    </section>
  );
}

export function RoomInvite({ room, slug }: { room: DuelRoom; slug: string }) {
  const [copied, setCopied] = useState(false);
  const [manualLink, setManualLink] = useState<string | null>(null);
  if (room.session.settings.visibility === "private" && !room.inviteCode) return null;
  return (
    <div className={own.invite}>
      <SheetButton size="sm" onClick={async () => {
        const url = new URL(`/duels/${encodeURIComponent(slug)}`, window.location.origin);
        if (room.inviteCode) url.searchParams.set("invite", room.inviteCode);
        try {
          await navigator.clipboard.writeText(url.href);
          setCopied(true);
          setManualLink(null);
        } catch {
          setCopied(false);
          setManualLink(url.href);
        }
      }}>
        {copied ? <Check size={15} strokeWidth={1.7} aria-hidden /> : <Link2 size={15} strokeWidth={1.7} aria-hidden />}
        {copied ? "Invite copied" : "Copy invite"}
      </SheetButton>
      {manualLink ? (
        <label className={own.manual}>
          Clipboard unavailable. Copy this invite:
          <input readOnly value={manualLink} onFocus={(event) => event.currentTarget.select()} />
        </label>
      ) : null}
    </div>
  );
}

// The parent keys this sampler by serverNow so each authoritative snapshot resets elapsed time.
export function DuelClockDisplay({ clock, session }: { clock: DuelClock; session: DuelSession }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (clock.activeSeat == null || clock.startedAt == null) return;
    const receivedAt = performance.now();
    const timer = window.setInterval(() => setElapsed(performance.now() - receivedAt), 250);
    return () => window.clearInterval(timer);
  }, [clock.activeSeat, clock.startedAt]);
  return (
    <div className={styles.clock} role="timer" aria-label="Decision clocks" aria-live="off">
      {clock.remainingMs.map((remaining, seat) => {
        const active = clock.activeSeat === seat && clock.startedAt != null;
        const seconds = Math.ceil(Math.max(0, remaining - (active ? Math.max(0, clock.serverNow + elapsed - clock.startedAt!) : 0)) / 1000);
        const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
        const name = session.seats.find((player) => player.seat === seat)?.displayName ?? `Player ${seat + 1}`;
        return <span key={seat} data-active={active} title={`${name}${active ? " · answering" : ""}`} aria-label={`${name}: ${time}`}>
          <small>{name}</small> <span className={styles.clockTime}>{time}</span>
        </span>;
      })}
    </div>
  );
}
