import Database from "better-sqlite3";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { seatCountFor, type DuelDeck, type DuelFormat } from "@yugidraft/shared/duels";
import { createEngineGame } from "../src/engine.js";
import { engineDataDirectory as dataDirectory } from "./engine-data-dir.js";
import { describeWithCores, needs } from "./support/cores.js";

// Unit tests of aux.MPForEachDuelist, aux.MPKey and aux.MPForEachController (domain-core/multi-scripts/mp-utility.lua) on the real core.
// A startup script replaces the seat functions of Duel with fakes that log every call, so each exit path of a helper is seen
// without a card effect: the end of the loop, a stop, an API that is missing. The real core functions (MPNthDuelist, MPSeat,
// MPBindSeat) are proved in scripts/native/checks/f7-seats.cpp and by the scenarios of tests/scenarios/multiplayer/seats.test.ts.
const settings = { visibility: "public" as const, banlist: "none" as const, cardPool: "both" as const, turnSeconds: 240, startingLP: 8000, startingHand: 5, drawPerTurn: 1, timeout: "loss" as const, validateDeck: false, shuffleDeck: true };

function deck(): DuelDeck {
  const db = new Database(join(dataDirectory, "cards.cdb"), { readonly: true });
  try {
    const rows = db.prepare("SELECT id FROM datas WHERE type = 17 AND alias = 0 AND (ot & 3) != 0 ORDER BY id").all() as { id: number }[];
    return { main: rows.map((row) => row.id).slice(0, 40), extra: [], side: [] };
  } finally {
    db.close();
  }
}

/** Runs the Lua text as a startup script at `format`. Returns "" when it ends, else the Lua error message. */
async function run(format: DuelFormat, lua: string): Promise<string> {
  try {
    const game = await createEngineGame({
      mode: "normal",
      format,
      decks: Array.from({ length: seatCountFor(format) }, () => deck()),
      seed: ["11", "22", "33", "44"],
      dataDirectory,
      settings,
      startupScripts: [{ name: "probe.lua", content: lua }],
    });
    game.close();
    return "";
  } catch (error) {
    if (error instanceof Error && /Failed to run startup script probe\.lua/.test(error.message)) return error.message;
    throw error;
  }
}

/** A fake Duel.MPNthDuelist over `seats` (the living duelists in order). It logs "n<i>" and keeps the rebind state in REBOUND. */
const FAKE_NTH = (seats: number[]) => `
LOG={}
REBOUND=false
local seats={${seats.join(",")}}
Duel.MPNthDuelist=function(i)
	LOG[#LOG+1]='n'..i
	if i==0 then REBOUND=false return true end
	if seats[i] then REBOUND=true return true,seats[i] end
	return false
end
`;
const EXPECT_LOG = (want: string) => `
local got=table.concat(LOG,' ')
if got~='${want}' then error('LOG '..got..' want ${want}') end
`;

describeWithCores("seat helpers of mp-utility.lua", [needs.scripts(dataDirectory), needs.cards(dataDirectory), needs.installedMulti(dataDirectory)], () => {
  it("defines the helpers at 3 and 4 seats and in Tag", async () => {
    for (const format of ["ffa3", "ffa4", "tag"] as DuelFormat[]) {
      expect(await run(format, "assert(aux.MPForEachDuelist and aux.MPKey and aux.MPForEachController and aux.MPAllDuelists and aux.MPAnyDuelist and aux.MPKeyOfSeat)")).toBe("");
    }
  });

  describe("MPForEachDuelist", () => {
    it("runs fn(0,seat) for every living duelist in order, then gives the scope back once (FFA)", async () => {
      const lua = `${FAKE_NTH([0, 1, 2])}
local calls={}
aux.MPForEachDuelist(function(tp,seat) calls[#calls+1]=tp..':'..seat LOG[#LOG+1]='f'..seat end)
if table.concat(calls,',')~='0:0,0:1,0:2' then error('calls '..table.concat(calls,',')) end
if REBOUND then error('scope not given back') end
${EXPECT_LOG("n1 f0 n2 f1 n3 f2 n4 n0")}`;
      expect(await run("ffa3", lua)).toBe("");
    });

    it("skips a duelist that the core leaves out (a defeated seat)", async () => {
      const lua = `${FAKE_NTH([0, 2, 3])}
aux.MPForEachDuelist(function(tp,seat) LOG[#LOG+1]='f'..seat end)
${EXPECT_LOG("n1 f0 n2 f2 n3 f3 n4 n0")}`;
      expect(await run("ffa4", lua)).toBe("");
    });

    it("Tag: tp_i is the team of the seat and the partner is a duelist of its own", async () => {
      const lua = `${FAKE_NTH([1, 2, 3, 0])}
local calls={}
aux.MPForEachDuelist(function(tp,seat) calls[#calls+1]=tp..':'..seat end)
if table.concat(calls,',')~='1:1,0:2,1:3,0:0' then error('calls '..table.concat(calls,',')) end
if REBOUND then error('scope not given back') end`;
      expect(await run("tag", lua)).toBe("");
    });

    it("gives the scope back when fn stops the loop", async () => {
      const lua = `${FAKE_NTH([0, 1, 2])}
aux.MPForEachDuelist(function(tp,seat) LOG[#LOG+1]='f'..seat return seat==1 end)
if REBOUND then error('scope not given back') end
${EXPECT_LOG("n1 f0 n2 f1 n0")}`;
      expect(await run("ffa3", lua)).toBe("");
    });

    it("gives the scope back when the first call stops, and when no duelist is left", async () => {
      const lua = `${FAKE_NTH([0, 1, 2])}
aux.MPForEachDuelist(function() return true end)
if REBOUND then error('scope not given back') end
${EXPECT_LOG("n1 n0")}
${FAKE_NTH([])}
aux.MPForEachDuelist(function() error('no duelist') end)
${EXPECT_LOG("n1 n0")}`;
      expect(await run("ffa3", lua)).toBe("");
    });

    it("keeps the rebind for a later step of fn that waits for a prompt (the helper does not touch it before the end)", async () => {
      const lua = `${FAKE_NTH([0, 1, 2])}
aux.MPForEachDuelist(function(tp,seat) if not REBOUND then error('no rebind inside fn') end end)`;
      expect(await run("ffa3", lua)).toBe("");
    });

    it("answers the stock way when the core has no Duel.MPNthDuelist: fn(0,0), then fn(1,1)", async () => {
      const lua = `Duel.MPNthDuelist=nil
local calls={}
aux.MPForEachDuelist(function(tp,seat) calls[#calls+1]=tp..':'..seat end)
if table.concat(calls,',')~='0:0,1:1' then error('calls '..table.concat(calls,',')) end
local n=0
aux.MPForEachDuelist(function() n=n+1 return true end)
if n~=1 then error('stop ignored: '..n) end`;
      expect(await run("ffa3", lua)).toBe("");
    });

    it("answers the stock way at two seats when the mode is 0 (a fake Duel.MPMode)", async () => {
      const lua = `${FAKE_NTH([0, 1])}
Duel.MPMode=function() return 0 end
local calls={}
aux.MPForEachDuelist(function(tp,seat) calls[#calls+1]=tp..':'..seat end)
if table.concat(calls,',')~='0:0,1:1' then error('calls '..table.concat(calls,',')) end
${EXPECT_LOG("")}`;
      expect(await run("ffa3", lua)).toBe("");
    });
  });

  describe("MPAllDuelists and MPAnyDuelist", () => {
    it("All is true when fn is true for every living duelist, and stops at the first false (scope given back)", async () => {
      const lua = `${FAKE_NTH([0, 1, 2])}
if not aux.MPAllDuelists(function(tp,seat) LOG[#LOG+1]='a'..seat return true end) then error('all true') end
${EXPECT_LOG("n1 a0 n2 a1 n3 a2 n4 n0")}
LOG={}
if aux.MPAllDuelists(function(tp,seat) LOG[#LOG+1]='b'..seat return seat~=1 end) then error('all false') end
if REBOUND then error('scope not given back') end
${EXPECT_LOG("n1 b0 n2 b1 n0")}`;
      expect(await run("ffa3", lua)).toBe("");
    });

    it("Any is true when fn is true for one living duelist, stops there, and is false for no duelist", async () => {
      const lua = `${FAKE_NTH([0, 1, 2])}
if not aux.MPAnyDuelist(function(tp,seat) LOG[#LOG+1]='a'..seat return seat==1 end) then error('any true') end
if REBOUND then error('scope not given back') end
${EXPECT_LOG("n1 a0 n2 a1 n0")}
if aux.MPAnyDuelist(function() return false end) then error('any false') end`;
      expect(await run("ffa3", lua)).toBe("");
      expect(await run("ffa3", `${FAKE_NTH([])}
if aux.MPAnyDuelist(function() return true end) then error('any with no duelist') end
if not aux.MPAllDuelists(function() return false end) then error('all with no duelist') end`)).toBe("");
    });
  });

  describe("MPAnyOpponent", () => {
    it("FFA: skips the duelist that runs the effect, asks every other living duelist, stops at the first true (scope given back)", async () => {
      const lua = `${FAKE_NTH([0, 1, 2])}
Duel.MPSeat=function(p) return p end
if not aux.MPAnyOpponent(1,function(tp,seat) LOG[#LOG+1]='a'..seat return seat==2 end) then error('opponent true') end
if REBOUND then error('scope not given back') end
${EXPECT_LOG("n1 a0 n2 n3 a2 n0")}`;
      expect(await run("ffa3", lua)).toBe("");
    });

    it("Tag: skips both duelists of the own team, asks the two duelists of the other team, and is false when none is true", async () => {
      const lua = `${FAKE_NTH([0, 1, 2, 3])}
Duel.MPSeat=function(p) return p end
if aux.MPAnyOpponent(0,function(tp,seat) LOG[#LOG+1]='a'..seat return false end) then error('opponent false') end
if REBOUND then error('scope not given back') end
${EXPECT_LOG("n1 n2 a1 n3 n4 a3 n5 n0")}`;
      expect(await run("tag", lua)).toBe("");
    });

    it("is false when no opponent is left (the other seats are defeated)", async () => {
      expect(await run("ffa3", `${FAKE_NTH([1])}
Duel.MPSeat=function(p) return p end
if aux.MPAnyOpponent(1,function() return true end) then error('no opponent') end`)).toBe("");
    });
  });

  describe("MPKeyOfSeat", () => {
    it("is the seat in FFA, and the team in Tag", async () => {
      expect(await run("ffa4", "for seat=0,3 do if aux.MPKeyOfSeat(seat)~=seat then error('ffa '..seat) end end")).toBe("");
      expect(await run("tag", "for seat=0,3 do if aux.MPKeyOfSeat(seat)~=seat%2 then error('tag '..seat) end end")).toBe("");
    });
  });

  describe("MPKey", () => {
    it("gives what Duel.MPSeat gives (the seat in FFA, the team in Tag)", async () => {
      const lua = `local asked={}
Duel.MPSeat=function(p) asked[#asked+1]=p return p+10 end
if aux.MPKey(0)~=10 or aux.MPKey(1)~=11 then error('key') end
if #asked~=2 then error('asked '..#asked) end`;
      expect(await run("ffa3", lua)).toBe("");
      expect(await run("tag", lua)).toBe("");
    });

    it("is the value itself when the core has no Duel.MPSeat, or the mode is 0", async () => {
      expect(await run("ffa3", "Duel.MPSeat=nil if aux.MPKey(1)~=1 or aux.MPKey(0)~=0 then error('key') end")).toBe("");
      expect(await run("ffa3", "Duel.MPMode=function() return 0 end Duel.MPSeat=function() return 99 end if aux.MPKey(1)~=1 then error('key') end")).toBe("");
    });
  });

  describe("MPForEachController", () => {
    // Two deck cards of each named seat (outside a scope Duel.GetFieldGroup(s,...) reads the real seat s, and c:GetControler() is the seat).
    const TWO_EACH = (seats: number[]) => `
LOG={}
local g=Group.CreateGroup()
for _,s in ipairs({${seats.join(",")}}) do
	local dg=Duel.GetFieldGroup(s,LOCATION_DECK,0)
	g:AddCard(dg:GetFirst())
	g:AddCard(dg:GetNext())
end
local BINDS={}
Duel.MPBindSeat=function(seat) LOG[#LOG+1]='b'..(seat or 'x') return seat==nil or BINDS[seat]~=false end
`;
    const EACH = "aux.MPForEachController(g,function(sg,seat,p) LOG[#LOG+1]='f'..seat..'/'..#sg..'/'..p end)";

    it("runs fn once for every real controller in seat order with the cards of that seat; the own side has no bind; the bind goes at the end", async () => {
      const lua = `${TWO_EACH([2, 0, 1])}
${EACH}
${EXPECT_LOG("bx f0/2/0 b1 f1/2/1 b2 f2/2/2 bx")}`;
      expect(await run("ffa3", lua)).toBe("");
    });

    it("skips an opponent that the core refuses to bind (a defeated seat)", async () => {
      const lua = `${TWO_EACH([0, 1, 2])}
BINDS[1]=false
${EACH}
${EXPECT_LOG("bx f0/2/0 b1 b2 f2/2/2 bx")}`;
      expect(await run("ffa3", lua)).toBe("");
    });

    it("removes the bind when fn stops the loop", async () => {
      const lua = `${TWO_EACH([0, 1, 2])}
aux.MPForEachController(g,function(sg,seat,p) LOG[#LOG+1]='f'..seat return seat==1 end)
${EXPECT_LOG("bx f0 b1 f1 bx")}`;
      expect(await run("ffa3", lua)).toBe("");
    });

    // Tag fakes. Seats 0 and 2 are team 0 (the own side), 1 and 3 are team 1. c:GetControler() is the team id (what the fold gives in Tag),
    // the bind accepts the seats of team 1 only (the first three binds find the own team id: the first seat that the bind accepts is an
    // opponent), and Duel.MPNthDuelist (FAKE_NTH) lists the living duelists from the duelist that runs the effect, seat 0.
    const TAG = (seats: number[], living = [0, 1, 2, 3]) => `${TWO_EACH(seats)}${FAKE_NTH(living)}
local seat_of=Card.GetControler
Duel.MPSeatOf=function(c) return seat_of(c) end
Card.GetControler=function(c) return seat_of(c)%2 end
Duel.MPBindSeat=function(seat) LOG[#LOG+1]='b'..(seat or 'x') return seat==nil or seat%2==1 end
`;
    const TAG_EACH = "aux.MPForEachController(g,function(sg,seat,p) LOG[#LOG+1]='f'..seat..'/'..p..(REBOUND and 'R' or '') end)";

    it("Tag: the opposing duelists are bound one by one, the duelist that runs the effect has no bind and no rebind, the partner runs rebound to its seat", async () => {
      const lua = `${TAG([0, 1, 2, 3])}
${TAG_EACH}
${EXPECT_LOG("b0 b1 bx bx n1 n0 f0/0 n0 b1 f1/1 bx n1 n2 n3 f2/0R n0 b3 f3/1 bx")}
if REBOUND then error('the scope is not given back') end`;
      expect(await run("tag", lua)).toBe("");
    });

    it("Tag: a partner that is not a living duelist is skipped and the scope is given back", async () => {
      const lua = `${TAG([0, 2, 1], [0, 1, 3])}
${TAG_EACH}
${EXPECT_LOG("b0 b1 bx bx n1 n0 f0/0 n0 b1 f1/1 bx n1 n2 n3 n4 n0 bx")}
if REBOUND then error('the scope is not given back') end`;
      expect(await run("tag", lua)).toBe("");
    });

    it("Tag: gives the scope back when fn stops the loop at the partner, and when the partner is the only controller", async () => {
      const stop = `${TAG([0, 2, 3])}
aux.MPForEachController(g,function(sg,seat,p) LOG[#LOG+1]='f'..seat..(REBOUND and 'R' or '') return seat==2 end)
${EXPECT_LOG("b0 b1 bx bx n1 n0 f0 n0 bx n1 n2 n3 f2R n0 bx")}
if REBOUND then error('the scope is not given back') end`;
      expect(await run("tag", stop)).toBe("");
      const only = `${TAG([2])}
${TAG_EACH}
${EXPECT_LOG("b0 b1 bx bx n1 n2 n3 f2/0R n0 bx")}
if REBOUND then error('the scope is not given back') end`;
      expect(await run("tag", only)).toBe("");
    });

    it("Tag: the stock way (no rebind, fn runs for the partner) when the core has no Duel.MPNthDuelist or the scope has no first duelist", async () => {
      const none = `${TAG([0, 1, 2, 3])}
Duel.MPNthDuelist=nil
${TAG_EACH}
${EXPECT_LOG("b0 b1 bx bx f0/0 b1 f1/1 bx f2/0 b3 f3/1 bx")}`;
      expect(await run("tag", none)).toBe("");
      const outside = `${TAG([0, 1, 2, 3], [])}
${TAG_EACH}
${EXPECT_LOG("b0 b1 bx bx n1 f0/0 n0 b1 f1/1 bx n1 f2/0 n0 b3 f3/1 bx")}`;
      expect(await run("tag", outside)).toBe("");
    });

    it("FFA: never rebinds (the only controller of the own side is the duelist that runs the effect)", async () => {
      const lua = `${TWO_EACH([0, 1, 2])}${FAKE_NTH([0, 1, 2])}
${EACH}
${EXPECT_LOG("bx f0/2/0 b1 f1/2/1 b2 f2/2/2 bx")}`;
      expect(await run("ffa3", lua)).toBe("");
    });

    it("two seats (mode 0) and a core with no Duel.MPBindSeat: the same loop, no bind", async () => {
      const lua = `${TWO_EACH([0, 1])}
Duel.MPMode=function() return 0 end
${EACH}
${EXPECT_LOG("f0/2/0 f1/2/1")}
LOG={}
Duel.MPMode=function() return 1 end
Duel.MPBindSeat=nil
${EACH}
${EXPECT_LOG("f0/2/0 f1/2/1")}`;
      expect(await run("ffa3", lua)).toBe("");
    });
  });
});
