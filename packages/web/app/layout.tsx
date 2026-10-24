import { PageViews } from "@/lib/analytics/page-views";
import { ClerkProvider } from "@clerk/nextjs";
import { MarketingSessionHint } from "@/components/auth/marketing-session-hint";
import { SessionTokenProvider } from "@/components/auth/session-token";
import { waitlistHref } from "@/components/auth/marketing-links";
import { marketingUrlFromEnv } from "@/lib/auth-page-params";
import { connection } from "next/server";
import { E2E_SESSION_COOKIE, isE2EAuthEnabled, verifyE2ESession } from "@/lib/e2e-auth";
import { cookies } from "next/headers";
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
  const e2e = isE2EAuthEnabled();
  const e2eUserId = e2e ? verifyE2ESession((await cookies()).get(E2E_SESSION_COOKIE)?.value, process.env.E2E_AUTH_SECRET ?? "") : null;
  const content = <SessionTokenProvider e2e={e2e} e2eUserId={e2eUserId === null ? null : String(e2eUserId)}><PageViews /><DuelNavigationGuard />{children}</SessionTokenProvider>;
  return (
    <html lang="en" className={`${russoOne.variable} ${chakraPetch.variable} dark`}>
      <body className="min-h-screen bg-bg-deep text-text-primary antialiased">
        {isE2EAuthEnabled() ? content : <ClerkProvider signInUrl="/sign-in" signUpUrl="/sign-up" waitlistUrl={waitlistHref(marketingUrlFromEnv())} appearance={{ variables: { colorPrimary: "#9b7cff", colorBackground: "#16151c", colorForeground: "#f2f0f6", borderRadius: "0.75rem" } }}><MarketingSessionHint />{content}</ClerkProvider>}
      </body>
    </html>
  );
}
