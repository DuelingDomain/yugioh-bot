import { fixtureUserId, fixtureDiscordId } from "../fixtures/identity";
import { vi } from "vitest";
import type { CardSummary } from "../../src/lib/card-types";

/** A small catalog and a fetch stub that answers the routes the pool editor calls. */
export function card(id: number, name: string, type = "Effect Monster"): CardSummary {
  return {
    id,
    name,
    type,
    frameType: type.includes("Spell") ? "spell" : type.includes("Trap") ? "trap" : "effect",
    effectText: "",
    imageUrl: `u${id}`,
    imageUrlSmall: `s${id}`,
  };
}

export const CATALOG: CardSummary[] = [
  card(101, "Alpha Beast"),
  card(102, "Beta Beast"),
  card(103, "Pot of Greed", "Spell Card"),
  card(104, "Mirror Force", "Trap Card"),
  card(105, "Cipher Soldier"),
  card(106, "Dragon Egg"),
  card(900, "Fusion Wyrm", "Fusion Monster"),
  card(901, "Blue-Eyes White Dragon", "Normal Monster"),
  card(902, "Blue-Eyes Alternative", "Effect Monster"),
  card(903, "Blue-Eyes Ultimate", "Fusion Monster"),
];

export const GOAT = {
  id: 1,
  name: "Goat cube",
  draftType: "booster",
  createdByUserId: fixtureUserId("u1"),
  createdByName: "Imran",
  canEdit: true,
  extraCount: 6,
  setNames: [] as string[],
  customCardIds: [] as number[],
  mainCards: [
    { id: 101, copies: 3 },
    { id: 102, copies: 2 },
    { id: 103, copies: 1 },
    { id: 104, copies: 3 },
  ],
};

export const OTHERS = {
  id: 2,
  name: "Despia cube",
  draftType: "any",
  createdByUserId: fixtureUserId("u2"),
  createdByName: "Josh",
  canEdit: false,
  extraCount: 0,
  setNames: [] as string[],
  customCardIds: [] as number[],
  mainCards: [{ id: 105, copies: 2 }, { id: 106, copies: 1 }],
};

export const THEME = { ...OTHERS, id: 3, name: "Theme only cube", draftType: "theme" };

type Cube = typeof GOAT;

export interface Stub {
  calls: Array<{ url: string; method: string; body: unknown }>;
  find(url: string, method?: string): Array<{ url: string; method: string; body: unknown }>;
}

export interface StubOptions {
  cubes?: Cube[];
  userId?: string;
  /** Answer to POST /api/cubes. */
  createCube?: (body: { name: string }) => Response;
  /** Answer to POST /api/cubes/[id]/cards. */
  replaceMain?: () => Response;
  draftPool?: CardSummary[];
  extra?: Record<string, (init?: RequestInit) => Response | Promise<Response>>;
}

export function stubFetch(options: StubOptions = {}): Stub {
  const cubes = options.cubes ?? [GOAT, OTHERS, THEME];
  const calls: Stub["calls"] = [];
  const byId = new Map(CATALOG.map((c) => [c.id, c]));
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    const extra = options.extra?.[`${method} ${url}`];
    if (extra) return extra(init);
    if (url === "/api/discord/channels") return Response.json({ channels: [] });
    if (url === "/api/auth/session") return Response.json({ user: { id: String(fixtureUserId(options.userId ?? "u1")), discordUserId: fixtureDiscordId(options.userId ?? "u1") } });
    if (url === "/api/cubes" && method === "GET") return Response.json({ cubes });
    if (url === "/api/cubes" && method === "POST") {
      if (options.createCube) return options.createCube(body);
      return Response.json({ cube: { id: 77, name: body.name, createdByUserId: fixtureUserId(options.userId ?? "u1") } }, { status: 201 });
    }
    const detail = /^\/api\/cubes\/(\d+)$/.exec(url);
    if (detail && method === "GET") {
      const cube = cubes.find((c) => c.id === Number(detail[1]));
      if (!cube) return Response.json({ error: "Cube not found" }, { status: 404 });
      return Response.json({
        cube: { id: cube.id },
        pools: {
          main: cube.mainCards.map((c) => ({ catalogCardId: c.id, maxCopies: c.copies })),
          extra: Array.from({ length: cube.extraCount }, (_, i) => ({ catalogCardId: 900 + i, maxCopies: 3 })),
        },
        cards: cube.mainCards.map((c) => byId.get(c.id)).filter(Boolean),
      });
    }
    if (/^\/api\/cubes\/\d+\/cards$/.test(url) && method === "POST") {
      return options.replaceMain ? options.replaceMain() : Response.json({ ok: true });
    }
    const draftPool = /^\/api\/drafts\/[^/]+\/pool$/.exec(url);
    if (draftPool) return Response.json({ cards: options.draftPool ?? [] });
    if (url.startsWith("/api/archetypes")) return Response.json({ archetypes: ["Blue-Eyes"] });
    if (url === "/api/sets") return Response.json({ sets: [{ setName: "Metal Raiders", setCode: "MRD", cardCount: 2 }] });
    if (url === "/api/cards/resolve" && method === "POST") {
      if (body.archetype === "Blue-Eyes") {
        return Response.json({
          cards: CATALOG.filter((c) => c.name.startsWith("Blue-Eyes")).map((c) => ({ ...c, qty: 1 })),
          unknownIds: [],
        });
      }
      if (body.setNames?.includes("Metal Raiders")) {
        return Response.json({ cards: [{ ...byId.get(105)!, qty: 2 }, { ...byId.get(106)!, qty: 1 }], unknownIds: [] });
      }
      if (body.fuzzyName) {
        const q = String(body.fuzzyName).toLowerCase();
        return Response.json({ cards: CATALOG.filter((c) => c.name.toLowerCase().includes(q)), unknownIds: [] });
      }
      if (body.customCardIds) {
        const known = (body.customCardIds as number[]).filter((id) => byId.has(id));
        return Response.json({
          cards: known.map((id) => byId.get(id)),
          unknownIds: (body.customCardIds as number[]).filter((id) => !byId.has(id)),
        });
      }
      return Response.json({ cards: [], unknownIds: [] });
    }
    if (url === "/api/drafts" && method === "POST") return Response.json({ webSlug: "made" }, { status: 201 });
    return Response.json({}, { status: 404 });
  });
  vi.stubGlobal("fetch", fn);
  return {
    calls,
    find: (url, method = "GET") => calls.filter((c) => c.url === url && c.method === method),
  };
}

const FIXTURE_KEYS = ["u1","u2"] as const;
