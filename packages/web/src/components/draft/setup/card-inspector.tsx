"use client";

/**
 * The inline card inspector: big art, the full card text, stats and the copies box of one card.
 * It is a pane you place in the layout (a left column, a drawer, a side panel); there is no floating hover zoom.
 * On a phone (controller.sheet) the same content shows as a bottom sheet, only while a card is pinned.
 *
 * Props:
 *   controller    from `useCardInspector`. It owns hover, focus, pin and Esc, and carries the edit callbacks.
 *   copiesLabel   text over the copies box. Default "Copies in pool".
 *   emptyHint     shown in the pane when no card is shown. Has a default.
 *   renderActions extra footer buttons for the shown card, for example "More Dark Magician". (card may be undefined while loading.)
 *   className     for the pane.
 *
 * With no `onStep` in the controller the copies box is a plain readout and there is no Remove button.
 */

import * as React from "react";
import { Check, Minus, Plus, Trash2, X } from "lucide-react";
import { SheetPortal } from "@/components/sheet";
import type { CardInspectorController } from "./use-card-inspector";
import {
  GROUP_COLOR,
  GROUP_LABEL,
  MAX_POOL_COPIES,
  cardGroup,
  copiesLabel as copiesWord,
  fullImage,
  statFacts,
  textBlocks,
  type PoolCard,
  type PoolLane,
} from "./pool-browser-model";
import styles from "./setup.module.css";

/* ---------- copies stepper ---------- */

export interface CopiesStepperProps {
  name: string;
  copies: number;
  max?: number;
  onStep: (delta: number) => void;
  /** Makes the number a field. 0 removes the card. */
  onSet?: (copies: number) => void;
  /** "lg" for the inspector, "sm" (default) inside a list row. */
  size?: "sm" | "lg";
  /** False keeps the buttons out of the Tab order (a card tile reaches them by its own keys). Default true. */
  tabbable?: boolean;
  className?: string;
}

/** Minus, the copies, plus. Minus at 1 removes the card, so its label says so. */
export function CopiesStepper({ name, copies, max = MAX_POOL_COPIES, onStep, onSet, size = "sm", tabbable = true, className }: CopiesStepperProps) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const n = Number.parseInt(draft, 10);
    setDraft(null);
    if (Number.isFinite(n) && n !== copies && onSet) onSet(Math.min(max, Math.max(0, n)));
  };
  return (
    <span className={`${styles.stepper} ${size === "lg" ? styles.stepperLg : ""} ${className ?? ""}`}>
      <button
        type="button"
        tabIndex={tabbable ? 0 : -1}
        data-step="down"
        aria-label={copies <= 1 ? `Remove ${name} from the pool` : `One fewer ${name}`}
        onClick={() => onStep(-1)}
      >
        {copies <= 1 ? <X size={size === "lg" ? 17 : 14} aria-hidden="true" /> : <Minus size={size === "lg" ? 17 : 14} aria-hidden="true" />}
      </button>
      {onSet ? (
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          aria-label={`Copies of ${name}`}
          tabIndex={tabbable ? 0 : -1}
          value={draft ?? String(copies)}
          onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              setDraft(null);
            }
          }}
        />
      ) : (
        <output aria-label={copiesWord(copies)}>{copies}</output>
      )}
      <button type="button" tabIndex={tabbable ? 0 : -1} data-step="up" aria-label={`One more ${name}`} disabled={copies >= max} onClick={() => onStep(1)}>
        <Plus size={size === "lg" ? 17 : 14} aria-hidden="true" />
      </button>
    </span>
  );
}

/* ---------- inspector ---------- */

export interface CardInspectorProps {
  controller: CardInspectorController;
  copiesLabel?: string;
  emptyHint?: React.ReactNode;
  renderActions?: (card: PoolCard | undefined, id: number) => React.ReactNode;
  className?: string;
}

const DEFAULT_HINT = "Hover or focus a card to read it. Click a card to pin it here.";

function CardBody({ controller, id, copiesLabel, renderActions }: { controller: CardInspectorController; id: number; copiesLabel: string; renderActions?: CardInspectorProps["renderActions"] }) {
  const { getCard, locate, actions, readOnly } = controller;
  const card = getCard(id);
  const where = locate(id);
  const lane: PoolLane | null = where?.lane ?? null;
  const copies = where?.copies ?? 0;
  const name = card?.name ?? `Card ${id}`;
  const group = cardGroup(card);
  const blocks = textBlocks(card?.effectText);
  const facts = statFacts(card, lane);
  const typeLine = card ? [card.type, card.attribute].filter(Boolean).join(" · ") : GROUP_LABEL.unknown;
  const pinned = controller.pinnedId === id;
  const remove = () => {
    if (!lane) return;
    if (actions.onRemove) actions.onRemove(id, lane);
    else actions.onStep?.(id, -copies, lane);
  };

  return (
    <div className={styles.inspBody} style={{ "--k": GROUP_COLOR[group] } as React.CSSProperties}>
      <div className={styles.inspTop}>
        <span className={`${styles.inspState} ${pinned ? styles.inspPinned : ""}`}>
          {pinned && <Check size={12} aria-hidden="true" />}
          {pinned ? "Pinned" : "Preview"}
        </span>
        {lane && <span className={styles.inspLane}>{lane === "extra" ? "Extra Deck" : "Main Deck"}</span>}
        {pinned && !controller.sheet && (
          <button type="button" className={styles.inspUnpin} onClick={controller.unpin} title="Unpin (Esc)">
            <X size={14} aria-hidden="true" />
            Unpin
          </button>
        )}
      </div>
      <div className={styles.inspHead}>
        <div className={styles.inspArt} data-testid="inspector-art">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img key={id} src={fullImage(id)} alt="" decoding="async" />
        </div>
        <div className={styles.inspTitle}>
          <h3>{name}</h3>
          <p className={styles.inspType}>
            <i aria-hidden="true" />
            <span>{typeLine}</span>
          </p>
        </div>
      </div>
      <dl className={styles.inspFacts}>
        {facts.map((f) => (
          <div key={f.label}>
            <dd>{f.value}</dd>
            <dt>{f.label}</dt>
          </div>
        ))}
      </dl>
      <div className={styles.inspText}>
        <h4>Card text</h4>
        {blocks.length === 0 ? (
          <p className={styles.inspMuted}>{card ? "This card has no text." : "Card details are loading."}</p>
        ) : (
          blocks.map((b, i) => (b.heading ? <h5 key={i}>{b.text}</h5> : <p key={i}>{b.text}</p>))
        )}
      </div>
      <div className={styles.inspFoot}>
        <div className={styles.inspCopies}>
          <span>
            {copiesLabel}
            {!where && <small>Not in the pool</small>}
          </span>
          {readOnly || !lane ? (
            <b className={styles.inspCount} aria-label={`${copiesLabel}: ${copies}`}>
              {copies}
            </b>
          ) : (
            <CopiesStepper
              name={name}
              copies={copies}
              size="lg"
              onStep={(d) => actions.onStep?.(id, d, lane)}
              onSet={actions.onSetCopies ? (n) => actions.onSetCopies?.(id, n, lane) : undefined}
            />
          )}
        </div>
        {(!readOnly && lane) || renderActions ? (
          <div className={styles.inspBtns}>
            {!readOnly && lane && (
              <button type="button" className={styles.inspDanger} onClick={remove}>
                <Trash2 size={15} aria-hidden="true" />
                Remove card
              </button>
            )}
            {renderActions?.(card, id)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Sheet({ controller, id, copiesLabel, renderActions }: { controller: CardInspectorController; id: number; copiesLabel: string; renderActions?: CardInspectorProps["renderActions"] }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const { unpin, restoreFocus } = controller;
  React.useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[data-sheet-close]")?.focus();
    return () => restoreFocus();
  }, [restoreFocus]);
  const name = controller.getCard(id)?.name ?? `Card ${id}`;
  const trap = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), [href]") ?? []).filter((el) => el.tabIndex >= 0);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  return (
    <SheetPortal>
      <div className={styles.sheetLayer}>
        <button type="button" className={styles.sheetScrim} tabIndex={-1} aria-label="Close card" onClick={unpin} />
        <div ref={ref} className={styles.sheet} role="dialog" aria-modal="true" aria-label={name} onKeyDown={trap}>
          <span className={styles.sheetGrab} aria-hidden="true" />
          <CardBody controller={controller} id={id} copiesLabel={copiesLabel} renderActions={renderActions} />
          <button type="button" className={styles.sheetClose} data-sheet-close onClick={unpin}>
            Close
          </button>
        </div>
      </div>
    </SheetPortal>
  );
}

export function CardInspector({ controller, copiesLabel = "Copies in pool", emptyHint = DEFAULT_HINT, renderActions, className }: CardInspectorProps) {
  const { shownId, pinnedId, sheet, previewId } = controller;
  if (sheet) {
    return pinnedId === null ? null : <Sheet controller={controller} id={pinnedId} copiesLabel={copiesLabel} renderActions={renderActions} />;
  }
  // Using the pane (pointer or keyboard) while it only previews a card pins that card.
  const pinShown = () => {
    if (previewId !== null && pinnedId !== previewId) controller.pin(previewId);
  };
  return (
    <section
      className={`${styles.insp} ${className ?? ""}`}
      aria-label="Card inspector"
      data-shown={shownId ?? undefined}
      onPointerEnter={controller.holdPreview}
      onPointerLeave={() => controller.endPreview()}
      onPointerDownCapture={pinShown}
      onFocusCapture={pinShown}
    >
      {shownId === null ? (
        <div className={styles.inspEmpty}>
          <b>No card chosen</b>
          <span>{emptyHint}</span>
        </div>
      ) : (
        <CardBody controller={controller} id={shownId} copiesLabel={copiesLabel} renderActions={renderActions} />
      )}
    </section>
  );
}
