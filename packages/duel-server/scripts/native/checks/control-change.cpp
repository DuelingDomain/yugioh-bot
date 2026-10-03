// T8 native check: control change and swap control for more than two duelists.
// Build and run: bash packages/duel-server/scripts/native/checks/run.sh <check name> (see README.md).
// Every scenario plays a real duel. A Lua effect at the start of Main Phase 1 of a chosen turn calls
// Duel.GetControl or Duel.SwapControl with reset PHASE_END. The Adjust at the End Phase must hand the cards back.
// The check reads the controller of each card after every process step and compares the sequence.
// Two kinds of effect run every scenario (patch 0053, R2 rule 1):
//   global  Effect.GlobalEffect registered with Duel.RegisterEffect(e,0) (the GlobalCheck pattern). It belongs to no
//           seat and its Lua runs without a fold, so every player argument is a REAL seat: Duel.GetControl(c,taker,...).
//   card    an effect owned by a monster of the taker. It has a seat, so Lua sees the folded values (0 = the owner, 1 =
//           every opponent): Duel.GetControl(c,0,...) is the taker, and the victim is found by its code.
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include "ocgapi.h"
#include "ocgapi_constants.h"
#include "duel.h"
#include "field.h"
#include "card.h"
#include "common.h"

static std::string last_log;

static void read_card(void*, uint32_t code, OCG_CardData* data) {
	std::memset(data, 0, sizeof(*data));
	data->code = code;
	data->type = TYPE_MONSTER | (code == 2 ? TYPE_FUSION : TYPE_NORMAL);
	data->level = 4;
	data->attribute = 1;
	data->race = 1;
	data->attack = 1000;
	data->defense = 1000;
}
static int read_script(void*, OCG_Duel, const char*) { return 0; }
static void on_log(void*, const char* text, int type) {
	last_log = text ? text : "";
	if(std::getenv("CHECK_LOG"))
		std::fprintf(stderr, "core log [%d]: %s\n", type, text);
}
static OCG_Duel make_duel(uint32_t seed) {
	OCG_DuelOptions options;
	std::memset(&options, 0, sizeof(options));
	options.seed[0] = seed;
	options.seed[1] = 2;
	options.seed[2] = 3;
	options.seed[3] = 4;
	options.flags = DUEL_MODE_MR5;
	options.team1 = {8000, 5, 1};
	options.team2 = {8000, 5, 1};
	options.cardReader = read_card;
	options.scriptReader = read_script;
	options.logHandler = on_log;
	OCG_Duel duel = nullptr;
	if(OCG_CreateDuel(&duel, &options) != OCG_DUEL_CREATION_SUCCESS) {
		std::printf("FAIL: OCG_CreateDuel\n");
		std::exit(2);
	}
	return duel;
}
static field& F(OCG_Duel d) { return *static_cast<duel*>(d)->game_field; }
static bool run_lua(OCG_Duel d, const std::string& code) {
	last_log.clear();
	return OCG_LoadScript(d, code.c_str(), static_cast<uint32_t>(code.size()), "check.lua") != 0;
}
static void add_cards(OCG_Duel d, uint8_t con, uint32_t loc, int count, uint32_t code = 1) {
	for(int i = 0; i < count; ++i) {
		OCG_NewCardInfo info;
		std::memset(&info, 0, sizeof(info));
		info.team = con;
		info.duelist = 0;
		info.code = code;
		info.con = con;
		info.loc = loc;
		info.seq = 0;
		info.pos = POS_FACEDOWN_DEFENSE;
		OCG_DuelNewCard(d, &info);
	}
}

static bool saw_win = false;
static int last_unanswered = 0;
static uint64_t fnv = 1469598103934665603ull;
static int step(OCG_Duel d, bool& answered) {
	answered = false;
	int status = OCG_DuelProcess(d);
	uint32_t length = 0;
	const auto* buffer = static_cast<const uint8_t*>(OCG_DuelGetMessage(d, &length));
	for(uint32_t i = 0; i < length; ++i) {
		fnv ^= buffer[i];
		fnv *= 1099511628211ull;
	}
	bool idle = false, chain = false, select_card = false, place = false;
	uint32_t select_min = 0, place_flag = 0;
	uint8_t place_player = 0;
	for(uint32_t offset = 0; offset + 4 <= length;) {
		uint32_t size = 0;
		std::memcpy(&size, buffer + offset, 4);
		if(size > 0) {
			last_unanswered = buffer[offset + 4];
			if(buffer[offset + 4] == MSG_WIN)
				saw_win = true;
			if(std::getenv("CHECK_TRACE"))
				std::fprintf(stderr, "msg %u size %u\n", static_cast<unsigned>(buffer[offset + 4]), size);
		}
		if(size > 0 && buffer[offset + 4] == MSG_SELECT_IDLECMD)
			idle = true;
		if(size > 0 && buffer[offset + 4] == MSG_SELECT_CHAIN)
			chain = true;
		if(size > 0 && buffer[offset + 4] == MSG_SELECT_PLACE) {
			place = true;
			place_player = buffer[offset + 5];
			std::memcpy(&place_flag, buffer + offset + 7, 4);
		}
		if(size > 10 && buffer[offset + 4] == MSG_SELECT_CARD) {
			select_card = true;
			std::memcpy(&select_min, buffer + offset + 7, 4);
		}
		offset += 4 + size;
	}
	if(status == OCG_DUEL_STATUS_AWAITING) {
		if(chain) {
			const int32_t no_chain = -1;
			OCG_DuelSetResponse(d, &no_chain, sizeof(no_chain));
			answered = true;
		} else if(idle) {
			const uint32_t to_end_phase = 7;
			OCG_DuelSetResponse(d, &to_end_phase, sizeof(to_end_phase));
			answered = true;
		} else if(place) {
			// The first free Main Monster Zone of the prompted duelist (a set bit = not allowed).
			uint8_t seq = 0;
			while(seq < 5 && (place_flag & (1u << seq)))
				++seq;
			if(std::getenv("CHECK_TRACE"))
				std::fprintf(stderr, "place player %u flag %08x seq %u\n", static_cast<unsigned>(place_player), place_flag, static_cast<unsigned>(seq));
			const uint8_t response[3] = { place_player, LOCATION_MZONE, seq };
			OCG_DuelSetResponse(d, response, sizeof(response));
			answered = true;
		} else if(select_card) {
			std::vector<uint32_t> response{ 0, select_min };
			for(uint32_t i = 0; i < select_min; ++i)
				response.push_back(i);
			OCG_DuelSetResponse(d, response.data(), static_cast<uint32_t>(response.size() * sizeof(uint32_t)));
			answered = true;
		}
	}
	return status;
}

struct Mon { int owner; int seat; };
struct Result {
	std::vector<int> ctl0; // controller trace of monster 0 (consecutive duplicates removed)
	std::vector<int> ctl1; // same for monster 1 (empty when there is one monster)
	bool ended_clean = true;
	uint64_t hash = 0;
	int turn = 0;
	std::string fail;
};
static void push(std::vector<int>& v, int x) {
	if(v.empty() || v.back() != x)
		v.push_back(x);
}
// setup: 0 = no SetupDuelists call (n must be 2), 1 = call it.
// handler_seat < 0: the effect is global (registered for seat 0). handler_seat >= 0: the effect belongs to the monster
// of that seat (mons must hold a monster there), so it has a seat and Lua sees the folded values.
static Result run_scn(int n, int setup, int act_turn, const std::vector<Mon>& mons, const std::string& op, int handler_seat = -1, uint32_t seed = 7) {
	Result r;
	OCG_Duel d = make_duel(seed);
	if(setup) {
		std::string code = "Debug.SetupDuelists(" + std::to_string(n);
		for(int i = 0; i < n; ++i)
			code += "," + std::to_string(i);
		code += ")";
		if(!run_lua(d, code)) {
			r.fail = "SetupDuelists: " + last_log;
			OCG_DestroyDuel(d);
			return r;
		}
	}
	for(int p = 0; p < n; ++p) {
		add_cards(d, static_cast<uint8_t>(p), LOCATION_DECK, 40);
		add_cards(d, static_cast<uint8_t>(p), LOCATION_EXTRA, 2, 2);
	}
	for(const auto& m : mons) {
		// Code 1000 + seat tells the monsters apart: inside an effect Lua sees only "own" and "opponents" (the Lua fold).
		const std::string add = "Debug.AddCard(" + std::to_string(1000 + m.seat) + "," + std::to_string(m.owner) + "," + std::to_string(m.seat) + ",4,0,1)";
		if(!run_lua(d, add)) {
			r.fail = add + ": " + last_log;
			OCG_DestroyDuel(d);
			return r;
		}
	}
	card* c[2] = { nullptr, nullptr };
	for(size_t i = 0; i < mons.size() && i < 2; ++i)
		c[i] = F(d).player[mons[i].seat].list_mzone[0];
	const std::string body =
		"e:SetType(0x802)\n"
		"e:SetCode(0x2004)\n"
		"e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)\n"
		"  if not done and Duel.GetTurnCount()==" + std::to_string(act_turn) + " then\n"
		"    done=true\n" + op + "\n"
		"  end\n"
		"end)\n";
	const std::string script = handler_seat < 0
		? "local done=false\nlocal e=Effect.GlobalEffect()\n" + body + "Duel.RegisterEffect(e,0)\n"
		: "local done=false\nlocal h=Duel.GetFieldCard(" + std::to_string(handler_seat) + ",4,0)\nlocal e=Effect.CreateEffect(h)\ne:SetRange(4)\n" + body + "h:RegisterEffect(e)\n";
	if(!run_lua(d, script)) {
		r.fail = "effect script: " + last_log;
		OCG_DestroyDuel(d);
		return r;
	}
	OCG_StartDuel(d);
	fnv = 1469598103934665603ull;
	saw_win = false;
	int extra = -1;
	for(int i = 0; i < 4000 && !saw_win; ++i) {
		bool answered = false;
		const int status = step(d, answered);
		for(int k = 0; k < 2; ++k) {
			if(!c[k])
				continue;
			auto& v = k == 0 ? r.ctl0 : r.ctl1;
			push(v, c[k]->current.location == LOCATION_MZONE ? c[k]->current.controler : 100 + c[k]->current.location);
		}
		if(status == OCG_DUEL_STATUS_END)
			break;
		if(status == OCG_DUEL_STATUS_AWAITING && !answered) {
			r.ended_clean = false;
			r.fail = "unanswered prompt, last message " + std::to_string(last_unanswered);
			break;
		}
		if(F(d).infos.turn_id > act_turn && extra < 0)
			extra = 3;
		if(extra == 0)
			break;
		if(extra > 0)
			--extra;
	}
	r.turn = F(d).infos.turn_id;
	r.hash = fnv;
	OCG_DestroyDuel(d);
	return r;
}
static std::string show(const std::vector<int>& v) {
	std::string s;
	for(int x : v)
		s += (s.empty() ? "" : ">") + std::to_string(x);
	return s;
}

// Seat taker takes the monster of seat victim at turn act_turn (taker = turn player when act_turn is taker + 1).
// as_global: a global effect with real seats. Otherwise an effect of a monster of the taker (folded values); that
// monster must stay with the taker.
static void check_get(const char* name, int n, int act_turn, int taker, int victim, bool as_global) {
	if(const char* only = std::getenv("CHECK_ONLY")) { if(std::strstr(name, only) == nullptr) return; }
	if(std::getenv("CHECK_TRACE")) std::fprintf(stderr, "== %s\n", name);
	const std::string vcode = std::to_string(1000 + victim);
	const auto r = as_global
		// Global: Lua sees real seats. The victim is read from its seat and the taker is named by its seat. The zone
		// prompt goes to the reason player, which is seat 0 for a global effect, so the taker is named as chooser too
		// (argument 6) to get the prompt for its own field.
		? run_scn(n, 1, act_turn, { { victim, victim } },
		          "local c=Duel.GetFieldCard(" + std::to_string(victim) + ",4,0) Duel.GetControl(c," + std::to_string(taker) + ",0x200,1,0xff," + std::to_string(taker) + ")")
		// Card: Lua sees the taker as 0 and every other seat as 1, so the victim is found by its code.
		: run_scn(n, 1, act_turn, { { victim, victim }, { taker, taker } },
		          "local c=Duel.GetMatchingGroup(function(c) return c:IsCode(" + vcode + ") end,0,4,4,nil):GetFirst() Duel.GetControl(c,0,0x200,1)", taker);
	const std::string want = std::to_string(victim) + ">" + std::to_string(taker) + ">" + std::to_string(victim);
	const std::string want_h = std::to_string(taker);
	EXPECT(r.fail.empty(), "%s: %s", name, r.fail.c_str());
	EXPECT(show(r.ctl0) == want, "%s: controller trace %s, want %s", name, show(r.ctl0).c_str(), want.c_str());
	EXPECT(as_global || show(r.ctl1) == want_h, "%s: the monster of the effect moved, trace %s, want %s", name, show(r.ctl1).c_str(), want_h.c_str());
	std::printf("%s %s: n=%d turn %d: %s effect, seat %d takes the monster of seat %d, trace %s (want %s), stopped at turn %d\n",
	            show(r.ctl0) == want && r.fail.empty() && (as_global || show(r.ctl1) == want_h) ? "ok  " : "FAIL", name, n, act_turn,
	            as_global ? "global" : "card", taker, victim, show(r.ctl0).c_str(), want.c_str(), r.turn);
}
// The monsters of seats a and b swap at turn act_turn and return.
static void check_swap(const char* name, int n, int act_turn, int a, int b, bool as_global) {
	if(const char* only = std::getenv("CHECK_ONLY")) { if(std::strstr(name, only) == nullptr) return; }
	if(std::getenv("CHECK_TRACE")) std::fprintf(stderr, "== %s\n", name);
	const auto r = as_global
		? run_scn(n, 1, act_turn, { { a, a }, { b, b } },
		          "Duel.SwapControl(Duel.GetFieldCard(" + std::to_string(a) + ",4,0),Duel.GetFieldCard(" + std::to_string(b) + ",4,0),0x200,1)")
		// Card: the effect belongs to the monster of seat a (the monster moves, its effect stays on the field).
		: run_scn(n, 1, act_turn, { { a, a }, { b, b } },
		          "local function mon(code) return Duel.GetMatchingGroup(function(c) return c:IsCode(code) end,0,4,4,nil):GetFirst() end "
		          "Duel.SwapControl(mon(" + std::to_string(1000 + a) + "),mon(" + std::to_string(1000 + b) + "),0x200,1)", a);
	const std::string want0 = std::to_string(a) + ">" + std::to_string(b) + ">" + std::to_string(a);
	const std::string want1 = std::to_string(b) + ">" + std::to_string(a) + ">" + std::to_string(b);
	EXPECT(r.fail.empty(), "%s: %s", name, r.fail.c_str());
	EXPECT(show(r.ctl0) == want0, "%s: monster of seat %d trace %s, want %s", name, a, show(r.ctl0).c_str(), want0.c_str());
	EXPECT(show(r.ctl1) == want1, "%s: monster of seat %d trace %s, want %s", name, b, show(r.ctl1).c_str(), want1.c_str());
	const bool ok = r.fail.empty() && show(r.ctl0) == want0 && show(r.ctl1) == want1;
	std::printf("%s %s: n=%d turn %d: %s effect, swap seat %d <-> seat %d, traces %s | %s, stopped at turn %d\n",
	            ok ? "ok  " : "FAIL", name, n, act_turn, as_global ? "global" : "card", a, b, show(r.ctl0).c_str(), show(r.ctl1).c_str(), r.turn);
}
// n = 2: the same duel with and without SetupDuelists(2,0,1): identical bytes; print the hash.
static void check_n2(const char* name, const std::string& op, std::vector<Mon> mons, int taker, int victim) {
	const auto a = run_scn(2, 0, 1, mons, op);
	const auto b = run_scn(2, 1, 1, mons, op);
	EXPECT(a.fail.empty() && b.fail.empty(), "%s: %s %s", name, a.fail.c_str(), b.fail.c_str());
	EXPECT(a.hash == b.hash, "%s: hash differs with and without SetupDuelists", name);
	const std::string want = std::to_string(victim) + ">" + std::to_string(taker) + ">" + std::to_string(victim);
	EXPECT(mons.size() != 1 || show(a.ctl0) == want, "%s: trace %s, want %s", name, show(a.ctl0).c_str(), want.c_str());
	std::printf("%s %s: n=2 hash %016llx (with setup %016llx), trace %s | %s, turn %d\n",
	            a.hash == b.hash && a.fail.empty() ? "ok  " : "FAIL", name, static_cast<unsigned long long>(a.hash),
	            static_cast<unsigned long long>(b.hash), show(a.ctl0).c_str(), show(a.ctl1).c_str(), a.turn);
}

int main(int argc, char** argv) {
	const std::string mode = argc > 1 ? argv[1] : "check";
	if(mode == "check" || mode == "n2") {
		check_n2("n2-get", "local c=Duel.GetFieldCard(1,4,0) Duel.GetControl(c,0,0x200,1)", { { 1, 1 } }, 0, 1);
		check_n2("n2-swap", "Duel.SwapControl(Duel.GetFieldCard(0,4,0),Duel.GetFieldCard(1,4,0),0x200,1)", { { 0, 0 }, { 1, 1 } }, 0, 0);
	}
	if(mode == "check" || mode == "multi") {
		// Every scenario runs twice: a global effect (real seats) and an effect of a monster of the taker (folded values).
		for(const bool g : { true, false }) {
			const std::string k = g ? "-global" : "-card";
			// (1) seat 0 takes a monster of a far seat (not the next seat); it returns to its owner, not to seat 1.
			check_get(("c1-n4-tp0-takes-seat3" + k).c_str(), 4, 1, 0, 3, g);
			check_get(("c1b-n3-tp0-takes-seat2" + k).c_str(), 3, 1, 0, 2, g);
			// (2) swap between two far seats, neither is the turn player.
			check_swap(("c2-n4-swap-1-3" + k).c_str(), 4, 1, 1, 3, g);
			check_swap(("c2b-n4-swap-2-3" + k).c_str(), 4, 1, 2, 3, g);
			// (3) the taker is not seat 0 or 1: turn 4 is seat 3 in n = 4, turn 3 is seat 2 in n = 3.
			check_get(("c3-n4-tp3-takes-seat0" + k).c_str(), 4, 4, 3, 0, g);
			check_get(("c3b-n3-tp2-takes-seat0" + k).c_str(), 3, 3, 2, 0, g);
			check_get(("c3c-n4-tp2-takes-seat1" + k).c_str(), 4, 3, 2, 1, g);
			check_swap(("c3d-n4-tp3-swap-0-1" + k).c_str(), 4, 4, 0, 1, g);
		}
	}
	std::printf("%s: %d failure(s)\n", failures ? "FAIL" : "PASS", failures);
	return failures ? 1 : 0;
}
