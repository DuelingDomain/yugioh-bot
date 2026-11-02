import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fxLabEnabled } from "@/lib/fx-lab";
import { VisionLab } from "./vision-lab";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Card vision lab",
  robots: { index: false, follow: false },
};

export default function VisionLabPage() {
  if (!fxLabEnabled()) notFound();
  const embedder = process.env.VISION_EMBEDDER ?? 'dinov2-small-duel';
  if (!['dinov2-small-duel', 'dinov3-small'].includes(embedder)) throw new Error('VISION_EMBEDDER must be dinov2-small-duel or dinov3-small');
  return <VisionLab defaultEmbedder={embedder as 'dinov2-small-duel' | 'dinov3-small'} />;
}
