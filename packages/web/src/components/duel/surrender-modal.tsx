"use client";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

export function SurrenderModal({ open, busy, multiplayer = false, tag = false, onClose, onConfirm }: {
  open: boolean; busy: boolean; multiplayer?: boolean; tag?: boolean; onClose: () => void; onConfirm: () => void;
}) {
  return <Modal open={open} onClose={onClose} title="Surrender">
    <p className="text-sm text-text-secondary">{multiplayer
      ? "You leave at once. If a chain is open, your seat shows Leaving and you leave when the chain finishes. Once eliminated, you automatically spectate the remaining duel."
      : tag ? "Your team loses now. The duel ends at once. Confirm surrender?"
      : "This ends the duel. Confirm surrender?"}</p>
    <div className="mt-4 flex gap-2">
      <Button type="button" variant="danger" loading={busy} onClick={onConfirm}>Surrender</Button>
      <Button type="button" variant="ghost" onClick={onClose}>Keep playing</Button>
    </div>
  </Modal>;
}
