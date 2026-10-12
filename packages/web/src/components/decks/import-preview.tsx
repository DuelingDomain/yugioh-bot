"use client";

import { useId, useState } from "react";
import { ChevronDown, CircleAlert, TriangleAlert } from "lucide-react";
import { SvButton } from "@/components/sheet";
import { MAX_NAME_LENGTH } from "./model";
import { duplicateLabel, hasErrors, importModeLabel, isLookupLimited, omittedCount, realIssues, selectedItems, type PreviewItem } from "./bulk-import";
import { CardStrip, MasterLabel, RowIcon, useCardPreview, type CardInfoMap, type ThumbBind } from "./import-cards";
import styles from "./library.module.css";

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

type Detail = { key: string; tone: "error" | "warn"; code: string; text: string; line?: number };

function detailsOf(item: PreviewItem): Detail[] {
  return [
    ...realIssues(item.row.errors).map((issue, i): Detail => ({ key: `e${i}`, tone: "error", code: issue.code, text: issue.message, line: issue.line })),
    ...realIssues(item.row.warnings).map((issue, i): Detail => ({ key: `w${i}`, tone: "warn", code: issue.code, text: issue.message, line: issue.line })),
  ];
}

function PreviewRow({ item, items, cards, bind, disabled, onRename, onToggle, onRecheck }: {
  item: PreviewItem;
  cards: CardInfoMap;
  bind: ThumbBind;
  items: PreviewItem[];
  disabled: boolean;
  onRename: (name: string) => void;
  onToggle: () => void;
  onRecheck: () => void;
}) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const { row } = item;
  const blocked = hasErrors(row);
  const duplicate = duplicateLabel(item, items);
  const details = detailsOf(item);
  const label = item.name.trim() || row.name;
  const errorCount = realIssues(row.errors).length;
  const warningCount = realIssues(row.warnings).length;
  const omitted = omittedCount(row);
  // The first problem reads inline while the list is closed: an error first, else the first warning.
  const lead = details.find((detail) => detail.tone === "error") ?? details[0];
  return (
    <li className={styles.pvRow} data-blocked={blocked ? "" : undefined} data-selected={item.selected ? "" : undefined}>
      <input
        type="checkbox"
        className={styles.pvCheck}
        checked={item.selected}
        disabled={blocked || disabled}
        aria-label={blocked ? `${label} cannot be imported` : `Import ${label}`}
        onChange={onToggle}
      />
      <div className={styles.pvMain}>
        <div className={styles.pvTop}>
          <RowIcon row={row} cards={cards} bind={bind} />
          <div className={styles.pvHead}>
            <input
              type="text"
              className={`input ${styles.pvName}`}
              value={item.name}
              maxLength={MAX_NAME_LENGTH}
              disabled={disabled}
              aria-label={`Deck name for ${row.name}`}
              onChange={(event) => onRename(event.target.value)}
            />
            <p className={styles.counts}>
              <span>{importModeLabel(item.mode)}</span>
              <span>Main <b>{row.counts.main}</b></span>
              <span>Extra <b>{row.counts.extra}</b></span>
              <span>Side <b>{row.counts.side}</b></span>
              <MasterLabel code={row.deck.deckMaster} cards={cards} bind={bind} />
            </p>
          </div>
        </div>
        <CardStrip row={row} cards={cards} bind={bind} label={label} />
        {isLookupLimited(row) ? (
          <p className={styles.pvFail}>
            The card check hit its limit for this deck. Check it again in a moment.{" "}
            <SvButton variant="quiet" disabled={disabled} onClick={onRecheck}>Re-check</SvButton>
          </p>
        ) : null}
        {item.failure ? <p className={styles.pvFail}>Not imported. {item.failure}</p> : null}
        {duplicate || details.length > 0 ? (
          <p className={styles.pvChips}>
            {duplicate ? <span className={styles.pvDup}>{duplicate}</span> : null}
            {errorCount > 0 ? (
              <button type="button" className={styles.pvChip} data-tone="error" aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen((o) => !o)}>
                <CircleAlert size={14} aria-hidden="true" />
                {plural(errorCount, "error")}
                <ChevronDown size={14} aria-hidden="true" className={styles.pvCaret} />
              </button>
            ) : null}
            {warningCount > 0 ? (
              <button type="button" className={styles.pvChip} data-tone="warn" aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen((o) => !o)}>
                <TriangleAlert size={14} aria-hidden="true" />
                {plural(warningCount, "warning")}
                <ChevronDown size={14} aria-hidden="true" className={styles.pvCaret} />
              </button>
            ) : null}
            {lead && !open ? <span className={styles.pvLead} data-tone={lead.tone}>{lead.text}</span> : null}
          </p>
        ) : null}
        {open && (details.length > 0 || omitted > 0) ? (
          <ul id={detailsId} className={styles.pvDetails}>
            {details.map((detail) => (
              <li key={detail.key} data-tone={detail.tone}>
                <span className={styles.pvCode}>{detail.code}</span>
                {detail.line != null ? <span className={styles.pvLine}>Line {detail.line}</span> : null}
                {detail.text}
              </li>
            ))}
            {omitted > 0 ? <li data-tone="more">and {omitted} more</li> : null}
          </ul>
        ) : null}
      </div>
    </li>
  );
}

export function ImportPreviewList({ items, cards, maxDecks, busy, onRename, onToggle, onToggleAll, onRecheck, onImport, onCancel }: {
  items: PreviewItem[];
  cards: CardInfoMap;
  maxDecks: number;
  busy: boolean;
  onRename: (rowId: string, name: string) => void;
  onToggle: (rowId: string) => void;
  onToggleAll: () => void;
  onRecheck: (rowId: string) => void;
  onImport: () => void;
  onCancel: () => void;
}) {
  const usable = items.filter((item) => !hasErrors(item.row));
  const chosen = selectedItems(items).length;
  const allChosen = usable.length > 0 && chosen === usable.length;
  const blockedCount = items.length - usable.length;
  const tooMany = maxDecks > 0 && chosen > maxDecks;
  const { bind, overlay } = useCardPreview(cards);

  if (items.length === 0) {
    return (
      <div className={styles.pvEmpty} role="status">
        <p>No decks were found in this import.</p>
        <p className={styles.hintText}>Check that the files are .ydk files or ydke:// codes.</p>
        <SvButton variant="quiet" onClick={onCancel}>Start over</SvButton>
      </div>
    );
  }

  return (
    <div className={styles.pv}>
      <div className={styles.pvBar}>
        <label className={styles.pvAll}>
          <input
            type="checkbox"
            checked={allChosen}
            ref={(box) => { if (box) box.indeterminate = chosen > 0 && !allChosen; }}
            disabled={usable.length === 0 || busy}
            onChange={onToggleAll}
          />
          Select all
        </label>
        <p className={styles.pvSummary} aria-live="polite">
          {plural(items.length, "deck")} found, {chosen} selected
          {blockedCount > 0 ? `, ${blockedCount} with errors` : ""}
          {tooMany ? `. Up to ${maxDecks} decks per import. Clear some boxes.` : items.length >= maxDecks ? `. Up to ${maxDecks} decks per import.` : ""}
        </p>
        <span className={styles.pvActs}>
          <SvButton variant="quiet" disabled={busy} onClick={onCancel}>Cancel</SvButton>
          <SvButton variant="primary" disabled={chosen === 0 || tooMany || busy} aria-busy={busy || undefined} onClick={onImport}>
            {busy ? "Importing…" : `Import ${plural(chosen, "deck")}`}
          </SvButton>
        </span>
      </div>
      <ul className={styles.pvList} aria-label="Decks to import">
        {items.map((item) => (
          <PreviewRow
            key={item.row.rowId}
            item={item}
            items={items}
            cards={cards}
            bind={bind}
            disabled={busy}
            onRename={(name) => onRename(item.row.rowId, name)}
            onToggle={() => onToggle(item.row.rowId)}
            onRecheck={() => onRecheck(item.row.rowId)}
          />
        ))}
      </ul>
      {overlay}
    </div>
  );
}
