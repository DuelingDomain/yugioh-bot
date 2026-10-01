"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Globe, Info, Lock, Swords } from "lucide-react";
import {
  defaultDuelSettings,
  DUEL_BANLIST_OPTIONS,
  duelClockRulesText,
  isCustomDomain,
  DUEL_FORMATS,
  type DuelFormat,
  type DuelMasterRule,
  type DuelMode,
  type DuelSettings,
} from "@yugidraft/shared/duels";
import { createDuel } from "./api";
import { cx, sheetButtonClass, SheetButton, SheetSegmented, SheetSelect, sheetPage, type Choice } from "./sheet-ui";
import ui from "./sheet-ui.module.css";
import styles from "./creator.module.css";
import { FORMAT_LABELS, FORMAT_RULES, formatSeatCount, formatStartingLp } from "./table-format";

const MASTER_RULES: readonly Choice<DuelMasterRule>[] = [
  { value: 5, label: "Master Rules 5 (2020)" },
  { value: 4, label: "Master Rules 4 (2017)" },
  { value: 3, label: "Master Rules 3 (2014)" },
  { value: 2, label: "Master Rules 2 (2011)" },
  { value: 1, label: "Master Rules 1 (2008)" },
];
const VISIBILITY: readonly Choice<DuelSettings["visibility"]>[] = [
  { value: "public", label: "Public", icon: <Globe size={15} strokeWidth={1.6} aria-hidden /> },
  { value: "private", label: "Private", icon: <Lock size={15} strokeWidth={1.6} aria-hidden /> },
];
const TABLE_FORMATS: readonly Choice<DuelFormat>[] = DUEL_FORMATS.map((value) => ({ value, label: FORMAT_LABELS[value] }));
const FORMATS: readonly Choice<DuelMode>[] = [
  { value: "normal", label: "Standard duel" },
  { value: "domain", label: "Domain" },
];
const CARD_POOLS: readonly Choice<DuelSettings["cardPool"]>[] = [
  { value: "both", label: "TCG + OCG" },
  { value: "tcg", label: "TCG only" },
  { value: "ocg", label: "OCG only" },
];
const TIMERS = [0, 60, 120, 180, 240, 300, 600].map((value) => ({
  value, label: value === 0 ? "No turn timer" : `${value / 60} ${value === 60 ? "minute" : "minutes"} per turn`,
}));
const LIFE_POINTS = [1000, 2000, 4000, 8000, 16000, 32000].map((value) => ({ value, label: `${value} Life Points` }));
const OPENING_HANDS = Array.from({ length: 11 }, (_, value) => ({ value, label: `${value} ${value === 1 ? "card" : "cards"} in Starting Hand` }));
const DRAWS = Array.from({ length: 6 }, (_, value) => ({ value, label: `${value} ${value === 1 ? "card" : "cards"} per Draw Phase` }));
const TIMEOUTS: readonly Choice<DuelSettings["timeout"]>[] = [
  { value: "loss", label: "Lose the duel" },
  { value: "continue", label: "Play on" },
];
const VALIDATION: readonly Choice<boolean>[] = [{ value: true, label: "Forbid invalid decks" }, { value: false, label: "Allow invalid decks" }];
const SHUFFLE: readonly Choice<boolean>[] = [{ value: true, label: "Shuffled" }, { value: false, label: "Not shuffled" }];
const BANLISTS = DUEL_BANLIST_OPTIONS.map(({ id, label }) => ({ value: id, label: `Banlist: ${label}` }));

export function DuelCreator() {
  const router = useRouter();
  const [name, setName] = useState("Table");
  const [mode, setMode] = useState<DuelMode>("normal");
  const [format, setFormat] = useState<DuelFormat>("1v1");
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
      const { session } = await createDuel(name.trim(), mode, masterRule, settings, format);
      router.push(`/duels/${session.slug}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the game.");
      inFlight.current = false;
      setCreating(false);
    }
  }

  const timerShort = settings.turnSeconds === 0 ? "No timer" : `${settings.turnSeconds / 60} min`;
  const formatName = mode === "domain" ? (customDomain ? "Custom Domain" : "Domain") : "Standard";
  const banlistLabel = DUEL_BANLIST_OPTIONS.find((option) => option.id === settings.banlist)?.label ?? settings.banlist;
  const summaryRows: [string, string][] = [
    ["Table", `${FORMAT_LABELS[format]} · ${formatSeatCount(format)} seats`],
    ["Visibility", settings.visibility === "private" ? "Invite only" : "Public"],
    ["Banlist", banlistLabel],
    ["Card pool", settings.cardPool === "both" ? "TCG + OCG" : settings.cardPool.toUpperCase()],
    ["Turn clock", settings.turnSeconds === 0 ? "Off" : settings.timeout === "loss" ? "Lose on timeout" : "Play on at zero"],
    ["Deck check", settings.validateDeck ? "Enforced" : "Off"],
    ["Opening order", settings.shuffleDeck ? "Shuffled" : "Not shuffled"],
  ];

  return (
    <form className={cx(sheetPage, styles.form)} onSubmit={onCreate} aria-busy={creating}>
      <div className={styles.wrap}>
        <header className={styles.head}>
          <Link href="/duels" className={cx(sheetButtonClass("quiet", "sm"), styles.crumb)}>
            <ArrowLeft size={15} strokeWidth={1.6} aria-hidden /> All tables
          </Link>
          <h1 className={ui.title}>Custom game creator</h1>
          <p className={ui.lede}>Set the rules once. They lock when the table opens and stay in match history.</p>
        </header>

        <div className={styles.layout}>
          <fieldset disabled={creating} className={styles.sections}>
            <legend className={ui.srOnly}>Game setup</legend>

            <section className={styles.section} aria-labelledby="creator-table">
              <div className={styles.side}>
                <h2 id="creator-table" className={ui.sectionTitle}>Table</h2>
                <p className={ui.hint}>Who can find and join the game.</p>
              </div>
              <div className={styles.fields}>
                <label>
                  <span className={ui.label}>Table name</span>
                  <input className={ui.input} value={name} onChange={(event) => setName(event.target.value)} required maxLength={100} disabled={creating} />
                </label>
                <SheetSegmented label="Visibility" value={settings.visibility} choices={VISIBILITY} onChange={(value) => update("visibility", value)} full />
                <p className={cx(ui.hint, styles.wide)}>
                  {settings.visibility === "private" ? "Only invited server members can enter or watch. Your invite is available inside the room." : "Visible to members of this Discord server. Players and spectators must sign in."}
                </p>
              </div>
            </section>

            <section className={styles.section} aria-labelledby="creator-format">
              <div className={styles.side}>
                <h2 id="creator-format" className={ui.sectionTitle}>Format</h2>
                <p className={ui.hint}>Table size and rules. Standard and Domain allow every table type.</p>
              </div>
              <div className={styles.fields}>
                <div className={styles.wide}>
                  <SheetSelect label="Table type" value={format} choices={TABLE_FORMATS} onChange={(value) => {
                    setFormat(value);
                    // Tag and free-for-all tables run on Master Rule 5 only.
                    if (value !== "1v1") setMasterRule(5);
                  }} />
                  <p className={cx(ui.hint, styles.below)} data-testid="format-rule">
                    {formatSeatCount(format)} seats · {formatStartingLp(format, settings).toLocaleString("en-US")} LP{format === "tag" ? " per team" : " each"}. {FORMAT_RULES[format]}
                  </p>
                </div>
                <div className={styles.wide}>
                  <SheetSegmented label="Duel type" value={mode} choices={FORMATS} onChange={(value) => {
                    setMode(value);
                    setMasterRule(5);
                    // Visibility is the organizer's choice, not part of a format preset.
                    setSettings((current) => ({ ...defaultDuelSettings(value), visibility: current.visibility }));
                  }} />
                </div>
                <SheetSelect label="Master Rules" value={masterRule} choices={MASTER_RULES} onChange={setMasterRule} disabled={format !== "1v1"} />
                <SheetSelect label="Game engine" value="automatic" choices={[{ value: "automatic", label: "Automatic" }]} disabled />
              </div>
            </section>

            <section className={styles.section} aria-labelledby="creator-rules">
              <div className={styles.side}>
                <h2 id="creator-rules" className={ui.sectionTitle}>Rules</h2>
                <p className={ui.hint}>Card legality and how the duel opens.</p>
              </div>
              <div className={styles.fields}>
                <SheetSelect label="Forbidden & Limited list" value={settings.banlist} choices={BANLISTS} onChange={(value) => update("banlist", value)} />
                <SheetSegmented label="Card pool" value={settings.cardPool} choices={CARD_POOLS} onChange={(value) => update("cardPool", value)} full />
                <SheetSelect label="Starting hand" value={settings.startingHand} choices={OPENING_HANDS} onChange={(value) => update("startingHand", value)} />
                <SheetSelect label="Draw Phase" value={settings.drawPerTurn} choices={DRAWS} onChange={(value) => update("drawPerTurn", value)} />
                <div className={styles.wide}>
                  <SheetSegmented label="Opening deck order" value={settings.shuffleDeck} choices={SHUFFLE} onChange={(value) => update("shuffleDeck", value)} />
                </div>
              </div>
            </section>

            <section className={styles.section} aria-labelledby="creator-clock">
              <div className={styles.side}>
                <h2 id="creator-clock" className={ui.sectionTitle}>Clock &amp; life points</h2>
                <p className={ui.hint}>Pace of the duel and where duelists start. In Tag this is per duelist; a team shares double.</p>
              </div>
              <div className={styles.fields}>
                <SheetSelect label="Starting Life Points" value={settings.startingLP} choices={LIFE_POINTS} onChange={(value) => update("startingLP", value)} />
                <SheetSelect label="Turn timer" value={settings.turnSeconds} choices={TIMERS} onChange={(value) => update("turnSeconds", value)} />
                <div className={styles.wide}>
                  <SheetSegmented label="When the timer runs out" value={settings.timeout} choices={TIMEOUTS} onChange={(value) => update("timeout", value)} disabled={settings.turnSeconds === 0} />
                  {settings.turnSeconds > 0 ? (
                    <p className={cx(ui.hint, styles.below)}>The clock is a time bank that runs while a player must answer, including during disconnects. {duelClockRulesText(settings.turnSeconds)}, up to the full bank.</p>
                  ) : null}
                </div>
              </div>
            </section>

            <section className={styles.section} aria-labelledby="creator-deck">
              <div className={styles.side}>
                <h2 id="creator-deck" className={ui.sectionTitle}>Deck rules</h2>
                <p className={ui.hint}>What players may bring to the table.</p>
              </div>
              <div className={styles.fields}>
                <div className={styles.wide}>
                  <SheetSegmented label="Deck validation" value={settings.validateDeck} choices={VALIDATION} onChange={(value) => update("validateDeck", value)} />
                </div>
                <div className={cx(styles.wide, styles.notes)}>
                  {mode === "domain" ? (
                    <p className={cx(styles.note, customDomain && styles.noteWarn)} role="status">
                      {customDomain ? <AlertTriangle size={16} strokeWidth={1.6} aria-hidden /> : <Info size={16} strokeWidth={1.6} aria-hidden />}
                      <span>
                        <strong>{customDomain ? "Custom Domain" : "Domain preset"}</strong>
                        {customDomain ? " — these overrides differ from official Domain rules." : " — 60 singleton Main Deck cards, a separate Deck Master, up to 15 Extra Deck cards, no Side Deck."}
                      </span>
                    </p>
                  ) : (
                    <p className={styles.note}>
                      <Info size={16} strokeWidth={1.6} aria-hidden />
                      <span>Master Rules use the current card catalog, not a historical card pool. First-turn draws follow the selected Master Rule.</span>
                    </p>
                  )}
                  {!settings.validateDeck ? (
                    <p className={cx(styles.note, styles.noteWarn)}>
                      <AlertTriangle size={16} strokeWidth={1.6} aria-hidden />
                      <span>Format and copy-limit checks are off. Card-pool restrictions and engine-safety checks still apply.</span>
                    </p>
                  ) : null}
                  <p className={styles.note}>
                    <Info size={16} strokeWidth={1.6} aria-hidden />
                    <span>Changing duel type restores its preset. Settings are locked for the game and retained in match history.</span>
                  </p>
                </div>
              </div>
            </section>
          </fieldset>

          <aside className={styles.summary} aria-label="Game summary">
            <div className={styles.card}>
              <p className={styles.kind}>{FORMAT_LABELS[format]} · {formatName} · MR{masterRule} · {formatStartingLp(format, settings).toLocaleString("en-US")} LP · {timerShort}</p>
              <p className={styles.name} title={name.trim() || "Untitled table"}>{name.trim() || "Untitled table"}</p>
              <dl className={styles.tally}>
                <div><dd className={ui.num}>{formatStartingLp(format, settings).toLocaleString("en-US")}</dd><dt>{format === "tag" ? "Team LP" : "Life Points"}</dt></div>
                <div><dd className={ui.num}>{settings.startingHand}</dd><dt>Hand</dt></div>
                <div><dd className={ui.num}>{settings.drawPerTurn}</dd><dt>Draw</dt></div>
              </dl>
              <dl className={styles.rows}>
                {summaryRows.map(([label, value]) => (
                  <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
                ))}
              </dl>
              {error ? <p className={cx(ui.alert, styles.error)} role="alert">{error}</p> : null}
              <div className={styles.actions}>
                <SheetButton type="submit" kind="primary" size="lg" block loading={creating} disabled={creating || !name.trim()}>
                  {creating ? "Creating game…" : <>Create game<Swords size={17} strokeWidth={1.6} aria-hidden /></>}
                </SheetButton>
                <Link href="/duels" className={sheetButtonClass("quiet", "md", true)}>Back</Link>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </form>
  );
}
