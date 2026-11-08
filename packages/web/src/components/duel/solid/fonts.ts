import localFont from "next/font/local";
import "./fonts-ext.css";
import styles from "./fonts.module.css";

// Solid Vision type system (3D mode). Each loader exposes one CSS variable; SolidRoom puts `solidFontClasses`
// on its root, and on any portal that renders outside it, so every solid module can read the variables.
//   --sv-font      Barlow Semi Condensed  interface text
//   --sv-font-num  Barlow Condensed       numerals (LP, timers, ATK/DEF)
// Load them only here: each extra loader call ships its own @font-face set. The classic board never loads them
// (SolidRoom is a lazy chunk).
const svUi = localFont({
  src: [
    { path: "../../../lib/fonts/barlow-semi-condensed-300-latin.woff2", weight: "300", style: "normal" },
    { path: "../../../lib/fonts/barlow-semi-condensed-400-latin.woff2", weight: "400", style: "normal" },
    { path: "../../../lib/fonts/barlow-semi-condensed-500-latin.woff2", weight: "500", style: "normal" },
    { path: "../../../lib/fonts/barlow-semi-condensed-600-latin.woff2", weight: "600", style: "normal" },
  ],
  display: "swap",
  variable: "--sv-font-base",
});

const svNum = localFont({
  src: [
    { path: "../../../lib/fonts/barlow-condensed-300-latin.woff2", weight: "300", style: "normal" },
    { path: "../../../lib/fonts/barlow-condensed-400-latin.woff2", weight: "400", style: "normal" },
    { path: "../../../lib/fonts/barlow-condensed-500-latin.woff2", weight: "500", style: "normal" },
  ],
  display: "swap",
  variable: "--sv-font-num-base",
});

export const solidFontClasses = `${svUi.variable} ${svNum.variable} ${styles.fonts}`;
