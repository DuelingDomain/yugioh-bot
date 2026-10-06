"use client";

import { cardImageUrl } from "@/lib/card-image-url";
import * as React from "react";
import { Minus, Plus, Trash2 } from "lucide-react";
import type { CardSummary } from "@/lib/card-types";
import { MAX_COPIES, MIN_COPIES } from "./readiness";

/**
 * The copies field: minus, a number you can type, plus. Typing commits on Enter or blur, and a
 * value that is not a whole number from 1 to 99 snaps back to the saved count.
 */
function CopiesStepper({
  name,
  copies,
  busy,
  onSetCopies,
}: {
  name: string;
  copies: number;
  busy: boolean;
  onSetCopies: (copies: number) => void;
}) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const commit = () => {
    if (draft == null) return;
    const next = Number(draft);
    setDraft(null);
    if (draft.trim() !== "" && Number.isInteger(next) && next >= MIN_COPIES && next <= MAX_COPIES && next !== copies) {
      onSetCopies(next);
    }
  };
  return (
    <div className="step" role="group" aria-label={`Copies of ${name}`}>
      <button
        type="button"
        aria-label="One fewer copy"
        disabled={busy || copies <= MIN_COPIES}
        onClick={() => onSetCopies(copies - 1)}
      >
        <Minus className="ic" aria-hidden="true" />
      </button>
      <input
        type="number"
        inputMode="numeric"
        aria-label="Copies in the cube"
        min={MIN_COPIES}
        max={MAX_COPIES}
        disabled={busy}
        value={draft ?? String(copies)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          else if (event.key === "Escape") setDraft(null);
        }}
      />
      <button
        type="button"
        aria-label="One more copy"
        disabled={busy || copies >= MAX_COPIES}
        onClick={() => onSetCopies(copies + 1)}
      >
        <Plus className="ic" aria-hidden="true" />
      </button>
    </div>
  );
}

/** The selected card: art, copies stepper (1 to 99, copies in the cube) and the Remove button. */
export function CubeInspector({
  card,
  fallbackId,
  poolLabel,
  copies,
  busy,
  compact = false,
  artwork,
  onSetCopies,
  onRemove,
}: {
  card: CardSummary | null;
  fallbackId: number;
  poolLabel: "Main" | "Extra";
  copies: number;
  busy: boolean;
  compact?: boolean;
  /** The art picker for the card; it renders nothing for a card with one art. */
  artwork?: React.ReactNode;
  onSetCopies: (copies: number) => void;
  onRemove: () => void;
}) {
  const name = card?.name ?? `Passcode ${fallbackId}`;
  const kind = card ? `${card.type}, ${poolLabel} pool` : `Not in the catalog yet, ${poolLabel} pool`;
  const art = card ? (
    <span className="art">
      <img src={cardImageUrl(card.id)} alt="" />
    </span>
  ) : null;
  const remove = (
    <button className={`btn btn-danger${compact ? " btn-sm" : ""}`} type="button" disabled={busy} onClick={onRemove}>
      <Trash2 className="ic sm" aria-hidden="true" />
      {compact ? "Remove" : "Remove from cube"}
    </button>
  );
  const stepper = (
    <div className="cp">
      <span className="label">Copies in the cube</span>
      <CopiesStepper name={name} copies={copies} busy={busy} onSetCopies={onSetCopies} />
      <p className="hint" style={{ flexBasis: "100%", margin: 0 }}>Copies in the cube, not a deck limit. A player is still given 3 of a card at most.</p>
    </div>
  );
  return (
    <div className="ce-insp">
      {art}
      <div>
        <h3>{name}</h3>
        <p className="k">{kind}</p>
      </div>
      {compact ? (
        <>
          <div style={{ justifySelf: "start" }}>{remove}</div>
          {stepper}
          {artwork ? <div style={{ gridColumn: "1 / -1" }}>{artwork}</div> : null}
        </>
      ) : (
        <>
          {stepper}
          {artwork}
          {remove}
        </>
      )}
    </div>
  );
}
