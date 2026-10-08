import { ClerkProvider } from "@clerk/nextjs";
import { MarketingSessionHint } from "@/components/auth/marketing-session-hint";
import { connection } from "next/server";
import { isE2EAuthEnabled } from "@/lib/e2e-auth";
import type { Metadata } from "next";
import { Russo_One, Chakra_Petch } from "next/font/google";
import { DuelNavigationGuard } from "@/lib/hooks/use-duel-leave-guard";
import "./globals.css";

const russoOne = Russo_One({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-russo-one",
});

const chakraPetch = Chakra_Petch({
  weight: ["400", "600", "700"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-chakra-petch",
});

export const metadata: Metadata = {
  title: "Dueling Domain",
  description: "Manage your Yu-Gi-Oh! tournaments with ease",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await connection();
  const content = <><DuelNavigationGuard />{children}</>;
  return (
    <html lang="en" className={`${russoOne.variable} ${chakraPetch.variable} dark`}>
      <body className="min-h-screen bg-bg-deep text-text-primary antialiased">
        {isE2EAuthEnabled() ? content : <ClerkProvider signInUrl="/sign-in" signUpUrl="/sign-up" waitlistUrl={`${process.env.MARKETING_URL?.replace(/\/+$/, "") || "https://duelingdomain.com"}/#join`} appearance={{ variables: { colorPrimary: "#9b7cff", colorBackground: "#16151c", colorForeground: "#f2f0f6", borderRadius: "0.75rem" } }}><MarketingSessionHint />{content}</ClerkProvider>}
      </body>
    </html>
  );
}
