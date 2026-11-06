import localFont from "next/font/local";
import "./fonts-ext.css";
import styles from "./fonts.module.css";

const sansBase = localFont({
  src: "../../lib/fonts/schibsted-grotesk-400-700-latin.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
  variable: "--adm-sans-base",
});

const monoBase = localFont({
  src: "../../lib/fonts/martian-mono-400-500-latin.woff2",
  weight: "400 500",
  style: "normal",
  display: "swap",
  variable: "--adm-mono-base",
});

export const sans = { ...sansBase, variable: `${sansBase.variable} ${styles.sans}` };
export const mono = { ...monoBase, variable: `${monoBase.variable} ${styles.mono}` };
