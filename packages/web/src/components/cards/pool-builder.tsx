"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { parseCustomCardIds, toCardCounts } from "@/lib/custom-card-pool";
import { getCached, putCards } from "@/lib/cards-cache";
import type { CardSummary } from "@/lib/card-types";
import { SetPicker } from "@/components/draft/set-picker";
import { CardPoolPanel } from "@/components/cards/card-pool-panel";

export interface PoolBuilderValue {
  setNames: string[];
  customCardText: string;
}

interface PoolBuilderProps {
  value: PoolBuilderValue;
  onChange: (value: PoolBuilderValue) => void;
  previewHeightClassName?: string;
  showPreview?: boolean;
  onPool?: (cards: CardSummary[], unknownIds: number[], loading: boolean) => void;
  /** Rendered between the Sets field and the Custom card IDs field (the draft form puts "Add a whole archetype" here). */
  afterSets?: ReactNode;
}

const DEBOUNCE_MS = 300;

export function PoolBuilder({
  value,
  onChange,
  previewHeightClassName = "h-[22rem]",
  showPreview = true,
  onPool,
  afterSets,
}: PoolBuilderProps) {
  const parsed = useMemo(() => parseCustomCardIds(value.customCardText), [value.customCardText]);
  const [cards, setCards] = useState<CardSummary[]>([]);
  const [unknownIds, setUnknownIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const reqId = useRef(0);

  const signature = useMemo(
    () => JSON.stringify({ s: [...value.setNames].sort(), c: [...parsed.cardIds].sort((a, b) => a - b) }),
    [value.setNames, parsed.cardIds],
  );

  useEffect(() => {
    const setNames = value.setNames;
    const customCardIds = parsed.cardIds;
    if (setNames.length === 0 && customCardIds.length === 0) {
      setCards([]);
      setUnknownIds([]);
      setLoading(false);
      return;
    }
    // Instant path: with no sets, qty is just the multiset count, so if every
    // id is already cached we resolve locally — no debounce, no network. This
    // makes edits like click-to-remove update the pool immediately.
    const { hits, missing } = getCached(customCardIds);
    if (setNames.length === 0 && missing.length === 0) {
      const counts = toCardCounts(customCardIds);
      const byId = new Map(hits.map((c) => [c.id, c]));
      const seen = new Set<number>();
      const local: CardSummary[] = [];
      for (const id of customCardIds) {
        if (seen.has(id)) continue;
        seen.add(id);
        const card = byId.get(id);
        if (card) local.push({ ...card, qty: counts.get(id) ?? 1 });
      }
      reqId.current++; // invalidate any in-flight network resolve
      setCards(local);
      setUnknownIds([]);
      setLoading(false);
      return;
    }
    const handle = setTimeout(async () => {
      const myReq = ++reqId.current;
      setLoading(true);
      setApiError(null);
      try {
        // Send the full customCardIds multiset (repeats preserved) so the
        // route computes the authoritative materialized-cube qty
        // (baseline + additive custom). qty cannot be derived from the
        // textarea alone — it ignores set/include baselines.
        const res = await fetch("/api/cards/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ setNames, customCardIds }),
        });
        if (myReq !== reqId.current) return;
        if (!res.ok) { setApiError("Failed to resolve cards. Please try again."); return; }
        const data = (await res.json()) as { cards: CardSummary[]; unknownIds: number[] };
        if (myReq !== reqId.current) return;
        putCards(data.cards);
        setCards(data.cards);
        setUnknownIds(data.unknownIds);
      } catch {
        if (myReq === reqId.current) { setApiError("Failed to resolve cards. Please try again."); }
      } finally {
        if (myReq === reqId.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  useEffect(() => {
    onPool?.(cards, unknownIds, loading);
  }, [cards, unknownIds, loading, onPool]);

  const cardCountText = `${parsed.cardIds.length} ${parsed.cardIds.length === 1 ? "card" : "cards"}`;

  return (
    <>
      <div className="wide">
        <label className="label" htmlFor="pool-set-search">
          Sets
        </label>
        <SetPicker selectedSets={value.setNames} onSetsChange={(setNames) => onChange({ ...value, setNames })} />
      </div>

      {afterSets}

      <div className="wide">
        <label className="label" htmlFor="custom-card-ids">
          Custom card IDs
        </label>
        <textarea
          id="custom-card-ids"
          className={`input${parsed.errors.length > 0 ? " bad" : ""}`}
          value={value.customCardText}
          onChange={(e) => onChange({ ...value, customCardText: e.target.value })}
          placeholder={"46986414\n83764718, 12345678"}
          rows={4}
          aria-invalid={parsed.errors.length > 0 ? true : undefined}
          aria-describedby="custom-card-ids-hint"
        />
        {parsed.errors.length > 0 ? (
          <p className="ferr" id="custom-card-ids-hint">
            <CircleAlert className="ic sm" aria-hidden="true" />
            Remove invalid card IDs: {parsed.errors.slice(0, 3).join(", ")}
          </p>
        ) : (
          <p className="hint" id="custom-card-ids-hint">
            One passcode per line or separated by commas. {cardCountText}.
          </p>
        )}
      </div>

      {apiError && (
        <p className="ferr wide" role="alert">
          <CircleAlert className="ic sm" aria-hidden="true" />
          {apiError}
        </p>
      )}

      {showPreview && (
        <div className="wide">
          <CardPoolPanel
            variant="sheet"
            title="Pool preview"
            cards={cards}
            unknownIds={unknownIds}
            loading={loading}
            heightClassName={previewHeightClassName}
            emptyMessage="Add sets or card IDs above to preview the pool."
            countMode="copies"
          />
        </div>
      )}
    </>
  );
}
