import Database from "better-sqlite3";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSavedDeckService } from "../../src/services/saved-decks.js";
import { deleteUserAccount } from "../../src/services/account-deletion.js";
import { migrate } from "../../src/db/index.js";
import { seedIdentity, seedUser } from "../helpers/identity.js";
import { createRemoteDuelService } from "../../src/services/remote-duels.js";
import { getRemoteGame, resolveAttack, ygoModule, remoteActionSchema, projectRemoteState, projectRemoteSpectator, type GameModule, type SeatCount, type RemoteAction, type RemoteActionProposal } from "../../src/remote/index.js";
import { remoteUndoLabel } from "../../src/remote/undo.js";
import { readRemoteState } from "../../src/remote/storage.js";
import { applyRemoteOpening } from "../../src/remote/match.js";
import { applyPatch } from "../../src/remote/delta.js";
import { mergeHistory } from "../../src/services/history-merge.js";

const databases: Database.Database[] = [];
afterEach(() => databases.splice(0).forEach(db => db.close()));
function setup() {
  const db = new Database(":memory:"); databases.push(db); db.pragma("foreign_keys = ON"); migrate(db);
  const users = ["a", "b", "c", "d"].map(key => seedUser(db, key).userId);
  const service = createRemoteDuelService(db, { dataDirectory: deckData });
  let table = service.create({ guildId: "g", userId: users[0], displayName: "A", gameId: "ygo", seatCount: 3 }, 1000);
  table = registerTestDeck(db, service, table.slug, users[0], 1000);
  return { db, users, service, table };
}

function registerTestDeck(db: Database.Database, service: ReturnType<typeof createRemoteDuelService>, slug: string, user: number, now: number) {
  const saved = createSavedDeckService(db, new Map()).create("g", user, { name: "Remote fixture", mode: "normal",
    deck: { main: Array.from({length:40},(_,i)=>i+1), extra: [], side: [] } });
  return service.selectDeck(slug, "g", user, { savedDeckId: saved.id }, now);
}

const deckData = mkdtempSync(join(tmpdir(), "remote-deck-checks-"));
mkdirSync(join(deckData, "card-scripts"));
writeFileSync(join(deckData, "strings.conf"), "");
{
  const catalog = new Database(join(deckData, "cards.cdb"));
  catalog.exec("create table datas(id integer primary key,ot integer,alias integer,setcode integer,type integer,race integer,attribute integer,atk integer default 0,def integer default 0,level integer default 1); create table texts(id integer primary key,name text,desc text)");
  const add = (id: number, name: string, type = 0x11, alias = 0) => {
    catalog.prepare("insert into datas(id,ot,alias,setcode,type,race,attribute) values(?,3,?,0,?,1,1)").run(id, alias, type);
    catalog.prepare("insert into texts values(?,?, '')").run(id, name);
    writeFileSync(join(deckData, "card-scripts", "c" + id + ".lua"), "");
  };
  for (let i = 1; i <= 100; i++) add(i, "Filler " + i);
  add(14558127, "Ash Blossom", 0x21); add(55144522, "Pot of Greed", 2);
  add(101, "Fusion", 0x41); add(102, "Link", 0x4000021);
  add(103, "Outside Domain", 0x11);
  catalog.prepare("update datas set race=2,attribute=2 where id=103").run();
  add(104, "Ash Blossom", 0x21, 14558127);
  add(33396948, "Limited Test");
  // Real printed metadata; this fixture never needs a developer engine bundle.
  const realCards: [number, string, string, number, number, number, number, number, number][] = [
    [80101899, "Trap Trick", "Banish 1 Normal Trap from your Deck, except \"Trap Trick\", and if you do, Set 1 card with the same name directly from your Deck. It can be activated this turn. You can only activate 1 Trap Card for the rest of this turn after this card resolves. You can only activate 1 \"Trap Trick\" per turn.", 4, 0, 0, 0, 0, 0],
    [70825459, "Trap Tracks", "Target 1 monster you control; destroy it, and if you do, Set 1 Normal Trap directly from your Deck, except \"Trap Tracks\". It can be activated this turn. You can only activate 1 Trap Card for the rest of this turn after this card resolves. You can only activate 1 \"Trap Tracks\" per turn.", 4, 0, 0, 0, 0, 0],
    [23898021, "Lilith, Lady of Lament", "If this card is Normal Summoned, its original ATK becomes 1000. (Quick Effect): You can Tribute 1 DARK monster; reveal 3 Normal Traps from your Deck, your opponent randomly chooses 1 for you to Set on your field, and you shuffle the rest back into your Deck. You can only use this effect of \"Lilith, Lady of Lament\" once per turn.", 33, 8, 32, 2000, 0, 3],
    [73628505, "Terraforming", "Add 1 Field Spell from your Deck to your hand.", 2, 0, 0, 0, 0, 0],
    [32807846, "Reinforcement of the Army", "Add 1 Level 4 or lower Warrior monster from your Deck to your hand.", 2, 0, 0, 0, 0, 0],
    [53582587, "Torrential Tribute", "When a monster(s) is Summoned: Destroy all monsters on the field.", 4, 0, 0, 0, 0, 0],
    [37576645, "Reckless Greed", "Draw 2 cards and skip your next 2 Draw Phases.", 4, 0, 0, 0, 0, 0],
    [10045474, "Infinite Impermanence", "Target 1 face-up monster your opponent controls; negate its effects (until the end of this turn), then, if this card was Set before activation and is on the field at resolution, for the rest of this turn all other Spell/Trap effects in this column are negated. If you control no cards, you can activate this card from your hand.", 4, 0, 0, 0, 0, 0],
    [97077563, "Call of the Haunted", "Activate this card by targeting 1 monster in your GY; Special Summon that target in Attack Position. When this card leaves the field, destroy that monster. When that monster is destroyed, destroy this card.", 131076, 0, 0, 0, 0, 0],
    [5318639, "Mystical Space Typhoon", "Target 1 Spell/Trap on the field; destroy that target.", 65538, 0, 0, 0, 0, 0],
    [14087893, "Book of Moon", "Target 1 face-up monster on the field; change that target to face-down Defense Position.", 65538, 0, 0, 0, 0, 0],
    [47355498, "Necrovalley", "All \"Gravekeeper's\" monsters gain 500 ATK/DEF. Cards in the GY cannot be banished. Negate any card effect that would move a card in the GY to a different place. Negate any card effect that changes Types or Attributes in the GY.", 524290, 0, 0, 0, 0, 0],
    [67616300, "Chicken Game", "The player with the lowest LP takes no damage. Once per turn, during the Main Phase: The turn player can pay 1000 LP, then activate 1 of these effects;\r\n● Draw 1 card.\r\n● Destroy this card.\r\n● Your opponent gains 1000 LP.\r\nNeither player can activate cards or effects in response to this effect's activation.", 524290, 0, 0, 0, 0, 0],
    [2460565, "Marauding Captain", "Monsters your opponent controls cannot target Warrior monsters for attacks, except this one. When this card is Normal Summoned: You can Special Summon 1 Level 4 or lower monster from your hand.", 33, 1, 1, 1200, 400, 3],
    [63977008, "Junk Synchron", "When this card is Normal Summoned: You can target 1 Level 2 or lower monster in your GY; Special Summon that target in Defense Position, but negate its effects.", 4129, 1, 32, 1300, 500, 3],
    [89631133, "Blue-Eyes White Dragon", "This legendary dragon is a powerful engine of destruction. Virtually invincible, very few have faced this awesome creature and lived to tell the tale.", 17, 8192, 16, 3000, 2500, 8],
    [46986414, "Dark Magician", "The ultimate wizard in terms of attack and defense.", 17, 2, 32, 2500, 2100, 7],
    [71413901, "Breaker the Magical Warrior", "If this card is Normal Summoned: Place 1 Spell Counter on it (max. 1). Gains 300 ATK for each Spell Counter on it. You can remove 1 Spell Counter from this card, then target 1 Spell/Trap on the field; destroy that target.", 33, 2, 32, 1600, 1000, 4],
    [73752131, "Skilled Dark Magician", "Each time a Spell Card is activated, place 1 Spell Counter on this card when that Spell resolves (max. 3). You can Tribute this card with 3 Spell Counters on it; Special Summon 1 \"Dark Magician\" from your hand, Deck, or GY.", 33, 2, 32, 1900, 1700, 4],
    [9156135, "Apprentice Magician", "If this card is Summoned: Target 1 face-up card on the field that you can place a Spell Counter on; place 1 Spell Counter on that target. When this card is destroyed by battle: You can Special Summon 1 Level 2 or lower Spellcaster monster from your Deck in face-down Defense Position.", 33, 2, 32, 400, 800, 2],
    [45141844, "Old Vindictive Magician", "FLIP: Target 1 monster your opponent controls; destroy that target.", 2097185, 2, 32, 450, 600, 2],
    [97268402, "Effect Veiler", "During your opponent's Main Phase (Quick Effect): You can send this card from your hand to the GY, then target 1 Effect Monster your opponent controls; negate the effects of that face-up monster your opponent controls, until the end of this turn.", 4129, 2, 16, 0, 0, 1],
    [31560081, "Magician of Faith", "FLIP: Target 1 Spell in your GY; add that target to your hand.", 2097185, 2, 16, 300, 400, 1],
    [423585, "Summoner Monk", "While this card is face-up on the field, it cannot be Tributed. If this card is Normal or Flip Summoned: Change this card to Defense Position. Once per turn: You can discard 1 Spell; Special Summon 1 Level 4 monster from your Deck, but that monster cannot attack this turn.", 33, 2, 32, 800, 1600, 4],
  ];
  for (const [id, name, text, type, race, attribute, atk, def, level] of realCards) {
    add(id, name, type);
    catalog.prepare("update datas set race=?,attribute=?,atk=?,def=?,level=? where id=?").run(race,attribute,atk,def,level,id);
    catalog.prepare("update texts set desc=? where id=?").run(text,id);
  }
  add(25311006, "Triple Tactics Talent", 2);
  add(900001, "Man with the Mark", 33);
  add(900002, "GY Recovery", 2);
  add(900003, "Banish Recovery", 2);
  add(69299029, "Treasures of the Kings", 524290);
  add(29762407, "Temple of the Kings", 131074);
  add(97522863, "The Man with the Mark", 33);
  catalog.prepare("update texts set desc=? where id=97522863").run('If this card is Normal or Special Summoned: You can take 1 "Temple of the Kings", or 1 Spell/Trap that mentions it, from your Deck and either add it to your hand or send it to the GY. You can only use this effect of "The Man with the Mark" once per turn. While you control "Temple of the Kings", this card and "Apophis" monsters you control cannot be destroyed by battle or card effects. "Temple of the Kings" you control cannot be destroyed by card effects.');
  catalog.prepare("update texts set desc=? where id=69299029").run('When this card is activated: You can Set 1 "Apophis" Trap from your Deck. This card\'s name becomes "Temple of the Kings" while in the Field Zone. Once per turn, if you have 2 or more Set cards on your field, or a Trap in your GY: You can add 1 monster that mentions "Temple of the Kings" from your Deck to your hand. You can only activate 1 "Treasures of the Kings" per turn.');
  catalog.prepare("update texts set desc=? where id=900001").run('Add 1 "Treasures of the Kings" or "Temple of the Kings" from your Deck to your hand.');
  catalog.prepare("update texts set desc=? where id=900002").run('Add 1 Spell from your GY to your hand.');
  catalog.prepare("update texts set desc=? where id=900003").run('Add 1 Spell from your banishment to your hand.');
  catalog.close();
}
afterAll(() => rmSync(deckData, { recursive: true, force: true }));
function deckSession(format: "normal" | "domain" | "genesys" | "genesys-domain" = "domain", solo = true, serviceOptions: { openingRoll?: boolean } = {}) {
  const { db, users } = setup();
  const service = createRemoteDuelService(db, { dataDirectory: deckData, openFormats: ["normal", "domain", "genesys", "genesys-domain"], ...serviceOptions });
  let room = service.create({ guildId: "g", userId: users[0], displayName: "Sulman", gameId: "ygo", seatCount: 2, solo, format }, 2000);
  const decks = createSavedDeckService(db, new Map());
  const save = (main = Array.from({ length: format.includes("domain") ? 60 : 40 }, (_, i) => i + 1), extra: number[] = [], owner = users[0]) =>
    decks.create("g", owner, { name: "Registered", mode: format.includes("domain") ? "domain" : "normal",
      deck: { main, extra, side: [], ...(format.includes("domain") ? { deckMaster: 100 } : {}) } });
  const select = (id: number | null, seat = 0) => room = service.selectDeck(room.slug, "g", users[0], { savedDeckId: id, seat }, 2001);
  const start = () => { service.ready(room.slug, "g", users[0], true, 2002); room = service.start(room.slug, "g", users[0], 2003); };
  let n = 0, shift = 0;
  const act = (input: Record<string, unknown>) => room = service.act(room.slug, "g", users[0], { baseSeq: room.lastSeq,
    action: remoteActionSchema.parse({ actorSeat: 0, idempotencyKey: "check-" + (++n), ...input }) }, 2100 + n + shift);
  const place = (ref: string, zone = "monster", slot = 1, cardId = 14558127) => act({ type: "twin.place", seat: 0, zone, anotherCopy:true,copyProof:{simultaneousQuads:Math.max(2,room.state.seats[0].twin.length+1),at:room.state.updatedAt},card: { ref, cardId, slot } });
  /** Moves the server clock: the sweep handles any timer that is due, like the 5-second countdown before the next game. */
  const wait = (at: number) => { shift = Math.max(shift, at - 2100 - n); service.sweepIdle(at); room = service.get(room.slug, "g", users[0]); };
  return { db, users, service, save, select, start, act, place, wait, get room() { return room; } };
}

it('requires the seat owner to confirm tournament LP zero and keeps pending results undoable', () => {
  for (const tournament of [undefined, false]) {
    const initial = ygoModule.initialState({seatCount:2, bestOf:1, tournament});
    const ended = ygoModule.reduce(initial, {type:'lp.change', actorSeat:0, seat:1, delta:-8000, reason:'damage', idempotencyKey:'casual-zero'});
    expect(ended).toMatchObject({ended:true, match:{phase:'done', games:[{reason:'lp', winnerSeat:0}]}});
  }
  let state = ygoModule.initialState({seatCount:2, bestOf:3, firstSeat:1, tournament:true}), serial = 0;
  const step = (input:Record<string,unknown>) => state = ygoModule.reduce(state, remoteActionSchema.parse({
    actorSeat:0, idempotencyKey:`tournament-lp-${++serial}`, at:serial, ...input,
  }));
  step({type:'twin.place', actorSeat:1, seat:1, zone:'monster', card:{ref:'private-card', cardId:1, name:'Secret', faceUp:false, slot:1}});
  const zero = () => {
    step({type:'lp.change', seat:1, delta:-8000, reason:'damage'});
    expect(state).toMatchObject({tournament:true, ended:false, winnerSeat:null, match:{phase:'duel', games:[],
      pendingResult:{id:state.undo!.actionId, winnerSeat:0, confirmed:[0]}}});
    expect(state.seats[1]).toMatchObject({resources:{lp:0}, eliminated:false, twin:[{cardId:1}]});
    expect(projectRemoteState(state,new Set([0])).seats[1].twin[0]).not.toHaveProperty('cardId');
    return state.match.pendingResult!.id;
  };
  let declarationId = zero();
  expect(() => step({type:'match.confirm', declarationId, accept:true})).toThrow(/confirm|owner/i);
  step({type:'undo', targetActionId:declarationId});
  expect(state.seats[1].resources.lp).toBe(8000);
  expect(state.match.pendingResult).toBeUndefined();
  expect(() => step({type:'match.confirm', actorSeat:1, declarationId, accept:true})).toThrow(/pending/i);

  declarationId = zero();
  step({type:'match.confirm', actorSeat:1, declarationId, accept:false});
  expect(state.ended).toBe(false); expect(state.match.pendingResult).toBeUndefined();
  step({type:'undo', targetActionId:declarationId});
  expect(state.seats[1].resources.lp).toBe(8000);

  declarationId = zero();
  step({type:'lp.change', actorSeat:1, seat:1, delta:500, reason:'correction'});
  const correctionId = state.undo!.actionId;
  expect(state.match.pendingResult).toBeUndefined();
  expect(() => step({type:'match.confirm', actorSeat:1, declarationId, accept:true})).toThrow(/pending/i);
  step({type:'undo', actorSeat:1, targetActionId:correctionId});
  expect(state.match.pendingResult?.id).toBe(declarationId);
  step({type:'phase.set', actorSeat:1, phase:'main1'});
  step({type:'match.confirm', actorSeat:1, declarationId, accept:true});
  expect(state).toMatchObject({ended:true, match:{phase:'result', games:[{reason:'lp', winnerSeat:0}]}});
  const confirmationId = state.undo!.actionId;
  expect(() => step({type:'undo', targetActionId:declarationId})).toThrow(/confirmation/i);
  step({type:'undo', actorSeat:1, targetActionId:confirmationId});
  expect(state.match.pendingResult?.id).toBe(declarationId);
  step({type:'undo', targetActionId:declarationId});
  expect(state).toMatchObject({ended:false, phase:'main1', match:{phase:'duel', games:[]}});
  expect(state.match.pendingResult).toBeUndefined(); expect(state.seats[1].resources.lp).toBe(8000);

  declarationId = zero();
  step({type:'match.confirm', actorSeat:1, declarationId, accept:true});
  step({type:'match.continue'});
  step({type:'match.first', actorSeat:1, seatGoesFirst:1});
  step({type:'side.ready', seat:0}); step({type:'side.ready', actorSeat:1, seat:1});
  expect(state).toMatchObject({tournament:true, ended:false, match:{phase:'duel'}});
  step({type:'lp.change', actorSeat:1, seat:1, delta:-8000, reason:'own damage'});
  expect(state).toMatchObject({ended:true, match:{phase:'done', games:[{reason:'lp'}, {reason:'lp'}]}});
  expect(state.match.pendingResult).toBeUndefined();
  step({type:'undo', actorSeat:1, targetActionId:state.undo!.actionId});
  step({type:'player.concede', actorSeat:1});
  expect(state).toMatchObject({ended:true, match:{phase:'done', games:[{reason:'lp'}, {reason:'concede'}]}});
  expect(state.match.pendingResult).toBeUndefined();

  // A later correction or concession must not become a stale LP request when
  // another seat undoes the elimination that originally cleared the request.
  for (const concede of [false,true]) {
    let ffa = ygoModule.initialState({seatCount:3,tournament:true});
    const apply = (input:Record<string,unknown>) => ffa = ygoModule.reduce(ffa,remoteActionSchema.parse({
      actorSeat:0,idempotencyKey:`ffa-lp-${++serial}`,at:serial,...input,
    }));
    apply({type:'lp.change',seat:1,delta:-8000,reason:'damage'});
    apply({type:'player.concede',actorSeat:2});
    const concessionId = ffa.undo!.actionId;
    if (concede) apply({type:'player.concede',actorSeat:1});
    else apply({type:'lp.change',actorSeat:1,seat:1,delta:500,reason:'correction'});
    apply({type:'undo',actorSeat:2,targetActionId:concessionId});
    expect(ffa.match.pendingResult).toBeUndefined();
  }
});

it('preserves a tournament LP request when another FFA seat is eliminated and recomputes the winner on confirmation', () => {
  for (const concede of [false, true]) {
    let state = ygoModule.initialState({seatCount:3, tournament:true}), serial = 0;
    const step = (input:Record<string,unknown>) => state = ygoModule.reduce(state, remoteActionSchema.parse({
      actorSeat:0, idempotencyKey:`ffa-pending-lp-${++serial}`, at:serial, ...input,
    }));
    step({type:'lp.change', seat:1, delta:-8000, reason:'damage'});
    const pending = structuredClone(state.match.pendingResult!);
    expect(pending).toMatchObject({lpSeat:1, winnerSeat:null});

    if (concede) step({type:'player.concede', actorSeat:2});
    else step({type:'lp.change', actorSeat:2, seat:2, delta:-8000, reason:'own damage'});
    expect(state.seats[2].eliminated).toBe(true);
    expect(state.seats[1]).toMatchObject({resources:{lp:0}, eliminated:false});
    expect(state.match.pendingResult).toEqual(pending);
    expect(state.ended).toBe(false);

    step({type:'match.confirm', actorSeat:1, declarationId:pending.id, accept:true});
    expect(state.seats[1].eliminated).toBe(true);
    expect(state.match.pendingResult).toBeUndefined();
    expect(state).toMatchObject({ended:true, winnerSeat:0,
      match:{phase:'done', winnerSeat:0, games:[{reason:'lp', winnerSeat:0}]}});
  }
});

it('rolls a public opening die for game 1: the winner chooses who goes first, and a missed choice means the winner goes first', () => {
  for (const choice of ['second', 'timeout'] as const) {
    const s = deckSession('normal', false, { openingRoll: true });
    s.select(s.save().id);
    s.service.join(s.room.slug, 'g', s.users[1], 'Opponent', 1, 2001);
    s.service.ready(s.room.slug, 'g', s.users[1], true, 2002); s.start();
    let room = s.room;
    const opening = room.state.match.opening!;
    const last = opening.rounds.at(-1)!;
    expect(opening.rounds.every(round => round.every(roll => roll === null || (roll >= 1 && roll <= 6)))).toBe(true);
    expect(last.filter(roll => roll === Math.max(...last.filter(r => r !== null) as number[]))).toHaveLength(1);
    expect(last[opening.winnerSeat]).toBe(Math.max(...last.filter(r => r !== null) as number[]));
    expect(opening).toMatchObject({ startedAt: 2003, deadline: 2003 + opening.rounds.length * 3000 + 20000 });
    expect(opening.chosenSeat).toBeUndefined();
    // Everyone, spectators included, sees the same roll in the public start event.
    const startEvent = (room: { events: { action: { type: string } }[] }) => room.events.find(e => e.action.type === 'table.started')!.action;
    expect(startEvent(s.service.get(s.room.slug, 'g', s.users[1]))).toMatchObject({ opening });
    expect(startEvent(s.service.spectatorSnapshot(s.room.slug, 'g'))).toMatchObject({ opening });
    const winner = opening.winnerSeat, loser = 1 - winner;
    const actAs = (seat: number, input: Record<string, unknown>) => room = s.service.act(room.slug, 'g', s.users[seat],
      { baseSeq: room.lastSeq, action: remoteActionSchema.parse({ actorSeat: seat, idempotencyKey: `open-${seat}-${input.type}-${room.lastSeq}`, ...input }) }, 2100 + room.lastSeq);
    // Play waits for the choice, and only the winner may choose.
    expect(() => actAs(winner, { type: 'log.note', text: 'too early' })).toThrow(/choose who goes first/);
    expect(() => actAs(loser, { type: 'match.first', seatGoesFirst: loser })).toThrow(/die-roll winner/);
    if (choice === 'second') {
      actAs(winner, { type: 'match.first', seatGoesFirst: loser });
      expect(room.state).toMatchObject({ turnSeat: loser, startedSeats: [loser], match: { opening: { chosenSeat: loser } } });
      expect(() => actAs(winner, { type: 'match.first', seatGoesFirst: winner })).toThrow();
      actAs(loser, { type: 'log.note', text: 'game on' });
    } else {
      expect(s.service.sweepIdle(opening.deadline - 1)).toEqual([]);
      expect(s.service.sweepIdle(opening.deadline)).toHaveLength(1);
      room = s.service.get(room.slug, 'g', s.users[0]);
      expect(room.state).toMatchObject({ turnSeat: winner, startedSeats: [winner], match: { opening: { chosenSeat: winner } } });
    }
    expect(s.service.replay(room.slug, 'g', s.users[0])).toEqual(s.service.get(room.slug, 'g', s.users[0]).state);
  }
  // A winner who left the game hands the choice, and the default, to the next living seat by roll order.
  let three = ygoModule.initialState({ seatCount: 3, bestOf: 1 });
  applyRemoteOpening(three, { rounds: [[3, 6, 5]], winnerSeat: 1, startedAt: 1000, deadline: 24000 });
  three = ygoModule.reduce(three, { type: 'player.concede', actorSeat: 1, idempotencyKey: 'out', at: 2000 });
  const first = (actorSeat: number, seatGoesFirst: number) => ygoModule.reduce(three, { type: 'match.first', actorSeat, seatGoesFirst, idempotencyKey: `f-${actorSeat}-${seatGoesFirst}`, at: 3000 });
  expect(() => first(1, 1)).toThrow(/die-roll winner/);
  expect(() => first(0, 0)).toThrow(/die-roll winner/);
  expect(() => first(2, 1)).toThrow(/out of the game/);
  expect(first(2, 0)).toMatchObject({ turnSeat: 0, match: { opening: { chosenSeat: 0 } } });
  expect(ygoModule.reduce(three, { type: 'side.timeout', actorSeat: 0, idempotencyKey: 'late', at: 24000 })).toMatchObject({ turnSeat: 2, match: { opening: { chosenSeat: 2 } } });
});

it('logs detection mode per seat as a public fact without changing the board or private information', () => {
  const s = deckSession('normal',false);
  s.select(s.save().id);
  s.service.join(s.room.slug,'g',s.users[1],'Opponent',1,2001);
  s.service.ready(s.room.slug,'g',s.users[1],true,2002); s.start();
  s.act({type:'twin.place',seat:0,zone:'monster',card:{ref:'secret-card',cardId:1,name:'Secret',faceUp:false,slot:1}});
  const before = s.service.snapshot(s.room.slug,'g').state;
  const input = {baseSeq:s.room.lastSeq, action:remoteActionSchema.parse({
    type:'detection.mode', actorSeat:0, mode:'tap', reason:'slow-offer', idempotencyKey:'detection-switch',
  })};
  const switched = s.service.act(s.room.slug,'g',s.users[0],input,2200);
  expect(switched.lastSeq).toBe(input.baseSeq+1);
  expect(s.service.act(s.room.slug,'g',s.users[0],input,2201).lastSeq).toBe(switched.lastSeq);
  const raw = s.service.snapshot(s.room.slug,'g');
  expect(raw.state.detection).toEqual({0:{mode:'tap',at:2200}});
  expect({...raw.state,detection:before.detection,updatedAt:before.updatedAt}).toEqual(before);
  expect(s.service.replay(s.room.slug,'g',s.users[0])).toEqual(switched.state);
  const event = raw.events.at(-1)!;
  expect(event).toMatchObject({actorSeat:0,userId:s.users[0],at:2200,action:{type:'detection.mode',mode:'tap',reason:'slow-offer'}});
  expect(JSON.parse((s.db.prepare('select action_json from remote_events where idempotency_key=?').get(event.id) as {action_json:string}).action_json)).toEqual(event.action);
  expect(s.service.get(s.room.slug,'g',s.users[1]).events.at(-1)?.action).toEqual(event.action);
  const spectator = projectRemoteSpectator(raw);
  expect(spectator.state.detection).toEqual(raw.state.detection);
  expect(spectator.events.at(-1)?.action).toEqual(event.action);
  expect(spectator.state.seats[0].twin[0]).not.toHaveProperty('cardId');
  expect(spectator.state.deckChecks.registrations).toEqual({});
  const opponent = s.service.get(s.room.slug,'g',s.users[1]);
  expect(opponent.state.detection).toEqual(raw.state.detection);
  expect(opponent.state.seats[0].twin[0]).not.toHaveProperty('cardId');
  expect(opponent.state.deckChecks.registrations[0]).toBeUndefined();
  for (const mode of ['auto','tap','manual']) for (const reason of ['player','slow-offer','start']) {
    expect(remoteActionSchema.safeParse({...input.action,mode,reason}).success).toBe(true);
  }
  for (const extra of [{mode:'unknown'},{reason:'unknown'},{seat:1}]) {
    expect(remoteActionSchema.safeParse({...input.action,...extra}).success).toBe(false);
  }
  expect(() => s.service.act(s.room.slug,'g',s.users[1],{
    baseSeq:switched.lastSeq,action:{...input.action,idempotencyKey:'spoof-mode'},
  },2202)).toThrow(/actor seat/i);
  const own = s.service.act(s.room.slug,'g',s.users[1],{baseSeq:switched.lastSeq,
    action:remoteActionSchema.parse({...input.action,actorSeat:1,mode:'auto',reason:'start',idempotencyKey:'other-mode'})},2203);
  expect(own.events.at(-1)).toMatchObject({actorSeat:1,action:{type:'detection.mode',mode:'auto',reason:'start'}});
  expect(own.state.detection).toEqual({0:{mode:'tap',at:2200},1:{mode:'auto',at:2203}});
});

it.each(['auto','tap','manual'] as const)('ignores repeated %s detection starts while retaining explicit reports and mode changes', mode => {
  const s = deckSession('normal');
  s.select(s.save().id); s.start();
  expect(s.room.state.detection).toEqual({});
  s.act({type:'detection.mode',mode,reason:'start'});
  const started = s.room;
  s.act({type:'detection.mode',mode,reason:'start'});
  expect(s.room.lastSeq).toBe(started.lastSeq);
  expect(s.room.state).toEqual(started.state);
  expect(s.room.lastEventAt).toBe(started.lastEventAt);
  expect(s.room.events.filter(e=>e.action.type==='detection.mode')).toHaveLength(1);
  for (const reason of ['player','slow-offer']) {
    const seq = s.room.lastSeq;
    s.act({type:'detection.mode',mode,reason});
    expect(s.room.lastSeq).toBe(seq+1);
    expect(s.room.state.detection).toEqual({0:{mode,at:s.room.state.updatedAt}});
  }
  const reported = s.room;
  s.act({type:'detection.mode',mode,reason:'start'});
  expect(s.room.lastSeq).toBe(reported.lastSeq);
  expect(s.room.state).toEqual(reported.state);
  const changedMode = mode==='auto' ? 'manual' : 'auto';
  s.act({type:'detection.mode',mode:changedMode,reason:'start'});
  expect(s.room.lastSeq).toBe(reported.lastSeq+1);
  expect(s.room.state.detection).toEqual({0:{mode:changedMode,at:s.room.state.updatedAt}});
  expect(s.service.replay(s.room.slug,'g',s.users[0])).toEqual(s.room.state);
});

it.each([false,true])('preserves intervening detection reports when undoing a coalesced camera placement (legacy replay: %s)', legacyReplay => {
  const s = deckSession('normal');
  s.select(s.save().id); s.start();
  s.act({type:'detection.mode',actorSeat:1,mode:'auto',reason:'start'});
  s.act({type:'twin.place',seat:0,zone:'monster',source:'auto',card:{ref:'camera-card',cardId:1,slot:1}});
  const targetActionId = s.room.state.undo!.actionId;
  s.act({type:'detection.mode',actorSeat:1,mode:'manual',reason:'player'});
  const detection = s.room.state.detection;
  s.act({type:'card.identified',seat:0,cardRef:'camera-card',cardId:2,zone:'monster',slot:1,source:'auto'});
  expect(s.room.state.undo!.actionId).toBe(targetActionId);
  const stored = s.db.prepare('select state_json from remote_tables where slug=?').get(s.room.slug) as {state_json:string};
  const undone = legacyReplay
    ? ygoModule.reduce(readRemoteState(s.db,stored.state_json),{type:'undo',actorSeat:0,targetActionId,idempotencyKey:'legacy-camera-undo',at:2200},{replay:true})
    : s.act({type:'undo',targetActionId}).state;
  expect(undone.seats[0].twin).toEqual([]);
  expect(undone.detection).toEqual(detection);
  if (!legacyReplay) expect(s.service.replay(s.room.slug,'g',s.users[0])).toEqual(s.room.state);
});

it('reloads detection modes from persisted state after their events leave the public event window', () => {
  const s = deckSession('normal');
  s.select(s.save().id); s.start();
  s.act({type:'detection.mode',mode:'manual',reason:'start'});
  s.act({type:'detection.mode',actorSeat:1,mode:'tap',reason:'start'});
  const detection = s.room.state.detection;
  for (let i=0;i<51;i++) s.act({type:'log.note',text:`Later event ${i}`});
  const reloaded = createRemoteDuelService(s.db,{dataDirectory:deckData});
  const room = reloaded.get(s.room.slug,'g',s.users[0]);
  expect(room.events).toHaveLength(50);
  expect(room.events.some(e=>e.action.type==='detection.mode')).toBe(false);
  expect(room.state.detection).toEqual(detection);
  const stored = s.db.prepare('select state_json from remote_tables where slug=?').get(room.slug) as {state_json:string};
  expect(JSON.parse(stored.state_json).detection).toEqual(detection);
  const views = reloaded.views(room.slug,'g',{userIds:[s.users[0]],spectator:true,publicView:true});
  for (const state of [views.players.get(s.users[0])!.state,views.spectator!.state,views.publicView!.state,
    reloaded.snapshot(room.slug,'g').state,reloaded.spectatorSnapshot(room.slug,'g').state,
    reloaded.replay(room.slug,'g',s.users[0])]) expect(state.detection).toEqual(detection);
});

it('preserves detection modes through siding and the next game in live state and replay', () => {
  const s = deckSession('normal');
  s.select(s.save().id);
  s.service.configure(s.room.slug,'g',s.users[0],{bestOf:3},2001); s.start();
  s.act({type:'detection.mode',mode:'manual',reason:'start'});
  s.act({type:'detection.mode',actorSeat:1,mode:'auto',reason:'start'});
  const detection = s.room.state.detection;
  s.act({type:'player.concede',actorSeat:1});
  s.act({type:'match.continue'});
  expect(s.room.state.detection).toEqual(detection);
  s.act({type:'match.first',actorSeat:1,seatGoesFirst:1});
  s.act({type:'side.ready',seat:0});
  s.wait(s.room.state.match.siding!.startAt!);
  expect(s.room.state.match).toMatchObject({phase:'duel',games:[{winnerSeat:0}]});
  expect(s.room.state.ended).toBe(false);
  expect(s.room.state.detection).toEqual(detection);
  expect(s.service.replay(s.room.slug,'g',s.users[0])).toEqual(s.room.state);
  const seq = s.room.lastSeq;
  s.act({type:'detection.mode',mode:'manual',reason:'start'});
  expect(s.room.lastSeq).toBe(seq);
});

it('resolves the real Mark search clause including Spell/Traps that mention the named card', async () => {
  const {createRemoteDeckRules}=await import('../../src/services/remote-deck-rules.js');
  const {createInsightCatalog}=await import('../../src/services/card-insight-catalog.js');
  const {deriveRemoteEffectPlans,remoteEffectMatches}=await import('../../src/remote/effect-filters.js');
  const {CardTags,fillDefaults}=await import('../../src/cards/effects/tags.js');
  const {db}=setup(), catalog=createInsightCatalog(db,deckData);
  try {
    const mark=catalog.candidate(97522863)!.card, treasure=catalog.candidate(69299029)!.card, temple=catalog.candidate(29762407)!.card;
    // The live indexed reading retains only the first alternative; printed text must supply the other.
    const tags=CardTags.parse(fillDefaults({summary:'Search Temple or its support',effects:[{timing:'trigger',actions:[{verb:'add_to_hand',player:'you',from:['deck'],what:{names:['Temple of the Kings']}}]}]}));
    for(const reading of [undefined,tags]) {
      const plan=deriveRemoteEffectPlans(mark,reading).find(p=>p.destination==='hand')!;
      expect(remoteEffectMatches(plan,temple)).toBe(true);
      expect(remoteEffectMatches(plan,treasure)).toBe(true);
      expect(remoteEffectMatches(plan,mark)).toBe(false); // It mentions Temple, but is a monster.
      expect(remoteEffectMatches(plan,{...mark,archetype:'Temple of the Kings'})).toBe(false);
      expect(remoteEffectMatches(plan,{...treasure,id:99,name:'Unrelated Spell',text:'Draw 1 card.'})).toBe(false);
    }
    const rules=createRemoteDeckRules(db,deckData);
    expect(rules.effect({cardId:97522863},[69299029,29762407]).plans.find(p=>p.destination==='hand')!.pool.map(c=>c.cardId).sort()).toEqual([29762407,69299029]);
    const recovery=deriveRemoteEffectPlans({...treasure,text:'Add 1 Spell/Trap that mentions "Temple of the Kings" from your GY to your hand.'})[0];
    expect(remoteEffectMatches(recovery,treasure)).toBe(true);
    expect(remoteEffectMatches(recovery,{...treasure,text:''})).toBe(false);
  } finally {catalog.close();}
});

it('resolves unregistered Deck searches and publishes a held add with the table privacy rule', async () => {
  const {searchCandidates,remoteHandReadDecision}=await import('../../src/remote/index.js');
  for(const showCardsSetFromDeck of [true,false]) {
    const s=deckSession('normal',false);
    s.service.configure(s.room.slug,'g',s.users[0],{showCardsSetFromDeck},2000);
    s.service.join(s.room.slug,'g',s.users[1],'Opponent',1,2001);
    s.service.ready(s.room.slug,'g',s.users[1],true,2002);s.start();
    expect(s.room.state.deckChecks.registrations[0]).toBeUndefined();
    // Seeing a copy outside Deck is not evidence that an unregistered Deck has no others.
    s.act({type:'twin.place',seat:0,zone:'graveyard',card:{ref:'seen-temple',cardId:29762407}});
    s.act({type:'twin.place',seat:0,zone:'monster',card:{ref:'mark',cardId:97522863}});
    const seq=s.room.lastSeq;
    expect(s.service.searchCandidates(s.room.slug,'g',s.users[0],0,97522863).map(c=>c.cardId).sort()).toEqual([29762407,69299029]);
    expect(s.service.get(s.room.slug,'g',s.users[0]).lastSeq).toBe(seq);
    s.act({type:'effect.activated',source:{cardId:97522863,cardRef:'mark'}});
    expect(searchCandidates(s.room.state,0,97522863).map(c=>c.cardId).sort()).toEqual([29762407,69299029]);
    const proposal=remoteHandReadDecision(s.room.state,0,{cardId:69299029,id:'held-treasure',at:s.room.state.updatedAt+1})!;
    expect(proposal).toMatchObject({type:'hand.add',cardId:69299029,source:'deck',by:{cardId:97522863}});
    s.act(proposal);
    expect(s.room.state.seats[0]).toMatchObject({handCount:5,knownHand:[{cardId:69299029,source:'deck',by:{cardId:97522863}}]});
    expect(s.room.state.seats[0].deckCount).toBeUndefined();
    const opponent=s.service.snapshot(s.room.slug,'g',s.users[1]);
    expect(opponent.state.seats[0].knownHand).toHaveLength(showCardsSetFromDeck?1:0);
    expect(opponent.state.seats[0].handCount).toBe(5);
    if(showCardsSetFromDeck)expect(opponent.events.at(-1)!.messages!.join(' ')).toContain('Treasures of the Kings');
    else expect(JSON.stringify(opponent)).not.toContain('69299029');
    expect(s.service.replay(s.room.slug,'g',s.users[0])).toEqual(s.room.state);
    s.act({type:'undo',targetActionId:s.room.state.undo!.actionId});
    expect(s.room.state.seats[0].knownHand).toEqual([]);
  }
});

it('keeps opening draws and plays before turn changes while canceled camera placeholders refund their play', async () => {
  const s=deckSession('normal');s.start();
  expect(s.room.state.seats.map(seat=>seat.handCount)).toEqual([5,5]);
  s.act({type:'hand.draw',count:1});
  expect(s.room.state.seats[0].handCount).toBe(6);
  s.act({type:'twin.place',seat:0,zone:'monster',source:'auto',card:{ref:'mark',cardId:97522863,slot:3}});
  expect(s.room.state.seats[0].handCount).toBe(5);
  for(let i=0;i<6;i++) {
    const before=s.room.state.seats[0].handCount;
    s.act({type:'twin.place',seat:0,zone:'spell-trap',source:'auto',card:{ref:'placeholder-'+i,faceUp:true,slot:2}});
    const placed=structuredClone(s.room.state);
    s.act({type:'twin.remove',seat:0,cardRef:'placeholder-'+i});
    expect(s.room.state.seats[0].handCount).toBe(before);
    if(i===0) {
      const event=s.room.events.at(-1)!;
      const historic=ygoModule.reduce(placed,event.action as RemoteAction,{...event.effects,replay:true,handCountCorrections:undefined});
      expect(historic.seats[0].handCount).toBe(before!-1);
      s.act({type:'undo',targetActionId:event.id});expect(s.room.state.seats[0].handCount).toBe(before!-1);
      s.act({type:'twin.remove',seat:0,cardRef:'placeholder-'+i});expect(s.room.state.seats[0].handCount).toBe(before);
    }
  }
  s.act({type:'hand.add',source:'deck',cardId:69299029});expect(s.room.state.seats[0].handCount).toBe(6);
  s.act({type:'turn.end'});expect(s.room.state.seats.map(seat=>seat.handCount)).toEqual([6,6]);
  expect(s.room.state.seats[0].deckCount).toBeUndefined();
  expect(s.service.replay(s.room.slug,'g',s.users[0])).toEqual(s.room.state);
  const custom=deckSession('normal');
  custom.service.configure(custom.room.slug,'g',custom.users[0],{rules:{startingHand:7}},2000);custom.start();
  expect(custom.room.state.seats.map(seat=>seat.handCount)).toEqual([7,7]);
  custom.act({type:'twin.place',seat:0,zone:'monster',card:{ref:'first-play',cardId:97522863}});
  custom.act({type:'hand.draw',count:2});expect(custom.room.state.seats[0].handCount).toBe(8);
  expect(custom.service.replay(custom.room.slug,'g',custom.users[0])).toEqual(custom.room.state);
});

describe("remote deck registration and live checks", () => {
  it("slides recent field cards and creates new copies without an origin prompt", () => {
    const s = deckSession("normal"); s.start();
    const code = 89631133;
    let at = 3000, serial = 0;
    const act = (input: Record<string, unknown>) => s.service.act(s.room.slug, "g", s.users[0], {
      baseSeq: s.service.snapshot(s.room.slug, "g", s.users[0]).table.lastSeq,
      action: remoteActionSchema.parse({ actorSeat: 0, seat: 0, idempotencyKey: `origin-${++serial}`, ...input }),
    }, at += 100);
    const room = () => s.service.snapshot(s.room.slug, "g", s.users[0]);
    const twins = () => room().state.seats[0].twin;
    const place = (ref: string, zone: string, slot?: number, extra: Record<string, unknown> = {}) => act({
      type: "twin.place", zone, source: "auto",
      card: { ref, cardId: code, name: "Blue-Eyes White Dragon", ...(slot ? { slot } : {}) }, ...extra,
    });
    const replay = () => {
      expect(room().state.twinConfirmation).toBeUndefined();
      expect(room().state.twinConfirmationQueue).toBeUndefined();
      expect(s.service.replay(s.room.slug, "g", s.users[0])).toEqual(room().state);
    };
    // E, then B: one new card, followed by a recent slide.
    place("blue", "monster", 5);
    place("slide-quad", "monster", 4);
    expect(twins()).toMatchObject([{ ref: "blue", slot: 4, zone: "monster" }]); replay();
    act({ type: "twin.place", zone: "graveyard", card: { ref: "older-gy", cardId: 46986414 } });
    act({ type: "twin.move", cardRef: "blue", zone: "hand", source: "auto" });
    place("pile-quad", "graveyard");
    expect(twins().filter(c => c.zone === "graveyard").map(c => c.ref)).toEqual(["older-gy", "blue"]); replay();
    // D: new X while X is in GY creates another card, without a prompt.
    place("return-quad", "monster", 4);
    expect(twins().find(c => c.ref === "blue")?.zone).toBe("graveyard");
    expect(twins().find(c => c.ref === "return-quad")).toMatchObject({ zone: "monster", slot: 4 }); replay();
    // A: two simultaneous quads create a copy even with an X in GY.
    place("second", "monster", 3, { copyProof: { simultaneousQuads: 2, at } });
    expect(twins().filter(c => c.cardId === code)).toHaveLength(3); replay();
    act({ type: "twin.move", cardRef: "second", zone: "banished", source: "auto" });
    // B wins over the matching GY/banish cards.
    act({ type: "twin.move", cardRef: "return-quad", zone: "hand", source: "auto" });
    place("recent-slide", "monster", 2);
    expect(twins().find(c => c.ref === "return-quad")).toMatchObject({ zone: "monster", slot: 2 });
    expect(twins().find(c => c.ref === "second")?.zone).toBe("banished"); replay();
    // C: a field departure outside the 2.5-second move window is a new copy.
    act({ type: "twin.move", cardRef: "return-quad", zone: "hand", source: "auto" });
    at += 2501;
    place("later-copy", "monster", 1);
    expect(twins().find(c => c.ref === "return-quad")?.zone).toBe("hand");
    expect(twins().find(c => c.ref === "later-copy")).toMatchObject({ zone: "monster", slot: 1 });
    expect(room().state.deckChecks.instances.filter(i => i.code === code)).toHaveLength(4); replay();
    // Revealing an unknown new Set also preserves the older hand and pile copies.
    act({type:"twin.place",zone:"monster",card:{ref:"unknown-set",slot:3,faceUp:false}});
    act({type:"twin.flip",cardRef:"unknown-set",faceUp:true,cardId:code,name:"Blue-Eyes White Dragon"});
    expect(twins().find(c=>c.ref==="return-quad")?.zone).toBe("hand");
    expect(twins().find(c=>c.ref==="blue")?.zone).toBe("graveyard");
    expect(room().state.deckChecks.instances.filter(i=>i.code===code)).toHaveLength(5); replay();
    // A drawer correction moves a specific pile card without asking its origin.
    act({ type: "twin.move", cardRef: "blue", zone: "monster", slot: 5 });
    expect(twins().find(c => c.ref === "blue")).toMatchObject({ zone: "monster", slot: 5 }); replay();
    // Recorded versions keep their original rules.
    const oldPlace = (ref: string, slot: number) => remoteActionSchema.parse({ type: "twin.place", actorSeat: 0, seat: 0, zone: "monster", card: { ref, slot, cardId: code }, idempotencyKey: ref, at: 1 });
    const legacy = ygoModule.reduce(ygoModule.reduce(ygoModule.initialState({seatCount:2}), oldPlace("old-a",1), {replay:true,twinPlacementGuard:1}), oldPlace("old-b",2), {replay:true,twinPlacementGuard:1});
    expect(legacy.twinConfirmation).toMatchObject({cardRef:"old-b",existingRefs:["old-a"]});
    const pile = ygoModule.reduce(ygoModule.initialState({seatCount:2}), remoteActionSchema.parse({...oldPlace("old-pile",1),zone:"graveyard"}), {replay:true,twinPlacementGuard:2});
    expect(ygoModule.reduce(pile,oldPlace("old-return",2),{replay:true,twinPlacementGuard:2}).twinConfirmation?.cardRef).toBe("old-return");
  });
  it("defaults Deck choice publicity on and preserves a strict table option through configuration and replay", () => {
    const s = deckSession("normal");
    expect(s.room.showCardsSetFromDeck).toBe(true);
    expect(s.room.state.showCardsSetFromDeck).toBe(true);
    const strict = s.service.configure(s.room.slug, "g", s.users[0], { format: "normal", showCardsSetFromDeck: false }, 2001);
    expect(strict.showCardsSetFromDeck).toBe(false);
    expect(strict.state.showCardsSetFromDeck).toBe(false);
    expect(s.service.replay(strict.slug, "g", s.users[0])).toEqual(strict.state);
    const unchanged = s.service.configure(strict.slug, "g", s.users[0], { format: "normal" }, 2002);
    expect(unchanged.showCardsSetFromDeck).toBe(false);
    expect(s.service.list("g", s.users[0]).find(t => t.slug === strict.slug)?.showCardsSetFromDeck).toBe(false);
    expect(() => s.service.configure(strict.slug, "g", s.users[0], { format: "normal", showCardsSetFromDeck: "false" as unknown as boolean }, 2003)).toThrow(/publicity setting/i);
    const created = s.service.create({guildId:"g",userId:s.users[0],displayName:"A",gameId:"ygo",seatCount:2,showCardsSetFromDeck:false},2004);
    expect(created.showCardsSetFromDeck).toBe(false);
    expect(s.service.replay(created.slug,"g",s.users[0])).toEqual(created.state);
    expect(() => s.service.create({guildId:"g",userId:s.users[0],displayName:"A",gameId:"ygo",seatCount:2,showCardsSetFromDeck:0 as unknown as boolean},2005)).toThrow(/publicity setting/i);
    s.start();
    expect(() => s.service.configure(strict.slug,"g",s.users[0],{format:"normal",showCardsSetFromDeck:true},2200)).toThrow(/lobby/i);
  });
  it("adds default-on Deck publicity to populated tables without rewriting their state or events", () => {
    const {db, service, table, users} = setup();
    const before = db.prepare("select state_json from remote_tables where slug=?").get(table.slug);
    const events = service.get(table.slug,"g",users[0]).events;
    db.exec("alter table remote_tables drop column show_cards_set_from_deck");
    migrate(db); migrate(db);
    expect(db.prepare("select show_cards_set_from_deck from remote_tables where slug=?").get(table.slug)).toEqual({show_cards_set_from_deck:1});
    expect(db.prepare("select state_json from remote_tables where slug=?").get(table.slug)).toEqual(before);
    expect(service.get(table.slug,"g",users[0]).events).toEqual(events);
    expect(service.get(table.slug,"g",users[0]).showCardsSetFromDeck).toBe(true);
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });
  it("version 1 replay: guards camera duplicates across piles, supports copy proof/manual confirmation and merge Undo, and replays old events", () => {
    // Preserve every version-1 guard/replay assertion. Current live A–E cases
    // above use version 3; historical service fixtures explicitly use version 1.
    const reduce=ygoModule.reduce;
    const legacy=vi.spyOn(ygoModule,'reduce').mockImplementation((state,action,context)=>reduce(state,action,(context?.twinPlacementGuard??0)>=2?{...context,replay:true,twinPlacementGuard:1}:context));
    try {
    const s = deckSession("normal");
    const talent = 25311006;
    s.service.configure(s.room.slug, "g", s.users[0], { format: "normal", rules: { banlist: "none" } }, 2000);
    s.select(s.save([talent, talent, ...Array.from({ length: 38 }, (_, i) => i + 1)]).id); s.start();
    const camera = (ref: string, slot = 4, extra: Record<string, unknown> = {}) => s.act({
      type: "twin.place", source: "auto", seat: 0, zone: "spell-trap", card: { ref, cardId: talent, slot }, ...extra,
    });
    const twins = () => s.room.state.seats[0].twin;
    const replay = () => expect(s.service.replay(s.room.slug, "g", s.users[0])).toEqual(s.room.state);
    camera("original", 3);
    s.act({ type: "twin.move", seat: 0, cardRef: "original", zone: "graveyard" });
    const inGY = structuredClone(s.room.state);
    camera("new-camera-ref");
    expect(twins()).toEqual([expect.objectContaining({ ref: "original", zone: "spell-trap", slot: 4 })]);
    expect(s.room.state.deckChecks.instances).toHaveLength(1);
    expect(s.room.state.deckChecks.flags).toEqual([]); replay();
    const event = s.room.events.at(-1)!;
    expect(s.service.act(s.room.slug, "g", s.users[0], { baseSeq: 0, action: event.action as RemoteAction }, event.at + 1).lastSeq).toBe(s.room.lastSeq);
    s.act({ type: "undo", targetActionId: event.id });
    expect(s.room.state.seats).toEqual(inGY.seats); replay();
    for (const zone of ["graveyard", "banished", "hand", "deck", "extra", "hand-reveal"]) {
      s.act({ type: "twin.move", seat: 0, cardRef: "original", zone }); camera("scan-" + zone);
      expect(twins()).toEqual([expect.objectContaining({ ref: "original", zone: "spell-trap", slot: 4 })]);
    }
    s.act({ type: "twin.remove", seat: 0, cardRef: "original" }); camera("absent-scan");
    expect(twins()[0].ref).toBe("original");
    camera("proven-copy", 3, { copyProof: { simultaneousQuads: 2, at: s.room.state.updatedAt } });
    expect(twins()).toHaveLength(2);
    expect(s.room.state.deckChecks.instances).toHaveLength(2);
    camera("same-destination", 3);
    expect(twins()).toHaveLength(2);
    expect(twins().find(t => t.ref === "proven-copy")?.slot).toBe(3);
    camera("insufficient-proof", 2, { copyProof: { simultaneousQuads: 2, at: s.room.state.updatedAt } });
    expect(twins()).toHaveLength(2);
    s.act({ type: "twin.move", seat: 0, cardRef: "proven-copy", zone: "graveyard" }); camera("prefer-pile", 1);
    expect(twins().find(t => t.ref === "proven-copy")).toMatchObject({ zone: "spell-trap", slot: 1 });
    expect(twins().find(t => t.ref === "original")?.slot).toBe(2);
    s.act({ type: "twin.remove", seat: 0, cardRef: "proven-copy" });
    s.act({ type: "twin.place", seat: 0, zone: "spell-trap", card: { ref: "manual", cardId: talent, slot: 3 }, copyProof: { simultaneousQuads: 2, at: s.room.state.updatedAt } });
    expect(twins()).toHaveLength(2);
    expect(s.room.state.twinConfirmation).toMatchObject({ seat: 0, anotherCopyAllowed: true, message: "You already have Triple Tactics Talent on the field — another copy?" });
    s.act({ type: "twin.remove", seat: 0, cardRef: "manual" });
    s.act({ type: "twin.place", seat: 0, zone: "spell-trap", anotherCopy: true, card: { ref: "chosen-copy", name: "Triple Tactics Talent", slot: 3 } });
    expect(twins()).toHaveLength(2);
    expect(() => s.act({ type: "twin.place", seat: 0, zone: "spell-trap", anotherCopy: true, card: { ref: "too-many", cardId: talent, slot: 5 } })).toThrow(/decklist/i);
    const stale = ygoModule.reduce(s.room.state, remoteActionSchema.parse({ type: "twin.place", source: "auto", actorSeat: 0, seat: 0,
      idempotencyKey: "stale-proof", at: s.room.state.updatedAt + 5001, zone: "spell-trap", card: { ref: "stale", cardId: talent, slot: 5 },
      copyProof: { simultaneousQuads: 3, at: s.room.state.updatedAt } }));
    expect(stale.seats[0].twin).toHaveLength(2);
    camera("future-proof", 2, { copyProof: { simultaneousQuads: 3, at: 999999 } });
    expect(twins()).toHaveLength(2);
    const beforeMerge = structuredClone(s.room.state);
    s.act({ type: "twin.merge", seat: 0, keepRef: "original", removeRef: "chosen-copy", reason: "Same physical card" });
    expect(twins()).toHaveLength(1); replay();
    s.act({ type: "undo", targetActionId: s.room.state.undo!.actionId });
    expect(s.room.state.seats).toEqual(beforeMerge.seats);
    expect(s.room.state.deckChecks).toEqual(beforeMerge.deckChecks); replay();

    // Pure reducer also guards without catalog facts, and tolerates old conflicting events.
    const place = (ref: string, slot: number) => remoteActionSchema.parse({ type: "twin.place", source: "auto", actorSeat: 0, seat: 0,
      idempotencyKey: "legacy-" + ref, at: 1, zone: "spell-trap", card: { ref, name: "Triple Tactics Talent", slot } });
    const first = ygoModule.reduce(ygoModule.initialState({ seatCount: 2 }), place("old-a", 3));
    expect(ygoModule.reduce(first, place("new", 4)).seats[0].twin).toEqual([expect.objectContaining({ ref: "old-a", slot: 4 })]);
    const byCode = remoteActionSchema.parse({ ...place("code-scan", 4), card: { ref: "code-scan", cardId: talent, slot: 4 } });
    expect(ygoModule.reduce(first, byCode, { facts: { [talent]: { code: talent, copyKey: talent, name: "Triple Tactics Talent", limit: 3, section: "main" } } }).seats[0].twin).toHaveLength(1);
    const oldDouble = ygoModule.reduce(first, place("old-b", 4), { replay: true });
    expect(oldDouble.seats[0].twin).toHaveLength(2);
    const recovered = ygoModule.reduce(oldDouble, remoteActionSchema.parse({ type: "twin.merge", actorSeat: 0, seat: 0,
      idempotencyKey: "raw-merge", keepRef: "old-a", removeRef: "old-b", reason: "Old ghost twin" }));
    expect(recovered.seats[0].twin).toHaveLength(1);
    const piles = deckSession(); piles.start();
    piles.act({ type: "twin.place", source: "auto", seat: 0, zone: "graveyard", card: { ref: "pile-a", cardId: 14558127 } });
    piles.act({ type: "twin.place", source: "auto", seat: 0, zone: "graveyard", card: { ref: "pile-b", cardId: 104 },
      copyProof: { simultaneousQuads: 2, at: piles.room.state.updatedAt } });
    expect(piles.room.state.seats[0].twin).toHaveLength(2);
    expect(piles.room.state.deckChecks.instances).toHaveLength(2);
    piles.act({ type: "twin.place", source: "auto", seat: 0, zone: "monster", card: { ref: "alias", cardId: 104, slot: 1 } });
    expect(piles.room.state.seats[0].twin).toHaveLength(2);
    expect(piles.room.state.seats[0].twin.find(t => t.ref === "pile-a")).toMatchObject({ zone: "monster", slot: 1 });
    expect(piles.service.replay(piles.room.slug, "g", piles.users[0])).toEqual(piles.room.state);
    }finally{legacy.mockRestore();}
  });
  it("creates a new field copy beside a GY copy without a confirmation", () => {
    const s = deckSession("normal"); s.start();
    for (const [index, ref] of ["private-first", "private-second"].entries())
      s.act({ type: "twin.place", seat: 0, zone: index ? "monster" : "graveyard", card: { ref, cardId: 14558127, name: "Ash Blossom", faceUp: false, slot: index + 1 }, ...(index ? { copyProof: { simultaneousQuads: 2, at: s.room.state.updatedAt } } : {}) });
    expect(s.service.snapshot(s.room.slug, "g", s.users[0]).state.twinConfirmation).toBeUndefined();
    expect(s.room.state.seats[0].twin.map(c=>c.ref)).toEqual(["private-first","private-second"]);
    expect(s.service.snapshot(s.room.slug, "g").state.twinConfirmation).toBeUndefined();
    s.act({ type: "phase.set", phase: "main1" });
    expect(s.service.snapshot(s.room.slug, "g", s.users[0]).state.undo).toEqual({actionId:expect.any(String),at:expect.any(Number)});
    expect(s.service.snapshot(s.room.slug, "g").state.undo).toEqual({actionId:expect.any(String),at:expect.any(Number)});
  });
  it("allows physical multiplayer readiness without a deck and rejects invalid selected decks in solo", () => {
    const live = deckSession("normal", false);
    const ready = live.service.ready(live.room.slug, "g", live.users[0], true, 2001);
    expect(ready.seats[0]).toMatchObject({ ready: true, deck: null });
    const solo = deckSession("domain");
    solo.select(solo.save([1, 1]).id);
    expect(solo.room.seats[0].deck?.validation.issues.map(i => i.message)).toEqual(expect.arrayContaining(["Main Deck must have exactly 60 cards", "Duplicate card: filler 1"]));
    expect(() => solo.start()).toThrow(/60 cards|Duplicate card/);
    solo.select(null); solo.start(); expect(solo.room.status).toBe("active");
  });
  it("starts and plays a normal two-player table with no deck at all", () => {
    const s = deckSession("normal", false);
    s.service.join(s.room.slug, "g", s.users[1], "Opponent", 1, 2001);
    s.service.ready(s.room.slug, "g", s.users[1], true, 2002);
    s.start();
    expect(s.room.status).toBe("active");
    expect(s.room.seats.every(seat => !seat.deck)).toBe(true);
    s.place("no-deck-card");
    expect(s.room.state.seats[0].twin.some(c => c.ref === "no-deck-card")).toBe(true);
  });
  it("snapshots owned saved decks and resets ready on format changes", () => {
    const s = deckSession("normal"); const saved = s.save();
    expect(() => s.select(s.save(undefined, [], s.users[1]).id)).toThrow(/not found/i);
    s.select(saved.id); s.service.ready(s.room.slug, "g", s.users[0], true, 2002);
    const configured = s.service.configure(s.room.slug, "g", s.users[0], { format: "domain" }, 2003);
    expect(configured.seats[0].ready).toBe(false);
    expect(configured.seats[0].deck?.validation.issues.some(i => /Deck Master/.test(i.message))).toBe(true);
    expect(() => s.service.configure(s.room.slug, "g", s.users[1], { format: "normal" }, 2004)).toThrow();
    expect(createSavedDeckService(s.db).get(saved.id, "g", s.users[0]).deck).toEqual(saved.deck);
  });
  it("recognizes an unregistered card, offers a valid addition, logs it and replays", () => {
    const s = deckSession("normal"); const original = s.save(); s.select(original.id); s.start();
    s.act({ type: "card.identified", seat: 0, cardId: 14558127, source: "click" });
    expect(s.room.state.identified).toMatchObject({ name: "Ash Blossom", notInDecklist: true, addErrors: [] });
    s.act({ type: "deck.add", seat: 0, cardId: 14558127 });
    expect(s.room.state.identified?.notInDecklist).toBe(false);
    expect(s.room.events.at(-1)?.messages).toContain("Sulman added Ash Blossom to their decklist");
    expect(s.room.seats[0].deck?.deck.main).toHaveLength(41);
    expect(createSavedDeckService(s.db).get(original.id, "g", s.users[0]).deck.main).toHaveLength(40);
    expect(s.service.replay(s.room.slug, "g", s.users[0])).toEqual(s.room.state);
  });
  it("does not count a card taken from the opponent as a copy of the taker's deck", () => {
    const s = deckSession("normal"); s.select(s.save().id); s.start();
    s.act({ type: "twin.place", actorSeat: 1, seat: 1, zone: "monster", card: { ref: "opp-card", cardId: 14558127, name: "Ash Blossom", faceUp: true, slot: 2 } });
    s.act({ type: "twin.control", actorSeat: 0, seat: 1, toSeat: 0, cardRef: "opp-card", zone: "monster", slot: 1, faceUp: true });
    expect(s.room.state.seats[0].twin.find(c => c.ref === "opp-card")).toMatchObject({ ownerSeat: 1 });
    s.act({ type: "card.identified", seat: 0, cardRef: "opp-card", cardId: 14558127, zone: "monster", slot: 1, source: "auto" });
    expect(s.room.state.identified).toMatchObject({ notInDecklist: false, addErrors: [] });
    expect(s.service.replay(s.room.slug, "g", s.users[0])).toEqual(s.room.state);
  });
  it("keeps a face-down monster face-down through take and return, hidden from the other seat and spectators", () => {
    const s = deckSession("normal"); s.select(s.save().id); s.start();
    s.act({ type: "twin.place", actorSeat: 1, seat: 1, zone: "monster", card: { ref: "opp-card", cardId: 14558127, name: "Ash Blossom", faceUp: false, slot: 2, position: "defense" } });
    const view = () => s.room.state.seats.flatMap(seat => seat.twin).find(c => c.ref === "opp-card")!;
    // A client that sends faceUp:true for a face-down field take does not flip the card.
    s.act({ type: "twin.control", actorSeat: 0, seat: 1, toSeat: 0, cardRef: "opp-card", zone: "monster", slot: 1, faceUp: true });
    expect(view()).toMatchObject({ faceUp: false, ownerSeat: 1 });
    expect(projectRemoteState(s.room.state, new Set([0])).seats[0].twin.find(c => c.ref === "opp-card")).not.toHaveProperty("cardId");
    s.act({ type: "twin.control", actorSeat: 0, seat: 0, toSeat: 1, cardRef: "opp-card", zone: "monster", slot: 3 });
    expect(s.room.state.seats[1].twin.find(c => c.ref === "opp-card")).toMatchObject({ zone: "monster", slot: 3, faceUp: false });
    for (const viewer of [new Set([0]), new Set<number>()]) expect(projectRemoteState(s.room.state, viewer).seats[1].twin.find(c => c.ref === "opp-card")).not.toHaveProperty("cardId");
    expect(projectRemoteSpectator(s.service.snapshot(s.room.slug, "g")).state.seats[1].twin.find(c => c.ref === "opp-card") ?? {}).not.toHaveProperty("cardId");
  });
  it.each(["normal", "domain"] as const)("shows why an addition cannot stay legal in %s", format => {
    const s = deckSession(format); s.select(s.save(Array.from({ length: 60 }, (_, i) => i + 1)).id); s.start();
    s.act({ type: "card.identified", seat: 0, cardId: 14558127, source: "click" });
    expect(s.room.state.identified?.notInDecklist).toBe(true);
    expect(s.room.state.identified?.addErrors.some(e => /60/.test(e))).toBe(true);
    const seq = s.room.lastSeq;
    expect(() => s.act({ type: "deck.add", seat: 0, cardId: 14558127 })).toThrow(/60/);
    expect(s.service.get(s.room.slug, "g", s.users[0]).lastSeq).toBe(seq);
  });
  it("uses full Domain membership and Genesys rules for registration", () => {
    const domain = deckSession("domain");
    domain.select(domain.save([...Array.from({length:59},(_,i)=>i+1),103]).id);
    expect(domain.room.seats[0].deck?.validation.issues.some(i => /outside.*Domain/.test(i.message))).toBe(true);
    const genesys = deckSession("genesys"); genesys.select(genesys.save().id);
    expect(genesys.room.seats[0].deck?.validation.issues.some(i => /points are unknown/.test(i.message))).toBe(true);
    expect(() => genesys.start()).toThrow(/points/);
  });
  it.each(["hand", "deck"])("does not flag a card bounced to %s and replayed with a new scan/ref", zone => {
    const s = deckSession(); s.start(); s.place("first");
    s.act({ type: "twin.move", seat: 0, cardRef: "first", zone });
    s.act({ type: "card.identified", seat: 0, cardId: 14558127, zone: "monster", slot: 2, source: "auto" });
    s.act({type:'twin.place',seat:0,zone:'monster',fromRef:'first',card:{ref:'replayed',cardId:14558127,slot:2}});
    expect(s.room.state.deckChecks.flags).toEqual([]);
    expect(s.room.state.deckChecks.instances).toHaveLength(1);
  });
  it("does not flag a card sent to GY then revived or re-scanned", () => {
    const s = deckSession(); s.start(); s.place("one");
    s.act({ type: "twin.move", seat: 0, cardRef: "one", zone: "graveyard" });
    s.act({ type: "card.identified", seat: 0, cardId: 14558127, zone: "graveyard", source: "auto" });
    s.act({ type: "twin.move", seat: 0, cardRef: "one", zone: "monster", slot: 3 });
    s.act({ type: "card.identified", seat: 0, cardId: 14558127, zone: "monster", slot: 3, source: "auto" });
    expect(s.room.state.deckChecks.flags).toEqual([]);
    expect(s.room.state.deckChecks.instances).toHaveLength(1);
  });
  it.each(["monster", "graveyard"])("proves two concurrent copies with the first still in %s", zone => {
    const s = deckSession(); s.start(); s.place("first", zone, 1); s.place("second", "monster", 2);
    expect(s.room.state.deckChecks.flags).toHaveLength(1);
    const flag = s.room.state.deckChecks.flags[0];
    expect(flag.message).toMatch(/Deck no longer valid: 2 copies of Ash Blossom seen \(Domain allows 1\)/);
    expect(flag.proof).toEqual(expect.arrayContaining(zone === "monster" ? ["field zone 1", "field zone 2"] : ["GY", "field zone 2"]));
    expect(s.room.events.at(-1)?.messages?.join(" ")).toContain("at the same time");
    expect(s.room.state.ended).toBe(false);
    expect(s.service.replay(s.room.slug, "g", s.users[0])).toEqual(s.room.state);
  });
  it("reuses instances through unlocated recognition, hidden returns and removals", () => {
    const s = deckSession(); s.start(); s.place("one");
    for (let i=0;i<3;i++) s.act({ type: "card.identified", seat: 0, cardId: 14558127, source: "auto" });
    s.act({ type: "twin.move", seat: 0, cardRef: "one", zone: "hand", faceUp: false });
    s.act({type:'twin.place',seat:0,zone:'monster',fromRef:'one',card:{ref:'two',cardId:14558127,slot:2}});
    s.act({ type: "twin.remove", seat: 0, cardRef: "one" });
    s.act({type:'twin.place',seat:0,zone:'monster',card:{ref:'three',cardId:14558127,slot:3}});
    expect(s.room.state.deckChecks.flags).toEqual([]);
    expect(s.room.state.deckChecks.instances).toHaveLength(2);
    expect(s.room.state.seats[0].twin.map(c=>c.ref)).toEqual(["three"]);
  });
  it("proves a recognition batch of hand reveals and ignores later re-sightings", () => {
    const s = deckSession(); s.start();
    s.act({ type: "cards.identified", seat: 0, source: "auto", cards: [
      { cardId: 14558127, observationId: "region-1", zone: "hand-reveal" },
      { cardId: 14558127, observationId: "region-2", zone: "hand-reveal" },
    ] });
    expect(s.room.state.deckChecks.flags).toHaveLength(1);
    expect(s.room.state.deckChecks.flags[0].proof.join(" ")).toMatch(/same recognition batch/);
    s.act({ type: "card.identified", seat: 0, cardId: 14558127, source: "auto" });
    expect(s.room.state.deckChecks.instances).toHaveLength(2);
    expect(s.room.state.deckChecks.flags).toHaveLength(1);
  });
  it("flags forbidden cards and uses artwork identity for singleton proof", () => {
    const banned = deckSession("normal"); banned.start();
    banned.act({ type: "card.identified", seat: 0, cardId: 55144522, source: "click" });
    expect(banned.room.state.deckChecks.flags[0]?.message).toMatch(/Pot of Greed.*allows 0/);
    const domain = deckSession(); domain.start(); domain.place("a"); domain.place("b", "monster", 2, 104);
    expect(domain.room.state.deckChecks.flags).toHaveLength(1);
  });
  it("logs dismissal and instance merge, with deterministic replay", () => {
    const s = deckSession(); s.start(); s.place("first"); s.place("second", "monster", 2);
    const flag = s.room.state.deckChecks.flags[0];
    s.act({ type: "deck.flag.dismiss", flagId: flag.id, reason: "Wrong recognition" });
    expect(s.room.state.deckChecks.flags[0].dismissed).toBe(true);
    const instances = s.room.state.deckChecks.instances;
    s.act({ type: "twin.merge", seat: 0, keepInstanceId: instances[0].id, removeInstanceId: instances[1].id, reason: "Same physical card" });
    expect(s.room.state.deckChecks.instances).toHaveLength(1);
    expect(s.room.state.seats[0].twin).toHaveLength(1);
    expect(s.room.events.at(-1)?.messages?.join(" ")).toMatch(/merged/);
    expect(s.service.replay(s.room.slug, "g", s.users[0])).toEqual(s.room.state);
  });
  it("does not use old scans or overlapping field coordinates as concurrent proof", () => {
    const s = deckSession(); s.start();
    s.act({ type: "card.identified", seat: 0, cardId: 14558127, zone: "monster", slot: 1, source: "auto" });
    s.place("one", "monster", 2);
    expect(s.room.state.deckChecks.flags).toEqual([]);
    s.act({ type: "twin.remove", seat: 0, cardRef: "one" });
    s.place("different", "monster", 2, 1);
    s.act({ type: "card.identified", seat: 0, cardRef: "different", cardId: 14558127, zone: "monster", slot: 2, source: "auto" });
    expect(s.room.state.deckChecks.flags).toEqual([]);
  });
  it("recognizes two cards in the same pile in one batch, without counting duplicate field coordinates", () => {
    const s = deckSession(); s.start();
    s.act({ type: "cards.identified", seat: 0, source: "auto", cards: [
      { cardId: 14558127, observationId: "a", zone: "graveyard" },
      { cardId: 14558127, observationId: "b", zone: "graveyard" },
    ] });
    expect(s.room.state.deckChecks.flags).toHaveLength(1);
    const overlap = deckSession(); overlap.start();
    overlap.act({ type: "cards.identified", seat: 0, source: "auto", cards: [
      { cardId: 14558127, observationId: "a", zone: "monster", slot: 1 },
      { cardId: 14558127, observationId: "b", zone: "monster", slot: 1 },
    ] });
    expect(overlap.room.state.deckChecks.flags).toEqual([]);
  });
  it("applies current Advanced limits and full validation to banned/duplicate additions", () => {
    const s = deckSession("normal"); s.select(s.save().id); s.start();
    s.act({ type: "card.identified", seat: 0, cardId: 55144522, source: "typed" });
    expect(s.room.state.identified?.addErrors.join(" ")).toMatch(/forbidden/);
    expect(() => s.act({ type: "deck.add", seat: 0, cardId: 55144522 })).toThrow(/forbidden/);
    for (let i=0;i<3;i++) s.act({ type: "deck.add", seat: 0, cardId: 14558127 });
    expect(() => s.act({ type: "deck.add", seat: 0, cardId: 14558127 })).toThrow(/More than 3/);
    for (let i=1;i<=3;i++) s.place("ash"+i, "monster", i);
    expect(s.room.state.deckChecks.flags.filter(f => f.copyKey === 14558127)).toHaveLength(0);
    s.place("ash4", "monster", 4);
    expect(s.room.state.deckChecks.flags.filter(f => f.copyKey === 14558127)).toHaveLength(1);
  });
  it.each(["genesys", "genesys-domain"] as const)("uses current points and type bans for %s additions", format => {
    const s = deckSession(format);
    s.db.prepare("insert into genesys_points_meta values(1,'test','2026-10-05','test','test')").run();
    const point = s.db.prepare("insert into card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at,genesys_points,genesys_revision) values(?,?,'Normal Monster','normal','','','[]','test',?,'test')");
    for (let i=1;i<=104;i++) point.run(i, "Card "+i, 0);
    point.run(14558127, "Ash Blossom", 101);
    s.select(s.save().id); s.start();
    s.act({ type: "card.identified", seat: 0, cardId: 14558127, source: "typed" });
    expect(s.room.state.identified?.addErrors.join(" ")).toMatch(/101 Genesys points; the cap is 100/);
    expect(() => s.act({ type: "deck.add", seat: 0, cardId: 14558127 })).toThrow(/Genesys points/);
    s.act({ type: "card.identified", seat: 0, cardId: 102, source: "typed" });
    expect(s.room.state.identified?.addErrors.join(" ")).toMatch(/Link or Pendulum/);
  });
  it("undoes a valid deck edit in both the state and seat snapshot", () => {
    const s = deckSession("normal"); s.select(s.save().id); s.start();
    s.act({ type: "deck.add", seat: 0, cardId: 14558127 });
    const actionId = s.room.state.undo!.actionId;
    s.act({ type: "undo", targetActionId: actionId });
    expect(s.room.seats[0].deck?.deck.main).toHaveLength(40);
    expect(s.service.replay(s.room.slug, "g", s.users[0])).toEqual(s.room.state);
  });
  it("records one automatic placement sighting and undoes it atomically without orphaned recognition", () => {
    const s = deckSession(); s.start();
    const before = structuredClone(s.room);
    const action = remoteActionSchema.parse({ type: "twin.place", actorSeat: 0, seat: 0, zone: "monster", source: "auto",
      idempotencyKey: "atomic-auto", card: { ref: "auto-card", cardId: 14558127, slot: 2 } });
    expect(action).toMatchObject({ type: "twin.place", source: "auto" });
    s.act(action);
    expect(s.room.lastSeq).toBe(before.lastSeq + 1);
    expect(s.room.events.slice(before.events.length)).toMatchObject([{ action: { type: "twin.place", source: "auto" } }]);
    expect(s.room.events.at(-1)?.effects).toBeUndefined();
    const persisted = s.db.prepare("select v.json as facts_json from remote_events e join remote_values v on v.hash=e.facts_hash where idempotency_key=? and table_id=(select id from remote_tables where slug=?)")
      .get("atomic-auto", s.room.slug) as { facts_json: string };
    expect(JSON.parse(persisted.facts_json)).toMatchObject({ 14558127: { code: 14558127, name: "Ash Blossom" } });
    expect(s.room.state.seats[0].twin).toMatchObject([{ ref: "auto-card", cardId: 14558127, zone: "monster", slot: 2 }]);
    expect(s.room.state.deckChecks.instances).toMatchObject([{ code: 14558127, name: "Ash Blossom", refs: ["auto-card"], zone: "monster", slot: 2 }]);
    expect(s.room.state.identified).toBeNull();
    // The camera named the card early; its confirm read corrects it in place.
    // The correction joins the placement, so one Undo still removes the card.
    s.act({ type: "card.identified", actorSeat: 0, seat: 0, cardId: 46986414, cardRef: "auto-card", zone: "monster", slot: 2, source: "auto", idempotencyKey: "atomic-fix" });
    expect(s.room.state.seats[0].twin).toMatchObject([{ ref: "auto-card", cardId: 46986414, zone: "monster", slot: 2 }]);
    expect(s.room.state.undo!.actionId).toBe("atomic-auto");
    s.act({ type: "undo", targetActionId: s.room.state.undo!.actionId });
    expect(s.room.state.seats[0].twin).toEqual(before.state.seats[0].twin);
    expect(s.room.state.deckChecks).toEqual(before.state.deckChecks);
    expect(s.room.state.identified).toEqual(before.state.identified);
    // The camera saw the whole GY picked up: one action moves every GY card to
    // the hand, and one Undo puts the pile back.
    s.act({ type: "twin.place", seat: 0, zone: "graveyard", source: "auto", card: { ref: "gy-1", cardId: 14558127 } });
    s.act({ type: "twin.place", seat: 0, zone: "graveyard", source: "auto", card: { ref: "gy-2", cardId: 46986414 } });
    const pile = structuredClone(s.room.state.seats[0].twin);
    s.act({ type: "pile.lift", seat: 0, zone: "graveyard", cardRefs: ["gy-1", "gy-2"], source: "auto", idempotencyKey: "gy-lift" });
    expect(s.room.state.seats[0].twin.filter(c => c.zone === "hand").map(c => c.ref).sort()).toEqual(["gy-1", "gy-2"]);
    expect(s.room.state.undo!.actionId).toBe("gy-lift");
    s.act({ type: "undo", targetActionId: "gy-lift" });
    expect(s.room.state.seats[0].twin).toEqual(pile);
    expect(s.service.replay(s.room.slug, "g", s.users[0])).toEqual(s.room.state);
  });
  it("adds the new columns to populated pre-deck tables without rewriting events", () => {
    const { db, service, table, users } = setup();
    const events = service.get(table.slug,"g",users[0]).events;
    db.exec("alter table remote_tables drop column format_json; alter table remote_seats drop column saved_deck_id; alter table remote_seats drop column deck_json; alter table remote_bot_seats drop column saved_deck_id; alter table remote_bot_seats drop column deck_json; alter table remote_events drop column effects_json; alter table remote_events drop column messages_json");
    migrate(db); migrate(db);
    expect(service.get(table.slug,"g",users[0]).events).toEqual(events);
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });
  it("reuses the known public instance for an unlocated one-card recognition batch", () => {
    const s = deckSession(); s.start(); s.place("one");
    s.act({ type: "cards.identified", seat: 0, source: "auto", cards: [{ cardId: 14558127, observationId: "region" }] });
    expect(s.room.state.deckChecks.instances).toHaveLength(1);
    expect(s.room.state.deckChecks.flags).toEqual([]);
  });
  it("does not prove extra copies from unspecified row slots or a single field position", () => {
    const s = deckSession(); s.start(); s.place("one");
    s.act({ type: "cards.identified", seat: 0, source: "auto", cards: [{ cardId: 14558127, zone: "monster", observationId: "region" }] });
    expect(s.room.state.deckChecks.flags).toEqual([]);
    const ambiguous = deckSession(); ambiguous.start();
    ambiguous.act({type:"twin.place",seat:0,zone:"monster",card:{ref:"unknown-slot",cardId:14558127}});
    ambiguous.place("known-slot","monster",2);
    expect(ambiguous.room.state.deckChecks.flags).toEqual([]);
    const field = deckSession(); field.start(); field.place("field-a","field",1);
    field.act({ type: "cards.identified", seat: 0, source: "auto", cards: [
      { cardId: 14558127, zone: "field", slot: 1, observationId: "field-a" },
      { cardId: 14558127, zone: "field", slot: 2, observationId: "field-b" },
    ] });
    expect(field.room.state.deckChecks.flags).toEqual([]);
  });
  it("does not count a repeated same-slot batch ref as separate physical detections", () => {
    const s = deckSession(); s.start(); s.place("a");
    s.act({ type:"cards.identified",seat:0,source:"auto",cards:[
      {cardId:14558127,cardRef:"a",observationId:"a"}, {cardId:14558127,cardRef:"a",observationId:"b"},
    ]});
    expect(s.room.state.deckChecks.flags).toEqual([]);
  });
  it("does not count conflicting same-slot batch refs from legacy state as separate physical detections", () => {
    const s = deckSession(); s.start(); s.place("a");
    const legacy = structuredClone(s.room.state);
    // Old tables can contain twins that the current physical-slot guard would reject.
    legacy.seats[0].twin.push({ ...legacy.seats[0].twin[0], ref: "b", cardId: 1 });
    const next = ygoModule.reduce(legacy, remoteActionSchema.parse({
      type: "cards.identified", actorSeat: 0, seat: 0, source: "auto", idempotencyKey: "legacy-same-slot",
      at: legacy.updatedAt + 1, cards: [
        { cardId: 14558127, cardRef: "a", observationId: "a" },
        { cardId: 14558127, cardRef: "b", observationId: "b" },
      ],
    }), { showCardsSetFromDeck: true, facts: {
      14558127: { code: 14558127, copyKey: 14558127, name: "Ash Blossom", limit: 1, section: "main" },
    } });
    expect(next.deckChecks.flags).toEqual([]);
    expect(next.deckChecks.instances).toHaveLength(1);
  });
  it("applies an Advanced limited-card cap to simultaneous copies", () => {
    const s = deckSession("normal"); s.start(); s.place("one","monster",1,33396948);
    expect(s.room.state.deckChecks.flags).toEqual([]);
    s.place("two","monster",2,33396948);
    expect(s.room.state.deckChecks.flags[0]?.message).toMatch(/2 copies of Limited Test seen.*Advanced allows 1/);
  });
  it("binds recognition to the referenced twin's known position and visibility", () => {
    const s = deckSession(); s.start();
    s.act({ type: "twin.place", seat: 0, zone: "monster", card: { ref: "a", slot: 1 } });
    s.act({ type: "twin.place", seat: 0, zone: "monster", card: { ref: "b", slot: 2 } });
    s.act({ type: "card.identified", seat: 0, cardRef: "a", cardId: 14558127, source: "click" });
    s.act({ type: "card.identified", seat: 0, cardRef: "b", cardId: 14558127, source: "click" });
    expect(s.room.state.deckChecks.flags).toHaveLength(1);
    expect(s.room.state.deckChecks.flags[0].proof.join(" and ")).toMatch(/field zone 1 and field zone 2/);
    const hidden = deckSession(); hidden.start(); hidden.place("public");
    hidden.act({ type: "twin.place", seat: 0, zone: "monster", card: { ref: "hidden", slot: 2, faceUp: false } });
    hidden.act({ type: "card.identified", seat: 0, cardRef: "hidden", cardId: 14558127, zone: "graveyard", source: "click" });
    expect(hidden.room.state.deckChecks.flags).toEqual([]);
    hidden.act({ type: "twin.flip", seat: 0, cardRef: "hidden", faceUp: true });
    expect(hidden.room.state.deckChecks.flags).toHaveLength(1);
  });
  it("preserves twin ownership and keeps saved-deck snapshots out of open listings", () => {
    const s = deckSession(); s.select(s.save().id);
    s.db.prepare("update remote_tables set visibility='public'").run();
    const listed = s.service.list("g",s.users[1],"open").flatMap(t => t.seats);
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.every(seat => !seat.deck)).toBe(true);
    s.start(); s.act({ type: "twin.place", actorSeat: 1, seat: 1, zone: "monster", card: { ref: "bot", slot: 1 } });
    expect(() => s.act({ type: "card.identified", seat: 1, cardRef: "bot", cardId: 14558127, source: "click" })).toThrow(/owner/);
  });
  it("uses configured starting LP and preserves it through replay", () => {
    const s = deckSession();
    const room = s.service.configure(s.room.slug,"g",s.users[0],{format:"domain",rules:{startingLP:12000}},2001);
    expect(room.state.seats.every(seat => seat.resources.lp === 12000)).toBe(true);
    expect(s.service.replay(room.slug,"g",s.users[0])).toEqual(room.state);
  });
  it("renders logged deck edits with current seat names without copying personal names into events", () => {
    const s = deckSession("normal"); s.select(s.save().id); s.start();
    s.act({ type: "deck.add", seat: 0, cardId: 14558127 });
    expect(s.room.events.at(-1)?.messages).toContain("Sulman added Ash Blossom to their decklist");
    expect(JSON.stringify(s.db.prepare("select * from remote_events").all())).not.toContain("Sulman");
    deleteUserAccount(s.db,s.users[0]);
    expect(() => s.service.get(s.room.slug,"g",s.users[0])).toThrow(/not found/i);
  });
});
describe("B3 physical field slot guard", () => {
  it.each(["monster", "extra-monster", "field"].flatMap(zone=>["twin.place", "twin.move"].map(type=>({zone,type}))))("round 2 NS3: replays legacy $type conflicts in $zone while live writes stay guarded", ({zone,type}) => {
    const s=deckSession();s.start();s.place("old-first",zone,1,1);
    if(type==='twin.move')s.place('old-second','graveyard',1,2);
    const action={type,actorSeat:0,seat:0,zone,idempotencyKey:'legacy-conflict',at:2200,
      ...(type==='twin.place'?{card:{ref:'old-second',slot:1,cardId:2,faceUp:true}}:{cardRef:'old-second',slot:1})};
    expect(remoteActionSchema.safeParse(action).success).toBe(true);
    const tableId=(s.db.prepare('select id from remote_tables where slug=?').get(s.room.slug) as {id:number}).id;
    s.db.prepare('insert into remote_events(table_id,seq,idempotency_key,actor_seat,user_id,action_json,created_at) values(?,?,?,?,?,?,?)')
      .run(tableId,s.room.lastSeq+1,action.idempotencyKey,0,s.users[0],JSON.stringify(action),2200);
    const replayed=s.service.replay(s.room.slug,'g',s.users[0]);
    expect(replayed.seats[0].twin.filter(c=>c.zone===zone).map(c=>c.ref)).toEqual(['old-first','old-second']);
    expect(replayed.undo?.actionId).toBe('legacy-conflict');
    expect(()=>ygoModule.reduce(replayed,remoteActionSchema.parse({type:'twin.place',actorSeat:0,seat:0,zone,card:{ref:'live-third',slot:1},idempotencyKey:'live-after-legacy',at:2201}))).toThrow(/occupied/i);
    // A client state has no undo position; give the reducer the one from before the replayed action.
    const {updatedAt:_at,undo:_undo,undoHistory:_history,...beforeAction}=structuredClone(s.room.state);
    const restored=ygoModule.reduce({...replayed,undo:{...replayed.undo!,before:beforeAction}},{type:'undo',actorSeat:0,targetActionId:'legacy-conflict',idempotencyKey:'undo-legacy',at:2201});
    expect(restored.seats[0].twin).toEqual(s.room.state.seats[0].twin);
  });
  const slots = [
    ...["monster", "spell-trap"].flatMap(zone => [1, 2, 3, 4, 5].map(slot => ({ zone, slot }))),
    ...["extra-monster", "pendulum"].flatMap(zone => [1, 2].map(slot => ({ zone, slot }))),
    { zone: "field", slot: 1 },
  ];
  it.each(slots)("rejects a second placement or incoming move into $zone $slot without changing state", ({ zone, slot }) => {
    const s = deckSession(); s.start(); s.place("occupant", zone, slot, 1);
    s.place("incoming", "graveyard", 1, 2);
    const before = structuredClone(s.room);
    for (const action of [
      { type: "twin.place", seat: 0, zone, card: { ref: "duplicate", slot, faceUp: false } },
      { type: "twin.move", seat: 0, zone, slot, cardRef: "incoming", position: "defense" },
    ]) {
      expect(() => s.act(action)).toThrow(/occupied/i);
      expect(s.service.get(s.room.slug, "g", s.users[0])).toEqual(before);
    }
    expect(s.service.replay(s.room.slug, "g", s.users[0])).toEqual(before.state);
  });
  it.each([undefined, 1, 5])("treats the field zone as one physical slot even with slot %s", slot => {
    const s = deckSession(); s.start();
    s.act({ type: "twin.place", seat: 0, zone: "field", card: { ref: "field-a" } });
    s.place("incoming", "graveyard");
    expect(() => s.act({ type: "twin.place", seat: 0, zone: "field", card: { ref: "field-b", slot } })).toThrow(/occupied/i);
    expect(() => s.act({ type: "twin.move", seat: 0, zone: "field", slot, cardRef: "incoming" })).toThrow(/occupied/i);
    s.act({ type: "twin.move", seat: 0, zone: "field", slot, cardRef: "field-a", position: "defense" });
    expect(s.room.state.seats[0].twin[0]).toMatchObject({ ref: "field-a", position: "defense" });
  });
  it.each([
    ["twin.place", "twin.place"], ["twin.place", "twin.move"],
    ["twin.move", "twin.place"], ["twin.move", "twin.move"],
  ])("rejects stale %s intent after %s fills its destination, even with the latest sequence", (staleType, firstType) => {
    const s = deckSession(); s.start(); s.place("first", "graveyard", 1, 1); s.place("second", "graveyard", 1, 2);
    const staleIntent = staleType === "twin.place"
      ? { type: staleType, seat: 0, zone: "monster", card: { ref: "stale", slot: 2 } }
      : { type: staleType, seat: 0, zone: "monster", cardRef: "second", slot: 2 };
    s.act(firstType === "twin.place"
      ? { type: firstType, seat: 0, zone: "monster", card: { ref: "manual", slot: 2 } }
      : { type: firstType, seat: 0, zone: "monster", cardRef: "first", slot: 2 });
    const before = structuredClone(s.room);
    expect(() => s.act(staleIntent)).toThrow(/occupied/i);
    expect(s.service.get(s.room.slug, "g", s.users[0])).toEqual(before);
    expect(s.service.replay(s.room.slug, "g", s.users[0])).toEqual(before.state);
  });
  it.each(["monster", "spell-trap", "extra-monster", "pendulum"])("allows self moves, free slots and separate owners in %s, preserving Undo and replay", zone => {
    const s = deckSession(); s.start(); s.place("moving", zone, 1);
    s.act({ type: "twin.place", actorSeat: 1, seat: 1, zone, card: { ref: "other-owner", slot: 1 } });
    s.act({ type: "twin.move", seat: 0, cardRef: "moving", zone, slot: 1, position: "defense" });
    s.act({ type: "twin.move", seat: 0, cardRef: "moving", zone });
    expect(s.room.state.seats[0].twin[0]).toMatchObject({ ref: "moving", zone, slot: 1, position: "defense" });
    const before = structuredClone(s.room.state.seats[0].twin);
    s.act({ type: "twin.move", seat: 0, cardRef: "moving", zone, slot: 2 });
    expect(s.room.state.seats[0].twin[0].slot).toBe(2);
    s.act({ type: "undo", targetActionId: s.room.state.undo!.actionId });
    expect(s.room.state.seats[0].twin).toEqual(before);
    s.act({ type: "twin.move", seat: 0, cardRef: "moving", zone: "graveyard" });
    s.place("new-occupant", zone, 1);
    expect(s.service.replay(s.room.slug, "g", s.users[0])).toEqual(s.room.state);
  });
  it.each(["graveyard", "banished", "hand", "deck", "extra", "hand-reveal"])("allows several placements and incoming moves with the same optional slot in the %s pile", zone => {
    const s = deckSession(); s.start(); s.place("a", zone, 1, 1); s.place("b", zone, 1, 2); s.place("c", "monster", 1, 3);
    s.act({ type: "twin.move", seat: 0, cardRef: "c", zone, slot: 1 });
    expect(s.room.state.seats[0].twin.filter(card => card.zone === zone)).toHaveLength(3);
    s.act({ type: "undo", targetActionId: s.room.state.undo!.actionId });
    expect(s.room.state.seats[0].twin.find(card => card.ref === "c")?.zone).toBe("monster");
    expect(s.service.replay(s.room.slug, "g", s.users[0])).toEqual(s.room.state);
  });
  it.each(["monster", "spell-trap", "extra-monster", "pendulum"])("preserves unlocated legacy %s twins without guessing their physical slot", zone => {
    const s = deckSession(); s.start();
    for (const ref of ["unlocated-a", "unlocated-b"]) s.act({ type: "twin.place", seat: 0, zone, card: { ref } });
    s.place("located", zone, 1, 1); s.place("incoming", "graveyard", 1, 2);
    s.act({ type: "twin.move", seat: 0, cardRef: "incoming", zone });
    s.act({ type: "twin.move", seat: 0, cardRef: "unlocated-a", zone, position: "defense" });
    expect(s.room.state.seats[0].twin.filter(card => card.slot === undefined)).toHaveLength(3);
    expect(() => s.act({ type: "twin.move", seat: 0, cardRef: "unlocated-a", zone, slot: 1 })).toThrow(/occupied/i);
    s.act({ type: "twin.move", seat: 0, cardRef: "unlocated-a", zone, slot: 2 });
    expect(s.service.replay(s.room.slug, "g", s.users[0])).toEqual(s.room.state);
  });
  it.each(["extra-monster", "pendulum"])("rejects explicit slots outside the two physical %s positions", zone => {
    const s = deckSession(); s.start(); s.place("incoming", "graveyard");
    for (const slot of [3, 4, 5]) {
      expect(() => s.act({ type: "twin.place", seat: 0, zone, card: { ref: "out-of-range", slot } })).toThrow(/slot/i);
      expect(() => s.act({ type: "twin.move", seat: 0, cardRef: "incoming", zone, slot })).toThrow(/slot/i);
    }
  });
});
describe("solo remote tables", () => {
  it("parses voice controls for the selected bot through the same reducer", () => {
    let state = ygoModule.initialState({ seatCount: 3 }); let n = 0;
    const speak = (text: string, actorSeat = 1) => {
      const proposal = ygoModule.parseCommand({ text, actorSeat, state });
      expect(proposal, text).not.toBeNull();
      state = ygoModule.reduce(state, { ...proposal!, idempotencyKey: `speech-${++n}`, at: n });
    };
    speak("place Dark Magician in monster slot 3");
    expect(state.seats[1].twin[0]).toMatchObject({ name: "Dark Magician", slot: 3, faceUp: true });
    speak("flip Dark Magician face down");
    speak("move slot 3 to graveyard");
    expect(state.seats[1].twin[0]).toMatchObject({ zone: "graveyard", faceUp: false });
    speak("lose 500 LP"); expect(state.seats[1].resources.lp).toBe(7500);
    speak("undo"); expect(state.seats[1].resources.lp).toBe(8000);
    speak("set LP to 7000"); expect(state.seats[1].resources.lp).toBe(7000);
    speak("gain 1000 LP"); expect(state.seats[1].resources.lp).toBe(8000);
    speak("note bot adjusted");
    speak("identify 89631139", 0); expect(state.identified).toMatchObject({ seat: 0, cardId: 89631139, source: "voice" });
    speak("end turn", 0); speak("next phase"); expect(state.phase).toBe("standby");
    speak("main 1 phase"); expect(state.phase).toBe("main1");
    speak("remove Dark Magician"); expect(state.seats[1].twin).toEqual([]);
    speak("place Xyz One in monster slot 1"); speak("place Mat A in monster slot 2"); speak("place Mat B in monster slot 3");
    expect(ygoModule.parseCommand({ text: "detach", actorSeat: 1, state })).toBeNull();
    const xyz = state.seats[1].twin.find(c => c.name === "Xyz One")!; const [matA, matB] = state.seats[1].twin.filter(c => c.name?.startsWith("Mat"));
    state = ygoModule.reduce(state, { type: "twin.attach", actorSeat: 1, seat: 1, cardRef: xyz.ref, kind: "xyz", materialRefs: [matA.ref, matB.ref], idempotencyKey: `speech-${++n}`, at: n });
    speak("detach a material"); speak("detach material from Xyz One");
    expect(state.seats[1].twin.filter(c => c.zone === "graveyard").map(c => c.ref)).toEqual([matA.ref, matB.ref]);
    expect(ygoModule.parseCommand({ text: "detach", actorSeat: 1, state })).toBeNull();
    expect(ygoModule.parseCommand({ text: "nonsense", actorSeat: 1, state })).toBeNull();
    expect(ygoModule.parseCommand({ text: "gain 0 LP", actorSeat: 1, state })).toBeNull();
    expect(ygoModule.parseCommand({ text: "next phase", actorSeat: 3, state })).toBeNull();
  });

  it("lets an owner-list admin spectate a private table with a visible badge; others and actions stay closed", () => {
    const { service, users, db } = setup();
    vi.stubEnv("OWNER_USER_IDS", String(users[3]));
    const t = Date.now();
    try {
      const slug = service.create({ guildId: "g", userId: users[0], displayName: "A", gameId: "ygo", seatCount: 2 as SeatCount }, t + 0).slug;
      expect(service.get(slug, "g", users[0]).visibility).toBe("private");
      // A non-admin, and an admin who did not ask, get the public-only rule.
      expect(() => service.spectate(slug, "g", users[2], t + 1)).toThrow("This table is private");
      expect(() => service.spectate(slug, "g", users[3], t + 1)).toThrow("This table is private");
      expect(() => service.spectate(slug, "g", users[2], t + 1, { admin: true })).toThrow("This table is private");
      expect(() => service.list("g", users[2], "all")).toThrow();
      const view = service.spectate(slug, "g", users[3], t + 2, { admin: true });
      expect(view.spectator).toBe(true);
      expect(view.spectatorCount).toBe(1);
      // The players see the badge data; the log has one public line without camera data.
      expect(service.get(slug, "g", users[0]).adminWatchers).toEqual([{ userId: users[3], name: expect.any(String) }]);
      service.spectate(slug, "g", users[3], t + 3, { admin: true });
      expect(service.get(slug, "g", users[0]).events.filter(e => e.action.type === "admin.watching")).toHaveLength(1);
      expect(service.list("g", users[3], "all").map(t => t.slug)).toContain(slug);
      // The admin cannot act or take a seat.
      expect(() => service.act(slug, "g", users[3], { baseSeq: 0, action: remoteActionSchema.parse({ actorSeat: 0, idempotencyKey: "x", type: "turn.end" }) }, t + 4)).toThrow();
      expect(() => service.join(slug, "g", users[3], "Admin", 1, t + 4)).toThrow("cannot take a seat");
      // Two tabs: one closing keeps the watch; the last one ends the slot at once.
      service.spectate(slug, "g", users[3], t + 4, { admin: true, tab: "tab-one-aaaa" });
      service.spectate(slug, "g", users[3], t + 4, { admin: true, tab: "tab-two-bbbb" });
      service.stopSpectating(slug, "g", users[3], t + 5, "tab-one-aaaa");
      expect(service.get(slug, "g", users[0]).adminWatchers).toHaveLength(1);
      service.stopSpectating(slug, "g", users[3], t + 6, "tab-two-bbbb");
      expect(service.get(slug, "g", users[0]).adminWatchers).toEqual([]);
      // A reload within the grace adds no lines (not "stopped" then "started").
      service.spectate(slug, "g", users[3], t + 7, { admin: true, tab: "tab-new-cccc" });
      service.stopSpectating(slug, "g", users[3], t + 8, "tab-new-cccc");
      service.spectate(slug, "g", users[3], t + 9, { admin: true, tab: "tab-new-dddd" });
      const watchLines = () => service.get(slug, "g", users[0]).events.filter(e => e.action.type === "admin.watching").map(e => (e.action as { watching: boolean }).watching);
      expect(watchLines()).toEqual([true]);
      // After the grace the stop line is written (by the next touch of the table, or the sweep).
      service.stopSpectating(slug, "g", users[3], t + 10, "tab-new-dddd");
      expect(watchLines()).toEqual([true]);
      expect(service.sweepIdle(t + 10 + 15_000).map(x => x.slug)).toContain(slug);
      expect(watchLines()).toEqual([true, false]);
      expect(db.prepare("select count(*) as n from remote_spectators").get()).toEqual({ n: 0 });
      // With no watch slot, the admin joins like any invited person (the private table's link is its invite).
      expect(service.join(slug, "g", users[3], "Admin", 1, t + 20_000 + 10).seats.map(x => x.userId)).toContain(users[3]);
    } finally { vi.unstubAllEnvs(); }
  });
  it("an admin who starts or stops watching never makes a player's move stale, and the stop line follows the grace", () => {
    const s = deckSession("normal", false);
    vi.stubEnv("OWNER_USER_IDS", String(s.users[3]));
    try {
      s.select(s.save().id);
      s.service.join(s.room.slug, "g", s.users[1], "Opponent", 1, 2001);
      s.service.ready(s.room.slug, "g", s.users[1], true, 2002); s.start();
      const t = 3000;
      const read = s.service.get(s.room.slug, "g", s.users[0], t);
      // The admin joins after the player read the table and before the player acts.
      s.service.spectate(s.room.slug, "g", s.users[3], t + 1, { admin: true });
      const acted = s.service.act(s.room.slug, "g", s.users[0], { baseSeq: read.lastSeq,
        action: remoteActionSchema.parse({ actorSeat: 0, idempotencyKey: "after-admin-joins", type: "detection.mode", mode: "tap", reason: "slow-offer" }) }, t + 2);
      expect(acted.lastSeq).toBeGreaterThan(read.lastSeq + 1);
      // A real game change in between still makes an old baseSeq stale.
      expect(() => s.service.act(s.room.slug, "g", s.users[0], { baseSeq: read.lastSeq,
        action: remoteActionSchema.parse({ actorSeat: 0, idempotencyKey: "really-stale", type: "detection.mode", mode: "auto", reason: "slow-offer" }) }, t + 3)).toThrow("Stale sequence");
      // Stopping adds a line too and still does not block the next move.
      const read2 = s.service.get(s.room.slug, "g", s.users[0], t + 4);
      s.service.stopSpectating(s.room.slug, "g", s.users[3], t + 5);
      expect(s.service.act(s.room.slug, "g", s.users[0], { baseSeq: read2.lastSeq,
        action: remoteActionSchema.parse({ actorSeat: 0, idempotencyKey: "after-admin-leaves", type: "detection.mode", mode: "auto", reason: "slow-offer" }) }, t + 6).lastSeq).toBeGreaterThan(read2.lastSeq);
    } finally { vi.unstubAllEnvs(); }
  });
  it("refuses a new multi-seat room at the live room cap; solo tables, joins and idle rooms do not count", () => {
    const { service, users, db } = setup();
    db.prepare("update remote_tables set status='ended'").run();
    const base = { guildId: "g", userId: users[0], displayName: "Owner", gameId: "ygo", seatCount: 2 as SeatCount, maxLiveRooms: 1 };
    service.create({ ...base, solo: true }, 2000);
    const first = service.create(base, 2000);
    expect(first.visibility).toBe("private");
    expect(() => service.create(base, 2001)).toThrow("Remote tables are full right now. Try again soon.");
    service.create({ ...base, solo: true }, 2001);
    expect(service.join(first.slug, "g", users[1], "Guest", 1, 2002).seats).toHaveLength(2);
    expect(service.create(base, 2002 + 10 * 60_000).slug).not.toBe(first.slug);
  });

  it.each([2, 3, 4] as SeatCount[])("fills a %i-seat solo table with userless, ready bots and runs the full action loop", seatCount => {
    const { service, users, db } = setup();
    let room = service.create({ guildId: "g", userId: users[0], displayName: "Owner", gameId: "ygo", seatCount, solo: true }, 2000);
    expect(room.solo).toBe(true);
    expect(room.mySeat).toBe(0);
    expect(room.seats).toHaveLength(seatCount);
    expect(room.seats[0]).toMatchObject({ userId: users[0], bot: false });
    expect(room.seats.slice(1).every(s => s.userId === null && s.bot && s.ready && s.displayName.startsWith("Test Bot"))).toBe(true);
    expect(canReadRemote(db, { slug: room.slug, guildId: "g", userId: users[0], seat: 1, expiresAt: 999999 })).toBe(false);
    expect(service.list("g", users[0], "open").some(t => t.slug === room.slug)).toBe(false);
    expect(() => service.join(room.slug, "g", users[1], "Intruder", 1, 2001)).toThrow(/solo/i);
    expect(() => service.get(room.slug, "g", users[1])).toThrow(/not found/i);
    expect(() => service.start(room.slug, "g", users[0], 2001)).toThrow(/ready/i);
    service.ready(room.slug, "g", users[0], true, 2002);
    room = service.start(room.slug, "g", users[0], 2003);
    let n = 0;
    const act = (actorSeat: number, action: Record<string, unknown>) => {
      room = service.act(room.slug, "g", users[0], { baseSeq: room.lastSeq,
        action: remoteActionSchema.parse({ ...action, actorSeat, idempotencyKey: `solo-${seatCount}-${++n}` }) }, 2100 + n);
    };
    act(0, { type: "twin.place", seat: 0, zone: "monster", card: { ref: "blue", name: "Blue-Eyes White Dragon", race: "Dragon", slot: 1 } });
    act(1, { type: "twin.place", seat: 1, zone: "monster", card: { ref: "dark", name: "Dark Magician", slot: 3 } });
    act(1, { type: "twin.flip", seat: 1, cardRef: "dark", faceUp: false });
    act(1, { type: "twin.flip", seat: 1, cardRef: "dark", faceUp: true });
    act(1, { type: "twin.move", seat: 1, cardRef: "dark", zone: "extra-monster", slot: 1 });
    act(0, { type: "card.identified", seat: 0, cardId: 89631139, source: "click" });
    act(1, { type: "lp.change", seat: 1, delta: -500, reason: "Solo correction" });
    const key = room.state.undo!.actionId;
    act(1, { type: "log.note", text: "Bot field adjusted" });
    act(1, { type: "undo", targetActionId: key });
    expect(room.state.seats[1].resources.lp).toBe(8000);
    for (let seat = 0; seat < seatCount; seat++) act(seat, { type: "turn.end" });
    act(0, { type: "phase.set", phase: "battle" });
    const result = ygoModule.resolveAttack(room.state, { text: "my dragon attacks Test Bot 1's magician", players: room.seats }, 0);
    expect(result.status).toBe("unique");
    act(0, result.candidates[0].proposal);
    expect(room.state.attack).toMatchObject({ attackerSeat: 0, targetSeat: 1, targetCardRef: "dark" });
    act(1, { type: "attack.resolve", attackId: room.state.attack!.id, outcome: "resolved" });
    act(1, { type: "twin.remove", seat: 1, cardRef: "dark" });
    expect(service.replay(room.slug, "g", users[0])).toEqual(room.state);
    expect(room.events.filter(e => !e.id.startsWith("sys:")).every(e => e.userId === users[0] && e.action.type !== "table.created")).toBe(true);
    expect(room.events.some(e => e.actorSeat === 1 && e.userId === users[0])).toBe(true);
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });

  it("rejects forged actors and keeps normal twin ownership, idempotency and undo rules", () => {
    const { service, users } = setup();
    let room = service.create({ guildId: "g", userId: users[0], displayName: "Owner", gameId: "ygo", seatCount: 3, solo: true }, 2000);
    service.ready(room.slug, "g", users[0], true, 2001);
    room = service.start(room.slug, "g", users[0], 2002);
    const command = { type: "twin.place" as const, actorSeat: 1, idempotencyKey: "bot-place", seat: 1, zone: "monster", card: { ref: "bot", faceUp: true, position: "attack" as const } };
    expect(() => service.act(room.slug, "g", users[1], { baseSeq: room.lastSeq, action: command }, 2100)).toThrow(/not found/i);
    expect(() => service.act(room.slug, "g", users[0], { baseSeq: room.lastSeq, action: { ...command, actorSeat: 3 } }, 2100)).toThrow(/seat/i);
    expect(() => service.act(room.slug, "g", users[0], { baseSeq: room.lastSeq, action: { ...command, actorSeat: 0 } }, 2100)).toThrow(/owner/i);
    room = service.act(room.slug, "g", users[0], { baseSeq: room.lastSeq, action: command }, 2100);
    expect(service.act(room.slug, "g", users[0], { baseSeq: 0, action: command }, 2200).lastSeq).toBe(room.lastSeq);
    expect(() => service.act(room.slug, "g", users[0], { baseSeq: room.lastSeq, action: { ...command, actorSeat: 2 } }, 2200)).toThrow(/different action/i);
    const before = room;
    room = service.act(room.slug, "g", users[0], { baseSeq: room.lastSeq, action: { type: "player.concede", actorSeat: 0, idempotencyKey: "owner-out" } }, 2300);
    room = service.act(room.slug, "g", users[0], { baseSeq: room.lastSeq, action: { type: "turn.end", actorSeat: 1, idempotencyKey: "bot-turn" } }, 2400);
    expect(room.state.turnSeat).toBe(1);
    expect(before.state.seats[0].eliminated).toBe(false);
    expect(service.replay(room.slug, "g", users[0])).toEqual(room.state);
  });

  it("migrates existing remote rows additively and reruns without changing data", () => {
    const { service, table, users, db } = setup();
    // Recreate the exact pre-solo state: no new column or bot storage.
    db.exec("drop trigger remote_tables_collect; drop table remote_bot_seats; alter table remote_tables drop column solo");
    migrate(db); migrate(db);
    const existing = service.get(table.slug, "g", users[0]);
    expect(existing.solo).toBe(false);
    expect(existing.seats).toHaveLength(1);
    expect(existing.seats[0]).toMatchObject({ bot: false, userId: users[0] });
    expect(existing.events).toEqual(table.events);
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });

  it("lets the owner undo a game-winning bot concession without impersonating a user", () => {
    const { service, users } = setup();
    let room = service.create({ guildId: "g", userId: users[0], displayName: "Owner", gameId: "ygo", seatCount: 2, solo: true }, 2000);
    service.ready(room.slug, "g", users[0], true, 2000); room = service.start(room.slug, "g", users[0], 2000);
    room = service.act(room.slug, "g", users[0], { baseSeq: room.lastSeq, action: { type: "player.concede", actorSeat: 1, idempotencyKey: "bot-loses" } }, 2100);
    expect(room.status).toBe("ended"); expect(room.state.winnerSeat).toBe(0);
    room = service.act(room.slug, "g", users[0], { baseSeq: room.lastSeq, action: { type: "undo", actorSeat: 1, idempotencyKey: "undo-bot-loss", targetActionId: "bot-loses" } }, 7100);
    expect(room.status).toBe("active"); expect(room.state.seats[1].eliminated).toBe(false);
    expect(room.events.at(-1)).toMatchObject({ userId: users[0], actorSeat: 1 });
    expect(service.replay(room.slug, "g", users[0])).toEqual(room.state);
  });

  it("warns and expires solo lobbies and games with the same idle clock", () => {
    const { service, users } = setup();
    const create = () => service.create({ guildId: "g", userId: users[0], displayName: "Owner", gameId: "ygo", seatCount: 2, solo: true }, 2000);
    const lobby = create(); let active = create();
    service.ready(active.slug, "g", users[0], true, 2000); active = service.start(active.slug, "g", users[0], 2000);
    expect(service.sweepIdle(2000 + 8 * 60_000).filter(t => t.solo)).toHaveLength(2);
    expect(service.get(active.slug, "g", users[0]).lastEventAt).toBe(2000);
    expect(service.sweepIdle(2000 + 10 * 60_000).filter(t => t.solo && t.status === "ended")).toHaveLength(2);
    expect(() => service.ready(lobby.slug, "g", users[0], true, 602001)).toThrow(/ended/i);
    expect(() => service.act(active.slug, "g", users[0], { baseSeq: service.get(active.slug, "g", users[0]).lastSeq,
      action: { type: "log.note", actorSeat: 1, idempotencyKey: "late", text: "Too late" } }, 602001)).toThrow(/active/i);
  });
});
describe("remote foundation", () => {
  it("validates the action bus and keeps the reducer pure with FFA battle/turn rules", () => {
    expect(remoteActionSchema.safeParse({ type: "lp.change", actorSeat: 0, idempotencyKey: "bad", seat: 9, delta: -1, reason: "damage" }).success).toBe(false);
    const initial = ygoModule.initialState({ seatCount: 3 });
    expect(initial.seats.map(s => s.resources.lp)).toEqual([8000, 8000, 8000]);
    expect(() => ygoModule.reduce(initial, { type: "phase.set", actorSeat: 1, idempotencyKey: "no", phase: "main1", at: 1000 })).toThrow(/turn/i);
    const proposal: ReturnType<GameModule["parseCommand"]> = { type: "phase.set", actorSeat: 0, phase: "battle" };
    expect(() => ygoModule.reduce(initial, { ...proposal, idempotencyKey: "no-battle", at: 1000 })).toThrow(/battle/i);
    let state = initial;
    for (const seat of [0, 1]) state = ygoModule.reduce(state, { type: "turn.end", actorSeat: seat, idempotencyKey: `turn-${seat}`, at: 1000 });
    state = ygoModule.reduce(state, { type: "phase.set", actorSeat: 2, idempotencyKey: "battle", phase: "battle", at: 1000 });
    expect(state.turnSeat).toBe(2); expect(state.phase).toBe("battle"); expect(initial.turn).toBe(1);
    const hit = ygoModule.reduce(state, { type: "lp.change", actorSeat: 1, idempotencyKey: "hit", seat: 0, delta: -9000, reason: "damage", at: 2000 });
    expect(hit.seats[0].eliminated).toBe(true);
    expect(ygoModule.reduce(hit, { type: "undo", actorSeat: 1, idempotencyKey: "undo", targetActionId: "hit", at: 70000 }).seats[0].resources.lp).toBe(8000);
    expect(() => ygoModule.reduce(hit, { type: "undo", actorSeat: 0, idempotencyKey: "late", targetActionId: "hit", at: 7001 })).toThrow(/undo/i);

    // Match regression: one existing reducer test covers the state and persistence contract.
    let match = ygoModule.initialState({ seatCount: 2 });
    expect(match.match).toMatchObject({ bestOf: 3, phase: "duel", games: [] });
    expect(initial.match.bestOf).toBe(1);
    let serial = 0;
    const step = (payload: Record<string, unknown>, at = 1000 + ++serial) => {
      match = ygoModule.reduce(match, remoteActionSchema.parse({ actorSeat: 0, idempotencyKey: `match-${++serial}`, at, ...payload }));
      return match;
    };
    step({ type: "lp.change", seat: 1, delta: -8000, reason: "damage" });
    expect(match.match).toMatchObject({ phase: "result", games: [{ n: 1, winnerSeat: 0, reason: "lp" }], firstChooser: 1 });
    const winningAction = match.undo!.actionId;
    step({ type: "undo", targetActionId: winningAction });
    expect(match.match.games).toEqual([]);
    step({ type: "lp.change", seat: 1, delta: -8000, reason: "damage" });
    step({ type: "match.continue", actorSeat: 1 }, 2000);
    expect(match.match.siding).toEqual({ deadline: 182000, seatDeadlines: { 0: 182000, 1: 182000 }, ready: [], extendedFor: [] });
    expect(() => step({ type: "side.ready", seat: 1 }, 2001)).toThrow(/own|owner/i);
    const notDue = match;
    expect(step({ type: "side.timeout" }, 2001)).toBe(notDue);
    expect(() => step({ type: "match.first", seatGoesFirst: 1 }, 2001)).toThrow(/choose|loser/i);
    step({ type: "side.ready", seat: 0 }, 2002);
    const historicReady = ygoModule.reduce(match, { type: "side.ready", actorSeat: 1, seat: 1, idempotencyKey: "historic-ready", at: 2003 }, { replay: true });
    expect(historicReady.match.siding?.firstChoiceDeadline).toBeUndefined();
    const historicChoice = ygoModule.reduce(historicReady, { type: "match.first", actorSeat: 1, seatGoesFirst: 0, idempotencyKey: "historic-choice", at: 50000 }, { replay: true });
    expect(historicChoice.match.phase).toBe("duel");
    step({ type: "side.ready", actorSeat: 1, seat: 1 }, 2003);
    expect(match.match.phase).toBe("siding");
    expect(match.match.siding).toHaveProperty("firstChoiceDeadline", 22003);
    const timeout = (at: number) => ygoModule.reduce(match, { type: "side.timeout", actorSeat: 0, idempotencyKey: `choice-timeout-${at}`, at });
    expect(timeout(22002)).toBe(match);
    const defaultFirst = timeout(22003);
    expect(defaultFirst).toMatchObject({ turnSeat: 1, ended: false, match: { phase: "duel" } });
    expect(defaultFirst.match.siding).toBeUndefined();
    const unready = ygoModule.reduce(match, { type: "side.unready", actorSeat: 0, seat: 0, idempotencyKey: "choice-unready", at: 2004 });
    expect(unready.match.siding?.firstChoiceDeadline).toBeUndefined();
    expect(() => ygoModule.reduce(match, { type: "match.first", actorSeat: 1, seatGoesFirst: 0, idempotencyKey: "late-choice", at: 22003 })).toThrow(/deadline/i);
    step({ type: "match.first", actorSeat: 1, seatGoesFirst: 1 }, 2004);
    expect(match).toMatchObject({ phase: "draw", turn: 1, turnSeat: 1, startedSeats: [1], ended: false, undo: null });
    expect(match.seats.map(s => s.resources.lp)).toEqual([8000, 8000]);
    expect(() => step({ type: "undo", targetActionId: winningAction }, 2005)).toThrow(/undo/i);
    step({ type: "lp.change", actorSeat: 1, seat: 0, delta: -100, reason: "effect" }, 2099);
    const otherSeatAction = match.undo!.actionId;
    const declarationHistory = structuredClone(match.undoHistory);
    step({ type: "match.declare", winnerSeat: null }, 2100);
    expect(match.undoHistory).toEqual(declarationHistory);
    let declarationId = match.match.pendingResult!.id;
    expect(match.match.games).toHaveLength(1);
    expect(() => step({ type: "match.confirm", declarationId, accept: true }, 2101)).toThrow(/confirm/i);
    step({ type: "match.confirm", actorSeat: 1, declarationId, accept: false }, 2102);
    expect(match.match.pendingResult).toBeUndefined();
    expect(match.undoHistory).toEqual(declarationHistory);
    step({ type: "undo", actorSeat: 1, targetActionId: otherSeatAction }, 2102);
    expect(match.seats[0].resources.lp).toBe(8000);
    step({ type: "match.declare", winnerSeat: null }, 2103);
    declarationId = match.match.pendingResult!.id;
    expect(() => step({ type: "match.confirm", actorSeat: 1, declarationId: "stale", accept: true }, 2104)).toThrow(/declaration/i);
    step({ type: "match.confirm", actorSeat: 1, declarationId, accept: true }, 2105);
    expect(match.match.games[1]).toMatchObject({ n: 2, winnerSeat: null, reason: "declared", endedAt: 2105 });
    step({ type: "match.continue" }, 2200);
    step({ type: "side.timeout" }, 182200);
    expect(match.turnSeat).toBe(1);
    step({ type: "player.concede", actorSeat: 1 }, 182201);
    expect(match.match).toMatchObject({ phase: "done", winnerSeat: 0 });
    expect(match.match.games.map(g => g.reason)).toEqual(["lp", "declared", "concede"]);
    expect(() => step({ type: "match.continue" }, 182202)).toThrow(/result|done/i);
    let one = ygoModule.initialState({ seatCount: 2, bestOf: 1 });
    one = ygoModule.reduce(one, remoteActionSchema.parse({ type: "match.declare", winnerSeat: null, actorSeat: 0, idempotencyKey: "bo1-declare", at: 1 }));
    one = ygoModule.reduce(one, remoteActionSchema.parse({ type: "match.confirm", declarationId: "bo1-declare", accept: true, actorSeat: 1, idempotencyKey: "bo1-confirm", at: 2 }));
    expect(one.match).toMatchObject({ phase: "done", winnerSeat: null });

    let historicFfa = ygoModule.initialState({ seatCount: 3 });
    const historicStep = (action: RemoteAction) => historicFfa = ygoModule.reduce(historicFfa, action, { replay: true, undoVersion: 1 });
    historicStep({ type: "player.concede", actorSeat: 0, idempotencyKey: "historic-out", at: 1 });
    historicStep({ type: "match.declare", actorSeat: 0, winnerSeat: 2, idempotencyKey: "historic-declare", at: 2 });
    historicStep({ type: "match.confirm", actorSeat: 1, declarationId: "historic-declare", accept: true, idempotencyKey: "historic-confirm-1", at: 3 });
    expect(historicFfa.match.phase).toBe("duel");
    historicStep({ type: "match.confirm", actorSeat: 2, declarationId: "historic-declare", accept: true, idempotencyKey: "historic-confirm-2", at: 4 });
    expect(historicFfa.match).toMatchObject({ phase: "done", winnerSeat: 2 });

    let ffa = ygoModule.initialState({ seatCount: 3 });
    ffa = ygoModule.reduce(ffa, { type: "player.concede", actorSeat: 0, idempotencyKey: "ffa-a", at: 1 });
    ffa = ygoModule.reduce(ffa, { type: "player.concede", actorSeat: 1, idempotencyKey: "ffa-b", at: 2 });
    const legacy = JSON.parse(JSON.stringify(ffa, (key, value) => key === "match" ? undefined : value));
    const legacyUndo = ygoModule.reduce(legacy, { type: "undo", actorSeat: 0, idempotencyKey: "legacy-undo", targetActionId: "ffa-a", at: 3 });
    expect(legacyUndo).toMatchObject({ ended: false, winnerSeat: null, match: { bestOf: 1, phase: "duel", games: [] } });
    ffa = ygoModule.reduce(ffa, { type: "undo", actorSeat: 0, idempotencyKey: "ffa-undo", targetActionId: "ffa-a", at: 3 });
    expect(ffa).toMatchObject({ ended: false, winnerSeat: null, match: { phase: "duel", games: [] } });
    ffa = ygoModule.reduce(ffa, { type: "undo", actorSeat: 1, idempotencyKey: "ffa-undo-b", targetActionId: "ffa-b", at: 4 });
    expect(ffa.seats.every(s => !s.eliminated)).toBe(true);
    expect(ffa.match).toMatchObject({ phase: "duel", games: [] });

    const { db, users, service } = setup();
    let solo = service.create({ guildId: "g", userId: users[0], displayName: "Solo", gameId: "ygo", seatCount: 2, solo: true }, 3000);
    expect(solo.bestOf).toBe(1);
    expect(service.replay(solo.slug, "g", users[0])).toEqual(solo.state);
    solo = service.configure(solo.slug, "g", users[0], { bestOf: 3 }, 3000);
    service.ready(solo.slug, "g", users[0], true, 3000); solo = service.start(solo.slug, "g", users[0], 3000);
    const soloAct = (action: RemoteAction, at: number) => solo = service.act(solo.slug, "g", users[0], { baseSeq: solo.lastSeq, action }, at);
    soloAct({ type: "player.concede", actorSeat: 1, idempotencyKey: "solo-game" }, 3000);
    soloAct({ type: "match.continue", actorSeat: 0, idempotencyKey: "solo-side" }, 3000);
    soloAct({ type: "side.ready", actorSeat: 0, seat: 0, idempotencyKey: "solo-ready" }, 3000);
    expect(solo.state.match.siding).toMatchObject({ ready: [0, 1], startAt: 8000 });
    expect(service.replay(solo.slug, "g", users[0])).toEqual(solo.state);
    expect(service.sweepIdle(7999).map(t => t.slug)).not.toContain(solo.slug);
    expect(service.sweepIdle(8000).map(t => t.slug)).toContain(solo.slug);
    solo = service.get(solo.slug, "g", users[0]);
    expect(solo.state).toMatchObject({ turnSeat: 1, ended: false, match: { phase: "duel" } });
    expect(service.replay(solo.slug, "g", users[0])).toEqual(solo.state);

    let room = service.create({ guildId: "g", userId: users[0], displayName: "A", gameId: "ygo", seatCount: 2 }, 3000);
    expect(room.bestOf).toBe(3);
    room = service.join(room.slug, "g", users[1], "B", 1, 3000);
    expect(() => service.configure(room.slug, "g", users[0], { bestOf: 5 as never }, 3001)).toThrow(/best|match/i);
    room = service.configure(room.slug, "g", users[0], { bestOf: 1 }, 3001);
    expect(service.replay(room.slug, "g", users[0])).toEqual(room.state);
    room = service.configure(room.slug, "g", users[0], { bestOf: 3 }, 3002);
    const saved = createSavedDeckService(db, new Map([[101, { name: "Fusion", type: 0x41 }]])).create("g", users[0], { name: "Siding", mode: "normal", deck: { main: Array.from({ length: 40 }, (_, i) => i + 1), extra: [101], side: [41] } });
    room = service.selectDeck(room.slug, "g", users[0], { savedDeckId: saved.id }, 3003);
    for (const user of users.slice(0, 2)) service.ready(room.slug, "g", user, true, 3004);
    room = service.start(room.slug, "g", users[0], 3005);
    const act = (payload: Record<string, unknown>, at: number) => {
      service.act(room.slug, "g", users[Number(payload.actorSeat ?? 0)], { baseSeq: room.lastSeq, action: remoteActionSchema.parse({ actorSeat: 0, idempotencyKey: `stored-match-${++serial}`, at: 99999999, ...payload }) }, at);
      return room = service.get(room.slug, "g", users[0]);
    };
    act({ type: "twin.place", seat: 0, zone: "graveyard", card: { ref: "old-card", cardId: 1 } }, 3006);
    act({ type: "player.concede", actorSeat: 1 }, 3007);
    expect(room.status).toBe("active");
    const concessionId = room.state.undo!.actionId;
    act({ type: "match.continue", actorSeat: 1 }, 3010);
    expect(room.state.match.siding).toEqual({ deadline: 303010, seatDeadlines: { 0: 303010, 1: 183010 }, ready: [], extendedFor: [0] });
    const before = room.state.deckChecks.registrations[0]!.deck;
    const deckChanges = { main: [41, ...before.main.slice(1)], extra: [101], side: [1] };
    expect(() => act({ type: "side.swap", deckChanges: { ...deckChanges, main: [42, ...before.main.slice(1)] } }, 3011)).toThrow(/same cards/i);
    expect(() => act({ type: "side.swap", deckChanges: { main: [...before.main, 41], extra: [101], side: [] } }, 3011)).toThrow(/size|number|count/i);
    expect(() => act({ type: "side.swap", actorSeat: 1, deckChanges }, 3011)).toThrow(/deck/i);
    expect(() => act({ type: "side.swap", deckChanges: { main: [101, ...before.main.slice(1)], extra: [41], side: [1] } }, 3011)).toThrow(/extra|main|deck/i);
    act({ type: "side.ready", seat: 0 }, 3012);
    act({ type: "side.swap", deckChanges }, 3013);
    expect(room.state.match.siding!.ready).toEqual([]);
    expect(room.state.deckChecks.registrations[0]!.deck).toEqual(deckChanges);
    expect(createSavedDeckService(db, new Map()).get(saved.id, "g", users[0]).deck).toEqual(before);
    const publicSnapshot = service.snapshot(room.slug, "g");
    expect(publicSnapshot.state.deckChecks.registrations).toEqual({});
    expect(publicSnapshot.events.some(e => e.action.type === "side.swap")).toBe(false);
    expect(service.replay(room.slug, "g", users[0])).toEqual(room.state);
    act({ type: "side.ready", seat: 0 }, 3014);
    act({ type: "side.unready", seat: 0 }, 3015);
    expect(service.sweepIdle(183010).map(t => t.slug)).toContain(room.slug);
    room = service.get(room.slug, "g", users[0]);
    expect(room.state.match.siding!.ready).toEqual([1]);
    expect(() => act({ type: "side.unready", actorSeat: 1, seat: 1 }, 183011)).toThrow(/deadline/i);
    const unchangedSeq = room.lastSeq, unchangedAt = room.lastEventAt;
    room = service.act(room.slug, "g", users[0], { baseSeq: 0, action: { type: "side.timeout", actorSeat: 0, idempotencyKey: "stale-timeout-noop" } }, 183011);
    expect(room.lastSeq).toBe(unchangedSeq);
    expect(room.lastEventAt).toBe(unchangedAt);
    act({ type: "match.first", actorSeat: 1, seatGoesFirst: 0 }, 183012);
    act({ type: "side.ready", seat: 0 }, 183013);
    expect(room.state.match.siding).toMatchObject({ ready: [1, 0], startAt: 188013 });
    expect(service.sweepIdle(188012).map(t => t.slug)).not.toContain(room.slug);
    expect(service.sweepIdle(188013).map(t => t.slug)).toContain(room.slug);
    room = service.get(room.slug, "g", users[0]);
    expect(room.state).toMatchObject({ phase: "draw", turn: 1, turnSeat: 0, attack: null, identified: null, ended: false });
    expect(room.state.seats.every(s => !s.eliminated && !s.twin.length && s.resources.lp === 8000)).toBe(true);
    expect(room.state.deckChecks.instances).toEqual([]);
    expect(room.state.deckChecks.flags).toEqual([]);
    expect(room.state.deckChecks.registrations[0]!.deck).toEqual(deckChanges);
    expect(() => act({ type: "undo", targetActionId: concessionId }, 188014)).toThrow(/undo/i);
    expect(service.replay(room.slug, "g", users[0])).toEqual(room.state);
    act({ type: "match.declare", winnerSeat: null }, 188015);
    act({ type: "match.confirm", actorSeat: 1, declarationId: room.state.match.pendingResult!.id, accept: true }, 188016);
    act({ type: "match.continue" }, 188017);
    const staleSeq = room.lastSeq;
    room = service.act(room.slug, "g", users[0], { baseSeq: 0, action: { type: "side.timeout", actorSeat: 0, idempotencyKey: "stale-timeout-due" } }, 488017);
    expect(room.lastSeq).toBe(staleSeq + 1);
    room = service.act(room.slug, "g", users[0], { baseSeq: staleSeq, action: { type: "side.timeout", actorSeat: 0, idempotencyKey: "duplicate-timeout" } }, 488017);
    expect(room.lastSeq).toBe(staleSeq + 1);
    expect(service.sweepIdle(488017).map(t => t.slug)).not.toContain(room.slug);
    room = service.get(room.slug, "g", users[0]);
    expect(room.state).toMatchObject({ turnSeat: 0, ended: false, match: { phase: "duel" } });
    expect(service.replay(room.slug, "g", users[0])).toEqual(room.state);
    act({ type: "player.concede", actorSeat: 1 }, 488018);
    expect(room.status).toBe("ended");
    expect(room.state.match).toMatchObject({ phase: "done", winnerSeat: 0 });
    expect(service.replay(room.slug, "g", users[0])).toEqual(room.state);
    const endedSeq = room.lastSeq;
    room = service.act(room.slug, "g", users[0], { baseSeq: 0, action: { type: "side.timeout", actorSeat: 0, idempotencyKey: "ended-timeout" } }, 488019);
    expect(room.lastSeq).toBe(endedSeq);
    expect(service.list("g", users[0]).find(t => t.slug === room.slug)?.bestOf).toBe(3);
    const physical = service.create({ guildId: "g", userId: users[0], displayName: "A", gameId: "ygo", seatCount: 3 }, 500000);
    for (const seat of [1, 2]) service.join(physical.slug, "g", users[seat], `Player ${seat}`, seat, 500001);
    for (const user of users.slice(0, 3)) service.ready(physical.slug, "g", user, true, 500002);
    let all = service.start(physical.slug, "g", users[0], 500003);
    const confirmAll = (payload: Record<string, unknown>, seat: number, at: number) => all = service.act(all.slug, "g", users[seat], { baseSeq: all.lastSeq, action: remoteActionSchema.parse({ actorSeat: seat, idempotencyKey: `physical-${++serial}`, ...payload }) }, at);
    confirmAll({ type: "player.concede" }, 0, 500004);
    expect(() => confirmAll({ type: "match.declare", winnerSeat: 2 }, 0, 500004)).toThrow(/eliminated/i);
    confirmAll({ type: "match.declare", winnerSeat: 2 }, 1, 500004);
    const ffaDeclaration = all.state.match.pendingResult!.id;
    expect(() => confirmAll({ type: "match.confirm", declarationId: ffaDeclaration, accept: true }, 3, 500005)).toThrow(/not found|seat/i);
    expect(() => confirmAll({ type: "match.confirm", declarationId: ffaDeclaration, accept: false }, 0, 500005)).toThrow(/eliminated/i);
    expect(all.state.ended).toBe(false);
    confirmAll({ type: "match.confirm", declarationId: ffaDeclaration, accept: true }, 2, 500006);
    expect(all.state.match).toMatchObject({ phase: "done", winnerSeat: 2, games: [{ reason: "declared" }] });
    expect(service.replay(all.slug, "g", users[2])).toEqual(all.state);
  });
  it("scopes admission, starts a ready table, deduplicates retries and replays events", () => {
    const { service, table, users, db } = setup();
    expect(() => service.get(table.slug, "other", users[0])).toThrow(/not found/i);
    expect(() => service.get(table.slug, "g", users[3])).toThrow(/not found/i);
    service.join(table.slug, "g", users[1], "B", 1, 1100);
    registerTestDeck(db, service, table.slug, users[1], 1100);
    service.join(table.slug, "g", users[2], "C", 2, 1200);
    registerTestDeck(db, service, table.slug, users[2], 1200);
    for (const user of users.slice(0, 3)) service.ready(table.slug, "g", user, true, 1300);
    let room = service.start(table.slug, "g", users[0], 1400);
    const command = { type: "lp.change" as const, actorSeat: 0, idempotencyKey: "hit", seat: 1, delta: -500, reason: "effect" };
    room = service.act(table.slug, "g", users[0], { baseSeq: room.lastSeq, action: command }, 2000);
    expect(room.state.seats[1].resources.lp).toBe(7500);
    const retry = service.act(table.slug, "g", users[0], { baseSeq: 0, action: command }, 3000);
    expect(retry.lastSeq).toBe(room.lastSeq);
    expect(() => service.act(table.slug, "g", users[1], { baseSeq: room.lastSeq, action: { ...command, idempotencyKey: "spoof" } }, 3000)).toThrow(/seat/i);
    expect(() => service.act(table.slug, "g", users[0], { baseSeq: 0, action: { ...command, idempotencyKey: "stale" } }, 3000)).toThrow(/sequence/i);
    expect(service.replay(table.slug, "g", users[0])).toEqual(room.state);
    expect((db.prepare("select count(*) as n from remote_events where idempotency_key='hit'").get() as { n: number }).n).toBe(1);
    expect(() => db.prepare("delete from remote_events").run()).toThrow(/append.only/i);
  });
  it("warns at eight minutes and closes at ten without warning renewing activity", () => {
    const { service, table, users, db } = setup();
    expect(service.sweepIdle(1000 + 8 * 60_000 - 1)).toHaveLength(0);
    expect(service.sweepIdle(1000 + 8 * 60_000)).toHaveLength(1);
    expect(service.get(table.slug, "g", users[0]).lastEventAt).toBe(1000);
    expect(service.sweepIdle(1000 + 9 * 60_000)).toHaveLength(0);
    expect(service.sweepIdle(1000 + 10 * 60_000)[0].status).toBe("ended");
  });
  it("keeps a table open while a seated player reports activity, and refuses others and ended tables", () => {
    const { service, table, users } = setup();
    expect(service.sweepIdle(1000 + 8 * 60_000)).toHaveLength(1);
    const seq = service.get(table.slug, "g", users[0]).lastSeq;
    service.touch(table.slug, "g", users[0], 1000 + 9 * 60_000);
    const room = service.get(table.slug, "g", users[0]);
    expect(room.lastEventAt).toBe(1000 + 9 * 60_000); expect(room.idleWarningAt).toBeNull(); expect(room.lastSeq).toBe(seq);
    expect(service.sweepIdle(1000 + 10 * 60_000)).toHaveLength(0);
    expect(service.sweepIdle(1000 + 19 * 60_000)[0].status).toBe("ended");
    expect(() => service.touch(table.slug, "g", users[0], 1000 + 19 * 60_000 + 1)).toThrow(/ended/i);
  });
});

describe("remote board and transactional edge cases", () => {
  it("supports all twin, identification and attack actions without inferring battle damage", () => {
    let state = ygoModule.initialState({ seatCount: 2 }); let n = 0;
    const act = (action: Record<string, unknown>, actorSeat = 0) => {
      state = ygoModule.reduce(state, remoteActionSchema.parse({ ...action, actorSeat, idempotencyKey: `a${++n}`, at: n * 100 }));
    };
    act({ type: "twin.place", seat: 0, zone: "monster", card: { ref: "blue", cardId: 89631139 } });
    act({ type: "twin.flip", seat: 0, cardRef: "blue", faceUp: false });
    expect(state.seats[0].twin[0].faceUp).toBe(false);
    act({ type: "twin.move", seat: 0, cardRef: "blue", zone: "graveyard" });
    expect(state.seats[0].twin[0].zone).toBe("graveyard");
    expect(() => ygoModule.reduce(state, { type: "twin.remove", seat: 0, actorSeat: 1, cardRef: "blue", idempotencyKey: "theft" })).toThrow(/owner/);
    act({ type: "card.identified", seat: 1, passcode: 46986414, source: "auto" });
    expect(state.identified?.passcode).toBe(46986414);
    act({ type: "turn.end" });
    act({ type: "phase.set", phase: "battle" }, 1);
    act({ type: "attack.declare", attackerSeat: 1, targetSeat: 0, direct: true }, 1);
    const attackId = state.attack!.id;
    act({ type: "attack.resolve", attackId, outcome: "resolved" });
    expect(state.attack).toBeNull(); expect(state.seats[0].resources.lp).toBe(8000);
    act({ type: "twin.remove", seat: 0, cardRef: "blue" });
    act({ type: "log.note", text: "Agreed correction" });
    expect(state.seats[0].twin).toEqual([]);
  });
  it("skips opening Battle phases, preserves fixed FFA seats and skips eliminated future turns", () => {
    let state = ygoModule.initialState({ seatCount: 4 });
    for (let i = 0; i < 3; i++) {
      state = ygoModule.reduce(state, { type: "phase.advance", actorSeat: 0, idempotencyKey: `p${i}` });
    }
    expect(state.phase).toBe("main2");
    state = ygoModule.reduce(state, { type: "player.concede", actorSeat: 1, idempotencyKey: "leave" });
    state = ygoModule.reduce(state, { type: "turn.end", actorSeat: 0, idempotencyKey: "next" });
    expect(state.turnSeat).toBe(2);
    state = ygoModule.reduce(state, { type: "turn.end", actorSeat: 2, idempotencyKey: "next2" });
    state = ygoModule.reduce(state, { type: "phase.set", actorSeat: 3, idempotencyKey: "battle", phase: "battle" });
    expect(state.seats.map(s => s.seat)).toEqual([0, 1, 2, 3]); expect(state.phase).toBe("battle");
  });
  it("guards readiness, occupied seats and key reuse, and allows undo of a winning action", () => {
    const { service, table, users, db } = setup();
    expect(() => service.start(table.slug, "g", users[0], 1100)).toThrow(/ready/);
    service.join(table.slug, "g", users[1], "B", 1, 1100);
    registerTestDeck(db, service, table.slug, users[1], 1100);
    expect(() => service.join(table.slug, "g", users[2], "C", 1, 1100)).toThrow(/seat/i);
    service.join(table.slug, "g", users[2], "C", 2, 1100);
    registerTestDeck(db, service, table.slug, users[2], 1100);
    users.slice(0, 3).forEach(user => service.ready(table.slug, "g", user, true, 1200));
    let room = service.start(table.slug, "g", users[0], 1300);
    for (const seat of [1, 2]) room = service.act(table.slug, "g", users[seat], { baseSeq: room.lastSeq,
      action: { type: "player.concede", actorSeat: seat, idempotencyKey: `concede${seat}`, at: 1 } }, 2000 + seat);
    expect(room.status).toBe("ended"); expect(room.state.winnerSeat).toBe(0);
    expect(room.state.updatedAt).toBe(2002);
    room = service.act(table.slug, "g", users[2], { baseSeq: room.lastSeq,
      action: { type: "undo", actorSeat: 2, idempotencyKey: "undo-win", targetActionId: "concede2" } }, 3000);
    expect(room.status).toBe("active");
    expect(() => service.act(table.slug, "g", users[2], { baseSeq: room.lastSeq,
      action: { type: "log.note", actorSeat: 2, idempotencyKey: "undo-win", text: "different" } }, 3001)).toThrow(/different action/);
    expect(service.replay(table.slug, "g", users[2])).toEqual(room.state);
  });
});

import { canReadRemote } from "../../src/services/remote-access.js";
it("revokes departed seat tokens and keeps the final game snapshot readable to stored members", () => {
  const { service, table, users, db } = setup();
  const claims = { slug: table.slug, guildId: "g", userId: users[1], seat: 1, expiresAt: 999999 };
  expect(canReadRemote(db, claims)).toBe(false);
  service.join(table.slug, "g", users[1], "B", 1, 1100);
    registerTestDeck(db, service, table.slug, users[1], 1100);
  expect(canReadRemote(db, claims)).toBe(true);
  expect(canReadRemote(db, { ...claims, guildId: "other" })).toBe(false);
  expect(canReadRemote(db, { ...claims, seat: 2 })).toBe(false);
  service.leave(table.slug, "g", users[1], 1200);
  expect(canReadRemote(db, claims)).toBe(false);
  service.join(table.slug, "g", users[2], "C", 1, 1300);
  registerTestDeck(db, service, table.slug, users[2], 1300);
  expect(canReadRemote(db, claims)).toBe(false);
  const final = service.leave(table.slug, "g", users[0], 1400);
  expect(final.status).toBe("ended");
  expect(canReadRemote(db, { ...claims, userId: users[0], seat: 0 })).toBe(true);
  expect(service.snapshot(table.slug, "g").table.status).toBe("ended");
});

describe("tolerant voice attack resolution", () => {
  const players = [
    { seat: 0, displayName: "Alex", nicknames: ["Al"] },
    { seat: 1, displayName: "Imran Khan", nicknames: ["Immy"] },
    { seat: 2, displayName: "Sara", nicknames: ["Saz"] },
  ];
  function board(seatCount: 2 | 3 | 4 = 2) {
    let state = ygoModule.initialState({ seatCount });
    let seq = 0;
    const place = (seat: number, card: Record<string, unknown>, zone = "monster") => {
      state = ygoModule.reduce(state, remoteActionSchema.parse({
        type: "twin.place", actorSeat: seat, seat, zone, card,anotherCopy:true,copyProof:{simultaneousQuads:Math.max(2,state.seats[seat].twin.length+1),at:state.updatedAt},
        idempotencyKey: `voice-${++seq}`,
      }));
    };
    place(0, { ref: "blue", name: "Blue-Eyes White Dragon", race: "Dragon", slot: 1, cardId: 89631139 });
    place(1, { ref: "dark", name: "Dark Magician", race: "Spellcaster", slot: 3, cardId: 46986414 });
    return { get state() { return state; }, place };
  }
  const resolve = (state: ReturnType<typeof ygoModule.initialState>, text: string, actorSeat = 0) =>
    ygoModule.resolveAttack(state, { text, players }, actorSeat);

  it.each([
    "Blue Eyes attacks the magician",
    "my dragon attacks his monster",
    "my dragon attacks her monster",
    "my dragon attacks their monster",
    "blew eyes attacks dark magishun",
    "Blue Ice attacks Dark Magician",
    "Blue Eyex attacks Dark Magiciat",
    "Bule Eyes attacks the magican",
    "my drag attacks the mag",
  ])("proposes one matching field pair for '%s'", text => {
    const b = board();
    const before = structuredClone(b.state);
    const result = resolve(b.state, text);
    expect(result.status).toBe("unique");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].proposal).toEqual({
      type: "attack.declare", actorSeat: 0, attackerSeat: 0, attackerCardRef: "blue", targetSeat: 1, targetCardRef: "dark",
    });
    expect(result.candidates[0].score).toBeGreaterThan(0);
    expect(result.candidates[0].score).toBeLessThanOrEqual(1);
    expect(b.state).toEqual(before);
    expect(resolve(b.state, text)).toEqual(result);
  });

  it.each(["attack Imran's dragon", "attack Immy’s dragon", "attack Imran Khan's dragon"])("scopes '%s' by current player names/nicknames", text => {
    const b = board(3);
    b.place(1, { ref: "red", name: "Red-Eyes Black Dragon", race: "Dragon", slot: 5 });
    b.place(2, { ref: "sara-dragon", name: "Stardust Dragon", race: "Dragon", slot: 1 });
    const result = resolve(b.state, text);
    expect(result.status).toBe("unique");
    expect(result.candidates[0].proposal).toMatchObject({ targetSeat: 1, targetCardRef: "red" });
  });

  it("matches race words even when absent from the printed card name", () => {
    const b = board();
    b.place(0, { ref: "buster", name: "Buster Blader", race: "Warrior", slot: 5 });
    const result = resolve(b.state, "my warrior attacks his spellcaster");
    expect(result.status).toBe("unique");
    expect(result.candidates[0].proposal).toMatchObject({ attackerCardRef: "buster", targetCardRef: "dark" });
  });

  it("returns all fitting pairs ranked for quick pick instead of silently selecting the highest score", () => {
    const b = board();
    b.place(0, { ref: "dragonling", name: "Dragonling", race: "Dragon", slot: 5 });
    b.place(1, { ref: "magician-girl", name: "Dark Magician Girl", race: "Spellcaster", slot: 5 });
    const result = resolve(b.state, "my dragon attacks Dark Magician");
    expect(result.status).toBe("ambiguous");
    expect(result.candidates).toHaveLength(4);
    expect(result.candidates[0].proposal.targetCardRef).toBe("dark");
    expect(result.candidates.map(c => c.score)).toEqual(result.candidates.map(c => c.score).sort((a, b) => b - a));
    expect(new Set(result.candidates.map(c => `${c.proposal.attackerCardRef}/${c.proposal.targetCardRef}`)).size).toBe(4);
  });

  it.each([
    ["my left monster attacks the middle monster", "blue", "dark"],
    ["my right dragon attacks the right monster", "red", "girl"],
    ["my zone 1 attacks zone 3", "blue", "dark"],
    ["my zone five attacks zone five", "red", "girl"],
  ])("uses fixed owner-view field positions in '%s'", (text, attackerCardRef, targetCardRef) => {
    const b = board();
    b.place(0, { ref: "red", name: "Red-Eyes Black Dragon", race: "Dragon", slot: 5 });
    b.place(1, { ref: "girl", name: "Dark Magician Girl", race: "Spellcaster", slot: 5 });
    const result = resolve(b.state, text);
    expect(result.status).toBe("unique");
    expect(result.candidates[0].proposal).toMatchObject({ attackerCardRef, targetCardRef });
  });

  it("accepts parsed hints and keeps explicit refs/seat/slot constraints conjunctive", () => {
    const b = board(3);
    b.place(1, { ref: "red", name: "Red-Eyes Black Dragon", race: "Dragon", slot: 5 });
    const result = ygoModule.resolveAttack(b.state, {
      attacker: { cardRef: "blue" }, target: { text: "dragon", slot: 5 }, targetSeat: 1,
    }, 0);
    expect(result.status).toBe("unique");
    expect(result.candidates[0].proposal).toMatchObject({ attackerCardRef: "blue", targetCardRef: "red", targetSeat: 1 });
    expect(ygoModule.resolveAttack(b.state, { attacker: { cardRef: "blue", slot: 5 }, targetSeat: 1 }, 0).status).toBe("none");
    expect(ygoModule.resolveAttack(b.state, { targetSeat: 2, targetPlayer: "Imran", players }, 0).status).toBe("none");
  });

  it.each([1, 2, 3, 4, 5])("resolves zone %i without depending on twin array order", slot => {
    const b = board();
    if (slot === 3) b.state.seats[1].twin[0].slot = 4;
    b.place(1, { ref: `slot-${slot}`, slot });
    const state = structuredClone(b.state);
    state.seats[1].twin.reverse();
    const result = resolve(state, `my dragon attacks zone ${slot}`);
    expect(result.candidates.some(c => c.proposal.targetCardRef === `slot-${slot}`)).toBe(true);
    expect(result.status).toBe("unique");
  });
  it("keeps legacy conflicting same-slot targets ambiguous", () => {
    const b = board();
    b.place(1, { ref: "legacy-duplicate", slot: 4 });
    b.state.seats[1].twin.find(card => card.ref === "legacy-duplicate")!.slot = 3;
    const result = resolve(b.state, "my dragon attacks zone 3");
    expect(result.status).toBe("ambiguous");
    expect(result.candidates.some(c => c.proposal.targetCardRef === "legacy-duplicate")).toBe(true);
  });

  it("keeps legacy twins useful without catalog metadata and exposes the registry hook", () => {
    const state = ygoModule.initialState({ seatCount: 2 });
    state.seats[0].twin.push({ ref: "old-own", zone: "monster", cardId: 89631139, faceUp: true, position: "attack" });
    state.seats[1].twin.push({ ref: "old-other", zone: "monster", faceUp: false, position: "defense" });
    expect(getRemoteGame("ygo").resolveAttack).toBe(resolveAttack);
    expect(resolveAttack(state, "my monster attacks their monster", 0).status).toBe("unique");
    expect(resolveAttack(state, "Blue Eyes attacks their monster", 0).status).toBe("none");
    expect(resolveAttack(state, "my monster attacks the left monster", 0).status).toBe("none");
  });

  it("bounds public metadata at the shared action boundary", () => {
    const place = (card: Record<string, unknown>) => remoteActionSchema.safeParse({
      type: "twin.place", actorSeat: 0, seat: 0, zone: "monster", idempotencyKey: "metadata", card: { ref: "bounded", ...card },
    }).success;
    for (const slot of [0, 6, 1.5, Number.NaN]) expect(place({ slot })).toBe(false);
    expect(place({ name: " " })).toBe(false);
    expect(place({ name: "x".repeat(201) })).toBe(false);
    expect(place({ race: "x".repeat(41) })).toBe(false);
    expect(place({ name: "Blue-Eyes White Dragon", race: "Dragon", slot: 5 })).toBe(true);
  });

  it("keeps unnamed FFA opponents and duplicate nicknames ambiguous", () => {
    const b = board(3);
    b.place(2, { ref: "sara-dragon", name: "Stardust Dragon", race: "Dragon", slot: 1 });
    expect(resolve(b.state, "my dragon attacks his monster").candidates.map(c => c.proposal.targetSeat)).toEqual([1, 2]);
    const result = ygoModule.resolveAttack(b.state, {
      text: "my dragon attacks Sam's monster",
      players: [{ seat: 1, displayName: "Sam" }, { seat: 2, displayName: "Sara", nicknames: ["Sam"] }],
    }, 0);
    expect(result.status).toBe("ambiguous");
    expect(result.candidates).toHaveLength(2);
    const reordered = structuredClone(b.state);
    reordered.seats.reverse();
    for (const seat of reordered.seats) seat.twin.reverse();
    expect(resolve(reordered, "my dragon attacks their monster")).toEqual(resolve(b.state, "my dragon attacks their monster"));
  });

  it("keeps player names that overlap card words from consuming card references", () => {
    const b = board(3);
    const result = ygoModule.resolveAttack(b.state, {
      text: "Blue Eyes attacks Dark Magician",
      players: [{ seat: 0, displayName: "Blue" }, { seat: 2, displayName: "Dark" }],
    }, 0);
    expect(result.status).toBe("unique");
    expect(result.candidates[0].proposal).toMatchObject({ attackerCardRef: "blue", targetCardRef: "dark", targetSeat: 1 });
  });

  it.each([
    { text: "my dragon attacks my monster", target: { text: "his monster" } },
    { text: "my dragon attacks zone 1", target: { text: "zone 3" } },
    { text: "my dragon attacks Sara's monster", target: { text: "" } },
    { text: "my unicorn attacks his monster", attacker: { text: "dragon" } },
  ])("keeps raw utterance and parsed constraints conjunctive: %j", hints => {
    expect(ygoModule.resolveAttack(board(3).state, { ...hints, players }, 0).status).toBe("none");
  });

  it.each([
    "my unicorn attacks his monster",
    "my dragon attacks Nobody's monster",
    "my dragon attacks my monster",
    "Imran's monster attacks my dragon",
    "my dragon attacks zone 6",
    "my dragon attacks zone 0",
    "my dragon attacks the left middle monster",
    "hello there",
    "",
  ])("returns none for incompatible or missing intent '%s'", text => {
    expect(resolve(board().state, text)).toEqual({ status: "none", candidates: [] });
  });

  it("ignores off-field/non-monster cards and does not infer direct attacks from missing twins", () => {
    const b = board();
    b.place(0, { ref: "dead-blue", name: "Blue-Eyes White Dragon", race: "Dragon" }, "graveyard");
    b.place(1, { ref: "banished-dark", name: "Dark Magician", race: "Spellcaster" }, "banished");
    b.place(1, { ref: "spell-dark", name: "Dark Magician", race: "Spellcaster" }, "spell-trap");
    expect(resolve(b.state, "Blue Eyes attacks the magician").candidates).toHaveLength(1);
    const empty = structuredClone(b.state);
    empty.seats[1].twin = [];
    expect(resolve(empty, "my dragon attacks his monster").status).toBe("none");
  });

  it("can identify extra-monster and unnamed face-down twins by public slot without reading hidden metadata", () => {
    const b = board();
    b.place(0, { ref: "extra", name: "Stardust Dragon", race: "Dragon", slot: 2 }, "extra-monster");
    b.place(1, { ref: "set", faceUp: false, slot: 1 });
    const result = resolve(b.state, "my extra monster on the right attacks his left monster");
    expect(result.status).toBe("unique");
    expect(result.candidates[0].proposal).toMatchObject({ attackerCardRef: "extra", targetCardRef: "set" });
    const hidden = structuredClone(b.state);
    hidden.seats[1].twin.find(c => c.ref === "set")!.name = "Secret Unicorn";
    expect(resolve(hidden, "my dragon attacks unicorn").status).toBe("none");
  });

  it("supports raw strings, nonzero actor seats and explicit direct proposals", () => {
    const b = board();
    const raw = ygoModule.resolveAttack(b.state, "my magician attacks his dragon", 1);
    expect(raw.status).toBe("unique");
    expect(raw.candidates[0].proposal).toMatchObject({ actorSeat: 1, attackerSeat: 1, attackerCardRef: "dark", targetSeat: 0, targetCardRef: "blue" });
    const direct = resolve(b.state, "my dragon attacks Imran directly");
    expect(direct.status).toBe("unique");
    expect(direct.candidates[0].proposal).toEqual({ type: "attack.declare", actorSeat: 0, attackerSeat: 0, attackerCardRef: "blue", targetSeat: 1, direct: true });
  });

  it("excludes eliminated/self seats and unavailable actors", () => {
    const b = board(3);
    b.place(2, { ref: "sara-dragon", name: "Stardust Dragon", race: "Dragon", slot: 1 });
    const state = structuredClone(b.state);
    state.seats[1].eliminated = true;
    expect(resolve(state, "my dragon attacks his monster").candidates.map(c => c.proposal.targetSeat)).toEqual([2]);
    expect(resolve(state, "attack Imran's monster").status).toBe("none");
    expect(resolve(state, "attack Alex's monster").status).toBe("none");
    expect(resolve(state, "attack his monster", 1).status).toBe("none");
    expect(resolve(state, "attack his monster", 9).status).toBe("none");
    state.ended = true;
    expect(resolve(state, "attack his monster").status).toBe("none");
  });

  it("preserves slot metadata on same-zone moves and clears stale positions on cross-zone moves", () => {
    const b = board();
    const move = (state: typeof b.state, zone: string, slot?: number) => ygoModule.reduce(state, remoteActionSchema.parse({
      type: "twin.move", actorSeat: 0, seat: 0, cardRef: "blue", zone, slot, idempotencyKey: `move-${zone}`,
    }));
    const repositioned = move(b.state, "monster", 5);
    expect(repositioned.seats[0].twin[0].slot).toBe(5);
    expect(move(repositioned, "monster").seats[0].twin[0].slot).toBe(5);
    expect(move(repositioned, "graveyard").seats[0].twin[0].slot).toBeUndefined();
    // Odion: a Trap activated in S3 becomes a Trap Monster in M3 and still occupies S3 until it leaves the field.
    b.place(0, { ref: "apophis", name: "Embodiment of Apophis", slot: 3, cardId: 28649820 }, "spell-trap");
    let n = 0;
    const act = (state: typeof b.state, action: Record<string, unknown>) => ygoModule.reduce(state, remoteActionSchema.parse({ actorSeat: 0, seat: 0, idempotencyKey: `zone-rule-${++n}`, ...action }));
    const summoned = act(b.state, { type: "twin.move", cardRef: "apophis", zone: "monster", slot: 3, trapMonster: true });
    expect(summoned.seats[0].twin.find(c => c.ref === "apophis")).toMatchObject({ zone: "monster", slot: 3, trapZone: 3 });
    expect(() => act(summoned, { type: "twin.place", zone: "spell-trap", card: { ref: "late", slot: 3, cardId: 2 } })).toThrow(/occupied/i);
    // A Trap Monster has a battle position like any monster; sent back to the Spell & Trap Zone it starts in Attack again.
    const defended = act(summoned, { type: "twin.flip", cardRef: "apophis", faceUp: true, position: "defense" });
    expect(defended.seats[0].twin.find(c => c.ref === "apophis")).toMatchObject({ zone: "monster", slot: 3, position: "defense", trapZone: 3 });
    expect(act(defended, { type: "twin.move", cardRef: "apophis", zone: "spell-trap", slot: 3, position: "attack" }).seats[0].twin.find(c => c.ref === "apophis")).toMatchObject({ zone: "spell-trap", position: "attack" });
    // Equip link: an Equip Card in S2 equips the Trap Monster; both links end when the monster leaves the field.
    const equip = act(act(summoned, { type: "twin.place", zone: "spell-trap", card: { ref: "axe", slot: 2, cardId: 40619825 } }), { type: "twin.equip", cardRef: "axe", target: { seat: 0, ref: "apophis" } });
    expect(equip.seats[0].twin.find(c => c.ref === "axe")?.equippedTo).toEqual({ seat: 0, ref: "apophis" });
    const gone = act(equip, { type: "twin.move", cardRef: "apophis", zone: "graveyard" });
    expect(gone.seats[0].twin.find(c => c.ref === "apophis")?.trapZone).toBeUndefined();
    expect(gone.seats[0].twin.find(c => c.ref === "axe")?.equippedTo).toBeUndefined();
    const undo = (state: typeof b.state, targetActionId: string) => ygoModule.reduce(state, remoteActionSchema.parse({ type: "undo", actorSeat: 0, targetActionId, idempotencyKey: `zone-undo-${++n}` }));
    const later = act(gone, { type: "twin.place", zone: "spell-trap", card: { ref: "late", slot: 3, cardId: 2 } });
    expect(later.seats[0].twin.some(c => c.ref === "late")).toBe(true);
    // Out-of-order Undo never brings the hold back onto the S/T zone that a later card took.
    const sent = act(summoned, { type: "twin.move", cardRef: "apophis", zone: "graveyard" }), sentId = sent.undo!.actionId;
    expect(() => undo(act(sent, { type: "twin.place", zone: "spell-trap", card: { ref: "late", slot: 3, cardId: 2 } }), sentId)).toThrow(/Spell & Trap Zone is in use/);
    // A Pendulum Zone 1 is S1: a Trap Monster that holds S1 blocks it too.
    const pend = act(act(b.state, { type: "twin.place", zone: "spell-trap", card: { ref: "trap1", slot: 1, cardId: 77 } }), { type: "twin.move", cardRef: "trap1", zone: "monster", slot: 2, trapMonster: true });
    expect(() => act(pend, { type: "twin.place", zone: "pendulum", card: { ref: "scale", slot: 1, cardId: 3 } })).toThrow(/occupied/i);
    // Xyz Summon: two monsters (one already stacked in M3, one sent to the hand by the camera) go under the Xyz in M3.
    const twin = (state: typeof b.state, ref: string) => state.seats[0].twin.find(c => c.ref === ref);
    const mats = act(act(act(b.state, { type: "twin.place", zone: "monster", card: { ref: "m1", slot: 3, cardId: 11 } }),
      { type: "twin.place", zone: "monster", card: { ref: "m2", slot: 4, cardId: 12 } }), { type: "twin.move", cardRef: "m2", zone: "hand" });
    const xyz = act(mats, { type: "twin.place", zone: "monster", card: { ref: "x1", slot: 3, cardId: 21 }, summon: { kind: "xyz", materialRefs: ["m1", "m2"] } });
    expect(twin(xyz, "x1")).toMatchObject({ zone: "monster", slot: 3, materials: ["m1", "m2"] });
    expect(twin(xyz, "m1")).toMatchObject({ zone: "material", materialOf: "x1" });
    expect(twin(xyz, "m1")?.slot).toBeUndefined();
    expect(twin(xyz, "m2")).toMatchObject({ zone: "material", materialOf: "x1" });
    expect(remoteUndoLabel(xyz.undoHistory!.find(e => e.actionId === xyz.undo!.actionId)!.action, xyz)).toBe("Xyz Summon: Card (2 materials)");
    // One Undo puts both materials back.
    const undone = undo(xyz, xyz.undo!.actionId);
    expect(twin(undone, "x1")).toBeUndefined();
    expect(twin(undone, "m1")).toMatchObject({ zone: "monster", slot: 3 });
    expect(twin(undone, "m2")?.zone).toBe("hand");
    // A card in the hand that did not just leave a Monster Zone is never a material: the camera placement keeps its read and skips it.
    const handOnly = act(act(b.state, { type: "twin.place", zone: "hand", card: { ref: "h1", cardId: 13 } }),
      { type: "twin.place", zone: "monster", card: { ref: "x9", slot: 2, cardId: 21 }, summon: { kind: "xyz", materialRefs: ["h1"] } });
    expect(twin(handOnly, "x9")?.materials).toBeUndefined();
    expect(twin(handOnly, "h1")?.zone).toBe("hand");
    expect(() => act(handOnly, { type: "twin.attach", cardRef: "x9", kind: "xyz", materialRefs: ["h1"] })).toThrow(/material/i);
    // The camera loses the Xyz for a moment (default: to the hand): its materials wait 30 s; it comes back with them.
    const at0 = xyz.updatedAt;
    const lifted = act(xyz, { type: "twin.move", cardRef: "x1", zone: "hand", source: "auto", at: at0 + 1000 });
    expect(twin(lifted, "m1")).toMatchObject({ zone: "material", materialOf: "x1" });
    const back = act(lifted, { type: "twin.move", cardRef: "x1", zone: "monster", slot: 3, source: "auto", at: at0 + 2000 });
    expect(twin(back, "x1")?.materials).toEqual(["m1", "m2"]);
    expect(twin(act(lifted, { type: "lp.change", seat: 0, delta: -100, reason: "test", at: at0 + 40_000 }), "m1")?.zone).toBe("graveyard");
    // A player's own move to the hand (a bounce) sends the materials to the GY at once.
    expect(twin(act(xyz, { type: "twin.move", cardRef: "x1", zone: "hand", at: at0 + 1000 }), "m1")?.zone).toBe("graveyard");
    // Rank-up: the new Xyz goes on top of the old one and takes its materials. Detach sends one to the GY.
    const rankUp = act(xyz, { type: "twin.place", zone: "extra-monster", card: { ref: "x2", slot: 1, cardId: 22 }, summon: { kind: "xyz", materialRefs: ["x1"] } });
    expect(twin(rankUp, "x2")?.materials).toEqual(["m1", "m2", "x1"]);
    expect(twin(rankUp, "x1")).toMatchObject({ zone: "material", materialOf: "x2" });
    expect(twin(rankUp, "x1")?.materials).toBeUndefined();
    const detached = act(rankUp, { type: "twin.detach", cardRef: "x2", materialRef: "m1" });
    expect(twin(detached, "x2")?.materials).toEqual(["m2", "x1"]);
    expect(detached.seats[0].twin.filter(c => c.zone === "graveyard").map(c => c.ref)).toEqual(["m1"]);
    // The Xyz leaves the field: it and its materials go to the GY, in order.
    const left = act(detached, { type: "twin.move", cardRef: "x2", zone: "graveyard" });
    expect(left.seats[0].twin.filter(c => c.zone === "graveyard").map(c => c.ref)).toEqual(["m1", "x2", "m2", "x1"]);
    expect(left.seats[0].twin.some(c => c.zone === "material" || c.materialOf || c.materials)).toBe(false);
    // The owner fixes the GY order; one Undo restores it.
    const fixed = act(left, { type: "pile.order", zone: "graveyard", cardRefs: ["x1", "m2", "x2", "m1"] });
    expect(fixed.seats[0].twin.filter(c => c.zone === "graveyard").map(c => c.ref)).toEqual(["x1", "m2", "x2", "m1"]);
    expect(undo(fixed, fixed.undo!.actionId).seats[0].twin.filter(c => c.zone === "graveyard").map(c => c.ref)).toEqual(["m1", "x2", "m2", "x1"]);
    expect(() => act(left, { type: "pile.order", zone: "graveyard", cardRefs: ["x1", "m2"] })).toThrow(/every card/);
    // Synchro Summon on a card already on the field: its materials go to the GY in one action.
    const synchro = act(act(mats, { type: "twin.place", zone: "extra-monster", card: { ref: "s1", slot: 2, cardId: 31 } }),
      { type: "twin.attach", cardRef: "s1", kind: "synchro", materialRefs: ["m1", "m2"] });
    expect(synchro.seats[0].twin.filter(c => c.zone === "graveyard").map(c => c.ref)).toEqual(["m1", "m2"]);
    expect(twin(synchro, "s1")?.materials).toBeUndefined();
    // Board re-sync: its log note is not an undo step. The player's Undo restores the re-sync move.
    const synced = ygoModule.reduce(act(summoned, { type: "twin.move", cardRef: "apophis", zone: "monster", slot: 4 }), remoteActionSchema.parse({ type: "log.note", actorSeat: 0, text: "Board re-synced (1 change)", idempotencyKey: "resync-note" }));
    const newest = [...synced.undoHistory!].sort((x, y) => y.order - x.order)[0];
    expect(newest.action.type).toBe("twin.move");
    expect(undo(synced, newest.actionId).seats[0].twin.find(c => c.ref === "apophis")).toMatchObject({ zone: "monster", slot: 3, trapZone: 3 });
  });

  it("a card the camera took off the field waits in the hand; a pile read within 5 s is that card (one copy), and one Undo reverts it", () => {
    const b = board();
    let n = 0;
    const act = (state: typeof b.state, action: Record<string, unknown>) => ygoModule.reduce(state, remoteActionSchema.parse({ actorSeat: 0, seat: 0, idempotencyKey: `late-${++n}`, ...action }));
    const at0 = b.state.updatedAt;
    const inHand = act(b.state, { type: "twin.move", cardRef: "blue", zone: "hand", source: "auto", at: at0 + 100 });
    const read = act(inHand, { type: "twin.place", source: "auto", zone: "graveyard", card: { ref: "fw-9", cardId: 89631139, name: "Blue-Eyes White Dragon" }, at: at0 + 4_000 });
    const copies = (state: typeof b.state) => state.seats[0].twin.filter(c => c.cardId === 89631139 || c.ref === "blue");
    expect(copies(read).map(c => [c.ref, c.zone])).toEqual([["blue", "graveyard"]]);
    const undone = ygoModule.reduce(read, remoteActionSchema.parse({ type: "undo", actorSeat: 0, targetActionId: read.undo!.actionId, idempotencyKey: `late-${++n}` }));
    expect(copies(undone).map(c => [c.ref, c.zone])).toEqual([["blue", "hand"]]);
  });

  it("a named pile read never takes a card that is back in the hand while another copy lies in that pile", () => {
    const b = board();
    let n = 0;
    const act = (state: typeof b.state, action: Record<string, unknown>) => ygoModule.reduce(state, remoteActionSchema.parse({ actorSeat: 0, seat: 0, idempotencyKey: `steal-${++n}`, ...action }));
    b.place(0, { ref: "blue2", name: "Blue-Eyes White Dragon", cardId: 89631139 }, "graveyard");
    const at0 = b.state.updatedAt;
    const inHand = act(b.state, { type: "twin.move", cardRef: "blue", zone: "hand", source: "auto", at: at0 + 100 });
    const read = act(inHand, { type: "twin.place", source: "auto", zone: "graveyard", card: { ref: "fw-9", cardId: 89631139, name: "Blue-Eyes White Dragon" }, at: at0 + 4_000 });
    expect(read.seats[0].twin.find(c => c.ref === "blue")?.zone).toBe("hand");
  });

  it("an Xyz placed in a new zone 8 s after two lifts takes both from the hand (no card left counted in hand)", () => {
    const b = board();
    let n = 0;
    const act = (state: typeof b.state, action: Record<string, unknown>) => ygoModule.reduce(state, remoteActionSchema.parse({ actorSeat: 0, seat: 0, idempotencyKey: `xyz-${++n}`, ...action }));
    b.place(0, { ref: "m2", slot: 2, cardId: 12 }); b.place(0, { ref: "m3", slot: 3, cardId: 13 });
    const at0 = b.state.updatedAt;
    const lifted = act(act(b.state, { type: "twin.move", cardRef: "m2", zone: "hand", source: "auto", at: at0 + 800 }), { type: "twin.move", cardRef: "m3", zone: "hand", source: "auto", at: at0 + 900 });
    const hands = (state: typeof b.state) => state.seats[0].twin.filter(c => c.zone === "hand").length;
    expect(hands(lifted)).toBe(2);
    const xyz = act(lifted, { type: "twin.place", zone: "monster", card: { ref: "x1", slot: 4, cardId: 21 }, summon: { kind: "xyz", materialRefs: ["m2", "m3"] }, at: at0 + 8_900 });
    expect(xyz.seats[0].twin.find(c => c.ref === "x1")?.materials).toEqual(["m2", "m3"]);
    expect(hands(xyz)).toBe(0);
  });

  it("an Xyz takes a monster from the opponent's field as material; detached it goes to its owner's Graveyard", () => {
    const b = board();
    let n = 0;
    const act = (state: typeof b.state, action: Record<string, unknown>) => ygoModule.reduce(state, remoteActionSchema.parse({ actorSeat: 0, seat: 0, idempotencyKey: `foreign-${++n}`, ...action }));
    b.place(0, { ref: "infinity", name: "Cyber Dragon Infinity", slot: 2, cardId: 10443957 });
    // Only the card's owner sends it; the Xyz controller cannot take the other player's cards.
    expect(() => act(b.state, { type: "twin.attach", cardRef: "infinity", kind: "xyz", materialRefs: ["dark"], materialSeat: 1 })).toThrow(/owner of the card/);
    const attached = act(b.state, { type: "twin.attach", actorSeat: 1, cardRef: "infinity", kind: "xyz", materialRefs: ["dark"], materialSeat: 1 });
    expect(attached.seats[1].twin.some(c => c.ref === "dark")).toBe(false);
    expect(attached.seats[0].twin.find(c => c.ref === "dark")).toMatchObject({ zone: "material", materialOf: "infinity", ownerSeat: 1 });
    expect(attached.seats[0].twin.find(c => c.ref === "infinity")?.materials).toEqual(["dark"]);
    // Detach with no zone: the Graveyard, and it is the owner's.
    const detached = act(attached, { type: "twin.detach", cardRef: "infinity", materialRef: "dark" });
    expect(detached.seats[1].twin.find(c => c.ref === "dark")?.zone).toBe("graveyard");
    expect(detached.seats[0].twin.some(c => c.ref === "dark")).toBe(false);
  });

  it("persists public annotations and replays a confirmed proposal through the normal event store", () => {
    const { service, table, users, db } = setup();
    service.join(table.slug, "g", users[1], "Imran", 1, 1100);
    registerTestDeck(db, service, table.slug, users[1], 1100);
    service.join(table.slug, "g", users[2], "Sara", 2, 1100);
    registerTestDeck(db, service, table.slug, users[2], 1100);
    users.slice(0, 3).forEach(user => service.ready(table.slug, "g", user, true, 1200));
    let room = service.start(table.slug, "g", users[0], 1300);
    let seq = 0;
    const act = (actorSeat: number, action: Record<string, unknown>) => {
      room = service.act(table.slug, "g", users[actorSeat], { baseSeq: room.lastSeq,
        action: remoteActionSchema.parse({ ...action, actorSeat, idempotencyKey: `confirmed-${++seq}` }) }, 1300 + seq);
    };
    act(0, { type: "twin.place", seat: 0, zone: "monster", card: { ref: "blue", name: "Blue-Eyes White Dragon", race: "Dragon", slot: 1 } });
    act(1, { type: "twin.place", seat: 1, zone: "monster", card: { ref: "red", name: "Red-Eyes Black Dragon", race: "Dragon", slot: 5 } });
    act(0, { type: "turn.end" }); act(1, { type: "turn.end" }); act(2, { type: "turn.end" });
    act(0, { type: "phase.set", phase: "battle" });
    const before = service.get(table.slug, "g", users[0]);
    const result = ygoModule.resolveAttack(before.state, { text: "attack Imran's dragon", players: before.seats }, before.mySeat);
    expect(result.status).toBe("unique");
    expect(service.get(table.slug, "g", users[0])).toEqual(before);
    act(0, result.candidates[0].proposal);
    expect(room.state.attack).toMatchObject({ attackerCardRef: "blue", targetCardRef: "red", targetSeat: 1 });
    expect(service.replay(table.slug, "g", users[0])).toEqual(room.state);
    expect(room.events.some(e => JSON.stringify(e).includes("attack Imran"))).toBe(false);
  });
});

const originDeck = [80101899, 70825459, 23898021, 73628505, 32807846, 53582587, 53582587,
  37576645, 37576645, 10045474, 97077563, 5318639, 14087893, 47355498, 67616300, 2460565, 63977008, 89631133,
  46986414, 46986414, 46986414, 71413901, 71413901, 71413901, 73752131, 73752131, 73752131, 9156135, 9156135, 9156135, 45141844, 45141844, 45141844, 97268402, 97268402, 97268402, 31560081, 31560081, 423585, 423585];
function originSession(showCardsSetFromDeck = false) {
  const s = deckSession("normal");
  if (!showCardsSetFromDeck) s.service.configure(s.room.slug,"g",s.users[0],{format:"normal",showCardsSetFromDeck:false},2000);
  s.select(s.save(originDeck).id); s.start(); return s;
}
const originOf = (s: ReturnType<typeof originSession>) => s.room.state.effectTracking!.origins.at(-1)!;
describe("remote effect origins and hidden information", () => {
  it.each(["set-private","set-camera","hand-private","hand-announced","extra"])("preserves old private-event semantics across migration and replay (%s)", mode => {
    const hand=mode.startsWith("hand");
    const s=originSession(); s.act({type:"effect.activated",source:{cardId:hand ? 73628505 : 70825459}});
    if(!hand) s.act({type:"twin.place",seat:0,zone:"spell-trap",card:{ref:"legacy-set",faceUp:false}});
    s.act({type:"effect.choose",originId:originOf(s).id,cardId:hand ? 47355498 : 53582587});
    if(mode==="set-camera") s.act({type:"card.identified",seat:0,cardRef:"legacy-set",cardId:53582587,source:"auto"});
    if(mode==="hand-announced") s.act({type:"effect.announce",originId:originOf(s).id});
    // Copy a pre-option fixture, leaving the original append-only events untouched.
    const legacyState=structuredClone(s.room.state);
    if(mode==="hand-announced") {
      // Original announcements exposed announcedCard, but did not mark/observe the private hand twin.
      delete legacyState.seats[0].twin[0].publicIdentity;
      legacyState.deckChecks.instances=[];
      const origin=legacyState.effectTracking!.origins[0]; delete origin.revealedCardId;
      origin.candidates=structuredClone(origin.pool);
    }
    if(mode==="extra") {
      s.act({type:"twin.place",seat:0,zone:"extra",card:{ref:"legacy-extra",cardId:5318639,name:"Mystical Space Typhoon"}});
      Object.assign(legacyState,structuredClone(s.room.state));
      // The old reducer marked extra instances public internally; projections still hid the Extra Deck.
      const extra=legacyState.deckChecks.instances.find(i=>i.refs.includes("legacy-extra"))!;
      extra.public=true; extra.anchored=true;
    }
    delete legacyState.showCardsSetFromDeck;
    // The room state has no undo position now: an old row kept one, without the rule that this test removes.
    if(legacyState.undo) { const {updatedAt:_at,undo:_undo,undoHistory:_history,...position}=structuredClone(legacyState); legacyState.undo.before=position as never; }
    const oldId=(s.db.prepare("select id from remote_tables where slug=?").get(s.room.slug) as {id:number}).id;
    const id=s.db.prepare("insert into remote_tables(slug,guild_id,game_id,seat_count,status,created_by,state_json,last_seq,created_at,last_event_at,solo,format_json) select 'legacy','g',game_id,seat_count,status,created_by,?,last_seq,created_at,last_event_at,solo,format_json from remote_tables where id=?")
      .run(JSON.stringify(legacyState),oldId).lastInsertRowid;
    for(const table of ["remote_seats","remote_bot_seats"]) {
      const columns=table==="remote_seats" ? "seat,user_id,display_name,ready,saved_deck_id,deck_json" : "seat,display_name,saved_deck_id,deck_json";
      s.db.prepare(`insert into ${table}(table_id,${columns}) select ?,${columns} from ${table} where table_id=?`).run(id,oldId);
    }
    const rows=s.db.prepare("select * from remote_events where table_id=? order by seq").all(oldId) as {seq:number;idempotency_key:string;actor_seat:number;user_id:number;action_json:string;created_at:number;effects_json:string|null;messages_json:string|null}[];
    for(const row of rows) {
      const action=JSON.parse(row.action_json); delete action.showCardsSetFromDeck;
      const effects=row.effects_json ? JSON.parse(row.effects_json) : null;
      if(effects) {delete effects.showCardsSetFromDeck;delete effects.publicEffectChoice;}
      s.db.prepare("insert into remote_events(table_id,seq,idempotency_key,actor_seat,user_id,action_json,created_at,effects_json,messages_json) values(?,?,?,?,?,?,?,?,?)")
        .run(id,row.seq,row.idempotency_key,row.actor_seat,row.user_id,JSON.stringify(action),row.created_at,effects ? JSON.stringify(effects) : null,row.messages_json);
    }
    const cached=s.service.get("legacy","g",s.users[0]);
    expect(cached.showCardsSetFromDeck).toBe(true);
    expect(s.service.replay("legacy","g",s.users[0])).toEqual(cached.state);
    s.service.act("legacy","g",s.users[0],{baseSeq:cached.lastSeq,action:{type:"lp.change",actorSeat:0,seat:0,delta:-100,reason:"effect",idempotencyKey:"after-upgrade"}},2300);
    const publicView=s.service.snapshot("legacy","g");
    expect(publicView.state.seats[0].twin[0].cardId).toBe(mode==="set-camera" ? 53582587 : undefined);
    expect(s.service.replay("legacy","g",s.users[0])).toEqual(s.service.get("legacy","g",s.users[0]).state);
  });
  it("keeps Extra Deck placements and returns private even when their faceUp flag is true", () => {
    const s=originSession(true);
    s.act({type:"twin.place",seat:0,zone:"extra",card:{ref:"extra-secret",cardId:5318639,name:"Mystical Space Typhoon"}});
    expect(s.service.snapshot(s.room.slug,"g").state.seats[0].twin[0].cardId).toBeUndefined();
    s.act({type:"effect.activated",source:{cardId:70825459}});
    s.act({type:"twin.place",seat:0,zone:"spell-trap",card:{ref:"return",faceUp:false}});
    s.act({type:"effect.choose",originId:originOf(s).id,cardId:53582587});
    s.act({type:"twin.flip",seat:0,cardRef:"return",faceUp:true});
    s.act({type:"twin.move",seat:0,cardRef:"return",zone:"extra"});
    expect(s.service.snapshot(s.room.slug,"g").state.seats[0].twin.find(c=>c.ref==="return")?.cardId).toBeUndefined();
  });
  it("publishes a default-table Set choice without flipping it or sharing the other candidates", () => {
    const s=originSession(true); s.act({type:"effect.activated",source:{cardId:70825459}});
    s.act({type:"twin.place",seat:0,zone:"spell-trap",card:{ref:"public-set",faceUp:false,slot:1}});
    const origin=originOf(s);
    s.act({type:"effect.choose",originId:origin.id,cardId:53582587});
    for(const view of [s.service.snapshot(s.room.slug,"g").state,s.service.replay(s.room.slug,"g",s.users[0])]) {
      expect(view.seats[0].twin[0]).toMatchObject({cardId:53582587,name:"Torrential Tribute",faceUp:false,publicIdentity:true,setBy:{name:"Trap Tracks"}});
      expect(view.effectTracking!.origins[0].announcedCard).toEqual({cardId:53582587,name:"Torrential Tribute"});
    }
    const publicView=s.service.snapshot(s.room.slug,"g");
    expect(publicView.events.at(-1)?.action).toMatchObject({type:"effect.choose",cardId:53582587});
    for(const key of ['"pool"','"candidates"','"eligibleIds"','"chosenCardId"','"savedDeckId"','"facts"','"minimumCopies"']) expect(JSON.stringify(publicView)).not.toContain(key);
    expect(JSON.stringify(publicView)).not.toContain("Reckless Greed");
    const chooseId=s.room.state.undo!.actionId;
    s.act({type:"undo",targetActionId:chooseId});
    expect(s.service.snapshot(s.room.slug,"g").state.seats[0].twin[0].cardId).toBeUndefined();
    expect(s.service.replay(s.room.slug,"g",s.users[0])).toEqual(s.room.state);
  });
  it.each([true,false])("applies Deck publicity %s to search-to-hand choices", show => {
    const s=originSession(show); s.act({type:"effect.activated",source:{cardId:73628505}});
    const origin=originOf(s); s.act({type:"effect.choose",originId:origin.id,cardId:47355498});
    const publicView=s.service.snapshot(s.room.slug,"g");
    expect(publicView.state.effectTracking!.origins[0].announcedCard?.cardId).toBe(show ? 47355498 : undefined);
    expect(publicView.state.seats[0].twin[0].cardId).toBe(show ? 47355498 : undefined);
    expect(publicView.state.effectTracking!.origins[0].candidates).toBeUndefined();
    expect(JSON.stringify(publicView)).not.toContain("Chicken Game");
    if(!show) {
      expect(JSON.stringify(publicView)).not.toContain("Necrovalley");
      s.act({type:"effect.announce",originId:origin.id});
      expect(s.service.snapshot(s.room.slug,"g").state.effectTracking!.origins[0].announcedCard?.cardId).toBe(47355498);
    }
    expect(s.service.replay(s.room.slug,"g",s.users[0])).toEqual(s.room.state);
  });
  it.each([true,false])("handles shown Set camera reads with publicity %s and soft off-candidate notes", show => {
    const s=originSession(show); s.act({type:"effect.activated",source:{cardId:70825459}});
    s.act({type:"twin.place",seat:0,zone:"spell-trap",card:{ref:"shown",faceUp:false}});
    s.act({type:"card.identified",seat:0,cardRef:"shown",cardId:5318639,source:"auto"});
    const publicView=s.service.snapshot(s.room.slug,"g");
    expect(publicView.state.seats[0].twin[0]).toMatchObject({cardId:5318639,name:"Mystical Space Typhoon",faceUp:!show});
    expect(publicView.state.effectTracking!.notes[0].message).toBe("Mystical Space Typhoon could not be Set by Trap Tracks");
    expect(publicView.state.ended).toBe(false);
    expect(s.service.replay(s.room.slug,"g",s.users[0])).toEqual(s.room.state);
  });
  it("publishes a camera-read searched card on a public table and validates the original candidates", () => {
    const s=originSession(true); s.act({type:"effect.activated",source:{cardId:73628505}});
    const origin=originOf(s);
    s.act({type:"twin.place",seat:0,zone:"hand",card:{ref:origin.ref,faceUp:false}});
    s.act({type:"card.identified",seat:0,cardRef:origin.ref,cardId:5318639,source:"auto"});
    const publicView=s.service.snapshot(s.room.slug,"g");
    expect(publicView.state.seats[0].twin[0]).toMatchObject({cardId:5318639,faceUp:false,publicIdentity:true});
    expect(publicView.state.effectTracking!.origins[0].announcedCard?.cardId).toBe(5318639);
    expect(publicView.state.effectTracking!.notes[0].message).toBe("Mystical Space Typhoon could not be added to hand by Terraforming");
    expect(publicView.events.at(-1)?.action.type).toBe("card.identified");
    expect(JSON.stringify(publicView)).not.toContain("Chicken Game");
  });
  it("subtracts known face-down Sets from future candidates and keeps ordinary hidden placements private", () => {
    const s=originSession(true);
    for(const ref of ["set-a","set-b"]) {
      s.act({type:"effect.activated",source:{cardId:70825459}});
      s.act({type:"twin.place",seat:0,zone:"spell-trap",card:{ref,faceUp:false,slot:ref==="set-a" ? 1 : 2}});
      s.act({type:"effect.choose",originId:originOf(s).id,cardId:53582587});
    }
    s.act({type:"effect.activated",source:{cardId:70825459}});
    s.act({type:"twin.place",seat:0,zone:"spell-trap",card:{ref:"set-c",faceUp:false,slot:3}});
    expect(originOf(s).candidates!.some(c=>c.cardId===53582587)).toBe(false);
    s.act({type:"twin.place",seat:0,zone:"spell-trap",card:{ref:"ordinary",faceUp:false,slot:4,cardId:37576645,name:"Reckless Greed"}});
    const publicView=s.service.snapshot(s.room.slug,"g");
    expect(publicView.state.seats[0].twin.find(c=>c.ref==="ordinary")?.cardId).toBeUndefined();
    expect(JSON.stringify(publicView)).not.toContain("Reckless Greed");
    expect(s.service.replay(s.room.slug,"g",s.users[0])).toEqual(s.room.state);
  });
  it.each([true,false])("preserves distinct same-name searched copies for depletion (publicity=%s)", show => {
    const s=deckSession("normal");
    s.service.configure(s.room.slug,"g",s.users[0],{format:"normal",showCardsSetFromDeck:show},2000);
    s.select(s.save(originDeck.map(code=>code===67616300 ? 47355498 : code)).id); s.start();
    for(let i=0;i<2;i++) {
      s.act({type:"effect.activated",source:{cardId:73628505}});
      const origin=originOf(s); s.act({type:"effect.choose",originId:origin.id,cardId:47355498});
      if(!show) s.act({type:"effect.announce",originId:origin.id});
    }
    expect(s.room.state.seats[0].twin.filter(c=>c.zone==="hand" && c.cardId===47355498)).toHaveLength(2);
    s.act({type:"effect.activated",source:{cardId:73628505}});
    expect(originOf(s).candidates).toEqual([]);
    expect(s.service.replay(s.room.slug,"g",s.users[0])).toEqual(s.room.state);
  });
  it.each([
    [70825459, [37576645, 53582587, 80101899, 10045474]],
    [23898021, [37576645, 53582587, 70825459, 80101899, 10045474]],
    [80101899, [37576645, 53582587]],
  ])("derives real Deck-to-Set filters for %s", (cardId, expected) => {
    const s = originSession(); s.act({ type: "effect.activated", source: { cardId } });
    s.act({type: "twin.place",seat:0,zone:"spell-trap",card:{ref:"set",faceUp:false,slot:1}});
    const origin = originOf(s);
    expect(origin.source.cardId).toBe(cardId);
    expect(origin.candidates!.map(c=>c.cardId).sort((a,b)=>a-b)).toEqual([...expected].sort((a,b)=>a-b));
    expect(s.service.replay(s.room.slug,"g",s.users[0])).toEqual(s.room.state);
  });
  it.each([[73628505, [47355498,67616300]], [32807846, [2460565,63977008]]])("offers private search candidates for %s", (cardId, expected) => {
    const s=originSession(); s.act({type:"effect.activated",source:{cardId}});
    const origin=originOf(s); expect(origin.destination).toBe("hand"); expect(origin.announceRecommended).toBe(true);
    expect(origin.candidates!.map(c=>c.cardId).sort((a,b)=>a-b)).toEqual([...expected].sort((a,b)=>a-b));
    s.act({type:"effect.choose",originId:origin.id,cardId:expected[0]});
    expect(s.room.state.seats[0].twin.find(c=>c.ref===origin.ref)?.zone).toBe("hand");
    expect(s.service.snapshot(s.room.slug,"g").state.seats[0].twin.find(c=>c.ref===origin.ref)?.cardId).toBeUndefined();
    s.act({type:"effect.announce",originId:origin.id});
    expect(s.service.snapshot(s.room.slug,"g").state.effectTracking?.origins.at(-1)?.announcedCard?.cardId).toBe(expected[0]);
  });
  it("keeps decks, candidates, private picks, event effects and undo out of opponents and room broadcasts",()=>{
    const s=originSession(); s.act({type:"effect.activated",source:{cardId:70825459}});
    s.act({type:"twin.place",seat:0,zone:"spell-trap",card:{ref:"set",faceUp:false}});
    s.act({type:"effect.choose",originId:originOf(s).id,cardId:53582587});
    expect(s.room.state.seats[0].twin[0]).toMatchObject({cardId:53582587,faceUp:false});
    const publicView=s.service.snapshot(s.room.slug,"g");
    expect(publicView.state.seats[0].twin[0].cardId).toBeUndefined();
    expect(publicView.state.effectTracking?.origins.at(-1)).toMatchObject({source:{cardId:70825459}});
    const json=JSON.stringify(publicView);
    for(const key of ['"candidates"','"pool"','"chosenCardId"','"savedDeckId"','"facts"','"cardId":53582587']) expect(json).not.toContain(key);
    const own=s.service.snapshot(s.room.slug,"g",s.users[0]);
    expect(own.state.effectTracking?.origins.at(-1)?.candidates?.length).toBeGreaterThan(0);
    expect(s.service.list("g",s.users[0])[0].seats[0].deck?.savedDeckId).toBeUndefined();
  });
  it("reveals a private pick on flip and accepts out-of-filter recognition with a dismissible public note",()=>{
    const s=originSession(); s.act({type:"effect.activated",source:{cardId:70825459}});
    s.act({type:"twin.place",seat:0,zone:"spell-trap",card:{ref:"set",faceUp:false}});
    s.act({type:"effect.choose",originId:originOf(s).id,cardId:53582587});
    s.act({type:"twin.flip",seat:0,cardRef:"set",faceUp:true});
    expect(s.service.snapshot(s.room.slug,"g").state.seats[0].twin[0].cardId).toBe(53582587);
    s.act({type:"card.identified",seat:0,cardRef:"set",cardId:5318639,source:"auto"});
    const note=s.room.state.effectTracking!.notes.at(-1)!;
    expect(note.message).toBe("Mystical Space Typhoon could not be Set by Trap Tracks");
    expect(s.service.snapshot(s.room.slug,"g").state.effectTracking?.notes.at(-1)?.message).toBe(note.message);
    s.act({type:"effect.note.dismiss",noteId:note.id}); expect(s.room.state.effectTracking!.notes.at(-1)?.dismissed).toBe(true);
    expect(s.room.state.ended).toBe(false); expect(s.service.replay(s.room.slug,"g",s.users[0])).toEqual(s.room.state);
  });
  it("subtracts public physical copies and expires contexts on a phase change",()=>{
    const s=originSession(); s.place("seen1","graveyard",1,53582587); s.place("seen2","spell-trap",2,53582587);
    s.act({type:"effect.activated",source:{cardId:70825459}});
    s.act({type:"twin.place",seat:0,zone:"spell-trap",card:{ref:"set",faceUp:false,slot:3}});
    expect(originOf(s).candidates!.some(c=>c.cardId===53582587)).toBe(false);
    s.act({type:"effect.activated",source:{cardId:70825459}}); s.act({type:"phase.set",phase:"main1"});
    s.act({type:"twin.place",seat:0,zone:"spell-trap",card:{ref:"manual",faceUp:false,slot:4}});
    expect(s.room.state.effectTracking!.origins.filter(o=>o.ref==="manual")).toEqual([]);
  });
  it("rejects another seat's private choice and resolves activate after identification",()=>{
    const s=originSession();
    s.act({type:"twin.place",seat:0,zone:"spell-trap",card:{ref:"source",cardId:70825459,name:"Trap Tracks",faceUp:true,slot:1}});
    s.act({type:"card.identified",seat:0,cardRef:"source",cardId:70825459,source:"voice"});
    const command=ygoModule.parseCommand({text:"activate",actorSeat:0,state:s.room.state});
    expect(command).toMatchObject({type:"effect.activated",source:{cardId:70825459}});
    s.act(command!); s.act({type:"twin.place",seat:0,zone:"spell-trap",card:{ref:"set",faceUp:false}});
    expect(()=>s.act({type:"effect.choose",actorSeat:1,originId:originOf(s).id,cardId:53582587})).toThrow(/owner|controller/i);

    let state=ygoModule.initialState({seatCount:3});
    state.seats[1].twin=[
      {ref:"skilled",cardId:73752131,name:"Skilled Dark Magician",zone:"monster",slot:1,faceUp:true,position:"attack"},
      {ref:"normal",cardId:46986414,name:"Dark Magician",zone:"monster",slot:2,faceUp:true,position:"attack"},
      {ref:"trap",cardId:70825459,name:"Trap Tracks",zone:"spell-trap",slot:1,faceUp:false,position:"attack"},
      {ref:"pile",cardId:89631139,name:"Blue-Eyes White Dragon",zone:"graveyard",faceUp:true,position:"attack"},
    ];
    state.seats[0].twin=[{ref:"opponent",name:"Man-Eater Bug",zone:"monster",faceUp:true,position:"attack"}];
    const lookupCard=(code:number)=>({
      73752131:{name:"Skilled Dark Magician",type:"Effect Monster"},
      46986414:{name:"Dark Magician",type:"Normal Monster"},
      70825459:{name:"Trap Tracks",type:"Trap Card"},
    }[code]);
    const parse=(text:string,now=100_000)=>ygoModule.parseCommand({text,actorSeat:1,state,now,lookupCard});
    const bare=["activate","activate effect","activate the effect","effect","use effect","use the effect","I activate effect","um, okay, effect!"];
    const named=["activate Skilled Dark Magician","activate effect of Skilled Dark Magician","activate the effect of Skilled Dark Magician",
      "activate Skilled Dark Magician's effect","Skilled Dark Magician effect","Skilled Dark Magician's effect","Skilled Dark Magician’s effect",
      "use Skilled Dark Magician effect","use Skilled Dark Magician's effect","I use Skilled Dark Magician’s effect",
      "activate Skiled Dark Magican","skilled dark magishun effect"];
    for(const text of [...bare,...named]) expect(parse(text),text).toMatchObject({type:"effect.activated",actorSeat:1,source:{cardId:73752131,cardRef:"skilled"}});
    for(const text of ["that effect is good","what does the effect do","what does the effect","the effect is good","effect is good",
      "I think I will activate effect","don't activate effect","activate Skilled Dark Magician and then draw","Skilled Dark Magician effect is good",
      "can I use Skilled Dark Magician effect","use Skilled Dark Magician effect please","use effect later","effect of Skilled Dark Magician",
      "activate Skilled Dark Magician please","Skilled Dark Magician with effect","activate Skilled Dark Magician my effect",
      "activate Man-Eater Bug","activate Blue-Eyes White Dragon","activate some random conversation"])
      expect(parse(text),text).toBeNull();
    expect(parse("use Trap Tracks effect")).toMatchObject({source:{cardId:70825459,cardRef:"trap"}});
    expect(parse("activate Dark Magician")).toMatchObject({source:{cardRef:"normal"}}); // Unique exact name outranks a partial match.
    state.seats[1].twin.push({ref:"unloaded",cardId:999999,name:"Unloaded card",zone:"monster",slot:4,faceUp:true,position:"attack"});
    expect(parse("effect")).toEqual({type:"effect.activated",actorSeat:1,source:{}}); // Missing type facts cannot prove a unique Effect card.
    state.seats[1].twin.pop();
    state.seats[1].twin.push({...state.seats[1].twin[0],ref:"copy",faceUp:false,slot:3});
    expect(parse("Skilled Dark Magician effect")).toMatchObject({source:{cardRef:"skilled"}}); // Face-up first.
    state.seats[1].twin.at(-1)!.faceUp=true;
    for(const text of ["effect","Skilled Dark Magician effect"]) expect(parse(text),text).toEqual({type:"effect.activated",actorSeat:1,source:{}});

    state=ygoModule.reduce(state,remoteActionSchema.parse({type:"card.identified",actorSeat:1,seat:1,cardRef:"copy",cardId:73752131,source:"voice",idempotencyKey:"recent",at:90_000}));
    expect(parse("activate",110_000)).toMatchObject({source:{cardRef:"copy"}});
    expect(parse("activate",110_001)).toEqual({type:"effect.activated",actorSeat:1,source:{}});
    // An unrelated state update must not refresh the identification's age.
    state=ygoModule.reduce(state,{type:"lp.change",actorSeat:1,seat:1,delta:-100,reason:"cost",idempotencyKey:"cost",at:110_001});
    expect(parse("effect",110_002)).toEqual({type:"effect.activated",actorSeat:1,source:{}});
    expect(parse("effect",110_002)!.type==="effect.activated" && remoteActionSchema.safeParse({...parse("effect",110_002),idempotencyKey:"pending"}).success).toBe(false);
    state=ygoModule.reduce(state,remoteActionSchema.parse({type:"twin.place",actorSeat:1,seat:1,zone:"field",card:{ref:"latest",name:"Chicken Game",cardId:67616300},idempotencyKey:"placed",at:120_000}));
    expect(parse("use the effect",120_001)).toMatchObject({source:{cardRef:"latest",cardId:67616300}});
    // A batch identification of two face-up cards is ambiguous even at a recent timestamp.
    state=ygoModule.reduce(state,remoteActionSchema.parse({type:"cards.identified",actorSeat:1,seat:1,source:"auto",cards:[
      {observationId:"a",cardRef:"skilled",cardId:73752131},{observationId:"b",cardRef:"copy",cardId:73752131},
    ],idempotencyKey:"batch",at:130_000}));
    expect(parse("effect",130_001)).toEqual({type:"effect.activated",actorSeat:1,source:{}});
    state.seats[1].twin=[];
    expect(parse("effect",130_001)).toEqual({type:"effect.activated",actorSeat:1,source:{}}); // Never reuse a stale/off-field identification.
    state.seats[1].twin=[{ref:"physical",name:"Chicken Game",cardId:67616300,zone:"field",faceUp:true,position:"attack"},
      {ref:"other-effect",name:"Skilled Dark Magician",cardId:73752131,zone:"monster",slot:1,faceUp:true,position:"attack"}];
    state=ygoModule.reduce(state,remoteActionSchema.parse({type:"twin.place",actorSeat:1,seat:1,source:"auto",zone:"field",card:{ref:"new-camera-ref",name:"Chicken Game",cardId:67616300},idempotencyKey:"reused",at:140_000}));
    expect(state.seats[1].twin.map(card=>card.ref)).toEqual(["physical","other-effect"]);
    expect(parse("effect",140_001)).toMatchObject({source:{cardRef:"physical"}});
    state.seats[1].twin=[
      {ref:"old",cardId:46986414,name:"Dark Magician",zone:"hand",faceUp:true,position:"attack"},
      {ref:"replacement",cardId:46986414,name:"Dark Magician",zone:"monster",slot:1,faceUp:true,position:"attack"},
      {ref:"effect",cardId:73752131,name:"Skilled Dark Magician",zone:"monster",slot:3,faceUp:true,position:"attack"},
    ];
    state=ygoModule.reduce(state,remoteActionSchema.parse({type:"twin.place",actorSeat:1,seat:1,fromRef:"old",zone:"monster",card:{ref:"new",cardId:46986414,name:"Dark Magician",slot:2},idempotencyKey:"from-hand",at:150_000}));
    state=ygoModule.reduce(state,{type:"twin.remove",actorSeat:1,seat:1,cardRef:"old",idempotencyKey:"removed",at:150_010});
    state=ygoModule.reduce(state,{type:"twin.move",actorSeat:1,seat:1,cardRef:"replacement",zone:"monster",slot:2,idempotencyKey:"replacement-moved",at:150_020});
    expect(parse("effect",150_021)).toMatchObject({source:{cardRef:"effect"}}); // Never substitute a later copy for a departed recent source.
  });
});

it("reuses indexed filters for add-then-Set and keeps compound races exact",async()=>{
  const {deriveRemoteEffectPlans}=await import("../../src/remote/effect-filters.js");
  const {CardTags,fillDefaults}=await import("../../src/cards/effects/tags.js");
  const source={id:999,name:"Source",kind:"spell" as const,typeLine:"",subtypes:[],text:"Add 1 Level 4 or lower DARK Beast-Warrior monster from your Deck to your hand.",formats:[],views:0,url:""};
  const reading=deriveRemoteEffectPlans(source)[0];
  expect(reading.filters[0]).toMatchObject({types:["Beast-Warrior"],attributes:["DARK"],level_max:4});
  const tags=CardTags.parse(fillDefaults({summary:"Search and Set",effects:[{timing:"ignition",actions:[
    {verb:"add_to_hand",player:"you",from:["deck"],what:{kinds:["spell"],archetypes:["HERO"]}},
    {verb:"set_spell_trap",player:"you",from:["hand"],what:{}},
  ]}]}));
  const set=deriveRemoteEffectPlans({...source,text:"Add a card, then Set it."},tags).find(p=>p.destination==="set");
  expect(set?.derivedFrom).toBe("effect-index");
  expect(set?.filters[0]).toMatchObject({kinds:["spell"],archetypes:["HERO"]});
});

it("projects multiplayer history, replay, hidden placements and private choices for the exact viewer",()=>{
  const s=deckSession("normal",false); s.select(s.save(originDeck).id);
  s.service.configure(s.room.slug,"g",s.users[0],{format:"normal",showCardsSetFromDeck:false},2001);
  s.service.join(s.room.slug,"g",s.users[1],"Bob",1,2002);
  const deck=s.save(undefined,[],s.users[1]); s.service.selectDeck(s.room.slug,"g",s.users[1],{savedDeckId:deck.id},2003);
  s.service.ready(s.room.slug,"g",s.users[0],true,2004); s.service.ready(s.room.slug,"g",s.users[1],true,2004);
  let room=s.service.start(s.room.slug,"g",s.users[0],2005); let n=0;
  const act=(payload:Record<string,unknown>)=>room=s.service.act(room.slug,"g",s.users[0],{baseSeq:room.lastSeq,action:remoteActionSchema.parse({actorSeat:0,idempotencyKey:"private-"+(++n),...payload})},2100+n);
  act({type:"effect.activated",source:{cardId:70825459}});
  act({type:"twin.place",seat:0,zone:"spell-trap",card:{ref:"private-set",faceUp:false,cardId:53582587,name:"Torrential Tribute"}});
  act({type:"effect.choose",originId:room.state.effectTracking!.origins[0].id,cardId:53582587});
  const opponent=s.service.get(room.slug,"g",s.users[1],0);
  expect(Object.keys(opponent.state.deckChecks.registrations)).toEqual(["1"]);
  for(const view of [opponent,s.service.replay(room.slug,"g",s.users[1]),s.service.snapshot(room.slug,"g")]) {
    const text=JSON.stringify(view); expect(text).not.toContain("Torrential Tribute"); expect(text).not.toContain('"candidates"'); expect(text).not.toContain('"pool"');
  }
  expect(()=>s.service.snapshot(room.slug,"g",s.users[2])).toThrow(/not found/i);
  act({type:"twin.flip",seat:0,cardRef:"private-set",faceUp:true});
  expect(s.service.get(room.slug,"g",s.users[1]).state.seats[0].twin[0].cardId).toBe(53582587);
});

it("never leaks a known hidden card through live deck warning proofs",()=>{
  const s=deckSession("normal"); s.start();
  s.act({type:"twin.place",seat:0,zone:"spell-trap",card:{ref:"hidden-banned",cardId:55144522,faceUp:false}});
  expect(s.room.state.deckChecks.flags.length).toBeGreaterThan(0);
  const publicView=s.service.snapshot(s.room.slug,"g");
  expect(JSON.stringify(publicView)).not.toContain("Pot of Greed");
  expect(publicView.state.deckChecks.flags).toEqual([]);
});

it("supplements a broad effect index reading with printed restrictions",async()=>{
  const {deriveRemoteEffectPlans,remoteEffectMatches}=await import("../../src/remote/effect-filters.js");
  const {CardTags,fillDefaults}=await import("../../src/cards/effects/tags.js");
  const source={id:999,name:"Source",kind:"spell" as const,typeLine:"",subtypes:[],text:"Add 1 Level 4 or lower DARK Beast-Warrior monster from your Deck to your hand.",formats:[],views:0,url:""};
  const tags=CardTags.parse(fillDefaults({summary:"Search",effects:[{timing:"ignition",actions:[{verb:"add_to_hand",player:"you",from:["deck"],what:{kinds:["monster"]}}]}]}));
  const plan=deriveRemoteEffectPlans(source,tags)[0];
  expect(remoteEffectMatches(plan,{...source,id:123,name:"Wrong monster",kind:"monster",level:8,attribute:"LIGHT",monsterType:"Dragon"})).toBe(false);
  expect(remoteEffectMatches(plan,{...source,id:124,name:"Right monster",kind:"monster",level:4,attribute:"DARK",monsterType:"Beast-Warrior"})).toBe(true);
});

it("keeps omitted-zone hidden recognition private even in later event history",()=>{
  const s=deckSession("normal");s.start();
  s.act({type:"twin.place",seat:0,zone:"hand",card:{ref:"private-hand",faceUp:false}});
  s.act({type:"card.identified",seat:0,cardRef:"private-hand",cardId:55144522,source:"click"});
  expect(s.room.state.identified?.name).toBe("Pot of Greed");
  expect(JSON.stringify(s.service.snapshot(s.room.slug,"g"))).not.toContain("Pot of Greed");
  s.act({type:"twin.move",seat:0,cardRef:"private-hand",zone:"spell-trap"});
  s.act({type:"twin.flip",seat:0,cardRef:"private-hand",faceUp:true});
  const history=s.service.snapshot(s.room.slug,"g").events.find(e=>e.action.type==="card.identified");
  expect(history).toBeUndefined();
});

it("links camera reads to a privately chosen Set and keeps batch notes independently dismissible",async()=>{
  const {remoteRecognitionRef}=await import("../../src/remote/effect-tracking.js");
  const s=originSession();
  for(const ref of ["a","b"]) {
    s.act({type:"effect.activated",source:{cardId:70825459}});
    s.act({type:"twin.place",seat:0,zone:"spell-trap",card:{ref,faceUp:false}});
  }
  const origins=s.room.state.effectTracking!.origins;
  s.act({type:"effect.choose",originId:origins[0].id,cardId:53582587});
  expect(remoteRecognitionRef(s.room.state,0,53582587)).toBe("a");
  expect(remoteRecognitionRef(s.room.state,0,5318639)).toBeUndefined();
  expect(remoteRecognitionRef(s.room.state,0,5318639,"b")).toBe("b");
  s.act({type:"cards.identified",seat:0,source:"auto",cards:[
    {cardRef:"a",cardId:5318639,observationId:"one"}, {cardRef:"b",cardId:5318639,observationId:"two"},
  ]});
  const notes=s.room.state.effectTracking!.notes;
  expect(new Set(notes.map(n=>n.id)).size).toBe(2);
  for(const note of notes) s.act({type:"effect.note.dismiss",noteId:note.id});
  expect(s.room.state.effectTracking!.notes.every(n=>n.dismissed)).toBe(true);
});

it("does not announce a searched hand card merely because its private ref is recognized",()=>{
  const s=originSession(); s.act({type:"effect.activated",source:{cardId:73628505}});
  const origin=originOf(s);s.act({type:"effect.choose",originId:origin.id,cardId:47355498});
  s.act({type:"card.identified",seat:0,cardRef:origin.ref,cardId:47355498,source:"auto"});
  const visible=JSON.stringify(s.service.snapshot(s.room.slug,"g"));
  expect(visible).not.toContain("Necrovalley"); expect(visible).not.toContain("47355498");
});

it("uses every engine archetype membership and respects Quick-Play type restrictions",async()=>{
  const {deriveRemoteEffectPlans,remoteEffectMatches}=await import("../../src/remote/effect-filters.js");
  const source={id:999,name:"Source",kind:"spell" as const,typeLine:"",subtypes:[],text:'Add 1 "HERO" Quick-Play Spell from your Deck to your hand.',formats:[],views:0,url:""};
  const plan=deriveRemoteEffectPlans(source)[0];
  const member={...source,id:123,name:"Member",archetype:"Other",archetypes:["HERO"],subtypes:["quick_play" as const]};
  expect(remoteEffectMatches(plan,member)).toBe(true);
  expect(remoteEffectMatches(plan,{...member,subtypes:["continuous"]})).toBe(false);
});

it("does not mistake words inside archetype names for type or attribute restrictions",async()=>{
  const {deriveRemoteEffectPlans}=await import("../../src/remote/effect-filters.js");
  const source={id:999,name:"Source",kind:"spell" as const,typeLine:"",subtypes:[],text:'Add 1 "Crystal Beast" monster from your Deck to your hand.',formats:[],views:0,url:""};
  expect(deriveRemoteEffectPlans(source)[0].filters[0]).toMatchObject({kinds:["monster"],types:[],archetypes:["Crystal Beast"]});
  expect(deriveRemoteEffectPlans({...source,text:'Add 1 "Dark World" card from your Deck to your hand.'})[0].filters[0].attributes).toEqual([]);
});

it("links board recognition one-to-one without spreading a selected ref across the frame",async()=>{
  const {remoteRecognitionRefs,remoteRecognitionRef}=await import("../../src/remote/effect-tracking.js");
  const s=originSession();s.act({type:"effect.activated",source:{cardId:70825459}});
  s.act({type:"twin.place",seat:0,zone:"spell-trap",card:{ref:"hidden",faceUp:false}});
  s.act({type:"effect.choose",originId:originOf(s).id,cardId:53582587});
  expect(remoteRecognitionRefs(s.room.state,0,[53582587,5318639])).toEqual(["hidden",undefined]);
  expect(remoteRecognitionRefs(s.room.state,0,[53582587,53582587,5318639])).toEqual([undefined,undefined,undefined]);
  s.place("public-copy","spell-trap",2,53582587);
  expect(remoteRecognitionRef(s.room.state,0,53582587)).toBeUndefined();
  expect(remoteRecognitionRef(s.room.state,0,5318639,"hidden")).toBe("hidden");
});

it("keeps the remaining same-name Trap Trick copy after its banish cost becomes public",()=>{
  const s=originSession();s.act({type:"effect.activated",source:{cardId:80101899}});
  s.place("banished-cost","banished",1,53582587);
  s.act({type:"twin.place",seat:0,zone:"spell-trap",card:{ref:"set",faceUp:false}});
  expect(originOf(s).candidates?.find(c=>c.cardId===53582587)?.copies).toBe(1);
  const alreadySeen=originSession();alreadySeen.place("already-in-gy","graveyard",1,53582587);
  alreadySeen.act({type:"effect.activated",source:{cardId:80101899}});
  alreadySeen.act({type:"twin.place",seat:0,zone:"spell-trap",card:{ref:"set",faceUp:false}});
  expect(originOf(alreadySeen).candidates?.some(c=>c.cardId===53582587)).toBe(false);
});

it('moves a physical twin to defense under the same ref, with Undo and owner checks',()=>{
  const s=deckSession();s.start();s.place('rotation');
  s.act({type:'twin.move',seat:0,cardRef:'rotation',zone:'monster',slot:1,position:'defense'});
  expect(s.room.state.seats[0].twin[0]).toMatchObject({ref:'rotation',position:'defense'});
  const event=s.room.state.undo!.actionId;
  s.act({type:'undo',targetActionId:event});expect(s.room.state.seats[0].twin[0].position).toBe('attack');
  expect(()=>s.act({type:'twin.move',actorSeat:1,seat:0,cardRef:'rotation',zone:'monster',position:'defense'})).toThrow(/owner/);
});

it('persists one named automatic departure with destination correction and normal owner/Undo rules',()=>{
  const s=deckSession();s.start();s.place('leaving');const before=s.room.state.seats[0].twin[0];
  const departure={type:'twin.move',seat:0,cardRef:'leaving',zone:'graveyard',source:'auto',name:'Varudras'} as const;
  s.act(departure);expect(s.room.state.seats[0].twin).toEqual([{...before,zone:'graveyard',slot:undefined,departedFrom:expect.objectContaining({zone:'monster',slot:1,auto:true})}]);
  expect(s.room.events.at(-1)?.action).toMatchObject(departure);expect(s.service.replay(s.room.slug,'g',s.users[0])).toEqual(s.room.state);
  const left=s.room.state.undo!.actionId;s.act({type:'undo',targetActionId:left});expect(s.room.state.seats[0].twin[0]).toEqual(before);
  s.act(departure);s.act({...departure,zone:'banished'});const corrected=s.room.state.undo!.actionId;
  s.act({type:'undo',targetActionId:corrected});expect(s.room.state.seats[0].twin[0].zone).toBe('graveyard');
  expect(()=>s.act({...departure,actorSeat:1})).toThrow(/owner/);
  expect(remoteActionSchema.safeParse({...departure,idempotencyKey:'bounded',actorSeat:0,name:'x'.repeat(201)}).success).toBe(false);
});


it("retains each actor's last twenty actions across this and the previous turn without a clock limit", () => {
  let state = ygoModule.initialState({seatCount:2});
  const act = (input: Record<string, unknown>) => state = ygoModule.reduce(state, remoteActionSchema.parse({actorSeat:0,at:100000,idempotencyKey:"unused",...input}));
  for(let i=0;i<21;i++) act({type:"lp.change",seat:0,delta:-10,reason:"cost",idempotencyKey:`cost-${i}`});
  expect(ygoModule.parseCommand({text:"undo",actorSeat:0,state})).toMatchObject({type:"undo",targetActionId:"cost-20"});
  expect(() => act({type:"undo",targetActionId:"cost-20",actorSeat:1})).toThrow(/own/i);
  expect(() => act({type:"undo",targetActionId:"cost-0"})).toThrow(/20|recent/i);
  for(let i=20;i>=1;i--) act({type:"undo",targetActionId:`cost-${i}`,idempotencyKey:`undo-${i}`,at:200000});
  expect(state.seats[0].resources.lp).toBe(7990);
  act({type:"lp.change",seat:0,delta:-100,reason:"cost",idempotencyKey:"previous",at:200000});
  act({type:"turn.end",idempotencyKey:"pass",at:200000});
  act({type:"lp.change",actorSeat:1,seat:1,delta:-200,reason:"cost",idempotencyKey:"opponent",at:200000});
  act({type:"undo",targetActionId:"pass",at:200000});
  expect(state.turn).toBe(1); expect(state.seats[1].resources.lp).toBe(7800);
  act({type:"undo",targetActionId:"previous",at:200000});
  expect(state.seats[0].resources.lp).toBe(7990);
  act({type:"turn.end",idempotencyKey:"pass-again",at:200000});
  act({type:"turn.end",actorSeat:1,idempotencyKey:"pass-back",at:200000});
  expect(() => act({type:"undo",targetActionId:"pass-again",at:200000})).toThrow(/turn|recent/i);
  state = ygoModule.initialState({seatCount:3});
  act({type:"player.concede",idempotencyKey:"first-loss"});
  act({type:"player.concede",actorSeat:1,idempotencyKey:"last-loss"});
  act({type:"undo",targetActionId:"first-loss"});
  expect(state.ended).toBe(false); expect(state.winnerSeat).toBeNull();
  expect(state.seats.map(s=>s.eliminated)).toEqual([false,true,false]);
});

it("targets an untouched card after LP changes, rejects dependencies, and preserves retries, broadcast privacy and replay", () => {
  const s=deckSession(); s.select(s.save().id); s.start();
  s.place("magician","monster",1,46986414);
  s.act({type:"twin.move",seat:0,cardRef:"magician",zone:"monster",slot:3,name:"Dark Magician"});
  const move=s.room.state.undo!.actionId;
  s.act({type:"lp.change",seat:0,delta:-500,reason:"cost"});
  expect(s.room.state.undoHistory?.map(e=>e.actionId).slice(0,2)).toEqual([s.room.state.undo!.actionId,move]);
  expect(s.room.state.undoHistory?.find(e=>e.actionId===move)).toMatchObject({action:{type:"twin.move",cardRef:"magician",slot:3}});
  expect(s.room.state.undoHistory?.find(e=>e.actionId===move)?.before).toBeUndefined();
  const input={baseSeq:s.room.lastSeq,action:remoteActionSchema.parse({type:"undo",actorSeat:0,targetActionId:move,idempotencyKey:"targeted"})};
  const undone=s.service.act(s.room.slug,"g",s.users[0],input,12000);
  expect(undone.state.seats[0].twin[0].slot).toBe(1);
  expect(undone.state.seats[0].resources.lp).toBe(7500);
  expect(undone.events.at(-1)?.messages?.join(" ")).toContain("Undone: Dark Magician → M3");
  expect(s.service.act(s.room.slug,"g",s.users[0],input,12001).lastSeq).toBe(undone.lastSeq);
  expect(s.service.replay(s.room.slug,"g",s.users[0])).toEqual(undone.state);
  const broadcast=s.service.snapshot(s.room.slug,"g");
  expect(broadcast.state.seats[0].twin[0].slot).toBe(1);
  expect(JSON.stringify(broadcast)).not.toContain('"changes"');
  const act=(input:Record<string,unknown>)=>s.service.act(s.room.slug,"g",s.users[0],{baseSeq:s.service.get(s.room.slug,"g",s.users[0]).lastSeq,action:remoteActionSchema.parse({actorSeat:0,...input})},13000);
  act({type:"twin.move",seat:0,cardRef:"magician",zone:"monster",slot:3,idempotencyKey:"move-again"});
  act({type:"twin.flip",seat:0,cardRef:"magician",faceUp:true,idempotencyKey:"touch"});
  expect(()=>act({type:"undo",targetActionId:"move-again",idempotencyKey:"blocked"})).toThrow(/later action.*card/i);
  act({type:"undo",targetActionId:"touch",idempotencyKey:"undo-touch"});
  act({type:"twin.place",seat:0,zone:"monster",card:{ref:"occupied",slot:1},idempotencyKey:"occupied"});
  expect(()=>act({type:"undo",targetActionId:"move-again",idempotencyKey:"occupied-undo"})).toThrow(/occupied/i);
});

it.each(['graveyard','banished'])('targeted undo restores %s pile order while preserving later edits to other cards',pile=>{
 let state=ygoModule.initialState({seatCount:2}),serial=0;
 const act=(input:Record<string,unknown>)=>state=ygoModule.reduce(state,remoteActionSchema.parse({actorSeat:0,...(input.type==='undo'?{}:{seat:0}),at:1000,idempotencyKey:`pile-order-${++serial}`,...input}));
 act({type:'twin.place',zone:pile,card:{ref:'older',cardId:1,faceUp:true}});
 act({type:'twin.place',zone:pile,card:{ref:'newer',cardId:2,faceUp:true}});
 act({type:'twin.move',cardRef:'older',zone:pile==='graveyard'?'banished':'graveyard'});
 const moved=state.undo!.actionId;
 act({type:'twin.flip',cardRef:'newer',faceUp:false});
 act({type:'twin.place',zone:pile,card:{ref:'latest',cardId:3,faceUp:true}});
 act({type:'undo',targetActionId:moved});
 expect(state.seats[0].twin.filter(card=>card.zone===pile).map(card=>card.ref)).toEqual(['older','newer','latest']);
 expect(state.seats[0].twin.find(card=>card.ref==='newer')?.faceUp).toBe(false);
});

it('targeted pile undo skips an old neighbor that independently moved to another pile',()=>{
 let state=ygoModule.initialState({seatCount:2}),serial=0;
 const act=(input:Record<string,unknown>)=>state=ygoModule.reduce(state,remoteActionSchema.parse({actorSeat:0,...(input.type==='undo'?{}:{seat:0}),at:1000,idempotencyKey:`pile-neighbor-${++serial}`,...input}));
 for(const ref of ['older','middle','newer'])act({type:'twin.place',zone:'graveyard',anotherCopy:true,card:{ref,cardId:1,faceUp:true}});
 act({type:'twin.move',cardRef:'older',zone:'banished'});const moved=state.undo!.actionId;
 act({type:'twin.move',cardRef:'middle',zone:'banished'});
 act({type:'undo',targetActionId:moved});
 expect(state.seats[0].twin.filter(card=>card.zone==='graveyard').map(card=>card.ref)).toEqual(['older','newer']);
 expect(state.seats[0].twin.find(card=>card.ref==='middle')?.zone).toBe('banished');
});

it.each([false,true])('targeted pile undo preserves later reentries with target last=%s',targetLast=>{
 let state=ygoModule.initialState({seatCount:2}),serial=0;
 const act=(input:Record<string,unknown>)=>state=ygoModule.reduce(state,remoteActionSchema.parse({actorSeat:0,...(input.type==='undo'?{}:{seat:0}),at:1000,idempotencyKey:`pile-reentry-${++serial}`,...input}));
 for(const ref of targetLast?['neighbor','target']:['target','neighbor','remaining'])act({type:'twin.place',zone:'graveyard',anotherCopy:true,card:{ref,cardId:1,faceUp:true}});
 act({type:'twin.move',cardRef:'target',zone:'banished'});const moved=state.undo!.actionId;
 act({type:'twin.move',cardRef:'neighbor',zone:'banished'});
 act({type:'twin.move',cardRef:'neighbor',zone:'graveyard'});
 act({type:'undo',targetActionId:moved});
 expect(state.seats[0].twin.filter(card=>card.zone==='graveyard').map(card=>card.ref)).toEqual(targetLast?['target','neighbor']:['target','remaining','neighbor']);
});

it('targeted pile undo restores a removed card before later pile arrivals',()=>{
 let state=ygoModule.initialState({seatCount:2}),serial=0;
 const act=(input:Record<string,unknown>)=>state=ygoModule.reduce(state,remoteActionSchema.parse({actorSeat:0,...(input.type==='undo'?{}:{seat:0}),at:1000,idempotencyKey:`pile-removed-${++serial}`,...input}));
 act({type:'twin.place',zone:'graveyard',card:{ref:'older',cardId:1,faceUp:true}});
 act({type:'twin.remove',cardRef:'older'});const removed=state.undo!.actionId;
 act({type:'twin.place',zone:'graveyard',card:{ref:'newer',cardId:2,faceUp:true}});
 act({type:'undo',targetActionId:removed});
 expect(state.seats[0].twin.map(card=>card.ref)).toEqual(['older','newer']);
});

it('sends no undo position and runs the restore check only for the newest undo entry, unless all are asked for',async()=>{
  const {projectRemoteState}=await import('../../src/remote/privacy.js');
  let state=ygoModule.initialState({seatCount:2});let serial=0;
  const reduce=(proposal:Record<string,unknown>)=>state=ygoModule.reduce(state,remoteActionSchema.parse({...proposal,actorSeat:0,idempotencyKey:`reasons-${++serial}`,at:serial}),{facts:{}});
  const place=(ref:string,slot:number)=>reduce({type:'twin.place',seat:0,zone:'monster',card:{ref,cardId:1000+slot,faceUp:true,slot}});
  place('a',1);place('b',2);reduce({type:'twin.move',seat:0,cardRef:'a',zone:'graveyard'});place('c',1);
  const reasons=(options?:{allUndoReasons?:boolean})=>projectRemoteState(state,new Set([0]),options).undoHistory!.map(entry=>entry.reason);
  expect(projectRemoteState(state,new Set([0])).undo).toEqual({actionId:'reasons-4',at:4});
  // Entry 3 (the move back into slot 1) now collides with card c: only the full check sees it.
  expect(reasons()).toEqual([undefined,undefined,undefined,expect.stringMatching(/same card/)]);
  expect(reasons({allUndoReasons:true})).toEqual([undefined,expect.stringMatching(/slot is occupied/),expect.stringMatching(/state needed/),expect.stringMatching(/same card/)]);
  // A saved old-format entry has no positions: its stored reason stays.
  const saved={...state,undoHistory:state.undoHistory!.map(({before:_b,after:_a,...entry})=>({...entry,reason:'Stored reason'}))};
  expect(projectRemoteState(saved,new Set([0])).undoHistory!.map(entry=>entry.reason)).toEqual(Array(4).fill('Stored reason'));
});

it('reveals identity and position in one undoable action, then hides a public Set that returns to hand',async()=>{
  const {projectRemoteState}=await import('../../src/remote/privacy.js');
  const {remoteUndoLabel:sharedUndoLabel}=await import('../../src/remote/undo.js');
  let state=ygoModule.initialState({seatCount:2});let serial=0;
  const reduce=(proposal:Record<string,unknown>)=>state=ygoModule.reduce(state,remoteActionSchema.parse({...proposal,actorSeat:0,idempotencyKey:`atomic-${++serial}`,at:serial}),{facts:{900001:{code:900001,copyKey:900001,name:'Man with the Mark',limit:3,section:'main'}}});
  reduce({type:'twin.place',seat:0,zone:'monster',card:{ref:'set',slot:2,faceUp:false,position:'defense'}});
  const before=structuredClone(state);
  reduce({type:'twin.flip',seat:0,cardRef:'set',faceUp:true,cardId:46986414,name:'Dark Magician',position:'attack',source:'auto',bestMatch:true});
  expect(state.seats[0].twin[0]).toMatchObject({ref:'set',faceUp:true,cardId:46986414,name:'Dark Magician',position:'attack',bestMatch:true});
  const revealed=structuredClone(state),actionId=state.undo!.actionId;
  const legacySet=ygoModule.reduce(revealed,remoteActionSchema.parse({type:'twin.flip',actorSeat:0,seat:0,cardRef:'set',faceUp:false,idempotencyKey:'historic-set',at:serial}),{replay:true,twinPlacementGuard:1});
  expect(legacySet.seats[0].twin[0].publicIdentity).toBeUndefined();
  reduce({type:'undo',targetActionId:actionId});expect(state.seats[0].twin).toEqual(before.seats[0].twin);
  // The camera sees it turned face-down: the opponent sees a plain Set, the owner keeps the name.
  state=structuredClone(revealed);reduce({type:'twin.flip',seat:0,cardRef:'set',faceUp:false,source:'auto',position:'defense'});
  expect(state.seats[0].twin[0]).toMatchObject({faceUp:false,cardId:46986414,name:'Dark Magician'});expect(state.seats[0].twin[0].publicIdentity).toBeUndefined();
  expect(projectRemoteState(state,new Set([1])).seats[0].twin[0].cardId).toBeUndefined();expect(projectRemoteState(state,new Set([1])).seats[0].twin[0].name).toBeUndefined();
  expect(projectRemoteState(state,new Set([1])).deckChecks.instances.filter(i=>i.seat===0)).toEqual([]);
  // Why the watcher needs a clear back to flip an Xyz Monster (fieldStrongBack): the flip sends its materials to the GY, and a flip up does not bring them back.
  state=ygoModule.initialState({seatCount:2});
  reduce({type:'twin.place',seat:0,zone:'monster',card:{ref:'mat',slot:1,cardId:1,name:'Material',faceUp:true,position:'attack'}});reduce({type:'twin.place',seat:0,zone:'extra-monster',card:{ref:'xyz',slot:1,cardId:3,name:'Xyz',faceUp:true,position:'attack',bestMatch:true}});reduce({type:'twin.attach',seat:0,cardRef:'xyz',kind:'xyz',materialRefs:['mat']});
  reduce({type:'twin.flip',seat:0,cardRef:'xyz',faceUp:false,source:'auto',position:'defense'});expect(projectRemoteState(state,new Set([1])).seats[0].twin.find(c=>c.ref==='xyz')?.bestMatch).toBeUndefined();reduce({type:'twin.flip',seat:0,cardRef:'xyz',faceUp:true,source:'auto',position:'attack',cardId:3,name:'Xyz'});
  expect(state.seats[0].twin.find(c=>c.ref==='mat')?.zone).toBe('graveyard');expect(state.seats[0].twin.find(c=>c.ref==='xyz')?.materials).toBeUndefined();
  state=revealed;reduce({type:'twin.flip',seat:0,cardRef:'set',faceUp:false});expect(state.seats[0].twin[0].publicIdentity).toBe(true);
  const publicSet=structuredClone(state);reduce({type:'twin.move',seat:0,cardRef:'set',zone:'hand'});
  expect(state.seats[0].twin[0].publicIdentity).toBeUndefined();expect(projectRemoteState(state,new Set([1])).seats[0].twin[0].cardId).toBeUndefined();
  state=publicSet;state.twinConfirmation={seat:0,cardRef:'incoming',existingRefs:['set'],anotherCopyAllowed:true,message:'Where did this card come from?',options:[{ref:'set',label:'Moved from M2'},{label:'New copy'}]};state=ygoModule.reduce(state,remoteActionSchema.parse({type:'twin.place',actorSeat:0,seat:0,zone:'monster',originRequestRef:'incoming',anotherCopy:true,card:{ref:'incoming',cardId:46986414,slot:3},idempotencyKey:'legacy-origin',at:++serial}),{replay:true,twinPlacementGuard:2});
  expect(state.seats[0].twin.find(c=>c.ref==='set')).toMatchObject({zone:'hand'});expect(state.seats[0].twin.find(c=>c.ref==='set')?.publicIdentity).toBeUndefined();
  expect(()=>reduce({type:'twin.flip',seat:0,cardRef:'set',faceUp:true,cardId:46986414})).toThrow(/public card zone/);
  expect(remoteActionSchema.safeParse({type:'twin.flip',actorSeat:0,seat:0,idempotencyKey:'bad',cardRef:'set',faceUp:false,cardId:46986414}).success).toBe(false);

  // Strict hand actions are available to the UI without casts or a target seat.
  const handProposals = [
    {type:'hand.add',actorSeat:0,cardId:69299029,source:'field'},
    {type:'hand.reveal',actorSeat:0,cardId:69299029},
    {type:'hand.forget',actorSeat:0,id:'known-copy'},
    {type:'hand.count',actorSeat:0,delta:1},
    {type:'hand.count',actorSeat:0,value:0},
  ] satisfies RemoteActionProposal[];
  for (const proposal of handProposals) {
    const input = {...proposal,idempotencyKey:'hand-schema'};
    expect(remoteActionSchema.safeParse(input).success).toBe(true);
    expect(remoteActionSchema.safeParse({...input,seat:1}).success).toBe(false);
    expect(remoteActionSchema.safeParse({...input,hideAfterTurn:true}).success).toBe(false);
  }
  for (const payload of [{},{delta:1,value:5},{delta:1.5},{value:1.5},{value:-1},{value:1000000},{delta:1000000},{delta:-1000000},{value:'5'},{value:null},{delta:Infinity}])
    expect(remoteActionSchema.safeParse({type:'hand.count',actorSeat:0,idempotencyKey:'invalid-count',...payload}).success).toBe(false);
  state=ygoModule.initialState({seatCount:4});
  state.deckChecks.format.settings.startingHand=7;
  reduce({type:'hand.count',delta:1});expect(state.seats[0].handCount).toBe(8);
  expect(state.seats[0].deckCount).toBeUndefined();
  const counted=structuredClone(state),countId=state.undo!.actionId;
  expect(sharedUndoLabel(state.undoHistory!.at(-1)!.action)).toBe('Changed hand count');
  for (const viewer of [new Set<number>(),new Set([0]),new Set([1]),new Set([2]),new Set([3])])
    expect(projectRemoteState(state,viewer).seats[0].handCount).toBe(8);
  reduce({type:'undo',targetActionId:countId});expect(state.seats[0].handCount).toBeUndefined();
  state=counted;reduce({type:'hand.count',delta:-2});expect(state.seats[0].handCount).toBe(6);
  expect(projectRemoteState(state,new Set([1])).undo).not.toHaveProperty('before');
  reduce({type:'hand.count',value:0});expect(state.seats[0].handCount).toBe(0);
  expect(()=>reduce({type:'hand.count',delta:-1})).toThrow(/hand count/i);
  reduce({type:'hand.count',value:999999});expect(()=>reduce({type:'hand.count',delta:1})).toThrow(/hand count/i);
  reduce({type:'hand.count',value:5});reduce({type:'hand.count',delta:0});expect(state.seats[0].handCount).toBe(5);

  // Shared hand contract: public knowledge and hand counts, private deck counts, exits and Undo.
  const shared=await import('../../src/remote/index.js');
  state=ygoModule.initialState({seatCount:2});
  const by={cardId:900001,name:'Man with the Mark'};
  reduce({type:'hand.add',cardId:69299029,source:'deck',by});
  const added=structuredClone(state),addedId=state.undo!.actionId;
  expect(state.seats[0].knownHand).toEqual([expect.objectContaining({id:addedId,cardId:69299029,source:'deck',by,revealed:true})]);
  expect(state.seats[0].handCount).toBe(6);
  const opponent=projectRemoteState(state,new Set([1]));
  expect(opponent.seats[0].knownHand).toEqual(state.seats[0].knownHand);
  expect(opponent.seats[0].handCount).toBe(6);
  expect(opponent.undo).not.toHaveProperty('before');
  reduce({type:'undo',targetActionId:addedId});expect(state.seats[0].knownHand??[]).toEqual([]);
  state=added;
  reduce({type:'hand.count',value:9});
  expect(state.seats[0]).toEqual({...added.seats[0],handCount:9});
  reduce({type:'undo',targetActionId:state.undo!.actionId});expect(state.seats).toEqual(added.seats);
  reduce({type:'hand.reveal',cardId:69299029});expect(state.seats[0].knownHand).toHaveLength(1);expect(state.seats[0].handCount).toBe(6);
  reduce({type:'twin.place',seat:0,zone:'field',card:{ref:'played-search',cardId:69299029}});
  expect(state.seats[0].knownHand).toEqual([]);expect(state.seats[0].handCount).toBe(5);
  expect(state.seats[0].twin.filter(c=>c.cardId===69299029)).toHaveLength(1);
  reduce({type:'twin.move',seat:0,cardRef:state.seats[0].twin[0].ref,zone:'graveyard'});
  const pile=structuredClone(state);
  reduce({type:'hand.add',cardId:69299029,source:'gy'});
  expect(state.seats[0].twin.filter(c=>c.zone==='graveyard')).toEqual([]);
  reduce({type:'undo',targetActionId:state.undo!.actionId});expect(state.seats[0]).toEqual(pile.seats[0]);
  reduce({type:'hand.add',cardId:69299029,source:'gy'});
  reduce({type:'hand.add',cardId:69299029,source:'unknown'});
  expect(state.seats[0].knownHand).toHaveLength(2);
  const inHand=state.seats[0].twin.find(c=>c.zone==='hand')!;
  reduce({type:'twin.move',seat:0,cardRef:inHand.ref,zone:'deck'});
  expect(state.seats[0].knownHand).toHaveLength(1);
  reduce({type:'hand.forget',id:state.seats[0].knownHand![0].id});expect(state.seats[0].knownHand).toEqual([]);
  reduce({type:'hand.reveal',cardId:29762407});
  reduce({type:'hand.reveal',cardId:69299029});
  reduce({type:'turn.end'});expect(state.seats[0].knownHand?.map(c=>c.cardId)).toEqual([29762407,69299029]);
  const oneTurn=ygoModule.initialState({seatCount:2});oneTurn.revealedHand='one-turn';state=oneTurn;
  reduce({type:'hand.reveal',cardId:29762407});reduce({type:'turn.end'});expect(state.seats[0].knownHand).toEqual([]);
  state=ygoModule.initialState({seatCount:2,firstSeat:1});state.revealedHand='one-turn';
  reduce({type:'hand.reveal',cardId:29762407});
  state=ygoModule.reduce(state,remoteActionSchema.parse({type:'turn.end',actorSeat:1,idempotencyKey:'other-turn',at:++serial}));
  expect(state.seats[0].knownHand).toHaveLength(1);reduce({type:'turn.end'});expect(state.seats[0].knownHand).toEqual([]);
  expect(()=>reduce({type:'hand.add',cardId:69299029,source:'banish'})).toThrow(/source|pile/i);
  expect(shared.remoteHandActionFromVision({cardId:29762407,mode:'add'},0)).toEqual({type:'hand.add',actorSeat:0,cardId:29762407,source:'unknown'});
  expect(shared.remoteHandActionFromVision({cardId:29762407,mode:'reveal'},0)).toEqual({type:'hand.reveal',actorSeat:0,cardId:29762407});

  // Only effect additions, explicit reveals, and field returns enter public hand knowledge.
  state=ygoModule.initialState({seatCount:2});
  reduce({type:'twin.place',seat:0,zone:'hand',card:{ref:'drawn',cardId:29762407,faceUp:false}});
  expect(state.seats[0].knownHand).toEqual([]);
  reduce({type:'twin.place',seat:0,zone:'monster',card:{ref:'bounce',cardId:900001}});
  reduce({type:'twin.move',seat:0,cardRef:'bounce',zone:'hand',source:'auto'});
  expect(state.seats[0].knownHand).toEqual([expect.objectContaining({cardId:900001,source:'field',revealed:true})]);
  const bounceState=structuredClone(state),bounceId=state.undo!.actionId;
  reduce({type:'undo',targetActionId:bounceId});expect(state.seats[0].knownHand).toEqual([]);
  state=bounceState;reduce({type:'turn.end'});expect(state.seats[0].knownHand).toHaveLength(1);
  reduce({type:'hand.add',cardId:69299029,source:'unknown'});
  const copyRef=state.seats[0].twin.find(c=>c.zone==='hand'&&c.cardId===69299029)!.ref;
  reduce({type:'twin.move',seat:0,cardRef:copyRef,zone:'graveyard'});
  expect(state.seats[0].knownHand?.map(c=>c.cardId)).toEqual([900001]);
  reduce({type:'hand.add',cardId:69299029,source:'gy'});
  const returnRef=state.seats[0].twin.find(c=>c.zone==='hand'&&c.cardId===69299029)!.ref;
  reduce({type:'twin.move',seat:0,cardRef:returnRef,zone:'banished'});
  reduce({type:'hand.add',cardId:69299029,source:'banish'});
  expect(state.seats[0].twin.some(c=>c.zone==='banished')).toBe(false);
  reduce({type:'hand.reveal',cardId:29762407});
  reduce({type:'twin.place',seat:0,zone:'graveyard',card:{ref:'discard-revealed',cardId:29762407}});
  expect(state.seats[0].knownHand?.some(c=>c.cardId===29762407)).toBe(false);
  reduce({type:'twin.place',seat:0,zone:'extra',card:{ref:'extra-card',cardId:29762407}});
  reduce({type:'hand.add',cardId:29762407,source:'extra'});
  expect(state.seats[0].twin.find(c=>c.ref==='extra-card')?.zone).toBe('hand');
  expect(state.seats[0].knownHand?.at(-1)?.source).toBe('extra');
  const beforeInspection=structuredClone(state.seats[0].knownHand);
  reduce({type:'twin.place',seat:0,zone:'graveyard',card:{ref:'inspection',cardId:99}});
  reduce({type:'pile.lift',seat:0,zone:'graveyard',cardRefs:['inspection']});
  expect(state.seats[0].knownHand).toEqual(beforeInspection);
  // A direct pile origin must not consume an unrelated same-name hand copy.
  reduce({type:'twin.place',seat:0,zone:'graveyard',card:{ref:'direct-pile',cardId:69299029}});
  const directPileRef=state.seats[0].twin.find(c=>c.zone==='graveyard'&&c.cardId===69299029)!.ref;
  reduce({type:'hand.add',cardId:69299029,source:'unknown'});
  const knownCopies=state.seats[0].knownHand?.length;
  reduce({type:'twin.place',seat:0,zone:'field',fromRef:directPileRef,card:{ref:'direct-field',cardId:69299029}});
  expect(state.seats[0].knownHand).toHaveLength(knownCopies!);

  state=ygoModule.initialState({seatCount:2});
  reduce({type:'twin.place',seat:0,zone:'monster',card:{ref:'explicit-bounce',cardId:900001,slot:3}});
  const beforeFieldAdd=structuredClone(state);
  reduce({type:'hand.add',cardId:900001,source:'field'});
  expect(state.seats[0].knownHand).toEqual([expect.objectContaining({cardId:900001,source:'field',revealed:true})]);
  expect(state.seats[0].twin).toMatchObject([{ref:'explicit-bounce',zone:'hand',departedFrom:{zone:'monster',slot:3}}]);
  expect(projectRemoteState(state,new Set([1])).seats[0].knownHand).toEqual(state.seats[0].knownHand);
  reduce({type:'undo',targetActionId:state.undo!.actionId});expect(state.seats).toEqual(beforeFieldAdd.seats);

  // A discard reuses the physical hand ref; automatic field re-reads keep the field owner.
  state=ygoModule.initialState({seatCount:2});
  reduce({type:'hand.add',cardId:69299029,source:'unknown'});
  const discardRef=state.seats[0].twin[0].ref;
  reduce({type:'twin.place',seat:0,zone:'graveyard',card:{ref:'discard-copy',cardId:69299029}});
  expect(state.seats[0].twin).toMatchObject([{ref:discardRef,zone:'graveyard'}]);expect(state.seats[0].knownHand).toEqual([]);
  state=ygoModule.initialState({seatCount:2});
  reduce({type:'twin.place',seat:0,zone:'field',card:{ref:'field-owner',cardId:69299029}});
  reduce({type:'hand.add',cardId:69299029,source:'unknown'});
  reduce({type:'twin.place',seat:0,zone:'field',source:'auto',card:{ref:'new-camera-ref',cardId:69299029}});
  expect(state.seats[0].twin.find(c=>c.ref==='field-owner')?.zone).toBe('field');expect(state.seats[0].knownHand).toHaveLength(1);
  reduce({type:'twin.place',seat:0,zone:'monster',card:{ref:'field-owner',cardId:69299029,slot:2}});
  expect(state.seats[0].twin.find(c=>c.ref==='field-owner')).toMatchObject({zone:'monster',slot:2});expect(state.seats[0].knownHand).toHaveLength(1);
  const historical=ygoModule.reduce(state,remoteActionSchema.parse({type:'twin.place',actorSeat:0,seat:0,zone:'monster',anotherCopy:true,card:{ref:'historic-new-copy',cardId:69299029},idempotencyKey:'historic-copy',at:++serial}),{replay:true,twinPlacementGuard:5});
  expect(historical.seats[0].twin.find(c=>c.ref==='historic-new-copy')).toBeDefined();expect(historical.seats[0].twin.filter(c=>c.zone==='hand')).toHaveLength(1);

  // Review regressions use this same test: private returns, counts, and physical copies.
  state=ygoModule.initialState({seatCount:2});
  reduce({type:'twin.place',seat:0,zone:'spell-trap',card:{ref:'private-set',cardId:555,faceUp:false}});
  reduce({type:'twin.move',seat:0,cardRef:'private-set',zone:'hand'});
  expect(projectRemoteState(state,new Set([1])).seats[0].knownHand).toEqual([]);
  state=ygoModule.initialState({seatCount:2});
  reduce({type:'twin.place',seat:0,zone:'spell-trap',card:{ref:'private-set',cardId:555,faceUp:false}});
  reduce({type:'hand.add',cardId:555,source:'field'});
  expect(projectRemoteState(state,new Set([1])).seats[0].knownHand).toEqual([]);
  state=ygoModule.initialState({seatCount:2});
  state.seats[0].handCount=4;
  state.seats[0].twin=[{ref:'link-material',cardId:10,zone:'monster',slot:1,faceUp:true,position:'attack'}];
  reduce({type:'twin.place',seat:0,zone:'extra-monster',card:{ref:'link',cardId:20,slot:1},summon:{kind:'link',materialRefs:['link-material']}});
  expect(state.seats[0].handCount).toBe(4);
  state=ygoModule.initialState({seatCount:2});
  reduce({type:'turn.end'});
  state=ygoModule.reduce(state,remoteActionSchema.parse({type:'turn.end',actorSeat:1,idempotencyKey:'review-draw',at:++serial}));
  expect(state.seats.map(s=>s.handCount)).toEqual([6,6]);
  expect(ygoModule.parseCommand({text:'draw',actorSeat:0,state})).toEqual({type:'hand.draw',actorSeat:0,count:1});
  reduce({type:'hand.draw',count:1});expect(state.seats[0].handCount).toBe(6);
  reduce({type:'hand.draw',count:2});expect(state.seats[0].handCount).toBe(8);
  reduce({type:'deck.count',value:30});
  reduce({type:'deck.count',delta:-2});expect(state.seats[0].handCount).toBe(10);
  reduce({type:'deck.count',delta:-1,cause:'other'});expect(state.seats[0].handCount).toBe(10);
  state=ygoModule.initialState({seatCount:2});
  reduce({type:'hand.count',value:3});
  reduce({type:'twin.place',seat:0,zone:'graveyard',card:{ref:'inspect-review',cardId:99}});
  reduce({type:'pile.lift',seat:0,zone:'graveyard',cardRefs:['inspect-review']});
  expect(state.seats[0].handCount).toBe(3);
  reduce({type:'twin.move',seat:0,cardRef:'inspect-review',zone:'graveyard'});
  expect(state.seats[0].handCount).toBe(3);
  state=ygoModule.initialState({seatCount:2});
  reduce({type:'hand.add',cardId:69299029,source:'unknown'});
  reduce({type:'twin.place',seat:0,zone:'spell-trap',card:{ref:'anonymous-set',slot:1,faceUp:false}});
  expect(state.seats[0].knownHand).toHaveLength(1);
  expect(state.seats[0].handCount).toBe(5);
  reduce({type:'twin.flip',seat:0,cardRef:'anonymous-set',faceUp:true,cardId:69299029});
  expect(state.seats[0].knownHand).toEqual([]);
  expect(state.seats[0].twin.filter(c=>c.zone==='hand')).toEqual([]);
  expect(state.seats[0].handCount).toBe(5);
  reduce({type:'hand.reveal',cardId:29762407});
  const beforeNoop=state;
  reduce({type:'hand.reveal',cardId:29762407});
  expect(state).toBe(beforeNoop);

  // Review guards must not reject historical actions that the old service accepted.
  const legacyRepeat=structuredClone(state);
  legacyRepeat.effectTracking={contexts:{},notes:[],origins:[{id:'legacy-counted',seat:0,ref:'old-search',destination:'hand',source:by,handCounted:true,announceRecommended:true,derivedFrom:'text',pool:[{cardId:69299029,copyKey:69299029,name:'Treasures',copies:1}]}]};
  expect(()=>ygoModule.reduce(legacyRepeat,remoteActionSchema.parse({type:'hand.add',actorSeat:0,source:'deck',cardId:69299029,by,idempotencyKey:'legacy-repeat',at:++serial}),{replay:true,handKnowledge:1})).not.toThrow();
  for(const [source,zone] of [['gy','graveyard'],['banish','banished']] as const) {
    const legacyRecovery=structuredClone(legacyRepeat);
    legacyRecovery.seats[0].twin.push({ref:'legacy-recovery',cardId:69299029,zone,faceUp:true,position:'attack'});
    expect(()=>ygoModule.reduce(legacyRecovery,remoteActionSchema.parse({type:'hand.add',actorSeat:0,source,cardId:69299029,by,idempotencyKey:'legacy-recovery',at:++serial}),
      {replay:true,handKnowledge:1,handReview:1})).not.toThrow();
  }
  const proposalsPath=new URL('../../../web/src/lib/remote/field-proposals.ts',import.meta.url).pathname;
  const fieldProposals=await import(proposalsPath);
  const departureCard={ref:'departure-race',zone:'monster',slot:1,cardId:42,faceUp:true,position:'attack' as const};
  expect(fieldProposals.fieldDepartureStillMissing({...departureCard,zone:'graveyard'},departureCard,[])).toBe(false);
  expect(fieldProposals.fieldDepartureStillMissing({...departureCard,slot:2},departureCard,[])).toBe(false);
  expect(fieldProposals.fieldDepartureStillMissing(departureCard,departureCard,[])).toBe(true);
  const pendingField={id:'unread-play',zone:'M1',visible:true,removed:false,state:'candidate',firstSeen:1200};
  expect(fieldProposals.heldFieldReadPending([pendingField],1000)).toBe(true);
  expect(fieldProposals.heldFieldReadPending([{...pendingField,state:'identified',cardId:'42'}],1000)).toBe(false);


  // Extra Deck facts and tokens also skip the implicit play-from-hand decrement.
  for(const type of [0x40,0x2000,0x800000,0x4000000,0x4000]) {
    let countState=ygoModule.initialState({seatCount:2});countState.seats[0].handCount=4;
    countState=ygoModule.reduce(countState,remoteActionSchema.parse({type:'twin.place',actorSeat:0,seat:0,zone:'monster',card:{ref:'non-hand',cardId:42},idempotencyKey:'non-hand',at:++serial}),
      {facts:{42:{code:42,copyKey:42,name:'Non-hand card',limit:3,section:type===0x4000?'main':'extra',type}}});
    expect(countState.seats[0].handCount).toBe(4);
  }
  for(const firstTurnDraw of [true,false]) {
    state=ygoModule.initialState({seatCount:3});
    state.deckChecks.format=shared.normalizeRemoteFormat('domain',{firstTurnDraw,startingHand:5},3);
    reduce({type:'turn.end'});
    expect(state.seats.map(s=>s.handCount)).toEqual([firstTurnDraw?6:5,6,5]);
  }
  state=ygoModule.initialState({seatCount:2});
  reduce({type:'hand.count',value:3});
  reduce({type:'twin.place',seat:0,zone:'graveyard',card:{ref:'confirm-inspection',cardId:99}});
  reduce({type:'pile.lift',seat:0,zone:'graveyard',cardRefs:['confirm-inspection']});
  reduce({type:'hand.add',source:'gy',cardId:99});expect(state.seats[0].handCount).toBe(4);
  expect(state.seats[0].twin).toHaveLength(1);
  expect(state.seats[0].twin[0].inspectionFrom).toBeUndefined();

  // A camera read without context is a local suggestion, never a valid write.
  state=ygoModule.initialState({seatCount:2});
  const localRead={cardId:69299029,id:'local-read',at:1000};
  expect(shared.remoteHandReadDecision(state,0,localRead)).toEqual({type:'hand.suggest',actorSeat:0,...localRead});
  expect(remoteActionSchema.safeParse({...shared.remoteHandReadDecision(state,0,localRead),idempotencyKey:'no-write'}).success).toBe(false);
  state.effectTracking={contexts:{},notes:[],origins:[{id:'pending-search',seat:0,ref:'search-ref',destination:'hand',source:by,at:900,announceRecommended:true,derivedFrom:'text',pool:[{cardId:69299029,copyKey:69299029,name:'Treasures of the Kings',copies:1}]}]};
  expect(shared.remoteHandReadDecision(state,0,localRead)).toMatchObject({type:'hand.add',source:'deck',by});
  expect(shared.remoteHandReadDecision(state,0,localRead,true)?.type).toBe('hand.suggest');
  state.seats[0].twin.push({ref:'played-candidate',zone:'spell-trap',cardId:69299029,faceUp:true,position:'attack'});
  expect(shared.remoteHandReadDecision(state,0,localRead)).toBeUndefined();
  state.seats[0].twin=[];state.effectTracking.origins[0].handCounted=true;
  expect(shared.remoteHandReadDecision(state,0,localRead)?.type).toBe('hand.suggest');
  state.effectTracking.origins[0].handCounted=false;
  expect(shared.remoteHandReadDecision(state,0,{...localRead,at:61000})?.type).toBe('hand.suggest');

  // Search plans retain the physical source through suggestions, voice, camera, and the pile exit.
  const {CardTags,fillDefaults}=await import('../../src/cards/effects/tags.js');
  const recoveryCard={id:900002,name:'Recovery',kind:'spell' as const,typeLine:'',subtypes:[],
    text:'Add 1 Spell from your GY to your hand.',formats:[],views:0,url:''};
  const recoveredCard={...recoveryCard,id:69299029,name:'Treasures of the Kings',text:''};
  for(const [source,zone,indexedZone] of [['gy','graveyard','gy'],['banish','banished','banished']] as const) {
    const card={...recoveryCard,text:`Add 1 Spell from your ${source==='gy'?'GY':'banishment'} to your hand.`};
    const tags=CardTags.parse(fillDefaults({summary:'Recover a Spell',effects:[{timing:'ignition',actions:[{verb:'add_to_hand',player:'you',from:[indexedZone],what:{kinds:['spell']}}]}]}));
    const plan=shared.deriveRemoteEffectPlans(card,tags).find(p=>p.destination==='hand');
    expect(plan).toMatchObject({source,derivedFrom:'effect-index'});
    expect(shared.deriveRemoteEffectPlans(card).find(p=>p.destination==='hand')).toMatchObject({source});
    state=ygoModule.initialState({seatCount:2});
    state.seats[0].handCount=5;state.seats[0].deckCount=35;
    state.seats[0].twin=[{ref:'recovery-copy',zone,cardId:69299029,faceUp:true,position:'attack'}];
    const pool=[{cardId:69299029,copyKey:69299029,name:'Treasures of the Kings',copies:1}];
    state=ygoModule.reduce(state,remoteActionSchema.parse({type:'effect.activated',actorSeat:0,source:{cardId:card.id},idempotencyKey:`recover-${source}`,at:++serial}),
      {effect:{source:{cardId:card.id,name:card.name},plans:[{...plan!,pool}]}});
    const candidates=shared.searchCandidates(state,0,card.id);
    expect(candidates).toEqual([expect.objectContaining({cardId:69299029,source})]);
    expect(shared.searchCandidates(state,0,card.id,{cards:[card,recoveredCard],tags:{[card.id]:tags}})).toMatchObject(candidates.map(({cardId,name,source,by})=>({cardId,name,source,by})));
    expect(ygoModule.parseCommand({text:'search Treasures',actorSeat:0,state})).toMatchObject({type:'hand.add',source});
    const decision=shared.remoteHandReadDecision(state,0,localRead);
    expect(decision).toMatchObject({type:'hand.add',source,by:{cardId:card.id}});
    const pending=structuredClone(state);
    reduce(decision!);
    expect(state.seats[0]).toMatchObject({handCount:6,deckCount:35,knownHand:[{cardId:69299029,source}]});
    expect(state.seats[0].twin).toEqual([expect.objectContaining({ref:'recovery-copy',zone:'hand'})]);
    expect(state.effectTracking!.origins[0].handCounted).toBe(true);
    expect(shared.searchCandidates(state,0,card.id)).toEqual([]);
    expect(()=>reduce(decision!)).toThrow(/already counted/);
    reduce({type:'undo',targetActionId:state.undo!.actionId});
    expect(state.seats[0]).toEqual(pending.seats[0]);
    expect(shared.searchCandidates(state,0,card.id)).toEqual(candidates);
    const originId=state.effectTracking!.origins[0].id;
    reduce({type:'effect.choose',originId,cardId:69299029});
    expect(state.seats[0]).toMatchObject({handCount:6,deckCount:35});
    expect(state.seats[0].twin).toEqual([expect.objectContaining({ref:'recovery-copy',zone:'hand'})]);
    expect(state.seats[0].knownHand?.[0].source).toBe(source);
    reduce({type:'undo',targetActionId:state.undo!.actionId});
    expect(state.seats[0]).toEqual(pending.seats[0]);
    // An inspected pile card keeps its source until the owner confirms the add.
    reduce({type:'pile.lift',seat:0,zone,cardRefs:['recovery-copy']});
    expect(shared.searchCandidates(state,0,card.id)).toEqual(candidates);
    reduce(decision!);
    expect(state.seats[0]).toMatchObject({handCount:6,deckCount:35});
    expect(state.seats[0].twin).toHaveLength(1);
    expect(state.seats[0].twin[0].inspectionFrom).toBeUndefined();
    expect(state.effectTracking!.origins[0].handCounted).toBe(true);
  }
  const targetRecovery={...recoveryCard,text:'Target 1 Spell in your GY; add that target to your hand.'};
  expect(shared.deriveRemoteEffectPlans(targetRecovery)[0]).toMatchObject({source:'gy',filters:[{kinds:['spell']}]});
  expect(shared.deriveRemoteEffectPlans({...targetRecovery,text:'Target 1 of your banished monsters; add it to your hand.'})[0]).toMatchObject({source:'banish',filters:[{kinds:['monster']}]});
  const multiTags=CardTags.parse(fillDefaults({summary:'Recover from either pile',effects:[{timing:'ignition',actions:[
    {verb:'add_to_hand',player:'you',from:['gy','banished'],what:{kinds:['spell']}},
  ]}]}));
  state=ygoModule.initialState({seatCount:2});
  state.seats[0].twin=[{ref:'gy-choice',zone:'graveyard',cardId:69299029,faceUp:true,position:'attack'},
    {ref:'banish-choice',zone:'banished',cardId:69299029,faceUp:true,position:'attack'}];
  const multiPlans=shared.deriveRemoteEffectPlans({...recoveryCard,text:''},multiTags).map(plan=>({...plan,pool:[{cardId:69299029,copyKey:69299029,name:'Treasures of the Kings',copies:1}]}));
  multiPlans.unshift({...multiPlans[0],source:'deck'});
  state=ygoModule.reduce(state,remoteActionSchema.parse({type:'effect.activated',actorSeat:0,source:{cardId:recoveryCard.id},idempotencyKey:'ambiguous-recovery',at:++serial}),
    {showCardsSetFromDeck:true,effect:{source:{cardId:recoveryCard.id,name:recoveryCard.name},plans:multiPlans}});
  const multiCandidates=shared.searchCandidates(state,0,recoveryCard.id);
  expect(multiCandidates.map(c=>c.source)).toEqual(['banish','deck','gy']);
  expect(shared.parseRemoteHandCommand({text:'search Treasures',actorSeat:0,candidates:multiCandidates})).toBeNull();
  expect(shared.remoteHandReadDecision(state,0,localRead)?.type).toBe('hand.suggest');
  for(const source of ['deck','gy'] as const) {
    const originId=state.effectTracking!.origins.find(o=>o.searchSource===source)!.id;
    state=ygoModule.reduce(state,remoteActionSchema.parse({type:'effect.choose',actorSeat:0,originId,cardId:69299029,idempotencyKey:`multi-choice-${source}`,at:++serial}),{showCardsSetFromDeck:true});
  }
  expect(state.seats[0].twin.filter(c=>c.zone==='graveyard')).toEqual([]);
  expect(state.seats[0].twin.filter(c=>c.zone==='hand')).toHaveLength(2);
  expect(state.seats[0].knownHand?.map(c=>c.source)).toEqual(['deck','gy']);

  // Held reads require 200 ms of stillness, emit only a sure front, and never enter field tracks.
  const visionPath=new URL('../../../vision/src/field-watcher.ts',import.meta.url).pathname;
  const vision=await import(visionPath);
  const heldCard={kind:'face-up',confidence:.99,partial:false,quad:[{x:.05,y:.03},{x:.12,y:.03},{x:.12,y:.16},{x:.05,y:.16}]};
  const frame={width:640,height:480,data:new Uint8ClampedArray(0)};
  const sure={tier:'sure',candidates:[{cardId:'29762407',score:.99}],quality:{fallback:false,faceDown:false,partial:false},timingsMs:{}};
  const evidence={motion:()=>0,sharpness:()=>100,touched:()=>.03,appearance:()=>[.1,.2,.3],halo:()=>[]};
  const heldEvents:Record<string,unknown>[]=[];
  let readTier='not sure',reads=0;
  const heldReader=vision.createHeldCardReader({profile:{cardBack:{cardId:'back'}},clone:async()=>frame,
    recognizer:{recognize:async()=>{reads++;return {...sure,tier:readTier};}},onHeldCard:(event:Record<string,unknown>)=>heldEvents.push(event)});
  let scan=heldReader.observe([heldCard],frame,evidence,10,undefined,undefined,false);
  expect(scan.cards).toHaveLength(1);expect(scan.read).toBeUndefined();
  scan=heldReader.observe([heldCard],frame,evidence,210,undefined,undefined,false);expect(scan.read).toBeDefined();await scan.read;
  expect(heldEvents).toEqual([]);
  // One sure read is not enough for a public reveal: two in a row must agree.
  readTier='sure';scan=heldReader.observe([heldCard],frame,evidence,460,undefined,undefined,false);await scan.read;
  expect(heldEvents).toEqual([]);
  scan=heldReader.observe([heldCard],frame,evidence,710,undefined,undefined,false);await scan.read;
  expect(heldEvents).toEqual([expect.objectContaining({type:'held',state:'held',cardId:'29762407',lifted:false})]);
  scan=heldReader.observe([heldCard],frame,evidence,760,undefined,undefined,false);expect(scan.read).toBeUndefined();expect(reads).toBe(3);
  heldReader.reset();
  const fan={...heldCard,quad:heldCard.quad.map(p=>({x:p.x+.02,y:p.y+.02}))};
  scan=heldReader.observe([heldCard,fan],frame,evidence,520,undefined,undefined,false);expect(scan.read).toBeUndefined();
  heldReader.reset();
  scan=heldReader.observe([heldCard],frame,{...evidence,touched:()=>0},530,undefined,undefined,false);expect(scan.cards).toEqual([]);
  scan=heldReader.observe([heldCard],frame,{...evidence,touched:()=>0,halo:()=>[.7,.4,.3]},540,undefined,undefined,false);expect(scan.cards).toEqual([]);
  // A new face at the same spot gets a read. A slow sure read keeps its episode alive.
  let heldNow=100,heldIdentity='29762407';
  const episodeEvents:Record<string,unknown>[]=[];
  const episodes=vision.createHeldCardReader({profile:{cardBack:{cardId:'back'}},now:()=>heldNow,clone:async()=>frame,
    recognizer:{recognize:async()=>({...sure,candidates:[{cardId:heldIdentity,score:.99}]})},onHeldCard:(event:Record<string,unknown>)=>episodeEvents.push(event)});
  scan=episodes.observe([heldCard],frame,evidence,heldNow,undefined,undefined,false);expect(scan.read).toBeUndefined();
  for(heldNow=300;heldNow<=550;heldNow+=250){scan=episodes.observe([heldCard],frame,evidence,heldNow,undefined,undefined,false);await scan.read;}
  heldNow=700;heldIdentity='69299029';
  const newFace={...evidence,appearance:()=>[.8,.1,.9]};
  scan=episodes.observe([heldCard],frame,newFace,heldNow,undefined,undefined,false);expect(scan.read).toBeUndefined();
  for(heldNow=900;heldNow<=1150;heldNow+=250){scan=episodes.observe([heldCard],frame,newFace,heldNow,undefined,undefined,false);expect(scan.read).toBeDefined();await scan.read;}
  expect(episodeEvents.map(e=>e.cardId)).toEqual(['29762407','69299029']);
  let completeRead!:(value:unknown)=>void;
  const slowResult=new Promise(resolve=>{completeRead=resolve;});heldNow=700;
  const slow=vision.createHeldCardReader({profile:{cardBack:{cardId:'back'}},now:()=>heldNow,clone:async()=>frame,
    recognizer:{recognize:()=>slowResult},onHeldCard:(event:Record<string,unknown>)=>episodeEvents.push(event)});
  slow.observe([heldCard],frame,evidence,heldNow,undefined,undefined,false);heldNow=900;
  scan=slow.observe([heldCard],frame,evidence,heldNow,undefined,undefined,false);await Promise.resolve();
  slow.observe([],frame,evidence,1000,undefined,undefined,true);
  heldNow=2300;completeRead(sure);await scan.read;expect(episodeEvents).toHaveLength(2);
  slow.observe([heldCard],frame,evidence,2301,undefined,undefined,false);
  scan=slow.observe([heldCard],frame,evidence,2560,undefined,undefined,false);await scan.read;expect(episodeEvents).toHaveLength(3);
  scan=slow.observe([heldCard],frame,evidence,2900,undefined,undefined,false);expect(scan.read).toBeUndefined();expect(slow.snapshot()).toHaveLength(1);slow.reset();
  // Field provenance wins over size and fingers, including a recent invisible field track.
  let blockedReads=0;
  const blocked=vision.createHeldCardReader({profile:{cardBack:{cardId:'back'}},clone:async()=>frame,
    recognizer:{recognize:async()=>{blockedReads++;return sure;}}});
  const fieldCard={...heldCard,quad:heldCard.quad.map(p=>({x:p.x+.15,y:p.y+.36}))};
  blocked.observe([fieldCard],frame,evidence,0,undefined,undefined,false);
  const lifted={...fieldCard,quad:fieldCard.quad.map(p=>({x:p.x,y:p.y-.17}))};
  for(const at of [200,450,700,1000])await blocked.observe([lifted],frame,evidence,at,undefined,undefined,false).read;
  expect(blockedReads).toBe(0);
  for(const at of [3500,3700,3950])await blocked.observe([heldCard],frame,evidence,at,undefined,undefined,false).read;
  expect(blockedReads).toBe(0);
  blocked.reset();
  const recentTrack={id:'field-before-lift',zone:'M1',card:heldCard,lastSeen:100,firstSeen:0,visible:false,removed:false,state:'identified',faceDown:false,position:'attack'};
  for(const at of [200,450,700])await blocked.observe([heldCard],frame,evidence,at,undefined,undefined,false,[recentTrack]).read;
  expect(blockedReads).toBe(0);
  blocked.reset();
  blocked.observe([{...fieldCard,kind:'face-down'}],frame,evidence,0,undefined,undefined,false);
  const flippedAway={...heldCard,quad:heldCard.quad.map(p=>({x:p.x+.4,y:p.y+.88}))};
  for(const at of [3000,3200,3450])await blocked.observe([flippedAway],frame,{...evidence,appearance:()=>[.8,.1,.9]},at,undefined,undefined,false).read;
  expect(blockedReads).toBe(0); // An unseen Set can change face before it reappears far away.
  let tries=0;
  const retries=vision.createHeldCardReader({profile:{cardBack:{cardId:'back'}},clone:async()=>frame,
    recognizer:{recognize:async()=>{tries++;return {...sure,tier:'not sure'};}}});
  for(const at of [0,200,450,700,950,1200,1450])await retries.observe([heldCard],frame,evidence,at,undefined,undefined,false).read;
  expect(tries).toBe(3); // Initial read plus two retries.
  const watcher=vision.createFieldWatcher({profile:{cardBack:{cardId:'back'}},now:()=>10,hidden:()=>false,
    buffer:{sample:async()=>({frame,at:10})},clone:async()=>frame,analyze:()=>evidence,
    recognizer:{detectCards:async()=>[heldCard],recognize:async()=>sure},onHeldCard:(event:Record<string,unknown>)=>heldEvents.push(event)});
  await watcher.tick();await Promise.resolve();await Promise.resolve();
  expect(watcher.getSnapshot().tracks).toEqual([]);expect(watcher.getSnapshot().held).toHaveLength(1);watcher.dispose();

  // A held read does not wait for the empty-field idle interval; pending field work gets the next read.
  let fairAt=0,fairField=false;
  const fairReads:string[]=[];
  const cropWidth=96,cropHeight=140,cropData=new Uint8ClampedArray(cropWidth*cropHeight*4);
  for(let py=0;py<cropHeight;py++)for(let px=0;px<cropWidth;px++){
    const x=px/cropWidth,y=py/cropHeight;
    const rgb=x<.06||x>.94||y<.04||y>.96?[25,25,25]:x>.12&&x<.88&&y>.18&&y<.70?[60+140*x,40+130*y,70+80*Math.sin(35*x)*Math.cos(30*y)]:x>.10&&x<.90&&y>.76&&y<.92?(y%.035<.012?[65,55,45]:[220,210,180]):[35,145,120];
    cropData.set([...rgb,255],(py*cropWidth+px)*4);
  }
  const fair=vision.createFieldWatcher({profile:{cardBack:{cardId:'back'},embedding:{dim:2}},now:()=>fairAt,hidden:()=>false,
    buffer:{sample:async()=>({frame,at:fairAt})},clone:async()=>frame,
    analyze:()=>({...evidence,touched:(c:typeof heldCard)=>c.quad[0].x<.15?.03:0,appearance:(c:typeof heldCard)=>c.quad[0].x<.15?[.1,.2,.3]:[.7,.8,.2],crop:()=>({width:cropWidth,height:cropHeight,data:cropData})}),
    recognizer:{detectCards:async()=>fairField?[heldCard,fieldCard]:[heldCard],recognize:async(_frames:unknown,options:{card:typeof heldCard})=>{
      const held=options.card.quad[0].x<.15;fairReads.push(held?'held':'field');return {...sure,tier:held?'not sure':'sure'};
    }}});
  await fair.tick();fairAt=200;fairField=true;await fair.tick();
  for(let i=0;i<5;i++)await Promise.resolve();
  expect(fairReads).toEqual(['held']);
  fairAt=450;await fair.tick();for(let i=0;i<5;i++)await Promise.resolve();
  expect(fairReads.slice(0,2)).toEqual(['held','field']);
  expect(fair.getSnapshot().error).toBeUndefined();fair.dispose();

  // Service persistence and prediction share the existing engine fixture.
  const session=deckSession('normal');
  session.service.configure(session.room.slug,'g',session.users[0],{revealedHand:'one-turn'},2000);
  session.select(session.save([69299029,29762407,...Array.from({length:38},(_,i)=>i+1)]).id);
  expect(session.service.get(session.room.slug,'g',session.users[0]).revealedHand).toBe('one-turn');
  expect(session.service.list('g',session.users[0]).find(t=>t.slug===session.room.slug)?.revealedHand).toBe('one-turn');
  session.start();
  const seq=session.room.lastSeq;
  const candidates=session.service.searchCandidates(session.room.slug,'g',session.users[0],0,900001);
  expect(candidates.map(c=>c.cardId).sort()).toEqual([29762407,69299029]);
  expect(session.service.get(session.room.slug,'g',session.users[0]).lastSeq).toBe(seq);
  expect(Array.isArray(session.service.searchCandidates(session.room.slug,'g',session.users[0],1,900001))).toBe(true);
  const other=setup();other.service.join(other.table.slug,'g',other.users[1],'B',1,1001);
  expect(()=>other.service.searchCandidates(other.table.slug,'g',other.users[1],0,900001)).toThrow(/owner/i);
  expect(shared.parseRemoteHandCommand({text:'search Treasures',actorSeat:0,candidates})).toMatchObject({type:'hand.add',cardId:69299029,source:'deck',by});
  expect(shared.parseRemoteHandCommand({text:'add Temple of the Kings to hand',actorSeat:0,candidates})).toMatchObject({type:'hand.add',cardId:29762407});
  expect(shared.parseRemoteHandCommand({text:'search Kings',actorSeat:0,candidates})).toBeNull();
  session.act({type:'effect.activated',source:{cardId:900001}});
  expect(shared.searchCandidates(session.room.state,0,900001).map(c=>c.cardId).sort()).toEqual([29762407,69299029]);
  session.act({type:'hand.add',cardId:69299029,source:'deck',by});
  expect(session.room.state.effectTracking?.origins.find(o=>o.source.cardId===900001)?.announcedCard).toMatchObject({cardId:69299029});
  expect(session.room.state.seats[0]).toMatchObject({handCount:6,deckCount:34});
  expect(session.room.events.at(-1)?.messages).toContain("Sulman added Treasures of the Kings to hand (Man with the Mark's effect)");
  expect(session.service.replay(session.room.slug,'g',session.users[0])).toEqual(session.room.state);
  session.act({type:'turn.end'});expect(session.room.state.seats[0].knownHand).toEqual([]);
  expect(session.service.replay(session.room.slug,'g',session.users[0])).toEqual(session.room.state);
  session.act({type:'twin.place',seat:0,zone:'field',card:{ref:'return-to-deck',cardId:69299029}});
  const deckReturnRef=session.room.state.seats[0].twin.find(c=>c.zone==='field')!.ref;
  session.act({type:'twin.move',seat:0,cardRef:deckReturnRef,zone:'deck'});
  expect(session.room.state.seats[0].deckCount).toBe(35);
  expect(session.service.replay(session.room.slug,'g',session.users[0])).toEqual(session.room.state);
  for(const [source,zone,sourceCardId] of [['gy','graveyard',900002],['banish','banished',900003]] as const) {
    const recovery=deckSession('normal');recovery.select(recovery.save().id);recovery.start();
    // The recovered card is outside the registered Deck. Only the current pile determines availability.
    recovery.act({type:'twin.place',seat:0,zone,card:{ref:'service-recovery',cardId:69299029}});
    const recoverySearch=()=>recovery.service.searchCandidates(recovery.room.slug,'g',recovery.users[0],0,sourceCardId);
    const recoverySeq=recovery.room.lastSeq;
    expect(recoverySearch()).toEqual([expect.objectContaining({cardId:69299029,source})]);
    expect(recovery.service.get(recovery.room.slug,'g',recovery.users[0]).lastSeq).toBe(recoverySeq);
    recovery.act({type:'effect.activated',source:{cardId:sourceCardId}});
    expect(shared.searchCandidates(recovery.room.state,0,sourceCardId)).toEqual([expect.objectContaining({cardId:69299029,source})]);
    const beforeRecovery=structuredClone(recovery.room.state);
    const proposal=shared.parseRemoteHandCommand({text:'search Treasures',actorSeat:0,candidates:recoverySearch()});
    expect(proposal).toMatchObject({type:'hand.add',source});
    recovery.act(proposal!);
    expect(recovery.room.state.seats[0]).toMatchObject({handCount:6,deckCount:35,knownHand:[{cardId:69299029,source}]});
    expect(recovery.room.state.seats[0].twin).toEqual([expect.objectContaining({ref:'service-recovery',zone:'hand'})]);
    expect(recoverySearch()).toEqual([]);
    expect(recovery.service.replay(recovery.room.slug,'g',recovery.users[0])).toEqual(recovery.room.state);
    recovery.act({type:'undo',targetActionId:recovery.room.state.undo!.actionId});
    expect(recovery.room.state.seats[0]).toEqual(beforeRecovery.seats[0]);
    expect(recoverySearch()).toEqual([expect.objectContaining({cardId:69299029,source})]);
    expect(recovery.service.replay(recovery.room.slug,'g',recovery.users[0])).toEqual(recovery.room.state);
  }
  // Session ownership, public snapshots, retries and replay use the same strict actions.
  const countsSession=deckSession('normal',false);
  countsSession.select(countsSession.save().id);
  countsSession.service.join(countsSession.room.slug,'g',countsSession.users[1],'Bob',1,2002);
  const countDeck=countsSession.save(undefined,[],countsSession.users[1]);
  countsSession.service.selectDeck(countsSession.room.slug,'g',countsSession.users[1],{savedDeckId:countDeck.id},2003);
  countsSession.service.ready(countsSession.room.slug,'g',countsSession.users[1],true,2004);
  countsSession.start();countsSession.act({type:'hand.add',cardId:69299029,source:'deck'});
  const countRoom=countsSession.room, countService=countsSession.service, countUsers=countsSession.users;
  const countInput={baseSeq:countRoom.lastSeq,action:{type:'hand.count',actorSeat:0,delta:1,idempotencyKey:'public-count'} satisfies RemoteAction};
  expect(()=>countService.act(countRoom.slug,'g',countUsers[1],countInput,2200)).toThrow(/actor seat/i);
  expect(()=>countService.act(countRoom.slug,'g',countUsers[0],{...countInput,action:{...countInput.action,actorSeat:1}},2200)).toThrow(/actor seat/i);
  expect(countService.get(countRoom.slug,'g',countUsers[0]).lastSeq).toBe(countInput.baseSeq);
  const publicCount=countService.act(countRoom.slug,'g',countUsers[0],countInput,2201);
  expect(publicCount.state.seats[0]).toEqual({...countRoom.state.seats[0],handCount:7});
  const retriedCount=countService.act(countRoom.slug,'g',countUsers[0],countInput,2202);
  expect(retriedCount.lastSeq).toBe(publicCount.lastSeq);expect(retriedCount.state.seats[0].handCount).toBe(7);
  const otherCount=countService.act(countRoom.slug,'g',countUsers[1],{baseSeq:publicCount.lastSeq,action:{type:'hand.count',actorSeat:1,value:3,idempotencyKey:'other-count'}},2203);
  expect(otherCount.state.seats.map(s=>s.handCount)).toEqual([7,3]);
  expect(otherCount.state.seats[0].deckCount).toBeUndefined();
  expect(otherCount.state.undo).not.toHaveProperty('before');
  const countBroadcast=countService.snapshot(countRoom.slug,'g');
  expect(countBroadcast.state.seats.map(s=>s.handCount)).toEqual([7,3]);
  expect(countBroadcast.state.seats.every(s=>s.deckCount===undefined)).toBe(true);
  expect(countBroadcast.events.find(e=>e.id==='public-count')?.action).toMatchObject(countInput.action);
  for (const viewer of countUsers.slice(0,2))
    expect(countService.replay(countRoom.slug,'g',viewer)).toEqual(countService.get(countRoom.slug,'g',viewer).state);
  const countUndo=countService.act(countRoom.slug,'g',countUsers[0],{baseSeq:otherCount.lastSeq,action:{type:'undo',actorSeat:0,targetActionId:'public-count',idempotencyKey:'undo-count'}},2204);
  expect(countUndo.state.seats.map(s=>s.handCount)).toEqual([6,3]);
  expect(countUndo.state.seats[0]).toEqual(countRoom.state.seats[0]);
  for (const viewer of countUsers.slice(0,2))
    expect(countService.replay(countRoom.slug,'g',viewer)).toEqual(countService.get(countRoom.slug,'g',viewer).state);

  // Existing picker path: an unnamed hand twin, then public camera identity.
  const picker=deckSession('normal');picker.select(picker.save([69299029,29762407,...Array.from({length:38},(_,i)=>i+1)]).id);picker.start();
  picker.act({type:'effect.activated',source:{cardId:900001}});
  const handOrigin=picker.room.state.effectTracking!.origins.find(o=>o.destination==='hand')!;
  picker.act({type:'twin.place',seat:0,zone:'hand',card:{ref:handOrigin.ref,faceUp:false}});
  picker.act({type:'card.identified',seat:0,cardRef:handOrigin.ref,cardId:29762407,zone:'hand',source:'auto'});
  expect(picker.room.state.seats[0]).toMatchObject({handCount:6,deckCount:34,knownHand:[expect.objectContaining({cardId:29762407,source:'deck'})]});
  picker.act({type:'hand.forget',id:picker.room.state.seats[0].knownHand![0].id});
  picker.act({type:'card.identified',seat:0,cardRef:handOrigin.ref,cardId:29762407,zone:'hand',source:'auto'});
  expect(picker.room.state.seats[0].knownHand).toEqual([]);
  expect(picker.service.replay(picker.room.slug,'g',picker.users[0])).toEqual(picker.room.state);
  // Both write paths enforce Deck publicity, and repeats cannot count a search twice.
  for(const show of [true,false]) {
    const addSearch=originSession(show);addSearch.act({type:'effect.activated',source:{cardId:73628505}});
    addSearch.act({type:'hand.add',cardId:47355498,source:'deck',by:{cardId:73628505,name:'UNTRUSTED_SOURCE_NAME'}});
    const publicAdd=addSearch.service.snapshot(addSearch.room.slug,'g');
    expect(addSearch.room.state.seats[0].knownHand?.[0].by?.name).toBe('Terraforming');
    expect(publicAdd.state.seats[0].handCount).toBe(6);
    expect(publicAdd.state.seats[0].knownHand?.length).toBe(show?1:0);
    expect(addSearch.service.spectatorSnapshot(addSearch.room.slug,'g').state.seats[0].knownHand?.length).toBe(show?1:0);
    expect(publicAdd.state.effectTracking?.origins[0].announcedCard?.cardId).toBe(show?47355498:undefined);
    if(!show) {
      expect(JSON.stringify(publicAdd)).not.toContain('Necrovalley');
      expect(JSON.stringify(publicAdd)).not.toContain('47355498');
      expect(publicAdd.events.at(-1)?.messages?.join(' ')).toContain('added a card to hand');
    }
    expect(JSON.stringify(publicAdd)).not.toContain('UNTRUSTED_SOURCE_NAME');
    if(!show){
      const privateSeq=addSearch.room.lastSeq;
      addSearch.act({type:'hand.reveal',cardId:47355498});
      expect(addSearch.room.lastSeq).toBe(privateSeq+1);
      expect(addSearch.service.snapshot(addSearch.room.slug,'g').state.seats[0].knownHand?.map(c=>c.cardId)).toEqual([47355498]);
      const revealedSeq=addSearch.room.lastSeq;addSearch.act({type:'hand.reveal',cardId:47355498});expect(addSearch.room.lastSeq).toBe(revealedSeq);
    }
    const countBefore=structuredClone(addSearch.room.state.seats[0]);
    expect(()=>addSearch.act({type:'hand.add',cardId:47355498,source:'deck',by:{cardId:73628505,name:'Terraforming'}})).toThrow(/already counted/);
    expect(addSearch.room.state.seats[0]).toEqual(countBefore);
    expect(addSearch.service.replay(addSearch.room.slug,'g',addSearch.users[0])).toEqual(addSearch.room.state);
    if(show) {
      const noopBefore=addSearch.room;
      addSearch.act({type:'hand.reveal',cardId:47355498});
      expect(addSearch.room.lastSeq).toBe(noopBefore.lastSeq);
      expect(addSearch.room.state.undo?.actionId).toBe(noopBefore.state.undo?.actionId);
    }
  }
  const countedPick=originSession(true);countedPick.act({type:'effect.activated',source:{cardId:73628505}});
  countedPick.act({type:'effect.choose',originId:originOf(countedPick).id,cardId:47355498});
  expect(()=>countedPick.act({type:'hand.add',cardId:47355498,source:'deck',by:{cardId:73628505,name:'Terraforming'}})).toThrow(/already counted/);
  // Playing another eligible card does not consume the searched copy or change its origin.
  const searchedCopy=originOf(countedPick).ref;
  countedPick.act({type:'twin.place',seat:0,zone:'field',card:{ref:'other-search-candidate',cardId:67616300}});
  expect(countedPick.room.state.seats[0].twin.find(c=>c.ref===searchedCopy)?.zone).toBe('hand');
  expect(countedPick.room.state.seats[0].knownHand?.map(c=>c.cardId)).toEqual([47355498]);
  for(const actionType of ['twin.move','hand.add']) {
    const setReturn=originSession();
    setReturn.act({type:'twin.place',seat:0,zone:'spell-trap',card:{ref:'private-return',cardId:555,faceUp:false,name:'PRIVATE_SET_SENTINEL'}});
    setReturn.act(actionType==='twin.move'?{type:'twin.move',seat:0,cardRef:'private-return',zone:'hand',name:'PRIVATE_SET_SENTINEL'}:{type:'hand.add',cardId:555,source:'field'});
    const publicReturn=setReturn.service.snapshot(setReturn.room.slug,'g');
    expect(publicReturn.state.seats[0].knownHand).toEqual([]);
    expect(JSON.stringify(publicReturn)).not.toContain('PRIVATE_SET_SENTINEL');
    expect(publicReturn.events.at(-1)?.messages?.join(' ')).toContain('a Set card returned to hand');
    expect(setReturn.service.replay(setReturn.room.slug,'g',setReturn.users[0])).toEqual(setReturn.room.state);
  }

  // A private choice becomes one public entry on explicit reveal; announcement cannot duplicate it.
  const privatePick=originSession();privatePick.act({type:'effect.activated',source:{cardId:73628505}});
  const privateOrigin=originOf(privatePick);privatePick.act({type:'effect.choose',originId:privateOrigin.id,cardId:47355498});
  expect(privatePick.room.state.seats[0].knownHand).toEqual([]);
  privatePick.act({type:'hand.reveal',cardId:47355498});privatePick.act({type:'effect.announce',originId:privateOrigin.id});
  expect(privatePick.room.state.seats[0].knownHand).toEqual([expect.objectContaining({cardId:47355498,source:'deck'})]);
  expect(privatePick.room.state.seats[0].handCount).toBe(6);

});

it('projects a state without copying its undo data, keeping key order and the original state',async()=>{
  const {projectRemoteState,projectRemoteSpectator}=await import('../../src/remote/privacy.js');
  let state=ygoModule.initialState({seatCount:2}),serial=0;
  const reduce=(proposal:Record<string,unknown>)=>state=ygoModule.reduce(state,remoteActionSchema.parse({...proposal,actorSeat:0,idempotencyKey:`lean-${++serial}`,at:serial}),{facts:{}});
  reduce({type:'twin.place',seat:0,zone:'monster',card:{ref:'a',slot:1,faceUp:false,position:'defense',cardId:46986414,name:'Dark Magician'}});
  reduce({type:'twin.place',seat:0,zone:'monster',card:{ref:'b',slot:2,faceUp:false,position:'defense',cardId:46986414,name:'Dark Magician'}});
  const frozen=JSON.stringify(state),view=projectRemoteState(state,new Set([1]));
  expect(JSON.stringify(state)).toBe(frozen);
  expect(Object.keys(view)).toEqual(Object.keys(state));
  expect(view.undo?.actionId).toBe(state.undo!.actionId);
  expect(view.undo).toEqual({actionId:state.undo!.actionId,at:state.undo!.at});
  expect(state.undo!.before.seats[0].twin.map(card=>card.cardId)).toEqual([46986414]);
  expect(view.undoHistory).toEqual([]);
  const spectator=projectRemoteSpectator({table:{seats:[]} as never,state,events:[]});
  expect(spectator.state.undo).toBeNull();expect(spectator.state.undoHistory).toEqual([]);expect(JSON.stringify(state)).toBe(frozen);
});

it('stores undo positions once with atomic legacy upgrade and reference lifetime', async () => {
  const session = deckSession('normal');
  session.select(session.save().id); session.start();
  session.act({type:'lp.change',seat:0,reason:'effect',delta:-100});
  const {db, users} = session;
  // An in-progress deployment still contains a complete legacy state row.
  const stateRow = () => (db.prepare('select id,state_json from remote_tables where slug=?').get(session.room.slug) as {id:number;state_json:string});
  expect(JSON.parse(stateRow().state_json).storageVersion).toBe(1);
  const {readRemoteState, writeRemoteState, remoteValueCacheStats} = await import('../../src/remote/storage.js');
  const legacy = readRemoteState(db, stateRow().state_json);
  expect(Object.isFrozen(legacy.undoHistory![0].before!.seats)).toBe(true);
  expect(() => legacy.undoHistory![0].before!.seats[0].resources.lp = 1).toThrow();
  db.prepare('update remote_tables set state_json=? where id=?').run(JSON.stringify(legacy), stateRow().id);
  const call = () => createRemoteDuelService(db, {dataDirectory:deckData});
  const act = (id: string) => call().act(session.room.slug,'g',users[0],{baseSeq:call().get(session.room.slug,'g',users[0]).lastSeq,
    action:remoteActionSchema.parse({type:'lp.change',seat:0,reason:'effect',actorSeat:0,delta:100,idempotencyKey:id})},3000);
  const count = () => (db.prepare('select count(*) n from remote_values').get() as {n:number}).n;
  // A rollback can leave a version-1 row with full positions. Roll-forward reads it.
  db.prepare('update remote_tables set state_json=? where id=?').run(JSON.stringify({...legacy,storageVersion:1}),stateRow().id);
  expect(call().get(session.room.slug,'g',users[0]).state).toEqual(session.room.state);
  const fullVersioned=readRemoteState(db,stateRow().state_json);
  expect(Object.isFrozen(fullVersioned.undo!.before.seats)).toBe(true);
  expect(Object.isFrozen(fullVersioned.undoHistory![0].after!.seats)).toBe(true);
  const oldCount=count(), oldJson=stateRow().state_json;
  const eventsBefore=db.prepare('select count(*) n from remote_events').get();
  db.exec("create trigger fail_state before update of state_json on remote_tables begin select raise(abort,'forced rollback'); end");
  expect(()=>act('rollback')).toThrow('forced rollback');
  expect(count()).toBe(oldCount); expect(stateRow().state_json).toBe(oldJson);
  expect(db.prepare('select count(*) n from remote_events').get()).toEqual(eventsBefore);
  db.exec('drop trigger fail_state'); act('upgrade');
  expect(JSON.parse(stateRow().state_json).storageVersion).toBe(1);
  for(let i=0;i<45;i++) act('trim-'+i);
  const state=readRemoteState(db,stateRow().state_json);
  expect(state.undoHistory).toHaveLength(20);
  expect(db.prepare(`select count(*) n from remote_values v where
    not exists(select 1 from remote_state_values r where r.value_hash=v.hash) and
    not exists(select 1 from remote_events e where e.facts_hash=v.hash)`).get()).toEqual({n:0});
  expect(()=>readRemoteState(db,JSON.stringify({...state,storageVersion:1,undoHistory:[],
    undo:{...state.undo,before:{valueHash:'0'.repeat(64)}}}))).toThrow('Missing Remote Duel value');
  const original=state.undo!.before.showCardsSetFromDeck;
  db.prepare('update remote_tables set show_cards_set_from_deck=0 where id=?').run(stateRow().id);
  expect(call().get(session.room.slug,'g',users[0]).state.undo).not.toHaveProperty('before');
  expect(state.undo!.before.showCardsSetFromDeck).toBe(original);

  const facts=db.prepare('select facts_hash from remote_events where table_id=? and facts_hash is not null').all(stateRow().id);
  expect(facts.length).toBeGreaterThan(0);
  const hits=remoteValueCacheStats().hits;
  call().get(session.room.slug,'g',users[0]); call().get(session.room.slug,'g',users[0]);
  expect(remoteValueCacheStats().hits).toBeGreaterThan(hits);
  expect(remoteValueCacheStats().bytes).toBeLessThanOrEqual(remoteValueCacheStats().maxBytes);
  // Replay facts shared by two rooms survive either owner's deletion.
  let second=call().create({guildId:'g',userId:users[0],displayName:'A',gameId:'ygo',seatCount:2,solo:true},4000);
  call().selectDeck(second.slug,'g',users[0],{savedDeckId:session.save().id},4001);
  call().ready(second.slug,'g',users[0],true,4002);
  second=call().start(second.slug,'g',users[0],4003);
  second=call().act(second.slug,'g',users[0],{baseSeq:second.lastSeq,action:remoteActionSchema.parse({
    type:'lp.change',seat:0,actorSeat:0,reason:'effect',delta:-100,idempotencyKey:'shared-facts'})},4004);
  const sharedHash=(db.prepare("select facts_hash from remote_events where idempotency_key='shared-facts'").get() as {facts_hash:string}).facts_hash;
  expect(facts).toContainEqual({facts_hash:sharedHash});
  // A second connection can trim history between loading its row and hydrating
  // values. The search must retain the same SQLite read snapshot throughout.
  const concurrentDir=mkdtempSync(join(tmpdir(),'remote-value-snapshot-'));
  const concurrentPath=join(concurrentDir,'test.sqlite');
  writeFileSync(concurrentPath,db.serialize());
  const reader=new Database(concurrentPath), writer=new Database(concurrentPath);
  try {
    for(const connection of [reader,writer]) { connection.pragma('foreign_keys=ON'); connection.pragma('journal_mode=WAL'); }
    const prepare=reader.prepare.bind(reader);
    let interleaved=false;
    vi.spyOn(reader,'prepare').mockImplementation(((sql:string)=>{
      const statement=prepare(sql);
      if(sql.startsWith('select *,json_extract')) {
        const get=statement.get.bind(statement);
        vi.spyOn(statement,'get').mockImplementation((...args:unknown[])=>{
          const row=get(...args);
          if(!interleaved) {
            interleaved=true;
            const trimmed=readRemoteState(writer,stateRow().state_json);
            trimmed.undo=null; delete trimmed.undoHistory;
            writer.transaction(()=>writer.prepare('update remote_tables set state_json=? where slug=?')
              .run(writeRemoteState(writer,stateRow().id,trimmed),session.room.slug)).immediate();
          }
          return row;
        });
      }
      return statement;
    }) as typeof reader.prepare);
    expect(()=>createRemoteDuelService(reader,{dataDirectory:deckData}).searchCandidates(session.room.slug,'g',users[0],0,1)).not.toThrow();
    expect(interleaved).toBe(true);
    expect(JSON.parse((prepare('select state_json from remote_tables where slug=?').get(session.room.slug) as {state_json:string}).state_json).undo).toBeNull();
    // A replay already reading the room keeps its facts even if retention
    // removes the room in another process before it reads the event log.
    writer.prepare("update remote_tables set status='ended',ended_at=2999 where slug=?").run(session.room.slug);
    const replayService=createRemoteDuelService(reader,{dataDirectory:deckData});
    const expectedReplay=replayService.replay(session.room.slug,'g',users[0]);
    let purged=false;
    vi.mocked(reader.prepare).mockImplementation(((sql:string)=>{
      if(sql==='select * from remote_events where table_id=? order by seq' && !purged) {
        purged=true;
        expect(createRemoteDuelService(writer,{dataDirectory:deckData}).purgeEnded(3000)).toBe(1);
      }
      return prepare(sql);
    }) as typeof reader.prepare);
    expect(replayService.replay(session.room.slug,'g',users[0])).toEqual(expectedReplay);
    expect(purged).toBe(true);
    expect(()=>replayService.get(session.room.slug,'g',users[0])).toThrow('Remote table not found');

  } finally { reader.close(); writer.close(); rmSync(concurrentDir,{recursive:true,force:true}); }
  // A game end keeps Undo and replay available. Explicit retention owns deletion.
  db.prepare("update remote_tables set status='ended',ended_at=3000 where id=?").run(stateRow().id);
  expect(call().get(session.room.slug,'g',users[0]).state.undoHistory!.length).toBe(state.undoHistory!.filter(e=>!e.undone&&e.actorSeat===0).length);
  expect(()=>db.prepare('delete from remote_events where table_id=?').run(stateRow().id)).toThrow(/append.only/);
  const endedId=stateRow().id;
  expect(call().purgeEnded(3001)).toBe(1);
  expect(db.prepare('select count(*) n from remote_state_values where table_id=?').get(endedId)).toEqual({n:0});
  expect(db.prepare('select hash from remote_values where hash=?').get(sharedHash)).toBeDefined();
  db.prepare('delete from remote_tables where slug=?').run(second.slug);
  expect(count()).toBe(0);
});


it('shares decoded values and counters across separate module graphs', async () => {
  const session=deckSession('normal');session.select(session.save().id);session.start();
  session.act({type:'lp.change',seat:0,reason:'effect',delta:-100});
  const json=(session.db.prepare('select state_json from remote_tables where slug=?').get(session.room.slug) as {state_json:string}).state_json;
  const first=await import('../../src/remote/storage.js');
  const before=first.readRemoteState(session.db,json).undo!.before;
  const stats=first.remoteValueCacheStats();
  vi.resetModules();
  const second=await import('../../src/remote/storage.js');
  expect(second.remoteValueCacheStats()).toEqual(stats);
  expect(second.readRemoteState(session.db,json).undo!.before).toBe(before);
  expect(first.remoteValueCacheStats().hits).toBeGreaterThan(stats.hits);
});

it('upgrades the event deletion guard atomically and leaves current SQL untouched', () => {
  const {db,service,table,users}=setup();
  db.exec("drop trigger remote_events_no_delete; create trigger remote_events_no_delete before delete on remote_events begin select raise(abort, 'remote_events is append-only'); end");
  const exec=db.exec.bind(db), replaced:boolean[]=[];
  const spy=vi.spyOn(db,'exec').mockImplementation((sql:string)=>{
    if(/drop trigger(?: if exists)? remote_events_no_delete/i.test(sql)) replaced.push(db.inTransaction);
    return exec(sql);
  });
  try {
    migrate(db);
    expect(replaced).toEqual([true]);
    const guard=db.prepare("select sql from sqlite_master where type='trigger' and name='remote_events_no_delete'").get();
    replaced.length=0;migrate(db);
    expect(replaced).toEqual([]);
    expect(db.prepare("select sql from sqlite_master where type='trigger' and name='remote_events_no_delete'").get()).toEqual(guard);
    expect(()=>db.prepare('delete from remote_events where table_id=(select id from remote_tables where slug=?)').run(table.slug)).toThrow(/append.only/);
    expect(service.get(table.slug,'g',users[0]).lastSeq).toBe(table.lastSeq);
  } finally {spy.mockRestore();}
});

it('uses the abandoned-lobby partial index after repeated migrations', () => {
  const {db,service}=setup();
  migrate(db); migrate(db);
  const plans:string[]=[];
  const prepare=db.prepare.bind(db);
  const spy=vi.spyOn(db,'prepare').mockImplementation((sql:string)=>{
    if(sql.startsWith('select id,slug from remote_tables ')) {
      plans.push(...(prepare(`EXPLAIN QUERY PLAN ${sql}`).all(86_400_000,100) as {detail:string}[]).map(row=>row.detail));
    }
    return prepare(sql);
  });
  try { service.purgeEnded(86_400_000,100,2*86_400_000,true); }
  finally { spy.mockRestore(); }
  expect(plans).toEqual(['SEARCH remote_tables USING INDEX remote_tables_unstarted_retention (ended_at<?)']);
});

it('prunes sessions with indexed room lookups only after the Undo and phone cleanup grace', () => {
  const {db,service,users}=setup();
  const now=86_400_000, grace=15*60_000;
  db.exec(`create table remote_phone_pairs(id text primary key,slug text,user_id integer,revoked integer,cleanup_pending integer);
    create table remote_phone_modes(slug text,user_id integer);
    create table remote_phone_attempts(bucket text primary key,slug text,started_at integer,count integer);`);
  const sessions=['remote_phone_pairs','remote_phone_modes','remote_phone_attempts','remote_spectators','remote_spectator_tabs','remote_admin_watch'];
  const rooms=[grace+1,grace,1].map(age=>{
    const room=service.create({guildId:'g',userId:users[0],displayName:'Owner',gameId:'ygo',seatCount:2},now-age);
    const {id}=db.prepare('select id from remote_tables where slug=?').get(room.slug) as {id:number};
    db.prepare("update remote_tables set status='ended',ended_at=? where id=?").run(now-age,id);
    db.prepare('insert into remote_phone_pairs values(?,?,?,1,1)').run(room.slug,room.slug,users[0]);
    db.prepare('insert into remote_phone_modes values(?,?)').run(room.slug,users[0]);
    db.prepare('insert into remote_phone_attempts values(?,?,?,1)').run(room.slug,room.slug,now);
    db.prepare('insert into remote_spectators values(?,?,?)').run(id,users[1],now);
    db.prepare('insert into remote_spectator_tabs values(?,?,?,?)').run(id,users[1],'tab',now);
    db.prepare('insert into remote_admin_watch values(?,?,null)').run(id,users[1]);
    return {...room,id};
  });
  const plans:{sql:string;details:string[]}[]=[];
  const prepare=db.prepare.bind(db);
  const spy=vi.spyOn(db,'prepare').mockImplementation((sql:string)=>{
    if(sql.startsWith('delete from') && sql.includes('remote_tables')) {
      plans.push({sql,details:(prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...(sql.includes('?')?[now-grace]:[])) as {detail:string}[]).map(row=>row.detail)});
    }
    return prepare(sql);
  });
  try { service.pruneSessions(now); }
  finally { spy.mockRestore(); }
  for(const name of sessions) {
    const key=name.startsWith('remote_phone')?'slug':'table_id';
    const remaining=db.prepare(`select ${key} as room from ${name}`).all();
    expect(remaining,name).toEqual(rooms.slice(1).map(room=>({room:key==='slug'?room.slug:room.id})));
  }
  expect(plans).toHaveLength(6);
  for(const {sql,details} of plans) {
    expect(details.join('; '),sql).toContain('CORRELATED SCALAR SUBQUERY');
    expect(details.join('; '),sql).not.toMatch(/LIST SUBQUERY|SCAN (?:t|remote_tables)\b/);
    expect(details.join('; '),sql).toMatch(/SEARCH t USING (?:INDEX sqlite_autoindex_remote_tables_1 \(slug=\?\)|INTEGER PRIMARY KEY \(rowid=\?\))/);
  }
  // Undo can reopen a recently ended room; its sessions survive subsequent pruning.
  db.prepare("update remote_tables set status='active',ended_at=null where id=?").run(rooms[2].id);
  service.pruneSessions(now+1);
  for(const name of sessions) expect(db.prepare(`select count(*) n from ${name}`).get(),name).toEqual({n:1});
});

it('keeps history and replay indefinitely, prunes transient data, and supports an optional retention cap', async () => {
  const {pruneRemoteDuels} = await import('../../src/services/remote-retention.js');
  const s=deckSession('domain',false);
  s.service.join(s.room.slug,'g',s.users[1],'Guest',1,2001);
  s.service.ready(s.room.slug,'g',s.users[1],true,2002);
  s.start();s.place('retention-card');
  const {db,service,users,room:table}=s;
  const day=86_400_000, now=3*day;
  vi.stubEnv('REMOTE_DUELS_RETENTION_DAYS','');
  try {
    // Web-owned optional tables have no foreign keys into the room schema.
    db.exec(`create table remote_phone_pairs(id text primary key,slug text,user_id integer);
      create table remote_phone_modes(slug text,user_id integer);
      create table remote_phone_attempts(bucket text primary key,started_at integer,count integer);
      create table remote_vision_ai_limits(user_id integer primary key,window_started_at integer,attempts integer);`);
    db.prepare('insert into remote_phone_attempts values(?,?,1)').run('legacy-hash',now-day);
    migrate(db); // Existing pairing buckets predate the room association.
    const roomId=(slug:string)=>(db.prepare('select id from remote_tables where slug=?').get(slug) as {id:number}).id;
    const attach=(slug:string)=>{
      db.prepare('insert into remote_phone_pairs values(?,?,?)').run(slug,slug,users[0]);
      db.prepare('insert into remote_phone_modes values(?,?)').run(slug,users[0]);
      db.prepare('insert into remote_phone_attempts(bucket,started_at,count,slug) values(?,?,1,?)').run(slug,now,slug);
      db.prepare('insert into remote_spectators values(?,?,?)').run(roomId(slug),users[1],now);
      db.prepare('insert into remote_spectator_tabs values(?,?,?,?)').run(roomId(slug),users[1],'tab',now);
      db.prepare('insert into remote_admin_watch values(?,?,null)').run(roomId(slug),users[1]);
    };
    for(let i=0;i<101;i++) {
      const room=service.create({guildId:'g',userId:users[0],displayName:'Owner',gameId:'ygo',seatCount:2,solo:true},1000);
      attach(room.slug);
      db.prepare("update remote_tables set status='ended',ended_at=? where slug=?").run(now-day-1,room.slug);
    }
    // These are board/Undo positions and replay facts, not camera or vision blobs.
    expect(db.prepare('select count(*) n from remote_state_values').get()).not.toEqual({n:0});
    expect(db.prepare('select count(*) n from remote_events where facts_hash is not null').get()).not.toEqual({n:0});
    attach(table.slug);
    db.prepare("update remote_tables set status='ended',ended_at=? where slug=?").run(now-day,table.slug);
    const idle=service.create({guildId:'g',userId:users[0],displayName:'Owner',gameId:'ygo',seatCount:2},1000);
    expect(service.sweepIdle(now).find(t=>t.slug===idle.slug)?.endReason).toBe('idle');
    db.prepare('insert into remote_vision_ai_limits values(?,?,1)').run(users[0],now-day);
    const stored=()=>['remote_tables','remote_seats','remote_bot_seats','remote_events','remote_state_values','remote_values']
      .map(name=>db.prepare(`select * from ${name} order by 1,2`).all());
    const history=service.listHistory('g',users[0]);
    expect(history.items.map(item=>item.slug)).toContain(table.slug);
    const expectedReplay=createRemoteDuelService(db).replayFrames(table.slug,'g',users[0]);
    const expectedState=service.get(table.slug,'g',users[0]).state;
    expect(pruneRemoteDuels(db,now)).toBe(101); // Only abandoned, never-started lobbies.
    const retained=stored();
    for(const name of ['remote_spectators','remote_spectator_tabs','remote_admin_watch','remote_phone_pairs','remote_phone_modes','remote_phone_attempts','remote_vision_ai_limits']) {
      expect(db.prepare(`select count(*) n from ${name}`).get(),name).toEqual({n:0});
    }
    delete process.env.REMOTE_DUELS_RETENTION_DAYS;
    expect(pruneRemoteDuels(db,now+day+1)).toBe(2); // Idle lobby and deckSession's initial lobby.
    const forever=stored();
    vi.stubEnv('REMOTE_DUELS_RETENTION_DAYS','0');
    expect(pruneRemoteDuels(db,now+365*day)).toBe(0);
    expect(stored()).toEqual(forever);
    expect(service.listHistory('g',users[0])).toEqual(history);
    expect(service.get(table.slug,'g',users[0]).state).toEqual(expectedState);
    expect(service.replay(table.slug,'g',users[0])).toEqual(expectedState);
    expect(createRemoteDuelService(db).replayFrames(table.slug,'g',users[0])).toEqual(expectedReplay);
    expect(retained[5]).toEqual(forever[5]); // Content-addressed replay/Undo values survive.
    vi.stubEnv('REMOTE_DUELS_RETENTION_DAYS','1');
    expect(pruneRemoteDuels(db,now)).toBe(0); // Strict boundary: exactly one day remains.
    expect(pruneRemoteDuels(db,now+1)).toBe(1);
    expect(()=>service.replayFrames(table.slug,'g',users[0])).toThrow(/not found/i);
    const names=()=> (db.prepare("select name from sqlite_master where type='table' and name glob 'remote_*'").all() as {name:string}[]).map(r=>r.name);
    const empty=()=>{for(const name of names())expect(db.prepare(`select count(*) n from ${name}`).get(),name).toEqual({n:0});};
    empty();
    const owned=service.create({guildId:'g',userId:users[0],displayName:'Owner',gameId:'ygo',seatCount:2},now);
    attach(owned.slug);
    const other=service.create({guildId:'g',userId:users[1],displayName:'Other',gameId:'ygo',seatCount:2},now);
    service.join(other.slug,'g',users[0],'Owner',undefined,now);
    service.leave(other.slug,'g',users[0],now); // Past actors must not retain a room after account deletion.
    const unrelated=service.create({guildId:'g',userId:users[1],displayName:'Other',gameId:'ygo',seatCount:2},now);
    db.prepare('insert into remote_spectators values(?,?,?)').run(roomId(unrelated.slug),users[0],now);
    db.prepare('insert into remote_phone_pairs values(?,?,?)').run('stale-pair',unrelated.slug,users[0]);
    db.prepare('insert into remote_phone_modes values(?,?)').run(unrelated.slug,users[0]);
    db.prepare('insert into remote_vision_ai_limits values(?,?,1)').run(users[0],now);
    deleteUserAccount(db,users[0]);
    expect(service.get(unrelated.slug,'g',users[1])).toBeDefined();
    expect(db.prepare('select count(*) n from remote_tables').get()).toEqual({n:2});
    const pastSeatEvents = db.prepare("select user_id,action_json from remote_events where table_id=? and json_extract(action_json,'$.type') in ('seat.joined','seat.left') and actor_seat=1 order by seq").all(roomId(other.slug)) as {user_id:number|null;action_json:string}[];
    expect(pastSeatEvents.map(event=>({userId:event.user_id,action:JSON.parse(event.action_json)}))).toEqual([
      {userId:null,action:{type:'seat.joined',seat:1,userId:null}},
      {userId:null,action:{type:'seat.left',seat:1,userId:null}},
    ]);
    for(const name of ['remote_spectators','remote_phone_pairs','remote_phone_modes','remote_vision_ai_limits']) {
      expect(db.prepare(`select count(*) n from ${name} where user_id=?`).get(users[0]),name).toEqual({n:0});
    }
    deleteUserAccount(db,users[1]);
    empty();
    expect(db.pragma('foreign_key_check')).toEqual([]);
  } finally {vi.unstubAllEnvs();}
});


// B3 result lifecycle, using the real reducer, slot advancement and scoring service.
async function tournamentResultSession(format: "single_elim" | "round_robin" = "single_elim", bestOf: 1 | 3 = 1) {
  const { createTournamentService } = await import("../../src/services/tournaments.js");
  const { createTournamentRemoteService } = await import("../../src/services/tournament-remote.js");
  const { createTournamentRemoteResultService } = await import("../../src/services/tournament-remote-results.js");
  const db = new Database(":memory:"); databases.push(db); db.pragma("foreign_keys=ON"); migrate(db);
  const actors = Array.from({length:4}, (_, i) => seedIdentity(db, {name:`Remote ${i}`}));
  vi.stubEnv("REMOTE_DUELS", "1"); vi.stubEnv("REMOTE_DUELS_USERS", "*");
  const tournaments = createTournamentService(db);
  const tournament = tournaments.create("g", "Result cup", format, actors[0].userId, {duelType:"remote", bestOf});
  for (const actor of actors) tournaments.join(tournament.id, actor.playerId);
  tournaments.start(tournament.id);
  const slot = tournaments.matches(tournament.id).find(m => m.playerTwoId !== null)!;
  const one = actors.find(a => a.playerId === slot.playerOneId)!;
  const two = actors.find(a => a.playerId === slot.playerTwoId)!;
  const remote = createRemoteDuelService(db, {dataDirectory:deckData});
  const tables = createTournamentRemoteService(db);
  const results = createTournamentRemoteResultService(db);
  const start = () => {
    const {table} = tables.startMatch({guildId:"g", tournamentId:tournament.id, tournamentMatchId:slot.id, actorUserId:two.userId});
    remote.join(table.slug,"g",one.userId,"One");
    remote.ready(table.slug,"g",one.userId,true); remote.ready(table.slug,"g",two.userId,true);
    return remote.start(table.slug,"g",two.userId);
  };
  let room = start();
  const act = (seat:number, action:Record<string, unknown>) => {
    room = remote.act(room.slug,"g",seat === 0 ? two.userId : one.userId,{baseSeq:room.lastSeq,
      action:remoteActionSchema.parse({...action,actorSeat:seat,idempotencyKey:`result-${room.slug}-${room.lastSeq}`})});
  };
  const input = {tournamentMatchId:slot.id,actorUserId:one.userId};
  const refresh = () => room = remote.get(room.slug,"g",two.userId);
  return {db,tournaments,tournament,slot,one,two,actors,remote,tables,results,start,act,refresh,input,get room(){return room;}};
}

it("rebuilds tournament rules from table.created before an opponent changes LP to zero", async () => {
  const s = await tournamentResultSession();
  try {
    const created = s.db.prepare("select action_json from remote_events where table_id=(select id from remote_tables where slug=?) and seq=1")
      .get(s.room.slug) as {action_json:string};
    expect(JSON.parse(created.action_json)).toMatchObject({type:"table.created",tournament:true});
    // Rebuild from the log without relying on the table's tournament metadata or cached state.
    s.db.transaction(() => {
      s.db.prepare("update remote_tables set tournament_match_id=null where slug=?").run(s.room.slug);
      const rebuilt = s.remote.replay(s.room.slug,"g",s.two.userId);
      expect(rebuilt.tournament).toBe(true);
      s.db.prepare("update remote_tables set tournament_match_id=?,state_json=? where slug=?")
        .run(s.slot.id,JSON.stringify(rebuilt),s.room.slug);
    })();
    s.act(1,{type:"lp.change",seat:0,delta:-8000,reason:"damage"});
    expect(s.room.state).toMatchObject({tournament:true,ended:false,match:{phase:"duel",
      pendingResult:{winnerSeat:1,confirmed:[1]}}});
    expect(s.room.state.seats[0]).toMatchObject({eliminated:false,resources:{lp:0}});
    const declarationId = s.room.state.match.pendingResult!.id;
    expect(s.remote.replay(s.room.slug,"g",s.two.userId).match.pendingResult?.id).toBe(declarationId);
    s.act(0,{type:"match.confirm",declarationId,accept:true});
    expect(s.results.get(s.input)).toMatchObject({status:"proposed",winnerPlayerId:s.one.playerId,source:"lp"});
    s.results.confirm(s.input);
    expect(s.results.confirm({...s.input,actorUserId:s.two.userId}).status).toBe("final");
  } finally {vi.unstubAllEnvs();}
});

it("a quit between games of a tournament match is a forfeit that finalizes by itself, without a game score", async () => {
  const s = await tournamentResultSession("single_elim", 3);
  try {
    s.act(1,{type:"player.concede"}); s.act(1,{type:"match.continue"});
    s.act(0,{type:"player.leave"});
    expect(s.refresh()).toMatchObject({status:"ended",endReason:"forfeit",state:{match:{phase:"done",winnerSeat:1}}});
    const proposed = s.results.get(s.input);
    expect(proposed).toMatchObject({status:"proposed",winnerPlayerId:s.one.playerId,source:"concede",score:null});
    s.results.finalizeDue(proposed!.confirmDeadlineAt!);
    expect(s.results.get(s.input)).toMatchObject({status:"final",winnerPlayerId:s.one.playerId});
  } finally {vi.unstubAllEnvs();}
});

it.each(["active", "proposed", "disputed"] as const)("blocks both manual report services for a Remote %s match", async status => {
  const s = await tournamentResultSession();
  try {
    if (status !== "active") s.act(0,{type:"player.concede"});
    if (status === "disputed") s.results.dispute(s.input);
    for (const report of [
      () => s.tournaments.report(s.tournament.id,s.one.playerId,s.two.playerId,s.one.playerId),
      () => s.tournaments.reportTournamentMatch(s.slot.id,s.one.playerId,s.one.playerId),
    ]) expect(report).toThrow(expect.objectContaining({status:409,code:"REMOTE_MATCH_OPEN",
      message:expect.stringMatching(/open Remote table or result/)}));
    expect(s.db.prepare("select count(*) n from matches").get()).toEqual({n:0});
    expect(s.tournaments.matches(s.tournament.id).find(m=>m.id===s.slot.id)?.status).toBe("open");
  } finally {vi.unstubAllEnvs();}
});

it.each(["pair", "slot"])("allows the %s manual report fallback after a Remote table ends without a result", async path => {
  const s = await tournamentResultSession();
  try {
    expect(s.results.get(s.input)).toMatchObject({status:"playing",tableOpen:true});
    s.remote.sweepIdle(s.room.lastEventAt + 10*60*1000 + 1);
    expect(s.results.get(s.input)).toMatchObject({status:"playing",tableOpen:false});
    const match = path === "pair"
      ? s.tournaments.report(s.tournament.id,s.one.playerId,s.two.playerId,s.one.playerId)
      : s.tournaments.reportTournamentMatch(s.slot.id,s.one.playerId,s.one.playerId);
    expect(match.status).toBe("pending");
  } finally {vi.unstubAllEnvs();}
});

it("never finalizes a stale Remote proposal over a completed slot", async () => {
  const s = await tournamentResultSession("round_robin");
  const {createMatchService} = await import("../../src/services/matches.js");
  try {
    s.act(0,{type:"player.concede"});
    const deadline=s.results.get(s.input)!.confirmDeadlineAt!;
    s.results.confirm(s.input);
    const match=createMatchService(s.db).recordConfirmedResult({guildId:"g",playerOneId:s.one.playerId,
      playerTwoId:s.two.playerId,winnerId:s.two.playerId,source:"tournament",tournamentMatchId:s.slot.id});
    expect(()=>s.results.confirm({...s.input,actorUserId:s.two.userId}))
      .toThrow(expect.objectContaining({code:"TOURNAMENT_MATCH_UNAVAILABLE"}));
    expect(s.results.finalizeDue(deadline+1)).toEqual([]);
    expect(s.db.prepare("select id,winner_id from matches where tournament_id=?").all(s.tournament.id))
      .toEqual([{id:match.id,winner_id:s.two.playerId}]);
    expect(s.results.get(s.input)).toMatchObject({status:"proposed",reports:[{choice:"confirm"},{choice:null}]});
    // A late terminal reducer action cannot even propose over the completed slot.
    s.db.prepare("update tournament_remote_matches set status='playing',winner_player_id=null where tournament_match_id=?").run(s.slot.id);
    s.results.propose((s.db.prepare("select id from remote_tables where slug=?").get(s.room.slug) as {id:number}).id,s.room.state);
    expect(s.results.get(s.input)).toMatchObject({status:"playing",winnerPlayerId:null});
  } finally {vi.unstubAllEnvs();}
});

it("proposes a Remote table winner, confirms both players once and advances single elimination", async () => {
  const s = await tournamentResultSession();
  try {
    expect(s.room.state.tournament).toBe(true);
    expect(s.remote.replay(s.room.slug,"g",s.two.userId).tournament).toBe(true);
    expect(() => s.tournaments.reportTournamentMatch(s.slot.id,s.one.playerId,s.one.playerId))
      .toThrow(expect.objectContaining({code:"REMOTE_MATCH_OPEN"}));
    s.act(0,{type:"detection.mode",mode:"tap",reason:"player"});
    expect(s.room.state.detection?.[0]).toEqual({mode:"tap",at:expect.any(Number)});
    s.act(1,{type:"player.concede"});
    const evidence = () => s.db.prepare("select * from tournament_remote_evidence where tournament_match_id=?")
      .get(s.slot.id) as {result_events_json:string;detection_summary_json:string} | undefined;
    expect(evidence()).toBeDefined();
    expect(JSON.parse(evidence()!.result_events_json)).toContainEqual(expect.objectContaining({seat:0,
      action:{type:"detection.mode",mode:"tap",reason:"player"}}));
    expect(JSON.parse(evidence()!.detection_summary_json)[0]).toMatchObject({seat:0,tapSeconds:expect.any(Number)});
    s.results.confirm(s.input);
    s.act(1,{type:"undo",targetActionId:s.room.state.undo!.actionId});
    expect(evidence()).toBeUndefined();
    expect(s.results.get(s.input)).toMatchObject({status:"playing",winnerPlayerId:null,score:null,
      proposedAt:null,confirmDeadlineAt:null,reports:[{choice:null},{choice:null}]});
    s.act(0,{type:"player.concede"}); // Creator is player two, independent of slot order.
    const proposal = s.results.get(s.input);
    expect(proposal).toMatchObject({status:"proposed",winnerPlayerId:s.one.playerId,
      score:{playerOne:1,playerTwo:0},source:"concede"});
    expect(proposal!.confirmDeadlineAt! - proposal!.proposedAt!).toBe(2*60*60*1000);
    expect(() => s.tournaments.reportTournamentMatch(s.slot.id,s.one.playerId,s.one.playerId))
      .toThrow(expect.objectContaining({code:"REMOTE_MATCH_OPEN"}));
    expect(() => s.results.confirm({...s.input,actorUserId:s.actors.find(a=>![s.one.userId,s.two.userId].includes(a.userId))!.userId}))
      .toThrow(expect.objectContaining({code:"REMOTE_RESULT_PLAYER_REQUIRED"}));
    expect(s.results.confirm(s.input).status).toBe("proposed");
    expect(s.results.confirm(s.input).status).toBe("proposed");
    s.db.exec("create temp trigger fail_remote_scoring before insert on point_awards begin select raise(abort,'forced Remote scoring failure'); end");
    expect(()=>s.results.confirm({...s.input,actorUserId:s.two.userId})).toThrow("forced Remote scoring failure");
    expect(s.results.get(s.input)).toMatchObject({status:"proposed",reports:[{choice:"confirm"},{choice:null}]});
    expect(s.db.prepare("select count(*) n from matches").get()).toEqual({n:0});
    s.db.exec("drop trigger fail_remote_scoring");
    expect(s.results.confirm({...s.input,actorUserId:s.two.userId})).toMatchObject({status:"final",finalizationReason:"both_confirmed"});
    expect(s.results.confirm(s.input).status).toBe("final");
    s.refresh(); // Lifecycle closure may append table.ended and advance the sequence.
    expect(s.room.status).toBe("ended");
    const finalizedSeq=s.room.lastSeq;
    expect(()=>s.act(0,{type:"undo",targetActionId:s.room.state.undo!.actionId}))
      .toThrow(expect.objectContaining({status:409}));
    expect(s.refresh().lastSeq).toBe(finalizedSeq);
    expect(s.results.get(s.input)?.status).toBe("final");
    expect(s.tournaments.matches(s.tournament.id).find(m=>m.id===s.slot.id)?.status).toBe("completed");
    expect(s.db.prepare("select * from matches where tournament_id=?").all(s.tournament.id)).toHaveLength(1);
    expect(s.db.prepare("select winner_id,source,status from matches where tournament_id=?").get(s.tournament.id))
      .toEqual({winner_id:s.one.playerId,source:"tournament",status:"approved"});
    const other=s.tournaments.matches(s.tournament.id).find(m=>m.roundNumber===1 && m.id !== s.slot.id)!;
    const {createTournamentDuelService}=await import("../../src/services/tournament-duels.js");
    createTournamentDuelService(s.db).setResultByOrganizer({tournamentMatchId:other.id,organizerUserId:s.actors[0].userId,winnerPlayerId:other.playerOneId});
    expect(s.tournaments.matches(s.tournament.id).some(m=>m.roundNumber===2 && [m.playerOneId,m.playerTwoId].includes(s.one.playerId))).toBe(true);
    expect(() => s.results.void({...s.input,actorUserId:s.actors[0].userId})).toThrow(expect.objectContaining({code:"REMOTE_REPLAY_UNAVAILABLE"}));
  } finally {vi.unstubAllEnvs();}
});

it("a dispute blocks the timer until an organizer records a decision or voids for replay", async () => {
  const s = await tournamentResultSession("round_robin");
  const {createTournamentDuelService} = await import("../../src/services/tournament-duels.js");
  try {
    s.act(0,{type:"player.concede"});
    const deadline=s.results.get(s.input)!.confirmDeadlineAt!;
    expect(s.results.dispute({...s.input,note:"Wrong LP"}).status).toBe("disputed");
    expect(s.results.dispute({...s.input,actorUserId:s.two.userId,note:"Please review"})).toMatchObject({status:"disputed",
      reports:[{choice:"dispute",note:"Wrong LP"},{choice:"dispute",note:"Please review"}]});
    expect(s.results.finalizeDue(deadline+1)).toEqual([]);
    expect(()=>s.results.confirm({...s.input,actorUserId:s.two.userId})).toThrow(expect.objectContaining({code:"REMOTE_RESULT_DISPUTED"}));
    expect(()=>s.tournaments.reportTournamentMatch(s.slot.id,s.one.playerId,s.one.playerId)).toThrow(expect.objectContaining({code:"REMOTE_MATCH_OPEN"}));
    createTournamentDuelService(s.db).setResultByOrganizer({tournamentMatchId:s.slot.id,organizerUserId:s.actors[0].userId,winnerPlayerId:s.two.playerId});
    expect(s.results.get(s.input)).toMatchObject({status:"final",winnerPlayerId:s.two.playerId,finalizationReason:"organizer",
      organizerDecision:{userId:s.actors[0].userId,winnerPlayerId:s.two.playerId,void:false,note:null}});
    expect(s.db.prepare("select winner_id from matches where tournament_id=?").get(s.tournament.id)).toEqual({winner_id:s.two.playerId});
    expect(s.results.void({...s.input,actorUserId:s.actors[0].userId,note:"Replay"})).toMatchObject({status:"void",winnerPlayerId:null,finalizationReason:null,
      organizerDecision:{winnerPlayerId:null,void:true,note:"Replay"}});
    expect(s.tournaments.matches(s.tournament.id).find(m=>m.id===s.slot.id)?.status).toBe("open");
    s.refresh();
    expect(s.room.status).toBe("ended");
    const voidedSeq=s.room.lastSeq;
    expect(()=>s.act(0,{type:"undo",targetActionId:s.room.state.undo!.actionId}))
      .toThrow(expect.objectContaining({status:409}));
    expect(s.refresh().lastSeq).toBe(voidedSeq);
    expect(s.results.get(s.input)?.status).toBe("void");
    expect(s.start().state.tournament).toBe(true);
  } finally {vi.unstubAllEnvs();}

});
it.each(['tap','manual'] as const)('keeps only tournament result evidence through room purge and deletes it on the D5 schedule in %s mode', async mode => {
  const { captureRemoteTournamentEvidence } = await import('../../src/services/tournament-remote-evidence.js');
  const { pruneRemoteDuels } = await import('../../src/services/remote-retention.js');
  const { deleteUserRemoteData } = await import('../../src/services/remote-cleanup.js');
  const { db, service } = setup(), day = 86_400_000, hour = 3_600_000;
  const actors = [seedIdentity(db), seedIdentity(db)];
  const clock = vi.spyOn(Date, 'now').mockReturnValue(25_000);
  vi.stubEnv('REMOTE_DUELS_RETENTION_DAYS', '1');
  let fixture = 0;
  const make = () => {
    const tournamentId = Number(db.prepare(`insert into tournaments(guild_id,name,format,status,created_by_user_id,duel_type)
      values('g',?,'round_robin','active',?,'remote')`).run(`Evidence ${++fixture}`,actors[0].userId).lastInsertRowid);
    const matchId = Number(db.prepare(`insert into tournament_matches(tournament_id,player_one_id,player_two_id,round_number,status)
      values(?,?,?,1,'open')`).run(tournamentId, actors[1].playerId, actors[0].playerId).lastInsertRowid);
    let room = service.create({guildId:'g', userId:actors[0].userId, displayName:'A', gameId:'ygo', seatCount:2, bestOf:3}, 1000);
    service.join(room.slug, 'g', actors[1].userId, 'B', 1, 1001);
    service.ready(room.slug, 'g', actors[0].userId, true, 1002);
    service.ready(room.slug, 'g', actors[1].userId, true, 1002);
    room = service.start(room.slug, 'g', actors[0].userId, 1003);
    const tableId = (db.prepare('select id from remote_tables where slug=?').get(room.slug) as {id:number}).id;
    db.prepare('update remote_tables set tournament_match_id=? where id=?').run(matchId, tableId);
    db.prepare(`insert into tournament_remote_matches(tournament_match_id,table_id,table_slug,player_one_id,player_two_id,created_at,updated_at)
      values(?,?,?,?,?,1000,1000)`).run(matchId, tableId, room.slug, actors[1].playerId, actors[0].playerId);
    let serial = 0;
    const act = (input: Record<string, unknown>, actorSeat = 0) => {
      const idempotencyKey = `evidence-${++serial}`;
      // A game end and siding reset may share one millisecond; retain the end LP.
      const at = serial >= 6 && serial <= 10 ? 8000 : 2000 + serial * 1000;
      room = service.act(room.slug, 'g', actors[actorSeat].userId, {baseSeq:room.lastSeq,
        action:remoteActionSchema.parse({...input, actorSeat, idempotencyKey})}, at);
      return idempotencyKey;
    };
    act({type:'detection.mode', mode, reason:'player'});
    act({type:'lp.change', seat:0, delta:-500, reason:'cost'});
    const undone = act({type:'lp.change', seat:0, delta:-1000, reason:'mistake'});
    act({type:'undo', targetActionId:undone});
    act({type:'match.declare', winnerSeat:0});
    act({type:'match.confirm', declarationId:'evidence-5', accept:true}, 1);
    act({type:'match.continue'});
    act({type:'match.first', seatGoesFirst:0}, 1);
    act({type:'side.ready', seat:0});
    act({type:'side.ready', seat:1}, 1);
    // The next game starts after the 5-second countdown.
    service.sweepIdle(13000); room = service.get(room.slug, 'g', actors[0].userId);
    act({type:'twin.place', seat:0, zone:'monster', card:{ref:'public', cardId:1, slot:1}});
    act({type:'twin.place', seat:0, zone:'monster', card:{ref:'unknown', slot:2}});
    act({type:'twin.place', seat:0, zone:'spell-trap', card:{ref:'secret-set', cardId:2, slot:1, faceUp:false}});
    act({type:'hand.add', cardId:3, source:'unknown'});
    act({type:'card.identified', seat:0, cardRef:'public', cardId:1, source:'click'});
    act({type:'lp.change', seat:0, delta:-200, reason:'cost'});
    act({type:'twin.place', seat:1, zone:'monster', card:{ref:'loser-public', cardId:4, slot:1}}, 1);
    act({type:'twin.place', seat:1, zone:'monster', card:{ref:'loser-unknown', slot:2}}, 1);
    act({type:'player.concede'}, 1);
    const endedAt = room.endedAt!;
    db.prepare("update tournament_remote_matches set status='proposed',proposed_at=?,confirm_deadline_at=? where tournament_match_id=?")
      .run(endedAt, endedAt + 2*hour, matchId);
    return {tableId, matchId, tournamentId, endedAt};
  };
  type Evidence = {table_id:number|null; players_json:string; games_json:string; result_events_json:string; final_lp_json:string;
    public_board_json:string; reports_json:string; detection_summary_json:string; hard_delete_at:number; purge_after_at:number|null};
  const evidence = (id:number) => db.prepare('select * from tournament_remote_evidence where tournament_match_id=?').get(id) as Evidence | undefined;
  try {
    const timeout = make();
    captureRemoteTournamentEvidence(db, timeout.tableId);
    const copy = evidence(timeout.matchId)!;
    expect(JSON.parse(copy.players_json)).toEqual([{userId:actors[0].userId,seat:0},{userId:actors[1].userId,seat:1}]);
    expect(JSON.parse(copy.games_json)).toMatchObject([{n:1,winnerSeat:0,reason:'declared'},{n:2,winnerSeat:0,reason:'concede'}]);
    expect(JSON.parse(copy.final_lp_json)).toEqual([{n:1,seats:[{seat:0,lp:7500},{seat:1,lp:8000}]},{n:2,seats:[{seat:0,lp:7800},{seat:1,lp:8000}]}]);
    expect(JSON.parse(copy.public_board_json)).toEqual([{seat:0,cards:[{zone:'monster',slot:1,cardId:1,name:'Filler 1',position:'attack'},{zone:'monster',slot:2,position:'attack'}]},
      {seat:1,cards:[{zone:'monster',slot:1,cardId:4,position:'attack'},{zone:'monster',slot:2,position:'attack'}]}]);
    const excerpt = JSON.parse(copy.result_events_json);
    expect(excerpt.map((e:{action:{type:string}})=>e.action.type)).toEqual(['detection.mode','lp.change','lp.change','undo','match.declare','match.confirm','lp.change','player.concede']);
    expect(excerpt[1]).toMatchObject({userId:actors[0].userId,seat:0,action:{type:'lp.change',seat:0,delta:-500,reason:'cost'}});
    expect(JSON.stringify(copy)).not.toMatch(/secret-set|hand.add|deckChecks|factsHash|idempotencyKey|departedFrom/);
    expect(JSON.parse(copy.detection_summary_json)[0]).toMatchObject({seat:0,autoSeconds:0,unknownSeconds:1.997,tapSeconds:mode === 'tap' ? 18 : 0,manualSeconds:mode === 'manual' ? 18 : 0,identifiedByClick:1,identifiedByTyped:0,manualCorrections:3,unknownAtGameEnd:[{n:1,count:0},{n:2,count:1}]});
    expect(JSON.parse(copy.detection_summary_json)[1]).toMatchObject({seat:1,manualCorrections:2,unknownAtGameEnd:[{n:1,count:0},{n:2,count:1}]});
    captureRemoteTournamentEvidence(db, timeout.tableId);
    expect(evidence(timeout.matchId)).toEqual(copy);
    const finalAt = timeout.endedAt + 2*hour;
    db.prepare("update tournament_remote_matches set status='final',finalized_at=?,finalization_reason='timeout' where tournament_match_id=?").run(finalAt,timeout.matchId);
    pruneRemoteDuels(db,timeout.endedAt+day+1);
    expect(evidence(timeout.matchId)?.table_id).toBeNull();
    expect(evidence(timeout.matchId)?.result_events_json).toBe(copy.result_events_json);
    pruneRemoteDuels(db,finalAt+2*day-1); expect(evidence(timeout.matchId)).toBeDefined();
    pruneRemoteDuels(db,finalAt+2*day); expect(evidence(timeout.matchId)).toBeUndefined();

    const confirmed = make(); captureRemoteTournamentEvidence(db,confirmed.tableId);
    db.prepare(`update tournament_remote_matches set status='final',finalization_reason='both_confirmed',finalized_at=?,
      player_one_choice='confirm',player_one_responded_at=?,player_two_choice='confirm',player_two_responded_at=? where tournament_match_id=?`)
      .run(confirmed.endedAt,confirmed.endedAt,confirmed.endedAt,confirmed.matchId);
    expect(JSON.parse(evidence(confirmed.matchId)!.reports_json)).toEqual(actors.slice().reverse().map(a=>({userId:a.userId,choice:'confirm',note:null,at:confirmed.endedAt})));
    pruneRemoteDuels(db,confirmed.endedAt+hour);
    expect(evidence(confirmed.matchId)).toBeUndefined();
    pruneRemoteDuels(db,confirmed.endedAt+day+1); // Safety net must never resurrect expired evidence.
    expect(evidence(confirmed.matchId)).toBeUndefined();

    for (const decisionDay of [0,1,13]) {
      const dispute=make(); captureRemoteTournamentEvidence(db,dispute.tableId);
      db.prepare("update tournament_remote_matches set status='disputed',player_one_choice='dispute',player_one_note='Wrong LP',player_one_responded_at=? where tournament_match_id=?").run(dispute.endedAt,dispute.matchId);
      expect(JSON.parse(evidence(dispute.matchId)!.reports_json)[0]).toMatchObject({choice:'dispute',note:'Wrong LP'});
      let due=dispute.endedAt+14*day;
      if(decisionDay) {
        const decisionAt=dispute.endedAt+decisionDay*day;
        db.prepare("update tournament_remote_matches set status='void',organizer_decided_at=? where tournament_match_id=?").run(decisionAt,dispute.matchId);
        due=Math.min(due,decisionAt+2*day);
        // B1 resets the result row when starting a replay. Keep the earlier copy's deadline.
        db.prepare('delete from tournament_remote_matches where tournament_match_id=?').run(dispute.matchId);
        db.prepare(`insert into tournament_remote_matches(tournament_match_id,table_slug,player_one_id,player_two_id,created_at,updated_at)
          values(?,'replay-room',?,?,?,?)`).run(dispute.matchId,actors[1].playerId,actors[0].playerId,decisionAt,decisionAt);
        expect(evidence(dispute.matchId)?.purge_after_at).toBe(due);
      }
      pruneRemoteDuels(db,due-1); expect(evidence(dispute.matchId)).toBeDefined();
      pruneRemoteDuels(db,due); expect(evidence(dispute.matchId)).toBeUndefined();
    }
    const fallback=make(); // A missing capture is recovered before the table is purged.
    db.prepare('delete from tournament_remote_evidence where tournament_match_id=?').run(fallback.matchId);
    pruneRemoteDuels(db,fallback.endedAt+day+1);
    expect(evidence(fallback.matchId)?.table_id).toBeNull();
    db.prepare("update tournament_remote_matches set status='disputed',player_two_choice='dispute',player_two_note='After room purge',player_two_responded_at=? where tournament_match_id=?")
      .run(fallback.endedAt+day+1,fallback.matchId);
    expect(JSON.parse(evidence(fallback.matchId)!.reports_json)[1]).toMatchObject({choice:'dispute',note:'After room purge'});
    db.prepare("update tournaments set status='cancelled' where id=?").run(fallback.tournamentId);
    expect(evidence(fallback.matchId)).toBeUndefined();
    const cancelled=make(); captureRemoteTournamentEvidence(db,cancelled.tableId);
    db.prepare("update tournaments set status='cancelled' where id=?").run(cancelled.tournamentId);
    expect(evidence(cancelled.matchId)).toBeUndefined();
    pruneRemoteDuels(db,cancelled.endedAt+day+1); expect(evidence(cancelled.matchId)).toBeUndefined();
    const account=make(); captureRemoteTournamentEvidence(db,account.tableId);
    pruneRemoteDuels(db,account.endedAt+day+1);
    db.transaction(()=>deleteUserRemoteData(db,actors[1].userId)).immediate();
    expect(evidence(account.matchId)).toMatchObject({table_id:null});
    expect(JSON.parse(evidence(account.matchId)!.players_json)).toContainEqual({userId:null,seat:1});
    expect(db.pragma('foreign_key_check')).toEqual([]);
  } finally {clock.mockRestore();vi.unstubAllEnvs();}
});


it.each(["idle", "creator-left"] as const)("expires no-result %s evidence after 48 hours without resurrecting a replay copy", async reason => {
  const s = await tournamentResultSession();
  const {pruneRemoteDuels} = await import("../../src/services/remote-retention.js");
  const day = 86_400_000;
  vi.stubEnv("REMOTE_DUELS_RETENTION_DAYS", "1");
  try {
    let room: Pick<typeof s.room,"slug"|"lastEventAt"> = s.room;
    if (reason === "creator-left") {
      // Creator departure applies to a lobby. Void the active table first, then start its replacement.
      s.results.void({...s.input,actorUserId:s.actors[0].userId});
      room = s.tables.startMatch({guildId:"g",tournamentId:s.tournament.id,tournamentMatchId:s.slot.id,
        actorUserId:s.two.userId}).table;
      s.remote.leave(room.slug,"g",s.two.userId,room.lastEventAt+1);
    } else s.remote.sweepIdle(room.lastEventAt + 10*60*1000 + 1);
    const ended = s.remote.get(room.slug,"g",s.two.userId);
    const evidence = () => s.db.prepare("select table_id,table_slug,purge_after_at from tournament_remote_evidence where tournament_match_id=?")
      .get(s.slot.id) as {table_id:number|null;table_slug:string;purge_after_at:number} | undefined;
    expect(s.results.get(s.input)).toMatchObject({status:"playing",proposedAt:null});
    expect(evidence()).toMatchObject({table_slug:room.slug,purge_after_at:ended.endedAt! + 2*day});
    // Replay resets the playing row; the previous copy keeps its original deadline.
    s.tables.startMatch({guildId:"g",tournamentId:s.tournament.id,tournamentMatchId:s.slot.id,actorUserId:s.two.userId});
    pruneRemoteDuels(s.db,ended.endedAt!+day+1);
    expect(evidence()).toMatchObject({table_id:null,purge_after_at:ended.endedAt!+2*day});
    pruneRemoteDuels(s.db,ended.endedAt!+2*day-1);
    expect(evidence()).toBeDefined();
    pruneRemoteDuels(s.db,ended.endedAt!+2*day);
    expect(evidence()).toBeUndefined();
    expect(s.db.pragma("foreign_key_check")).toEqual([]);
  } finally {vi.unstubAllEnvs();}
});

it('a card the camera sent from the field to a pile is the same copy when put back late, and the pile counts stay exact', () => {
  let state = ygoModule.initialState({seatCount:2}), at = 0;
  const act = (input:Record<string,unknown>) => state = ygoModule.reduce(state, remoteActionSchema.parse({actorSeat:0, ...(input.type === 'undo' ? {} : {seat:0}), at, idempotencyKey:crypto.randomUUID(), ...input}));
  const count = (zone:string) => state.seats[0].twin.filter(c => c.zone === zone).length;
  const card = {cardId:97522863, name:'The Man with the Mark', faceUp:true, position:'attack'};
  act({type:'twin.place', zone:'monster', card:{...card, ref:'lifted', slot:3}});
  at = 1000; act({type:'twin.move', source:'auto', cardRef:'lifted', zone:'graveyard'});
  expect([count('monster'), count('graveyard'), count('banished')]).toEqual([0, 1, 0]);
  expect(state.seats[0].twin[0].departedFrom).toMatchObject({zone:'monster', slot:3, auto:true});
  // Late banish arrival: the camera shows an unread face-down card; the departed card moves there and the stand-in goes (one card, one pile).
  at = 3000; act({type:'twin.place', source:'auto', zone:'banished', card:{ref:'fw-1', faceUp:false, position:'attack'}});
  act({type:'twin.move', source:'auto', confirmed:true, cardRef:'lifted', zone:'banished', faceUp:false}); act({type:'twin.remove', cardRef:'fw-1'});
  expect([count('graveyard'), count('banished')]).toEqual([0, 1]);
  expect(state.seats[0].twin.find(c => c.ref === 'lifted')!.departedFrom).toBeUndefined();
  act({type:'undo', targetActionId:state.undo!.actionId}); act({type:'undo', targetActionId:state.undo!.actionId});
  expect([count('graveyard'), count('banished')]).toEqual([1, 1]);
  expect(state.seats[0].twin.filter(c => c.ref === 'lifted')).toHaveLength(1); expect(state.seats[0].twin.find(c => c.ref === 'lifted')!.zone).toBe('graveyard');
  // Put back in the same slot within 30 s, long after the 2.5 s window: the same copy returns to the field, no duplicate.
  at = 20_000; act({type:'twin.place', source:'auto', zone:'monster', card:{...card, ref:'new-outline', slot:3}});
  expect(state.seats[0].twin.filter(c => c.ref === 'lifted' || c.ref === 'new-outline').map(c => [c.ref, c.zone])).toEqual([['lifted', 'monster']]);
  expect(count('graveyard')).toBe(0);
});

it('a second copy placed after 30 s, or in another slot, does not take a card the rules sent to the GY', () => {
  let state = ygoModule.initialState({seatCount:2}), at = 0;
  const act = (input:Record<string,unknown>) => state = ygoModule.reduce(state, remoteActionSchema.parse({actorSeat:0, seat:0, at, idempotencyKey:crypto.randomUUID(), ...input}));
  const card = {cardId:97522863, name:'The Man with the Mark', faceUp:true, position:'attack'};
  act({type:'twin.place', zone:'monster', card:{...card, ref:'first', slot:3}});
  at = 1000; act({type:'twin.move', source:'auto', cardRef:'first', zone:'graveyard', faceUp:true});
  at = 5_000; act({type:'twin.place', source:'auto', zone:'monster', card:{...card, ref:'third', slot:5}});
  expect(state.seats[0].twin.find(c => c.ref === 'first')!.zone).toBe('graveyard');
  at = 600_000; act({type:'twin.place', source:'auto', zone:'monster', card:{...card, ref:'second', slot:1}});
  expect(state.seats[0].twin.find(c => c.ref === 'first')!.zone).toBe('graveyard');
});

it('a named read in the other pile after the GY default is the same card (no copy in both piles)', () => {
  let state = ygoModule.initialState({seatCount:2}), at = 0;
  const act = (input:Record<string,unknown>) => state = ygoModule.reduce(state, remoteActionSchema.parse({actorSeat:0, seat:0, at, idempotencyKey:crypto.randomUUID(), ...input}));
  const card = {cardId:97522863, name:'The Man with the Mark', faceUp:true, position:'attack'};
  act({type:'twin.place', zone:'monster', card:{...card, ref:'x', slot:3}});
  at = 1000; act({type:'twin.move', source:'auto', cardRef:'x', zone:'graveyard', faceUp:true});
  at = 2000; act({type:'twin.place', source:'auto', zone:'banished', card:{...card, ref:'fw-9'}});
  const count = (zone:string) => state.seats[0].twin.filter(c => c.zone === zone).length;
  expect([count('graveyard'), count('banished')]).toEqual([0, 1]);
});

it('only a face-up Pendulum Monster that was face-up on the field is shown in the Extra Deck to the opponent', () => {
  let state = ygoModule.initialState({seatCount:2});
  const act = (input:Record<string,unknown>) => state = ygoModule.reduce(state, remoteActionSchema.parse({actorSeat:0, seat:0, at:1, idempotencyKey:crypto.randomUUID(), ...input}));
  for (const [ref, slot, cardId, faceUp] of [['pend', 1, 97522863, true], ['plain', 2, 89631139, true], ['down', 3, 15025844, false]] as const) act({type:'twin.place', zone:'monster', card:{cardId, name:ref, faceUp, position:'attack', ref, slot}});
  act({type:'twin.move', source:'auto', cardRef:'pend', zone:'extra', faceUp:true, pendulum:true});
  act({type:'twin.move', source:'auto', cardRef:'plain', zone:'extra', faceUp:true});
  act({type:'twin.move', source:'auto', cardRef:'down', zone:'extra', faceUp:true, pendulum:true});
  const seen = projectRemoteState(state, new Set([1])).seats[0].twin;
  expect(['pend', 'plain', 'down'].map(ref => seen.find(c => c.ref === ref)!.name)).toEqual(['pend', undefined, undefined]);
});

it('keeps a token as public table state: created, moved and removed by its owner, seen by every viewer, ignored by the camera', () => {
  const s = deckSession('normal', false);
  s.select(s.save().id);
  s.service.join(s.room.slug, 'g', s.users[1], 'Opponent', 1, 2001);
  s.service.ready(s.room.slug, 'g', s.users[1], true, 2002); s.start();
  const token = { ref: 'token-1', name: 'Sheep Token', slot: 2, faceUp: true, position: 'defense', token: { atk: 0, def: 0 } };
  const mine = () => s.room.state.seats[0].twin.find(c => c.ref === 'token-1');

  // Create: public at once, with its stats, for the opponent and for a spectator.
  s.act({ type: 'twin.place', seat: 0, zone: 'monster', card: token });
  expect(mine()).toMatchObject({ zone: 'monster', slot: 2, position: 'defense', faceUp: true, name: 'Sheep Token', token: { atk: 0, def: 0 } });
  const seenBy = (twin: { ref: string }[]) => twin.find(c => c.ref === 'token-1');
  expect(seenBy(s.service.get(s.room.slug, 'g', s.users[1]).state.seats[0].twin)).toMatchObject({ name: 'Sheep Token', token: { def: 0 } });
  const spectator = projectRemoteSpectator(s.service.snapshot(s.room.slug, 'g'));
  expect(seenBy(spectator.state.seats[0].twin)).toMatchObject({ name: 'Sheep Token', zone: 'monster', slot: 2, position: 'defense', token: { atk: 0, def: 0 } });
  expect(spectator.events.at(-1)?.action).toMatchObject({ type: 'twin.place', card: { ref: 'token-1', name: 'Sheep Token', token: { atk: 0 } } });

  // Rules: not by the camera, not twice in one cell, not face-down, not outside the Monster Zones.
  expect(() => s.act({ type: 'twin.place', seat: 0, zone: 'monster', source: 'auto', card: { ...token, ref: 'token-auto', slot: 3 } })).toThrow();
  expect(() => s.act({ type: 'twin.place', seat: 0, zone: 'monster', card: { ...token, ref: 'token-2' } })).toThrow(/occupied/i);
  expect(() => s.act({ type: 'twin.place', seat: 0, zone: 'spell-trap', card: { ...token, ref: 'token-2', slot: 3 } })).toThrow();

  // A card on the token's cell is refused, by the camera or by hand: the token stays until its owner removes it. Never an Extra Monster Zone.
  const real = { ref: 'real-1', name: 'Tribute Monster', slot: 2, faceUp: true, position: 'attack' };
  expect(() => s.act({ type: 'twin.place', seat: 0, zone: 'monster', source: 'auto', card: real })).toThrow(/occupied/i);
  expect(() => s.act({ type: 'twin.place', seat: 0, zone: 'monster', card: real })).toThrow(/occupied/i);
  expect(() => s.act({ type: 'twin.place', seat: 0, zone: 'extra-monster', card: { ...token, ref: 'token-emz', slot: 1 } })).toThrow();
  expect(() => s.act({ type: 'twin.place', seat: 0, zone: 'monster', card: { ...token, ref: 'token-6', slot: 6 } })).toThrow();
  expect(() => s.act({ type: 'twin.move', seat: 0, zone: 'extra-monster', cardRef: 'token-1', slot: 1 })).toThrow();
  expect(mine()).toMatchObject({ zone: 'monster', slot: 2 });
  expect(s.room.state.seats[0].twin.some(c => c.ref === 'real-1')).toBe(false);

  // The camera never moves or removes it: an Auto-detect departure changes nothing.
  s.act({ type: 'twin.move', seat: 0, zone: 'hand', cardRef: 'token-1', source: 'auto' });
  s.act({ type: 'twin.flip', seat: 0, cardRef: 'token-1', faceUp: false, source: 'auto' });
  expect(mine()).toMatchObject({ zone: 'monster', slot: 2, faceUp: true });

  // Move and change position by hand.
  s.act({ type: 'twin.move', seat: 0, zone: 'monster', cardRef: 'token-1', slot: 4, position: 'attack' });
  expect(mine()).toMatchObject({ zone: 'monster', slot: 4, position: 'attack' });
  s.act({ type: 'twin.flip', seat: 0, cardRef: 'token-1', faceUp: true, position: 'defense' });
  expect(mine()).toMatchObject({ slot: 4, position: 'defense' });
  expect(() => s.act({ type: 'twin.flip', seat: 0, cardRef: 'token-1', faceUp: false })).toThrow();

  // Remove, and leaving the field: both make it disappear. Undo brings it back.
  s.act({ type: 'twin.remove', seat: 0, cardRef: 'token-1' });
  expect(mine()).toBeUndefined();
  s.act({ type: 'undo', targetActionId: s.room.state.undo!.actionId });
  expect(mine()).toMatchObject({ slot: 4 });
  s.act({ type: 'twin.move', seat: 0, zone: 'graveyard', cardRef: 'token-1' });
  expect(mine()).toBeUndefined();
  expect(s.room.state.seats[0].twin.some(c => c.zone === 'graveyard')).toBe(false);
  expect(seenBy(projectRemoteSpectator(s.service.snapshot(s.room.slug, 'g')).state.seats[0].twin)).toBeUndefined();

  // The player's own Remove frees the cell, and the card lands there.
  s.act({ type: 'twin.place', seat: 0, zone: 'monster', card: { ...token, slot: 2 } });
  s.act({ type: 'twin.remove', seat: 0, cardRef: 'token-1' });
  s.act({ type: 'twin.place', seat: 0, zone: 'monster', source: 'auto', card: real });
  expect(s.room.state.seats[0].twin.find(c => c.ref === 'real-1')).toMatchObject({ zone: 'monster', slot: 2 });
  // Two actions, so the placement's Undo comes first and the removal's second: both undone restore the token.
  s.act({ type: 'undo', targetActionId: s.room.state.undo!.actionId });
  expect(s.room.state.seats[0].twin.some(c => c.ref === 'real-1')).toBe(false);
  s.act({ type: 'undo', targetActionId: s.room.state.undo!.actionId });
  expect(mine()).toMatchObject({ zone: 'monster', slot: 2 });
});

describe("remote match history and replay", () => {
  function endedTable(privateAnnotations = false) {
    const s = deckSession("normal", false);
    const [a, b, outsider] = s.users, slug = s.room.slug;
    s.select(s.save().id);
    s.service.configure(slug, "g", a, { bestOf: 1 }, 2001);
    s.service.join(slug, "g", b, "Bea", undefined, 2001);
    s.service.selectDeck(slug, "g", b, { savedDeckId: s.save(undefined, [], b).id }, 2001);
    s.service.ready(slug, "g", b, true, 2002); s.service.ready(slug, "g", a, true, 2002);
    s.service.start(slug, "g", a, 2003);
    const send = (user: number, action: Record<string, unknown>, at: number) => s.service.act(slug, "g", user, { baseSeq: s.service.get(slug, "g", user).lastSeq,
      action: remoteActionSchema.parse({ idempotencyKey: "hist-" + at, ...action }) }, at);
    if (privateAnnotations) {
      send(a, {type:"twin.place",actorSeat:0,seat:0,zone:"monster",card:{ref:"token",name:"Private token label",slot:1,token:{atk:0,def:0}}},2050);
      send(a, {type:"lp.change",actorSeat:0,seat:0,delta:-100,reason:"Private LP note"},2060);
    }
    send(a, { type: "log.note", actorSeat: 0, text: "Good luck" }, 2100);
    send(b, { type: "player.concede", actorSeat: 1 }, 2200);
    return { ...s, a, b, outsider, slug };
  }

  it("lists an ended table in the history of its players and rebuilds its final board", async () => {
    const s = endedTable();
    const mine = s.service.listHistory("g", s.a);
    expect(mine.items).toHaveLength(1);
    expect(mine.items[0]).toMatchObject({ remote: true, slug: s.slug, tableType: "1v1", mySeat: 0, winnerSeat: 0,
      seats: [{ displayName: "Sulman", result: "win" }, { displayName: "Bea", result: "loss" }] });
    expect(s.service.listHistory("g", s.b).items[0]).toMatchObject({ mySeat: 1 });
    // Another guild sees nothing, and a private table is not in a member's All list.
    expect(s.service.listHistory("h", s.a).items).toHaveLength(0);
    expect(s.service.listHistory("g", s.outsider, { scope: "all" }).items).toHaveLength(0);
    expect(s.service.listHistory("g", s.a, { format: "ffa3" }).items).toHaveLength(0);

    for (const user of [s.a, s.b]) {
      const replay = await s.service.replayFramesAsync(s.slug, "g", user);
      expect(s.service.replayFrames(s.slug, "g", user)).toBe(replay);
      expect(replay.viewer).toBe("player");
      const last = replay.steps.reduce((view, step) => applyPatch(view, step.ops), replay.initial);
      const live = s.service.get(s.slug, "g", user).state;
      expect(last).toEqual({ ...live, undo: null, undoHistory: [] });
      expect(last.ended).toBe(true);
      expect(replay.steps.map(step => step.seq)).toEqual(replay.steps.map((_, i) => i + 1));
    }
    expect(() => s.service.replayFrames(s.slug, "g", s.outsider)).toThrow(/not found/);
    expect(() => s.service.replayFrames(s.slug, "h", s.a)).toThrow(/not found/);
    // A public table shows to other members as a spectator replay.
    s.db.prepare("update remote_tables set visibility='public' where slug=?").run(s.slug);
    expect(s.service.listHistory("g", s.outsider, { scope: "all" }).items.map(item => item.slug)).toEqual([s.slug]);
    expect(s.service.replayFrames(s.slug, "g", s.outsider).viewer).toBe("spectator");
  });

  it.each([
    [3, null, 0, null], // A cut-off Bo3 has a game winner, but no match winner.
    [3, 1, 0, 1],
    [1, null, 0, 0],
    [null, null, 0, 0], // Legacy Bo1 rows have no match bestOf.
  ])("filters completed history consistently with its winner (Bo%s, match %s, game %s)", (bestOf, matchWinner, gameWinner, expected) => {
    const s = endedTable();
    s.db.prepare(`update remote_tables set state_json=json_set(state_json,
      '$.match.bestOf',?,'$.match.winnerSeat',?,'$.winnerSeat',?) where slug=?`)
      .run(bestOf, matchWinner, gameWinner, s.slug);
    expect(s.service.listHistory("g", s.a).items[0].winnerSeat).toBe(expected);
    const completed = s.service.listHistory("g", s.a, { completed: true, limit: 1 });
    expect(completed.items.map(item => item.winnerSeat)).toEqual(expected === null ? [] : [expected]);
    expect(completed.nextCursor).toBeNull();
  });

  it("keeps the opponent's history and replay with Deleted player after account deletion", async () => {
    const s = endedTable(true);
    const one = seedIdentity(s.db, { userId: s.a }), two = seedIdentity(s.db, { userId: s.b });
    const tournament = Number(s.db.prepare(`insert into tournaments(guild_id,name,format,status,created_by_user_id)
      values('g','Cup','round_robin','active',?)`).run(s.b).lastInsertRowid);
    const match = Number(s.db.prepare(`insert into tournament_matches(tournament_id,player_one_id,player_two_id,round_number,status)
      values(?,?,?,1,'complete')`).run(tournament, one.playerId, two.playerId).lastInsertRowid);
    const tableId = (s.db.prepare("select id from remote_tables where slug=?").get(s.slug) as {id:number}).id;
    s.db.prepare("update remote_tables set tournament_match_id=? where id=?").run(match, tableId);
    s.db.prepare(`insert into tournament_remote_matches(tournament_match_id,table_id,table_slug,player_one_id,player_two_id,
      status,player_one_choice,player_one_note,organizer_user_id,organizer_note,created_at,updated_at)
      values(?,?,?,?,?,'disputed','dispute','Private dispute',?,'Private decision',1000,1000)`)
      .run(match, tableId, s.slug, one.playerId, two.playerId, s.a);
    const { captureRemoteTournamentEvidence } = await import("../../src/services/tournament-remote-evidence.js");
    captureRemoteTournamentEvidence(s.db, tableId, 2300);
    const evidence = () => s.db.prepare("select * from tournament_remote_evidence where tournament_match_id=?").get(match) as
      { player_one_user_id:number|null; players_json:string; result_events_json:string; reports_json:string; games_json:string; public_board_json:string };
    const facts = evidence();
    // Cache the replay before deletion too: a later read must not return copied identity or notes.
    const before = s.service.replayFrames(s.slug, "g", s.b);
    const finalBoard = before.steps.reduce((view, step) => applyPatch(view, step.ops), before.initial);
    finalBoard.seats[0].twin.find(card=>card.ref === "token")!.name = "Token";

    s.db.exec(`create table remote_phone_pairs(id text,slug text,user_id integer);
      create table remote_phone_modes(slug text,user_id integer);
      create table remote_phone_attempts(bucket text,slug text,started_at integer);
      create table remote_vision_ai_limits(user_id integer);`);
    s.db.prepare("insert into remote_phone_pairs values('secret-pair',?,?)").run(s.slug, s.a);
    s.db.prepare("insert into remote_phone_modes values(?,?)").run(s.slug, s.a);
    s.db.prepare("insert into remote_phone_attempts values('hashed-ip',?,1000)").run(s.slug);
    s.db.prepare("insert into remote_vision_ai_limits values(?)").run(s.a);

    deleteUserAccount(s.db, s.a);

    expect(s.service.listHistory("g", s.b).items[0]).toMatchObject({ slug:s.slug, mySeat:1,
      seats:[{displayName:"Deleted player",bot:false},{displayName:"Bea"}] });
    vi.stubEnv("OWNER_USER_IDS",String(s.outsider));
    try {
      expect(s.service.listHistory("g",s.outsider,{scope:"all"}).items[0].seats[0].displayName).toBe("Deleted player");
      expect(s.service.replayFrames(s.slug,"g",s.outsider).table.seats[0].displayName).toBe("Deleted player");
    } finally { vi.unstubAllEnvs(); }
    expect(s.service.get(s.slug, "g", s.b)).toMatchObject({ createdBy:null,
      seats:[{userId:null,displayName:"Deleted player",bot:false},{userId:s.b}] });
    const replay = s.service.replayFrames(s.slug, "g", s.b);
    expect(replay.table.seats[0]).toMatchObject({userId:null,displayName:"Deleted player"});
    expect(replay.steps.reduce((view, step) => applyPatch(view, step.ops), replay.initial)).toEqual(finalBoard);
    expect(JSON.stringify(replay)).not.toMatch(/Sulman|Good luck|Private/);
    expect(JSON.stringify(s.db.prepare("select json from remote_values").all())).not.toContain("Private");
    expect(s.db.prepare("select count(*) n from remote_events where user_id=?").get(s.a)).toEqual({n:0});
    expect(s.db.prepare("select bucket from remote_phone_attempts").all()).toEqual([{bucket:"hashed-ip"}]);
    for (const table of ["remote_phone_pairs","remote_phone_modes","remote_vision_ai_limits"])
      expect(s.db.prepare(`select count(*) n from ${table}`).get()).toEqual({n:0});
    expect(evidence()).toMatchObject({player_one_user_id:null,games_json:facts.games_json});
    expect(JSON.stringify(evidence())).not.toContain("Private");
    expect(JSON.parse(evidence().players_json)[0]).toEqual({userId:null,seat:0});
    expect(JSON.parse(evidence().reports_json)[0]).toMatchObject({userId:null,note:null,choice:"dispute"});
    expect(JSON.parse(evidence().result_events_json).every((e:{userId:number|null})=>e.userId!==s.a)).toBe(true);
    expect(s.db.prepare("select organizer_user_id,organizer_note,player_one_note from tournament_remote_matches").get())
      .toEqual({organizer_user_id:null,organizer_note:null,player_one_note:null});
    expect(deleteUserAccount(s.db, s.a).counts).toEqual({});
    // Once the last human deletes their account the room may be collected.
    deleteUserAccount(s.db, s.b);
    expect(s.db.prepare("select id from remote_tables where slug=?").get(s.slug)).toBeUndefined();
    expect(s.db.pragma("foreign_key_check")).toEqual([]);
  });

  it("shares concurrent cold replay rebuilds across services after checking access", async () => {
    const s = endedTable();
    // Force a yield on every step so both requests overlap even on fast machines.
    let tick = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => tick += 10);
    try {
      const first = s.service.replayFramesAsync(s.slug, "g", s.a);
      const other = createRemoteDuelService(s.db);
      await expect(other.replayFramesAsync(s.slug, "g", s.outsider)).rejects.toThrow(/not found/);
      const second = other.replayFramesAsync(s.slug, "g", s.a);
      const [a, b] = await Promise.all([first, second]);
      expect(b).toBe(a);
      expect(await other.replayFramesAsync(s.slug, "g", s.b)).not.toBe(a);
    } finally { clock.mockRestore(); }
  });

  it("migrates an ordered index used by the Remote history query", () => {
    const s = endedTable();
    s.db.exec("drop index if exists remote_tables_history_idx");
    migrate(s.db); migrate(s.db);
    const prepare = vi.spyOn(s.db, "prepare");
    s.service.listHistory("g", s.a, { completed: true, limit: 1 });
    const sql = prepare.mock.calls.find(([sql]) => sql.includes("as history_time"))![0];
    prepare.mockRestore();
    const plan = s.db.prepare(`explain query plan ${sql}`).all({ guild: "g", viewer: s.a, limit: 2 }) as { detail: string }[];
    expect(plan.some(row => row.detail.includes("USING INDEX remote_tables_history_idx"))).toBe(true);
    expect(plan.some(row => row.detail.includes("TEMP B-TREE"))).toBe(false);
  });

  it("keeps reading Remote rows on later pages when they are all older than the online page", () => {
    const s = endedTable();
    const remote = s.service.listHistory("g", s.a).items[0]!;
    const online = (id: number, endedAt: string) => ({ id, endedAt, createdAt: endedAt,
      cursor: Buffer.from(JSON.stringify({ v: 1, time: Date.parse(endedAt) / 86_400_000 + 2440587.5, id })).toString("base64url") }) as never;
    // Page 1 holds online rows newer than the Remote table and online has more; page 2 is the last online page.
    const first = { duels: [online(1, "2999-01-02T00:00:00.000Z"), online(2, "2999-01-01T00:00:00.000Z")], nextCursor: "o2", canSeeAll: false };
    const last = { duels: [online(3, "1999-01-01T00:00:00.000Z")], nextCursor: null, canSeeAll: false };
    const page1 = mergeHistory({ cursor: undefined, online: () => first, remote: cursor => s.service.listHistory("g", s.a, { cursor }) });
    expect(page1.duels).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = mergeHistory({ cursor: page1.nextCursor, online: cursor => (expect(cursor).toBe("o2"), last), remote: cursor => s.service.listHistory("g", s.a, { cursor }) });
    expect(page2.duels.map(item => ("remote" in item ? item.slug : item.id))).toEqual([3, remote.slug]);
    expect(page2.nextCursor).toBeNull();
  });
});


describe("account deletion in live remote rooms", () => {
  it.each([false,true])("removes a ready lobby guest and registration (creator deletes: %s)", creator => {
    const {db,service,users}=setup();
    const table=service.create({guildId:"g",userId:users[0],displayName:"Owner",gameId:"ygo",seatCount:2},1000);
    service.join(table.slug,"g",users[1],"Guest",1,1001);
    registerTestDeck(db,service,table.slug,users[1],1002);
    service.ready(table.slug,"g",users[0],true,1003);
    service.ready(table.slug,"g",users[1],true,1004);
    const deleted=users[creator ? 0 : 1], keeper=users[creator ? 1 : 0];
    deleteUserAccount(db,deleted);
    const room=service.get(table.slug,"g",keeper);
    if (creator) {
      expect(room).toMatchObject({status:"ended",endReason:"creator-left",createdBy:null});
      expect(room.events.at(-1)).toMatchObject({userId:null,actorSeat:0,action:{type:"table.ended",reason:"creator-left"}});
      expect(()=>service.join(table.slug,"g",users[2],"Third")).toThrow(/ended/);
    } else {
      expect(room.status).toBe("lobby");
      expect(room.seats.map(seat=>seat.userId)).toEqual([keeper]);
      expect(room.state.deckChecks.registrations[1]).toBeUndefined();
      expect(room.events.at(-1)).toMatchObject({userId:null,actorSeat:1,action:{type:"seat.left",seat:1,userId:null}});
      expect(()=>service.start(table.slug,"g",keeper)).toThrow(/all seats must be filled/i);
      const replacement=service.join(table.slug,"g",users[2],"Third");
      expect(replacement.seats.find(seat=>seat.userId===users[2])).toMatchObject({seat:1,ready:false});
    }
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });

  it.each([[2,"duel"],[2,"siding"]] as const)("a quit during a Bo3 game loses only that game; a quit in siding (%i seats, game lost by %s) ends the match and prevents further actions", (seatCount,phase) => {
    const {db,service,users}=setup();
    let room=service.create({guildId:"g",userId:users[0],displayName:"Owner",gameId:"ygo",seatCount},1000);
    for(let seat=1;seat<seatCount;seat++) service.join(room.slug,"g",users[seat],"Guest",seat,1001);
    for(let seat=0;seat<seatCount;seat++) service.ready(room.slug,"g",users[seat],true,1002);
    room=service.start(room.slug,"g",users[0],1003);
    if (phase === "siding") {
      room=service.act(room.slug,"g",users[1],{baseSeq:room.lastSeq,action:{type:"player.concede",actorSeat:1,idempotencyKey:"first-game"}},1004);
      room=service.act(room.slug,"g",users[1],{baseSeq:room.lastSeq,action:{type:"match.continue",actorSeat:1,idempotencyKey:"enter-siding"}},1005);
      expect(room).toMatchObject({status:"active",state:{match:{phase:"siding"}}});
    }
    deleteUserAccount(db,users[1]);
    room=service.get(room.slug,"g",users[0]);
    expect(room).toMatchObject({status:"ended",endReason:"account-deleted"});
    expect(service.listHistory("g",users[0]).items.find(item=>item.slug===room.slug)).toMatchObject({winnerSeat:null,seats:[{result:null},{result:null}]});
    expect(service.listHistory("g",users[0],{completed:true}).items).toEqual([]);
    expect(room.events.at(-1)).toMatchObject({userId:null,actorSeat:1,action:{type:"table.ended",reason:"account-deleted"}});
    expect(()=>service.act(room.slug,"g",users[0],{baseSeq:room.lastSeq,action:{type:"log.note",actorSeat:0,text:"hello",idempotencyKey:"after-delete"}})).toThrow(/not active/);
    expect(service.replayFrames(room.slug,"g",users[0]).steps).toHaveLength(room.lastSeq);

    // Quitting between games forfeits the match: the opponent wins, the table ends as a forfeit, and nothing can undo it.
    const quit=service.create({guildId:"g",userId:users[0],displayName:"Owner",gameId:"ygo",seatCount,bestOf:3},3000);
    service.join(quit.slug,"g",users[2],"Guest",1,3001);
    for(let seat=0;seat<seatCount;seat++) service.ready(quit.slug,"g",(seat?users[2]:users[0]),true,3002);
    let table=service.start(quit.slug,"g",users[0],3003);
    const step=(seat:number,action:Record<string,unknown>,at:number)=>table=service.act(table.slug,"g",(seat?users[2]:users[0]),{baseSeq:table.lastSeq,action:remoteActionSchema.parse({actorSeat:seat,idempotencyKey:`quit-${at}`,...action})},at);
    // Game 1 is lost by a surrender or by a quit during the game: both end only that game, and the match goes on to side decking.
    step(1,{type:phase==="duel"?"player.leave":"player.concede"},3004);
    expect(table).toMatchObject({status:"active",state:{match:{phase:"result",games:[{winnerSeat:0,reason:"concede"}]}}});
    expect(table.state.seats[1].accountDeleted).toBeFalsy();
    step(1,{type:"match.continue"},3005);
    expect(table.state.match.phase).toBe("siding");
    step(0,{type:"side.ready",seat:0},3006); step(1,{type:"side.ready",seat:1},3007);
    // All ready: the next game starts after 5 seconds. An un-ready cancels it, a new ready restarts it.
    expect(table.state.match.siding).toMatchObject({ready:[0,1],startAt:8007});
    step(1,{type:"side.unready",seat:1},3008);
    expect(table.state.match.siding!.startAt).toBeUndefined();
    step(1,{type:"side.ready",seat:1},3009);
    expect(table.state.match.siding).toMatchObject({startAt:8009});
    step(1,{type:"player.leave"},3010);
    expect(table).toMatchObject({status:"ended",endReason:"forfeit",state:{ended:true,winnerSeat:0,match:{phase:"done",winnerSeat:0}}});
    expect(table.state.seats[1]).toMatchObject({eliminated:true,accountDeleted:true});
    expect(table.state.undo ?? null).toBeNull();
    expect(()=>step(0,{type:"undo",targetActionId:table.events.at(-1)!.id},3011)).toThrow(/not active/);
    expect(service.replay(table.slug,"g",users[0])).toEqual(table.state);

    // A table that nobody swept yet closes the moment a move arrives, and the player gets the ended table instead of a refused move.
    const idle=service.create({guildId:"g",userId:users[0],displayName:"Owner",gameId:"ygo",seatCount,bestOf:3},4000);
    service.join(idle.slug,"g",users[2],"Guest",1,4001);
    for(let seat=0;seat<seatCount;seat++) service.ready(idle.slug,"g",(seat?users[2]:users[0]),true,4002);
    let late=service.start(idle.slug,"g",users[0],4003);
    const note=(at:number)=>late=service.act(late.slug,"g",users[0],{baseSeq:late.lastSeq,action:{type:"log.note",actorSeat:0,text:"hi",idempotencyKey:`late-${at}`}},at);
    db.prepare("update remote_tables set last_event_at=1 where slug=?").run(late.slug);
    expect(note(5000).status).toBe("active");
    note(4003+601_000);
    expect(late).toMatchObject({status:"ended",endReason:"idle"});
  });

  it("a quit in an FFA Bo3 game ends only that seat: the match goes on, and the seat that left cannot touch the match flow", () => {
    const {service,users}=setup();
    let room=service.create({guildId:"g",userId:users[0],displayName:"Owner",gameId:"ygo",seatCount:3,bestOf:3},1000);
    for(let seat=1;seat<3;seat++) service.join(room.slug,"g",users[seat],"Guest",seat,1001);
    for(let seat=0;seat<3;seat++) service.ready(room.slug,"g",users[seat],true,1002);
    room=service.start(room.slug,"g",users[0],1003);
    const act=(seat:number,action:Record<string,unknown>)=>room=service.act(room.slug,"g",users[seat],{baseSeq:room.lastSeq,action:remoteActionSchema.parse({actorSeat:seat,idempotencyKey:`ffa-quit-${room.lastSeq}-${seat}`,...action})},2000+room.lastSeq);
    act(0,{type:"lp.change",seat:2,delta:-8000,reason:"damage"});
    expect(room.state.seats[2].eliminated).toBe(true);
    // Seat 2 is out of the game by Life Points and seat 1 quits during the game: it only concedes the game. Seat 0 wins game 1.
    act(1,{type:"player.leave"});
    expect(room).toMatchObject({status:"active",state:{match:{phase:"result",games:[{winnerSeat:0}]}}});
    expect(room.state.seats[1].accountDeleted).toBeFalsy();
    // Between games the same seat leaves the match for good, and then it cannot touch the match flow.
    act(1,{type:"player.leave"});
    expect(room.state.seats[1].accountDeleted).toBe(true);
    for(const action of [{type:"match.continue"},{type:"side.ready",seat:1}]) expect(()=>act(1,action)).toThrow(/left this match/);
    // A quit does not wait for another action in flight: the stale sequence is not a reason to refuse it.
    expect(()=>service.act(room.slug,"g",users[2],{baseSeq:room.lastSeq-1,action:remoteActionSchema.parse({type:"player.leave",actorSeat:2,idempotencyKey:"ffa-quit-stale"})},9000)).not.toThrow();
    expect(room).toBeDefined();
  });

  it.each([[3,1,"duel"],[4,1,"duel"],[3,3,"duel"],[4,3,"duel"],[3,3,"result"],[4,3,"siding"]] as const)("concedes only the deleted FFA seat until one player remains (%i seats, Bo%i, %s)", (seatCount,bestOf,phase) => {
    const clock=vi.spyOn(Date,"now").mockReturnValue(2000);
    try {
      const {db,service,users}=setup();
      let room=service.create({guildId:"g",userId:users[0],displayName:"Owner",gameId:"ygo",seatCount,bestOf},1000);
      for(let seat=1;seat<seatCount;seat++) service.join(room.slug,"g",users[seat],"Guest",seat,1001);
      for(let seat=0;seat<seatCount;seat++) service.ready(room.slug,"g",users[seat],true,1002);
      room=service.start(room.slug,"g",users[0],1003);
      const keeper=users[seatCount-1];
      const act = (actorSeat:number, action:Record<string,unknown>) => room=service.act(room.slug,"g",users[actorSeat],{baseSeq:room.lastSeq,
        action:remoteActionSchema.parse({actorSeat,idempotencyKey:`ffa-${room.lastSeq}`, ...action})},Math.max(1004+room.lastSeq,room.state.updatedAt));
      if(phase!=="duel") {
        for(let seat=1;seat<seatCount;seat++) act(seat,{type:"player.concede"});
        if(phase==="siding") act(1,{type:"match.continue"});
      }
      const undoDamage=seatCount===3 && bestOf===1;
      if(undoDamage) act(seatCount-1,{type:"lp.change",seat:0,delta:-8000,reason:"damage"});
      const damageId=room.events.at(-1)!.id;
      for(let seat=0;seat<seatCount-1;seat++) {
        deleteUserAccount(db,users[seat]);
        room=service.get(room.slug,"g",keeper);
        expect(room.state.seats[seat].eliminated).toBe(true);
        expect(room.seats[seat]).toMatchObject({userId:null,displayName:"Deleted player"});
        expect(room.events.at(-1)).toMatchObject({userId:null,actorSeat:seat,action:{type:"player.concede",actorSeat:seat}});
        if(seat===0 && undoDamage) {
          act(seatCount-1,{type:"undo",targetActionId:damageId});
          expect(room.state.seats[0].eliminated).toBe(true);
        }
        if(seat===0 && phase!=="duel") {
          if(phase==="result") act(1,{type:"match.continue"});
          for(let readySeat=1;readySeat<seatCount;readySeat++) act(readySeat,{type:"side.ready",seat:readySeat});
          act(1,{type:"match.first",seatGoesFirst:1});
          // Everyone left is ready: the next game starts when the countdown ends.
          const startAt=room.state.match.siding!.startAt!; service.sweepIdle(startAt); clock.mockReturnValue(startAt); room=service.get(room.slug,"g",keeper);
          expect(room.state.match.phase).toBe("duel");
          expect(room.state.seats[0].eliminated).toBe(true);
        }
        if(seat<seatCount-2) {
          expect(room).toMatchObject({status:"active",state:{ended:false,winnerSeat:null}});
          room=service.act(room.slug,"g",keeper,{baseSeq:room.lastSeq,action:{type:"log.note",actorSeat:seatCount-1,text:"Still playing",idempotencyKey:`after-delete-${seat}`}});
        }
      }
      expect(room).toMatchObject({status:"ended",state:{ended:true,winnerSeat:seatCount-1,match:{phase:"done",winnerSeat:seatCount-1}}});
      expect(service.replay(room.slug,"g",keeper)).toMatchObject({ended:true,winnerSeat:seatCount-1});
      expect(service.listHistory("g",keeper).items.find(item=>item.slug===room.slug)?.winnerSeat).toBe(seatCount-1);
      expect(db.pragma("foreign_key_check")).toEqual([]);
    } finally {clock.mockRestore();}
  });

  it.each(["lobby","active"] as const)("captures and anonymizes tournament evidence when a %s player deletes", async status => {
    const s=await tournamentResultSession();
    try {
      let slug=s.room.slug;
      if (status === "lobby") {
        s.db.prepare("update remote_tables set status='ended',ended_at=?,end_reason='idle' where slug=?").run(Date.now(),slug);
        const {table}=s.tables.startMatch({guildId:"g",tournamentId:s.tournament.id,tournamentMatchId:s.slot.id,actorUserId:s.two.userId});
        slug=table.slug;
        s.remote.join(slug,"g",s.one.userId,"One");
      }
      deleteUserAccount(s.db,s.two.userId);
      expect(s.remote.get(slug,"g",s.one.userId)).toMatchObject({status:"ended",endReason:status === "lobby" ? "creator-left" : "account-deleted"});
      const evidence=s.db.prepare("select players_json from tournament_remote_evidence where table_slug=?").get(slug) as {players_json:string};
      expect(JSON.parse(evidence.players_json)).toContainEqual({seat:0,userId:null});
    } finally {vi.unstubAllEnvs();}
  });

  it("preserves other players' phone rate limits and scans catalog and suspends the event guard once", () => {
    const {db,service,users,table}=setup();
    service.join(table.slug,"g",users[1],"Guest",1,1001);
    const other=service.create({guildId:"g",userId:users[0],displayName:"Owner",gameId:"ygo",seatCount:2},1002);
    service.join(other.slug,"g",users[1],"Guest",1,1003);
    db.exec("create table remote_phone_attempts(bucket text primary key,slug text,started_at integer,count integer)");
    db.prepare("insert into remote_phone_attempts values('shared',?,1000,3)").run(table.slug);
    db.exec("insert into remote_phone_attempts values('legacy',null,1000,4)");
    const buckets=db.prepare("select * from remote_phone_attempts order by bucket").all();
    const prepare=vi.spyOn(db,"prepare"), exec=vi.spyOn(db,"exec");
    try {
      deleteUserAccount(db,users[0]);
      expect(db.prepare("select * from remote_phone_attempts order by bucket").all()).toEqual(buckets);
      expect(prepare.mock.calls.filter(([sql])=>sql==="select name from card_catalog")).toHaveLength(1);
      expect(exec.mock.calls.filter(([sql])=>/drop trigger remote_events_no_update/i.test(sql))).toHaveLength(1);
      expect(exec.mock.calls.filter(([sql])=>/create trigger.*remote_events_no_update/i.test(sql))).toHaveLength(1);
      expect(()=>db.prepare("update remote_events set user_id=null").run()).toThrow(/append.only/);
    } finally {vi.restoreAllMocks();}
  });
});

describe("remote hand activation (a card held up from the hand)", () => {
  const CARD = 73628505;
  const hold = async (s: ReturnType<typeof originSession>) => {
    const { remoteHandActivationDecision } = await import("../../src/remote/index.js");
    const decision = remoteHandActivationDecision(s.room.state, 0, { cardId: CARD, id: "held-1", at: 3000 });
    expect(decision).toEqual({ type: "effect.activated", actorSeat: 0, source: { cardId: CARD }, fromHand: true });
    s.act(decision as Record<string, unknown>);
    return s.room.state.undo!.actionId;
  };

  it("shows a sure read at once, keeps the card in the hand, and a discard of it counts the hand once", async () => {
    const { remoteHandActivationDecision } = await import("../../src/remote/index.js");
    const s = originSession(true), count = s.room.state.seats[0].handCount!;
    await hold(s);
    expect(s.room.events.at(-1)!.action).toMatchObject({ type: "effect.activated", fromHand: true });
    expect(s.room.state.seats[0].knownHand).toEqual([expect.objectContaining({ cardId: CARD })]);
    expect(s.room.state.seats[0].handCount).toBe(count);
    // The same card again gives nothing new; a Normal or unknown card keeps the one-tap suggestion.
    expect(remoteHandActivationDecision(s.room.state, 0, { cardId: CARD, id: "held-2", at: 3100 })).toBeUndefined();
    expect(remoteHandActivationDecision(originSession(true).room.state, 0, { cardId: CARD, id: "held-3", at: 3100 }, { activatable: false })).toMatchObject({ type: "hand.suggest" });
    s.act({ type: "twin.place", seat: 0, zone: "graveyard", card: { ref: "discarded", cardId: CARD } });
    expect(s.room.state.seats[0].handCount).toBe(count - 1);
    expect(s.room.state.seats[0].knownHand ?? []).toEqual([]);
    // A Spell played to the field leaves the known hand too: a later unread pile card must not be named after it (the web checks this).
    const spell = originSession(true);
    await hold(spell);
    spell.act({ type: "twin.place", seat: 0, zone: "spell-trap", card: { ref: "played", cardId: CARD } });
    expect(spell.room.state.seats[0].knownHand ?? []).toEqual([]);
  });

  it("undoes the activation and takes the card out of the known hand", async () => {
    const s = originSession(true), count = s.room.state.seats[0].handCount;
    const targetActionId = await hold(s);
    s.act({ type: "undo", targetActionId });
    expect(s.room.state.seats[0].knownHand ?? []).toEqual([]);
    expect(s.room.state.seats[0].handCount).toBe(count);
  });

  it("needs two agreeing sure reads of a lifted card, and gives a one-tap pick when the read is not sure", async () => {
    const vision = await import(new URL("../../../vision/src/field-watcher.ts", import.meta.url).pathname);
    const frame = { width: 640, height: 480, data: new Uint8ClampedArray(0) };
    const card = { kind: "face-up", confidence: .99, partial: false, quad: [{ x: .05, y: .03 }, { x: .12, y: .03 }, { x: .12, y: .16 }, { x: .05, y: .16 }] };
    const evidence = { motion: () => 0, sharpness: () => 100, touched: () => .03, appearance: () => [.1, .2, .3], halo: () => [] };
    const lifted = () => ({ ok: false, hard: true, text: "held: size 1.5x" });
    const run = async (tier: string, ids: string[]) => {
      const sure: Record<string, unknown>[] = [], unsure: Record<string, unknown>[] = [];
      let read = 0;
      const reader = vision.createHeldCardReader({ profile: { cardBack: { cardId: "back" } }, clone: async () => frame,
        recognizer: { recognize: async () => ({ tier, candidates: [{ cardId: ids[Math.min(read++, ids.length - 1)], score: .9 }, { cardId: "2", score: .5 }, { cardId: "3", score: .4 }, { cardId: "4", score: .3 }],
          quality: { fallback: false, faceDown: false, partial: false }, timingsMs: {} }) },
        onHeldCard: (event: Record<string, unknown>) => sure.push(event), onHeldUnsure: (event: Record<string, unknown>) => unsure.push(event) });
      for (const at of [0, 200, 450, 700, 950]) await reader.observe([card], frame, evidence, at, undefined, undefined, false, [], lifted).read;
      return { sure, unsure };
    };
    const agree = await run("sure", ["1", "1"]);
    expect(agree.sure).toEqual([expect.objectContaining({ type: "held", cardId: "1", lifted: true })]);
    const split = await run("sure", ["1", "2", "3"]);
    expect(split.sure).toEqual([]);
    expect(split.unsure).toEqual([expect.objectContaining({ type: "held-unsure", lifted: true, candidates: expect.arrayContaining([expect.objectContaining({ cardId: "3" })]) })]);
    const unsure = await run("not sure", ["1"]);
    expect(unsure.sure).toEqual([]);
    expect(unsure.unsure).toEqual([expect.objectContaining({ type: "held-unsure", lifted: true, candidates: [expect.objectContaining({ cardId: "1" }), expect.objectContaining({ cardId: "2" }), expect.objectContaining({ cardId: "3" })] })]);
  });
});
