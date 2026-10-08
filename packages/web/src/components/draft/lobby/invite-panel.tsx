"use client";

import * as React from "react";
import type { DraftVisibility } from "@yugidraft/shared/types";
import { CopyLinkRow, SectionHead } from "@/components/sheet";
import { HostInviteControls } from "../visibility/host-invite-controls";
import styles from "./lobby.module.css";

/** The invite strip: a read-only link with a Copy button, and the Discord command. The full URL is set after mount, when `window` exists. */
export function InvitePanel({
  slug,
  discordEnabled = false,
  visibility,
  canManageInvite = false,
  pending = true,
  onChanged,
}: {
  slug: string;
  /** The Discord bot is on. When false the Discord command line is hidden. */
  discordEnabled?: boolean;
  visibility?: DraftVisibility;
  /** The viewer is the host (the server's `canManageInvite`): the real invite link, the switch and Reset replace the bare link. */
  canManageInvite?: boolean;
  pending?: boolean;
  onChanged?: () => void;
}) {
  const [link, setLink] = React.useState(`/draft/${slug}`);
  const headingId = React.useId();

  React.useEffect(() => {
    setLink(`${window.location.origin}/draft/${slug}`);
  }, [slug]);

  if (canManageInvite && visibility) {
    return (
      <section className={styles.invite} aria-labelledby={headingId}>
        <SectionHead title="Invite players" id={headingId} />
        <HostInviteControls slug={slug} visibility={visibility} pending={pending} onChanged={onChanged} />
      </section>
    );
  }

  return (
    <section className={styles.invite} aria-labelledby={headingId}>
      <SectionHead title="Invite players" note="Anyone with the link can join" id={headingId} />
      <CopyLinkRow value={link} label="Invite link" />
      {discordEnabled && (
        <p className={styles.joinHint}>
          Players can also join from Discord with <code className={`cmd ${styles.joinCommand}`}>/draft join</code>.
        </p>
      )}
    </section>
  );
}
