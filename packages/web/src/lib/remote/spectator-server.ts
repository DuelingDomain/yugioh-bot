import { RoomServiceClient } from "livekit-server-sdk";
import { isRemoteDuelUser } from "@yugidraft/shared/access/remote-duel-users";
import { createRemoteDuelService, REMOTE_SPECTATOR_CAP } from "@yugidraft/shared/services";
import { remoteAssert } from "@yugidraft/shared/remote";
import { getDb } from "@/lib/db";

/** 4 seats + 4 phones + the spectator cap. `max_participants` in livekit.prod.yaml is 2 above this, so a player gets in while a spectator is being removed. */
export const REMOTE_ROOM_LIMIT = 8 + REMOTE_SPECTATOR_CAP;
const SWEEP_MS = 30_000;
/** A token route must answer when LiveKit is slow: the check is skipped and the sweep does the work. */
const CHECK_TIMEOUT_MS = 1500;
const SPECTATOR = "remote-spectator-", SEATED = "remote-user-";
export const remoteVoiceRoom = (slug: string) => `remote-${slug}-voice`;
const missing = (error: unknown) => (error as { status?: number }).status === 404 || (error as { code?: string }).code === "not_found";

function client() {
  const { LIVEKIT_URL: url, LIVEKIT_API_KEY: key, LIVEKIT_API_SECRET: secret } = process.env;
  return url && key && secret ? new RoomServiceClient(url.replace(/^ws/, "http"), key, secret) : null;
}
async function identities(sdk: RoomServiceClient, room: string) {
  try { return (await sdk.listParticipants(room)).map(participant => participant.identity); }
  catch (error) { if (missing(error)) return []; throw error; }
}
async function drop(sdk: RoomServiceClient, room: string, identity: string) {
  try { await sdk.removeParticipant(room, identity); } catch (error) { if (!missing(error)) throw error; }
}
const userOf = (identity: string, prefix: string) => identity.startsWith(prefix) ? Number(identity.slice(prefix.length)) : null;

/**
 * Removes spectators with no live slot, and users with no seat, and returns who stays in the table room.
 * The list comes before the roster: a person in the list had the right before connecting, so a later roster cannot miss a new seat or slot.
 */
async function reconcile(sdk: RoomServiceClient, slug: string) {
  const room = `remote-${slug}`, voice = remoteVoiceRoom(slug);
  const [inRoom, inVoice] = await Promise.all([identities(sdk, room), identities(sdk, voice)]);
  const roster = createRemoteDuelService(getDb()).mediaRosters(Date.now(), slug)[0];
  if (!roster) return null;
  const seated = new Set(roster.seated), slots = new Set(roster.slots.filter(isRemoteDuelUser));
  const noSeat = (identity: string) => { const user = userOf(identity, SEATED); return user !== null && !seated.has(user); };
  const stale = inRoom.filter(identity => { const user = userOf(identity, SPECTATOR); return (user !== null && !slots.has(user)) || noSeat(identity); });
  await Promise.all([...stale.map(identity => drop(sdk, room, identity)), ...inVoice.filter(noSeat).map(identity => drop(sdk, voice, identity))]);
  return inRoom.filter(identity => !stale.includes(identity));
}
async function bounded<T>(work: (sdk: RoomServiceClient) => Promise<T>): Promise<T | undefined> {
  const sdk = client(); if (!sdk) return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work(sdk), new Promise<undefined>(done => { timer = setTimeout(() => done(undefined), CHECK_TIMEOUT_MS); })]); }
  catch { return undefined; }
  finally { clearTimeout(timer); }
}
/** Stop watching ends the video at once. If LiveKit does not answer, the sweep removes the participant. */
export async function removeSpectatorVideo(slug: string, userId: number) {
  await bounded(sdk => drop(sdk, `remote-${slug}`, `${SPECTATOR}${userId}`));
}
/** A slot alone does not limit video: this also counts who is in the room. Only the spectator's own reconnect does not count. */
export async function admitSpectator(slug: string, userId: number) {
  const present = await bounded(sdk => reconcile(sdk, slug));
  if (!present) return;
  const others = present.filter(identity => identity !== `${SPECTATOR}${userId}`);
  remoteAssert(others.filter(identity => identity.startsWith(SPECTATOR)).length < REMOTE_SPECTATOR_CAP && others.length < REMOTE_ROOM_LIMIT,
    `This table has reached its limit of ${REMOTE_SPECTATOR_CAP} spectators. Try again soon.`, 409, "SPECTATORS_FULL");
}
/** A player or phone always gets a place. If the room is at the limit, spectators leave first. */
export async function makeRoomForPlayer(slug: string, identity: string) {
  await bounded(async sdk => {
    const present = await reconcile(sdk, slug);
    if (!present) return;
    const others = present.filter(other => other !== identity);
    const over = others.length - (REMOTE_ROOM_LIMIT - 1);
    if (over > 0) await Promise.all(others.filter(other => other.startsWith(SPECTATOR)).slice(0, over).map(other => drop(sdk, `remote-${slug}`, other)));
  });
}
const janitorKey = "__remoteSpectatorJanitor";
/** SFU discovery is the retry ledger after SQL room/pair rows have been purged. */
async function retireFinishedRooms(sdk: RoomServiceClient) {
  const rooms = await sdk.listRooms();
  // Match mediaRosters' 15-minute grace; retained history must not keep media alive.
  const live = getDb().prepare("select 1 from remote_tables where slug=? and (status!='ended' or ended_at>?)");
  const cutoff = Date.now() - 15 * 60_000;
  for (const room of rooms) {
    const match = /^remote-([a-z0-9]{8})(?:-voice)?$/.exec(room.name);
    if (!match || live.get(match[1], cutoff)) continue;
    // A failed delete leaves the SFU room discoverable on the next tick, including old-token rejoins.
    try { await sdk.deleteRoom(room.name); } catch { /* Retry from the next SFU listing. */ }
  }
}
/** Slot expiry, rollout removal and finished/deleted tables have no request of their own, so this ends their media. */
export function startSpectatorCleanup() {
  if (process.env.REMOTE_DUELS !== "1" || !client()) return;
  const root = globalThis as typeof globalThis & { [janitorKey]?: ReturnType<typeof setInterval> };
  if (root[janitorKey]) return;
  let running = false;
  root[janitorKey] = setInterval(async () => {
    if (running) return; running = true;
    try {
      const sdk = client(); if (!sdk) return;
      await retireFinishedRooms(sdk).catch(() => undefined);
      for (const { slug } of createRemoteDuelService(getDb()).mediaRosters()) await reconcile(sdk, slug).catch(() => undefined);
    } catch { /* The next tick tries again. */ }
    finally { running = false; }
  }, SWEEP_MS);
  root[janitorKey].unref?.();
}
