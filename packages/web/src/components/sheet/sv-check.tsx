import { useId, type InputHTMLAttributes } from "react";
import { sv } from "./sv-util";

export interface SvCheckProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "children" | "className"> {
  /** The accessible name. Keep it short; it is the only text inside the label. */
  label: string;
  /** A line under the label. Linked to the box with aria-describedby, not part of its name. */
  hint?: string;
  /** Title size for forms whose neighbouring options carry a bold title. */
  prominent?: boolean;
  /** Tighter row for a rail. */
  compact?: boolean;
  className?: string;
}

/** A real checkbox drawn as an 18px box: hairline border, violet fill and a white check when on. The whole row is the hit area. */
export function SvCheck({ label, hint, prominent, compact, className, id, ...input }: SvCheckProps) {
  const auto = useId();
  const inputId = id ?? `svc-${auto}`;
  const hintId = hint ? `${inputId}-h` : undefined;
  return (
    <div className={sv("sv-check", className)} data-prominent={prominent || undefined} data-compact={compact || undefined}>
      <input {...input} id={inputId} type="checkbox" className="sv-check-in" aria-describedby={hintId} />
      <label htmlFor={inputId} className="sv-check-t">{label}</label>
      {hint && <p id={hintId} className="sv-check-h">{hint}</p>}
    </div>
  );
}
