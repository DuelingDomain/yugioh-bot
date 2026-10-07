"use client";

import * as React from "react";
import type { DraftConfig } from "@yugidraft/shared/types";
import { packsSentence } from "./create/format";
import { Segmented, SvCheck } from "@/components/sheet";
import styles from "./create/create.module.css";

export const CARDS_PER_PLAYER_MIN = 40;
export const CARDS_PER_PLAYER_MAX = 120;
export const CARDS_PER_PLAYER_DEFAULT = CARDS_PER_PLAYER_MIN;
export const PACK_SIZE_MIN = 5;
export const PACK_SIZE_DEFAULT = 15;
export const PICK_SECONDS_MIN = 5;
export const PICK_SECONDS_MAX = 300;
export const PICK_SECONDS_DEFAULT = 45;
export const EXTRA_DECK_SIZE_MAX = 15;
export const EXTRA_DECK_SIZE_DEFAULT = 15;

/** The pack fields as typed. The pool lives in the pool editor, not here. */
export type DraftConfigFieldsValue = {
  cardsPerPlayerText: string;
  packSizeText: string;
  pickSecondsText: string;
  copyLimit?: boolean;
  /** Draft one pack of Extra Deck monsters after the main rounds. Off unless set. */
  extraDeckEnabled?: boolean;
  extraDeckSizeText?: string;
  /** Cards each player takes from a pack before it moves on. */
  picksPerStep?: 1 | 2;
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

function parseExtraSize(text: string | undefined): number {
  const n = parseInt(text ?? "");
  return Number.isNaN(n) ? EXTRA_DECK_SIZE_DEFAULT : clamp(n, 0, EXTRA_DECK_SIZE_MAX);
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
  picksPerStep: 1 | 2;
  extraDeckEnabled: boolean;
  extraDeckSize: number;
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
    picksPerStep: fields.picksPerStep ?? 1,
    extraDeckEnabled: fields.extraDeckEnabled ?? false,
    extraDeckSize: parseExtraSize(fields.extraDeckSizeText),
  };
}

export function fieldsFromConfig(config: DraftConfig): DraftConfigFieldsValue {
  return {
    copyLimit: config.copyLimit ?? true,
    cardsPerPlayerText: String(config.cardsPerPlayer ?? CARDS_PER_PLAYER_DEFAULT),
    packSizeText: String(config.packSize ?? PACK_SIZE_DEFAULT),
    pickSecondsText: String(config.pickSeconds ?? PICK_SECONDS_DEFAULT),
    picksPerStep: config.picksPerStep === 2 ? 2 : 1,
    extraDeckEnabled: config.extraDeckEnabled === true,
    extraDeckSizeText: String(config.extraDeckSize ?? EXTRA_DECK_SIZE_DEFAULT),
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
  if (fields.extraDeckEnabled) {
    const extra = parseInt(fields.extraDeckSizeText ?? "");
    if (Number.isNaN(extra) || extra < 0 || extra > EXTRA_DECK_SIZE_MAX) {
      return `Extra pack size must be between 0 and ${EXTRA_DECK_SIZE_MAX}`;
    }
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
  /** Lines under the Extra Deck round fields, such as whether the Extra pool is big enough. */
  children?: React.ReactNode;
}

/** Cards per player, pack size, picks per turn, pick duration and the Extra Deck round, with the sentence that says what they add up to. */
export function PackFields({ value, onChange, children }: PackFieldsProps) {
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
      <div className="wide">
        <span className="label" id="picks-per-step-label">Picks per turn</span>
        <Segmented
          label="Picks per turn"
          value={value.picksPerStep === 2 ? "2" : "1"}
          options={[
            { value: "1", label: "1 pick" },
            { value: "2", label: "2-Pick" },
          ]}
          onChange={(v) => onChange({ ...value, picksPerStep: v === "2" ? 2 : 1 })}
        />
        <p className="hint">{value.picksPerStep === 2 ? "Each player takes 2 cards from a pack, one after the other, before it moves on." : "Each player takes 1 card from a pack before it moves on."}</p>
      </div>
      <SvCheck
        className="wide"
        label="Draft an Extra Deck round"
        hint="After the main rounds, each player gets one pack of Extra Deck monsters only."
        checked={value.extraDeckEnabled ?? false}
        onChange={(e) => onChange({ ...value, extraDeckEnabled: e.target.checked })}
      />
      {value.extraDeckEnabled && (
        <NumberField
          id="extra-deck-size"
          label="Extra pack size"
          value={value.extraDeckSizeText ?? String(EXTRA_DECK_SIZE_DEFAULT)}
          onChange={(v) => onChange({ ...value, extraDeckSizeText: v })}
          min={0}
          max={EXTRA_DECK_SIZE_MAX}
        />
      )}
      {children}
      <SvCheck
        className="wide"
        label="Limit 3 copies per card"
        hint="Players can't take a 4th copy of any card."
        checked={value.copyLimit ?? true}
        onChange={(e) => onChange({ ...value, copyLimit: e.target.checked })}
      />
      <p className="hint wide">{packsSentence(cardsPerPlayer, packsPerPlayer, packSize)}</p>
    </div>
  );
}
