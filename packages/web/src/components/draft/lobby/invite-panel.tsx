"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import styles from "./lobby.module.css";

/** Read-only invite link with a Copy button. The full URL is set after mount, when `window` exists. */
export function InvitePanel({ slug }: { slug: string }) {
  const [link, setLink] = React.useState(`/draft/${slug}`);
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const headingId = React.useId();

  React.useEffect(() => {
    setLink(`${window.location.origin}/draft/${slug}`);
  }, [slug]);
  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  };

  return (
    <section className="panel invite" aria-labelledby={headingId}>
      <h2 className="panel-t"><span id={headingId}>Invite players</span><small>anyone in the server can join</small></h2>
      <div className={`invite-row ${styles.inviteRow}`}>
        <input className="input" readOnly value={link} aria-label="Invite link" />
        <div className="acts">
          <button type="button" className="btn btn-secondary" onClick={() => void copy()}>
            {copied ? <Check className="ic" aria-hidden="true" /> : <Copy className="ic" aria-hidden="true" />}
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      </div>
      <p className="small">Players can also join from Discord with <code className={`cmd ${styles.joinCommand}`}>/draft join</code>.</p>
    </section>
  );
}
