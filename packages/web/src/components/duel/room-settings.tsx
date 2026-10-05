"use client";

import { useEffect, useId, useState } from "react";
import { DUEL_BANLIST_OPTIONS, duelClockRulesText, isCustomDomain, startingLpFor, type DuelClock, type DuelRoom, type DuelSession } from "@yugidraft/shared/duels";
import { Check, Link2 } from "lucide-react";
import { SheetButton } from "./sheet-ui";
import { formatLabel } from "./table-format";
import styles from "./room.module.css";
import own from "./room-settings.module.css";
import clockStyles from "./room-clock.module.css";

export function DuelSettingsSummary({ session }: { session: DuelSession }) {
  const { settings } = session;
  const values = [
    ["Format", `${session.mode === "domain" ? (isCustomDomain(session.masterRule, settings) ? "Custom Domain" : "Domain") : "Standard"} · ${formatLabel(session.format)}`],
    ["Visibility", settings.visibility === "private" ? "Invite only" : "Discord server members"],
    ["Engine", `Automatic · Master Rule ${session.masterRule}`],
    ["Banlist", DUEL_BANLIST_OPTIONS.find((option) => option.id === settings.banlist)?.label ?? settings.banlist],
    ["Card pool", settings.cardPool === "both" ? "TCG + OCG" : settings.cardPool.toUpperCase()],
    ["Turn timer", settings.turnSeconds === 0 ? "Unlimited" : duelClockRulesText(settings.turnSeconds)],
    [session.format === "tag" ? "Team LP (shared)" : "Starting LP", startingLpFor(session.format ?? "1v1", settings).toLocaleString("en-US")],
    ["Starting hand", `${settings.startingHand} ${settings.startingHand === 1 ? "card" : "cards"}`],
    ["Draw Phase", `${settings.drawPerTurn} ${settings.drawPerTurn === 1 ? "card" : "cards"}`],
    ["Timeout", settings.turnSeconds === 0 ? "None, nobody loses on time" : settings.timeout === "loss" ? "Lose on timeout" : "Continue at zero"],
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

/** Sound on/off plus a master volume slider (native range input: arrow keys, Home/End, PageUp/PageDown). */
export function DuelSoundControls({ enabled, volume, onEnabledChange, onVolumeChange }: {
  enabled: boolean;
  volume: number;
  onEnabledChange: (enabled: boolean) => void;
  onVolumeChange: (volume: number) => void;
}) {
  const sliderId = useId();
  const percent = Math.round(volume * 100);
  return (
    <div className={own.sound}>
      <label className={own.soundToggle}>
        <span>Sound effects</span>
        <input type="checkbox" role="switch" checked={enabled}
          onChange={(event) => onEnabledChange(event.target.checked)} />
      </label>
      <div className={own.soundVolume} data-off={!enabled || undefined}>
        <label htmlFor={sliderId}>Volume</label>
        <input id={sliderId} type="range" min={0} max={100} step={5} value={percent}
          aria-valuetext={`${percent}%`}
          onChange={(event) => onVolumeChange(Number(event.target.value) / 100)} />
        {/* The slider already speaks its value; an <output> is a live region and would say it twice. */}
        <output htmlFor={sliderId} aria-hidden="true">{percent}%</output>
      </div>
    </div>
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

const POP_MIN_GAIN_MS = 900;
const POP_LIFE_MS = 1600;

interface ClockPop { id: number; text: string; delay: number }
interface ClockMemory { clock: DuelClock; pops: [ClockPop | null, ClockPop | null]; until: [number, number] }

// The parent remounts the display for every snapshot (key = serverNow), so the previous snapshot and any
// pop still fading live outside the component. Keyed by session so two open rooms never mix.
const clockMemory = new Map<string, ClockMemory>();
let popId = 0;

function liveAt(clock: DuelClock, seat: number, at: number): number {
  const active = clock.activeSeat === seat && clock.startedAt != null;
  return Math.max(0, clock.remainingMs[seat] - (active ? Math.max(0, at - clock.startedAt!) : 0));
}

function formatGain(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `+${seconds}s` : `+${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** A name that fits the HUD pill: long names are cut. The full name stays in the title and the accessible label. */
function shortName(name: string): string {
  return name.length > 10 ? `${name.slice(0, 9)}…` : name;
}

function formatClock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

// Time added to a seat = new remaining minus what the previous snapshot would show by now.
function clockGains(previous: DuelClock, next: DuelClock): [number, number] {
  const at = next.serverNow;
  return [0, 1].map((seat) => liveAt(next, seat, at) - liveAt(previous, seat, at)) as [number, number];
}

function carriedPops(key: string): [ClockPop | null, ClockPop | null] {
  const memory = clockMemory.get(key);
  if (!memory) return [null, null];
  const now = performance.now();
  return [0, 1].map((seat) => {
    const pop = memory.pops[seat];
    if (!pop || memory.until[seat] <= now) return null;
    // Keep the CSS animation in step across the remount.
    return { ...pop, delay: -(POP_LIFE_MS - (memory.until[seat] - now)) };
  }) as [ClockPop | null, ClockPop | null];
}

// The parent keys this sampler by serverNow so each authoritative snapshot resets elapsed time.
// `seats` limits it to some seats (3D mode shows one clock per cell); each choice keeps its own pop memory.
// `compact` shows the answering seat's time only. `pill` (the floating HUD) shows every seat, each with a short name, so
// a duelist reads the rival's time bank too and the pill is never empty between two answers.
export function DuelClockDisplay({ clock, session, reducedMotion = false, compact = false, pill = false, seats }: { clock: DuelClock; session: DuelSession; reducedMotion?: boolean; compact?: boolean; pill?: boolean; seats?: readonly number[] }) {
  const memoryKey = seats ? `${session.slug}#${seats.join(",")}` : session.slug;
  const [elapsed, setElapsed] = useState(0);
  const [pops, setPops] = useState<[ClockPop | null, ClockPop | null]>(() => carriedPops(memoryKey));
  useEffect(() => {
    if (clock.activeSeat == null || clock.startedAt == null) return;
    const receivedAt = performance.now();
    const timer = window.setInterval(() => setElapsed(performance.now() - receivedAt), 250);
    return () => window.clearInterval(timer);
  }, [clock.activeSeat, clock.startedAt]);
  useEffect(() => {
    const key = memoryKey;
    const memory = clockMemory.get(key);
    const now = performance.now();
    const gains = memory && memory.clock !== clock ? clockGains(memory.clock, clock) : [0, 0];
    const nextPops: [ClockPop | null, ClockPop | null] = [carriedPops(key)[0], carriedPops(key)[1]];
    const until: [number, number] = [memory?.until[0] ?? 0, memory?.until[1] ?? 0];
    let changed = false;
    for (const seat of [0, 1] as const) {
      if (gains[seat] < POP_MIN_GAIN_MS) continue;
      nextPops[seat] = { id: ++popId, text: formatGain(gains[seat]), delay: 0 };
      until[seat] = now + POP_LIFE_MS;
      changed = true;
    }
    clockMemory.set(key, { clock, pops: nextPops, until });
    if (changed) setPops(nextPops);
  }, [clock, memoryKey]);
  return (
    <div className={styles.clock} role="timer" aria-label="Decision clocks" aria-live="off">
      {clock.remainingMs.map((remaining, seat) => {
        if (seats && !seats.includes(seat)) return null;
        if (compact && clock.activeSeat !== seat) return null;
        const active = clock.activeSeat === seat && clock.startedAt != null;
        const seconds = Math.ceil(Math.max(0, remaining - (active ? Math.max(0, clock.serverNow + elapsed - clock.startedAt!) : 0)) / 1000);
        const time = formatClock(seconds);
        const name = session.seats.find((player) => player.seat === seat)?.displayName ?? `Player ${seat + 1}`;
        const pop = pops[seat];
        return <span key={seat} className={clockStyles.seat} data-active={active} title={`${name}${active ? " · answering" : ""}`} aria-label={`${name}: ${time}`}>
          {compact ? null : <small>{pill ? shortName(name) : name}</small>} <span className={styles.clockTime}>{time}</span>
          {pop ? (
            <span key={pop.id} className={clockStyles.pop} data-motion={reducedMotion ? "off" : "on"} aria-hidden
              style={{ "--pop-delay": `${pop.delay}ms` } as React.CSSProperties}>{pop.text}</span>
          ) : null}
        </span>;
      })}
    </div>
  );
}
