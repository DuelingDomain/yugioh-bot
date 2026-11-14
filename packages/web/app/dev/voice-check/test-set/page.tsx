import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fxLabEnabled } from "@/lib/fx-lab";
import { VoiceTestSet } from "./voice-test-set";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Voice audio test set", robots: { index: false, follow: false } };

export default function VoiceTestSetPage() {
  if (!fxLabEnabled()) notFound();
  return <VoiceTestSet />;
}
