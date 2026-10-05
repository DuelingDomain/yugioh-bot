import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TABLE_STATE_IDS } from "@/components/duel/table/fixtures/common";
import { SOLID_STATE_IDS as CLASSIC_STATE_IDS } from "@/components/duel/solid/fixtures/states";
import { fxLabEnabled } from "@/lib/fx-lab";

// Read the switch on every request, not at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Table preview",
  robots: { index: false, follow: false },
};

const MODES = [
  { id: "ffa3", title: "3-way free-for-all" },
  { id: "ffa4", title: "4-way free-for-all" },
  { id: "tag", title: "2v2 tag duel" },
] as const;

/** Index of the multiplayer table previews: three modes, nine states each. Off unless DUEL_FX_LAB=1 (or `next dev`). */
export default function TablePreviewIndex() {
  if (!fxLabEnabled()) notFound();
  return (
    <main style={{ padding: 24, maxWidth: 880, margin: "0 auto", color: "#efe7d5", background: "#070b15", minHeight: "100dvh", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 20, margin: "0 0 4px" }}>Multiplayer table preview</h1>
      <p style={{ margin: "0 0 20px", color: "#c3bba8", fontSize: 14 }}>
        Fixture duels, no engine. Add <code>?cam=home|overview|fly|focus:&lt;seat&gt;|look:&lt;seat&gt;</code>, <code>&amp;lock=&lt;reason&gt;</code> or <code>&amp;reduced=1</code> to any link.
      </p>
      {MODES.map((mode) => (
        <section key={mode.id} style={{ marginBottom: 18 }}>
          <h2 style={{ fontSize: 15, margin: "0 0 8px" }}>
            <Link href={`/dev/table-preview/${mode.id}`} style={{ color: "#c6b6ff" }}>{mode.title}</Link>
          </h2>
          <ul style={{ display: "flex", flexWrap: "wrap", gap: 8, listStyle: "none", margin: 0, padding: 0, fontSize: 13 }}>
            {TABLE_STATE_IDS.map((id) => (
              <li key={id}>
                <Link href={`/dev/table-preview/${mode.id}?state=${id}`} style={{ color: "#efe7d5", border: "1px solid rgb(181 153 99 / 0.34)", borderRadius: 4, padding: "4px 8px", display: "inline-block" }}>
                  {id}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <section style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: 15, margin: "0 0 8px" }}>
          <Link href="/dev/table-preview/classic" style={{ color: "#c6b6ff" }}>Classic 1v1 room (field, phase hub, station track)</Link>
        </h2>
        <ul style={{ display: "flex", flexWrap: "wrap", gap: 8, listStyle: "none", margin: 0, padding: 0, fontSize: 13 }}>
          {CLASSIC_STATE_IDS.map((id) => (
            <li key={id}>
              <Link href={`/dev/table-preview/classic?state=${id}`} style={{ color: "#efe7d5", border: "1px solid rgb(181 153 99 / 0.34)", borderRadius: 4, padding: "4px 8px", display: "inline-block" }}>
                {id}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
