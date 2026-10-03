import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import Link from "next/link";
import { sv } from "./sv-util";

export type SvButtonVariant = "primary" | "ghost" | "danger" | "quiet";

type SvButtonCommon = {
  variant?: SvButtonVariant;
  /** 46px tall instead of 40px. */
  big?: boolean;
  /** Full width. */
  wide?: boolean;
  className?: string;
  children: ReactNode;
};
export type SvButtonProps =
  | (SvButtonCommon & { as?: "button" } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children">)
  | (SvButtonCommon & { as: "a"; href: string } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "children" | "href">);

/** Class list for an `.sv-btn`, for the rare element that cannot use `SvButton` (a submit inside a library control, say). */
export function svButtonClass(variant: SvButtonVariant = "ghost", opts: { big?: boolean; wide?: boolean } = {}): string {
  return sv("sv-btn", variant, opts.big && "big", opts.wide && "wide");
}

/** D's button set. No glow, 40px (46px with `big`). `as="a"` renders a `next/link` anchor. */
export function SvButton(props: SvButtonProps) {
  const { variant = "ghost", big, wide, className, children } = props;
  const cls = sv(svButtonClass(variant, { big, wide }), className);
  if (props.as === "a") {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { as: _as, variant: _v, big: _b, wide: _w, className: _c, children: _ch, href, ...rest } = props;
    return <Link {...rest} href={href} className={cls}>{children}</Link>;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { as: _as, variant: _v, big: _b, wide: _w, className: _c, children: _ch, type = "button", ...rest } = props;
  return <button {...rest} type={type} className={cls}>{children}</button>;
}

const DUEL_ACTIONS = {
  start: { label: "Start duel", variant: "primary" },
  open: { label: "Open duel", variant: "primary" },
  watch: { label: "Watch", variant: "ghost" },
} as const satisfies Record<string, { label: string; variant: SvButtonVariant }>;

export type DuelActionKind = keyof typeof DUEL_ACTIONS;
export const DUEL_ACTION_LABELS: Record<DuelActionKind, string> = {
  start: DUEL_ACTIONS.start.label,
  open: DUEL_ACTIONS.open.label,
  watch: DUEL_ACTIONS.watch.label,
};

/**
 * The duel trio with fixed words and styles: "Start duel" (primary), "Open duel" (primary),
 * "Watch" (ghost). With `href` it is a link; otherwise a button that takes `onClick`.
 */
export function DuelAction({ kind, href, onClick, disabled, big, wide, className }: {
  kind: DuelActionKind;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  big?: boolean;
  wide?: boolean;
  className?: string;
}) {
  const { label, variant } = DUEL_ACTIONS[kind];
  if (href) {
    return <SvButton as="a" href={href} variant={variant} big={big} wide={wide} className={className}>{label}</SvButton>;
  }
  return <SvButton variant={variant} big={big} wide={wide} className={className} onClick={onClick} disabled={disabled}>{label}</SvButton>;
}

export type SegmentedOption<T extends string> = { value: T; label: ReactNode };

/**
 * The sheet's segmented control (the existing `.seg` markup: a group of `aria-pressed` buttons),
 * wrapped so pages stop hand-writing it.
 */
export function Segmented<T extends string>({ label, value, options, onChange, disabled = false, className }: {
  label: string;
  value: T;
  options: ReadonlyArray<SegmentedOption<T>>;
  onChange?: (value: T) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={sv("seg", className)} role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" aria-pressed={option.value === value} disabled={disabled} onClick={() => onChange?.(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}
