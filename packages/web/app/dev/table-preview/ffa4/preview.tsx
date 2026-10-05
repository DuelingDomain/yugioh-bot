"use client";

import { useEffect, useMemo, useState } from "react";
import { FFA4_FIXTURES, ffa4Variant } from "@/components/duel/table/fixtures/ffa4";
import { reviewFixtures } from "@/components/duel/table/fixtures/review";
import { PreviewHarness } from "@/components/duel/table/fixtures/preview-harness";
import { TableShell } from "@/components/duel/table/table-shell";

/** The 4-way preview: the real table stage on the hand-made fixtures. */
export function Ffa4Preview({ stateId, cam, lock, review = false, out = null, pick = null, after = null, hub = null }: { stateId: string | null; cam: string | null; lock: string | null; review?: boolean; out?: string | null; pick?: string | null; after?: string | null; hub?: string | null }) {
  // `?out=2,3` sweeps those seats; `?after=1500` starts with them alive and sweeps them after that many ms (to watch the
  // crumble and the finale move); `?pick=field|hand|emz` swaps the prompt for a pick among your own cards.
  const outSeats = useMemo(() => (out ?? "").split(",").filter((part) => /^[0-3]$/.test(part)).map(Number), [out]);
  const delay = after != null && /^\d+$/.test(after) ? Number(after) : null;
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (delay == null) return;
    const timer = window.setTimeout(() => setLate(true), delay);
    return () => window.clearTimeout(timer);
  }, [delay]);
  // The pick prompt arrives after the board is measured (a prompt that is there at mount would be routed to the card
  // strip, because no zone is drawn yet), as it does in a real duel.
  const [pickLive, setPickLive] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setPickLive(true), 700);
    return () => window.clearTimeout(timer);
  }, []);
  // The Elimination menu (as in the design demo): two scripted runs, the first seat goes out, then the second 2.6 s later.
  const [menuOpen, setMenuOpen] = useState(false);
  const [script, setScript] = useState<{ name: keyof typeof ELIMINATION_RUNS; step: number } | null>(null);
  useEffect(() => {
    if (!script) return;
    const run = ELIMINATION_RUNS[script.name];
    if (script.step >= run.seats.length) return;
    const timer = window.setTimeout(() => setScript({ name: script.name, step: script.step + 1 }), script.step === 0 ? 400 : 2600);
    return () => window.clearTimeout(timer);
  }, [script]);
  const scripted = script ? ELIMINATION_RUNS[script.name].seats.slice(0, script.step).at(-1) ?? [] : null;
  const base = useMemo(() => review ? reviewFixtures(0, "ffa4") : FFA4_FIXTURES, [review]);
  const kind = pick === "field" || pick === "hand" || pick === "emz" ? pick : null;
  const set = useMemo(() => ffa4Variant(base, { out: scripted ?? (delay != null && !late ? [] : outSeats), pick: pickLive ? kind : null }), [base, outSeats, delay, late, kind, pickLive, scripted?.join(",")]);
  const startRun = (name: keyof typeof ELIMINATION_RUNS) => {
    setMenuOpen(false);
    setScript({ name, step: 0 });
  };
  return (
    <>
    <PreviewHarness
      set={set}
      stateId={stateId}
      cam={cam}
      lock={lock}
      basePath="/dev/table-preview/ffa4"
      renderStage={(controller, state, preview) => (
        <TableShell
          controller={controller}
          initialCamera={{ mode: preview.cam.mode, focusSeat: preview.cam.focusSeat, lookSeat: preview.cam.lookSeat, ...state.ui?.camera }}
          initialLock={preview.lock}
          initialOutOrder={state.ui?.initialOutOrder}
          chainMode={preview.chainMode}
          hubPlace={hub === "center" ? "center" : "band"}
        />
      )}
    />
    <div style={{ position: "fixed", top: 3, right: 12, zIndex: 60, font: "12px system-ui, sans-serif" }}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => (script ? setScript(null) : setMenuOpen((open) => !open))}
        style={{ height: 22, padding: "0 10px", borderRadius: 6, border: "1px solid #b59963", background: "#1a1408", color: "#ffe3ae", cursor: "pointer" }}
      >
        {script ? "Reset" : "Elimination"}
      </button>
      {menuOpen && (
        <div role="menu" style={{ position: "absolute", right: 0, top: 28, width: 300, display: "flex", flexDirection: "column", gap: 4, padding: 6, borderRadius: 14, background: "#0a1120", border: "1px solid rgb(181 153 99 / .34)" }}>
          {(Object.keys(ELIMINATION_RUNS) as (keyof typeof ELIMINATION_RUNS)[]).map((name) => (
            <button key={name} type="button" role="menuitem" onClick={() => startRun(name)} style={{ textAlign: "left", padding: "8px 10px", borderRadius: 9, border: "1px solid transparent", background: "transparent", color: "#c3bba8", cursor: "pointer" }}>
              <b style={{ display: "block", color: "#ffe3ae", fontSize: 12.5, fontWeight: 600 }}>{ELIMINATION_RUNS[name].title}</b>
              <span style={{ fontSize: 11, lineHeight: 1.35 }}>{ELIMINATION_RUNS[name].note}</span>
            </button>
          ))}
        </div>
      )}
    </div>
    </>
  );
}

const ELIMINATION_RUNS = {
  same: { seats: [[2], [2, 3]], title: "Elimination: same pair left", note: "Juniper, then Mirelle out. Aster and Rook move to one full 1v1 board." },
  cross: { seats: [[1], [1, 3]], title: "Elimination: cross pairs left", note: "Rook, then Mirelle out. Aster and Juniper stay where they are." },
} as const;
