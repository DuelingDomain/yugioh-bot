"use client";

import * as React from "react";
import type { CardSummary } from "@/lib/card-types";
import { getCached, putCards } from "@/lib/cards-cache";
import {
  NameTakenError,
  configPool,
  createPoolCube,
  fetchCubeDetail,
  fetchCubeOptions,
  fetchDraftPools,
  fetchSessionUserId,
  replaceCubeMain,
  type CubeOption,
} from "./pool-api";
import { isExtraDeckMonster } from "@/lib/card-types";
import type { ListCorrection } from "@/lib/card-list-import";
import {
  EMPTY_LEDGER,
  cardKey,
  countsOf,
  record as recordInLedger,
  remaining as ledgerRemaining,
  settle as settleLedger,
  withoutEntry,
  type Ledger,
} from "@/components/card-list-import/import-ledger";
import {
  addOneCopy,
  applyListEntries,
  diffPools,
  distinctCount,
  mergeAdd,
  nameTakenError,
  pasteLabel,
  poolToEntries,
  removeCard,
  stepCopies,
  subtractGains,
  totalCopies,
  type AddItem,
  type AddOutcome,
  type ImportRecord,
  type Lane,
  type ListEntry,
  type Pool,
  type PoolDiff,
  type PoolSource,
} from "./pool-model";

/** The cube a pool started from. */
export interface BaseMeta {
  cubeId: number;
  name: string;
  creatorId: string;
  creatorName: string | null;
  canEdit: boolean;
  extraCount: number;
}

interface Slot {
  meta: BaseMeta | null;
  base: Pool;
  pool: Pool;
  /** The Extra Deck pool, with the cube's Extra pool as its starting point. */
  baseExtra: Pool;
  extra: Pool;
  /** Cards added or restored this session; listed first. Captured on add and undo, not while stepping. */
  pinned: ReadonlySet<number>;
  /** Pasted or loaded lists, oldest first. Each can be taken out again. */
  imports: ImportRecord[];
  /** Which copies in the pools still belong to each import, after the owner's own edits. */
  ledger: Ledger;
}

const EMPTY_PINNED: ReadonlySet<number> = new Set();
const emptySlot = (): Slot => ({
  meta: null,
  base: new Map(),
  pool: new Map(),
  baseExtra: new Map(),
  extra: new Map(),
  pinned: EMPTY_PINNED,
  imports: [],
  ledger: EMPTY_LEDGER,
});

const slotCounts = (s: Pick<Slot, "pool" | "extra">) => countsOf(["main", s.pool], ["extra", s.extra]);

/** Lets the ledger see how the pools stand now: a card the owner lowered takes copies out of the newest import's gain. */
function settle(s: Slot): Slot {
  const ledger = settleLedger(s.ledger, slotCounts(s));
  return ledger === s.ledger ? s : { ...s, ledger };
}

const gainKeys = (pool: "main" | "extra", gains: ReadonlyMap<number, number>) =>
  new Map([...gains].map(([id, copies]) => [cardKey(pool, id), copies] as const));

/** The cards that differ from the starting point, in either pool, when there is one. */
function repin(s: Slot): Slot {
  if (s.meta === null) return s;
  return { ...s, pinned: new Set([...diffPools(s.base, s.pool).changedIds, ...diffPools(s.baseExtra, s.extra).changedIds]) };
}

export type SaveResult = { ok: true } | { ok: false; error: string };
export type Mode = "cube" | "scratch";

export type PoolEditorOptions =
  | { variant: "create" }
  | {
      variant: "lobby";
      slug: string;
      poolSource?: PoolSource | null;
      /** The lobby loads when this turns true (each time the host opens Edit setup) and stays idle while false. Default true. */
      enabled?: boolean;
    };

export interface PoolEditor {
  variant: "create" | "lobby";
  /** False until the cubes (create) or the draft's pool (lobby) have loaded. */
  ready: boolean;
  loadError: string | null;
  /** True while the starting pool is still arriving: the cube list or draft pool loading, or a picked cube opening. */
  loading: boolean;
  mode: Mode;
  setMode: (mode: Mode) => void;
  cubes: CubeOption[];
  userId: string | null;
  pickerOpen: boolean;
  openPicker: () => void;
  closePicker: () => void;
  picking: number | null;
  pickError: string | null;
  pickCube: (id: number) => Promise<void>;
  meta: BaseMeta | null;
  base: Pool;
  pool: Pool;
  baseExtra: Pool;
  /** The Extra Deck pool: one Extra pack per player is dealt from it when the Extra Deck round is on. */
  extra: Pool;
  pinned: ReadonlySet<number>;
  diff: PoolDiff;
  extraDiff: PoolDiff;
  edited: boolean;
  total: number;
  distinct: number;
  extraTotal: number;
  extraDistinct: number;
  /** Lists pasted or loaded so far; each one can be removed. */
  imports: ImportRecord[];
  poolSource: PoolSource | null;
  /** The cube the pool started from, or null for "built for this draft". */
  info: (id: number) => CardSummary | undefined;
  add: (items: AddItem[]) => AddOutcome;
  /**
   * Puts a resolved list into the pool, each card in the pool the server chose, and keeps what was added so
   * `removeImport` can take exactly that out again.
   */
  importList: (entries: ListEntry[], details: { fileName?: string | null; corrected: ListCorrection[]; unknown: string[] }) => ImportRecord;
  removeImport: (key: number) => void;
  /** One more copy of one card, in the Extra pool for an Extra Deck monster. `changed` is false at the 99 cap. */
  addCopy: (card: CardSummary) => { changed: boolean; lane: Lane };
  step: (id: number, delta: number, lane?: Lane) => void;
  undo: (id: number, lane?: Lane) => void;
  reset: () => void;
  saveAsNew: (name: string) => Promise<SaveResult>;
  replaceBase: () => Promise<SaveResult>;
  /** "Saved to Goat cube 2" for a few seconds after a save. */
  savedTo: string | null;
  /** The editing session: changes whenever the pool is replaced or the cube changes. Async adds compare it after their await. */
  session: () => number;
  /** The pool as the draft config stores it. */
  config: () => { setNames: string[]; customCardIds: number[]; customExtraCardIds: number[]; poolSource: PoolSource | null };
  /** Names already taken by cubes, for the default name of a new one. */
  takenNames: string[];
}

const SAVED_MS = 4200;

export function lookupCard(id: number): CardSummary | undefined {
  return getCached([id]).hits[0];
}

export function usePoolEditor(options: PoolEditorOptions): PoolEditor {
  const variant = options.variant;
  const slug = options.variant === "lobby" ? options.slug : null;
  const lobbySource = options.variant === "lobby" ? options.poolSource ?? null : null;
  const enabled = options.variant === "lobby" ? options.enabled !== false : true;

  const [cubes, setCubes] = React.useState<CubeOption[] | null>(null);
  const [userId, setUserId] = React.useState<string | null>(null);
  const [mode, setModeState] = React.useState<Mode>("scratch");
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [picking, setPicking] = React.useState<number | null>(null);
  const [pickError, setPickError] = React.useState<string | null>(null);
  const [cubeSlot, setCubeSlot] = React.useState<Slot | null>(null);
  const [scratchSlot, setScratchSlot] = React.useState<Slot>(emptySlot);
  const [savedTo, setSavedTo] = React.useState<string | null>(null);
  const [lobbyReady, setLobbyReady] = React.useState(variant !== "lobby");
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const savedTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = React.useRef(true);
  const pickSeq = React.useRef(0);
  const importSeq = React.useRef(0);
  // Bumped when the pool is replaced or the base cube changes (Change cube, Cancel, Reset, a save, a lobby load).
  // Anything that was started before and answers later checks it and drops its result.
  const sessionRef = React.useRef(0);
  const session = React.useCallback(() => sessionRef.current, []);

  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);

  /* ---- load ---- */
  React.useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void fetchSessionUserId().then((id) => {
      if (!cancelled) setUserId(id);
    });
    void fetchCubeOptions()
      .then((list) => {
        if (cancelled) return;
        const usable = list.filter((c) => c.draftType !== "theme");
        setCubes(usable);
        if (variant === "create") {
          if (usable.length > 0) {
            setModeState("cube");
            setPickerOpen(true);
          }
        }
      })
      .catch(() => {
        if (!cancelled) setCubes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [variant, enabled]);

  const cubesLoaded = cubes !== null;
  React.useEffect(() => {
    if (variant !== "lobby" || !slug || !enabled || !cubesLoaded) return;
    let cancelled = false;
    sessionRef.current += 1;
    setLoadError(null);
    setLobbyReady(false);
    setSavedTo(null);
    setPickerOpen(false);
    const source = lobbySource;
    const option = source ? cubes.find((c) => c.id === source.cubeId) ?? null : null;
    void Promise.all([
      fetchDraftPools(slug),
      source ? fetchCubeDetail(option ?? { id: source.cubeId, setNames: [], customCardIds: [] }).catch(() => null) : Promise.resolve(null),
    ])
      .then(([pools, detail]) => {
        if (cancelled) return;
        if (source && detail) {
          const meta: BaseMeta = {
            cubeId: source.cubeId,
            name: option?.name ?? source.cubeName,
            creatorId: option?.createdByUserId ?? "",
            creatorName: option?.createdByName ?? null,
            canEdit: option?.canEdit ?? false,
            extraCount: detail.extraCount,
          };
          setCubeSlot(repin({ ...emptySlot(), meta, base: detail.main, baseExtra: detail.extra, pool: pools.main, extra: pools.extra }));
          setModeState("cube");
        } else {
          setScratchSlot({ ...emptySlot(), pool: pools.main, extra: pools.extra });
          setModeState("scratch");
        }
        setLobbyReady(true);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : "Couldn't load the pool.");
        setLobbyReady(true);
      });
    return () => {
      cancelled = true;
    };
    // The lobby seeds when editing opens and the cube list is in. Later edits are the editor's own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant, slug, enabled, cubesLoaded]);

  /* ---- the slot being edited ---- */
  const slot = mode === "cube" && cubeSlot ? cubeSlot : scratchSlot;
  const editingCube = mode === "cube" && cubeSlot !== null;
  // Handlers that run after an await read the slot from here, so they never act on a pool the user has since changed.
  const latest = React.useRef({ slot, editingCube });
  latest.current = { slot, editingCube };

  const patchSlot = React.useCallback((fn: (s: Slot) => Slot) => {
    if (latest.current.editingCube) setCubeSlot((s) => (s ? settle(fn(s)) : s));
    else setScratchSlot((s) => settle(fn(s)));
  }, []);

  const diff = React.useMemo(() => diffPools(slot.base, slot.pool), [slot.base, slot.pool]);
  const extraDiff = React.useMemo(() => diffPools(slot.baseExtra, slot.extra), [slot.baseExtra, slot.extra]);
  const hasBase = slot.meta !== null;

  const setMode = React.useCallback(
    (next: Mode) => {
      sessionRef.current += 1;
      // A pick still loading must not land after the mode changed.
      pickSeq.current += 1;
      setPicking(null);
      setModeState(next);
      if (next === "cube" && !cubeSlot) setPickerOpen(true);
    },
    [cubeSlot],
  );

  const pickCube = React.useCallback(
    async (id: number) => {
      const option = cubes?.find((c) => c.id === id);
      if (!option) return;
      const seq = ++pickSeq.current;
      sessionRef.current += 1;
      setPicking(id);
      setPickError(null);
      try {
        const detail = await fetchCubeDetail(option);
        if (!alive.current || seq !== pickSeq.current) return;
        sessionRef.current += 1;
        const meta: BaseMeta = {
          cubeId: option.id,
          name: option.name,
          creatorId: option.createdByUserId,
          creatorName: option.createdByName,
          canEdit: option.canEdit,
          extraCount: detail.extraCount,
        };
        setCubeSlot({
          ...emptySlot(),
          meta,
          base: detail.main,
          pool: new Map(detail.main),
          baseExtra: detail.extra,
          extra: new Map(detail.extra),
        });
        setModeState("cube");
        setPickerOpen(false);
        setSavedTo(null);
      } catch (error) {
        if (!alive.current || seq !== pickSeq.current) return;
        setPickError(error instanceof Error ? error.message : "Couldn't open that cube.");
      } finally {
        if (alive.current && seq === pickSeq.current) setPicking(null);
      }
    },
    [cubes],
  );

  // Every change goes through one `patchSlot`, and `latest` is moved ahead at once so a second change in the same
  // tick (two imports back to back) builds on the first and not on the slot as it was rendered.
  const change = React.useCallback(
    (fn: (s: Slot) => Slot) => {
      const next = settle(fn(latest.current.slot));
      latest.current = { ...latest.current, slot: next };
      patchSlot(fn);
      return next;
    },
    [patchSlot],
  );

  const add = React.useCallback(
    (items: AddItem[]): AddOutcome => {
      const outcome = mergeAdd(latest.current.slot.pool, items, latest.current.slot.extra);
      change((s) => repin({ ...s, pool: outcome.pool, extra: outcome.extra }));
      return outcome;
    },
    [change],
  );

  const importList = React.useCallback(
    (entries: ListEntry[], details: { fileName?: string | null; corrected: ListCorrection[]; unknown: string[] }): ImportRecord => {
      const current = latest.current.slot;
      const out = applyListEntries(current.pool, current.extra, entries);
      const fileName = details.fileName?.trim();
      const key = ++importSeq.current;
      const record: ImportRecord = {
        key,
        label: fileName || pasteLabel(current.imports.map((i) => i.label)),
        main: out.gainedMain,
        extra: out.gainedExtra,
        corrected: details.corrected,
        unknown: details.unknown,
      };
      change((s) => {
        // Lowerings the owner made before this import are settled first, then the import is recorded on the new counts.
        const settled = settle(s);
        const gains = new Map([...gainKeys("main", out.gainedMain), ...gainKeys("extra", out.gainedExtra)]);
        const ledger = recordInLedger(settled.ledger, key, gains, slotCounts({ pool: out.main, extra: out.extra }));
        return repin({ ...settled, pool: out.main, extra: out.extra, imports: [...settled.imports, record], ledger });
      });
      return record;
    },
    [change],
  );

  const removeImport = React.useCallback(
    (key: number) => {
      if (!latest.current.slot.imports.some((i) => i.key === key)) return;
      change((s) => {
        // Only what is left of this import's gain comes out; stacked imports can go in any order.
        const settled = settle(s);
        const left = ledgerRemaining(settled.ledger, key, slotCounts(settled));
        const take = (pool: "main" | "extra") =>
          new Map([...left].filter(([k]) => k.startsWith(`${pool}:`)).map(([k, copies]) => [Number(k.slice(pool.length + 1)), copies] as const));
        return repin({
          ...settled,
          pool: subtractGains(settled.pool, take("main")),
          extra: subtractGains(settled.extra, take("extra")),
          imports: settled.imports.filter((i) => i.key !== key),
          ledger: withoutEntry(settled.ledger, key),
        });
      });
    },
    [change],
  );

  const addCopy = React.useCallback(
    (card: CardSummary): { changed: boolean; lane: Lane } => {
      putCards([card]);
      const lane: Lane = isExtraDeckMonster(card) ? "extra" : "main";
      const result = addOneCopy(lane === "extra" ? latest.current.slot.extra : latest.current.slot.pool, card.id);
      if (result.changed) {
        change((s) => repin(lane === "extra" ? { ...s, extra: result.pool } : { ...s, pool: result.pool }));
      }
      return { changed: result.changed, lane };
    },
    [change],
  );

  const step = React.useCallback(
    (id: number, delta: number, lane: Lane = "main") => {
      const key = lane === "extra" ? "extra" : "pool";
      patchSlot((s) => {
        const pool = s[key];
        return { ...s, [key]: delta < 0 && (pool.get(id) ?? 0) <= 1 ? removeCard(pool, id) : stepCopies(pool, id, delta) };
      });
    },
    [patchSlot],
  );

  const undo = React.useCallback(
    (id: number, lane: Lane = "main") => {
      patchSlot((s) => {
        const key = lane === "extra" ? "extra" : "pool";
        const base = lane === "extra" ? s.baseExtra : s.base;
        const pool = new Map(s[key]);
        pool.set(id, base.get(id) ?? 1);
        return repin({ ...s, [key]: pool });
      });
    },
    [patchSlot],
  );

  const reset = React.useCallback(() => {
    sessionRef.current += 1;
    patchSlot((s) => ({ ...s, pool: new Map(s.base), extra: new Map(s.baseExtra), pinned: EMPTY_PINNED, imports: [], ledger: EMPTY_LEDGER }));
  }, [patchSlot]);

  const flashSaved = React.useCallback((name: string) => {
    setSavedTo(name);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => {
      if (alive.current) setSavedTo(null);
    }, SAVED_MS);
  }, []);

  const saveAsNew = React.useCallback(
    async (rawName: string): Promise<SaveResult> => {
      const name = rawName.trim();
      if (!name) return { ok: false, error: "Give the cube a name." };
      const taken = (cubes ?? []).some((c) => c.name.trim().toLowerCase() === name.toLowerCase());
      if (taken) return { ok: false, error: nameTakenError(name) };
      const from = latest.current.slot.meta;
      const savedPool = latest.current.slot.pool;
      const savedExtra = latest.current.slot.extra;
      const startedIn = sessionRef.current;
      try {
        const saved = await createPoolCube({
          name,
          cards: poolToEntries(savedPool),
          // The cube's Extra pool is the one in the editor, including an empty one.
          extraCards: poolToEntries(savedExtra),
        });
        if (!alive.current) return { ok: true };
        const meta: BaseMeta = {
          cubeId: saved.id,
          name: saved.name,
          creatorId: userId ?? "",
          creatorName: null,
          canEdit: true,
          extraCount: savedExtra.size,
        };
        const pool = new Map(savedPool);
        const extra = new Map(savedExtra);
        const option: CubeOption = {
          id: saved.id,
          name: saved.name,
          createdByUserId: userId ?? "",
          createdByName: null,
          canEdit: true,
          draftType: null,
          mainDistinct: pool.size,
          mainCopies: totalCopies(pool),
          extraCount: meta.extraCount,
          thumbIds: Array.from(pool.keys()).slice(0, 3),
          setNames: [],
          customCardIds: [],
        };
        setCubes((list) => [...(list ?? []), option].sort((a, b) => a.name.localeCompare(b.name)));
        // The cube exists either way. Only a session that is still the one that saved takes it as its base,
        // and it keeps whatever the pool holds now, not the pool as it was when the request left.
        if (sessionRef.current !== startedIn) return { ok: true };
        const now = latest.current.slot;
        setCubeSlot(repin({ ...emptySlot(), meta, base: pool, baseExtra: extra, pool: new Map(now.pool), extra: new Map(now.extra), imports: now.imports, ledger: now.ledger }));
        setModeState("cube");
        setPickerOpen(false);
        if (!from) setScratchSlot(emptySlot());
        flashSaved(saved.name);
        return { ok: true };
      } catch (error) {
        if (error instanceof NameTakenError) return { ok: false, error: nameTakenError(name) };
        return { ok: false, error: error instanceof Error ? error.message : "Couldn't save the cube." };
      }
    },
    [cubes, userId, flashSaved],
  );

  const replaceBase = React.useCallback(async (): Promise<SaveResult> => {
    const from = latest.current.slot.meta;
    const pool = latest.current.slot.pool;
    if (!from) return { ok: false, error: "There is no cube to save to." };
    const startedIn = sessionRef.current;
    try {
      await replaceCubeMain(from.cubeId, poolToEntries(pool));
      if (!alive.current) return { ok: true };
      // The cube was saved either way. The editor takes the new base only if it is still on the same cube and session.
      const stillHere = sessionRef.current === startedIn && latest.current.slot.meta?.cubeId === from.cubeId;
      if (stillHere) {
        setCubeSlot((s) => (s && s.meta?.cubeId === from.cubeId ? repin({ ...s, base: new Map(pool) }) : s));
      }
      setCubes((list) =>
        (list ?? []).map((c) =>
          c.id === from.cubeId ? { ...c, mainDistinct: pool.size, mainCopies: totalCopies(pool), thumbIds: Array.from(pool.keys()).slice(0, 3) } : c,
        ),
      );
      if (stillHere) flashSaved(from.name);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Couldn't save the changes." };
    }
  }, [flashSaved]);

  const poolSource: PoolSource | null = slot.meta ? { cubeId: slot.meta.cubeId, cubeName: slot.meta.name } : null;
  const config = React.useCallback(() => configPool(slot.pool, poolSource, slot.extra), [slot.pool, slot.extra, poolSource?.cubeId, poolSource?.cubeName]); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = variant === "lobby" ? lobbyReady && cubes !== null : cubes !== null;

  return {
    variant,
    ready,
    loadError,
    loading: !ready || picking !== null,
    mode,
    setMode,
    cubes: cubes ?? [],
    userId,
    pickerOpen,
    openPicker: () => {
      sessionRef.current += 1;
      setPickError(null);
      setPickerOpen(true);
    },
    closePicker: () => {
      sessionRef.current += 1;
      // Closing the picker cancels a pick still loading.
      pickSeq.current += 1;
      setPicking(null);
      setPickerOpen(false);
    },
    picking,
    pickError,
    pickCube,
    meta: slot.meta,
    base: slot.base,
    pool: slot.pool,
    baseExtra: slot.baseExtra,
    extra: slot.extra,
    pinned: slot.pinned,
    diff,
    extraDiff,
    edited: hasBase && (diff.any || extraDiff.any),
    total: totalCopies(slot.pool),
    distinct: distinctCount(slot.pool),
    extraTotal: totalCopies(slot.extra),
    extraDistinct: distinctCount(slot.extra),
    imports: slot.imports,
    poolSource,
    info: lookupCard,
    add,
    importList,
    removeImport,
    addCopy,
    step,
    undo,
    reset,
    saveAsNew,
    replaceBase,
    savedTo,
    session,
    config,
    takenNames: (cubes ?? []).map((c) => c.name),
  };
}
