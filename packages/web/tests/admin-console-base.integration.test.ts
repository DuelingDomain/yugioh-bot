import Database from "better-sqlite3";
import { DUEL_WAITING_IDLE_TIMEOUT_MS } from "@yugidraft/shared/duels";
import { migrate } from "@yugidraft/shared/db";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { auth, getDb } = vi.hoisted(() => ({ auth: vi.fn(), getDb: vi.fn() }));
vi.mock("@/lib/session-identity", async () => {
  const { sessionFixture } = await import("./fixtures/session");
  return sessionFixture(auth);
});
vi.mock("@/lib/db", () => ({ getDb }));

let db: Database.Database;
beforeEach(() => {
  vi.resetModules(); auth.mockReset(); getDb.mockReset();
  auth.mockResolvedValue({ user: { id: "1", name: "Operator" } });
  vi.stubEnv("OWNER_USER_IDS", "1"); vi.stubEnv("WEB_URL", "https://app.example.test");
  db = new Database(":memory:"); migrate(db); getDb.mockReturnValue(db);
  db.exec(`insert into users(id,username,display_name) values(1,'op','Operator'),(2,'ann','Ann'),(3,'bo','Bo'),(4,'cy','Cy');
    insert into players(id,guild_id,discord_user_id,display_name,user_id) values(12,'g','d2','Ann',2),(13,'g','d3','Bo',3);`);
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); });

const beat = (route: unknown, origin: string | null = "https://app.example.test") => new Request("https://internal/api/presence", {
  method: "POST", headers: { ...(origin ? { origin } : {}), "content-type": "application/json" }, body: JSON.stringify({ route }) });
async function post(request: Request) { const { POST } = await import("../app/api/presence/route"); return POST(request); }
async function online() { const { GET } = await import("../app/api/admin/console/online/route"); return GET(); }

it("stores only the latest route template and rate-limits a second beat", async () => {
  expect((await post(beat("/decks/new"))).status).toBe(204);
  expect(db.prepare("select last_route r, last_seen_at s from users where id=1").get()).toMatchObject({ r: "/decks/new" });
  const second = await post(beat("/draft/[slug]"));
  expect(second.status).toBe(429);
  expect(second.headers.get("retry-after")).toBe("30");
  expect(db.prepare("select last_route r from users where id=1").get()).toEqual({ r: "/decks/new" });
  // A changed route is let through after 10 s, so the label follows the person.
  db.prepare("update users set last_seen_at = last_seen_at - 11000 where id=1").run();
  expect((await post(beat("/draft/[slug]"))).status).toBe(204);
  expect(db.prepare("select last_route r from users where id=1").get()).toEqual({ r: "/draft/[slug]" });
});
it.each(["/duels/abc-123", "/decks/new?x=1", 5, null])("refuses an unknown route %j", async (route) => {
  expect((await post(beat(route))).status).toBe(400);
  expect(db.prepare("select last_route r from users where id=1").get()).toEqual({ r: null });
});
it("refuses a beat from another origin and a signed-out beat", async () => {
  expect((await post(beat("/decks", "https://evil.test"))).status).toBe(403);
  expect((await post(beat("/decks", null))).status).toBe(403);
  auth.mockResolvedValue(null);
  expect((await post(beat("/decks"))).status).toBe(401);
});
it("does nothing when PRESENCE_ENABLED is 0", async () => {
  vi.stubEnv("PRESENCE_ENABLED", "0");
  expect((await post(beat("/decks"))).status).toBe(204);
  expect(db.prepare("select last_route r from users where id=1").get()).toEqual({ r: null });
});

it("lists people seen in the last 2 minutes with friendly labels, people at a table first", async () => {
  const now = Date.now();
  db.prepare("update users set last_seen_at=?, last_route=? where id=?").run(now - 5_000, "/decks/new", 2);
  db.prepare("update users set last_seen_at=?, last_route=? where id=?").run(now - 60_000, "/duels/[slug]", 3);
  db.prepare("update users set last_seen_at=?, last_route=? where id=?").run(now - 130_000, "/cubes/[id]", 4);
  db.exec(`insert into duels(id,guild_id,web_slug,name,organizer_player_id,mode,status,format)
    values(1,'g','t1','Table',13,'domain','active','ffa4'); insert into duel_seats(duel_id,seat,player_id) values(1,0,13);`);
  const response = await online();
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.state).toBe("ok");
  expect(body.data.count).toBe(2);
  expect(body.data.users.map((u: { name: string; label: string }) => [u.name, u.label])).toEqual([["Bo", "4-way duel"], ["Ann", "Deck builder"]]);
  expect(body.data.bySection).toEqual([{ label: "4-way duel", count: 1 }, { label: "Deck builder", count: 1 }]);
});
it("adds username, a Clerk picture only, and the table each person is in", async () => {
  const now = Date.now();
  db.prepare("update users set last_seen_at=?, last_route=?, online_since=?, image_url=? where id=?").run(now - 5_000, "/draft/[slug]", now - 600_000, "https://img.clerk.com/ann.png", 2);
  db.prepare("update users set last_seen_at=?, last_route=?, image_url=? where id=?").run(now - 9_000, "/duels/[slug]", "http://img.example.test/bo.png", 3);
  db.exec(`insert into duels(id,guild_id,web_slug,name,organizer_player_id,mode,status,format)
    values(1,'g','t1','Friday Fours',13,'domain','active','ffa4'); insert into duel_seats(duel_id,seat,player_id) values(1,0,13);
    insert into drafts(id,guild_id,channel_id,name,status,created_by_user_id,web_slug) values(1,'g','c','Sunday Cube','active','2','dr1');
    insert into draft_players(draft_id,player_id) values(1,12);`);
  // Ann is in a draft, Bo in a duel: duels come first.
  const [bo, ann] = (await (await online()).json()).data.users;
  expect(ann).toEqual({
    userId: 2, name: "Ann", username: "ann", avatarUrl: "https://img.clerk.com/ann.png", label: "Draft",
    lastSeenAt: now - 5_000, onlineSince: now - 600_000,
    current: { kind: "draft", slug: "dr1", name: "Sunday Cube", href: "/draft/dr1", label: "Draft", status: "active" },
  });
  expect(bo).toMatchObject({ username: "bo", avatarUrl: null, onlineSince: null,
    current: { kind: "duel", slug: "t1", name: "Friday Fours", href: "/duels/t1", label: "4-way duel", status: "active" } });
  // An https picture from another host is not passed on.
  db.prepare("update users set image_url=? where id=2").run("https://evil.example.test/ann.png");
  expect((await (await online()).json()).data.users[1].avatarUrl).toBeNull();
});
it("shows a table only while it is open and only on that table's page", async () => {
  const now = Date.now();
  db.prepare("update users set last_seen_at=?, last_route=? where id=?").run(now - 5_000, "/duels/[slug]", 2);
  db.prepare("update users set last_seen_at=?, last_route=? where id=?").run(now - 5_000, "/decks", 3);
  // Ann's lobby had no activity for longer than the lobby timeout: the host is about to close it.
  const old = new Date(now - DUEL_WAITING_IDLE_TIMEOUT_MS - 60_000).toISOString();
  db.prepare(`insert into duels(id,guild_id,web_slug,name,organizer_player_id,mode,status,format,created_at,last_activity_at)
    values(1,'g','idle','Old lobby',12,'domain','lobby','1v1',?,?)`).run(old, old);
  // Bo has a running duel, but he is on the decks page now.
  db.exec(`insert into duels(id,guild_id,web_slug,name,organizer_player_id,mode,status,format) values(2,'g','run','Running',13,'domain','active','1v1');
    insert into duel_seats(duel_id,seat,player_id) values(1,0,12),(2,0,13);`);
  const users = (await (await online()).json()).data.users as { name: string; label: string; current: unknown }[];
  // A duel page without an open seat is not "in a duel".
  expect(users.map((u) => [u.name, u.label, u.current])).toEqual([["Ann", "Duel page", null], ["Bo", "Decks", null]]);
});
it("does not show a person in a duel they surrendered, were eliminated from, or that ended", async () => {
  const now = Date.now();
  for (const id of [1, 2, 3, 4]) db.prepare("update users set last_seen_at=?, last_route=? where id=?").run(now - 5_000, "/duels/[slug]", id);
  db.exec(`insert into players(id,guild_id,discord_user_id,display_name,user_id) values(11,'g','d1','Operator',1),(14,'g','d4','Cy',4);
    insert into duels(id,guild_id,web_slug,name,organizer_player_id,mode,status,format,setup_json) values
      (1,'g','f4','Fours',12,'domain','active','ffa4','{"surrenderedSeats":[1],"eliminatedSeats":[2]}'),
      (2,'g','done','Done',11,'domain','completed','1v1',null);
    insert into duel_seats(duel_id,seat,player_id) values(1,0,12),(1,1,13),(1,2,14),(1,3,11),(2,0,11);
    insert into duel_commands(duel_id,seq,seat,command_json) values(1,1,3,'{"promptId":"eliminate:timeout"}');`);
  const users = (await (await online()).json()).data.users as { name: string; label: string; current: { slug: string } | null }[];
  const seen = Object.fromEntries(users.map((u) => [u.name, [u.label, u.current?.slug ?? null]]));
  // Ann still plays. Bo surrendered, Cy was eliminated, Operator timed out there and the 1v1 of Operator ended.
  expect(seen).toEqual({ Ann: ["4-way duel", "f4"], Bo: ["Duel page", null], Cy: ["Duel page", null], Operator: ["Duel page", null] });
});
it("a leave beat from a closed table page ends the table label at once, only for that page", async () => {
  const leave = (route: string) => new Request("https://internal/api/presence", {
    method: "POST", headers: { origin: "https://app.example.test", "content-type": "application/json" }, body: JSON.stringify({ route, leave: true }) });
  expect((await post(beat("/duels/[slug]"))).status).toBe(204);
  // A second tab on another page closes: the person still sits at the table.
  expect((await post(leave("/decks"))).status).toBe(204);
  expect(db.prepare("select last_route r from users where id=1").get()).toEqual({ r: "/duels/[slug]" });
  const seenAt = (db.prepare("select last_seen_at s from users where id=1").get() as { s: number }).s;
  expect((await post(leave("/duels/[slug]"))).status).toBe(204);
  // Still online (the window runs on), but no longer on the duel page; the beat time is not changed.
  expect(db.prepare("select last_route r, last_seen_at s from users where id=1").get()).toEqual({ r: "/app", s: seenAt });
  expect((await post(leave("/duels/abc"))).status).toBe(400);
  expect((await post(new Request("https://internal/api/presence", { method: "POST", headers: { origin: "https://evil.test" }, body: '{"route":"/duels/[slug]","leave":true}' }))).status).toBe(403);
});
it("keeps the online stretch across beats and starts a new one after a gap", async () => {
  expect((await post(beat("/decks"))).status).toBe(204);
  const first = db.prepare("select online_since s from users where id=1").get() as { s: number };
  expect(first.s).toBeGreaterThan(0);
  // A beat 35 s later continues the stretch.
  db.prepare("update users set last_seen_at = last_seen_at - 35000, online_since = online_since - 35000 where id=1").run();
  expect((await post(beat("/decks"))).status).toBe(204);
  expect(db.prepare("select online_since s from users where id=1").get()).toEqual({ s: first.s - 35_000 });
  // After more than 2 minutes without a beat the person was offline: a new stretch starts.
  db.prepare("update users set last_seen_at = last_seen_at - 200000 where id=1").run();
  expect((await post(beat("/decks"))).status).toBe(204);
  expect((db.prepare("select online_since s from users where id=1").get() as { s: number }).s).toBeGreaterThanOrEqual(first.s);
});
it("says Duel lobby for a table that has not started", async () => {
  db.prepare("update users set last_seen_at=?, last_route=? where id=2").run(Date.now(), "/duels/[slug]");
  db.exec(`insert into duels(id,guild_id,web_slug,name,organizer_player_id,mode,status,format)
    values(1,'g','t1','Table',12,'domain','lobby','tag'); insert into duel_seats(duel_id,seat,player_id) values(1,0,12);`);
  expect((await (await online()).json()).data.users[0].label).toBe("Duel lobby");
});
it("answers 404 to anyone who is not an owner and 401 without a session", async () => {
  auth.mockResolvedValue({ user: { id: "2", name: "Ann" } });
  expect((await online()).status).toBe(404);
  auth.mockResolvedValue(null);
  expect((await online()).status).toBe(401);
});
it("clears presence when the account is deleted", async () => {
  db.prepare("update users set last_seen_at=?, last_route=?, online_since=?, image_url=? where id=2").run(Date.now(), "/decks", Date.now(), "https://img.clerk.com/ann.png");
  // A user with game history is anonymised and kept; one without is removed.
  db.exec(`insert into duels(id,guild_id,web_slug,name,organizer_player_id,mode,status) values(1,'g','t1','Table',12,'domain','completed');
    insert into duel_seats(duel_id,seat,player_id) values(1,0,12);`);
  const { deleteUserAccount } = await import("@yugidraft/shared/services");
  deleteUserAccount(db, 2);
  expect(db.prepare("select last_seen_at s, last_route r, online_since o, image_url i from users where id=2").get()).toEqual({ s: null, r: null, o: null, i: null });
});

it('vision feedback keeps consent default-off, checks origin and protects review and crop routes', async()=>{
  const {GET,PATCH,DELETE:deleteOwn}=await import('../app/api/remote-vision/feedback/route');
  expect(await (await GET()).json()).toMatchObject({enabled:false,askedAt:null});
  const req=(enabled:boolean,origin='https://app.example.test')=>new Request('https://app.example.test/api/remote-vision/feedback',{method:'PATCH',headers:{origin,'content-type':'application/json'},body:JSON.stringify({enabled})});
  expect((await PATCH(req(true,'https://evil.test'))).status).toBe(403);
  expect((await PATCH(req(false))).status).toBe(200);
  expect(await (await GET()).json()).toMatchObject({enabled:false,askedAt:expect.any(Number)});
  vi.stubEnv('REMOTE_VISION_FEEDBACK','0');
  expect((await deleteOwn(new Request('https://app.example.test/api/remote-vision/feedback',{method:'DELETE',headers:{origin:'https://app.example.test'}}))).status).toBe(200);
  const {GET:review}=await import('../app/api/admin/console/vision/route');
  expect((await review()).status).toBe(200);
  auth.mockResolvedValue({user:{id:'2',name:'Ann'}});expect((await review()).status).toBe(404);
  auth.mockResolvedValue(null);expect((await GET()).status).toBe(401);
});

it('captures bounded crops through the authenticated API and withdraws moderation/deletion evidence',async()=>{
  const {mkdtemp,rm,writeFile,mkdir,readdir}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const sharp=(await import('sharp')).default;
  const dir=await mkdtemp(join(tmpdir(),'vision-route-'));vi.stubEnv('DATA_DIR',dir);vi.stubEnv('VISION_DATA_DIR',join(dir,'vision'));vi.stubEnv('REMOTE_VISION_FEEDBACK','1');
  try {
    const {GET,PATCH,POST,DELETE:removeOwn}=await import('../app/api/remote-vision/feedback/route');
    const req=(body:unknown,method='POST',origin='https://app.example.test')=>new Request('https://app.example.test/api/remote-vision/feedback',{method,headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
    expect((await POST(req({}))).status).toBe(403);
    const prompt=await (await PATCH(req({asked:true},'PATCH'))).json();expect(prompt).toMatchObject({enabled:false,prompted:true});
    expect(await (await PATCH(req({asked:true},'PATCH'))).json()).toMatchObject({prompted:false,enabled:false});
    await PATCH(req({enabled:true},'PATCH'));
    const meta={gameId:'yugioh',modelId:'m',modelSha256:'a'.repeat(64),generatedAt:'v1',count:2,dim:2,layoutKey:'layout',entries:[{cardId:'A'},{cardId:'B'}]};
    await mkdir(join(dir,'vision'));await writeFile(join(dir,'vision/yugioh-index.meta.json'),JSON.stringify(meta));
    const jpegBase64=(await sharp({create:{width:224,height:326,channels:3,background:'white'}}).jpeg().toBuffer()).toString('base64');
    const sample={jpegBase64,embedding:[1,0],top5:[{cardId:'A',score:.9},{cardId:'B',score:.8}],chosenCardId:'B',tier:'sure',source:'voice',gameId:'yugioh',modelId:'m',modelSha256:'a'.repeat(64),indexVersion:`${'a'.repeat(64)}:v1:2`,layoutKey:'layout',space:'art-box',sharpness:42};
    await writeFile(join(dir,'vision/yugioh-full-art.meta.json'),JSON.stringify({...meta,layoutKey:'whole',count:1,entries:[{cardId:'B'}]}));
    const {validFeedbackIndex}=await import('../src/lib/vision-feedback');
    expect(await validFeedbackIndex({...sample,chosenCardId:'A',space:'whole-card',layoutKey:'whole',indexVersion:`${'a'.repeat(64)}:v1:1`})).toBe(true);
    expect((await POST(req({...sample,chosenCardId:'unknown'}))).status).toBe(400);
    expect((await POST(req(sample,'POST','https://evil.test'))).status).toBe(403);
    expect((await POST(req({...sample,extra:'full-frame'}))).status).toBe(400);
    expect((await POST(req({...sample,jpegBase64:'a'.repeat(100_000)}))).status).toBe(413);
    const saved=await POST(req(sample));expect(saved.status).toBe(201);const {id}=await saved.json();
    expect((await POST(req(sample))).status).toBe(201);expect(await readdir(join(dir,'vision-feedback'))).toHaveLength(1);
    const ctx={params:Promise.resolve({id})};
    const {PATCH:review,DELETE:remove}=await import('../app/api/admin/console/vision/[id]/route');
    const {GET:crop}=await import('../app/api/admin/console/vision/[id]/crop/route');
    const {GET:learning}=await import('../app/api/remote-vision/learning/route');
    expect((await crop(req(null),ctx)).status).toBe(200);
    expect((await review(req({review:'approved'},'PATCH'),ctx)).status).toBe(200);
    const learned=await (await learning()).json();expect(learned.references).toHaveLength(1);expect(learned.references[0].userId).toBeUndefined();
    auth.mockResolvedValue({user:{id:'2',name:'Ann'}});expect((await crop(req(null),ctx)).status).toBe(404);expect((await remove(req(null,'DELETE'),ctx)).status).toBe(404);
    expect(await (await removeOwn(req(null,'DELETE'))).json()).toEqual({deleted:0});
    auth.mockResolvedValue({user:{id:'1',name:'Operator'}});
    await review(req({review:'rejected'},'PATCH'),ctx);expect((await (await learning()).json()).references).toHaveLength(0);
    vi.stubEnv('REMOTE_VISION_FEEDBACK','0');expect((await POST(req(sample))).status).toBe(404);
    expect(await (await removeOwn(req(null,'DELETE'))).json()).toEqual({deleted:1});expect(await readdir(join(dir,'vision-feedback'))).toHaveLength(0);
    expect((await GET()).status).toBe(200);
  }finally{await rm(dir,{recursive:true,force:true});}
});
