"use client";

import * as React from "react";
import { DUEL_BANLIST_OPTIONS, type DuelBestOf, type DuelMode } from "@yugidraft/shared/duels";
import { ThemedSelect } from "@/components/ui/themed-select";
import { MAX_GENESYS_POINT_CAP } from "../duel/genesys";
import { duelRulesProblem, turnSecondsChoices, withGenesys, withGenesysCapText, withMode, type DuelRulesValue } from "./duel-rules";
import styles from "./duel-rules-fields.module.css";

const BEST_OF_CHOICES: ReadonlyArray<{ value: DuelBestOf; label: string }> = [
  { value: 3, label: "Best of 3" },
  { value: 1, label: "Best of 1" },
];

const MODE_CHOICES: ReadonlyArray<{ value: DuelMode; label: string }> = [
  { value: "normal", label: "Normal" },
  { value: "domain", label: "Domain" },
];
const GENESYS_CHOICES: ReadonlyArray<{ value: "off" | "on"; label: string }> = [
  { value: "off", label: "Off" },
  { value: "on", label: "On, with a point cap" },
];

/**
 * Best of + basic duel rules (mode, banlist, turn time) for a tournament, on the Match Sheet
 * form classes. It renders its own `.fields` grid, so it must sit inside a `.ms` root.
 * `draft` keeps only the Best of choice: draft tournaments have fixed rules.
 */
export function DuelRulesFields({
  idPrefix,
  value,
  onChange,
  draft = false,
  disabled = false,
}: {
  idPrefix: string;
  value: DuelRulesValue;
  onChange: (next: DuelRulesValue) => void;
  draft?: boolean;
  disabled?: boolean;
}) {
  const lengthId = `${idPrefix}-length`;
  const capProblem = duelRulesProblem(value);
  return (
    <div className={`fields ${styles.fields}`}>
      <div className="wide">
        <span className="label" id={lengthId}>
          Match length
        </span>
        <div role="radiogroup" aria-labelledby={lengthId} className={`seg ${styles.seg}`}>
          {BEST_OF_CHOICES.map((choice) => {
            const selected = value.bestOf === choice.value;
            return (
              <button
                key={choice.value}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-pressed={selected}
                disabled={disabled}
                onClick={() => onChange({ ...value, bestOf: choice.value })}
              >
                {choice.label}
              </button>
            );
          })}
        </div>
      </div>

      {draft ? (
        <p className={`wide ${styles.note}`}>Draft rules: no banlist, pool decks only</p>
      ) : (
        <>
          <div>
            <ThemedSelect
              label="Duel mode"
              testId={`${idPrefix}-mode`}
              value={value.mode}
              disabled={disabled}
              onChange={(mode) => onChange(withMode(value, mode))}
              choices={MODE_CHOICES}
            />
          </div>
          <div>
            <ThemedSelect
              label="Genesys format"
              testId={`${idPrefix}-genesys`}
              value={value.genesys ? "on" : "off"}
              disabled={disabled}
              onChange={(next) => onChange(withGenesys(value, next === "on"))}
              choices={GENESYS_CHOICES}
            />
          </div>
          {value.genesys ? (
            <div>
              <label htmlFor={`${idPrefix}-cap`} className="label">
                Point cap per deck
              </label>
              <input
                id={`${idPrefix}-cap`}
                type="number"
                inputMode="numeric"
                min={0}
                max={MAX_GENESYS_POINT_CAP}
                step={1}
                value={value.capText ?? String(value.genesys.pointCap)}
                disabled={disabled}
                aria-invalid={capProblem != null}
                aria-describedby={`${idPrefix}-cap-hint`}
                onChange={(e) => onChange(withGenesysCapText(value, e.target.value))}
                className={`input ${styles.select}`}
              />
              <p id={`${idPrefix}-cap-hint`} className={styles.note} role={capProblem ? "alert" : undefined}>
                {capProblem ?? "Main, Extra and Side count. Each duelist is checked alone."}
              </p>
            </div>
          ) : null}
          <div>
            <ThemedSelect
              label="Banlist"
              testId={`${idPrefix}-banlist`}
              value={value.banlist}
              disabled={disabled || value.genesys != null}
              onChange={(banlist) => onChange({ ...value, banlist })}
              choices={DUEL_BANLIST_OPTIONS.map((option) => ({ value: option.id, label: option.label }))}
            />
          </div>
          <div>
            <ThemedSelect
              label="Turn time"
              testId={`${idPrefix}-turn`}
              value={value.turnSeconds}
              disabled={disabled}
              onChange={(turnSeconds) => onChange({ ...value, turnSeconds })}
              choices={turnSecondsChoices(value.turnSeconds)}
            />
          </div>
        </>
      )}
    </div>
  );
}
