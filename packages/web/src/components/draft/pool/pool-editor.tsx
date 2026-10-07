"use client";

import * as React from "react";
import { svButtonClass } from "@/components/sheet";
import { AddCards } from "./add-cards";
import { CubePicker } from "./cube-picker";
import { CubeSummary } from "./cube-summary";
import { PoolList } from "./pool-list";
import { StartPoint } from "./start-point";
import { StatusBar } from "./status-bar";
import { cardsText } from "./pool-model";
import type { PoolEditor as PoolEditorState } from "./use-pool-editor";
import styles from "./pool.module.css";

/**
 * The pool of a cube draft. The create form and the lobby's edit setup both render this, each with its own
 * `usePoolEditor`. Create starts with a choice (a cube or scratch); the lobby opens straight on the draft's pool.
 */
export function PoolEditor({ ctl, extraRound = false }: { ctl: PoolEditorState; extraRound?: boolean }) {
  const lobby = ctl.variant === "lobby";
  const cubeId = ctl.meta?.cubeId ?? null;
  // The cube the user opened the editor for (`undefined` = not open). A cube change or a switch to scratch
  // clears it in the event that causes it. A reset effect would run late and could undo a click.
  const [customizingFor, setCustomizingFor] = React.useState<number | null | undefined>(undefined);
  const customizing = customizingFor === cubeId;

  if (!ctl.ready) return <p className={styles.loading}>{lobby ? "Loading the pool." : "Loading cubes."}</p>;
  if (ctl.loadError) {
    return (
      <p className={styles.loading} role="alert">
        {ctl.loadError}
      </p>
    );
  }

  const scratch = ctl.meta === null;
  const showPicker = !lobby && ctl.mode === "cube" && (ctl.pickerOpen || scratch);
  const showCube = ctl.mode === "cube" && !scratch && !showPicker;
  const editorOpen = lobby || scratch || customizing;

  return (
    <div className={styles.pool}>
      {!lobby && (
        <StartPoint
          mode={ctl.mode}
          hasCubes={ctl.cubes.length > 0}
          onChange={(mode) => {
            setCustomizingFor(undefined);
            ctl.setMode(mode);
          }}
        />
      )}
      {showPicker && (
        <CubePicker
          cubes={ctl.cubes}
          userId={ctl.userId}
          selectedId={cubeId}
          hasEdits={ctl.edited}
          picking={ctl.picking}
          error={ctl.pickError}
          keepName={cubeId !== null ? ctl.meta?.name ?? null : null}
          onPick={(id) => {
            setCustomizingFor(undefined);
            void ctl.pickCube(id);
          }}
          onKeep={ctl.closePicker}
        />
      )}
      {(showCube || (lobby && !scratch)) && <CubeSummary ctl={ctl} lobby={lobby} onChange={ctl.openPicker} extraRound={extraRound} />}
      {!showPicker && <StatusBar ctl={ctl} />}
      {!showPicker && !editorOpen && (
        <div className={styles.custom}>
          <button type="button" className={svButtonClass("ghost")} onClick={() => setCustomizingFor(cubeId)}>
            {ctl.edited ? "Keep customizing" : "Customize for this draft"}
          </button>
        </div>
      )}
      {!showPicker && editorOpen && <Editor ctl={ctl} scratch={scratch} onHide={!lobby && !scratch ? () => setCustomizingFor(undefined) : null} />}
    </div>
  );
}

function Editor({ ctl, scratch, onHide }: { ctl: PoolEditorState; scratch: boolean; onHide: (() => void) | null }) {
  const empty = ctl.pool.size === 0 && ctl.extra.size === 0;
  return (
    <section className={styles.ed} aria-label={scratch ? "Build the pool" : "Customize for this draft"}>
      <div className={styles.edSec}>
        <div className={styles.edH}>
          <h3>Add cards</h3>
          {onHide && (
            <button type="button" className={styles.lnk} onClick={onHide}>
              Hide editor
            </button>
          )}
          {!onHide && !empty && <span>{cardsText(ctl.total + ctl.extraTotal)} in the pool</span>}
        </div>
        {empty && <p className={styles.edEmpty}>Add a set, an archetype or single cards.</p>}
        <AddCards ctl={ctl} initialTab={scratch ? "set" : "card"} />
      </div>
      {(!empty || !scratch) && <PoolList ctl={ctl} />}
    </section>
  );
}
