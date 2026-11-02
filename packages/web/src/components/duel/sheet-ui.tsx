"use client";

import { useId, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { ThemedSelect } from "@/components/ui/themed-select";
import { duelFontClasses } from "./fonts";
import ui from "./sheet-ui.module.css";

/** Joins class names, dropping falsy values. */
export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}

/** Root class for every pre-duel screen: tokens, slim type and the duel font variables. */
export const sheetRoot = cx(ui.root, duelFontClasses);
export const sheetPage = cx(sheetRoot, ui.page);

export type Choice<T> = { value: T; label: string; icon?: ReactNode; disabled?: boolean; description?: string; group?: string };

type ButtonKind = "primary" | "secondary" | "quiet" | "danger";
const KIND: Record<ButtonKind, string> = {
  primary: ui.btnPrimary,
  secondary: ui.btnSecondary,
  quiet: ui.btnQuiet,
  danger: ui.btnDanger,
};

/** Class list for a Match Sheet button; also used on links. */
export function sheetButtonClass(kind: ButtonKind = "secondary", size: "sm" | "md" | "lg" = "md", block = false): string {
  return cx(ui.btn, KIND[kind], size === "sm" && ui.btnSm, size === "lg" && ui.btnLg, block && ui.btnBlock);
}

export function SheetButton({
  kind = "secondary", size = "md", block = false, loading = false, className, children, disabled, type = "button", ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  kind?: ButtonKind;
  size?: "sm" | "md" | "lg";
  block?: boolean;
  loading?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button type={type} className={cx(sheetButtonClass(kind, size, block), className)}
      disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <Loader2 size={16} className={ui.spin} aria-hidden /> : null}
      {children}
    </button>
  );
}

/** Themed select (button + listbox, bottom sheet on phones) with the sheet's slim styling. A hidden native select keeps `testId` + `selectOption` working. */
export function SheetSelect<T extends string | number | boolean>({
  label, value, choices, onChange, disabled = false, compact = false, className, hideLabel = false, describedBy, testId, ariaLabel,
}: {
  label: string;
  value: T;
  choices: readonly Choice<T>[];
  onChange?: (value: T) => void;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
  hideLabel?: boolean;
  /** The id of text that explains the select, such as a hint under it. */
  describedBy?: string;
  /** Test id of the hidden native select element. */
  testId?: string;
  /** Accessible name that replaces the visible label for screen readers, such as when several selects share one label. */
  ariaLabel?: string;
}) {
  return (
    <ThemedSelect label={label} value={value} choices={choices} onChange={onChange} disabled={disabled} compact={compact}
      className={className} hideLabel={hideLabel} describedBy={describedBy} testId={testId} ariaLabel={ariaLabel} />
  );
}

/** Two to four mutually exclusive options as a radio group (arrow keys and labels work natively). */
export function SheetSegmented<T extends string | number | boolean>({
  label, value, choices, onChange, disabled = false, full = false, hideLabel = false, describedBy,
}: {
  label: string;
  value: T;
  choices: readonly Choice<T>[];
  onChange?: (value: T) => void;
  disabled?: boolean;
  full?: boolean;
  hideLabel?: boolean;
  /** Id of the hint that explains the group. */
  describedBy?: string;
}) {
  const name = useId();
  return (
    <div role="radiogroup" aria-label={label} aria-describedby={describedBy} style={{ minWidth: 0 }}>
      {hideLabel ? null : <span className={ui.label}>{label}</span>}
      <div className={cx(ui.seg, full && ui.segFull)}>
        {choices.map((choice) => (
          <label key={String(choice.value)} className={ui.segOption}>
            <input type="radio" name={name} className={ui.srOnly} disabled={disabled}
              checked={choice.value === value} onChange={() => onChange?.(choice.value)} />
            <span>{choice.icon}{choice.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
