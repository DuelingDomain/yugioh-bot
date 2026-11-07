"use client";

import { useRef, useState } from "react";
import { FileUp, ListPlus } from "lucide-react";
import { bulkImportDecks, previewDeckImport, type ImportMode } from "@/components/decks/import-api";
import { hasErrors, pasteSource, readSources, toItems, toBulkRows, type SourceBatch } from "@/components/decks/bulk-import";
import { cx, SheetButton } from "@/components/duel/sheet-ui";
import ui from "@/components/duel/sheet-ui.module.css";
import r from "./lobby-room.module.css";

/**
 * The deck list step of the setup room. A saved deck can be picked in the select above; this step takes a pasted list
 * or a .ydk file instead. It runs the same preview and save as the deck import page, then seats the new saved deck.
 * Skippable: the table works without a list, and the card reads are only faster and more exact with one.
 */
export function LobbyDeckList({ disabled, onSeat, mode = "standard", seated }: { disabled?: boolean; onSeat: (savedDeckId: number) => Promise<unknown>; mode?: ImportMode; seated?: boolean }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const file = useRef<HTMLInputElement>(null);

  async function run(batch: SourceBatch) {
    if (!batch.sources.length) { setMessage(batch.notes[0] ?? "Nothing to import."); return; }
    setBusy(true); setMessage("");
    try {
      const preview = await previewDeckImport(batch.sources);
      const usable = toItems(preview.rows, mode).find(item => !hasErrors(item.row));
      if (!usable) { setMessage(preview.rows[0]?.errors[0]?.message ?? "No deck found in that list."); return; }
      // The same list is already saved: seat that deck. A new copy is saved only for a new list.
      const duplicate = usable.row.duplicateOf;
      let id = duplicate?.kind === "saved" ? duplicate.deckId : undefined;
      if (id === undefined) {
        const result = await bulkImportDecks(toBulkRows([{ ...usable, selected: true, name: usable.name || "Remote deck" }]));
        id = result.created[0]?.id;
        if (id === undefined) { setMessage(result.failed[0]?.errors[0]?.message ?? "The deck could not be saved."); return; }
      }
      if ((await onSeat(id)) === false) { setMessage("The table did not accept that deck. See the message above."); return; }
      setText(""); setOpen(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The list could not be read.");
    } finally { setBusy(false); }
  }

  return <div className={r.deckList} data-testid="deck-list-step">
    <div className={r.deckListHead}>
      <span className={r.deckListText}><b>{seated ? "Replace with a list" : "Add deck list"}</b><span> · or pick a saved deck above.</span></span>
      <SheetButton size="sm" kind="quiet" disabled={disabled || busy} onClick={() => setOpen(value => !value)} aria-expanded={open} data-testid="deck-list-toggle"><ListPlus size={14} strokeWidth={1.7} aria-hidden />{open ? "Hide" : "Paste or upload"}</SheetButton>
    </div>
    {open ? <div className={r.deckListBody}>
      <textarea className={cx(ui.textarea)} rows={5} value={text} onChange={event => setText(event.target.value)} disabled={disabled || busy}
        placeholder={"Paste a card list, a .ydk text or a ydke:// link"} aria-label="Deck list text" data-testid="deck-list-text" />
      <div className={r.deckListActions}>
        <SheetButton size="sm" kind="primary" loading={busy} disabled={disabled || busy || !text.trim()} onClick={() => void run(pasteSource(text))} data-testid="deck-list-use">Use this list</SheetButton>
        <SheetButton size="sm" disabled={disabled || busy} onClick={() => file.current?.click()}><FileUp size={14} strokeWidth={1.7} aria-hidden />Upload .ydk</SheetButton>
        <input ref={file} type="file" accept=".ydk,.txt,text/plain" hidden data-testid="deck-list-file" onChange={event => {
          const picked = Array.from(event.target.files ?? []); event.target.value = "";
          if (picked.length) void readSources(picked.slice(0, 1)).then(run).catch(error => setMessage(error instanceof Error ? error.message : "The file could not be read."));
        }} />
      </div>
      {message ? <p className={r.issues} role="alert">{message}</p> : null}
    </div> : null}
  </div>;
}
