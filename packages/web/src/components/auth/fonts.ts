import localFont from "next/font/local";
import { russoOne } from "@/lib/fonts";
import styles from "./fonts.module.css";

// Sign-in has always used four Latin weights. The app layout uses 400/600/700.
const body = localFont({
  src: [
    { path: "../../lib/fonts/chakra-petch-400-latin.woff2", weight: "400", style: "normal" },
    { path: "../../lib/fonts/chakra-petch-500-latin.woff2", weight: "500", style: "normal" },
    { path: "../../lib/fonts/chakra-petch-600-latin.woff2", weight: "600", style: "normal" },
    { path: "../../lib/fonts/chakra-petch-700-latin.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  variable: "--font-sign-in-body",
});

export const signInFontClasses = `${body.variable} ${russoOne.variable} ${styles.fonts}`;
