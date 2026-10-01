"use client";

import * as React from "react";
import { DUEL_BANLIST_OPTIONS, type DuelBestOf, type DuelMode } from "@yugidraft/shared/duels";
import { turnSecondsChoices, withMode, type DuelRulesValue } from "./duel-rules";

const SELECT_CLASS =
  "native-select w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:border-accent-primary focus:outline-none disabled:opacity-60";

const BEST_OF_CHOICES: ReadonlyArray<{ value: DuelBestOf; label: string }> = [
  { value: 3, label: "Best of 3" },
  { value: 1, label: "Best of 1" },
];

/**
 * Best of + basic duel rules (mode, banlist, turn time) for a tournament.
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
  return (
    <div className="space-y-4">
      <fieldset disabled={disabled}>
        <legend className="mb-1 block text-sm font-medium text-text-primary">Match length</legend>
        <div role="radiogroup" aria-label="Match length" className="inline-flex rounded-lg border border-border bg-surface p-0.5">
          {BEST_OF_CHOICES.map((choice) => {
            const selected = value.bestOf === choice.value;
            return (
              <button
                key={choice.value}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={disabled}
                onClick={() => onChange({ ...value, bestOf: choice.value })}
                className={`rounded-md px-3 py-1.5 text-sm font-medium motion-safe:transition-colors focus-visible:outline-2 focus-visible:outline-accent-primary disabled:cursor-not-allowed ${
                  selected ? "bg-accent-primary text-white" : "text-text-secondary hover:text-text-primary"
                }`}
              >
                {choice.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      {draft ? (
        <p className="rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-text-secondary">
          Draft rules: no banlist, pool decks only
        </p>
      ) : (
        <>
          <div>
            <label htmlFor={`${idPrefix}-mode`} className="mb-1 block text-sm font-medium text-text-primary">
              Duel mode
            </label>
            <select
              id={`${idPrefix}-mode`}
              value={value.mode}
              disabled={disabled}
              onChange={(e) => onChange(withMode(value, e.target.value as DuelMode))}
              className={SELECT_CLASS}
            >
              <option value="normal">Normal</option>
              <option value="domain">Domain</option>
            </select>
          </div>
          <div>
            <label htmlFor={`${idPrefix}-banlist`} className="mb-1 block text-sm font-medium text-text-primary">
              Banlist
            </label>
            <select
              id={`${idPrefix}-banlist`}
              value={value.banlist}
              disabled={disabled}
              onChange={(e) => onChange({ ...value, banlist: e.target.value })}
              className={SELECT_CLASS}
            >
              {DUEL_BANLIST_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${idPrefix}-turn`} className="mb-1 block text-sm font-medium text-text-primary">
              Turn time
            </label>
            <select
              id={`${idPrefix}-turn`}
              value={value.turnSeconds}
              disabled={disabled}
              onChange={(e) => onChange({ ...value, turnSeconds: Number(e.target.value) })}
              className={SELECT_CLASS}
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
