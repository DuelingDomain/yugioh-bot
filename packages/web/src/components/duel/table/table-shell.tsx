"use client";

import { useCallback, useEffect, useMemo, useReducer } from "react";
import { BattleFx } from "../battle-fx";
import { SeatField } from "../field";
import { FxBoundary } from "../fx-boundary";
import { PromptCenter } from "../prompt-center";
import { engineFormat } from "../multi-seat";
import { tableLayout } from "./geometry";
import { TableStage } from "./table-stage";
import type { CameraAction, CameraState, TableController, TableFormat } from "./types";
import styles from "./table-shell.module.css";

/**
 * The preview shell of the table: the stage with the same exported duel components a room uses (PromptCenter,
 * BattleFx), and the camera keys the stage understands so far. It copies no room logic: a room keeps its own
 * shell (header, inspector, history, station track) and mounts `TableStage` in the board box instead.
 * The camera here is a stand-in that only knows Upright; the camera step replaces it with the real model.
 */
export const HOME_CAMERA: CameraState = {
  mode: "home",
  focusSeat: null,
  lookSeat: null,
  upright: false,
  compact: "auto",
  auto: true,
  pinned: false,
  aiming: false,
  fly: { yawDeg: 0, tiltDeg: 40, zoom: 1, targetSeat: null },
  lock: null,
};

function standInCamera(state: CameraState, action: CameraAction): CameraState {
  if (action.type === "toggleUpright") return { ...state, upright: !state.upright };
  if (action.type === "home") return { ...HOME_CAMERA, upright: state.upright };
  return state;
}

function typing(target: EventTarget | null): boolean {
  const node = target as HTMLElement | null;
  if (!node || typeof node.tagName !== "string") return false;
  return node.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(node.tagName);
}

export interface TableShellProps {
  controller: TableController;
  /** Starting camera; the preview passes what its URL asks for. */
  initialCamera?: Partial<CameraState>;
}

export function TableShell({ controller, initialCamera }: TableShellProps) {
  const { engine, room, viewerSeat } = controller;
  const [camera, dispatchCamera] = useReducer(standInCamera, { ...HOME_CAMERA, ...initialCamera });
  const format = engineFormat(engine);
  const layout = useMemo(
    () => tableLayout(format as TableFormat, engine, viewerSeat),
    // The layout depends on who sits where, never on a card: the seat list is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [format, engine.seats.length, viewerSeat],
  );

  const onKey = useCallback((event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey || typing(event.target)) return;
    if (event.key === "s" || event.key === "S") {
      event.preventDefault();
      dispatchCamera({ type: "toggleUpright" });
    } else if (event.key === "h" || event.key === "H") {
      dispatchCamera({ type: "home" });
    }
  }, []);
  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  return (
    <div className={styles.shell} data-table-shell>
      <TableStage
        controller={controller}
        layout={layout}
        camera={camera}
        dispatchCamera={dispatchCamera}
        renderSeatField={(props) => <SeatField {...props} />}
        fx={
          <FxBoundary>
            <BattleFx events={engine.events} seats={engine.seats} reducedMotion={controller.reducedMotion} aim={controller.aim} />
          </FxBoundary>
        }
        promptCenter={
          <PromptCenter
            prompt={controller.prompt}
            mySeat={viewerSeat}
            active={room.session.status === "active"}
            slug={room.session.slug}
            busy={controller.busy}
            draft={controller.draft}
            onSubmit={controller.onAnswer}
            menuOpen={false}
            chain={engine.chain}
            aimLocked={false}
            reducedMotion={controller.reducedMotion}
            revision={engine.revision}
            battleStep={engine.battleStep}
            revealed={controller.revealed}
            onInspectCard={undefined}
            nameOf={controller.nameOf}
          />
        }
      />
      <p className={styles.hint}>
        <kbd>S</kbd> upright text {camera.upright ? "on" : "off"}
      </p>
    </div>
  );
}
