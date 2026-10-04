"use client";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

export function SurrenderModal({ open, busy, multiplayer = false, tag = false, onClose, onConfirm }: {
  open: boolean; busy: boolean; multiplayer?: boolean; tag?: boolean; onClose: () => void; onConfirm: () => void;
}) {
  return <Modal open={open} onClose={onClose} title="Surrender">
    <p className="text-sm text-text-secondary">{multiplayer
      ? "Are you sure? During your own turn, you leave immediately. Otherwise, your seat shows Leaving until the end of this turn and you cannot act. Once eliminated, you automatically spectate the remaining duel."
      : tag ? "Are you sure? Your team loses now. The duel ends at once."
      : "Are you sure? This ends the duel."}</p>
    <div className="mt-4 flex gap-2">
      <Button type="button" variant="danger" loading={busy} onClick={onConfirm}>Surrender</Button>
      <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
    </div>
  </Modal>;
}
