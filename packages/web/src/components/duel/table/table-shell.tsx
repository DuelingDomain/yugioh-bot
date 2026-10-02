"use client";

import { useMemo, useRef } from "react";
import { BattleFx } from "../battle-fx";
import { SeatField } from "../field";
import { FxBoundary } from "../fx-boundary";
import { PromptCenter } from "../prompt-center";
import { engineFormat } from "../multi-seat";
import { CameraControls } from "./camera-controls";
import { tableLayout } from "./geometry";
import { OpponentBar } from "./opponent-bar";
import { TableStage } from "./table-stage";
import { useAimFlow } from "./use-aim-flow";
import { useCamera } from "./use-camera";
import type { CameraLockReason, CameraState, TableController, TableFormat } from "./types";
import styles from "./table-shell.module.css";

export interface TableShellProps {
  controller: TableController;
  /** Starting camera; the preview passes what its URL asks for. */
  initialCamera?: Partial<CameraState>;
  /** Start with the FX lock on (the preview shows the chip with it). It stays on until the page reloads. */
  initialLock?: CameraLockReason | null;
}

/**
 * The preview shell of the table: the stage with the same exported duel components a room uses (PromptCenter,
 * BattleFx), the camera (keys, FX lock, auto camera, controls) and the attack aim. It copies no room logic: a room
 * keeps its own shell (header, inspector, history, station track) and mounts `TableStage` in the board box instead.
 */
export function TableShell({ controller: base, initialCamera, initialLock = null }: TableShellProps) {
  const { engine, room, viewerSeat } = base;
  const format = engineFormat(engine);
  const layout = useMemo(
    () => tableLayout(format as TableFormat, engine, viewerSeat),
    // The layout depends on who sits where, never on a card: the seat list is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [format, engine.seats.length, viewerSeat],
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const flow = useAimFlow(base, layout, rootRef);
  const controller = flow.controller;
  const camera = useCamera({ controller, layout, initial: initialCamera, initialLock, aiming: flow.aiming, seatKeys: flow.seatKeys });

  return (
    <div ref={rootRef} className={styles.shell} data-table-shell>
      <TableStage
        controller={controller}
        layout={layout}
        camera={camera.shown}
        wantMode={camera.state.mode}
        locked={camera.locked}
        out={camera.out}
        dispatchCamera={camera.dispatch}
        renderSeatField={(props) => <SeatField {...props} />}
        fx={
          <FxBoundary>
            <BattleFx events={engine.events} seats={engine.seats} reducedMotion={controller.reducedMotion} aim={null} />
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
            aim={flow.promptAim ?? undefined}
            aimLocked={flow.locked}
            reducedMotion={controller.reducedMotion}
            revision={engine.revision}
            battleStep={engine.battleStep}
            revealed={controller.revealed}
            onInspectCard={undefined}
            nameOf={controller.nameOf}
          />
        }
        overlay={
          <>
            {flow.bar ? (
              <OpponentBar
                kind={flow.bar.kind}
                title={flow.bar.title}
                targetLabel={flow.bar.targetLabel}
                entries={flow.bar.entries}
                onPick={(seat) => controller.seatPick?.onPick(seat)}
                onConfirm={flow.confirm}
                onCancel={flow.cancel}
              />
            ) : null}
            <CameraControls
              layout={layout}
              camera={camera.state}
              locked={camera.locked}
              cue={camera.cue}
              nameOf={controller.nameOf}
              dispatch={camera.dispatch}
              out={camera.out}
            />
          </>
        }
      />
    </div>
  );
}
