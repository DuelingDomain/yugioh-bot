import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fxLabEnabled } from "@/lib/fx-lab";
import { KickPreview } from "./kick-preview";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Kick preview", robots: { index: false, follow: false } };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;

/**
 * The REAL duel room (DuelRoomView) as the host, on fixture duels: the lobby and the opening of every format,
 * with the host's Kick controls (kick is a lobby-only action). `?format=1v1|tag|ffa3|ffa4`, `&view=lobby|opening|list` (list = the tables page; add `&notice=kicked` for the removed-player notice), `&kickfail=1` (the kick answers an
 * error). Requests are answered in the browser. Off unless DUEL_FX_LAB=1 (or `next dev`).
 */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!fxLabEnabled()) notFound();
  const query = await searchParams;
  return <KickPreview format={one(query.format)} view={one(query.view)} fail={one(query.kickfail) === "1"} />;
}
