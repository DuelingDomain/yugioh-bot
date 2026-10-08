import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
const state = vi.hoisted(() => ({ db: null as Database.Database | null }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db! }));
vi.mock("@/lib/env", () => ({ env: { discordGuildId: "g" } }));
vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { id: "101" } }) }));
vi.mock("@/lib/session-identity", () => ({ resolveSessionIdentity: async () => ({ ok: true, identity: { userId: 101, discordUserId: null, name: "Viewer" } }) }));
vi.mock("@/lib/notify", () => ({ broadcaster: { tournament: vi.fn() }, announcer: { announce: vi.fn() } }));
beforeEach(() => {
  state.db = new Database(":memory:"); migrate(state.db);
  state.db.exec("insert into users(id,username,display_name) values(101,'viewer','Viewer'); insert into players(id,guild_id,user_id,display_name) values(1,'g',101,'Viewer')");
  for(let i=1;i<=30;i++) {
    state.db.prepare("insert into drafts(id,guild_id,channel_id,name,status,created_by_user_id,web_slug,created_at) values(?,'g','c',?,'pending',101,?,'2026-10-01 12:00:00')").run(i,`Draft ${i}`,`draft-${i}`);
    state.db.prepare("insert into draft_players(draft_id,player_id) values(?,1)").run(i);
    state.db.prepare("insert into tournaments(id,guild_id,name,format,status,created_by_user_id,web_slug,created_at) values(?,'g',?,'round_robin','pending',101,?,'2026-10-01 12:00:00')").run(i,`Cup ${i}`,`cup-${i}`);
    state.db.prepare("insert into tournament_participants(tournament_id,player_id) values(?,1)").run(i);
  }
});
afterEach(() => state.db!.close());
async function api(kind: "drafts"|"tournaments", cursor?: string) {
  const route = kind === "drafts" ? await import("../app/api/drafts/route") : await import("../app/api/tournaments/route");
  return route.GET(new Request(`http://localhost/api/${kind}${cursor !== undefined ? '?cursor='+encodeURIComponent(cursor):''}`) as never);
}
function pagedProps(element: any): any {
  if(!element || typeof element !== "object") return null;
  if(element.props?.nextCursor !== undefined && element.props?.initialItems) return element.props;
  for(const child of [element.props?.children].flat()) { const found = pagedProps(child); if(found) return found; }
  return null;
}
describe("paged list HTTP and server page contract", () => {
  for(const kind of ["drafts","tournaments"] as const) {
    it(`${kind}: serves 25 items, keeps item shape and accepts the next cursor`, async () => {
      const response = await api(kind); expect(response.status).toBe(200);
      const first = await response.json(); expect(first.items).toHaveLength(25); expect(first.items[0].id).toBe(30);
      expect(first.nextCursor).toEqual(expect.any(String));
      expect(first.items[0]).not.toHaveProperty("configJson");
      if(kind === "drafts") expect(first.items[0]).toEqual({ id:30,guildId:"g",name:"Draft 30",status:"pending",mode:"booster",webSlug:"draft-30",currentPackRound:0,currentPickStep:0,playerCount:1,createdAt:"2026-10-01T12:00:00Z" });
      const last = await (await api(kind,first.nextCursor)).json();
      expect(last.items.map((i:any)=>i.id)).toEqual([5,4,3,2,1]); expect(last.nextCursor).toBeNull();
    });
    it.each(["bad", "", "e30"])(`${kind}: invalid cursor returns 400: %s`, async cursor => {
      expect((await api(kind,cursor)).status).toBe(400);
    });
    it(`${kind}: rejects a cursor issued for a different guild`, async () => {
      const first = await (await api(kind)).json();
      const cursor = JSON.parse(Buffer.from(first.nextCursor, "base64url").toString("utf8"));
      cursor.guildId = "other-guild";
      expect((await api(kind,Buffer.from(JSON.stringify(cursor)).toString("base64url"))).status).toBe(400);
    });
    it(`${kind}: passes the first page and cursor to its client list`, async () => {
      const page = kind === "drafts" ? await import("../app/(app)/drafts/page") : await import("../app/(app)/tournaments/page");
      const props = pagedProps(await page.default());
      expect(props).not.toBeNull();
      expect(props.initialItems).toHaveLength(25);
      expect(props.initialItems[0].id).toBe(30);
      expect(props.nextCursor).toEqual((await (await api(kind)).json()).nextCursor);
    });
  }
  it("bounds both dashboard API lists", async () => {
    const { GET } = await import("../app/api/dashboard/route");
    const result = await (await GET()).json();
    expect(result.drafts).toHaveLength(10); expect(result.tournaments).toHaveLength(10);
  });
});

it("bounds both dashboard server-rendered lists", async () => {
  const { default: page } = await import("../app/(app)/dashboard/page");
  const rows: { draft: any[]; tournament: any[] } = { draft: [], tournament: [] };
  function collect(element: any) {
    if (Array.isArray(element)) { element.forEach(collect); return; }
    if (!element || typeof element !== "object") return;
    if(element.props?.draft) rows.draft.push(element.props.draft);
    if(element.props?.tournament) rows.tournament.push(element.props.tournament);
    collect(element.props?.children);
  }
  collect(await page());
  expect(rows.draft).toHaveLength(10);
  expect(rows.tournament).toHaveLength(10);
});
