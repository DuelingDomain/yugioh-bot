import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { sv } from "./sv-util";

export type FloorListProps = {
  children: ReactNode;
  as?: "ul" | "ol";
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
};

/** Rows with no box, on the floor. Put `FloorRow`s inside. */
export function FloorList({ children, as = "ul", className, ...aria }: FloorListProps) {
  const List = as;
  return <List className={sv("sv-rows", className)} {...aria}>{children}</List>;
}

export type FloorRowProps = {
  /** Adds the `--pen-soft` underlay. */
  you?: boolean;
  /** Makes the whole row one link. Then do not put buttons or links in `children`. */
  href?: string;
  /** Desktop grid columns, any `grid-template-columns` value. Without it the cells flow as a flex row. */
  cols?: string;
  /** Phone (container 620px and narrower) grid columns. Without it the cells wrap as a flex row. */
  phoneCols?: string;
  /** Phone `grid-template-areas`, used with `phoneCols`. Cells pick an area with `style={{ gridArea: "nm" }}`. */
  phoneAreas?: string;
  /** Row accessible label for link rows. */
  "aria-label"?: string;
  /** Stable id (never an index) for a list that animates its reorders with `useFlipList`. */
  flipId?: string | number;
  /** The row's visible values as a string; when it changes the row gets the violet wash. */
  flipSig?: string;
  children: ReactNode;
  className?: string;
};

/**
 * A list row: no box, a `--rule-lo` line under it that brightens on hover when it is a link.
 * `li.sv-row` > `.sv-row-in` (the grid or flex line holding your cells).
 */
export function FloorRow({ you = false, href, cols, phoneCols, phoneAreas, children, className, flipId, flipSig, "aria-label": ariaLabel }: FloorRowProps) {
  const style: Record<string, string> = {};
  if (cols) style["--cols"] = cols;
  if (phoneCols) style["--cols-ph"] = phoneCols;
  if (phoneAreas) style["--areas-ph"] = phoneAreas;
  const inner = {
    className: "sv-row-in",
    style: style as CSSProperties,
    "data-cols": cols ? "true" : undefined,
    "data-phgrid": phoneCols ? "true" : undefined,
  };
  return (
    <li className={sv("sv-row", className)} data-you={you ? "true" : undefined} data-link={href ? "true" : undefined} data-flip-id={flipId} data-flip-sig={flipSig}>
      {href ? <Link href={href} aria-label={ariaLabel} {...inner}>{children}</Link> : <div {...inner}>{children}</div>}
    </li>
  );
}
