"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { segmentSlide } from "@/components/sheet";
import { cn } from "@/lib/utils";

/** Deck controls use the Match Sheet's foundation classes. */
export function DeckButton({ kind = "secondary", size = "sm", loading, block, className, children, disabled, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  kind?: "primary" | "secondary" | "quiet" | "danger";
  size?: "sm";
  loading?: boolean;
  block?: boolean;
  children?: ReactNode;
}) {
  return <button type="button" {...props} disabled={disabled || loading} aria-busy={loading || undefined} className={cn("btn", `btn-${kind}`, size && "btn-sm", block && "btn-block", className)}>{children}</button>;
}

export function DeckSegmented<T extends string>({ label, value, choices, onChange, disabled, className, full, hideLabel = true }: {
  label: string;
  value: T;
  choices: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
  full?: boolean;
  hideLabel?: boolean;
}) {
  return (
    <div className={className}>
      {hideLabel ? null : <span className="label">{label}</span>}
      <div className="seg" role="group" aria-label={label} {...segmentSlide(choices.length, choices.findIndex((choice) => choice.value === value), full ? { display: "grid" } : undefined)}>
        {choices.map((choice) => <button key={choice.value} type="button" aria-pressed={value === choice.value} disabled={disabled} onClick={() => onChange(choice.value)}>{choice.label}</button>)}
      </div>
    </div>
  );
}

export function DeckSelect<T extends string>({ label, value, choices, onChange, className, disabled }: {
  label: string;
  value: T;
  choices: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  className?: string;
  disabled?: boolean;
  hideLabel?: boolean;
  compact?: boolean;
}) {
  return <label className={className}><span className="sr">{label}</span><select className="input select" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value as T)}>{choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</select></label>;
}
