"use client";

import * as React from "react";
import { Check, TriangleAlert, Zap } from "lucide-react";
import { Segmented, SvCheck } from "@/components/sheet";
import {
  DEFAULT_PICK_SECONDS_CHOICES,
  RULE_LIMITS,
  RULE_PRESETS,
  analyzeRules,
  applyPreset,
  editRule,
  extraSummary,
  fitRulesToPool,
  matchPreset,
  readinessText,
  rulesSummary,
  settleRule,
  setPicksPerStep,
  stepRule,
  type FitResult,
  type PoolCounts,
  type RuleTextKey,
  type RulesAnalysis,
  type RulesFields,
} from "./rules-model";
import styles from "./rules-panel.module.css";

const fmt = (n: number) => n.toLocaleString("en-US");
const plural = (n: number, one: string, many: string) => `${fmt(n)} ${n === 1 ? one : many}`;

export interface RulesPanelProps {
  value: RulesFields;
  onChange: (value: RulesFields) => void;
  pool: PoolCounts;
  /** Name and channel fields. `RulesMetaFields` is one ready-made option. */
  metaSlot?: React.ReactNode;
  /** The Create action (button and shortcut hint). The panel gives it a footer with the readiness line above it. */
  actionSlot?: React.ReactNode;
  /** Called after Fit to pool, with what changed or the deficit. The host can show it as a toast. */
  onFit?: (result: FitResult) => void;
  className?: string;
}

/** Readiness the host reads to enable Create, from the same math as the panel. */
export function useRulesAnalysis(value: RulesFields, pool: PoolCounts): RulesAnalysis {
  const { main, extra, mainReachable } = pool;
  return React.useMemo(() => analyzeRules(value, { main, extra, mainReachable }), [value, main, extra, mainReachable]);
}

interface StepperProps {
  id: string;
  label: string;
  text: string;
  limitKey: RuleTextKey;
  unit?: string;
  onType: (text: string) => void;
  onStep: (delta: 1 | -1) => void;
  onSettle: () => void;
  hint?: string;
}

function Stepper({ id, label, text, limitKey, unit, onType, onStep, onSettle, hint }: StepperProps) {
  const [lo, hi] = RULE_LIMITS[limitKey];
  const hintId = hint ? `${id}-h` : undefined;
  return (
    <div className={styles.fld}>
      <label htmlFor={id}>{label}</label>
      <div className={styles.ns}>
        <button type="button" aria-label={`Fewer: ${label}`} onClick={() => onStep(-1)} disabled={Number(text) <= lo}>{"−"}</button>
        <input
          id={id}
          inputMode="numeric"
          value={text}
          aria-describedby={hintId}
          onChange={(e) => onType(e.target.value.replace(/[^\d]/g, ""))}
          onBlur={onSettle}
        />
        <button type="button" aria-label={`More: ${label}`} onClick={() => onStep(1)} disabled={Number(text) >= hi}>+</button>
        {unit && <span className={styles.unit} aria-hidden="true">{unit}</span>}
      </div>
      {hint && <p id={hintId} className={styles.hh}>{hint}</p>}
    </div>
  );
}

function Meter({ label, need, have, tone }: { label: string; need: number; have: number; tone: "ok" | "bad" }) {
  const scale = Math.max(need, have, 1);
  return (
    <div className={`${styles.meter} ${tone === "bad" ? styles.bad : ""}`}>
      <div className={styles.mt}>
        <span>{label}</span>
        <em>need <b>{fmt(need)}</b> {"·"} pool <b>{fmt(have)}</b></em>
      </div>
      <div
        className={styles.track}
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={scale}
        aria-valuenow={Math.min(need, scale)}
        aria-valuetext={`Needs ${need}, pool has ${have}`}
      >
        <i style={{ width: `${(Math.min(need, scale) / scale) * 100}%` }} />
        {need > have && <u style={{ left: `calc(${(have / scale) * 100}% - 1px)` }} />}
      </div>
    </div>
  );
}

/** The sum, the pool against it, what is wrong, and the time it takes. */
function Ledger({ a, fit }: { a: RulesAnalysis; fit: () => void }) {
  const { rules } = a;
  const turns = Math.ceil(rules.pile / rules.picksPerStep);
  const rounds = Array.from({ length: rules.rounds }, (_, i) => i + 1);
  const mainTone = a.mainShort > 0 || a.emptyPool ? "bad" : "ok";
  let note: React.ReactNode;
  if (a.emptyPool) {
    note = (
      <div className={`${styles.note} ${styles.noteBad}`}>
        <TriangleAlert size={16} aria-hidden="true" />
        <div><b>No pool yet.</b> Add cards or pick a cube to see the math.</div>
      </div>
    );
  } else if (a.mainShort > 0 || a.extraShort > 0) {
    note = (
      <div className={`${styles.note} ${styles.noteBad}`}>
        <TriangleAlert size={16} aria-hidden="true" />
        <div>
          <b>{a.mainShort > 0 ? `Main piles are ${plural(a.mainShort, "card", "cards")} short.` : `Extra Deck piles are ${plural(a.extraShort, "card", "cards")} short.`}</b>
          {a.mainShort > 0 && a.extraShort > 0 && <> Extra Deck piles are {plural(a.extraShort, "card", "cards")} short too.</>}
          <br />
          <button type="button" className={styles.fit} onClick={fit}><Zap size={14} aria-hidden="true" />Fit rules to pool</button>
        </div>
      </div>
    );
  } else {
    note = (
      <div className={`${styles.note} ${styles.noteOk}`}>
        <Check size={16} aria-hidden="true" />
        <div>
          Piles use <b>{fmt(a.mainDemand)}</b> of {fmt(a.mainHave)} Main cards{a.spare ? `. ${fmt(a.spare)} spare stay out.` : ". Exact fit."}
          {rules.pile % rules.picksPerStep !== 0 && (
            <><br /><span className={styles.muted}>The last turn of each pile takes {plural(rules.pile % rules.picksPerStep, "pick", "picks")}.</span></>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className={styles.ledger}>
      <div>
        <div className={styles.eq} aria-label={`${rules.rounds} rounds times ${rules.seats} players times ${rules.pile} cards per pile equals ${a.mainDemand}`}>
          <b>{rules.rounds}</b><i>{"×"}</i><b>{rules.seats}</b><i>{"×"}</i><b>{rules.pile}</b><i>=</i><b className={styles.gold}>{fmt(a.mainDemand)}</b>
        </div>
        <span className={styles.cap}>rounds {"×"} players {"×"} cards per pile</span>
      </div>
      <Meter label="Main piles" need={a.mainDemand} have={a.mainHave} tone={mainTone} />
      {rules.extraEnabled && (
        <Meter label="Extra Deck piles" need={a.extraDemand} have={a.extraHave} tone={a.extraShort > 0 ? "bad" : "ok"} />
      )}
      {a.extraIdle > 0 && (
        <p className={styles.hint}>
          {plural(a.extraIdle, "Extra Deck card", "Extra Deck cards")} in the pool {a.extraIdle === 1 ? "is" : "are"} not dealt until the Extra Deck round is on. They never count toward Main piles.
        </p>
      )}
      {note}
      <div className={styles.facts}>
        <div className={styles.fact}>
          <b>{a.picksEach}{rules.extraEnabled && <small> +{a.extraEach}</small>}</b>
          <span>picks each{rules.extraEnabled ? " (+ Extra)" : ""}</span>
        </div>
        <div className={styles.fact}>
          <b>{turns}</b>
          <span>{turns === 1 ? "turn" : "turns"} per round</span>
        </div>
        <div className={styles.fact}>
          <b>{fmt(a.maxMinutes)}<small> min</small></b>
          <span>at {rules.pickSeconds}s per pick, worst case</span>
        </div>
      </div>
      <div className={styles.tl} role="img" aria-label={`Round order: ${rules.rounds} main rounds${rules.extraEnabled ? " then the Extra Deck round" : ""}`}>
        {rounds.map((n) => <i key={n} style={{ "--w": turns } as React.CSSProperties}>R{n}</i>)}
        {rules.extraEnabled && <i className={styles.ex} style={{ "--w": Math.max(1, Math.ceil(rules.extraSize / rules.picksPerStep)) } as React.CSSProperties}>EX</i>}
      </div>
    </div>
  );
}

function Section({ title, summary, open, onToggle, children }: {
  title: string;
  summary: string;
  open: boolean;
  onToggle: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <details className={styles.acc} open={open} onToggle={(e) => { const next = e.currentTarget.open; if (next !== open) onToggle(next); }}>
      <summary><span>{title}</span>{summary && <em>{summary}</em>}</summary>
      <div className={styles.accb}>{children}</div>
    </details>
  );
}

/**
 * The right pane of the Workbench. It edits the same strings `configFromFields` reads, and shows
 * rounds x players x cards per pile against the pool. Name, channel and the Create button come in as slots.
 */
export function RulesPanel({ value, onChange, pool, metaSlot, actionSlot, onFit, className }: RulesPanelProps) {
  const analysis = useRulesAnalysis(value, pool);
  const { rules } = analysis;
  const preset = matchPreset(value);
  const [open, setOpen] = React.useState({ rules: true, extra: value.extraDeckEnabled === true, meta: false });

  const type = (key: RuleTextKey) => (text: string) => onChange(editRule(value, key, text));
  const step = (key: RuleTextKey) => (delta: 1 | -1) => onChange(stepRule(value, key, delta));
  const settle = (key: RuleTextKey) => () => onChange(settleRule(value, key));

  const fit = () => {
    const result = fitRulesToPool(value, pool);
    if (result.fields !== value) onChange(result.fields);
    onFit?.(result);
  };

  const seats = value.lobbySeatsText ?? String(rules.seats);
  const rounds = value.roundsText ?? String(rules.rounds);
  const picksBelowDeal = analysis.unpickedEach > 0;

  return (
    <section className={`${styles.panel}${className ? ` ${className}` : ""}`} aria-label="Draft rules">
      <div className={styles.body}>
        <Ledger a={analysis} fit={fit} />

        <div className={styles.presets} role="group" aria-label="Presets">
          <span className={styles.secL}>Presets</span>
          {RULE_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={styles.chip}
              aria-pressed={preset === p.id}
              title={p.detail}
              onClick={() => onChange(applyPreset(value, p.id))}
            >
              {p.label}
            </button>
          ))}
          <button type="button" className={styles.chip} onClick={fit}><Zap size={13} aria-hidden="true" />Fit to pool</button>
        </div>

        <Section title="Rounds & piles" summary={rulesSummary(value)} open={open.rules} onToggle={(v) => setOpen((o) => ({ ...o, rules: v }))}>
          <Stepper id="rules-seats" label="Players" text={seats} limitKey="seats" onType={type("seats")} onStep={step("seats")} onSettle={settle("seats")} hint="Seats fill from the Discord lobby. The host can start early with 2 or more." />
          <Stepper id="rules-rounds" label="Rounds" text={rounds} limitKey="rounds" onType={type("rounds")} onStep={step("rounds")} onSettle={settle("rounds")} />
          <Stepper id="rules-pile" label="Cards per pile" text={value.packSizeText} limitKey="pile" onType={type("pile")} onStep={step("pile")} onSettle={settle("pile")} hint="Each player holds one pile per turn and passes it on." />
          {picksBelowDeal && (
            <Stepper id="rules-picks" label="Picks each" text={value.cardsPerPlayerText} limitKey="picks" onType={type("picks")} onStep={step("picks")} onSettle={settle("picks")} hint={`${plural(rules.picks, "pick", "picks")}; ${plural(analysis.dealtEach, "card", "cards")} dealt to each seat.`} />
          )}
          <div className={styles.fld}>
            <span className={styles.lb} id="rules-pps">Picks per turn</span>
            <Segmented
              label="Picks per turn"
              value={rules.picksPerStep === 2 ? "2" : "1"}
              options={[{ value: "1", label: "1 pick" }, { value: "2", label: "2-pick" }]}
              onChange={(v) => onChange(setPicksPerStep(value, v === "2" ? 2 : 1))}
            />
            <p className={styles.hh}>{rules.picksPerStep === 2 ? "Two picks run one after the other, each on the full timer, before the pile moves on." : "One pick, then the pile moves on."}</p>
          </div>
          <div className={styles.fld}>
            <span className={styles.lb} id="rules-timer-l">Pick timer</span>
            <div className={styles.chips} role="group" aria-labelledby="rules-timer-l">
              {DEFAULT_PICK_SECONDS_CHOICES.map((s) => (
                <button key={s} type="button" className={styles.chip} aria-pressed={rules.pickSeconds === s} onClick={() => onChange(editRule(value, "pickSeconds", String(s)))}>{s}s</button>
              ))}
            </div>
            <Stepper id="rules-seconds" label="Seconds per pick" text={value.pickSecondsText} limitKey="pickSeconds" unit="s" onType={type("pickSeconds")} onStep={step("pickSeconds")} onSettle={settle("pickSeconds")} />
          </div>
          <SvCheck
            compact
            label="Limit 3 copies per card"
            hint="Nobody can take a 4th copy."
            checked={rules.copyLimit}
            onChange={(e) => onChange({ ...value, copyLimit: e.target.checked })}
          />
        </Section>

        <Section title="Extra Deck round" summary={extraSummary(value)} open={open.extra} onToggle={(v) => setOpen((o) => ({ ...o, extra: v }))}>
          <SvCheck
            compact
            label="Draft the Extra Deck on its own"
            hint="Runs after the main rounds, with Extra Deck monsters only. It uses the same picks per turn."
            checked={rules.extraEnabled}
            onChange={(e) => {
              onChange({ ...value, extraDeckEnabled: e.target.checked });
              if (e.target.checked) setOpen((o) => ({ ...o, extra: true }));
            }}
          />
          {rules.extraEnabled && (
            <Stepper id="rules-extra-size" label="Extra Deck cards per player" text={value.extraDeckSizeText ?? String(rules.extraSize)} limitKey="extraSize" onType={type("extraSize")} onStep={step("extraSize")} onSettle={settle("extraSize")} hint="One pile per player. Up to 15." />
          )}
        </Section>

        {metaSlot && (
          <Section title="Name & channel" summary="" open={open.meta} onToggle={(v) => setOpen((o) => ({ ...o, meta: v }))}>
            {metaSlot}
          </Section>
        )}
      </div>

      <div className={styles.foot}>
        <div className={`${styles.ready} ${analysis.ok ? "" : styles.readyBad}`} role="status">
          <i aria-hidden="true" />
          <span>{readinessText(analysis)}</span>
        </div>
        {actionSlot}
      </div>
    </section>
  );
}

export interface RulesMetaFieldsProps {
  name: string;
  onNameChange: (name: string) => void;
  namePlaceholder?: string;
  channelId: string;
  onChannelChange: (id: string) => void;
  channels: ReadonlyArray<{ id: string; name: string }>;
  channelHint?: string;
}

/** Draft name and Discord channel, for the panel's `metaSlot`. */
export function RulesMetaFields({ name, onNameChange, namePlaceholder, channelId, onChannelChange, channels, channelHint }: RulesMetaFieldsProps) {
  return (
    <>
      <div className={`${styles.fld} ${styles.stack}`}>
        <label htmlFor="rules-name">Draft name</label>
        <input id="rules-name" className={styles.text} autoComplete="off" value={name} placeholder={namePlaceholder} onChange={(e) => onNameChange(e.target.value)} />
      </div>
      <div className={`${styles.fld} ${styles.stack}`}>
        <label htmlFor="rules-channel">Discord channel</label>
        <select id="rules-channel" className={styles.text} value={channelId} onChange={(e) => onChannelChange(e.target.value)}>
          {channels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
        </select>
        <p className={styles.hh}>{channelHint ?? "The bot posts the lobby here. Players join from Discord."}</p>
      </div>
    </>
  );
}
