import { createHash, randomBytes } from "node:crypto";
import { AccessToken, RoomServiceClient, TrackSource } from "livekit-server-sdk";
import { createRemotePhoneToken, verifyRemotePhoneToken, REMOTE_PHONE_PAIR_TTL_MS, type RemotePhoneClaims } from "@yugidraft/shared/ws";
import { createRemoteDuelService } from "@yugidraft/shared/services";
import { remoteAssert, type RemoteRoom } from "@yugidraft/shared/remote";
import { getDb } from "@/lib/db";

type Pair = { id: string; slug: string; guild_id: string; user_id: number; seat: number; expires_at: number; used_at: number | null; revoked: number; device_expires_at: number; mode: string; code_hash: string; cleanup_pending: number };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const secret = () => { const value = process.env.WS_INTERNAL_SECRET; if (!value) throw new Error("Missing phone signing secret"); return value; };
/** Additive web-owned schema; no game events/images are stored here. */
function database() {
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS remote_phone_pairs (
    id TEXT PRIMARY KEY, slug TEXT NOT NULL, guild_id TEXT NOT NULL, user_id INTEGER NOT NULL, seat INTEGER NOT NULL,
    code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER, revoked INTEGER NOT NULL DEFAULT 0,
    device_expires_at INTEGER NOT NULL, mode TEXT NOT NULL DEFAULT 'video', cleanup_pending INTEGER NOT NULL DEFAULT 0);
    CREATE UNIQUE INDEX IF NOT EXISTS remote_phone_active_owner ON remote_phone_pairs(slug,user_id) WHERE revoked=0;
    CREATE INDEX IF NOT EXISTS remote_phone_owner ON remote_phone_pairs(slug,user_id);
    CREATE TABLE IF NOT EXISTS remote_phone_modes (slug TEXT NOT NULL,user_id INTEGER NOT NULL,seat INTEGER NOT NULL,mode TEXT NOT NULL,PRIMARY KEY(slug,user_id));
    CREATE TABLE IF NOT EXISTS remote_phone_attempts (bucket TEXT PRIMARY KEY, started_at INTEGER NOT NULL, count INTEGER NOT NULL);`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS remote_phone_seat_left AFTER DELETE ON remote_seats BEGIN
    UPDATE remote_phone_pairs SET revoked=1,cleanup_pending=CASE WHEN used_at IS NULL THEN 0 ELSE 1 END
    WHERE slug=(SELECT slug FROM remote_tables WHERE id=OLD.table_id) AND user_id=OLD.user_id AND revoked=0;
    END;
    CREATE TRIGGER IF NOT EXISTS remote_phone_table_ended AFTER UPDATE OF status ON remote_tables WHEN NEW.status='ended' BEGIN
    UPDATE remote_phone_pairs SET revoked=1,cleanup_pending=CASE WHEN used_at IS NULL THEN 0 ELSE 1 END WHERE slug=NEW.slug AND revoked=0;
    END;`);
  return db;
}
export function phoneConfig() {
  remoteAssert(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET, "Phone video is not configured", 503, "LIVEKIT_UNAVAILABLE");
  return { url: process.env.LIVEKIT_URL!, key: process.env.LIVEKIT_API_KEY!, secret: process.env.LIVEKIT_API_SECRET! };
}
function service() {
  const c = phoneConfig();
  return new RoomServiceClient(c.url.replace(/^ws/, "http"), c.key, c.secret);
}
export const phoneIdentity = (id: string) => `remote-phone-${id}`;
function claimsFor(p: Pair, expiresAt: number): RemotePhoneClaims {
  return { id: p.id, slug: p.slug, guildId: p.guild_id, userId: p.user_id, seat: p.seat, expiresAt };
}
/** Revocation is durable before contacting the SFU; failed cleanup remains retryable. */
export async function cleanupPhones(slug:string) {
  const db=database();
  const pairs=db.prepare("SELECT * FROM remote_phone_pairs WHERE slug=? AND cleanup_pending=1").all(slug) as Pair[];
  await Promise.all(pairs.map(async p=>{
    const sdk=service();const room=`remote-${slug}`;const identity=phoneIdentity(p.id);
    const ignoreMissing=(e:unknown)=>{if((e as {status?:number}).status!==404 && (e as {code?:string}).code!=="not_found")throw e;};
    try {await sdk.updateParticipant(room,identity,{permission:{canPublish:false,canSubscribe:false,canPublishData:false}});}catch(e){ignoreMissing(e);}
    // Future cutoff also covers LiveKit-refreshed tokens minted during this device session.
    try {await sdk.removeParticipant(room,identity,{revokeTokenTs:BigInt(Math.ceil(p.device_expires_at/1000))});}catch(e){ignoreMissing(e);}
    db.prepare("UPDATE remote_phone_pairs SET cleanup_pending=0 WHERE id=?").run(p.id);
  }));
}
export async function removePhones(slug:string,userId:number) {
  database().prepare("UPDATE remote_phone_pairs SET revoked=1,cleanup_pending=CASE WHEN used_at IS NULL THEN 0 ELSE 1 END WHERE slug=? AND user_id=? AND revoked=0").run(slug,userId);
  await cleanupPhones(slug);
}
export async function issuePhone(room: RemoteRoom, userId: number) {
  phoneConfig();
  const now = Date.now(); const db = database();
  db.prepare("DELETE FROM remote_phone_pairs WHERE device_expires_at<? AND cleanup_pending=0").run(now-20*60_000);
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const code = [...randomBytes(8)].map(byte => alphabet[byte % 32]).join("");
  const id = randomBytes(16).toString("hex");
  const p: Pair = { id, slug: room.slug, guild_id: room.guildId, user_id: userId, seat: room.mySeat,
    code_hash: hash(code), expires_at: now + REMOTE_PHONE_PAIR_TTL_MS, used_at: null, revoked: 0, device_expires_at: now + 12 * 60 * 60_000, mode: "video", cleanup_pending:0 };
  db.transaction(()=>{
  db.prepare("UPDATE remote_phone_pairs SET revoked=1,cleanup_pending=CASE WHEN used_at IS NULL THEN 0 ELSE 1 END WHERE slug=? AND user_id=? AND revoked=0").run(room.slug,userId);
  db.prepare("DELETE FROM remote_phone_modes WHERE slug=? AND user_id=?").run(room.slug,userId);
  db.prepare(`INSERT INTO remote_phone_pairs(id,slug,guild_id,user_id,seat,code_hash,expires_at,device_expires_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run(id,p.slug,p.guild_id,userId,p.seat,p.code_hash,p.expires_at,p.device_expires_at);
  })();
  await cleanupPhones(room.slug);
  return { token: createRemotePhoneToken("pair", claimsFor(p,p.expires_at), secret()), code, expiresAt: p.expires_at };
}
/** Uniform failure for wrong table, expired, replayed, revoked or changed membership. */
const invalid = () => remoteAssert(false, "Pairing expired or revoked. Get a new code on your desktop.", 401, "PHONE_PAIR_INVALID");
function member(p: Pair) {
  try {
    const room = createRemoteDuelService(getDb()).get(p.slug,p.guild_id,p.user_id);
    if (room.status === "ended" || room.mySeat !== p.seat || Date.now() - room.lastEventAt >= 10 * 60_000) return invalid();
    return room;
  } catch { return invalid(); }
}
export function phoneRoster(room: RemoteRoom) {
  const rows = database().prepare("SELECT * FROM remote_phone_pairs WHERE slug=? AND revoked=0 AND device_expires_at>?").all(room.slug,Date.now()) as Pair[];
  return rows.filter(p => room.seats.some(s => s.seat === p.seat && s.userId === p.user_id)).map(p => ({ id:p.id, seat:p.seat, userId:p.user_id, paired:!!p.used_at, mode:p.mode, expiresAt:p.expires_at }));
}
export function limitPhoneAttempts(request: Request, slug: string) {
  const db = database(); const now = Date.now();
  // Deployments must strip/splice forwarding headers at their trusted reverse proxy.
  const bucket = hash(`${slug}:${request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "direct"}`);
  db.prepare("DELETE FROM remote_phone_attempts WHERE started_at<?").run(now-REMOTE_PHONE_PAIR_TTL_MS);
  db.prepare("INSERT INTO remote_phone_attempts VALUES(?,?,1) ON CONFLICT(bucket) DO UPDATE SET count=count+1").run(bucket,now);
  const row = db.prepare("SELECT count FROM remote_phone_attempts WHERE bucket=?").get(bucket) as { count:number };
  remoteAssert(row.count <= 30, "Wait before trying another pairing code", 429, "PHONE_RATE_LIMIT");
}
export async function connectPhone(slug: string, body: Record<string, unknown>) {
  const db = database(); const now = Date.now(); let p: Pair | undefined;
  const device = typeof body.device === "string" ? verifyRemotePhoneToken("device",body.device,secret()) : null;
  if (device) {
    p = db.prepare("SELECT * FROM remote_phone_pairs WHERE id=? AND used_at IS NOT NULL AND revoked=0 AND device_expires_at>?").get(device.id,now) as Pair | undefined;
    if (!p || p.slug !== slug || JSON.stringify(claimsFor(p,p.device_expires_at)) !== JSON.stringify(device)) return invalid();
  } else {
    const pair = typeof body.pair === "string" ? verifyRemotePhoneToken("pair",body.pair,secret()) : null;
    if (pair?.slug === slug) p = db.prepare("SELECT * FROM remote_phone_pairs WHERE id=? AND slug=?").get(pair.id,slug) as Pair | undefined;
    else if (typeof body.code === "string" && /^[A-Z2-9]{8}$/.test(body.code)) p = db.prepare("SELECT * FROM remote_phone_pairs WHERE slug=? AND code_hash=? AND revoked=0 AND used_at IS NULL AND expires_at>?").get(slug,hash(body.code),now) as Pair | undefined;
    if (!p || p.revoked || p.used_at || p.expires_at <= now || (pair && JSON.stringify(claimsFor(p,p.expires_at)) !== JSON.stringify(pair))) return invalid();
    member(p);
    // One atomic compare-and-set also arbitrates QR/code redemption across workers.
    const result = db.prepare("UPDATE remote_phone_pairs SET used_at=? WHERE id=? AND used_at IS NULL AND revoked=0 AND expires_at>?").run(now,p.id,now);
    if (result.changes !== 1) return invalid();
  }
  member(p);
  const c = phoneConfig();
  const token = new AccessToken(c.key,c.secret,{ identity:phoneIdentity(p.id), name:"Phone camera", ttl:30,
    metadata:JSON.stringify({ guildId:p.guild_id,tableId:p.slug,userId:p.user_id,seat:p.seat,role:"field-phone",pairId:p.id }) });
  token.addGrant({roomJoin:true,room:`remote-${slug}`,canPublish:true,canSubscribe:false,canPublishData:true,
    canPublishSources:[TrackSource.CAMERA],canUpdateOwnMetadata:false});
  return { url:c.url, token:await token.toJwt(), room:`remote-${slug}`, seat:p.seat, userId:p.user_id, guildId:p.guild_id, id:p.id,
    device:createRemotePhoneToken("device",claimsFor(p,p.device_expires_at),secret()) };
}

export function cameraModes(room:RemoteRoom) {
  const rows=database().prepare("SELECT seat,user_id,mode FROM remote_phone_modes WHERE slug=?").all(room.slug) as {seat:number;user_id:number;mode:string}[];
  return rows.filter(p=>room.seats.some(s=>s.seat===p.seat&&s.userId===p.user_id)).map(p=>({seat:p.seat,mode:p.mode}));
}
export async function setCameraMode(room:RemoteRoom,userId:number,mode:unknown) {
  remoteAssert(mode === "manual" || mode === "webcam", "Invalid camera mode");
  if(mode === "manual") await removePhones(room.slug,userId);
  database().prepare("INSERT INTO remote_phone_modes VALUES(?,?,?,?) ON CONFLICT(slug,user_id) DO UPDATE SET seat=excluded.seat,mode=excluded.mode").run(room.slug,userId,room.mySeat,mode);
}

/** One unref'd maintenance loop per web process, including idle closures made by the WS process. */
const janitorKey=Symbol.for("yugidraft.remote-phone-cleanup");
export function startPhoneCleanup() {
  if(process.env.REMOTE_DUELS!=="1" || !process.env.LIVEKIT_URL)return;
  const root=globalThis as typeof globalThis & {[janitorKey]?:ReturnType<typeof setInterval>};
  if(root[janitorKey])return;
  let running=false;
  root[janitorKey]=setInterval(async()=>{
    if(running)return;running=true;
    try{
      const db=database(),now=Date.now();
      db.prepare(`UPDATE remote_phone_pairs SET revoked=1,cleanup_pending=CASE WHEN used_at IS NULL THEN 0 ELSE 1 END
        WHERE revoked=0 AND (device_expires_at<=? OR (used_at IS NULL AND expires_at<=?) OR NOT EXISTS (
          SELECT 1 FROM remote_tables t JOIN remote_seats s ON s.table_id=t.id
          WHERE t.slug=remote_phone_pairs.slug AND t.status!='ended' AND t.last_event_at>?
          AND s.user_id=remote_phone_pairs.user_id AND s.seat=remote_phone_pairs.seat))`).run(now,now,now-10*60_000);
      // OSS 1.13 does not enforce revokeTokenTs. Rejoined revoked identities remain untrusted
      // to subscribers and are removed again here, including server-refreshed JWTs.
      const revoked=db.prepare("SELECT * FROM remote_phone_pairs WHERE revoked=1 AND used_at IS NOT NULL").all() as Pair[];
      const rooms=new Map<string,Set<string>>();
      for(const p of revoked){
        if(!rooms.has(p.slug)){
          try {rooms.set(p.slug,new Set((await service().listParticipants(`remote-${p.slug}`)).map(v=>v.identity)));}
          catch(e){if((e as {code?:string}).code!=="not_found")throw e;rooms.set(p.slug,new Set());}
        }
        if(rooms.get(p.slug)!.has(phoneIdentity(p.id)))db.prepare("UPDATE remote_phone_pairs SET cleanup_pending=1 WHERE id=?").run(p.id);
      }
      const slugs=db.prepare("SELECT DISTINCT slug FROM remote_phone_pairs WHERE cleanup_pending=1").all() as {slug:string}[];
      for(const row of slugs)await cleanupPhones(row.slug);
    }catch{ /* Durable pending rows are retried at the next tick. No capabilities are logged. */ }
    finally{running=false;}
  },15_000);
  root[janitorKey].unref();
}
