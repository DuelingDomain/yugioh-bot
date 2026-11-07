import localFont from "next/font/local";
import "./fonts-ext.css";
import styles from "./fonts.module.css";

// Match Sheet type system. Each loader exposes one CSS variable; the duel shell
// root (and any portal that renders outside it) adds `duelFontClasses` so every
// duel module can read the variables.
//   --font-duel-ui   Sofia Sans Semi Condensed  interface text
//   --font-duel-num  Sofia Sans Extra Condensed numerals (LP, timers, ATK/DEF)
//   --font-duel-ink  Newsreader italic          handwritten ink notes
//   --font-duel-display Oxanium (variable)      LP digits and the win/lose wordmark
// Load duel fonts only here: each extra loader call ships its own @font-face set.
const duelUi = localFont({
  src: "../../lib/fonts/sofia-sans-semi-condensed-1-1000-latin.woff2",
  weight: "1 1000",
  style: "normal",
  display: "swap",
  variable: "--font-duel-ui-base",
});

const duelNum = localFont({
  src: "../../lib/fonts/sofia-sans-extra-condensed-1-1000-latin.woff2",
  weight: "1 1000",
  style: "normal",
  display: "swap",
  variable: "--font-duel-num-base",
});

const duelInk = localFont({
  src: "../../lib/fonts/newsreader-italic-200-800-latin.woff2",
  weight: "200 800",
  style: "italic",
  adjustFontFallback: "Times New Roman",
  display: "swap",
  variable: "--font-duel-ink-base",
});

const duelDisplay = localFont({
  src: "../../lib/fonts/oxanium-200-800-latin.woff2",
  weight: "200 800",
  style: "normal",
  display: "swap",
  variable: "--font-duel-display-base",
});

export const duelFontClasses = `${duelUi.variable} ${duelNum.variable} ${duelInk.variable} ${duelDisplay.variable} ${styles.fonts}`;
