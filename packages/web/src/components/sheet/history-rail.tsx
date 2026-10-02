import { useId, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The duel log: results, ledgers and activity. */
export function HistoryRail({ title, aside, children, headingLevel = 3, className, ...rest }: {
  title: ReactNode;
  /** A string goes in `<small>`; any other node (a link) is rendered as given. */
  aside?: ReactNode;
  children?: ReactNode;
  headingLevel?: 2 | 3;
  className?: string;
} & Omit<HTMLAttributes<HTMLElement>, "title" | "className" | "children">) {
  const headingId = `${useId()}-t`;
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const hasAside = aside !== undefined && aside !== null && aside !== false && aside !== "";
  return (
    <section {...rest} className={cn("hr", className)} aria-labelledby={headingId}>
      <header className="hr-cap">
        <Heading id={headingId}>{title}</Heading>
        {hasAside && (typeof aside === "string" || typeof aside === "number" ? <small>{aside}</small> : aside)}
      </header>
      <ol className="hr-list">{children}</ol>
    </section>
  );
}

/** A sticky day / turn header between rows. */
export function HistoryTurn({ children, className }: { children: ReactNode; className?: string }) {
  return <li className={cn("hr-turn", className)}>{children}</li>;
}

/**
 * One log row. `own`: "me" = purple spine, "them" = dashed spine, "none" = no spine.
 * `chain` tints a row someone owes a reply to; `latest` marks the newest live entry.
 */
export function HistoryRow({ own, chain, latest, thumb, score, meta, children, className, ...rest }: {
  own?: "me" | "them" | "none";
  chain?: boolean;
  latest?: boolean;
  thumb?: ReactNode;
  /** Optional leading score or result (`.hr-sc`). */
  score?: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
  className?: string;
} & Omit<HTMLAttributes<HTMLLIElement>, "className" | "children">) {
  return (
    <li
      {...rest}
      className={cn("hr-row", className)}
      data-own={own}
      data-chain={chain ? "" : undefined}
      data-latest={latest ? "" : undefined}
    >
      {thumb != null && <span className="hr-th">{thumb}</span>}
      {score != null && <span className="hr-sc">{score}</span>}
      <span className="hr-tx">{children}</span>
      {meta != null && <span className="hr-mt">{meta}</span>}
    </li>
  );
}
