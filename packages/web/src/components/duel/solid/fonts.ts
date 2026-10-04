import { Barlow_Condensed, Barlow_Semi_Condensed } from "next/font/google";

// Solid Vision type system (3D mode). Each loader exposes one CSS variable; SolidRoom puts `solidFontClasses`
// on its root, and on any portal that renders outside it, so every solid module can read the variables.
//   --sv-font      Barlow Semi Condensed  interface text
//   --sv-font-num  Barlow Condensed       numerals (LP, timers, ATK/DEF)
// Load them only here: each extra loader call ships its own @font-face set. The classic board never loads them
// (SolidRoom is a lazy chunk).
const svUi = Barlow_Semi_Condensed({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  display: "swap",
  variable: "--sv-font",
});

const svNum = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  display: "swap",
  variable: "--sv-font-num",
});

export const solidFontClasses = `${svUi.variable} ${svNum.variable}`;
