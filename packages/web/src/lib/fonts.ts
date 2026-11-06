import localFont from "next/font/local";

// Shared by the app layout and sign-in surfaces, including their portals.
export const russoOne = localFont({
  src: "./fonts/russo-one-400-latin.woff2",
  weight: "400",
  style: "normal",
  display: "swap",
  variable: "--font-russo-one",
});

export const chakraPetch = localFont({
  src: [
    { path: "./fonts/chakra-petch-400-latin.woff2", weight: "400", style: "normal" },
    { path: "./fonts/chakra-petch-500-latin.woff2", weight: "500", style: "normal" },
    { path: "./fonts/chakra-petch-600-latin.woff2", weight: "600", style: "normal" },
    { path: "./fonts/chakra-petch-700-latin.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  variable: "--font-chakra-petch",
});
