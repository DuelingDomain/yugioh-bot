import { CARD_TYPE_BITS as T } from "@yugidraft/shared/duels";

/**
 * Monster type and spell/trap kind for draft cards, read from the duel engine.
 *
 * The card catalog has no column for them, so the draft room asks the duel host:
 * `normalize-codes` turns a YGOPRODeck id into an engine passcode, and `card-details`
 * returns the engine card (its race text and type bits). Answers are cached for the life of
 * the process, since the engine's card data does not change while it runs. If the host
 * cannot be reached the room simply has no type chips.
 */

export interface EngineCardTypes {
  /** Monster type ("Dragon"). Null for spells, traps and cards the engine does not know. */
  race: string | null;
  /** "Quick-Play", "Continuous", "Counter" and so on. Null for monsters. */
  spellTrapType: string | null;
}

const NONE: EngineCardTypes = { race: null, spellTrapType: null };

export function spellKind(type: number): string {
  if (type & T.quickPlay) return "Quick-Play";
  if (type & T.continuous) return "Continuous";
  if (type & T.equip) return "Equip";
  if (type & T.field) return "Field";
  if (type & T.ritual) return "Ritual";
  return "Normal";
}

export function trapKind(type: number): string {
  if (type & T.continuous) return "Continuous";
  if (type & T.counter) return "Counter";
  return "Normal";
}

/** The engine card's type bits and race text, as the two fields the draft room shows. */
export function engineCardTypes(card: { type: number; race: string }): EngineCardTypes {
  if (card.type & T.monster) {
    const race = card.race.trim();
    return { race: race && race.toLowerCase() !== "unknown" ? race : null, spellTrapType: null };
  }
  if (card.type & T.spell) return { race: null, spellTrapType: spellKind(card.type) };
  if (card.type & T.trap) return { race: null, spellTrapType: trapKind(card.type) };
  return NONE;
}

export interface HostActor {
  guildId: string;
  /** A player of the draft: the host refuses calls without one. */
  playerId: number;
}

type HostCall = (input: { op: "card-details" | "normalize-codes"; codes: number[] }, actor: HostActor) => Promise<unknown>;

const CHUNK = 1000;
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";

export interface EngineTypeLookupOptions {
  call: HostCall;
  /** How long a room load waits for the host before it goes ahead without types. */
  timeoutMs?: number;
  /** After a failure the host is left alone for this long. */
  backoffMs?: number;
  now?: () => number;
}

/** Cached, batched lookups. Several players loading the same pack share one host call. */
export function createEngineTypeLookup(options: EngineTypeLookupOptions) {
  const timeoutMs = options.timeoutMs ?? 1500;
  const backoffMs = options.backoffMs ?? 60_000;
  const now = options.now ?? Date.now;
  const cache = new Map<number, EngineCardTypes | null>();
  const inflight = new Map<number, Promise<void>>();
  let downUntil = 0;

  async function details(codes: number[], actor: HostActor): Promise<{ cards: Map<number, EngineCardTypes>; missing: number[] }> {
    const cards = new Map<number, EngineCardTypes>();
    const missing: number[] = [];
    for (let i = 0; i < codes.length; i += CHUNK) {
      const data = await options.call({ op: "card-details", codes: codes.slice(i, i + CHUNK) }, actor);
      if (!isObject(data) || !Array.isArray(data.cards) || !Array.isArray(data.missing)) throw new Error("Invalid engine response");
      for (const raw of data.cards) {
        if (isObject(raw) && typeof raw.code === "number" && typeof raw.type === "number") {
          cards.set(raw.code, engineCardTypes({ type: raw.type, race: typeof raw.race === "string" ? raw.race : "" }));
        }
      }
      for (const code of data.missing) if (typeof code === "number") missing.push(code);
    }
    return { cards, missing };
  }

  async function normalize(ids: number[], actor: HostActor): Promise<Map<number, number | null>> {
    const out = new Map<number, number | null>();
    for (let i = 0; i < ids.length; i += CHUNK) {
      const data = await options.call({ op: "normalize-codes", codes: ids.slice(i, i + CHUNK) }, actor);
      const codes = isObject(data) && isObject(data.codes) ? data.codes : null;
      if (!codes) throw new Error("Invalid engine response");
      for (const id of ids.slice(i, i + CHUNK)) {
        const code = codes[String(id)];
        out.set(id, typeof code === "number" ? code : null);
      }
    }
    return out;
  }

  async function fetchBatch(ids: number[], actor: HostActor): Promise<void> {
    try {
      const first = await details(ids, actor);
      const found = new Map<number, EngineCardTypes | null>();
      for (const id of ids) if (first.cards.has(id)) found.set(id, first.cards.get(id)!);
      if (first.missing.length) {
        // an id the engine does not list may still map to a passcode it does
        const codes = await normalize(first.missing, actor);
        const resolved = [...new Set([...codes.values()].filter((c): c is number => c != null))];
        const second = resolved.length ? await details(resolved, actor) : { cards: new Map<number, EngineCardTypes>(), missing: [] };
        for (const id of first.missing) {
          const code = codes.get(id);
          found.set(id, code != null ? (second.cards.get(code) ?? null) : null);
        }
      }
      for (const id of ids) cache.set(id, found.get(id) ?? null);
      downUntil = 0;
    } catch (error) {
      downUntil = now() + backoffMs;
      console.warn("[draft] card types are unavailable from the duel engine:", error instanceof Error ? error.message : error);
    } finally {
      for (const id of ids) inflight.delete(id);
    }
  }

  return {
    /** Types for the ids the engine knows. Ids it does not know, and everything when it is down, are left out. */
    async lookup(ids: Iterable<number>, actor: HostActor): Promise<Map<number, EngineCardTypes>> {
      const wanted = [...new Set(ids)];
      const result = new Map<number, EngineCardTypes>();
      const collect = () => {
        for (const id of wanted) {
          const hit = cache.get(id);
          if (hit) result.set(id, hit);
        }
        return result;
      };
      const uncached = wanted.filter((id) => !cache.has(id));
      if (uncached.length === 0 || now() < downUntil) return collect();

      const fresh = uncached.filter((id) => !inflight.has(id));
      if (fresh.length) {
        const batch = fetchBatch(fresh, actor);
        for (const id of fresh) inflight.set(id, batch);
      }
      const waiting = [...new Set(uncached.map((id) => inflight.get(id)).filter((p): p is Promise<void> => !!p))];
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), timeoutMs);
      });
      const outcome = await Promise.race([Promise.all(waiting).then(() => "done" as const), timedOut]);
      clearTimeout(timer);
      // a late answer still fills the cache; the next load uses it
      if (outcome === "timeout") downUntil = Math.max(downUntil, now() + 10_000);
      return collect();
    },
    /** For tests. */
    reset() {
      cache.clear();
      inflight.clear();
      downUntil = 0;
    },
  };
}

/** The process-wide lookup, bound to the duel host. */
const hostLookup = createEngineTypeLookup({
  call: async (input, actor) => {
    // Imported on use: the host client pulls in auth, which a room load that never needs it should not load.
    const { callDuelHost } = await import("@/lib/duel-host");
    const result = await callDuelHost({ ...input, guildId: actor.guildId, playerId: actor.playerId });
    if (!result.ok) throw new Error(`${input.op} failed (${result.response.status})`);
    return result.data;
  },
});

export function lookupDraftCardTypes(ids: Iterable<number>, actor: HostActor): Promise<Map<number, EngineCardTypes>> {
  return hostLookup.lookup(ids, actor);
}
