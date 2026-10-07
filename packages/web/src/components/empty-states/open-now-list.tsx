import Link from "next/link";
import { Eye } from "lucide-react";
import { FloorList, FloorRow, LiveDot, SectionHead, SvButton } from "@/components/sheet";
import { OPEN_ROUTES, type OpenRows } from "./open-now-model";
import styles from "./empty-states.module.css";

const COLS = "minmax(0, 1fr) auto";

/**
 * "Open right now": real rows for what a member can join or watch, newest first. The top join row
 * carries the one primary button, the rest are secondary. A duels row comes last and only watches.
 * Callers show this only when `hasOpenRows` is true.
 */
export function OpenNowList({ rows, id, title = "Open right now", note, className }: {
  rows: OpenRows;
  id: string;
  title?: string;
  note?: string;
  className?: string;
}) {
  return (
    <section className={className ? `${styles.open} ${className}` : styles.open} aria-labelledby={id}>
      <SectionHead id={id} title={title} note={note} action={<LiveDot label="Live" />} />
      <FloorList aria-labelledby={id}>
        {rows.join.map((row, i) => (
          <FloorRow key={row.key} className={i === 0 ? `${styles.row} ${styles.first}` : styles.row} cols={COLS} phoneCols={COLS}>
            <div className={styles.id}>
              <Link href={row.href} className={styles.name}>{row.name}</Link>
              <ul className={styles.meta} aria-label="Details">
                <li>Open to join</li>
                {row.meta.map((piece) => <li key={piece}>{piece}</li>)}
                {row.seats && (
                  <li className={styles.seats} role="img" aria-label={`${row.seats.taken} of ${row.seats.total} seats taken`}>
                    {Array.from({ length: row.seats.total }, (_, n) => <i key={n} data-taken={n < row.seats!.taken ? "" : undefined} />)}
                  </li>
                )}
              </ul>
            </div>
            <SvButton as="a" href={row.href} variant={i === 0 ? "primary" : "ghost"} className={styles.go}>
              {row.action}
            </SvButton>
          </FloorRow>
        ))}
        {rows.watch && (
          <FloorRow className={styles.row} cols={COLS} phoneCols={COLS}>
            <div className={styles.id}>
              <Link href={rows.watch.href} className={styles.name}>{rows.watch.label}</Link>
              <ul className={styles.meta} aria-label="Details"><li>{rows.watch.hint}</li></ul>
            </div>
            <SvButton as="a" href={rows.watch.href} variant="ghost" className={styles.go}>
              <Eye size={16} aria-hidden="true" />
              Watch
            </SvButton>
          </FloorRow>
        )}
      </FloorList>
      <p className={styles.foot}>
        Nothing you want? <Link className="link" href={OPEN_ROUTES.challenge}>Challenge someone</Link> and send them the link.
      </p>
    </section>
  );
}
