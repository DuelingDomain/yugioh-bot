"use client";

import { useCallback, useState } from "react";
import { Bug } from "lucide-react";
import type { DuelRoom } from "@yugidraft/shared/duels";
import { BugReportDialog } from "./bug-report-dialog";
import { collectBugContext } from "./context";
import { useBugReportHeaderHost } from "./room-store";

/**
 * The red Report bug button of a live duel header (the 1v1 room, the table and the Rooftop). It sits with the other
 * header buttons, where nothing else can be under it, and sends the room's public context with the text. While it is
 * mounted the floating button stays hidden. On a narrow screen only the icon shows (the name stays for screen readers). The important marks keep it red and sized inside shells that reset every
 * button (the Rooftop sets `background: none; font: inherit` on its buttons).
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
        data-bug-header-button
        onClick={() => setOpen(true)}
        className="inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-accent-cta! px-2.5 max-[600px]:px-1.5 text-xs! font-semibold! leading-none text-white! hover:bg-red-600! focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white"
      >
        <Bug className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="max-[600px]:sr-only">Report bug</span>
      </button>
      <BugReportDialog open={open} onClose={() => setOpen(false)} collect={collect} />
    </>
  );
}
