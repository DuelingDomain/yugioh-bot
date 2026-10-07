import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SheetRoot } from "@/components/sheet";
import { fxLabEnabled } from "@/lib/fx-lab";
import { DeleteAccountPreview } from "./preview";
import { PREVIEW_STATES, isPreviewState } from "./states";

// Read the switch on every request, not at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Delete account preview",
  robots: { index: false, follow: false },
};

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * Review page for the delete account section: `?state=idle|typed|pending|mismatch|retry|server|signed_out`. The real
 * view with fixed state and no network. Off unless DUEL_FX_LAB=1 (or `next dev`); see src/lib/fx-lab.ts.
 */
export default async function DeleteAccountPreviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!fxLabEnabled()) notFound();
  const state = one((await searchParams).state);
  if (!isPreviewState(state)) {
    return (
      <main className="mx-auto max-w-xl p-6">
        <h1 className="text-xl font-semibold">Delete account preview</h1>
        <ul className="mt-4 space-y-1">
          {PREVIEW_STATES.map((id) => (
            <li key={id}><Link className="underline" href={`/dev/delete-account-preview?state=${id}`}>{id}</Link></li>
          ))}
        </ul>
      </main>
    );
  }
  return (
    <SheetRoot as="main" className="set-page" style={{ padding: "32px clamp(16px, 4vw, 48px)", minHeight: "100vh" }}>
      <DeleteAccountPreview state={state} />
    </SheetRoot>
  );
}
