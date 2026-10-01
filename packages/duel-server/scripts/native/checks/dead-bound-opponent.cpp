// Native check: owner rule OQ3. A bound opponent that is gone means "no effect on that opponent", never a Lua error.
// At n > 2 the Lua value 1 can be bound to one real seat (Duel.MPBindSeat, the F5 pick). When that seat is dead (eliminated,
// or not an opponent) the other side is EMPTY. Before the fix, every library function that reads or acts on the other
// side took its "empty" exit with `return 0`, which pushes NO Lua value. A script that compares the answer
// (`Duel.GetLocationCount(1-tp,LOCATION_MZONE)>0`) then failed with "attempt to compare nil with number". Now the function
// gives the empty VALUE of its type: 0 (a count, a zone mask, a zone list), false (a check, an action that failed),
// nil (a label) or an empty group, with the same number of values as the live answer.
// The probe is one continuous Standby Phase effect of seat 0. It binds the Lua value 1 and calls every changed function
// with the player value P inside pcall, then logs "CHK <name> n=<values> <type:value>...":
//   A  FFA3, seat 2 eliminated by the host, bound with MPBindSeat(2): every function gives its empty value, no error
//   B  FFA4, the same with seat 2 of four
//   C  FFA3, seat 1 alive and bound: the live answer (control: a live bound seat is not turned into an empty answer)
//   D  FFA3, PLAYER_NONE (7) as the player value: the stock result, no value at all (n=0), as before
//   E  2 duelists, PLAYER_NONE: no value at all, as before (queries only: an action with PLAYER_NONE as the target of a
//      2 duelist duel is not guarded in the stock core). The hash of the log of E and of the live query calls
//      with the player value 1 is printed ("N2 HASH"); it must be the same on the core before and after the change.
#include "scripted-duel.h"

static const uint32_t kFiller = 5000;

// kind: I = one 0, II = two 0, B = false, N = nil, G = empty group. q = a query (also run for the live control and
// the 2 duelist hash), a = an action (run only when the answer is empty, it must not do anything).
struct Entry { const char* name; const char* call; const char* kind; bool query; };

static const Entry kEntries[] = {
	{ "GetLP", "Duel.GetLP(P)", "I", true },
	{ "GetTurnCount", "Duel.GetTurnCount(P)", "I", true },
	{ "GetDrawCount", "Duel.GetDrawCount(P)", "I", true },
	{ "GetFlagEffect", "Duel.GetFlagEffect(P,12345)", "I", true },
	{ "SetFlagEffectLabel", "Duel.SetFlagEffectLabel(P,12345,1)", "B", false },
	{ "GetFlagEffectLabel", "Duel.GetFlagEffectLabel(P,12345)", "N", true },
	{ "SpecialSummon(sumplayer)", "Duel.SpecialSummon(tc,0,P,0,false,false,POS_FACEUP)", "I", false },
	{ "SpecialSummon(target)", "Duel.SpecialSummon(tc,0,0,P,false,false,POS_FACEUP)", "I", false },
	{ "SpecialSummonStep(sumplayer)", "Duel.SpecialSummonStep(tc,0,P,0,false,false,POS_FACEUP)", "B", false },
	{ "SpecialSummonStep(target)", "Duel.SpecialSummonStep(tc,0,0,P,false,false,POS_FACEUP)", "B", false },
	{ "RemoveCounter", "Duel.RemoveCounter(P,LOCATION_ONFIELD,0,0x1,1,REASON_EFFECT)", "B", false },
	{ "MoveToField(zone-owner)", "Duel.MoveToField(tc,0,P,LOCATION_MZONE,POS_FACEUP,true)", "B", false },
	{ "MoveToField(mover)", "Duel.MoveToField(tc,P,0,LOCATION_MZONE,POS_FACEUP,true)", "B", false },
	{ "Draw", "Duel.Draw(P,1,REASON_EFFECT)", "I", false },
	{ "Damage", "Duel.Damage(P,100,REASON_EFFECT)", "I", false },
	{ "Recover", "Duel.Recover(P,100,REASON_EFFECT)", "I", false },
	{ "Equip", "Duel.Equip(P,tc,tc2)", "B", false },
	{ "GetControl", "Duel.GetControl(tc,P)", "I", false },
	{ "CheckLPCost", "Duel.CheckLPCost(P,100)", "B", true },
	{ "GetBattleDamage", "Duel.GetBattleDamage(P)", "I", true },
	{ "GetLocationCount", "Duel.GetLocationCount(P,LOCATION_MZONE)", "II", true },
	{ "GetMZoneCount", "Duel.GetMZoneCount(P)", "II", true },
	{ "GetLocationCountFromEx", "Duel.GetLocationCountFromEx(P)", "II", true },
	{ "GetUsableMZoneCount", "Duel.GetUsableMZoneCount(P)", "I", true },
	{ "GetLinkedGroup", "Duel.GetLinkedGroup(P,1,1)", "G", true },
	{ "GetLinkedGroupCount", "Duel.GetLinkedGroupCount(P,1,1)", "I", true },
	{ "GetLinkedZone", "Duel.GetLinkedZone(P)", "I", true },
	{ "GetFreeLinkedZone", "Duel.GetFreeLinkedZone(P)", "I", true },
	{ "CheckLocation", "Duel.CheckLocation(P,LOCATION_MZONE,0)", "B", true },
	{ "GetReleaseGroup", "Duel.GetReleaseGroup(P)", "G", true },
	{ "GetReleaseGroupCount", "Duel.GetReleaseGroupCount(P)", "I", true },
	{ "CheckReleaseGroup", "Duel.CheckReleaseGroup(P,nil,1,nil)", "B", true },
	{ "CheckReleaseGroupEx", "Duel.CheckReleaseGroupEx(P,nil,1,nil)", "B", true },
	{ "SelectReleaseGroup", "Duel.SelectReleaseGroup(P,nil,1,1,nil)", "G", false },
	{ "SelectReleaseGroupEx", "Duel.SelectReleaseGroupEx(P,nil,1,1,nil)", "G", false },
	{ "GetRitualMaterial", "Duel.GetRitualMaterial(P)", "G", true },
	{ "GetFusionMaterial", "Duel.GetFusionMaterial(P)", "G", true },
	{ "GetActivityCount", "Duel.GetActivityCount(P,ACTIVITY_SUMMON,ACTIVITY_SPSUMMON)", "II", true },
	{ "GetBattledCount", "Duel.GetBattledCount(P)", "I", true },
	{ "GetPlayersCount", "Duel.GetPlayersCount(P)", "I", true },
	{ "GetStartingHand", "Duel.GetStartingHand(P)", "I", true },
	{ "Card.CheckRemoveOverlayCard", "tc:CheckRemoveOverlayCard(P,1,REASON_COST)", "B", true },
	{ "Card.RemoveOverlayCard", "tc:RemoveOverlayCard(P,1,1,REASON_COST)", "I", false },
	{ "Card.IsCanRemoveCounter", "tc:IsCanRemoveCounter(P,0x1,1,REASON_COST)", "B", true },
};

static std::string expected(const std::string& kind) {
	if(kind == "I") return "n=1 number:0";
	if(kind == "II") return "n=2 number:0 number:0";
	if(kind == "B") return "n=1 boolean:false";
	if(kind == "N") return "n=1 nil:nil";
	return "n=1 group:0";   // G
}

// The probe: bind (bind_expr is Lua text, "" = no bind), then every entry (all of them, or only the queries)
static std::string probe(const std::string& bind_expr, const std::string& player, bool queries_only) {
	std::string s = R"LUA(
local g0=Duel.GetFieldGroup(0,LOCATION_DECK,0)
local tc=g0:GetFirst()
local tc2=g0:GetNext()
local function fmt(...)
	local n=select('#',...)
	local t={"n="..n}
	for i=1,n do
		local v=select(i,...)
		if type(v)=='Group' then
			t[#t+1]="group:"..v:GetCount()
		else
			t[#t+1]=type(v)..":"..tostring(v)
		end
	end
	return table.concat(t," ")
end
local function T(name,f)
	local r=table.pack(pcall(f))
	if not r[1] then Debug.Message("CHK "..name.." ERR "..tostring(r[2]))
	else Debug.Message("CHK "..name.." "..fmt(table.unpack(r,2,r.n))) end
end
local c=tc
local e=Effect.CreateEffect(c)
e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
e:SetCode(EVENT_PHASE+PHASE_STANDBY)
e:SetCountLimit(1)
e:SetOperation(function(e,tp)
)LUA";
	if(!bind_expr.empty()) s += "\t" + bind_expr + "\n";
	s += "\tlocal P=" + player + "\n";
	for(const auto& en : kEntries) {
		if(queries_only && !en.query) continue;
		s += std::string("\tT(\"") + en.name + "\",function() return " + en.call + " end)\n";
	}
	s += "\tDebug.Message(\"CHK done\")\nend)\nDuel.RegisterEffect(e,0)\n";
	return s;
}

struct Run {
	std::map<std::string, std::string> res;   // entry name -> "n=... type:value ..." or "ERR ..."
	std::vector<std::string> lines;           // every probe line, in order
	bool done = false;
	int other_prompts = 0;
};

// kill_seat >= 0: the host eliminates that seat at the first idle prompt of turn 1, before the probe is registered.
static Run play(const std::string& setup, int n, const std::string& bind_expr, const std::string& player, bool queries_only, int kill_seat) {
	Run run;
	sd::stray_logs = 0;
	sd::on_line = [&run](const std::string& line) {
		run.lines.push_back(line);
		const std::string body = line.substr(4);
		if(body == "done") { run.done = true; return; }
		// the entry names have no space, except none; split at the first space
		const auto sp = body.find(' ');
		if(sp != std::string::npos) run.res[body.substr(0, sp)] = body.substr(sp + 1);
	};
	OCG_Duel d = sd::create(setup);
	for(int p = 0; p < n; ++p)
		for(int i = 0; i < 30; ++i) sd::add(d, static_cast<uint8_t>(p), kFiller, LOCATION_DECK);
	OCG_StartDuel(d);
	std::vector<sd::Msg> msgs;
	const sd::Msg* pm = nullptr;
	int last_turn = 0;
	for(int steps = 0; steps < 4000 && !run.done; ++steps) {
		const int status = sd::step(d, msgs, pm);
		if(status == OCG_DUEL_STATUS_END) break;
		if(status != OCG_DUEL_STATUS_AWAITING) continue;
		if(!pm) { std::printf("FAIL: awaiting without a prompt\n"); ++failures; break; }
		auto& f = sd::F(d);
		if(pm->id == MSG_SELECT_CHAIN) {
			sd::answer32(d, -1);
			continue;
		}
		if(pm->id == MSG_SELECT_CARD) {  // the discard at the end of a turn with more than 6 cards in hand
			uint32_t min = 0;
			std::memcpy(&min, pm->p + 2, 4);
			std::vector<uint32_t> rr{ 0, min };
			for(uint32_t i = 0; i < min; ++i) rr.push_back(i);
			OCG_DuelSetResponse(d, rr.data(), static_cast<uint32_t>(rr.size() * 4));
			continue;
		}
		if(pm->id != MSG_SELECT_IDLECMD) {
			++run.other_prompts;
			std::printf("FAIL: unexpected prompt %u\n", pm->id);
			++failures;
			break;
		}
		const int turn = static_cast<int>(f.infos.turn_id);
		if(turn != last_turn) {
			last_turn = turn;
			if(turn >= 4) break;
			if(turn == 1) {
				if(kill_seat >= 0) f.eliminate(static_cast<uint8_t>(kill_seat), 1);
				sd::lua(d, probe(bind_expr, player, queries_only));
			}
		}
		sd::answer32(d, 7);  // end the turn
	}
	OCG_DestroyDuel(d);
	return run;
}

static uint64_t fnv(const std::vector<std::string>& lines) {
	uint64_t h = 1469598103934665603ull;
	for(const auto& l : lines) {
		for(unsigned char ch : l) { h ^= ch; h *= 1099511628211ull; }
		h ^= '\n'; h *= 1099511628211ull;
	}
	return h;
}

// every entry (or every query) must read the empty value
static void expect_all_empty(const char* label, const Run& r, bool queries_only) {
	EXPECT(r.done, "%s: the probe never ran", label);
	int bad = 0;
	for(const auto& en : kEntries) {
		if(queries_only && !en.query) continue;
		const auto it = r.res.find(en.name);
		const std::string want = expected(en.kind);
		const std::string got = it == r.res.end() ? "(no line)" : it->second;
		if(got != want) {
			++bad;
			EXPECT(false, "%s: %s gave \"%s\", want \"%s\"", label, en.name, got.c_str(), want.c_str());
		}
	}
	EXPECT(r.other_prompts == 0, "%s: %d question(s) were asked", label, r.other_prompts);
	EXPECT(sd::stray_logs == 0, "%s: %d unexpected core log line(s)", label, sd::stray_logs);
	std::printf("%s %s: %zu function(s) give the empty value\n", bad ? "FAIL" : "ok  ", label, r.res.size());
}

// the stock "no value" result: n=0 for every entry
static void expect_no_value(const char* label, const Run& r, bool queries_only) {
	EXPECT(r.done, "%s: the probe never ran", label);
	int bad = 0;
	for(const auto& en : kEntries) {
		if(queries_only && !en.query) continue;
		const auto it = r.res.find(en.name);
		const std::string got = it == r.res.end() ? "(no line)" : it->second;
		// proc_workaround.lua (GetReleaseGroup, MoveToField) and proc_fusion_spell.lua (GetFusionMaterial) wrap these in a Lua
		// function that turns "no value" into nil (the same before the fix)
		const std::string name = en.name;
		const bool wrapped = name.compare(0, 11, "MoveToField") == 0 || name == "GetReleaseGroup" || name == "GetFusionMaterial";
		if(got != (wrapped ? "n=1 nil:nil" : "n=0")) {
			++bad;
			EXPECT(false, "%s: %s gave \"%s\", want \"n=0\" (or the nil of the Lua wrapper)", label, en.name, got.c_str());
		}
	}
	EXPECT(r.other_prompts == 0, "%s: %d question(s) were asked", label, r.other_prompts);
	EXPECT(sd::stray_logs == 0, "%s: %d unexpected core log line(s)", label, sd::stray_logs);
	std::printf("%s %s: no value, as before\n", bad ? "FAIL" : "ok  ", label);
}

int main() {
	const std::string ffa3 = "Debug.SetupDuelists(3,0,1,2)";
	const std::string ffa4 = "Debug.SetupDuelists(4,0,1,2,3)";
	// A, B: seat 2 is dead, the Lua value 1 is bound to it
	expect_all_empty("A ffa3 bound seat dead", play(ffa3, 3, "Duel.MPBindSeat(2)", "1", false, 2), false);
	expect_all_empty("B ffa4 bound seat dead", play(ffa4, 4, "Duel.MPBindSeat(2)", "1", false, 2), false);
	// C: control. Seat 1 lives and is bound: the live answers are not the empty value (the queries read real numbers)
	{
		Run r = play(ffa3, 3, "Duel.MPBindSeat(1)", "1", true, -1);
		EXPECT(r.done, "C: the probe never ran");
		EXPECT(r.res["GetLP"] == "n=1 number:8000", "C: GetLP of a live bound seat gave \"%s\"", r.res["GetLP"].c_str());
		EXPECT(r.res["GetLocationCount"].compare(0, 16, "n=2 number:5 num") == 0, "C: GetLocationCount of a live bound seat gave \"%s\"", r.res["GetLocationCount"].c_str());
		EXPECT(r.res["CheckLPCost"] == "n=1 boolean:true", "C: CheckLPCost of a live bound seat gave \"%s\"", r.res["CheckLPCost"].c_str());
		for(const auto& kv : r.res) EXPECT(kv.second.compare(0, 3, "ERR") != 0, "C: %s raised %s", kv.first.c_str(), kv.second.c_str());
		std::printf("ok   C ffa3 bound seat alive: live answers (GetLP %s)\n", r.res["GetLP"].c_str());
	}
	// D: PLAYER_NONE is not "a bound opponent that is gone": the stock result (no value) stays at n = 3
	expect_no_value("D ffa3 PLAYER_NONE", play(ffa3, 3, "", "PLAYER_NONE", false, -1), false);
	// E: two duelists: nothing changes. PLAYER_NONE gives no value; the log of the live queries with player value 1 has a hash
	{
		Run none = play("", 2, "", "PLAYER_NONE", true, -1);
		expect_no_value("E duel of 2, PLAYER_NONE", none, true);
		Run live = play("", 2, "", "1", true, -1);
		EXPECT(live.done, "E: the live query probe never ran");
		std::vector<std::string> all = none.lines;
		all.insert(all.end(), live.lines.begin(), live.lines.end());
		std::printf("N2 HASH %016llx (%zu lines)\n", static_cast<unsigned long long>(fnv(all)), all.size());
	}
	std::printf("%s: %d failure(s)\n", failures ? "FAIL" : "PASS", failures);
	return failures ? 1 : 0;
}
