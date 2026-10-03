import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { sv } from "./sv-util";

/** D's `.ldot`: an 8px `--ink` dot with a beam halo. Breathes (opacity only); still under reduced motion. */
export function LiveDot({ you = false, label, className }: { you?: boolean; label?: string; className?: string }) {
  if (label !== undefined) {
    return (
      <span className={sv("sv-live", className)}>
        <i className="sv-ldot" data-you={you ? "true" : undefined} aria-hidden="true" />
        {label}
      </span>
    );
  }
  return (
    <i
      className={sv("sv-ldot", className)}
      data-you={you ? "true" : undefined}
      role="img"
      aria-label={you ? "Live, your duel" : "Live"}
    />
  );
}

export type StatusTone = "ready" | "warn" | "block" | "neutral";

function ToneMark({ tone }: { tone: StatusTone }) {
  const common = { viewBox: "0 0 24 24", "aria-hidden": true as const, focusable: false as const, className: "sv-status-ic" };
  if (tone === "ready") {
    return <svg {...common}><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  }
  if (tone === "warn") {
    return <svg {...common}><path d="M12 4l9 16H3Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M12 10v4.5M12 17.2v.1" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>;
  }
  if (tone === "block") {
    return <svg {...common}><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M8.5 15.5l7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
  }
  return <svg {...common}><circle cx="12" cy="12" r="3" fill="currentColor" /></svg>;
}

/** One line, no box: a mark, then the sentence, under a `--rule-lo` line. Replaces tinted notice boxes. */
export function StatusLine({ tone, icon, children, className }: { tone: StatusTone; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={sv("sv-status", className)} data-tone={tone}>
      <span className="sv-status-mark" aria-hidden="true">{icon ?? <ToneMark tone={tone} />}</span>
      <span className="sv-status-text">{children}</span>
    </div>
  );
}

/**
 * A thin beam line with tick marks at `min` and `max`. The fill is violet while `value` is in
 * range and amber when it is short or over. The fill animates with `transform: scaleX`.
 */
export function SizeBar({ value, min, max, label, className }: { value: number; min: number; max: number; label?: string; className?: string }) {
  const v = Number.isFinite(value) ? Math.max(0, value) : 0;
  const top = Math.max(max, v, 1);
  const frac = (n: number) => Math.min(1, Math.max(0, n / top));
  const state = v < min ? "short" : v > max ? "over" : "in";
  const valuetext = state === "short" ? `${v}, below the minimum of ${min}` : state === "over" ? `${v}, above the maximum of ${max}` : `${v}, within ${min} to ${max}`;
  return (
    <div
      className={sv("sv-size", className)}
      data-state={state}
      role="meter"
      aria-label={label ?? "Size"}
      aria-valuemin={0}
      aria-valuemax={top}
      aria-valuenow={v}
      aria-valuetext={valuetext}
    >
      {label !== undefined && (
        <div className="sv-size-top">
          <span className="sv-size-l">{label}</span>
          <span className="sv-size-n">{v}</span>
        </div>
      )}
      <div className="sv-size-track">
        <i className="sv-size-fill" style={{ transform: `scaleX(${frac(v)})` } as CSSProperties} />
        <i className="sv-size-tick" style={{ left: `${frac(min) * 100}%` }} />
        <i className="sv-size-tick" style={{ left: `${frac(max) * 100}%` }} />
      </div>
    </div>
  );
}

/** "Deck in" in gold (optionally "for <tournament>" as a link, optionally "Locked"), or "No deck yet". */
export function DeckMark({ state, locked = false, tournament, className }: {
  state: "in" | "none";
  locked?: boolean;
  tournament?: { name: string; href: string };
  className?: string;
}) {
  if (state === "none") {
    return (
      <span className={sv("sv-deckmark", className)} data-state="none">
        <i className="sv-deckmark-gem" aria-hidden="true" />
        No deck yet
      </span>
    );
  }
  return (
    <span className={sv("sv-deckmark", className)} data-state="in">
      <i className="sv-deckmark-gem" aria-hidden="true" />
      <span>
        Deck in
        {tournament && <> for <Link href={tournament.href}>{tournament.name}</Link></>}
      </span>
      {locked && <span className="sv-deckmark-lock">Locked</span>}
    </span>
  );
}

export type StageStep = { label: string; state: "done" | "now" | "next" };

/** Nodes on a thin light line: done is gold, now is violet, next is dashed. */
export function StageLine({ steps, label = "Progress", className }: { steps: StageStep[]; label?: string; className?: string }) {
  return (
    <ol className={sv("sv-stage", className)} aria-label={label}>
      {steps.map((step, i) => (
        <li key={`${i}-${step.label}`} data-state={step.state} aria-current={step.state === "now" ? "step" : undefined}>
          <i className="sv-stage-node" aria-hidden="true" />
          <span className="sv-stage-l">{step.label}</span>
          {step.state !== "next" && <span className="sv-sr">{step.state === "done" ? ", done" : ", current"}</span>}
        </li>
      ))}
    </ol>
  );
}
