import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { currentEngineDataDirectory } from "../../engine-data-dir.js";
import { describeWithCores, needs } from "../../support/cores.js";
import {
  fieldCountCompare,
  listIndex,
  makeSource,
  RULES,
  scanCorpus,
  scanText,
  stripComments,
  whoOf,
  type CardScan,
} from "../../../scripts/scan-multiplayer-scripts.js";

// Unit tests per pattern use small inline Lua samples. The corpus test reads the official scripts of the
// shared test data directory (DUEL_DATA_DIR, default data/duel-engine-next, never the live data/duel-engine); it is skipped when they are missing, and fails with DUEL_REQUIRE_CORES=1.

const wrap = (body: string): string => `local s,id=GetID()\nfunction s.activate(e,tp,eg,ep,ev,re,r,rp)\n${body}\nend\n`;
const scan = (body: string): CardScan => scanText(1, wrap(body));
const has = (body: string, rule: string): boolean => scan(body).rules.includes(rule);

describe("scanner helpers", () => {
  it("strips comments and keeps line numbers", () => {
    const text = "a=1 --Duel.Win(tp)\n--[[ Duel.Win(tp)\nDuel.Win(tp) ]]\nb=2";
    const clean = stripComments(text);
    expect(clean.split("\n")).toHaveLength(4);
    expect(clean).not.toContain("Duel.Win");
  });

  it("reads players", () => {
    expect(whoOf("tp")).toMatchObject({ kind: "self" });
    expect(whoOf("e:GetHandlerPlayer()")).toMatchObject({ kind: "self", base: "tp" });
    expect(whoOf("1-tp")).toMatchObject({ kind: "opp", base: "tp" });
    expect(whoOf("1 - turn_player")).toMatchObject({ kind: "opp", base: "turn_player" });
    expect(whoOf("PLAYER_ALL")).toMatchObject({ kind: "other" });
    expect(whoOf("2")).toMatchObject({ kind: "other" });
  });

  it("every rule has an id, a class and a reason", () => {
    const ids = new Set<string>();
    for (const rule of RULES) {
      expect(ids.has(rule.id)).toBe(false);
      ids.add(rule.id);
      expect(["C", "O", "F"]).toContain(rule.cls);
      expect(rule.why.length).toBeGreaterThan(20);
    }
  });

  it("a script with no hit is U", () => {
    const card = scan("Duel.Draw(tp,1,REASON_EFFECT)");
    expect(card.cls).toBe("U");
    expect(card.flagged).toBe(false);
  });
});

describe("F patterns", () => {
  it("duel-win", () => {
    const card = scan("Duel.Win(tp,WIN_REASON_EXODIA)");
    expect(card.rules).toContain("duel-win");
    expect(card.cls).toBe("F");
    expect(card.flagged).toBe(true);
  });

  it("a commented Duel.Win does not count", () => {
    expect(has("--Duel.Win(tp,0)", "duel-win")).toBe(false);
  });

  it("tag-utility", () => {
    expect(has("if Duel.GetPlayersCount(tp)==2 then end", "tag-utility")).toBe(true);
    expect(has("Duel.TagSwap(tp)", "tag-utility")).toBe(true);
    expect(has("if aux.AskEveryone(aux.Stringid(id,0)) then end", "tag-utility")).toBe(true);
  });

  it("swap-control", () => {
    expect(has("Duel.SwapControl(a,b)", "swap-control")).toBe(true);
  });

  it("lp-reset", () => {
    expect(has("Duel.SetLP(tp,Duel.GetLP(1-tp))", "lp-reset")).toBe(true);
    expect(has("Duel.SetLP(tp,8000)", "lp-reset")).toBe(false);
  });

  it("lp-reset: LP read into locals first (Trading Places swap)", () => {
    const swap = "local lp1=Duel.GetLP(tp)\nlocal lp2=Duel.GetLP(1-tp)\nDuel.SetLP(tp,lp2)\nDuel.SetLP(1-tp,lp1)";
    expect(has(swap, "lp-reset")).toBe(true);
    expect(has("local a,b=Duel.GetLP(tp),Duel.GetLP(1-tp)\nDuel.SetLP(tp,b)", "lp-reset")).toBe(true);
    // Own LP into own LP is not a reset against another player.
    expect(has("local lp=Duel.GetLP(tp)\nDuel.SetLP(tp,lp//2)", "lp-reset")).toBe(false);
  });

  it("each-player-pair: same call for tp and 1-tp", () => {
    expect(has("Duel.Recover(tp,300,REASON_EFFECT)\nDuel.Recover(1-tp,300,REASON_EFFECT)", "each-player-pair")).toBe(true);
    expect(has("Duel.Recover(1-tp,300,REASON_EFFECT)", "each-player-pair")).toBe(false);
    expect(has("Duel.Damage(tp,100,REASON_EFFECT)\nDuel.Damage(1-tp,200,REASON_EFFECT)", "each-player-pair")).toBe(false);
  });

  it("each-player-split: same API with different amounts is a decision", () => {
    const card = scan("Duel.Damage(tp,100,REASON_EFFECT)\nDuel.Damage(1-tp,200,REASON_EFFECT)");
    expect(card.rules).toContain("each-player-split");
    expect(card.cls).toBe("O");
    expect(card.flagged).toBe(true);
  });

  it("player-loop", () => {
    expect(has("for p=0,1 do\nDuel.Draw(p,1,REASON_EFFECT)\nend", "player-loop")).toBe(true);
    expect(has("for _,p in ipairs({0,1}) do end", "player-loop")).toBe(true);
    expect(has("local t={0,1,PLAYER_ALL}", "player-loop")).toBe(true);
    expect(has("for i=1,3 do end", "player-loop")).toBe(false);
  });

  it("player-table: per-player Lua tables", () => {
    expect(has("s[tp]=1", "player-table")).toBe(true);
    expect(has("local x=s[ep]", "player-table")).toBe(true);
    expect(has("local x=s[0]", "player-table")).toBe(false);
  });

  it("player-table: a table that is a field of s (s.name_list[tp])", () => {
    expect(has("s.name_list[tp][dc:GetCode()]=true", "player-table")).toBe(true);
    expect(has("if s.attr_list[1-tp]&attr==0 then end", "player-table")).toBe(true);
    // A local list indexed by a player is not state of the card.
    expect(has("local zones={}\nzones[p]=1\nlocal t={}\nt[tp]=2", "player-table")).toBe(false);
  });

  it("player-table: literal slots of a field table need a GlobalCheck and both slots", () => {
    const lua = `local s,id=GetID()
function s.initial_effect(c)
	aux.GlobalCheck(s,function()
		s.name_list={}
		s.name_list[0]={}
		s.name_list[1]={}
	end)
end
`;
    expect(scanText(1, lua).rules).toContain("player-table");
    expect(scanText(1, lua.replace("\t\ts.name_list[1]={}\n", "")).rules).not.toContain("player-table");
  });

  it("global-player-flag: a player-valued flag set by a global effect", () => {
    const lua = `local s,id=GetID()
function s.initial_effect(c)
	aux.GlobalCheck(s,function()
		local ge1=Effect.CreateEffect(c)
		ge1:SetOperation(s.checkop)
		Duel.RegisterEffect(ge1,0)
	end)
end
function s.checkop(e,tp,eg,ep,ev,re,r,rp)
	Duel.RegisterFlagEffect(rp,id,RESET_PHASE+PHASE_END,0,1)
end
`;
    const card = scanText(1, lua);
    expect(card.rules).toContain("global-player-flag");
    expect(card.cls).toBe("F");
  });

  it("label-player: a player kept in a label", () => {
    expect(has("e:SetLabel(tp)\nif e:GetLabel()==ep then end", "label-player")).toBe(true);
    const storeOnly = scan("e:SetLabel(tp)");
    expect(storeOnly.rules).toContain("label-player-store");
    expect(storeOnly.cls).toBe("C");
    expect(has("e:SetLabel(Duel.AnnounceLevel(tp,1,4))", "label-player")).toBe(false);
  });

  it("label-player: compare forms with 1-, a controler and a label of another object", () => {
    expect(has("e1:SetLabel(ep)\nlocal v=function(e,re,rp) return rp==1-e:GetLabel() end", "label-player")).toBe(true);
    expect(has("e1:SetLabel(tp)\nlocal v=function(e) return e:GetHandler():GetControler()==e:GetLabel() end", "label-player")).toBe(true);
    expect(has("e1:SetLabel(ep)\nlocal x=function(e,tp,eg,ep) return ep==1-e:GetLabel() end", "label-player")).toBe(true);
    expect(has("e1:SetLabel(ep)\nDuel.DiscardHand(1-e:GetLabel(),nil,1,1,REASON_EFFECT)", "label-player")).toBe(true);
  });

  it("label-player: a local read from a label and used as a player", () => {
    expect(has("e4:SetLabel(1-tp)\nlocal p=e:GetLabel()\nDuel.GetControl(tc,p)", "label-player")).toBe(true);
    expect(has("e2:SetLabel(tp)\nlocal player=e:GetLabel()\nif x:IsExists(Card.IsPreviousControler,1,nil,1-player) then end\nDuel.RegisterFlagEffect(player,id,0,0,1)", "label-player")).toBe(true);
    expect(has("e1:SetLabel(tp)\nlocal p=e:GetLabelObject():GetLabel()\nif p==tp then end", "label-player")).toBe(true);
  });

  it("label-player: a label that is a count is not a player", () => {
    expect(has("e:SetLabel(tp)\nlocal ct=e:GetLabel()\nDuel.Draw(tp,ct,REASON_EFFECT)", "label-player")).toBe(false);
    expect(has("e:SetLabel(tp)\nlocal lv=e:GetLabel()\nif c:IsLevel(lv) then end", "label-player")).toBe(false);
  });

  it("reset-oppo-turns counts of 2 or more", () => {
    expect(has("e1:SetReset(RESET_PHASE|PHASE_END|RESET_OPPO_TURN,3)", "reset-oppo-turns")).toBe(true);
    const once = scan("e1:SetReset(RESET_PHASE|PHASE_END|RESET_OPPO_TURN)");
    expect(once.rules).toContain("reset-oppo-once");
    expect(once.cls).toBe("C");
  });

  it("reset-oppo-turns: a count that is not a literal", () => {
    expect(has("e1:SetReset(RESET_PHASE|PHASE_END|RESET_OPPO_TURN,Duel.IsTurnPlayer(tp) and 1 or 2)", "reset-oppo-turns")).toBe(true);
    expect(has("local rct=1\nif Duel.IsTurnPlayer(1-tp) then rct=2 end\ne1:SetReset(RESET_PHASE|PHASE_END|RESET_OPPO_TURN,rct)", "reset-oppo-turns")).toBe(true);
    expect(has("local reset_count=Duel.IsTurnPlayer(1-tp) and 2 or 1\ne1:SetReset(RESET_PHASE|PHASE_END|RESET_OPPO_TURN,reset_count)", "reset-oppo-turns")).toBe(true);
    // A variable that never holds 2 or more stays a count of 1.
    const once = scan("local rct=1\ne1:SetReset(RESET_PHASE|PHASE_END|RESET_OPPO_TURN,rct)");
    expect(once.rules).not.toContain("reset-oppo-turns");
    expect(once.rules).toContain("reset-oppo-once");
  });

  it("skip-turn", () => {
    expect(has("local e1=Effect.CreateEffect(c)\ne1:SetCode(EFFECT_SKIP_TURN)", "skip-turn")).toBe(true);
  });
});

describe("O patterns", () => {
  it("individual-opp: an individual API on the opponent", () => {
    const card = scan("Duel.Draw(1-tp,1,REASON_EFFECT)");
    expect(card.rules).toContain("individual-opp");
    expect(card.cls).toBe("O");
    expect(card.flagged).toBe(false);
  });

  it("opp-individual-location: an opponent hand or Deck read", () => {
    expect(has("local g=Duel.GetFieldGroup(tp,0,LOCATION_HAND)", "opp-individual-location")).toBe(true);
    expect(has("local g=Duel.GetFieldGroup(tp,0,LOCATION_MZONE)", "opp-individual-location")).toBe(false);
  });

  it("field-opp-mask is C", () => {
    const card = scan("local g=Duel.GetMatchingGroup(aux.TRUE,tp,0,LOCATION_MZONE,nil)");
    expect(card.rules).toContain("field-opp-mask");
    expect(card.cls).toBe("C");
  });

  it("chooser-opp-field: the opponent chooses from an opponent field group", () => {
    const card = scan("local g=Duel.SelectMatchingCard(1-tp,aux.TRUE,tp,0,LOCATION_MZONE,1,1,nil)");
    expect(card.rules).toContain("chooser-opp-field");
    expect(card.flagged).toBe(true);
  });

  it("chooser-opp: an option or yes/no prompt for the opponent is not ambiguous", () => {
    const card = scan("local op=Duel.SelectOption(1-tp,aux.Stringid(id,0),aux.Stringid(id,1))");
    expect(card.rules).toContain("chooser-opp");
    expect(card.rules).not.toContain("chooser-opp-field");
    expect(card.flagged).toBe(false);
  });

  it.each([
    "local opp=1-tp\nlocal sg=g:Select(opp,1,1,nil)",
    "local opp=1-tp\nlocal op=Duel.SelectEffect(opp,{true,1},{true,2})",
    "local p\n if e:GetLabel()==0 then\n  p=1-tp\n elseif e:GetLabel()==1 then\n  p=tp\n end\nlocal sg=g:Select(p,1,1,nil)",
    "local sel_player=Duel.IsExistingMatchingCard(Card.IsSetCard,tp,LOCATION_PZONE,0,1,nil,SET_VAALMONICA) and tp or 1-tp\nlocal op=Duel.SelectEffect(sel_player,{true,1},{true,2})",
  ])("chooser-opp follows local and conditional opponent aliases: %s", (body) => {
    const card = scan(body);
    expect(card.rules).toContain("chooser-opp");
    expect(card.cls).toBe("O");
    expect(card.flagged).toBe(false);
  });

  it("chooser-opp does not take an alias from a different callback or a comparison", () => {
    const text = "function s.target(e,tp)\n local opp=1-tp\nend\nfunction s.activate(e,tp)\n local opp=tp\n if opp==1-tp then end\n g:Select(opp,1,1,nil)\nend";
    expect(scanText(1, text).rules).not.toContain("chooser-opp");
  });

  it("both-individual-locs: same hand or Deck of both players", () => {
    expect(has("local g=Duel.GetFieldGroup(tp,LOCATION_HAND,LOCATION_HAND)", "both-individual-locs")).toBe(true);
    expect(has("local g=Duel.GetFieldGroup(tp,LOCATION_HAND,LOCATION_MZONE)", "both-individual-locs")).toBe(false);
  });

  it("register-effect-opp", () => {
    expect(has("Duel.RegisterEffect(e1,1-tp)", "register-effect-opp")).toBe(true);
    expect(has("Duel.RegisterEffect(e1,tp)", "register-effect-opp")).toBe(false);
  });

  it("summon-opp-field", () => {
    expect(has("Duel.SpecialSummon(g,0,tp,1-tp,false,false,POS_FACEUP)", "summon-opp-field")).toBe(true);
    expect(has("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)", "summon-opp-field")).toBe(false);
  });

  it("extra-release", () => {
    expect(has("e1:SetCode(EFFECT_EXTRA_RELEASE)", "extra-release")).toBe(true);
  });

  it("zone-mask-shift and column", () => {
    expect(has("local z=zone<<16", "zone-mask-shift")).toBe(true);
    expect(has("local g=c:GetColumnGroup()", "column")).toBe(true);
  });

  it("field-count-compare: own count against opponent count", () => {
    expect(has("if Duel.GetFieldGroupCount(tp,LOCATION_MZONE,0)<Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE) then end", "field-count-compare")).toBe(true);
    const lua = wrap("local a=Duel.GetFieldGroupCount(tp,LOCATION_MZONE,0)\nlocal b=Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE)\nif a>b then end");
    expect(fieldCountCompare(makeSource(lua))).toHaveLength(1);
  });

  it("field-count-compare ignores two counts compared to literals in one line", () => {
    const own = "Duel.GetFieldGroupCount(tp,LOCATION_MZONE,0)";
    const opp = "Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE)";
    expect(has(`if ${opp}>0 and ${own}==0 then end`, "field-count-compare")).toBe(false);
    expect(has(`if ${own}==0 and ${opp}>0 then end`, "field-count-compare")).toBe(false);
    expect(has(`local count=(${own}==0 and ${opp}>0) and 2 or 0`, "field-count-compare")).toBe(false);
    expect(has(`if ${own}==0 or ${opp}==0 then end`, "field-count-compare")).toBe(false);
    // A real compare in the second clause still hits.
    expect(has(`if ${own}>0 and ${own}<${opp} then end`, "field-count-compare")).toBe(true);
  });

  it("field-count-compare ignores a compare with a literal", () => {
    const lua = wrap("local a=Duel.GetFieldGroupCount(tp,LOCATION_MZONE,0)\nlocal b=Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE)\nif a>0 and b>0 then end");
    expect(fieldCountCompare(makeSource(lua))).toHaveLength(0);
  });
});

describe("C patterns", () => {
  it("target-range-opp, player-all, global-check, opp-ref, phase-turn-player", () => {
    expect(scan("e1:SetTargetRange(0,LOCATION_MZONE)").rules).toContain("target-range-opp");
    expect(scan("e1:SetTargetRange(1,0)\ne1:SetTargetRange(PLAYER_ALL,0)").rules).toContain("player-all");
    expect(scanText(1, "local s,id=GetID()\nfunction s.initial_effect(c)\n\taux.GlobalCheck(s,function() end)\nend\n").rules).toContain("global-check");
    expect(scan("local x=1-tp").rules).toContain("opp-ref");
    const phase = scan("e1:SetCode(EVENT_PHASE|PHASE_STANDBY)\nif Duel.IsTurnPlayer(tp) then end");
    expect(phase.rules).toContain("phase-turn-player");
    // The + form is the more common one.
    expect(scan("e1:SetCode(EVENT_PHASE+PHASE_STANDBY)\nif Duel.IsTurnPlayer(tp) then end").rules).toContain("phase-turn-player");
    expect(scan("e1:SetCode(EVENT_PHASE_START+PHASE_DRAW)\nif Duel.GetTurnPlayer()==tp then end").rules).toContain("phase-turn-player");
    expect(scan("e1:SetCode(EVENT_CHAINING)\nif Duel.IsTurnPlayer(tp) then end").rules).not.toContain("phase-turn-player");
  });

  it("a C card is not flagged", () => {
    const card = scan("local g=Duel.GetMatchingGroup(aux.TRUE,tp,0,LOCATION_MZONE,nil)");
    expect(card.cls).toBe("C");
    expect(card.flagged).toBe(false);
  });
});

// DUEL_SCRIPTS_DIR, else the card scripts of the shared test data directory (DUEL_DATA_DIR).
const dir = process.env.DUEL_SCRIPTS_DIR ?? join(currentEngineDataDirectory(), "card-scripts/official");
const corpus = needs.file("official script corpus", dir, "Set DUEL_SCRIPTS_DIR, or set DUEL_DATA_DIR to an engine data directory with card-scripts/official.");

describeWithCores("corpus", corpus, () => {
  const cards = corpus.ok ? scanCorpus(dir) : [];
  const byCode = new Map(cards.map((card) => [card.code, card]));
  const lists = listIndex();

  it("reads the whole corpus", () => {
    expect(cards.length).toBeGreaterThan(10000);
  });

  it("True Exodia (Duel.Win) is F", () => {
    expect(byCode.get(37984331)?.cls).toBe("F");
  });

  it("every Duel.Win card is F and on a list", () => {
    const wins = cards.filter((card) => card.rules.includes("duel-win"));
    expect(wins.length).toBeGreaterThan(5);
    for (const card of wins) {
      expect(card.cls, card.name).toBe("F");
      expect(lists.has(card.code), `${card.code} ${card.name}`).toBe(true);
    }
  });

  it("Raigeki is U or C", () => {
    expect(["U", "C"]).toContain(byCode.get(12580477)?.cls);
  });

  it("Mind Crush is O", () => {
    expect(byCode.get(15800838)?.cls).toBe("O");
  });

  it("Trading Places (an LP swap through locals) is flagged and class F", () => {
    expect(byCode.get(63875853)?.rules).toContain("lp-reset");
    expect(byCode.get(63875853)?.flagged).toBe(true);
  });

  it("a card with `0 count and opponent count > 0` lines is not a field-count compare", () => {
    expect(byCode.get(23893227)?.rules).not.toContain("field-count-compare");
    expect(byCode.get(11302671)?.rules).not.toContain("field-count-compare");
  });

  it("per-player fields of s and stored labels are found", () => {
    expect(byCode.get(19671102)?.rules).toContain("player-table");
    expect(byCode.get(70117860)?.rules).toContain("label-player");
    expect(byCode.get(12800564)?.rules).toContain("reset-oppo-turns");
    expect(byCode.get(10060427)?.rules).toContain("phase-turn-player");
  });

  it("Evenly Matched is flagged", () => {
    expect(byCode.get(15693423)?.flagged).toBe(true);
  });

  it("Kaiser Colosseum is flagged", () => {
    expect(byCode.get(35059553)?.flagged).toBe(true);
  });

  it("every card that summons to the opponent field is on a list", () => {
    const missing = cards.filter((card) => card.rules.includes("summon-opp-field") && !lists.has(card.code));
    expect(missing.map((card) => `${card.code} ${card.name}`)).toEqual([]);
  });

  it("only a few list entries are not flagged", () => {
    const notFlagged = [...lists.keys()].filter((code) => !byCode.get(code)?.flagged);
    expect(notFlagged.length).toBeLessThan(10);
  });
});
