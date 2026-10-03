import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { sv } from "./sv-util";

export type PageBarProps = {
  back?: { href: string; label: string };
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  /** Element for the title. Default `h1`. */
  titleAs?: "h1" | "h2" | "p";
  className?: string;
};

/**
 * Solid Vision's page bar: 68px on `--panel` with a `--rule-lo` line under it (56px on a phone).
 * A 36px chevron back control, a title with an `--ink-3` second line, and actions on the right.
 */
export function PageBar({ back, title, sub, actions, titleAs = "h1", className }: PageBarProps) {
  const Title = titleAs;
  return (
    <header className={sv("sv-bar", className)}>
      <div className="sv-bar-id">
        {back && (
          <Link className="sv-bar-back" href={back.href} aria-label={back.label} title={back.label}>
            <ChevronLeft size={18} strokeWidth={2} aria-hidden="true" />
          </Link>
        )}
        <div className="sv-bar-name">
          <Title className="sv-bar-title">{title}</Title>
          {sub != null && sub !== false && <div className="sv-bar-sub">{sub}</div>}
        </div>
      </div>
      {actions != null && actions !== false && <div className="sv-bar-actions">{actions}</div>}
    </header>
  );
}

export type SectionHeadProps = {
  title: ReactNode;
  /** Quiet `--ink-3` text on the right. */
  note?: ReactNode;
  as?: "h2" | "h3";
  /** A control on the far right, after the note. */
  action?: ReactNode;
  className?: string;
  id?: string;
};

/** Sentence-case Oxanium heading, an `--ink-3` note on the right, and a `--rule-lo` line under it. */
export function SectionHead({ title, note, as = "h2", action, className, id }: SectionHeadProps) {
  const Heading = as;
  return (
    <div className={sv("sv-head", as === "h3" && "sm", className)}>
      <Heading className="sv-head-t" id={id}>{title}</Heading>
      {note != null && note !== false && <span className="sv-head-note">{note}</span>}
      {action != null && action !== false && <span className="sv-head-act">{action}</span>}
    </div>
  );
}
