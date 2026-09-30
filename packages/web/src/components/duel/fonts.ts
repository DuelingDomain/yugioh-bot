import { Newsreader, Oxanium, Sofia_Sans_Extra_Condensed, Sofia_Sans_Semi_Condensed } from "next/font/google";

// Match Sheet type system. Each loader exposes one CSS variable; the duel shell
// root (and any portal that renders outside it) adds `duelFontClasses` so every
// duel module can read the variables.
//   --font-duel-ui   Sofia Sans Semi Condensed  interface text
//   --font-duel-num  Sofia Sans Extra Condensed numerals (LP, timers, ATK/DEF)
//   --font-duel-ink  Newsreader italic          handwritten ink notes
//   --font-duel-display Oxanium (variable)      LP digits and the win/lose wordmark
// Load duel fonts only here: each extra loader call ships its own @font-face set.
const duelUi = Sofia_Sans_Semi_Condensed({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-duel-ui",
});

const duelNum = Sofia_Sans_Extra_Condensed({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-duel-num",
});

const duelInk = Newsreader({
  subsets: ["latin"],
  style: "italic",
  display: "swap",
  variable: "--font-duel-ink",
});

const duelDisplay = Oxanium({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-duel-display",
});

export const duelFontClasses = `${duelUi.variable} ${duelNum.variable} ${duelInk.variable} ${duelDisplay.variable}`;
