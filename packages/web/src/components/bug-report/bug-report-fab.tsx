"use client";

import { useCallback, useState } from "react";
import { Bug } from "lucide-react";
import { SheetRoot } from "@/components/sheet/sheet-root";
import { BugReportDialog } from "./bug-report-dialog";
import { collectBugContext } from "./context";
import { UpdatesBoard } from "@/components/updates/updates-board";
import { useBugFabLift } from "./fab-lift";
import { getBugReportRoom, useBugReportHeaderHosted } from "./room-store";
import styles from "./bug-report.module.css";

/** Where the dock (the Updates chip and this button) sits when the caller does not say: the bottom-right corner. */
const DEFAULT_PLACE = "fixed bottom-3 right-3 z-40";

/**
 * The Report bug button, floating at the bottom-right of a signed-in page as a quiet chip (see bug-report.module.css).
 * The Updates chip shares its dock (`UpdatesBoard`), so both sit in the same corner and lift together.
 * The right corner is clear of the sidebar, its account menu and the rail; a page whose sticky bottom bar reaches the
 * corner lifts the button above the bar (`BugFabLift`). In a duel the table owns every corner, so a live duel header
 * carries its own button (`BugReportHeaderButton`) and this button hides while that header is on screen; a dialog
 * already open stays until the player closes it, so typed text is not lost when a duel starts. Outside a duel
 * it sends the page and the browser only; the room on screen, if any, adds the public duel facts.
 */
export function BugReportFab({ className = DEFAULT_PLACE }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const headerHosted = useBugReportHeaderHosted();
  const lift = useBugFabLift();
  const collect = useCallback(() => collectBugContext(getBugReportRoom()), []);
  return (
    <>
      {headerHosted ? null : (
        // The chips read the sheet's tokens (--panel-2, --rule-lo, --ink-3). `contents` keeps the root out of the layout
        // and `flow` stops it being a size container, which would trap the fixed dock.
        <SheetRoot flow className="contents">
          <UpdatesBoard lift={lift} className={className}>
            <button
              type="button"
              aria-haspopup="dialog"
              data-bug-fab
              onClick={() => setOpen(true)}
              className={styles.fab}
            >
              <Bug aria-hidden="true" />
              <span>Report bug</span>
            </button>
          </UpdatesBoard>
        </SheetRoot>
      )}
      <BugReportDialog open={open} onClose={() => setOpen(false)} collect={collect} />
    </>
  );
}
