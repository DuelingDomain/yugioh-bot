import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fxLabEnabled } from "@/lib/fx-lab";
import { VoiceCheck } from "./voice-check";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Voice command check",
  robots: { index: false, follow: false },
};

export default function VoiceCheckPage() {
  if (!fxLabEnabled()) notFound();
  return <VoiceCheck />;
}
