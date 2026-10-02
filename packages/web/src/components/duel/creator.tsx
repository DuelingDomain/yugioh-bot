"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Check, Copy, Globe, Info, Lock, Swords } from "lucide-react";
import {
  defaultDuelSettings,
  type DuelBestOf,
  DUEL_BANLIST_OPTIONS,
  duelClockRulesText,
  isCustomDomain,
  DUEL_FORMATS,
  multiDomainBlockReason,
  type DuelFormat,
  type DuelMasterRule,
  type DuelMode,
  type DuelSettings,
} from "@yugidraft/shared/duels";
import { createDuel, type DuelPlayerOption } from "./api";
import { OpponentPicker } from "./opponent-picker";
import { TURN_TIMER_CHOICES } from "./turn-timer";
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
const LIFE_POINTS = [1000, 2000, 4000, 8000, 16000, 32000].map((value) => ({ value, label: `${value} Life Points` }));
const OPENING_HANDS = Array.from({ length: 11 }, (_, value) => ({ value, label: `${value} ${value === 1 ? "card" : "cards"} in Starting Hand` }));
const DRAWS = Array.from({ length: 6 }, (_, value) => ({ value, label: `${value} ${value === 1 ? "card" : "cards"} per Draw Phase` }));
const TIMEOUTS: readonly Choice<DuelSettings["timeout"]>[] = [
  { value: "loss", label: "Lose the duel" },
  { value: "continue", label: "Play on" },
];
const VALIDATION: readonly Choice<boolean>[] = [{ value: true, label: "Forbid invalid decks" }, { value: false, label: "Allow invalid decks" }];
const SHUFFLE: readonly Choice<boolean>[] = [{ value: true, label: "Shuffled" }, { value: false, label: "Not shuffled" }];
const SERIES_LENGTHS: readonly Choice<DuelBestOf>[] = [
  { value: 1, label: "Best of 1" },
  { value: 3, label: "Best of 3" },
];
const BANLISTS = DUEL_BANLIST_OPTIONS.map(({ id, label }) => ({ value: id, label: `Banlist: ${label}` }));

/**
 * `focusOpponent` focuses the opponent search for the challenge entry.
 * Server capabilities control the available table formats and Domain mode.
 */
export function DuelCreator({ focusOpponent = false, multiplayerTables = false, multiDomainCoreReady = false }: {
  focusOpponent?: boolean;
  multiplayerTables?: boolean;
  multiDomainCoreReady?: boolean;
} = {}) {
  const router = useRouter();
  const [name, setName] = useState("Table");
  const [mode, setMode] = useState<DuelMode>("normal");
  const [format, setFormat] = useState<DuelFormat>("1v1");
  const [masterRule, setMasterRule] = useState<DuelMasterRule>(5);
  const [settings, setSettings] = useState(() => defaultDuelSettings("normal"));
  const [opponent, setOpponent] = useState<DuelPlayerOption | null>(null);
  const [bestOf, setBestOf] = useState<DuelBestOf>(1);
  const [ranked, setRanked] = useState(false);
  const [sent, setSent] = useState<{ slug: string; opponent: string; notified: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  // A challenge room is always private; the server forces it, so the form shows it that way.
  const challenge = opponent != null;
  // A challenge, Best of 3 and Ranked belong to 1v1 tables. Tag and free-for-all tables are open tables, one game.
  const matchLocked = format !== "1v1";
  const visibility = challenge ? "private" : settings.visibility;
  const customDomain = mode === "domain" && isCustomDomain(masterRule, settings);
  // Domain is offered only where its core exists (see multiDomainBlockReason).
  const domainBlocked = multiDomainBlockReason("domain", format, multiDomainCoreReady);
  const duelTypes = domainBlocked ? FORMATS.filter((choice) => choice.value !== "domain") : FORMATS;

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
      const { session, notified } = await createDuel(name.trim(), mode, masterRule, { ...settings, visibility }, {
        // A 1v1 request carries no format: the body stays the one the server has always read.
        ...(format !== "1v1" ? { format } : {}),
        opponentPlayerId: opponent?.id ?? null, bestOf, ranked,
      });
      if (opponent) {
        // Stay on this page so the challenge note and the link can be used; the room is one click away.
        setSent({ slug: session.slug, opponent: opponent.displayName, notified: notified === true });
        setCreating(false);
        return;
      }
      router.push(`/duels/${session.slug}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the game.");
      inFlight.current = false;
      setCreating(false);
    }
  }

  async function copyLink() {
    if (!sent) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/duels/${sent.slug}`);
      setCopied(true);
    } catch {
      setError("Could not copy the link. Open the table and copy it from the address bar.");
    }
  }

  const timerShort = settings.turnSeconds === 0 ? "Unlimited" : `${settings.turnSeconds / 60} min`;
  const formatName = mode === "domain" ? (customDomain ? "Custom Domain" : "Domain") : "Standard";
  const banlistLabel = DUEL_BANLIST_OPTIONS.find((option) => option.id === settings.banlist)?.label ?? settings.banlist;
  const summaryRows: [string, string][] = [
    ["Table", `${FORMAT_LABELS[format]} · ${formatSeatCount(format)} seats`],
    ["Match", `${bestOf === 3 ? "Best of 3" : "Best of 1"} · ${ranked ? "Ranked" : "Unranked"}`],
    ["Opponent", opponent ? opponent.displayName : "Open table"],
    ["Visibility", visibility === "private" ? "Invite only" : "Public"],
    ["Banlist", banlistLabel],
    ["Card pool", settings.cardPool === "both" ? "TCG + OCG" : settings.cardPool.toUpperCase()],
    ["Turn clock", settings.turnSeconds === 0 ? "Unlimited" : settings.timeout === "loss" ? "Lose on timeout" : "Play on at zero"],
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
          <fieldset disabled={creating || sent != null} className={styles.sections}>
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
                <SheetSegmented label="Visibility" value={visibility} choices={VISIBILITY} onChange={(value) => update("visibility", value)} disabled={challenge} full />
                <p className={cx(ui.hint, styles.wide)}>
                  {challenge ? "Challenge tables are always private. Only you and the player you challenge can enter." : visibility === "private" ? "Only invited server members can enter or watch. Your invite is available inside the room." : "Visible to members of this Discord server. Players and spectators must sign in."}
                </p>
              </div>
            </section>

            <section className={styles.section} aria-labelledby="creator-match">
              <div className={styles.side}>
                <h2 id="creator-match" className={ui.sectionTitle}>Match</h2>
                <p className={ui.hint}>Challenge someone by name, or leave it open for anyone to join.</p>
              </div>
              <div className={styles.fields}>
                <div className={styles.wide}>
                  <OpponentPicker value={opponent} onChange={setOpponent} disabled={creating || sent != null || matchLocked} autoFocus={focusOpponent} />
                  {opponent ? <p className={cx(ui.hint, styles.below)}>The bot tries to send {opponent.displayName} a direct message with a link to the table. If it cannot, you get the link to share.</p> : null}
                </div>
                <div className={styles.wide}>
                  <SheetSegmented label="Series length" value={bestOf} choices={SERIES_LENGTHS} onChange={setBestOf} disabled={matchLocked} />
                </div>
                <div className={styles.wide}>
                  <label className={styles.toggle}>
                    <input type="checkbox" checked={ranked} onChange={(event) => setRanked(event.target.checked)} disabled={matchLocked} />
                    <span>
                      Ranked
                      <small>The result counts toward the player rankings. Off by default.</small>
                    </span>
                  </label>
                </div>
                {matchLocked ? (
                  <p className={cx(ui.hint, styles.wide)} data-testid="match-locked">
                    Challenges, Best of 3 and Ranked are for 1v1 tables. Tag and free-for-all tables are one open game.
                  </p>
                ) : null}
                {!matchLocked && !challenge && (bestOf === 3 || ranked) ? (
                  <p className={cx(ui.hint, styles.wide)} data-testid="practice-note">
                    Best of 3 and Ranked only count when two players play each other. A game against the practice bot never counts.
                  </p>
                ) : null}
              </div>
            </section>

            <section className={styles.section} aria-labelledby="creator-format">
              <div className={styles.side}>
                <h2 id="creator-format" className={ui.sectionTitle}>Format</h2>
                <p className={ui.hint}>
                  {multiplayerTables ? "Table size and rules. Each duelist has a separate field and, in Domain, a separate Deck Master." : "Standard or Domain, one against one."}
                </p>
              </div>
              <div className={styles.fields}>
                {multiplayerTables ? (
                <div className={styles.wide}>
                  <SheetSelect label="Table type" value={format} choices={TABLE_FORMATS} onChange={(value) => {
                    setFormat(value);
                    setSettings((current) => ({ ...current, stopAtEveryWindow: defaultDuelSettings(mode, value).stopAtEveryWindow }));
                    // A challenge, Best of 3 and Ranked need a 1v1 table.
                    if (value !== "1v1") {
                      setOpponent(null);
                      setBestOf(1);
                      setRanked(false);
                    }
                    // Use the host status when changing the table format.
                    if (mode === "domain" && multiDomainBlockReason("domain", value, multiDomainCoreReady)) {
                      setMode("normal");
                      setSettings((current) => ({ ...defaultDuelSettings("normal", value), visibility: current.visibility }));
                    }
                    // Tag and free-for-all tables run on Master Rule 5 only.
                    if (value !== "1v1") setMasterRule(5);
                  }} />
                  <p className={cx(ui.hint, styles.below)} data-testid="format-rule">
                    {formatSeatCount(format)} seats · {formatStartingLp(format, settings).toLocaleString("en-US")} LP{format === "tag" ? " per team" : " each"}. {FORMAT_RULES[format]}
                  </p>
                </div>
                ) : null}
                <div className={styles.wide}>
                  <SheetSegmented label="Duel type" value={mode} choices={duelTypes} onChange={(value) => {
                    setMode(value);
                    setMasterRule(5);
                    // Visibility is the organizer's choice, not part of a format preset.
                    setSettings((current) => ({ ...defaultDuelSettings(value, format), visibility: current.visibility }));
                  }} />
                  {domainBlocked ? (
                    <p className={cx(ui.hint, styles.below)} data-testid="domain-blocked">{domainBlocked}</p>
                  ) : null}
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
                <p className={ui.hint}>Pace of the duel and where duelists start.{multiplayerTables ? " In Tag this is per duelist; a team shares double." : ""}</p>
              </div>
              <div className={styles.fields}>
                <SheetSelect label="Starting Life Points" value={settings.startingLP} choices={LIFE_POINTS} onChange={(value) => update("startingLP", value)} />
                <SheetSelect label="Turn timer" value={settings.turnSeconds} choices={TURN_TIMER_CHOICES} onChange={(value) => update("turnSeconds", value)} />
                <div className={styles.wide}>
                  <SheetSegmented label="When the timer runs out" value={settings.timeout} choices={TIMEOUTS} onChange={(value) => update("timeout", value)} disabled={settings.turnSeconds === 0} />
                  {settings.turnSeconds > 0 ? (
                    <p className={cx(ui.hint, styles.below)}>The clock is a time bank that runs while a player must answer, including during disconnects. {duelClockRulesText(settings.turnSeconds)}, up to the full bank.</p>
                  ) : (
                    <p className={cx(ui.hint, styles.below)}>No clock runs. Players take as long as they need and nobody loses on time.</p>
                  )}
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
                        {" In Domain, every duelist draws on their first turn."}
                      </span>
                    </p>
                  ) : (
                    <p className={styles.note}>
                      <Info size={16} strokeWidth={1.6} aria-hidden />
                      <span>
                        Master Rules use the current card catalog, not a historical card pool. First-turn draws follow the selected Master Rule.
                      </span>
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
              {sent ? (
                <div className={styles.sent}>
                  <p className={styles.sentTitle} role="status">
                    {sent.notified
                      ? `Challenge sent — the bot sent ${sent.opponent} a DM`
                      : `Challenge created — the bot could not DM ${sent.opponent}. Copy the link and send it to them.`}
                  </p>
                  <div className={styles.sentRow}>
                    <SheetButton onClick={() => void copyLink()}>
                      {copied ? <Check size={15} strokeWidth={1.6} aria-hidden /> : <Copy size={15} strokeWidth={1.6} aria-hidden />}
                      {copied ? "Link copied" : "Copy link"}
                    </SheetButton>
                  </div>
                  <Link href={`/duels/${sent.slug}`} className={sheetButtonClass("primary", "lg", true)}>
                    Open the table<Swords size={17} strokeWidth={1.6} aria-hidden />
                  </Link>
                </div>
              ) : (
                <div className={styles.actions}>
                  <SheetButton type="submit" kind="primary" size="lg" block loading={creating} disabled={creating || !name.trim()}>
                    {creating ? "Creating game…" : <>{opponent ? "Send challenge" : "Create game"}<Swords size={17} strokeWidth={1.6} aria-hidden /></>}
                  </SheetButton>
                  <Link href="/duels" className={sheetButtonClass("quiet", "md", true)}>Back</Link>
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </form>
  );
}
