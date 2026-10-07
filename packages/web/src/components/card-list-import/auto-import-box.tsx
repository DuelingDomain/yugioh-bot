"use client";

import * as React from "react";
import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import { ListImportError, NOTHING_FOUND, type ListDiagnostics } from "@/lib/card-list-import";
import { ListFileButton } from "./list-file-button";
import { ListImportReport } from "./list-import-report";
import styles from "./auto-import-box.module.css";

/** What `run` resolves with when the list held no cards: the box keeps the text and says so. */
export type NothingFound = { nothing: true; report?: Partial<ListDiagnostics> };

/** Imports `text`. Resolves when it is in. Throws `ListImportError` (or any Error with a message to show) when it is not. */
export type ImportRun = (text: string, fileName: string | null) => Promise<void | NothingFound>;

/** One import that was added: the line to show, and what it left over. */
export interface ImportEntryView {
  key: number | string;
  /** Names the entry for the Remove button. */
  label: string;
  /** "Pasted list - 12 cards (10 Main, 2 Extra)". */
  line: string;
  report: Partial<ListDiagnostics>;
}

interface Problem {
  tone: "bad" | "warn";
  message: string;
  report?: Partial<ListDiagnostics>;
  /** Set for a refusal that a second try can fix. */
  retry?: { text: string; fileName: string | null; waitSeconds: number };
}

interface Props {
  /** Visible label of the box. */
  label: string;
  placeholder: string;
  hint: React.ReactNode;
  run: ImportRun;
  entries: ImportEntryView[];
  /** Takes the entry's copies out again. Rejects with a message when it could not. */
  onRemove: (key: ImportEntryView["key"]) => Promise<void> | void;
  /** Blocks new imports from outside (the host is busy with another request). */
  disabled?: boolean;
  fileLabel?: string;
  labelClassName?: string;
  /** Class of the textarea (the surfaces share `input`). */
  textareaClassName?: string;
  textareaStyle?: React.CSSProperties;
  fileButtonClassName: string;
  fileInputClassName: string;
  /** Class of the hint paragraph. */
  hintClassName?: string;
}

/** After a list went in: empties the box only when it still holds that list. */
const clearIfSame = (value: string) => (now: string) => (now === value ? "" : now);
/** After a list failed: puts it back only into an empty box, so text typed meanwhile is not lost. */
const keepOrRestore = (value: string) => (now: string) => (now === "" ? value : now);

/** One list that waits for the import in front of it. */
interface Queued {
  value: string;
  fileName: string | null;
}

/**
 * A box for a card list that adds it at once. A paste, a drop or a loaded file imports now. Typed text never imports
 * by itself (a pause can fall in the middle of a card name): it imports on Enter, or with the Add button, and
 * Shift+Enter is a new line. A list that arrives while another import runs waits its turn.
 * Each import then shows as an entry that can be removed again.
 * The box is empty after an import, and keeps its text when the import failed or found nothing.
 */
export function AutoImportBox({
  label,
  placeholder,
  hint,
  run,
  entries,
  onRemove,
  disabled = false,
  fileLabel,
  labelClassName = "label",
  textareaClassName = "input",
  textareaStyle,
  fileButtonClassName,
  fileInputClassName,
  hintClassName = "hint",
}: Props) {
  const areaId = React.useId();
  const hintId = React.useId();
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<Problem | null>(null);
  const [waiting, setWaiting] = React.useState(false);
  const queue = React.useRef<Queued[]>([]);
  const [queued, setQueued] = React.useState(0);
  const waitTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = React.useRef(false);
  const mounted = React.useRef(true);
  const runRef = React.useRef(run);
  runRef.current = run;

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (waitTimer.current) clearTimeout(waitTimer.current);
    };
  }, []);

  const start = React.useCallback(
    async (value: string, fileName: string | null, fromQueue = false) => {
      // One import at a time; a list that comes in meanwhile goes to the queue (see `enqueue`).
      if (inFlight.current || value.trim() === "") return;
      inFlight.current = true;
      setBusy(true);
      // A list from the queue leaves the problem of the one before it on screen.
      if (!fromQueue) setProblem(null);
      setWaiting(false);
      try {
        const result = await runRef.current(value, fileName);
        if (!mounted.current) return;
        if (result && result.nothing) {
          // Text typed meanwhile stays; the list comes back only into an empty box.
          setText(keepOrRestore(value));
          setProblem({ tone: "warn", message: NOTHING_FOUND, report: result.report });
        } else {
          // Text typed since is not the list that went in (a dropped list was never in the box).
          setText(clearIfSame(value));
        }
      } catch (error) {
        if (!mounted.current) return;
        const message = error instanceof Error && error.message ? error.message : "Couldn't add the list. Try again.";
        const waitSeconds = error instanceof ListImportError && error.retryAfter ? Math.ceil(error.retryAfter) : 0;
        setText(keepOrRestore(value));
        setProblem({ tone: "bad", message, retry: { text: value, fileName, waitSeconds } });
        if (waitSeconds > 0) {
          setWaiting(true);
          if (waitTimer.current) clearTimeout(waitTimer.current);
          waitTimer.current = setTimeout(() => {
            if (mounted.current) setWaiting(false);
          }, waitSeconds * 1000);
        }
      } finally {
        inFlight.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [],
  );

  const locked = busy || disabled;
  // `enqueue` also runs from a file read that finishes later, so it reads the lock from here, not from its own render.
  const lockedRef = React.useRef(locked);
  lockedRef.current = locked;

  /** A paste or a file while the box is busy waits here and goes in next. */
  const enqueue = (value: string, fileName: string | null) => {
    if (value.trim() === "") return;
    if (!lockedRef.current && !inFlight.current) {
      void start(value, fileName);
      return;
    }
    queue.current.push({ value, fileName });
    setQueued(queue.current.length);
  };

  React.useEffect(() => {
    if (locked || inFlight.current || queue.current.length === 0) return;
    const next = queue.current.shift()!;
    setQueued(queue.current.length);
    void start(next.value, next.fileName, true);
  }, [locked, queued, start]);

  return (
    <div className={styles.box}>
      <div>
        <label className={labelClassName} htmlFor={areaId}>
          {label}
        </label>
        <textarea
          id={areaId}
          className={`${textareaClassName} ${styles.area}`}
          style={textareaStyle}
          rows={6}
          placeholder={placeholder}
          spellCheck={false}
          value={text}
          readOnly={locked}
          aria-busy={busy || undefined}
          aria-describedby={hintId}
          onPaste={(event) => {
            const pasted = event.clipboardData?.getData("text") ?? "";
            if (pasted.trim() === "") return;
            event.preventDefault();
            if (locked) {
              // The box shows the list that is going in; this one waits its turn.
              enqueue(pasted, null);
              return;
            }
            const el = event.currentTarget;
            const value = el.value.slice(0, el.selectionStart) + pasted + el.value.slice(el.selectionEnd);
            setText(value);
            enqueue(value, null);
          }}
          onChange={(event) => {
            if (locked) return;
            const value = event.target.value;
            setText(value);
            setProblem(null);
            // Some browsers paste or drop without a paste event; those lists go in at once. Typing never does.
            const inputType = (event.nativeEvent as InputEvent).inputType;
            if (inputType === "insertFromPaste" || inputType === "insertFromDrop") enqueue(value, null);
          }}
          onDrop={(event) => {
            const dropped = event.dataTransfer?.getData("text") ?? "";
            if (dropped.trim() === "") return;
            event.preventDefault();
            enqueue(dropped, null);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            // Enter (or Ctrl+Enter) imports what is typed; Shift+Enter is a new line.
            event.preventDefault();
            if (!locked) void start(text, null);
          }}
        />
        <p className={hintClassName} id={hintId}>
          {hint}
        </p>
      </div>
      <div className={styles.row}>
        <ListFileButton
          buttonClassName={fileButtonClassName}
          inputClassName={fileInputClassName}
          disabled={locked}
          label={fileLabel}
          onLoaded={(loaded, name) => {
            if (!lockedRef.current) setText(loaded);
            enqueue(loaded, name);
          }}
          onError={(message) => setProblem({ tone: "bad", message })}
        />
        <button
          type="button"
          className={fileButtonClassName}
          disabled={locked || text.trim() === ""}
          onClick={() => void start(text, null)}
        >
          Add
        </button>
      </div>
      <div role="status" aria-live="polite">
        {busy && (
          <p className={styles.busy}>
            <LoaderCircle size={16} aria-hidden="true" />
            <span>Adding the list.</span>
          </p>
        )}
        {queued > 0 && (
          <p className={styles.busy}>
            {queued === 1 ? "1 more list is waiting." : `${queued} more lists are waiting.`}
          </p>
        )}
      </div>
      {problem && (
        <div className={styles.problem} role="alert">
          <p className={`${styles.problemLine}${problem.tone === "warn" ? ` ${styles.warn}` : ""}`}>
            <CircleAlert size={16} aria-hidden="true" />
            <span>
              {problem.message}
              {waiting && problem.retry && problem.retry.waitSeconds > 0
                ? ` Wait ${problem.retry.waitSeconds} ${problem.retry.waitSeconds === 1 ? "second" : "seconds"}, then try again.`
                : ""}
            </span>
          </p>
          {problem.report && <ListImportReport {...problem.report} collapsed />}
          {problem.retry && (
            <button
              type="button"
              className={`${fileButtonClassName} ${styles.retry}`}
              disabled={locked || waiting}
              onClick={() => problem.retry && void start(problem.retry.text, problem.retry.fileName)}
            >
              Try again
            </button>
          )}
        </div>
      )}
      <ImportEntries entries={entries} onRemove={onRemove} />
    </div>
  );
}

function ImportEntries({ entries, onRemove }: Pick<Props, "entries" | "onRemove">) {
  const [removing, setRemoving] = React.useState<ReadonlySet<ImportEntryView["key"]>>(new Set());
  const [errors, setErrors] = React.useState<ReadonlyMap<ImportEntryView["key"], string>>(new Map());
  const mounted = React.useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  if (entries.length === 0) return null;

  const remove = async (key: ImportEntryView["key"]) => {
    setRemoving((prev) => new Set(prev).add(key));
    setErrors((prev) => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
    try {
      await onRemove(key);
    } catch (error) {
      if (mounted.current) {
        const message = error instanceof Error && error.message ? error.message : "Couldn't remove that list.";
        setErrors((prev) => new Map(prev).set(key, message));
      }
    } finally {
      if (mounted.current) {
        setRemoving((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    }
  };

  return (
    <ul className={styles.entries} aria-label="Added lists" aria-live="polite" aria-relevant="additions">
      {entries.map((entry) => (
        <li key={entry.key} className={styles.entry}>
          <div className={styles.entryTop}>
            <p className={styles.entryLine}>
              <Check size={16} aria-hidden="true" />
              <span>{entry.line}</span>
            </p>
            <button
              type="button"
              className={styles.remove}
              disabled={removing.has(entry.key)}
              aria-busy={removing.has(entry.key) || undefined}
              aria-label={`Remove ${entry.label}`}
              onClick={() => void remove(entry.key)}
            >
              Remove
            </button>
          </div>
          <ListImportReport {...entry.report} collapsed />
          {errors.has(entry.key) && (
            <p className={styles.entryErr} role="alert">
              {errors.get(entry.key)}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
