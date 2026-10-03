"use client";

import { useCallback, useState } from "react";
import { usePathname } from "next/navigation";
import { Bug } from "lucide-react";
import { BugReportDialog } from "./bug-report-dialog";
import { collectBugContext } from "./context";
import { getBugReportRoom } from "./room-store";

/**
 * The red Report bug button, fixed at the bottom-left of every page. In a duel it sends the room on screen with the
 * text; elsewhere only the page and the browser. The duel shells keep the bottom-left corner clear (`--bug-fab-clear`
 * in globals.css) and the phone layout lifts the button above the duel's bottom bar.
 */
export function BugReportFab() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname() ?? "";
  const inDuel = pathname.startsWith("/duels/");
  const collect = useCallback(() => collectBugContext(getBugReportRoom()), []);
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        data-bug-fab
        data-in-duel={inDuel ? "true" : "false"}
        onClick={() => setOpen(true)}
        className="fixed bottom-3 left-3 z-40 inline-flex h-9 items-center gap-1.5 rounded-full bg-accent-cta px-3 text-sm font-semibold text-white shadow-card motion-safe:transition-[colors,transform] hover:bg-red-600 motion-safe:active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white max-[900px]:h-8 max-[900px]:px-2.5 max-[900px]:text-xs data-[in-duel=true]:max-[900px]:bottom-[calc(env(safe-area-inset-bottom)+3.5rem)]"
      >
        <Bug className="h-4 w-4" aria-hidden="true" />
        <span>Report bug</span>
      </button>
      <BugReportDialog open={open} onClose={() => setOpen(false)} collect={collect} />
    </>
  );
}
