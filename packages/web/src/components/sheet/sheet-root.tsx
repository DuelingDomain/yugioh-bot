import type { ReactNode } from "react";
import { duelFontClasses } from "@/components/duel/fonts";
import styles from "./sheet.module.css";

export function SheetRoot({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`${duelFontClasses} ${styles.root} ${className}`}>{children}</div>;
}
