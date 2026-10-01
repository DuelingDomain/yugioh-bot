// FX3 native check: response cursor after an elimination, PhaseEvent pass count, continuous-effect marker.
// Build and run: bash packages/duel-server/scripts/native/checks/run.sh <check name> (see README.md).
// Modes (each prints what it saw and a line "RESULT ... PASS|FAIL"; the exit code is the number of failures):
//   unit     direct next_responder() calls on a field with an eliminated duelist (FFA4 and Tag)
//   window   FFA4, seat 0 chains a spell, seat 1 is eliminated while its prompt is open (the response window)
//   phase    FFA4, Draw Phase window, seat 2 is eliminated while its prompt is open (PhaseEvent pass count)
//   conti2   FFA4, turn player 2: two continuous effects of other seats and one of the turn player, solve order
//   conti3   the same with turn player 3
//   passed   FFA4, Draw Phase window, seat 0 passes and is then eliminated (pass record of an eliminated duelist)
//   trigger  FFA4, four seats with two optional triggers each, seat 1 eliminated while its trigger prompt is open
//   all      every mode above
// A mode that is not fixed by the patch prints FAIL on the base library on purpose: that is the "before" proof.
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <map>
#include <string>
#include <vector>
#include "ocgapi.h"
#include "ocgapi_constants.h"
#include "effect_constants.h"
#include "duel.h"
#include "field.h"
#include "common.h"


static std::vector<std::string> g_trace; // script messages and our own notes, in order
static std::map<uint32_t, std::string> g_scripts;

static void read_card(void*, uint32_t code, OCG_CardData* data) {
	std::memset(data, 0, sizeof(*data));
	data->code = code;
	if(code == 100) {
		data->type = TYPE_SPELL;
		return;
	}
	if(code == 106) {
		data->type = TYPE_SPELL;
		return;
	}
	data->type = TYPE_MONSTER | ((code == 101 || code == 103 || code == 104 || code == 105) ? TYPE_EFFECT : TYPE_NORMAL);
	data->level = 4;
	data->attribute = 1;
	data->race = 1;
	data->attack = 1000;
	data->defense = 1000;
}
static int read_script(void*, OCG_Duel d, const char* name) {
	const char* base = std::strrchr(name, '/');
	base = base ? base + 1 : name;
	unsigned code = 0;
	if(std::sscanf(base, "c%u.lua", &code) != 1)
		return 0;
	auto it = g_scripts.find(code);
	if(it == g_scripts.end())
		return 0;
	return OCG_LoadScript(d, it->second.data(), static_cast<uint32_t>(it->second.size()), name);
}
static void on_log(void*, const char* text, int type) {
	g_trace.push_back(std::string("log: ") + (text ? text : ""));
	if(std::getenv("CHECK_LOG"))
		std::fprintf(stderr, "core log [%d]: %s\n", type, text ? text : "");
}

static std::string prelude() {
	char b[1280];
	std::snprintf(b, sizeof(b),
	              "EFFECT_TYPE_ACTIVATE=%d EFFECT_TYPE_QUICK_O=%d EFFECT_TYPE_FIELD=%d EFFECT_TYPE_CONTINUOUS=%d\n"
	              "EVENT_FREE_CHAIN=%d EVENT_DRAW=%d EVENT_RECOVER=%d EFFECT_FLAG_DELAY=%d LOCATION_HAND=%d REASON_EFFECT=%d\n"
	              "EFFECT_TYPE_TRIGGER_O=%d LOCATION_MZONE=%d\n",
	              EFFECT_TYPE_ACTIVATE, EFFECT_TYPE_QUICK_O, EFFECT_TYPE_FIELD, EFFECT_TYPE_CONTINUOUS, EVENT_FREE_CHAIN, EVENT_DRAW,
	              EVENT_RECOVER, static_cast<int>(EFFECT_FLAG_DELAY), LOCATION_HAND, REASON_EFFECT, EFFECT_TYPE_TRIGGER_O, LOCATION_MZONE);
	return b;
}
static void init_scripts() {
	// 100: a Spell that is activated from the hand; it makes seat 0 draw (EVENT_DRAW).
	g_scripts[100] =
	    "function c100.initial_effect(c)\n"
	    " local e1=Effect.CreateEffect(c)\n e1:SetType(EFFECT_TYPE_ACTIVATE)\n e1:SetCode(EVENT_FREE_CHAIN)\n"
	    " e1:SetOperation(function(e,tp) Debug.Message('c100 resolves') Duel.Draw(0,1,REASON_EFFECT) end)\n"
	    " c:RegisterEffect(e1)\nend\n";
	// 101: a hand quick effect that can only be used while a chain exists (not in the idle list).
	g_scripts[101] =
	    "function c101.initial_effect(c)\n"
	    " local e1=Effect.CreateEffect(c)\n e1:SetType(EFFECT_TYPE_QUICK_O)\n e1:SetCode(EVENT_FREE_CHAIN)\n e1:SetRange(LOCATION_HAND)\n"
	    " e1:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)\n"
	    " e1:SetOperation(function(e,tp) end)\n c:RegisterEffect(e1)\nend\n";
	// 104 and 105: face-up monsters with an optional field trigger on a custom event (two per seat, so the trigger window
	// is a real SELECT_CHAIN prompt and not a yes/no question).
	for(unsigned code : {104u, 105u})
		g_scripts[code] =
		    "function c" + std::to_string(code) + ".initial_effect(c)\n"
		    " local e1=Effect.CreateEffect(c)\n e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_O)\n e1:SetCode(1000000001)\n"
		    " e1:SetRange(LOCATION_MZONE)\n e1:SetProperty(EFFECT_FLAG_DELAY)\n e1:SetOperation(function(e,tp) end)\n"
		    " c:RegisterEffect(e1)\nend\n";
	// 106: a Spell that raises that custom event when it resolves.
	g_scripts[106] =
	    "function c106.initial_effect(c)\n"
	    " local e1=Effect.CreateEffect(c)\n e1:SetType(EFFECT_TYPE_ACTIVATE)\n e1:SetCode(EVENT_FREE_CHAIN)\n"
	    " e1:SetOperation(function(e,tp) Duel.RaiseEvent(e:GetHandler(),1000000001,e,0,tp,tp,0) end)\n"
	    " c:RegisterEffect(e1)\nend\n";
	// 103: the same without the condition (it is offered in the phase windows).
	g_scripts[103] =
	    "function c103.initial_effect(c)\n"
	    " local e1=Effect.CreateEffect(c)\n e1:SetType(EFFECT_TYPE_QUICK_O)\n e1:SetCode(EVENT_FREE_CHAIN)\n e1:SetRange(LOCATION_HAND)\n"
	    " e1:SetOperation(function(e,tp) end)\n c:RegisterEffect(e1)\nend\n";
}

static OCG_Duel make_duel(int start_count = 5) {
	OCG_DuelOptions options;
	std::memset(&options, 0, sizeof(options));
	options.seed[0] = 1;
	options.seed[1] = 2;
	options.seed[2] = 3;
	options.seed[3] = 4;
	options.flags = DUEL_MODE_MR5;
	options.team1 = {8000, static_cast<uint32_t>(start_count), 1};
	options.team2 = {8000, static_cast<uint32_t>(start_count), 1};
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
	return OCG_LoadScript(d, code.c_str(), static_cast<uint32_t>(code.size()), "check.lua") != 0;
}
static void add_cards(OCG_Duel d, uint8_t seat, uint32_t loc, int count, uint32_t code, uint32_t pos = POS_FACEDOWN_DEFENSE, uint32_t seq0 = 0) {
	for(int i = 0; i < count; ++i) {
		OCG_NewCardInfo info;
		std::memset(&info, 0, sizeof(info));
		info.team = seat;
		info.duelist = 0;
		info.code = code;
		info.con = seat;
		info.loc = loc;
		info.seq = seq0 + i;
		info.pos = pos;
		OCG_DuelNewCard(d, &info);
	}
}
// A FFA4 duel: SetupDuelists, the prelude, 40 filler cards per seat, then hand[seat] = list of extra hand codes.
static OCG_Duel make_ffa4(const std::vector<std::vector<uint32_t>>& hand, int start_count = 5, const std::string& extra_lua = "",
                          const std::vector<std::vector<uint32_t>>& mzone = {}) {
	OCG_Duel d = make_duel(start_count);
	if(!run_lua(d, "Debug.SetupDuelists(4,0,1,2,3)") || !run_lua(d, prelude())) {
		std::printf("FAIL: setup\n");
		std::exit(2);
	}
	if(!extra_lua.empty() && !run_lua(d, extra_lua)) {
		std::printf("FAIL: extra lua\n");
		std::exit(2);
	}
	for(uint8_t s = 0; s < 4; ++s) {
		add_cards(d, s, LOCATION_DECK, 40, 1);
		for(uint32_t code : hand[s])
			add_cards(d, s, LOCATION_HAND, 1, code);
		if(s < mzone.size())
			for(size_t i = 0; i < mzone[s].size(); ++i)
				add_cards(d, s, LOCATION_MZONE, 1, mzone[s][i], POS_FACEUP_ATTACK, static_cast<uint32_t>(i));
	}
	OCG_StartDuel(d);
	return d;
}

struct Msg {
	uint8_t id;
	uint8_t b1; // first payload byte (the seat for a prompt)
	uint8_t b2; // second payload byte (spe_count for MSG_SELECT_CHAIN: 0x7f in a trigger window)
};
static int advance(OCG_Duel d, std::vector<Msg>& msgs) {
	msgs.clear();
	const int status = OCG_DuelProcess(d);
	uint32_t length = 0;
	const auto* buf = static_cast<const uint8_t*>(OCG_DuelGetMessage(d, &length));
	for(uint32_t off = 0; off + 4 <= length;) {
		uint32_t size = 0;
		std::memcpy(&size, buf + off, 4);
		if(size > 0)
			msgs.push_back({buf[off + 4], size > 1 ? buf[off + 5] : uint8_t(0), size > 2 ? buf[off + 6] : uint8_t(0)});
		off += 4 + size;
	}
	return status;
}
static void answer_i32(OCG_Duel d, int32_t v) { OCG_DuelSetResponse(d, &v, sizeof(v)); }
static void answer_u32(OCG_Duel d, uint32_t v) { OCG_DuelSetResponse(d, &v, sizeof(v)); }
// Default answer for a prompt that the scenario does not care about. Returns false for a prompt it cannot answer.
static bool answer_default(OCG_Duel d, const Msg& m) {
	if(m.id == MSG_SELECT_CHAIN)
		answer_i32(d, -1);
	else if(m.id == MSG_SELECT_IDLECMD)
		answer_u32(d, 7);
	else if(m.id == MSG_SELECT_PLACE) {
		const uint8_t place[3] = {m.b1, LOCATION_SZONE, 0}; // own side, first Spell zone
		OCG_DuelSetResponse(d, place, sizeof(place));
	} else
		return false;
	return true;
}
static std::string seats(const std::vector<int>& v) {
	std::string s;
	for(size_t i = 0; i < v.size(); ++i)
		s += (i ? " " : "") + std::to_string(v[i]);
	return s.empty() ? "(none)" : s;
}

// ---- unit: next_responder with an eliminated cursor
static void mode_unit() {
	OCG_Duel d = make_duel();
	run_lua(d, "Debug.SetupDuelists(4,0,1,2,3)");
	auto& f = F(d);
	f.infos.turn_player = 0;
	f.core.response_anchor = 0; // the turn player chained: order 1 2 3 0
	for(auto& p : f.infos.priorities)
		p = 0;
	f.player[1].eliminated = true;
	f.infos.priorities[1] = 1;
	const uint8_t a = f.next_responder(1);
	std::printf("FFA4 tp 0, anchor 0 (order 1 2 3 0), seat 1 eliminated and passed: next_responder(1) = %d\n", a);
	EXPECT(a == 2, "next_responder(1) = %d, want 2", a);
	// The seat before the dead one still works, and so does the one after.
	f.infos.priorities[1] = 0;
	const uint8_t b = f.next_responder(0);
	std::printf("  next_responder(0) = %d (0 is the last in the order: %d = DUELIST_NONE)\n", b, DUELIST_NONE);
	EXPECT(b == DUELIST_NONE, "next_responder(0) = %d", b);
	// Dead cursor in the middle, a later seat has passed: skip it.
	f.player[2].eliminated = false;
	f.player[1].eliminated = true;
	f.infos.priorities[2] = 1;
	const uint8_t c = f.next_responder(1);
	std::printf("  seat 2 already passed: next_responder(1) = %d (want 3)\n", c);
	EXPECT(c == 3, "next_responder(1) with seat 2 passed = %d", c);
	// Dead cursor is the last in the order: nothing after it.
	f.infos.priorities[2] = 0;
	f.player[1].eliminated = false;
	f.player[0].eliminated = true;
	const uint8_t e = f.next_responder(0);
	std::printf("  seat 0 (last in the order) eliminated: next_responder(0) = %d (want %d)\n", e, DUELIST_NONE);
	EXPECT(e == DUELIST_NONE, "next_responder(0) dead last = %d", e);
	OCG_DestroyDuel(d);

	// Tag: seat 1 chained (anchor 1), order 2 0 3 1. Seat 0 is eliminated: a team is out, but only one seat is marked here.
	d = make_duel();
	run_lua(d, "Debug.SetupDuelists(4,0,1,0,1)");
	auto& g = F(d);
	g.infos.turn_player = 1;
	g.core.response_anchor = 1;
	for(auto& p : g.infos.priorities)
		p = 0;
	g.player[0].eliminated = true;
	g.infos.priorities[0] = 1;
	const uint8_t t = g.next_responder(0);
	std::printf("Tag, anchor 1 (order 2 0 3 1), seat 0 eliminated and passed: next_responder(0) = %d (want 3)\n", t);
	EXPECT(t == 3, "tag next_responder(0) = %d", t);
	OCG_DestroyDuel(d);
	std::printf("RESULT unit %s\n", failures ? "FAIL" : "PASS");
}

// ---- window: a priority window with an eliminated cursor
static void mode_window() {
	// Seat 0 holds the Spell. Every seat holds a hand quick effect that only works while a chain exists.
	OCG_Duel d = make_ffa4({{100, 101}, {101}, {101}, {101}});
	std::vector<Msg> msgs;
	bool activated = false, killed = false, in_chain = false, solved = false;
	std::vector<int> prompts;
	int steps = 0;
	for(; steps < 4000; ++steps) {
		const int status = advance(d, msgs);
		for(const auto& m : msgs) {
			if(m.id == MSG_CHAINING)
				in_chain = true;
			if(m.id == MSG_CHAIN_SOLVING) {
				in_chain = false;
				solved = true; // only the window of the link is counted; later windows are another question
			}
		}
		if(status == OCG_DUEL_STATUS_END || (activated && !in_chain && !prompts.empty() && status == OCG_DUEL_STATUS_CONTINUE && false))
			break;
		if(status != OCG_DUEL_STATUS_AWAITING)
			continue;
		const Msg last = msgs.back();
		if(last.id == MSG_SELECT_IDLECMD && last.b1 == 0 && !activated) {
			activated = true;
			answer_u32(d, (0u << 16) | 5u);
			continue;
		}
		if(last.id == MSG_SELECT_CHAIN && activated) {
			if(!solved)
				prompts.push_back(last.b1);
			if(last.b1 == 1 && !killed) {
				F(d).player[1].eliminated = true; // seat 1 is eliminated while its prompt is open
				killed = true;
			}
			answer_i32(d, -1);
			continue;
		}
		if(activated && !in_chain && last.id == MSG_SELECT_IDLECMD)
			break;
		if(!answer_default(d, last)) {
			std::printf("stop: prompt %d not handled\n", last.id);
			break;
		}
	}
	std::printf("FFA4, seat 0 chains, seat 1 eliminated at its prompt. Prompts after the link: %s\n", seats(prompts).c_str());
	const std::vector<int> want{1, 2, 3, 0};
	EXPECT(prompts == want, "prompts %s, want 1 2 3 0", seats(prompts).c_str());
	std::printf("RESULT window %s\n", prompts == want ? "PASS" : "FAIL");
	OCG_DestroyDuel(d);
}

// ---- phase: PhaseEvent pass count with an eliminated cursor
// kill_seat is eliminated when the prompt of seat kill_at is open (a seat that is asked first and passed when
// kill_seat != kill_at, or the one that is asked when they are equal).
static void mode_phase(int kill_seat, int kill_at, const char* name) {
	OCG_Duel d = make_ffa4({{103}, {103}, {103}, {103}});
	std::vector<Msg> msgs;
	bool killed = false;
	std::vector<int> prompts; // seats asked in the first phase window (until the next MSG_NEW_PHASE or idle)
	std::vector<int> all;     // every prompt up to the first idle prompt
	int windows_seen = 0;
	for(int steps = 0; steps < 4000; ++steps) {
		const int status = advance(d, msgs);
		for(const auto& m : msgs)
			if(m.id == MSG_NEW_PHASE && !prompts.empty())
				++windows_seen;
		if(status == OCG_DUEL_STATUS_END)
			break;
		if(status != OCG_DUEL_STATUS_AWAITING)
			continue;
		const Msg last = msgs.back();
		if(last.id == MSG_SELECT_IDLECMD)
			break;
		if(last.id == MSG_SELECT_CHAIN) {
			all.push_back(last.b1);
			if(windows_seen == 0)
				prompts.push_back(last.b1);
			if(last.b1 == kill_at && !killed) {
				F(d).player[kill_seat].eliminated = true; // eliminated while the prompt of seat kill_at is open
				killed = true;
			}
			answer_i32(d, -1);
			continue;
		}
		if(!answer_default(d, last)) {
			std::printf("stop: prompt %d not handled\n", last.id);
			break;
		}
	}
	std::printf("FFA4 phase windows before the first idle prompt, seat %d eliminated at the first prompt of seat %d.\n", kill_seat, kill_at);
	std::printf("  first window: %s\n  all prompts to the first idle: %s\n", seats(prompts).c_str(), seats(all).c_str());
	const std::vector<int> want{0, 1, 2, 3};
	EXPECT(prompts == want, "first window prompts %s, want 0 1 2 3", seats(prompts).c_str());
	std::printf("RESULT %s %s\n", name, prompts == want ? "PASS" : "FAIL");
	OCG_DestroyDuel(d);
}

// ---- trigger: a trigger window with an eliminated cursor
static void mode_trigger() {
	std::vector<std::vector<uint32_t>> hand(4), mzone(4, std::vector<uint32_t>{104, 105});
	hand[0] = {106};
	OCG_Duel d = make_ffa4(hand, 5, "", mzone);
	std::vector<Msg> msgs;
	bool activated = false, killed = false;
	std::vector<int> prompts; // seats asked in the trigger window (SELECT_CHAIN with spe_count 0x7f)
	for(int steps = 0; steps < 4000; ++steps) {
		const int status = advance(d, msgs);
		if(status == OCG_DUEL_STATUS_END)
			break;
		if(status != OCG_DUEL_STATUS_AWAITING)
			continue;
		const Msg last = msgs.back();
		if(last.id == MSG_SELECT_IDLECMD && last.b1 == 0 && !activated) {
			activated = true;
			answer_u32(d, (0u << 16) | 5u);
			continue;
		}
		if(activated && last.id == MSG_SELECT_IDLECMD)
			break;
		if(last.id == MSG_SELECT_CHAIN && activated && last.b2 == 0x7f) {
			prompts.push_back(last.b1);
			if(last.b1 == 1 && !killed) {
				F(d).player[1].eliminated = true; // seat 1 is eliminated while its trigger prompt is open
				killed = true;
			}
			answer_i32(d, -1);
			continue;
		}
		if(!answer_default(d, last)) {
			std::printf("stop: prompt %d not handled\n", last.id);
			break;
		}
	}
	std::printf("FFA4, seat 0 resolves a Spell that raises an event; every seat has two optional triggers; seat 1 eliminated at its trigger prompt.\n  trigger prompts: %s\n", seats(prompts).c_str());
	const std::vector<int> want{0, 1, 2, 3};
	EXPECT(prompts == want, "trigger prompts %s, want 0 1 2 3", seats(prompts).c_str());
	std::printf("RESULT trigger %s\n", prompts == want ? "PASS" : "FAIL");
	OCG_DestroyDuel(d);
}

// ---- conti: the solve order of delayed continuous effects
static void mode_conti(int tp) {
	// N1 (seat 0) and N2 (seat 1) react to the draw; N1 makes seat 0 recover, which triggers T (the turn player's effect).
	std::string lua =
	    "local function reg(code,owner,name,extra)\n"
	    " local e=Effect.GlobalEffect()\n e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)\n e:SetCode(code)\n"
	    " e:SetProperty(EFFECT_FLAG_DELAY)\n"
	    " e:SetOperation(function() Debug.Message(name) extra() end)\n Duel.RegisterEffect(e,owner)\nend\n"
	    "reg(EVENT_DRAW,0,'N1 (seat 0) solves',function() Duel.Recover(0,100,REASON_EFFECT) end)\n"
	    "reg(EVENT_DRAW,1,'N2 (seat 1) solves',function() end)\n"
	    "reg(EVENT_RECOVER," + std::to_string(tp) + ",'T (turn player, seat " + std::to_string(tp) + ") solves',function() end)\n";
	std::vector<std::vector<uint32_t>> hand(4);
	hand[tp] = {100};
	OCG_Duel d = make_ffa4(hand, 3, lua);
	std::vector<Msg> msgs;
	bool activated = false, over = false;
	for(int steps = 0; steps < 6000 && !over; ++steps) {
		const int status = advance(d, msgs);
		if(status == OCG_DUEL_STATUS_END)
			break;
		if(status != OCG_DUEL_STATUS_AWAITING)
			continue;
		const Msg last = msgs.back();
		if(last.id == MSG_SELECT_IDLECMD && last.b1 == tp && F(d).infos.turn_player == tp && !activated) {
			activated = true;
			g_trace.clear(); // the draw phases of earlier turns also raise EVENT_DRAW; count only the Spell's own chain
			answer_u32(d, (0u << 16) | 5u);
			continue;
		}
		if(activated && last.id == MSG_SELECT_IDLECMD) {
			over = true;
			break;
		}
		if(!answer_default(d, last)) {
			std::printf("stop: prompt %d not handled\n", last.id);
			break;
		}
	}
	std::vector<std::string> order;
	for(const auto& t : g_trace)
		if(t.find("c100") == std::string::npos && t.find(" solves") != std::string::npos)
			order.push_back(t.substr(5));
	std::printf("FFA4 turn player %d (turn %d), activated %d. Solve order:", tp, F(d).infos.turn_id, activated);
	for(const auto& o : order)
		std::printf("  [%s]", o.c_str());
	std::printf("\n");
	const std::vector<std::string> want{"N1 (seat 0) solves", "N2 (seat 1) solves", "T (turn player, seat " + std::to_string(tp) + ") solves"};
	EXPECT(order == want, "solve order differs from: other seats first, in order, then the turn player's effect that was raised by them");
	std::printf("RESULT conti%d %s\n", tp, order == want ? "PASS" : "FAIL");
	OCG_DestroyDuel(d);
}

int main(int argc, char** argv) {
	const std::string mode = argc > 1 ? argv[1] : "all";
	init_scripts();
	const bool all = mode == "all";
	if(all || mode == "unit")
		mode_unit();
	if(all || mode == "window")
		mode_window();
	if(all || mode == "phase")
		mode_phase(2, 2, "phase");
	if(all || mode == "passed")
		mode_phase(0, 1, "passed");
	if(all || mode == "trigger")
		mode_trigger();
	if(all || mode == "conti2") {
		g_trace.clear();
		mode_conti(2);
	}
	if(all || mode == "conti3") {
		g_trace.clear();
		mode_conti(3);
	}
	std::printf("%s: %d failure(s)\n", failures ? "FAIL" : "PASS", failures);
	return failures;
}
