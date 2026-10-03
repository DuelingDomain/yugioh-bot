import { createElement, type HTMLAttributes, type ReactNode } from "react";
import "@/styles/match-sheet.css";
import { duelFontClasses } from "@/components/duel/fonts";
import { cn } from "@/lib/utils";

export type SheetRootProps = {
  children?: ReactNode;
  className?: string;
  /** Size to content instead of acting as an inline-size container (sidebars, portals). */
  flow?: boolean;
  as?: "div" | "section" | "main" | "aside" | "nav" | "header";
} & Omit<HTMLAttributes<HTMLElement>, "className" | "children">;

/**
 * Root of every Match Sheet screen. All rules in match-sheet.css apply only inside an
 * element with class `ms`, so a page wraps itself in this once (or once per portal).
 */
export function SheetRoot({ children, className, flow = false, as = "div", ...rest }: SheetRootProps) {
  return createElement(as, { ...rest, className: cn(duelFontClasses, "ms", flow && "ms-flow", className) }, children);
}
