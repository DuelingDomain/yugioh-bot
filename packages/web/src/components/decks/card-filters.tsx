"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowDownLeft,
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  X,
} from "lucide-react";
import {
  CARD_ATTRIBUTES,
  CARD_LIMIT_KEYS,
  CARD_RACES,
  SPELL_TYPE_KEYS,
  TRAP_TYPE_KEYS,
  foldCardText,
  type CardArchetype,
  type CardMatch,
  type CardQuery,
  type CardRange,
} from "@yugidraft/shared/duels";
import { cn } from "@/lib/utils";
import { DeckSegmented } from "./controls";
import {
  ABILITY_KEYS,
  FRAME_KEYS,
  LIMIT_LABELS,
  MONSTER_TYPE_LABELS,
  SPELL_TYPE_LABELS,
  TRAP_TYPE_LABELS,
  archetypeFor,
  banlistLabel,
  toggle,
} from "./filter-model";
import styles from "./card-browser.module.css";

const KIND_CHOICES = [
  { value: "any" as const, label: "All" },
  { value: "monster" as const, label: "Monster" },
  { value: "spell" as const, label: "Spell" },
  { value: "trap" as const, label: "Trap" },
];

const MATCH_CHOICES = [
  { value: "any" as CardMatch, label: "Any" },
  { value: "all" as CardMatch, label: "All" },
];

const POOL_CHOICES = [
  { value: "any" as const, label: "Any" },
  { value: "tcg" as const, label: "TCG" },
  { value: "ocg" as const, label: "OCG" },
];

const ARCHETYPE_MODE_CHOICES = [
  { value: "member" as const, label: "Members" },
  { value: "related" as const, label: "+ Related" },
];

/** Grid order for the 3x3 arrow picker; null is the centre cell. */
const ARROW_GRID = [
  { bit: 0x040, label: "Top-Left", icon: ArrowUpLeft },
  { bit: 0x080, label: "Top", icon: ArrowUp },
  { bit: 0x100, label: "Top-Right", icon: ArrowUpRight },
  { bit: 0x008, label: "Left", icon: ArrowLeft },
  null,
  { bit: 0x020, label: "Right", icon: ArrowRight },
  { bit: 0x001, label: "Bottom-Left", icon: ArrowDownLeft },
  { bit: 0x002, label: "Bottom", icon: ArrowDown },
  { bit: 0x004, label: "Bottom-Right", icon: ArrowDownRight },
] as const;

export const ATTRIBUTE_TONE: Record<number, string> = {
  0x20: "#9a6ad6",
  0x10: "#e6cf6a",
  0x01: "#a88660",
  0x02: "#56a8dc",
  0x04: "#e2673f",
  0x08: "#6cc07a",
  0x40: "#d9b85c",
};

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section className={styles.fSection} aria-labelledby={id}>
      <div className={styles.fHead}>
        <h3 id={id} className={styles.fTitle}>{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Toggle({ pressed, onClick, children, tone }: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
  tone?: string;
}) {
  return (
    <button type="button" className={styles.toggle} aria-pressed={pressed} onClick={onClick}>
      {tone ? <span className={styles.dot} style={{ background: tone }} aria-hidden /> : null}
      {children}
    </button>
  );
}

function readBound(raw: string, max: number): number | null {
  if (raw.trim() === "") return null;
  const value = Math.trunc(Number(raw));
  if (!Number.isFinite(value)) return null;
  return Math.min(Math.max(0, value), max);
}

function RangeField({ label, range, max, step = 1, onChange }: {
  label: string;
  range: CardRange;
  max: number;
  step?: number;
  onChange: (range: CardRange) => void;
}) {
  return (
    <div className={styles.range} role="group" aria-label={label}>
      <label>
        <span className={"sr"}>{label} minimum</span>
        <input
          className={cn("input", styles.rangeInput, "num")}
          type="number"
          inputMode="numeric"
          min={0}
          max={max}
          step={step}
          placeholder="Min"
          value={range.min ?? ""}
          onChange={(event) => onChange({ ...range, min: readBound(event.target.value, max) })}
        />
      </label>
      <span className={styles.rangeDash} aria-hidden>–</span>
      <label>
        <span className={"sr"}>{label} maximum</span>
        <input
          className={cn("input", styles.rangeInput, "num")}
          type="number"
          inputMode="numeric"
          min={0}
          max={max}
          step={step}
          placeholder="Max"
          value={range.max ?? ""}
          onChange={(event) => onChange({ ...range, max: readBound(event.target.value, max) })}
        />
      </label>
    </div>
  );
}

function ArchetypePicker({ query, archetypes, onChange }: {
  query: CardQuery;
  archetypes: readonly CardArchetype[];
  onChange: (query: CardQuery) => void;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const selected = useMemo(() => {
    const out: CardArchetype[] = [];
    for (const code of query.archetypes) {
      const archetype = archetypeFor(code, archetypes);
      if (archetype && !out.includes(archetype)) out.push(archetype);
    }
    return out;
  }, [query.archetypes, archetypes]);
  const matches = useMemo(() => {
    const folded = foldCardText(text);
    if (!folded) return [];
    const starts: CardArchetype[] = [];
    const contains: CardArchetype[] = [];
    for (const archetype of archetypes) {
      if (selected.includes(archetype)) continue;
      const name = foldCardText(archetype.name);
      if (name.startsWith(folded)) starts.push(archetype);
      else if (name.includes(folded)) contains.push(archetype);
    }
    return [...starts, ...contains].slice(0, 8);
  }, [text, archetypes, selected]);

  function choose(archetype: CardArchetype) {
    onChange({ ...query, archetypes: [...new Set([...query.archetypes, ...archetype.codes])] });
    setText("");
    setOpen(false);
    setActive(0);
  }

  const expanded = open && matches.length > 0;
  return (
    <div className={styles.archetype}>
      <div className={styles.combo}>
        <input
          className={cn("input", styles.comboInput)}
          role="combobox"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={expanded ? `${listId}-${active}` : undefined}
          aria-label="Find an archetype"
          placeholder={archetypes.length ? "Blue-Eyes, Sky Striker…" : "Loading archetypes…"}
          value={text}
          disabled={archetypes.length === 0}
          onChange={(event) => { setText(event.target.value); setOpen(true); setActive(0); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(event) => {
            if (!expanded) return;
            if (event.key === "ArrowDown") { event.preventDefault(); setActive((value) => (value + 1) % matches.length); }
            if (event.key === "ArrowUp") { event.preventDefault(); setActive((value) => (value - 1 + matches.length) % matches.length); }
            if (event.key === "Enter") { event.preventDefault(); const match = matches[active]; if (match) choose(match); }
            if (event.key === "Escape") { event.stopPropagation(); setOpen(false); }
          }}
        />
        {expanded ? (
          <ul id={listId} role="listbox" className={styles.comboList} aria-label="Archetypes">
            {matches.map((archetype, index) => (
              <li
                key={archetype.name}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                className={styles.comboOption}
                onMouseDown={(event) => { event.preventDefault(); choose(archetype); }}
                onMouseEnter={() => setActive(index)}
              >
                <span>{archetype.name}</span>
                <span className={cn("num", styles.comboCount)}>{archetype.count}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {selected.length > 0 ? (
        <ul className={styles.picked} aria-label="Chosen archetypes">
          {selected.map((archetype) => (
            <li key={archetype.name}>
              <button
                type="button"
                className={cn("chip", "chip-pen", styles.chipButton)}
                aria-label={`Remove ${archetype.name}`}
                onClick={() => onChange({ ...query, archetypes: query.archetypes.filter((code) => !archetype.codes.includes(code)) })}
              >
                {archetype.name}
                <X size={12} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <DeckSegmented
        label="Archetype match"
        hideLabel
        full
        value={query.archetypeMode}
        choices={ARCHETYPE_MODE_CHOICES}
        onChange={(archetypeMode) => onChange({ ...query, archetypeMode })}
      />
      <p className={styles.fHint}>
        {query.archetypeMode === "related"
          ? "Members, plus cards that name the archetype in their name or text."
          : "Only cards that are members of the archetype."}
      </p>
    </div>
  );
}

export function CardFilters({ query, archetypes, onChange, hideLimits = false }: {
  query: CardQuery;
  archetypes: readonly CardArchetype[];
  onChange: (query: CardQuery) => void;
  /** A draft pool has no banlist, so it has no banlist status. */
  hideLimits?: boolean;
}) {
  const monsters = query.kind === "any" || query.kind === "monster";
  const spells = query.kind === "any" || query.kind === "spell";
  const traps = query.kind === "any" || query.kind === "trap";
  const set = <K extends keyof CardQuery>(key: K, value: CardQuery[K]) => onChange({ ...query, [key]: value });

  return (
    <div className={styles.fBody}>
      <Section title="Card">
        <DeckSegmented label="Card kind" hideLabel full value={query.kind} choices={KIND_CHOICES} onChange={(kind) => set("kind", kind)} />
      </Section>

      <Section title="Archetype">
        <ArchetypePicker query={query} archetypes={archetypes} onChange={onChange} />
      </Section>

      {monsters ? (
        <>
          <Section
            title="Monster card type"
            aside={query.monsterTypes.length > 1 ? (
              <DeckSegmented label="Monster type match" hideLabel value={query.monsterTypeMatch} choices={MATCH_CHOICES} onChange={(value) => set("monsterTypeMatch", value)} />
            ) : null}
          >
            <div className={styles.toggles}>
              {FRAME_KEYS.map((key) => (
                <Toggle key={key} pressed={query.monsterTypes.includes(key)} onClick={() => set("monsterTypes", toggle(query.monsterTypes, key))}>
                  {MONSTER_TYPE_LABELS[key]}
                </Toggle>
              ))}
            </div>
            <div className={styles.toggles}>
              {ABILITY_KEYS.map((key) => (
                <Toggle key={key} pressed={query.monsterTypes.includes(key)} onClick={() => set("monsterTypes", toggle(query.monsterTypes, key))}>
                  {MONSTER_TYPE_LABELS[key]}
                </Toggle>
              ))}
            </div>
          </Section>

          <Section title="Attribute">
            <div className={styles.toggles}>
              {CARD_ATTRIBUTES.map((attribute) => (
                <Toggle
                  key={attribute.bit}
                  tone={ATTRIBUTE_TONE[attribute.bit]}
                  pressed={query.attributes.includes(attribute.bit)}
                  onClick={() => set("attributes", toggle(query.attributes, attribute.bit))}
                >
                  {attribute.label}
                </Toggle>
              ))}
            </div>
          </Section>

          <Section title="Monster type">
            <div className={styles.toggles}>
              {CARD_RACES.map((race) => (
                <Toggle key={race.bit} pressed={query.races.includes(race.bit)} onClick={() => set("races", toggle(query.races, race.bit))}>
                  {race.label}
                </Toggle>
              ))}
            </div>
          </Section>

          <div className={styles.rangeGrid}>
            <Section title="Level / Rank">
              <RangeField label="Level or Rank" range={query.level} max={13} onChange={(range) => set("level", range)} />
            </Section>
            <Section title="Link rating">
              <RangeField label="Link Rating" range={query.link} max={8} onChange={(range) => set("link", range)} />
            </Section>
            <Section title="ATK">
              <RangeField label="ATK" range={query.atk} max={100000} step={100} onChange={(range) => set("atk", range)} />
            </Section>
            <Section title="DEF">
              <RangeField label="DEF" range={query.def} max={100000} step={100} onChange={(range) => set("def", range)} />
            </Section>
            <Section title="Pendulum scale">
              <RangeField label="Pendulum Scale" range={query.scale} max={13} onChange={(range) => set("scale", range)} />
            </Section>
          </div>

          <Section
            title="Link arrows"
            aside={(query.arrows & (query.arrows - 1)) !== 0 ? (
              <DeckSegmented label="Link Arrow match" hideLabel value={query.arrowMatch} choices={MATCH_CHOICES} onChange={(value) => set("arrowMatch", value)} />
            ) : null}
          >
            <div className={styles.arrows}>
              {ARROW_GRID.map((arrow, index) => {
                if (!arrow) return <span key={index} className={styles.arrowCenter} aria-hidden>Link</span>;
                const Icon = arrow.icon;
                const pressed = (query.arrows & arrow.bit) !== 0;
                return (
                  <button
                    key={arrow.bit}
                    type="button"
                    className={styles.arrow}
                    aria-pressed={pressed}
                    aria-label={`${arrow.label} Link Arrow`}
                    onClick={() => set("arrows", query.arrows ^ arrow.bit)}
                  >
                    <Icon size={16} strokeWidth={1.8} aria-hidden />
                  </button>
                );
              })}
            </div>
          </Section>
        </>
      ) : null}

      {spells ? (
        <Section title="Spell type">
          <div className={styles.toggles}>
            {SPELL_TYPE_KEYS.map((key) => (
              <Toggle key={key} pressed={query.spellTypes.includes(key)} onClick={() => set("spellTypes", toggle(query.spellTypes, key))}>
                {SPELL_TYPE_LABELS[key]}
              </Toggle>
            ))}
          </div>
        </Section>
      ) : null}

      {traps ? (
        <Section title="Trap type">
          <div className={styles.toggles}>
            {TRAP_TYPE_KEYS.map((key) => (
              <Toggle key={key} pressed={query.trapTypes.includes(key)} onClick={() => set("trapTypes", toggle(query.trapTypes, key))}>
                {TRAP_TYPE_LABELS[key]}
              </Toggle>
            ))}
          </div>
        </Section>
      ) : null}

      {hideLimits ? null : (
      <Section title="Banlist status">
        {query.banlist === "none" ? (
          <p className={styles.fHint}>Choose a banlist in the top bar to filter by Forbidden, Limited and Semi-Limited.</p>
        ) : (
          <>
            <div className={styles.toggles}>
              {CARD_LIMIT_KEYS.map((key) => (
                <Toggle key={key} pressed={query.limits.includes(key)} onClick={() => set("limits", toggle(query.limits, key))}>
                  {LIMIT_LABELS[key]}
                </Toggle>
              ))}
            </div>
            <p className={styles.fHint}>Uses the {banlistLabel(query.banlist)} list.</p>
          </>
        )}
      </Section>
      )}

      <Section title="Card pool">
        <DeckSegmented label="Card pool" hideLabel full value={query.pool} choices={POOL_CHOICES} onChange={(pool) => set("pool", pool)} />
      </Section>
    </div>
  );
}
