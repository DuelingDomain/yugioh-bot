"use client";

import * as React from "react";
import type { DraftConfig } from "@yugidraft/shared/types";
import { packsSentence } from "./create/format";
import styles from "./create/create.module.css";

export const CARDS_PER_PLAYER_MIN = 40;
export const CARDS_PER_PLAYER_MAX = 60;
export const CARDS_PER_PLAYER_DEFAULT = CARDS_PER_PLAYER_MIN;
export const PACK_SIZE_MIN = 5;
export const PACK_SIZE_DEFAULT = 15;
export const PICK_SECONDS_MIN = 5;
export const PICK_SECONDS_MAX = 300;
export const PICK_SECONDS_DEFAULT = 45;

/** The pack fields as typed. The pool lives in the pool editor, not here. */
export type DraftConfigFieldsValue = {
  cardsPerPlayerText: string;
  packSizeText: string;
  pickSecondsText: string;
  copyLimit?: boolean;
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function parseCardsPerPlayer(text: string): number {
  return clamp(parseInt(text) || CARDS_PER_PLAYER_DEFAULT, CARDS_PER_PLAYER_MIN, CARDS_PER_PLAYER_MAX);
}

function parsePackSize(text: string, cardsPerPlayer: number): number {
  return clamp(parseInt(text) || PACK_SIZE_DEFAULT, PACK_SIZE_MIN, cardsPerPlayer);
}

function parsePickSeconds(text: string): number {
  return clamp(parseInt(text) || PICK_SECONDS_DEFAULT, PICK_SECONDS_MIN, PICK_SECONDS_MAX);
}

function derivePacksPerPlayer(cardsPerPlayer: number, packSize: number): number {
  return Math.max(1, Math.ceil(cardsPerPlayer / packSize));
}

/** The pack part of a draft config: sizes and timing, clamped. */
export function configFromFields(fields: DraftConfigFieldsValue): {
  cardsPerPlayer: number;
  packSize: number;
  packsPerPlayer: number;
  pickSeconds: number;
  alternatePassDirection: boolean;
  randomizeSeats: boolean;
  copyLimit: boolean;
} {
  const cardsPerPlayer = parseCardsPerPlayer(fields.cardsPerPlayerText);
  const packSize = parsePackSize(fields.packSizeText, cardsPerPlayer);
  const pickSeconds = parsePickSeconds(fields.pickSecondsText);
  return {
    cardsPerPlayer,
    packSize,
    packsPerPlayer: derivePacksPerPlayer(cardsPerPlayer, packSize),
    pickSeconds,
    alternatePassDirection: true,
    randomizeSeats: true,
    copyLimit: fields.copyLimit ?? true,
  };
}

export function fieldsFromConfig(config: DraftConfig): DraftConfigFieldsValue {
  return {
    copyLimit: config.copyLimit ?? true,
    cardsPerPlayerText: String(config.cardsPerPlayer ?? CARDS_PER_PLAYER_DEFAULT),
    packSizeText: String(config.packSize ?? PACK_SIZE_DEFAULT),
    pickSecondsText: String(config.pickSeconds ?? PICK_SECONDS_DEFAULT),
  };
}

export function validateFields(fields: DraftConfigFieldsValue): string | null {
  const cards = parseInt(fields.cardsPerPlayerText);
  if (!cards || cards < CARDS_PER_PLAYER_MIN || cards > CARDS_PER_PLAYER_MAX) {
    return `Cards per player must be between ${CARDS_PER_PLAYER_MIN} and ${CARDS_PER_PLAYER_MAX}`;
  }
  const packSize = parseInt(fields.packSizeText);
  if (!packSize || packSize < PACK_SIZE_MIN) {
    return `Pack size must be at least ${PACK_SIZE_MIN}`;
  }
  if (packSize > cards) {
    return "Pack size cannot exceed the number of cards per player";
  }
  const secs = parseInt(fields.pickSecondsText);
  if (!secs || secs < PICK_SECONDS_MIN || secs > PICK_SECONDS_MAX) {
    return `Pick duration must be between ${PICK_SECONDS_MIN} and ${PICK_SECONDS_MAX} seconds`;
  }
  return null;
}

interface NumberFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  min: number;
  max?: number;
  unit?: string;
}

function NumberField({ id, label, value, onChange, min, max, unit }: NumberFieldProps) {
  const input = (
    <input
      className="input"
      id={id}
      type="number"
      inputMode="numeric"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      min={min}
      max={max}
    />
  );
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      {unit ? (
        <span className={styles.unit}>
          {input}
          <span aria-hidden="true">{unit}</span>
        </span>
      ) : (
        input
      )}
    </div>
  );
}

interface PackFieldsProps {
  value: DraftConfigFieldsValue;
  onChange: (value: DraftConfigFieldsValue) => void;
}

/** Cards per player, pack size and pick duration, with the sentence that says what they add up to. */
export function PackFields({ value, onChange }: PackFieldsProps) {
  const cardsPerPlayer = parseCardsPerPlayer(value.cardsPerPlayerText);
  const packSize = parsePackSize(value.packSizeText, cardsPerPlayer);
  const packsPerPlayer = derivePacksPerPlayer(cardsPerPlayer, packSize);

  return (
    <div className={`fields ${styles.three}`}>
      <NumberField
        id="cards-per-player"
        label="Cards drafted per player"
        value={value.cardsPerPlayerText}
        onChange={(v) => onChange({ ...value, cardsPerPlayerText: v })}
        min={CARDS_PER_PLAYER_MIN}
        max={CARDS_PER_PLAYER_MAX}
      />
      <NumberField
        id="pack-size"
        label="Size of each pack"
        value={value.packSizeText}
        onChange={(v) => onChange({ ...value, packSizeText: v })}
        min={PACK_SIZE_MIN}
      />
      <NumberField
        id="pick-seconds"
        label="Pick duration"
        unit="seconds"
        value={value.pickSecondsText}
        onChange={(v) => onChange({ ...value, pickSecondsText: v })}
        min={PICK_SECONDS_MIN}
        max={PICK_SECONDS_MAX}
      />
      <label className="wide"><input type="checkbox" checked={value.copyLimit ?? true} onChange={(e) => onChange({ ...value, copyLimit: e.target.checked })} /> Limit 3 copies per card</label>
      <p className="hint wide">{packsSentence(cardsPerPlayer, packsPerPlayer, packSize)}</p>
    </div>
  );
}
