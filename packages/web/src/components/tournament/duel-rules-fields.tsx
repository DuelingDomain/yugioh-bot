"use client";

import * as React from "react";
import { DUEL_BANLIST_OPTIONS, type DuelBestOf, type DuelMode } from "@yugidraft/shared/duels";
import { turnSecondsChoices, withMode, type DuelRulesValue } from "./duel-rules";
import styles from "./duel-rules-fields.module.css";

const BEST_OF_CHOICES: ReadonlyArray<{ value: DuelBestOf; label: string }> = [
  { value: 3, label: "Best of 3" },
  { value: 1, label: "Best of 1" },
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
  return (
    <div className="fields">
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
            <label htmlFor={`${idPrefix}-mode`} className="label">
              Duel mode
            </label>
            <select
              id={`${idPrefix}-mode`}
              value={value.mode}
              disabled={disabled}
              onChange={(e) => onChange(withMode(value, e.target.value as DuelMode))}
              className={`input select ${styles.select}`}
            >
              <option value="normal">Normal</option>
              <option value="domain">Domain</option>
            </select>
          </div>
          <div>
            <label htmlFor={`${idPrefix}-banlist`} className="label">
              Banlist
            </label>
            <select
              id={`${idPrefix}-banlist`}
              value={value.banlist}
              disabled={disabled}
              onChange={(e) => onChange({ ...value, banlist: e.target.value })}
              className={`input select ${styles.select}`}
            >
              {DUEL_BANLIST_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${idPrefix}-turn`} className="label">
              Turn time
            </label>
            <select
              id={`${idPrefix}-turn`}
              value={value.turnSeconds}
              disabled={disabled}
              onChange={(e) => onChange({ ...value, turnSeconds: Number(e.target.value) })}
              className={`input select ${styles.select}`}
            >
              {turnSecondsChoices(value.turnSeconds).map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          </div>
        </>
      )}
    </div>
  );
}
