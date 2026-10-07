import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SignInShell } from "@/components/auth/sign-in-shell";
import { fxLabEnabled } from "@/lib/fx-lab";
import { PreviewScreen } from "./preview-screen";
import { PREVIEW_STEPS, isPreviewStep } from "./steps";

// Read the switch and the clock on every request, not at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign-in preview",
  robots: { index: false, follow: false },
};

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * Review page for the sign-in step cards: `?step=signin|password|code|newpw|invite|invite-sso|err-username|err-invite|
 * err-signup|err-password|err-banned|err-service|signing|success`. Static props, no Clerk. Off unless DUEL_FX_LAB=1
 * (or `next dev`); see src/lib/fx-lab.ts.
 */
export default async function SignInPreviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!fxLabEnabled()) notFound();
  const step = one((await searchParams).step);

  if (!isPreviewStep(step)) {
    return (
      <main className="mx-auto max-w-xl p-6">
        <h1 className="text-xl font-semibold">Sign-in preview</h1>
        <ul className="mt-4 space-y-1">
          {PREVIEW_STEPS.map((id) => (
            <li key={id}>
              <Link className="underline" href={`/dev/sign-in-preview?step=${id}`}>{id}</Link>
            </li>
          ))}
        </ul>
      </main>
    );
  }

  return (
    <SignInShell
      marketingUrl="https://duelingdomain.com"
      packState={step === "success" ? "open" : "sealed"}
      tone={step.startsWith("err-") ? "bad" : "neutral"}
    >
      <PreviewScreen step={step} resendAvailableAt={Date.now() + 27_000} />
    </SignInShell>
  );
}
