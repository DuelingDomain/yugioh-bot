"use client";

import { useCallback, useState } from "react";
import { Bug } from "lucide-react";
import type { DuelRoom } from "@yugidraft/shared/duels";
import { Button } from "@/components/ui/button";
import { BugReportDialog } from "./bug-report-dialog";
import { collectBugContext } from "./context";

/**
 * The "Report bug" entry of the duel room menu (the Settings pane of the 1v1 room, the table and the Rooftop). It opens
 * the dialog and sends the room's public context with the text.
 */
export function BugReportMenuButton({ room }: { room: DuelRoom }) {
  const [open, setOpen] = useState(false);
  const collect = useCallback(() => collectBugContext(room), [room]);
  return (
    <>
      <h2>Feedback</h2>
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <Bug size={14} strokeWidth={1.75} aria-hidden /> Report bug
      </Button>
      <BugReportDialog open={open} onClose={() => setOpen(false)} collect={collect} />
    </>
  );
}
