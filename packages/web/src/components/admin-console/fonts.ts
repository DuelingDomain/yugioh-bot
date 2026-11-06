import localFont from "next/font/local";

export const sans = localFont({
  src: "../../lib/fonts/schibsted-grotesk-400-700-latin.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
  variable: "--adm-sans",
});

export const mono = localFont({
  src: "../../lib/fonts/martian-mono-400-500-latin.woff2",
  weight: "400 500",
  style: "normal",
  display: "swap",
  variable: "--adm-mono",
});
