"use client";

import * as React from "react";
import type {
  DraftAllowedCube,
  DraftAttachCubeRequest,
  DraftAttachCubeResponse,
  DraftPreflightResponse,
  LobbyPlayer,
  LobbySnapshot,
} from "@yugidraft/shared/types";
import type { CardSummary } from "@/lib/card-types";
import type { LobbyController } from "../lobby/lobby-actions";
import { LobbyRequestError, type LobbyConfig } from "../lobby/lobby-model";

export type ThemeSelection = "player_pick" | "random" | "host_assigned";

/** The theme rules the table reads and the host may edit. A subset of the draft config. */
export type ThemeTableConfig = Pick<
  LobbyConfig,
  | "themeSelection"
  | "uniqueThemes"
  | "themePackSize"
  | "cardsPerPlayer"
  | "extraDeckEnabled"
  | "extraDeckSize"
  | "burnUnpicked"
  | "copyLimit"
  | "pickSeconds"
  | "lobbySeats"
>;

/** What the host may change on the Table card, saved together with one PUT. */
export type ThemeRulesPatch = Partial<ThemeTableConfig> & { themeAssignments?: Record<string, number> };

/** A JSON request that throws `LobbyRequestError` on a failed answer, like the lobby client does. */
export async function themeRequest<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = (await res.json()) as Record<string, unknown>;
  } catch {
    parsed = null;
  }
  if (!res.ok) throw new LobbyRequestError(res.status, parsed, `Request failed (${res.status})`);
  return parsed as T;
}

/** A saved cube that was made but could not join the draft (the start won the race, the lobby moved on). */
export interface AttachRecovery {
  cubeId: number;
  name: string | null;
  message: string;
}

export interface ThemeTableOptions {
  slug: string;
  lobby: LobbySnapshot;
  players: LobbyPlayer[];
  config: ThemeTableConfig;
  allowedCubes: DraftAllowedCube[];
  controller: LobbyController;
  /** The page refetches the draft. Called after every change that is not a lobby answer. */
  onChanged: () => void;
}

export interface ThemeTable {
  selection: ThemeSelection;
  unique: boolean;
  /** The theme each player holds right now: a public claim, the host's assignment (with local picks), or none. */
  cubeOf: (playerId: number) => number | null;
  /** The player who holds a cube, when claims are visible to you. */
  holderOf: (cubeId: number) => LobbyPlayer | null;
  /** The cube cannot be taken by this player: another player holds it and themes must differ. */
  unavailableFor: (cubeId: number, playerId: number) => LobbyPlayer | null;
  claim: (cubeId: number) => Promise<boolean>;
  release: () => Promise<boolean>;
  /** Host assignment. A pick is local until every seat has a theme, then the whole map is sent. */
  assign: (playerId: number, cubeId: number | null) => Promise<boolean>;
  /** Seats the host still has to give a theme, in host_assigned mode. Empty otherwise. */
  unassigned: LobbyPlayer[];
  saveRules: (patch: ThemeRulesPatch) => Promise<boolean>;
  /** `savedName` says the cube was saved first (list import), so any failure keeps it and offers a retry. */
  attach: (body: DraftAttachCubeRequest, opts?: { savedName?: string }) => Promise<DraftAttachCubeResponse["cube"] | null>;
  detach: (cubeId: number) => Promise<boolean>;
  recovery: AttachRecovery | null;
  clearRecovery: () => void;
  preflight: { errors: string[]; warnings: string[] };
}

const union = (...lists: string[][]): string[] => [...new Set(lists.flat())];

/**
 * The requests of the theme table and the state around them. Every change goes through the lobby controller's `run`, so
 * only one request is in flight and errors land in one place. Nothing here starts the draft.
 */
export function useThemeTable({ slug, lobby, players, config, allowedCubes, controller, onChanged }: ThemeTableOptions): ThemeTable {
  const base = `/api/drafts/${encodeURIComponent(slug)}`;
  const selection: ThemeSelection = config.themeSelection ?? "player_pick";
  const unique = config.uniqueThemes ?? true;
  const [local, setLocal] = React.useState<Record<number, number | null>>({});
  const [recovery, setRecovery] = React.useState<AttachRecovery | null>(null);
  const [fetched, setFetched] = React.useState<DraftPreflightResponse>({ errors: [], warnings: [] });

  // Local picks only live while the host assigns. A server answer that matches a pick, a left player or a mode change drops it.
  React.useEffect(() => {
    setLocal((current) => {
      if (selection !== "host_assigned") return Object.keys(current).length === 0 ? current : {};
      const next: Record<number, number | null> = {};
      let changed = false;
      for (const [key, value] of Object.entries(current)) {
        const player = players.find((p) => p.playerId === Number(key));
        if (!player || player.cubeId === value) { changed = true; continue; }
        next[Number(key)] = value;
      }
      return changed ? next : current;
    });
  }, [selection, players]);

  const cubeOf = React.useCallback(
    (playerId: number): number | null => {
      if (selection === "random") return null;
      if (selection === "host_assigned" && playerId in local) return local[playerId];
      return players.find((p) => p.playerId === playerId)?.cubeId ?? null;
    },
    [selection, local, players],
  );

  const holderOf = React.useCallback(
    (cubeId: number) => players.find((p) => cubeOf(p.playerId) === cubeId) ?? null,
    [players, cubeOf],
  );
  const unavailableFor = React.useCallback(
    (cubeId: number, playerId: number) => {
      if (!unique) return null;
      return players.find((p) => p.playerId !== playerId && cubeOf(p.playerId) === cubeId) ?? null;
    },
    [players, cubeOf, unique],
  );

  // A failed change can leave a claim the page does not know yet, so a refetch follows any 409.
  const change = React.useCallback(
    (key: string, task: () => Promise<unknown>, fallback: string) =>
      controller.run(key, async () => {
        try {
          await task();
        } catch (err) {
          if (err instanceof LobbyRequestError && err.status === 409) onChanged();
          throw err;
        }
      }, fallback),
    [controller, onChanged],
  );

  const claim = React.useCallback(
    (cubeId: number) => change("claim", async () => {
      await themeRequest(`${base}/claim-cube`, "POST", { cubeId });
      onChanged();
    }, "Couldn't take that theme."),
    [change, base, onChanged],
  );
  const release = React.useCallback(
    () => change("claim", async () => {
      await themeRequest(`${base}/claim-cube`, "DELETE");
      onChanged();
    }, "Couldn't clear your theme."),
    [change, base, onChanged],
  );

  const unassigned = React.useMemo(
    () => (selection === "host_assigned" ? players.filter((p) => cubeOf(p.playerId) === null) : []),
    [selection, players, cubeOf],
  );

  const saveRules = React.useCallback(
    (patch: ThemeRulesPatch) => change("rules", async () => {
      await themeRequest(base, "PUT", { config: patch, revision: lobby.revision });
      setLocal({});
      onChanged();
    }, "Couldn't save the theme rules."),
    [change, base, lobby.revision, onChanged],
  );

  const assign = React.useCallback(
    async (playerId: number, cubeId: number | null): Promise<boolean> => {
      const map: Record<number, number | null> = {};
      for (const p of players) map[p.playerId] = p.playerId === playerId ? cubeId : cubeOf(p.playerId);
      setLocal((current) => ({ ...current, [playerId]: cubeId }));
      const ids = players.map((p) => map[p.playerId]);
      const complete = ids.every((id): id is number => id !== null);
      if (!complete) return true;
      if (unique && new Set(ids).size !== ids.length) return true;
      // The whole map goes in one PUT. Nothing is sent for a half finished plan.
      const whole: Record<string, number> = {};
      for (const p of players) whole[String(p.playerId)] = map[p.playerId] as number;
      return saveRules({ themeAssignments: whole });
    },
    [players, cubeOf, unique, saveRules],
  );

  const attach = React.useCallback(
    async (body: DraftAttachCubeRequest, opts?: { savedName?: string }) => {
      let added: DraftAttachCubeResponse["cube"] | null = null;
      setRecovery(null);
      await change("attach", async () => {
        try {
          const res = await themeRequest<DraftAttachCubeResponse>(`${base}/cubes`, "POST", body);
          added = res.cube;
          onChanged();
        } catch (err) {
          if (err instanceof LobbyRequestError) {
            // The cube is already saved in the library when the server names it, or when the caller made it first (import).
            const named = typeof err.body?.savedCubeId === "number" ? err.body.savedCubeId : null;
            const saved = named ?? (opts?.savedName !== undefined && body.kind === "existing" ? body.cubeId : null);
            if (saved !== null && (err.code === "CUBE_ATTACH_CONFLICT" || opts?.savedName !== undefined)) {
              const name = opts?.savedName ?? (body.kind === "blank" ? body.name : body.kind === "archetype" ? body.archetype : null);
              setRecovery({ cubeId: saved, name, message: err.message });
            }
          }
          throw err;
        }
      }, "Couldn't add that theme.");
      return added;
    },
    [change, base, onChanged],
  );

  const detach = React.useCallback(
    (cubeId: number) => change("detach", async () => {
      await themeRequest(`${base}/cubes`, "DELETE", { cubeId });
      onChanged();
    }, "Couldn't remove that theme."),
    [change, base, onChanged],
  );

  // The authoritative analysis is the server's. It is asked again whenever the setup or the cubes move.
  const preflightKey = JSON.stringify([lobby.revision, allowedCubes.map((c) => [c.id, c.mainCount, c.extraCount]), config, players.map((p) => p.playerId)]);
  React.useEffect(() => {
    let live = true;
    fetch(`${base}/preflight`)
      .then((res) => (res.ok ? res.json() : { errors: [], warnings: [] }))
      .then((data: Partial<DraftPreflightResponse>) => {
        if (live) setFetched({ errors: data.errors ?? [], warnings: data.warnings ?? [] });
      })
      .catch(() => {});
    return () => { live = false; };
    // The key already follows everything the analysis reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, preflightKey]);

  const preflight = React.useMemo(
    () => ({ errors: union(lobby.errors, fetched.errors), warnings: union(lobby.warnings, fetched.warnings) }),
    [lobby.errors, lobby.warnings, fetched],
  );

  return {
    selection,
    unique,
    cubeOf,
    holderOf,
    unavailableFor,
    claim,
    release,
    assign,
    unassigned,
    saveRules,
    attach,
    detach,
    recovery,
    clearRecovery: () => setRecovery(null),
    preflight,
  };
}

// --- Cube preview -----------------------------------------------------------------------------------------------

export interface CubePreview {
  cubeId: number;
  cards: CardSummary[] | null;
  extraCards: CardSummary[] | null;
  error: string | null;
}

interface CubeDetailBody {
  cards: CardSummary[];
  pools: { main: Array<{ catalogCardId: number; maxCopies: number }>; extra: Array<{ catalogCardId: number; maxCopies: number }> };
}

/** The whole pool of one cube, from `GET /api/cubes/[id]`, as card lists with the copies in `qty`. */
export function useCubePreview() {
  const [preview, setPreview] = React.useState<CubePreview | null>(null);
  const latest = React.useRef(0);
  const open = React.useCallback((cubeId: number) => {
    const mine = ++latest.current;
    setPreview({ cubeId, cards: null, extraCards: null, error: null });
    fetch(`/api/cubes/${cubeId}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("The pool could not be loaded."))))
      .then((data: CubeDetailBody) => {
        if (mine !== latest.current) return;
        const byId = new Map(data.cards.map((card) => [card.id, card]));
        const lane = (rows: CubeDetailBody["pools"]["main"]) =>
          rows.flatMap((row) => {
            const card = byId.get(row.catalogCardId);
            return card ? [{ ...card, qty: row.maxCopies }] : [];
          });
        setPreview({ cubeId, cards: lane(data.pools.main), extraCards: lane(data.pools.extra), error: null });
      })
      .catch((err: unknown) => {
        if (mine === latest.current) setPreview({ cubeId, cards: null, extraCards: null, error: err instanceof Error ? err.message : "The pool could not be loaded." });
      });
  }, []);
  const close = React.useCallback(() => { latest.current++; setPreview(null); }, []);
  return { preview, open, close };
}

/**
 * A whole assignment map for the host: the themes players hold now stay, every other seat gets the next theme in the
 * box that is not used yet (any theme when themes may repeat). Null when the box has too few themes for that.
 */
export function suggestAssignments(
  players: Array<{ playerId: number }>,
  current: (playerId: number) => number | null,
  cubeIds: number[],
  unique: boolean,
): Record<string, number> | null {
  const map: Record<string, number> = {};
  const used = new Set<number>();
  for (const p of players) {
    const held = current(p.playerId);
    if (held !== null && cubeIds.includes(held)) { map[String(p.playerId)] = held; used.add(held); }
  }
  let next = 0;
  for (const p of players) {
    if (String(p.playerId) in map) continue;
    const free = unique ? cubeIds.find((id) => !used.has(id)) : cubeIds[next++ % Math.max(cubeIds.length, 1)];
    if (free === undefined) return null;
    map[String(p.playerId)] = free;
    used.add(free);
  }
  return map;
}
