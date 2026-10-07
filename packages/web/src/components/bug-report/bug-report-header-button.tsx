"use client";

import { useCallback, useState } from "react";
import { Bug } from "lucide-react";
import type { DuelRoom } from "@yugidraft/shared/duels";
import { BugReportDialog } from "./bug-report-dialog";
import { collectBugContext } from "./context";
import { useBugReportHeaderHost } from "./room-store";
import styles from "./bug-report.module.css";

/**
 * The Report bug button of a live duel header (the 1v1 room, the table and the Rooftop). It sits with the other
 * header buttons, where nothing else can be under it, and sends the room's public context with the text. While it is
 * mounted the floating button stays hidden. On a narrow screen only the icon shows (the name stays for screen readers).
 * Its style is the same quiet chip as the floating button; the important marks in bug-report.module.css keep it that
 * way inside shells that reset every button (the Rooftop sets `background: none; font: inherit` on its buttons).
 */
export function BugReportHeaderButton({ room }: { room: DuelRoom }) {
  const [open, setOpen] = useState(false);
  useBugReportHeaderHost();
  const collect = useCallback(() => collectBugContext(room), [room]);
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label="Report bug"
        title="Report bug"
        data-bug-header-button
        onClick={() => setOpen(true)}
        className={styles.header}
      >
        <Bug aria-hidden="true" />
        <span className="max-[600px]:sr-only">Report bug</span>
      </button>
      <BugReportDialog open={open} onClose={() => setOpen(false)} collect={collect} />
    </>
  );
}
