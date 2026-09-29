"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Swords } from "lucide-react";
import {
  defaultDuelSettings,
  DUEL_BANLIST_OPTIONS,
  isCustomDomain,
  type DuelMasterRule,
  type DuelMode,
  type DuelSettings,
} from "@yugidraft/shared/duels";
import { createDuel } from "./api";
import styles from "./creator.module.css";

type Choice<T> = { value: T; label: string };

function SettingSelect<T extends string | number | boolean>({
  label, value, choices, onChange, disabled = false,
}: {
  label: string;
  value: T;
  choices: readonly Choice<T>[];
  onChange?: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <label className={styles.setting}>
      <span>{label}</span>
      <select value={String(value)} disabled={disabled} onChange={(event) => {
        const selected = choices.find((choice) => String(choice.value) === event.target.value);
        if (selected) onChange?.(selected.value);
      }}>
        {choices.map((choice) => <option key={String(choice.value)} value={String(choice.value)}>{choice.label}</option>)}
      </select>
    </label>
  );
}

const MASTER_RULES: readonly Choice<DuelMasterRule>[] = [
  { value: 5, label: "Master Rules 5 (2020)" },
  { value: 4, label: "Master Rules 4 (2017)" },
  { value: 3, label: "Master Rules 3 (2014)" },
  { value: 2, label: "Master Rules 2 (2011)" },
  { value: 1, label: "Master Rules 1 (2008)" },
];
const VISIBILITY: readonly Choice<DuelSettings["visibility"]>[] = [
  { value: "public", label: "Public game" },
  { value: "private", label: "Private game · invite only" },
];
const FORMATS: readonly Choice<DuelMode>[] = [
  { value: "normal", label: "Duel (1v1, single duel)" },
  { value: "domain", label: "Domain (1v1, single duel)" },
];
const CARD_POOLS: readonly Choice<DuelSettings["cardPool"]>[] = [
  { value: "both", label: "Both TCG and OCG cards" },
  { value: "tcg", label: "TCG cards only" },
  { value: "ocg", label: "OCG cards only" },
];
const TIMERS = [0, 60, 120, 180, 240, 300, 600].map((value) => ({
  value, label: value === 0 ? "No turn timer" : `${value / 60} ${value === 60 ? "minute" : "minutes"} per turn`,
}));
const LIFE_POINTS = [1000, 2000, 4000, 8000, 16000, 32000].map((value) => ({ value, label: `${value} Life Points` }));
const OPENING_HANDS = Array.from({ length: 11 }, (_, value) => ({ value, label: `${value} ${value === 1 ? "card" : "cards"} in Starting Hand` }));
const DRAWS = Array.from({ length: 6 }, (_, value) => ({ value, label: `${value} ${value === 1 ? "card" : "cards"} per Draw Phase` }));
const TIMEOUTS: readonly Choice<DuelSettings["timeout"]>[] = [
  { value: "loss", label: "Lose when timer runs out" },
  { value: "continue", label: "Continue when timer runs out" },
];
const VALIDATION = [{ value: true, label: "Invalid decks forbidden" }, { value: false, label: "Invalid decks allowed" }];
const SHUFFLE = [{ value: true, label: "Starting deck shuffled" }, { value: false, label: "Starting deck not shuffled" }];
const BANLISTS = DUEL_BANLIST_OPTIONS.map(({ id, label }) => ({ value: id, label: `Banlist: ${label}` }));

export function DuelCreator() {
  const router = useRouter();
  const [name, setName] = useState("Table");
  const [mode, setMode] = useState<DuelMode>("normal");
  const [masterRule, setMasterRule] = useState<DuelMasterRule>(5);
  const [settings, setSettings] = useState(() => defaultDuelSettings("normal"));
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const customDomain = mode === "domain" && isCustomDomain(masterRule, settings);

  function update<K extends keyof DuelSettings>(key: K, value: DuelSettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setCreating(true);
    setError(null);
    try {
      const { session } = await createDuel(name.trim(), mode, masterRule, settings);
      router.push(`/duels/${session.slug}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the game.");
      inFlight.current = false;
      setCreating(false);
    }
  }

  return (
    <form className={styles.panel} onSubmit={onCreate} aria-busy={creating}>
      <header className={styles.heading}>
        <h1>Custom game creator</h1>
        <label className={styles.name}>
          <span>Table name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={100} disabled={creating} />
        </label>
      </header>
      <fieldset disabled={creating} className={styles.section}>
        <legend className="sr-only">Game setup</legend>
        <div className={styles.grid}>
          <SettingSelect label="Visibility" value={settings.visibility} choices={VISIBILITY} onChange={(value) => update("visibility", value)} />
          <SettingSelect label="Duel type" value={mode} choices={FORMATS} onChange={(value) => {
            setMode(value);
            setMasterRule(5);
            // Visibility is the organizer's choice, not part of a format preset.
            setSettings((current) => ({ ...defaultDuelSettings(value), visibility: current.visibility }));
          }} />
          <SettingSelect label="Game engine" value="automatic" choices={[{ value: "automatic", label: "Automatic" }]} disabled />
          <SettingSelect label="Master Rules" value={masterRule} choices={MASTER_RULES} onChange={setMasterRule} />
        </div>
        <p className={styles.hint}>
          {settings.visibility === "private" ? "Only invited server members can enter or watch. Your invite is available inside the room." : "Visible to members of this Discord server. Players and spectators must sign in."}
        </p>
      </fieldset>
      <fieldset disabled={creating} className={styles.section}>
        <legend>Custom settings</legend>
        <div className={styles.grid}>
          <SettingSelect label="Forbidden & Limited list" value={settings.banlist} choices={BANLISTS} onChange={(value) => update("banlist", value)} />
          <SettingSelect label="Card pool" value={settings.cardPool} choices={CARD_POOLS} onChange={(value) => update("cardPool", value)} />
          <SettingSelect label="Turn timer" value={settings.turnSeconds} choices={TIMERS} onChange={(value) => update("turnSeconds", value)} />
          <SettingSelect label="Starting Life Points" value={settings.startingLP} choices={LIFE_POINTS} onChange={(value) => update("startingLP", value)} />
          <SettingSelect label="Starting hand" value={settings.startingHand} choices={OPENING_HANDS} onChange={(value) => update("startingHand", value)} />
          <SettingSelect label="Draw Phase" value={settings.drawPerTurn} choices={DRAWS} onChange={(value) => update("drawPerTurn", value)} />
          <SettingSelect label="Timeout behavior" value={settings.timeout} choices={TIMEOUTS} onChange={(value) => update("timeout", value)} disabled={settings.turnSeconds === 0} />
          <SettingSelect label="Deck validation" value={settings.validateDeck} choices={VALIDATION} onChange={(value) => update("validateDeck", value)} />
          <SettingSelect label="Opening deck order" value={settings.shuffleDeck} choices={SHUFFLE} onChange={(value) => update("shuffleDeck", value)} />
        </div>
      </fieldset>
      <div className={styles.notes}>
        {mode === "domain" ? (
          <p className={customDomain ? styles.warning : styles.hint} role="status">
            <strong>{customDomain ? "Custom Domain" : "Domain preset"}</strong>
            {customDomain ? " — these overrides differ from official Domain rules." : " — 60 singleton Main Deck cards, a separate Deck Master, up to 15 Extra Deck cards, no Side Deck."}
          </p>
        ) : <p className={styles.hint}>Master Rules use the current card catalog, not a historical card pool. First-turn draws follow the selected Master Rule.</p>}
        {!settings.validateDeck ? <p className={styles.warning}>Format and copy-limit checks are off. Card-pool restrictions and engine-safety checks still apply.</p> : null}
        {settings.turnSeconds > 0 ? <p className={styles.hint}>The clock runs while a player must answer, including during disconnects. Each new turn refreshes both players’ time.</p> : null}
        <p className={styles.hint}>Changing duel type restores its preset. Settings are locked for the game and retained in match history.</p>
      </div>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <footer className={styles.actions}>
        <Link href="/duels" className={styles.back}>Back <ArrowLeft size={23} aria-hidden /></Link>
        <button type="submit" className={styles.create} disabled={creating || !name.trim()}>
          {creating ? "Creating game…" : "Create game"}<Swords size={30} aria-hidden />
        </button>
      </footer>
    </form>
  );
}
