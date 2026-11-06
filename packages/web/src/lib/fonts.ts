import localFont from "next/font/local";
import "./fonts/fonts-ext.css";
import styles from "./fonts.module.css";

// Latin faces are preloaded by Next. Scoped aliases add on-demand non-Latin
// faces while keeping the existing variables on layouts and sign-in portals.
const russoOneBase = localFont({
  src: "./fonts/russo-one-400-latin.woff2",
  weight: "400",
  style: "normal",
  display: "swap",
  variable: "--font-russo-one-base",
});

const chakraPetchBase = localFont({
  src: [
    { path: "./fonts/chakra-petch-400-latin.woff2", weight: "400", style: "normal" },
    { path: "./fonts/chakra-petch-600-latin.woff2", weight: "600", style: "normal" },
    { path: "./fonts/chakra-petch-700-latin.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  variable: "--font-chakra-petch-base",
});

export const russoOne = { ...russoOneBase, variable: `${russoOneBase.variable} ${styles.russoOne}` };
export const chakraPetch = { ...chakraPetchBase, variable: `${chakraPetchBase.variable} ${styles.chakraPetch}` };
