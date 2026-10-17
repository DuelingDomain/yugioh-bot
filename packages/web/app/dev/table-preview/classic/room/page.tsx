import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fxLabEnabled } from "@/lib/fx-lab";
import { ClassicRoomPreview } from "./room-preview";

// Read the switch on every request, not at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Table preview · classic room",
  robots: { index: false, follow: false },
};

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;

/**
 * The REAL 1v1 room (DuelRoomView: header, board, corner, edge drawers) on a fixture duel. The room's network calls
 * (`/api/duels/...`) are answered in the browser from the fixture, so the page needs no login and no engine.
 * `?state=m1|summon|battle|chain|chains|damage|m2|end`, `&domain=0` (no Deck Masters). Off unless DUEL_FX_LAB=1 (or `next dev`).
 */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!fxLabEnabled()) notFound();
  const query = await searchParams;
  return <ClassicRoomPreview stateId={one(query.state)} domain={one(query.domain) !== "0"} />;
}
