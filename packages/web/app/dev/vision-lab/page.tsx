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
  return <VisionLab />;
}
