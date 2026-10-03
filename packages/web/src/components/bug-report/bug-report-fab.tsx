"use client";

import { useCallback, useState } from "react";
import { Bug } from "lucide-react";
import { BugReportDialog } from "./bug-report-dialog";
import { collectBugContext } from "./context";
import { getBugReportRoom, useBugReportHeaderHosted } from "./room-store";

/** Where the button sits when the caller does not say: the bottom-left corner of the screen. */
const DEFAULT_PLACE = "fixed bottom-3 left-3 z-40";

/**
 * The red Report bug button, floating over a signed-in page. The app shell places it past the sidebar so it covers
 * neither the account menu nor the rail (`className`). In a duel the table owns every corner, so a live duel header
 * carries its own button (`BugReportHeaderButton`) and this one hides while that header is on screen. Outside a duel
 * it sends the page and the browser only; the room on screen, if any, adds the public duel facts.
 */
export function BugReportFab({ className = DEFAULT_PLACE }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const headerHosted = useBugReportHeaderHosted();
  const collect = useCallback(() => collectBugContext(getBugReportRoom()), []);
  return (
    <>
      {headerHosted ? null : (
        <button
          type="button"
          aria-haspopup="dialog"
          data-bug-fab
          onClick={() => setOpen(true)}
          className={`${className} inline-flex h-9 items-center gap-1.5 rounded-full bg-accent-cta px-3 text-sm font-semibold text-white shadow-card motion-safe:transition-[colors,transform] hover:bg-red-600 motion-safe:active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white max-[900px]:h-8 max-[900px]:px-2.5 max-[900px]:text-xs`}
        >
          <Bug className="h-4 w-4" aria-hidden="true" />
          <span>Report bug</span>
        </button>
      )}
      <BugReportDialog open={open && !headerHosted} onClose={() => setOpen(false)} collect={collect} />
    </>
  );
}
