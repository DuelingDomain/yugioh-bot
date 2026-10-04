"use client";

import * as React from "react";
import { Check, CircleAlert } from "lucide-react";
import { svButtonClass } from "@/components/sheet";
import type { PoolEditor } from "./use-pool-editor";
import {
  NOT_SAVED_HEADLINE,
  NOT_SAVED_NOTE,
  editedHeadline,
  freeCubeName,
  notOwnerNote,
  replaceQuestion,
  savedLine,
  untouchedNote,
} from "./pool-model";
import styles from "./pool.module.css";

type Panel = null | "new" | "replace";

/**
 * Sits under the summary card and says how the pool differs from where it started. Save as new cube opens a name field;
 * Save changes to <cube> asks once. After a save it turns into a short "Saved to" line. Enter saves the name, Escape cancels.
 */
export function StatusBar({ ctl }: { ctl: PoolEditor }) {
  const [panel, setPanel] = React.useState<Panel>(null);
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const nameId = React.useId();
  const errId = React.useId();
  const returnFocus = React.useRef<"new" | "replace" | null>(null);
  const newBtn = React.useRef<HTMLButtonElement>(null);
  const replaceBtn = React.useRef<HTMLButtonElement>(null);
  const nameInput = React.useRef<HTMLInputElement>(null);

  const meta = ctl.meta;
  const scratch = meta === null;

  React.useEffect(() => {
    if (panel === null && returnFocus.current) {
      (returnFocus.current === "new" ? newBtn : replaceBtn).current?.focus();
      returnFocus.current = null;
    }
    if (panel === "new") nameInput.current?.select();
  }, [panel]);

  // A save, or picking another cube, ends whatever was open.
  React.useEffect(() => {
    setPanel(null);
    setError(null);
  }, [meta?.cubeId]);

  const close = React.useCallback(() => {
    returnFocus.current = panel;
    setPanel(null);
    setError(null);
  }, [panel]);

  if (ctl.savedTo) {
    return (
      <p className={styles.okLine} role="status">
        <Check size={16} aria-hidden="true" />
        {savedLine(ctl.savedTo)}
      </p>
    );
  }
  if (scratch && ctl.pool.size === 0) return null;
  if (!scratch && !ctl.edited && panel === null) return null;

  const openNew = () => {
    setName(freeCubeName(meta?.name ?? null, ctl.takenNames));
    setError(null);
    setPanel("new");
  };

  const saveNew = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await ctl.saveAsNew(name);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      nameInput.current?.focus();
    }
  };

  const replace = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await ctl.replaceBase();
    setBusy(false);
    if (!result.ok) setError(result.error);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape" && panel !== null) {
      event.stopPropagation();
      close();
    }
  };

  return (
    <section className={`${styles.sbar}${scratch ? ` ${styles.plain} ${styles.row}` : ""}`} aria-label="Pool status" onKeyDown={onKeyDown}>
      <div className={styles.sbarT}>
        {scratch ? (
          <>
            <b>{NOT_SAVED_HEADLINE}</b>
            <span>{NOT_SAVED_NOTE}</span>
          </>
        ) : (
          <>
            <b>{editedHeadline(ctl.diff)}</b>
            <span>{untouchedNote(meta.name)}</span>
            {!meta.canEdit && <span>{notOwnerNote(meta.name)}</span>}
          </>
        )}
      </div>
      {panel === null && (
        <div className={styles.sbarA}>
          {meta?.canEdit && (
            <button ref={replaceBtn} type="button" className={`${svButtonClass("ghost")} ${styles.small}`} onClick={() => setPanel("replace")}>
              Save changes to {meta.name}
            </button>
          )}
          <button ref={newBtn} type="button" className={`${svButtonClass("ghost")} ${styles.small}`} onClick={openNew}>
            Save as new cube
          </button>
          {!scratch && (
            <button type="button" className={`${styles.textBtn} ${styles.push}`} onClick={ctl.reset}>
              Reset
            </button>
          )}
        </div>
      )}
      {panel === "new" && (
        <div className={styles.sform} role="group" aria-label="Save as new cube">
          <label className="label" htmlFor={nameId}>
            Name for the new cube
          </label>
          <div className={styles.sformRow}>
            <div className={styles.grow}>
              <input
                ref={nameInput}
                id={nameId}
                className={`input${error ? " bad" : ""}`}
                value={name}
                autoFocus
                autoComplete="off"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errId : undefined}
                onChange={(e) => {
                  setName(e.target.value);
                  if (error) setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void saveNew();
                  }
                }}
              />
              {error && (
                <p className="ferr" id={errId} role="alert">
                  <CircleAlert size={15} aria-hidden="true" />
                  <span>{error}</span>
                </p>
              )}
            </div>
            <button type="button" className={svButtonClass("ghost")} onClick={() => void saveNew()} disabled={busy} aria-busy={busy || undefined}>
              Save
            </button>
            <button type="button" className={styles.textBtn} onClick={close}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {panel === "replace" && meta && (
        <div className={styles.sform} role="group" aria-label="Save changes">
          <p className={styles.ask}>{replaceQuestion(meta.name)}</p>
          <div className={styles.sformRow}>
            <button type="button" className={svButtonClass("ghost")} onClick={() => void replace()} disabled={busy} aria-busy={busy || undefined}>
              Replace
            </button>
            <button type="button" className={styles.textBtn} onClick={close}>
              Cancel
            </button>
          </div>
          {error && (
            <p className="ferr" role="alert">
              <CircleAlert size={15} aria-hidden="true" />
              <span>{error}</span>
            </p>
          )}
        </div>
      )}
    </section>
  );
}
