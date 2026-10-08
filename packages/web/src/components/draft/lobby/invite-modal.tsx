"use client";

import * as React from "react";
import { X } from "lucide-react";
import type { DraftVisibility } from "@yugidraft/shared/types";
import { CopyLinkRow, SvButton } from "@/components/sheet";
import { HostInviteControls } from "../visibility/host-invite-controls";
import { LobbyDialog, LobbyFeedback, type LobbyController } from "./lobby-actions";
import styles from "./seats-first.module.css";

/** What the lobby knows about who can join. Without it the modal is the plain "anyone in the server" link. */
export interface InviteAccess {
  visibility?: DraftVisibility;
  /** The viewer is the host: the server's `canManageInvite`. */
  canManage: boolean;
  /** The draft is still in its lobby (the visibility switch is locked after that). */
  pending: boolean;
  /** The host changed the visibility: the page reads the draft again. */
  onChanged?: () => void;
}

export interface InviteModalProps {
  slug: string;
  /** Who can join. The host gets the real invite link and the switch; a private draft has no bare link to share. */
  access?: InviteAccess;
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
export function InviteModal({ slug, access, onClose, controller, canPost = false, discordEnabled = false, returnFocusRef }: InviteModalProps) {
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
        {access?.canManage && access.visibility ? (
          <HostInviteControls slug={slug} visibility={access.visibility} pending={access.pending} onChanged={access.onChanged} />
        ) : (
          <>
            <p className={styles.dialogP}>Anyone in the server can join with this link.</p>
            <CopyLinkRow value={link} label="Invite link" />
          </>
        )}
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
