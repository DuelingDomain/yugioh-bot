"use client";

import * as React from "react";
import { X } from "lucide-react";
import { CopyLinkRow, SvButton } from "@/components/sheet";
import { LobbyDialog, LobbyFeedback, type LobbyController } from "./lobby-actions";
import styles from "./seats-first.module.css";

export interface InviteModalProps {
  slug: string;
  onClose: () => void;
  /** The lobby controller. With it the host gets "Post to Discord" (the Nudge route without a player). */
  controller?: LobbyController;
  /** Show Post to Discord. Only the host may post. */
  canPost?: boolean;
  /** The Discord bot is on. When false, the Discord command line and Post to Discord are hidden; the link stays. */
  discordEnabled?: boolean;
  /** Where focus goes on close when the button that opened the modal is gone. */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}

/**
 * The invite modal: the draft link with Copy, the Discord command, and for the host a button that posts the invite
 * (and a mention for each player who is not ready) in the draft channel. Esc and the backdrop close it.
 */
export function InviteModal({ slug, onClose, controller, canPost = false, discordEnabled = true, returnFocusRef }: InviteModalProps) {
  const [link, setLink] = React.useState(`/draft/${slug}`);
  const titleId = React.useId();
  const closeRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    setLink(`${window.location.origin}/draft/${slug}`);
  }, [slug]);

  const posting = controller?.pending === "nudge";
  const wait = controller?.nudgeWait ?? 0;
  return (
    <LobbyDialog labelledBy={titleId} onClose={onClose} dismissOnBackdrop initialFocusRef={closeRef} returnFocusRef={returnFocusRef}>
      <div className={styles.invite}>
        <div className={styles.dialogHead}>
          <h2 className={styles.dialogT} id={titleId}>Invite players</h2>
          <button ref={closeRef} type="button" className={styles.dialogX} aria-label="Close" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <p className={styles.dialogP}>Anyone in the server can join with this link.</p>
        <CopyLinkRow value={link} label="Invite link" />
        {discordEnabled && (
          <p className={styles.dialogP}>
            Players can also join from Discord with <code className="cmd">/draft join</code>.
          </p>
        )}
        {discordEnabled && canPost && controller && (
          <div className={styles.invitePost}>
            <SvButton
              variant="ghost"
              disabled={wait > 0 || (controller.pending !== null && !posting)}
              aria-busy={posting || undefined}
              onClick={() => void controller.nudge()}
            >
              {wait > 0 ? `Post to Discord (wait ${wait} s)` : "Post to Discord"}
            </SvButton>
            <span className={styles.dialogP}>Posts the link in the draft channel and mentions players who are not ready.</span>
          </div>
        )}
        {controller && <LobbyFeedback controller={controller} />}
      </div>
    </LobbyDialog>
  );
}
