"use client";

import * as React from "react";
import { Minus, Plus, Trash2 } from "lucide-react";
import type { CardSummary } from "@/lib/card-types";
import { MAX_COPIES, MIN_COPIES } from "./readiness";

/** The selected card: art, copies stepper (1 to 3) and the Remove button. */
export function CubeInspector({
  card,
  fallbackId,
  poolLabel,
  copies,
  busy,
  compact = false,
  onSetCopies,
  onRemove,
}: {
  card: CardSummary | null;
  fallbackId: number;
  poolLabel: "Main" | "Extra";
  copies: number;
  busy: boolean;
  compact?: boolean;
  onSetCopies: (copies: number) => void;
  onRemove: () => void;
}) {
  const name = card?.name ?? `Passcode ${fallbackId}`;
  const kind = card ? `${card.type} · ${poolLabel} pool` : `Not in the catalog yet · ${poolLabel} pool`;
  const art = card ? (
    <span className="art">
      <img src={card.imageUrl || card.imageUrlSmall} alt="" />
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
      <div className="step" role="group" aria-label={`Copies of ${name}`}>
        <button
          type="button"
          aria-label="One fewer copy"
          disabled={busy || copies <= MIN_COPIES}
          onClick={() => onSetCopies(copies - 1)}
        >
          <Minus className="ic" aria-hidden="true" />
        </button>
        <output aria-live="polite">{copies}</output>
        <button
          type="button"
          aria-label="One more copy"
          disabled={busy || copies >= MAX_COPIES}
          onClick={() => onSetCopies(copies + 1)}
        >
          <Plus className="ic" aria-hidden="true" />
        </button>
      </div>
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
        </>
      ) : (
        <>
          {stepper}
          {remove}
        </>
      )}
    </div>
  );
}
