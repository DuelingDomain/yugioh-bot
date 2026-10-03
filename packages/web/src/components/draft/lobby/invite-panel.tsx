"use client";

import * as React from "react";
import { CopyLinkRow, SectionHead } from "@/components/sheet";
import styles from "./lobby.module.css";

/** The invite strip: a read-only link with a Copy button, and the Discord command. The full URL is set after mount, when `window` exists. */
export function InvitePanel({ slug }: { slug: string }) {
  const [link, setLink] = React.useState(`/draft/${slug}`);
  const headingId = React.useId();

  React.useEffect(() => {
    setLink(`${window.location.origin}/draft/${slug}`);
  }, [slug]);

  return (
    <section className={styles.invite} aria-labelledby={headingId}>
      <SectionHead title="Invite players" note="Anyone in the server can join" id={headingId} />
      <CopyLinkRow value={link} label="Invite link" />
      <p className={styles.joinHint}>
        Players can also join from Discord with <code className={`cmd ${styles.joinCommand}`}>/draft join</code>.
      </p>
    </section>
  );
}
