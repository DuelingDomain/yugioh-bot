"use client";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

export function SurrenderModal({ open, busy, multiplayer = false, onClose, onConfirm }: {
  open: boolean; busy: boolean; multiplayer?: boolean; onClose: () => void; onConfirm: () => void;
}) {
  return <Modal open={open} onClose={onClose} title="Surrender">
    <p className="text-sm text-text-secondary">{multiplayer
      ? "During your own turn, you leave immediately. Otherwise, your seat shows Leaving until the end of this turn and you cannot act. Once eliminated, you automatically spectate the remaining duel."
      : "This ends the duel. Confirm surrender?"}</p>
    <div className="mt-4 flex gap-2">
      <Button type="button" variant="danger" loading={busy} onClick={onConfirm}>Surrender</Button>
      <Button type="button" variant="ghost" onClick={onClose}>Keep playing</Button>
    </div>
  </Modal>;
}
