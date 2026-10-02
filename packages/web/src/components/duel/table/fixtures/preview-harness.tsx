"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { duelFontClasses } from "../../fonts";
import type { CameraLockReason, CameraMode, TableController } from "../types";
import { TABLE_STATE_IDS, isTableStateId, type TableFixtureSet, type TableFixtureState } from "./common";
import { useFixtureController } from "./use-fixture-controller";
import styles from "./preview-harness.module.css";

/**
 * Camera preset from the `cam` query: `home`, `overview`, `fly`, `focus:<seat>` or `look:<seat>`.
 * The stage turns it into its own CameraState (initialCamera) and applies `state.ui.camera` on top.
 */
export interface PreviewCam {
  mode: CameraMode;
  focusSeat: number | null;
  lookSeat: number | null;
}

const LOCK_REASONS: readonly CameraLockReason[] = ["chain", "battle", "direct", "destroy", "elimination"];

export function parsePreviewCam(raw: string | null | undefined): PreviewCam {
  const [kind, seatText] = (raw ?? "home").split(":");
  const seat = seatText != null && /^\d+$/.test(seatText) ? Number(seatText) : null;
  if (kind === "focus" && seat != null) return { mode: "focus", focusSeat: seat, lookSeat: null };
  if (kind === "look" && seat != null) return { mode: "look", focusSeat: null, lookSeat: seat };
  if (kind === "overview" || kind === "fly") return { mode: kind, focusSeat: null, lookSeat: null };
  return { mode: "home", focusSeat: null, lookSeat: null };
}

export function parsePreviewLock(raw: string | null | undefined): CameraLockReason | null {
  return LOCK_REASONS.find((reason) => reason === raw) ?? null;
}

/** What the preview URL asks for, handed to the stage next to the controller. */
export interface PreviewContext {
  cam: PreviewCam;
  /** `?lock=<reason>`: start the preview with the FX camera lock on. */
  lock: CameraLockReason | null;
  viewport: { width: number; height: number };
  reduced: boolean;
}

export type PreviewStageRenderer = (controller: TableController, state: TableFixtureState, preview: PreviewContext) => ReactNode;

export interface PreviewHarnessProps {
  set: TableFixtureSet;
  stateId: string | null;
  cam: string | null;
  lock?: string | null;
  /** The route of this mode, for the state links (for example "/dev/table-preview/ffa3"). */
  basePath?: string;
  renderStage: PreviewStageRenderer;
}

function useViewport(): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const read = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);
  return size;
}

function HarnessBody({
  state,
  preview,
  renderStage,
  onToast,
}: {
  state: TableFixtureState;
  preview: PreviewContext;
  renderStage: PreviewStageRenderer;
  onToast: (message: string) => void;
}) {
  const controller = useFixtureController(state, { reducedMotion: preview.reduced, onToast });
  return <>{renderStage(controller, state, preview)}</>;
}

/** The preview frame: a thin top bar (state links, camera hint, viewport size) and the stage under it. */
export function PreviewHarness({ set, stateId, cam, lock, basePath, renderStage }: PreviewHarnessProps) {
  const query = useSearchParams();
  const reduced = query.get("reduced") === "1";
  const viewport = useViewport();
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((message: string) => {
    setToast(message);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2200);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const activeId = isTableStateId(stateId) ? stateId : "main";
  const state = set.states[activeId];
  const preview: PreviewContext = { cam: parsePreviewCam(cam), lock: parsePreviewLock(lock), viewport, reduced };
  const base = basePath ?? `/dev/table-preview/${set.format}`;
  const suffix = [cam ? `cam=${encodeURIComponent(cam)}` : null, lock ? `lock=${encodeURIComponent(lock)}` : null, reduced ? "reduced=1" : null]
    .filter((part): part is string => part != null)
    .join("&");

  return (
    <div className={`${duelFontClasses} ${styles.root}`} data-table-preview={set.format} data-state={state.id}>
      <header className={styles.bar}>
        <Link href="/dev/table-preview" className={styles.title}>{set.title}</Link>
        <nav className={styles.states} aria-label="Preview state">
          {TABLE_STATE_IDS.map((id) => (
            <Link key={id} href={`${base}?state=${id}${suffix ? `&${suffix}` : ""}`} aria-current={id === state.id ? "page" : undefined}>
              {id}
            </Link>
          ))}
        </nav>
        <span className={styles.hint}>?cam=home|overview|fly|focus:&lt;seat&gt;|look:&lt;seat&gt; &middot; ?lock=&lt;reason&gt; &middot; ?reduced=1</span>
        <span className={styles.size}>{viewport.width}&times;{viewport.height}</span>
      </header>
      <main className={styles.stage}>
        <HarnessBody key={state.id} state={state} preview={preview} renderStage={renderStage} onToast={showToast} />
      </main>
      {toast ? <div className={styles.toast} role="status">{toast}</div> : null}
    </div>
  );
}

/**
 * The stage a mode shows until its real one is built: the state label, the turn and the seats from the fixture.
 * It needs no engine and no table code, so every route renders from the first commit.
 */
export function PlaceholderStage({ controller, state }: { controller: TableController; state: TableFixtureState }) {
  const { engine, nameOf, prompt } = controller;
  return (
    <section className={styles.placeholder} aria-label="Placeholder stage">
      <h2>{state.label}</h2>
      <p>
        Turn {engine.turn}, {engine.phase}, {nameOf(engine.turnSeat)} to play. Placeholder: the stage for this mode is not built yet.
      </p>
      <ul>
        {engine.seats.map((seat) => (
          <li key={seat.seat}>
            Seat {seat.seat}: {nameOf(seat.seat)} &middot; {seat.lp} LP &middot; hand {seat.hand.length}
            {seat.eliminated ? " · eliminated" : ""}
          </li>
        ))}
      </ul>
      {prompt ? <p>Prompt for {nameOf(prompt.seat)}: {prompt.title}</p> : null}
    </section>
  );
}
