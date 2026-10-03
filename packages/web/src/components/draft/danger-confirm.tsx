"use client";

import * as React from "react";
import { svButtonClass } from "@/components/sheet";
import { cn } from "@/lib/utils";
import styles from "./danger-confirm.module.css";

/**
 * How the last input arrived. The back button takes focus when the confirm opens; after a mouse or touch click that
 * focus is only a convenience, so it must not draw a keyboard ring. After a key press the ring stays.
 */
let lastInputWasKeyboard = false;
if (typeof document !== "undefined") {
  document.addEventListener("keydown", () => { lastInputWasKeyboard = true; }, true);
  document.addEventListener("pointerdown", () => { lastInputWasKeyboard = false; }, true);
}

/**
 * The inline confirm that replaces a destructive button (cancel a draft, delete a draft). It is not a modal. Focus lands
 * on the back button when it opens, so Enter never confirms by accident. Escape is handled by the caller through
 * `useInlineConfirm`, which also puts focus back on the trigger.
 */
export function DangerConfirm({
  title,
  consequence,
  backLabel = "Go back",
  confirmLabel,
  busy,
  onBack,
  onConfirm,
}: {
  title: string;
  consequence: string;
  backLabel?: string;
  confirmLabel: string;
  busy: boolean;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const backRef = React.useRef<HTMLButtonElement>(null);
  const headingId = React.useId();
  // True when the confirm was opened with a pointer: the auto-focused back button then shows no ring until a key is pressed.
  const [pointerOpened, setPointerOpened] = React.useState(() => !lastInputWasKeyboard);
  React.useEffect(() => {
    backRef.current?.focus();
  }, []);
  return (
    <div className={styles.confirm} role="dialog" aria-modal="false" aria-labelledby={headingId}>
      <h3 id={headingId}>{title}</h3>
      <p>{consequence}</p>
      <div className={styles.acts}>
        <button
          ref={backRef}
          type="button"
          className={cn(svButtonClass("ghost"), styles.back)}
          data-pointer-focus={pointerOpened || undefined}
          onKeyDown={() => setPointerOpened(false)}
          onClick={onBack}
          disabled={busy}
        >
          {backLabel}
        </button>
        <button type="button" className={svButtonClass("danger")} onClick={onConfirm} disabled={busy} aria-busy={busy || undefined}>{confirmLabel}</button>
      </div>
    </div>
  );
}
