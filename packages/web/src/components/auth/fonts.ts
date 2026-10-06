import localFont from "next/font/local";

const body = localFont({
  src: [
    { path: "./fonts/chakra-petch-400-latin.woff2", weight: "400", style: "normal" },
    { path: "./fonts/chakra-petch-500-latin.woff2", weight: "500", style: "normal" },
    { path: "./fonts/chakra-petch-600-latin.woff2", weight: "600", style: "normal" },
    { path: "./fonts/chakra-petch-700-latin.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  variable: "--font-sign-in-body",
});

const display = localFont({
  src: "./fonts/russo-one-400-latin.woff2",
  weight: "400",
  style: "normal",
  display: "swap",
  variable: "--font-sign-in-display",
});

export const signInFontClasses = `${body.variable} ${display.variable}`;
