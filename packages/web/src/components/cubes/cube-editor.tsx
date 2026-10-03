"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Download, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { PageFrame } from "@/components/decks/page-frame";
import { ConfirmPanel, SectionHead, SizeBar, StatusLine, SvButton, svButtonClass, Zone } from "@/components/sheet";
import type { CardSummary } from "@/lib/card-types";
import { putCards } from "@/lib/cards-cache";
import { isExtraDeckCardClient, poolToGridCards, type CubeCardDto, type CubePoolsDto } from "@/lib/cube-pools";
import { AddCardsBody, type ImportOutcome } from "./cube-add-rail";
import { CubeCardGrid } from "./cube-card-grid";
import {
  DEFAULT_VIEW,
  FILTER_OPTIONS,
  SORT_OPTIONS,
  TRIBUTE_OPTIONS,
  viewPool,
  type PoolFilter,
  type PoolSort,
  type PoolTribute,
  type PoolView,
} from "./cube-grid-model";
import { CubeInspector } from "./cube-inspector";
import { CubeBottomSheet, UndoToast } from "./cube-sheet";
import { parseAddTab } from "./library-model";
import {
  cardsToRaise,
  clampCopies,
  cubeReadiness,
  poolTotals,
  THEME_CHOICES,
  THEME_EXTRA_CARDS,
  THEME_EXTRA_NEEDED,
  THEME_MAIN_CARDS,
  THEME_MAIN_NEEDED,
} from "./readiness";
import styles from "./cubes.module.css";

interface CubeDto {
  id: number;
  name: string;
  archetype: string | null;
  banlist: string | null;
}

type PoolName = "main" | "extra";

interface UndoInfo {
  removalId: number;
  message: string;
  catalogCardId: number;
  pool: PoolName;
  copies: number;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function CubeEditor({ cubeId }: { cubeId: number }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // When opened from a draft's cube builder, return there instead of the library.
  const from = searchParams.get("from");
  const fromDraft = !!from && from.startsWith("/draft/");
  const backHref = fromDraft ? from : "/cubes";
  const backLabel = fromDraft ? "Back to draft" : "All cubes";
  const initialTab = parseAddTab(searchParams.get("add"));

  const [cube, setCube] = React.useState<CubeDto | null>(null);
  const [pools, setPools] = React.useState<CubePoolsDto>({ main: [], extra: [] });
  const [cardsById, setCardsById] = React.useState<Map<number, CardSummary>>(new Map());
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [editingName, setEditingName] = React.useState(false);
  const [nameDraft, setNameDraft] = React.useState("");
  const [savingName, setSavingName] = React.useState(false);
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);
  const [activePool, setActivePool] = React.useState<PoolName>("main");
  const [view, setView] = React.useState<PoolView>(DEFAULT_VIEW);
  const [selectedId, setSelectedId] = React.useState<number | null>(null);
  const [undo, setUndo] = React.useState<UndoInfo | null>(null);
  const removalSequence = React.useRef(0);
  const [addSheetOpen, setAddSheetOpen] = React.useState(false);
  const [railHidden, setRailHidden] = React.useState(false);
  const layoutRef = React.useRef<HTMLDivElement>(null);
  const railRef = React.useRef<HTMLElement>(null);

  const applyDetail = React.useCallback((data: { cube?: CubeDto; pools: CubePoolsDto; cards: CardSummary[] }) => {
    if (data.cube) setCube(data.cube);
    setPools(data.pools);
    putCards(data.cards);
    setCardsById(new Map(data.cards.map((c) => [c.id, c])));
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    fetch(`/api/cubes/${cubeId}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("load failed"))))
      .then((data) => {
        if (cancelled) return;
        applyDetail(data);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setError("Failed to load cube.");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [cubeId, applyDetail]);

  // The rail is hidden by a container query on narrow screens; the phone sheets take over.
  React.useEffect(() => {
    const layout = layoutRef.current;
    const rail = railRef.current;
    if (!layout || !rail) return;
    const measure = () => setRailHidden(getComputedStyle(rail).display === "none");
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(layout);
    return () => ro.disconnect();
  }, [loading]);

  const mutate = async (op: Record<string, unknown>): Promise<ImportOutcome | null> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/cubes/${cubeId}/cards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(op),
      });
      const data = (await res.json().catch(() => ({}))) as {
        pools?: CubePoolsDto;
        cards?: CardSummary[];
        error?: string;
      } & ImportOutcome;
      if (!res.ok || !data.pools || !data.cards) {
        setError(data.error ?? "Update failed.");
        return null;
      }
      applyDetail({ pools: data.pools, cards: data.cards });
      return { added: data.added, unknown: data.unknown, copies: data.copies };
    } finally {
      setBusy(false);
    }
  };

  const addCard = (card: CardSummary) => {
    putCards([card]);
    const pool = isExtraDeckCardClient(card) ? "extra" : "main";
    void mutate({ op: "add", catalogCardId: card.id, pool });
  };

  const entryFor = (id: number | null): { entry: CubeCardDto; pool: PoolName } | null => {
    if (id == null) return null;
    const inMain = pools.main.find((e) => e.catalogCardId === id);
    if (inMain) return { entry: inMain, pool: "main" };
    const inExtra = pools.extra.find((e) => e.catalogCardId === id);
    return inExtra ? { entry: inExtra, pool: "extra" } : null;
  };

  const selected = entryFor(selectedId);
  const selectedCard = selectedId != null ? (cardsById.get(selectedId) ?? null) : null;

  const setCopies = async (copies: number) => {
    if (!selected || busy) return;
    const next = clampCopies(copies);
    if (next === selected.entry.maxCopies) return;
    await mutate({ op: "setMaxCopies", catalogCardId: selected.entry.catalogCardId, maxCopies: next });
  };

  const removeSelected = async () => {
    if (!selected || busy) return;
    const { entry, pool } = selected;
    const name = cardsById.get(entry.catalogCardId)?.name ?? `Passcode ${entry.catalogCardId}`;
    const result = await mutate({ op: "remove", catalogCardId: entry.catalogCardId });
    if (!result) return;
    setSelectedId(null);
    setUndo({
      removalId: ++removalSequence.current,
      message: `Removed ${name} (×${entry.maxCopies}) from ${pool === "main" ? "Main" : "Extra"}`,
      catalogCardId: entry.catalogCardId,
      pool,
      copies: entry.maxCopies,
    });
  };

  const undoRemove = async () => {
    if (!undo) return;
    const info = undo;
    const result = await mutate({
      op: "add",
      catalogCardId: info.catalogCardId,
      pool: info.pool,
      maxCopies: info.copies,
    });
    if (result) setUndo(null);
  };

  // Keys 1, 2 and 3 set copies, Delete removes, Esc goes back to Add cards.
  const keyHandler = React.useRef<(event: KeyboardEvent) => void>(() => {});
  keyHandler.current = (event) => {
    if (selectedId == null || isTypingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "1" || event.key === "2" || event.key === "3") {
      event.preventDefault();
      void setCopies(Number(event.key));
    } else if (event.key === "Delete") {
      event.preventDefault();
      void removeSelected();
    } else if (event.key === "Escape") {
      setSelectedId(null);
    }
  };
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => keyHandler.current(event);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const dismissUndo = React.useCallback(() => setUndo(null), []);

  const startRename = () => {
    setNameDraft(cube?.name ?? "");
    setEditingName(true);
  };

  const saveName = async () => {
    const next = nameDraft.trim();
    if (!next || next === cube?.name) {
      setEditingName(false);
      return;
    }
    setSavingName(true);
    setError(null);
    try {
      const res = await fetch(`/api/cubes/${cubeId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: next }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Failed to rename cube.");
        return;
      }
      setCube((cur) => (cur ? { ...cur, name: next } : cur));
      setEditingName(false);
    } finally {
      setSavingName(false);
    }
  };

  const deleteCube = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/cubes/${cubeId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Failed to delete cube.");
        setConfirmingDelete(false);
        return;
      }
      router.push("/cubes");
    } finally {
      setBusy(false);
    }
  };

  const copiesInCube = (id: number) => entryFor(id)?.entry.maxCopies ?? 0;

  const mainTotals = poolTotals(pools.main);
  const extraTotals = poolTotals(pools.extra);
  const readiness = cubeReadiness(mainTotals.usable, extraTotals.usable);

  const activeEntries = pools[activePool];
  const grid = poolToGridCards(activeEntries, cardsById);
  const unknown = activeEntries
    .filter((e) => !cardsById.has(e.catalogCardId))
    .map((e) => ({ id: e.catalogCardId, copies: e.maxCopies }));
  const shown = viewPool(grid.cards, view);
  const filtering = view.search.trim() !== "" || view.filter !== "all" || view.tribute !== "any";

  if (loading) {
    return (
      <PageFrame title="Cube" back={{ href: backHref, label: backLabel }}>
        <p className={styles.lede} role="status">
          Loading cube...
        </p>
      </PageFrame>
    );
  }

  const railProps = {
    initialTab,
    busy,
    copiesInCube,
    onAddCard: addCard,
    onSeedArchetype: (archetype: string) => mutate({ op: "seedArchetype", archetype }),
    onImportCodes: (codes: number[]) => mutate({ op: "import", codes }),
    onImportYdk: (text: string) => mutate({ op: "importYdk", text }),
  };

  const inspector = selected ? (
    <CubeInspector
      card={selectedCard}
      fallbackId={selected.entry.catalogCardId}
      poolLabel={selected.pool === "main" ? "Main" : "Extra"}
      copies={selected.entry.maxCopies}
      busy={busy}
      compact={railHidden}
      onSetCopies={(n) => void setCopies(n)}
      onRemove={() => void removeSelected()}
    />
  ) : null;

  const raise = cardsToRaise(pools.main, readiness.main.short);

  const mainRow = (
    <div className={styles.rdRow}>
      <span>Main</span>
      <SizeBar
        className={styles.rdSize}
        label={`${readiness.main.have} of ${THEME_MAIN_NEEDED} main copies`}
        value={readiness.main.have}
        min={THEME_MAIN_NEEDED}
        max={Math.max(THEME_MAIN_NEEDED, readiness.main.have)}
      />
      <span className={styles.rdVal} data-short={readiness.main.short > 0 ? "true" : undefined}>
        <b>{readiness.main.have}</b> / {THEME_MAIN_NEEDED}
      </span>
    </div>
  );
  const extraRow = (
    <div className={styles.rdRow}>
      <span>Extra</span>
      <SizeBar
        className={styles.rdSize}
        label={`${readiness.extra.have} of ${THEME_EXTRA_NEEDED} Extra copies`}
        value={readiness.extra.have}
        min={THEME_EXTRA_NEEDED}
        max={Math.max(THEME_EXTRA_NEEDED, readiness.extra.have)}
      />
      <span className={styles.rdVal}>
        <b>{readiness.extra.have}</b> / {THEME_EXTRA_NEEDED}
      </span>
    </div>
  );

  return (
    <PageFrame
      back={{ href: backHref, label: backLabel }}
      title={cube?.name ?? "Cube"}
      actions={
        <>
          <SvButton aria-label="Rename cube" title="Rename cube" disabled={editingName} onClick={startRename}>
            <Pencil size={16} aria-hidden="true" />
            Rename
          </SvButton>
          <a className={svButtonClass("ghost")} href={`/api/cubes/${cubeId}/ydk`} download title="Download this cube as a .ydk file">
            <Download size={16} aria-hidden="true" />
            Export YDK
          </a>
          <SvButton variant="danger" disabled={busy} onClick={() => setConfirmingDelete(true)}>
            <Trash2 size={16} aria-hidden="true" />
            Delete cube
          </SvButton>
        </>
      }
    >
      {confirmingDelete && (
        <ConfirmPanel
          className={styles.cfmWrap}
          title="Delete this cube?"
          confirmLabel="Delete cube"
          cancelLabel="Keep"
          busy={busy}
          onConfirm={() => void deleteCube()}
          onCancel={() => setConfirmingDelete(false)}
        >
          <p className="hint">This can&apos;t be undone. Anyone on the server loses it.</p>
        </ConfirmPanel>
      )}

      {editingName && (
        <div className="ce-rename">
          <input
            className="input"
            aria-label="Cube name"
            value={nameDraft}
            autoFocus
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveName();
              if (e.key === "Escape") setEditingName(false);
            }}
          />
          <SvButton variant="primary" disabled={savingName} onClick={() => void saveName()}>
            <Check size={16} aria-hidden="true" />
            Save name
          </SvButton>
          <button className="ib" type="button" aria-label="Cancel rename" onClick={() => setEditingName(false)}>
            <X className="ic" aria-hidden="true" />
          </button>
        </div>
      )}

      <section className={styles.head} aria-label="Cube summary">
        <div className={styles.headFacts}>
          <p className={styles.facts}>
            {cube?.archetype ? <span>Seeded from <b>{cube.archetype}</b></span> : <span>Built by hand</span>}
            {cube?.banlist ? <span>{cube.banlist} banlist</span> : null}
            {busy ? <span className={styles.busy}>Saving…</span> : null}
          </p>
          <p className={styles.counts}>
            <span>
              Main <b>{mainTotals.cards}</b> {plural(mainTotals.cards, "card", "cards")}, <b>{mainTotals.copies}</b>{" "}
              {plural(mainTotals.copies, "copy", "copies")}
            </span>
            <span>
              Extra <b>{extraTotals.cards}</b> {plural(extraTotals.cards, "card", "cards")}, <b>{extraTotals.copies}</b>{" "}
              {plural(extraTotals.copies, "copy", "copies")}
            </span>
          </p>
        </div>
        <section className={styles.check} aria-labelledby="ce-rd">
          <SectionHead
            id="ce-rd"
            title="Theme draft check"
            note={`${THEME_CHOICES} choices a pick, ${THEME_MAIN_CARDS} main and ${THEME_EXTRA_CARDS} extra`}
          />
          {mainRow}
          {extraRow}
          {readiness.state === "blocked" ? (
            <StatusLine tone="warn">
              <b>
                {readiness.main.short} main {plural(readiness.main.short, "copy", "copies")} short.
              </b>{" "}
              A theme draft can&apos;t start with it.{" "}
              {raise != null
                ? `Raising ${raise} main ${plural(raise, "card", "cards")} to ×3 covers it.`
                : "Add more main cards to cover it."}
            </StatusLine>
          ) : readiness.state === "soft" ? (
            <StatusLine tone="neutral">
              <b>Extra may come up short.</b> {readiness.extra.have} of {THEME_EXTRA_NEEDED} Extra copies. A theme
              draft still starts.
            </StatusLine>
          ) : (
            <StatusLine tone="ready">
              <b>Ready for a theme draft.</b> Main and Extra both covered.
            </StatusLine>
          )}
        </section>
      </section>

      {error && (
        <div role="alert">
          <StatusLine tone="block">{error}</StatusLine>
        </div>
      )}

      <div className="ce" ref={layoutRef}>
        <div>
          <div className="ce-tools">
            <div className="seg" role="group" aria-label="Pool">
              <button
                type="button"
                aria-pressed={activePool === "main"}
                onClick={() => {
                  setActivePool("main");
                  setSelectedId(null);
                }}
              >
                Main<span className="n">{mainTotals.cards}</span>
              </button>
              <button
                type="button"
                aria-pressed={activePool === "extra"}
                onClick={() => {
                  setActivePool("extra");
                  setSelectedId(null);
                }}
              >
                Extra<span className="n">{extraTotals.cards}</span>
              </button>
            </div>
            <SvButton variant="ghost" className={styles.addBtn} onClick={() => setAddSheetOpen(true)}>
              <Plus size={16} aria-hidden="true" />
              Add cards
            </SvButton>
            <div className="srch">
              <Search className="ic" aria-hidden="true" />
              <input
                className="input"
                aria-label="Search this cube"
                placeholder="Search this cube"
                value={view.search}
                onChange={(e) => setView((v) => ({ ...v, search: e.target.value }))}
              />
            </div>
            <div className="ce-filt">
              <select
                className="input select"
                aria-label="Card type"
                value={view.filter}
                onChange={(e) => setView((v) => ({ ...v, filter: e.target.value as PoolFilter }))}
              >
                {FILTER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <select
                className="input select"
                aria-label="Tributes"
                value={view.tribute}
                onChange={(e) => setView((v) => ({ ...v, tribute: e.target.value as PoolTribute }))}
              >
                {TRIBUTE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <select
                className="input select"
                aria-label="Sort"
                value={view.sort}
                onChange={(e) => setView((v) => ({ ...v, sort: e.target.value as PoolSort }))}
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {activeEntries.length === 0 ? (
            <div className={styles.emptyPool}>
              <span className={styles.emptyZones} aria-hidden="true">
                <Zone state="empty" size="md" />
                <Zone state="empty" size="md" />
                <Zone state="empty" size="md" />
              </span>
              <p>
                {activePool === "main"
                  ? "Import passcodes or add cards to build the main pool."
                  : "Extra deck cards land here automatically."}
              </p>
            </div>
          ) : (
            <>
              {shown.length === 0 && unknown.length === 0 && <p className={styles.noMatch}>No cards match.</p>}
              <CubeCardGrid
                label={activePool === "main" ? "Main pool" : "Extra pool"}
                cards={shown}
                unknown={filtering ? [] : unknown}
                selectedId={selectedId}
                onSelect={(id) => setSelectedId(id)}
              />
            </>
          )}
        </div>

        <aside
          ref={railRef}
          className="panel ce-rail"
          aria-label={selected && !railHidden ? "Selected card" : "Add cards"}
        >
          {selected && !railHidden ? (
            <>
              <h2>
                Selected
                <button
                  className="ib"
                  type="button"
                  aria-label="Close, back to Add cards"
                  onClick={() => setSelectedId(null)}
                >
                  <X className="ic" aria-hidden="true" />
                </button>
              </h2>
              {inspector}
            </>
          ) : (
            <>
              <h2>Add cards</h2>
              <AddCardsBody {...railProps} />
            </>
          )}
        </aside>
      </div>

      {railHidden && selected && (
        <CubeBottomSheet label={selectedCard?.name ?? `Passcode ${selected.entry.catalogCardId}`} onClose={() => setSelectedId(null)}>
          {inspector}
        </CubeBottomSheet>
      )}
      {railHidden && addSheetOpen && (
        <CubeBottomSheet label="Add cards" onClose={() => setAddSheetOpen(false)}>
          <AddCardsBody {...railProps} />
        </CubeBottomSheet>
      )}
      {undo && <UndoToast key={undo.removalId} message={undo.message} busy={busy} onUndo={() => void undoRemove()} onDismiss={dismissUndo} />}
    </PageFrame>
  );
}
