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
  fetchDraftPool,
  fetchSessionUserId,
  replaceCubeMain,
  type CubeOption,
} from "./pool-api";
import {
  addOneCopy,
  diffPools,
  distinctCount,
  mergeAdd,
  mergePasscodes,
  nameTakenError,
  poolToEntries,
  removeCard,
  stepCopies,
  totalCopies,
  type AddItem,
  type AddOutcome,
  type PasscodesOutcome,
  type CardInfo,
  type Pool,
  type PoolDiff,
  type PoolSource,
} from "./pool-model";

/** The cube a pool started from. */
export interface BaseMeta {
  cubeId: number;
  name: string;
  creatorId: number | null;
  creatorName: string | null;
  canEdit: boolean;
  extraCount: number;
}

interface Slot {
  meta: BaseMeta | null;
  base: Pool;
  pool: Pool;
  /** Cards added or restored this session; listed first. Captured on add and undo, not while stepping. */
  pinned: ReadonlySet<number>;
}

const EMPTY_PINNED: ReadonlySet<number> = new Set();
const emptySlot = (): Slot => ({ meta: null, base: new Map(), pool: new Map(), pinned: EMPTY_PINNED });

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
  userId: number | null;
  pickerOpen: boolean;
  openPicker: () => void;
  closePicker: () => void;
  picking: number | null;
  pickError: string | null;
  pickCube: (id: number) => Promise<void>;
  meta: BaseMeta | null;
  base: Pool;
  pool: Pool;
  pinned: ReadonlySet<number>;
  diff: PoolDiff;
  edited: boolean;
  total: number;
  distinct: number;
  poolSource: PoolSource | null;
  /** The cube the pool started from, or null for "built for this draft". */
  info: (id: number) => CardSummary | undefined;
  add: (items: AddItem[]) => AddOutcome;
  addPasscodes: (occurrences: ReadonlyMap<number, number>, cards: CardSummary[], unknownIds: number[]) => PasscodesOutcome;
  addCopy: (card: CardSummary) => boolean;
  step: (id: number, delta: number) => void;
  undo: (id: number) => void;
  reset: () => void;
  saveAsNew: (name: string) => Promise<SaveResult>;
  replaceBase: () => Promise<SaveResult>;
  /** "Saved to Goat cube 2" for a few seconds after a save. */
  savedTo: string | null;
  /** The editing session: changes whenever the pool is replaced or the cube changes. Async adds compare it after their await. */
  session: () => number;
  /** The pool as the draft config stores it. */
  config: () => { setNames: string[]; customCardIds: number[]; poolSource: PoolSource | null };
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
  const [userId, setUserId] = React.useState<number | null>(null);
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
      fetchDraftPool(slug),
      source ? fetchCubeDetail(option ?? { id: source.cubeId, setNames: [], customCardIds: [] }).catch(() => null) : Promise.resolve(null),
    ])
      .then(([pool, detail]) => {
        if (cancelled) return;
        if (source && detail) {
          const meta: BaseMeta = {
            cubeId: source.cubeId,
            name: option?.name ?? source.cubeName,
            creatorId: option?.createdByUserId ?? null,
            creatorName: option?.createdByName ?? null,
            canEdit: option?.canEdit ?? false,
            extraCount: detail.extraCount,
          };
          setCubeSlot({ meta, base: detail.main, pool, pinned: EMPTY_PINNED });
          setModeState("cube");
        } else {
          setScratchSlot({ meta: null, base: new Map(), pool, pinned: EMPTY_PINNED });
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
    if (latest.current.editingCube) setCubeSlot((s) => (s ? fn(s) : s));
    else setScratchSlot((s) => fn(s));
  }, []);

  const diff = React.useMemo(() => diffPools(slot.base, slot.pool), [slot.base, slot.pool]);
  const hasBase = slot.meta !== null;
  const pinFor = (base: Pool, pool: Pool, hasBaseCube: boolean): ReadonlySet<number> =>
    hasBaseCube ? new Set(diffPools(base, pool).changedIds) : EMPTY_PINNED;

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
        setCubeSlot({ meta, base: detail.main, pool: new Map(detail.main), pinned: EMPTY_PINNED });
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

  const add = React.useCallback(
    (items: AddItem[]): AddOutcome => {
      const current = latest.current.slot;
      const outcome = mergeAdd(current.pool, items);
      patchSlot((s) => ({ ...s, pool: outcome.pool, pinned: pinFor(s.base, outcome.pool, s.meta !== null) }));
      latest.current = { ...latest.current, slot: { ...current, pool: outcome.pool } };
      return outcome;
    },
    [patchSlot],
  );

  const addPasscodes = React.useCallback(
    (occurrences: ReadonlyMap<number, number>, cards: CardSummary[], unknownIds: number[]): PasscodesOutcome => {
      const current = latest.current.slot;
      const outcome = mergePasscodes(current.pool, occurrences, cards, unknownIds);
      patchSlot((s) => ({ ...s, pool: outcome.pool, pinned: pinFor(s.base, outcome.pool, s.meta !== null) }));
      latest.current = { ...latest.current, slot: { ...current, pool: outcome.pool } };
      return outcome;
    },
    [patchSlot],
  );

  const addCopy = React.useCallback(
    (card: CardSummary): boolean => {
      putCards([card]);
      const result = addOneCopy(latest.current.slot.pool, card.id);
      if (result.changed) {
        patchSlot((s) => ({ ...s, pool: result.pool, pinned: pinFor(s.base, result.pool, s.meta !== null) }));
      }
      return result.changed;
    },
    [patchSlot],
  );

  const step = React.useCallback(
    (id: number, delta: number) => {
      patchSlot((s) => ({ ...s, pool: delta < 0 && (s.pool.get(id) ?? 0) <= 1 ? removeCard(s.pool, id) : stepCopies(s.pool, id, delta) }));
    },
    [patchSlot],
  );

  const undo = React.useCallback(
    (id: number) => {
      patchSlot((s) => {
        const pool = new Map(s.pool);
        pool.set(id, s.base.get(id) ?? 1);
        return { ...s, pool, pinned: pinFor(s.base, pool, s.meta !== null) };
      });
    },
    [patchSlot],
  );

  const reset = React.useCallback(() => {
    sessionRef.current += 1;
    patchSlot((s) => ({ ...s, pool: new Map(s.base), pinned: EMPTY_PINNED }));
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
      if (userId === null) return { ok: false, error: "Sign in to save a cube." };
      const name = rawName.trim();
      if (!name) return { ok: false, error: "Give the cube a name." };
      const taken = (cubes ?? []).some((c) => c.name.trim().toLowerCase() === name.toLowerCase());
      if (taken) return { ok: false, error: nameTakenError(name) };
      const from = latest.current.slot.meta;
      const savedPool = latest.current.slot.pool;
      const startedIn = sessionRef.current;
      try {
        const saved = await createPoolCube({
          name,
          cards: poolToEntries(savedPool),
          ...(from ? { copyExtraFromCubeId: from.cubeId } : {}),
        });
        if (!alive.current) return { ok: true };
        const meta: BaseMeta = {
          cubeId: saved.id,
          name: saved.name,
          creatorId: saved.createdByUserId,
          creatorName: null,
          canEdit: true,
          extraCount: from?.extraCount ?? 0,
        };
        const pool = new Map(savedPool);
        const option: CubeOption = {
          id: saved.id,
          name: saved.name,
          createdByUserId: saved.createdByUserId,
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
        const current = latest.current.slot.pool;
        setCubeSlot({ meta, base: pool, pool: new Map(current), pinned: pinFor(pool, current, true) });
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
        setCubeSlot((s) =>
          s && s.meta?.cubeId === from.cubeId ? { ...s, base: new Map(pool), pinned: pinFor(pool, s.pool, true) } : s,
        );
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
  const config = React.useCallback(() => configPool(slot.pool, poolSource), [slot.pool, poolSource?.cubeId, poolSource?.cubeName]); // eslint-disable-line react-hooks/exhaustive-deps

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
    pinned: slot.pinned,
    diff,
    edited: hasBase && diff.any,
    total: totalCopies(slot.pool),
    distinct: distinctCount(slot.pool),
    poolSource,
    info: lookupCard,
    add,
    addPasscodes,
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
