"use client";

import { useCallback, useState } from "react";
import { Bug } from "lucide-react";
import { SheetRoot } from "@/components/sheet/sheet-root";
import { BugReportDialog } from "./bug-report-dialog";
import { collectBugContext } from "./context";
import { useBugFabLift } from "./fab-lift";
import { getBugReportRoom, useBugReportHeaderHosted } from "./room-store";
import styles from "./bug-report.module.css";

/** Where the button sits when the caller does not say: the bottom-right corner of the screen. */
const DEFAULT_PLACE = "fixed bottom-3 right-3 z-40";

/**
 * The Report bug button, floating at the bottom-right of a signed-in page as a quiet chip (see bug-report.module.css).
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
        // The chip reads the sheet's tokens (--panel-2, --rule-lo, --ink-3). `contents` keeps the root out of the layout
        // and `flow` stops it being a size container, which would trap the fixed button.
        <SheetRoot flow className="contents">
          <button
            type="button"
            aria-haspopup="dialog"
            data-bug-fab
            style={lift > 0 ? { transform: `translateY(-${lift}px)` } : undefined}
            onClick={() => setOpen(true)}
            className={`${className} ${styles.fab}`}
          >
            <Bug aria-hidden="true" />
            <span>Report bug</span>
          </button>
        </SheetRoot>
      )}
      <BugReportDialog open={open} onClose={() => setOpen(false)} collect={collect} />
    </>
  );
}
