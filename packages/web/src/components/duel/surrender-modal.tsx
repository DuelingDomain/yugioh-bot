"use client";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

export function SurrenderModal({ open, busy, onClose, onConfirm }: {
  open: boolean; busy: boolean; onClose: () => void; onConfirm: () => void;
}) {
  return <Modal open={open} onClose={onClose} title="Surrender">
    <p className="text-sm text-text-secondary">This ends the duel. Confirm surrender?</p>
    <div className="mt-4 flex gap-2">
      <Button type="button" variant="danger" loading={busy} onClick={onConfirm}>Surrender</Button>
      <Button type="button" variant="ghost" onClick={onClose}>Keep playing</Button>
    </div>
  </Modal>;
}
