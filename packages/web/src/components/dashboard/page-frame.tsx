import type { ReactNode } from "react";
import { PageBar, SheetRoot, type PageBarProps } from "@/components/sheet";
import styles from "./page-frame.module.css";

/**
 * A Solid Vision page: the sheet root on the floor, the page bar across the top, then the
 * page body with the usual gutters. Used by the tournaments, dashboard, leaderboard and player pages.
 */
export function PageFrame({
  children,
  bodyClassName,
  ...bar
}: Pick<PageBarProps, "title" | "sub" | "back" | "actions" | "titleAs"> & { children: ReactNode; bodyClassName?: string }) {
  return (
    <SheetRoot className={styles.root}>
      <PageBar {...bar} />
      <div className={bodyClassName ? `${styles.body} ${bodyClassName}` : styles.body}>{children}</div>
    </SheetRoot>
  );
}
