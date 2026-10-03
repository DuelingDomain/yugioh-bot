"use client";

import { useEffect, useRef, useState } from "react";
import { sv } from "./sv-util";

/** A read-only link field and a "Copy link" button that reads "Copied" for 2 seconds. Failure-safe. */
export function CopyLinkRow({ value, label = "Link", className }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function copy() {
    let ok = false;
    try {
      await navigator.clipboard.writeText(value);
      ok = true;
    } catch {
      // Clipboard blocked or missing: select the text so Ctrl+C works.
      try {
        input.current?.focus();
        input.current?.select();
        ok = typeof document.execCommand === "function" && document.execCommand("copy");
      } catch {
        ok = false;
      }
    }
    if (!ok) return;
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className={sv("sv-copy", className)}>
      <input ref={input} className="sv-copy-field" type="text" readOnly value={value} aria-label={label} onFocus={(e) => e.currentTarget.select()} />
      <button type="button" className="sv-btn ghost" onClick={() => void copy()}>{copied ? "Copied" : "Copy link"}</button>
      <span className="sv-sr" role="status" aria-live="polite">{copied ? "Link copied" : ""}</span>
    </div>
  );
}
