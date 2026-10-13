"use client";

import { useEffect, useId, useState } from "react";
import { SheetPortal } from "@/components/sheet";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

/** What the dialog needs to tell the organizer truthfully what cancelling does. */
export interface CancelTournamentTarget {
  name: string;
  status: string;
  participantCount: number;
  /** The web slug; the cancel endpoint is addressed by it. */
  slug: string;
}

/**
 * The words the dialog shows. A pending tournament has nothing played, so cancelling only removes it.
 * An active one has open matches and maybe live games: the service closes unplayed matches and lobby
 * games and drops reports nobody confirmed, a game already being played keeps running but no
 * longer counts, and results confirmed before the cancel keep their Elo.
 */
export function cancelDialogText(target: Pick<CancelTournamentTarget, "name" | "status" | "participantCount">): { title: string; lead: string; points: string[] } {
  const title = `Cancel ${target.name}?`;
  if (target.status === "pending") {
    const n = target.participantCount;
    return {
      title,
      lead: `The tournament is removed for the ${n} ${n === 1 ? "player" : "players"} who joined. Nothing has been played yet.`,
      points: ["You can't undo this."],
    };
  }
  return {
    title,
    lead: "No champion or final standings are recorded.",
    points: [
      "Open matches are cancelled and games not yet started are closed.",
      "Reports that wait for a confirm are dropped and do not count.",
      "Live games in progress keep running, but their results do not count for the tournament.",
      "Results already confirmed stay, and so does their Elo.",
      "You can't undo this. To keep the standings as they are, use End now (keep results) instead.",
    ],
  };
}

/**
 * Confirm dialog for cancelling a tournament (DELETE /api/tournaments/[slug]). It renders through
 * `SheetPortal` because the sheet is a containing block for fixed children. A failure shows in the
 * dialog and leaves it open.
 */
export function CancelTournamentDialog({ open, target, onClose, onCancelled }: {
  open: boolean;
  target: CancelTournamentTarget;
  onClose: () => void;
  /** Runs once the server confirmed the cancel; the dialog has closed by then. */
  onCancelled: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) setError(null); }, [open]);
  const text = cancelDialogText(target);
  const describedBy = useId();

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tournaments/${target.slug}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(typeof body.error === "string" ? body.error : "Failed to cancel");
      }
      onClose();
      onCancelled();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetPortal>
      <Modal open={open} onClose={() => { if (!busy) onClose(); }} title={text.title} describedBy={describedBy}>
        <div id={describedBy} className="space-y-3 text-sm text-text-secondary">
          <p>{text.lead}</p>
          <ul className="list-disc space-y-1 pl-5">
            {text.points.map((point) => <li key={point}>{point}</li>)}
          </ul>
        </div>
        {error && <p role="alert" className="mt-3 text-sm text-red-400">{error}</p>}
        <div className="mt-5 flex flex-wrap gap-2">
          <Button type="button" variant="danger" loading={busy} onClick={confirm}>Yes, cancel</Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>Keep tournament</Button>
        </div>
      </Modal>
    </SheetPortal>
  );
}
