// FX8 native check: Lua library sites at n > 2 (libduel.cpp, playerop.cpp).
// Build and run: bash packages/duel-server/scripts/native/checks/run.sh <check name> (see README.md).
// Modes (each prints DATA lines and "RESULT <name> PASS|FAIL"; the exit code is the number of failures):
//   disf    Duel.SelectDisableField (the trap site libduel.cpp:3361 of the base): the opponent half of the mask
//           is the next living duelist in turn order. n=3 seat 2, n=4 seat 3, n=3 with seat 1 eliminated, and n=2.
//   top     Duel.GetDecktopGroup / GetDeckbottomGroup / GetExtraTopGroup with a value that is not a seat (base crash)
//   env     Duel.GetEnvironment with a Field Spell in the Field Zone of seat 2 / seat 3
//   rel     Duel.CheckReleaseGroup / SelectReleaseGroup with seat 2 (stock test accepted only 0 and 1)
//   cnt     Duel.RemoveCounter in a Tag duel: the partner's counters are own side (SelectCounter prompt lists them)
//   act     Duel.GetCustomActivityCount with a value that is not a seat
//   abs     Effect.SetAbsoluteRange(seat, 1, 0): the stored ranges stay relative to the owner at n > 2 (no swap)
//   dd/tr/uq  DiscardDeck, CheckTribute (toplayer) and Card.CheckUniqueOnField with 255 (not a seat), one mode each
//   n2      disf/top/env/rel/abs at n == 2 (the DATA lines must be identical on both libraries)
//   all     every mode above
// A mode that the patch fixes prints FAIL (or crashes) on the "before" library on purpose: that is the "before" proof.
#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include "ocgapi.h"
#include "ocgapi_constants.h"
#include "effect_constants.h"
#include "duel.h"
#include "field.h"
#include "card.h"
#include "effect.h"
#include "common.h"


static std::vector<std::string> g_log; // script messages (Debug.Message), in order

static void read_card(void*, uint32_t code, OCG_CardData* data) {
	std::memset(data, 0, sizeof(*data));
	data->code = code;
	data->type = TYPE_MONSTER | TYPE_NORMAL;
	data->level = 4;
	data->attribute = 1;
	data->race = 1;
	data->attack = 1000;
	data->defense = 1000;
}
static int read_script(void*, OCG_Duel, const char*) { return 0; }
static void on_log(void*, const char* text, int type) {
	g_log.push_back(text ? text : "");
	if(std::getenv("CHECK_LOG"))
		std::fprintf(stderr, "core log [%d]: %s\n", type, text ? text : "");
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
	return OCG_LoadScript(d, code.c_str(), static_cast<uint32_t>(code.size()), "check.lua") != 0;
}
static void add_deck(OCG_Duel d, uint8_t seat, int count) {
	for(int i = 0; i < count; ++i) {
		OCG_NewCardInfo info;
		std::memset(&info, 0, sizeof(info));
		info.team = seat;
		info.duelist = 0;
		info.code = 1;
		info.con = seat;
		info.loc = LOCATION_DECK;
		info.pos = POS_FACEDOWN_DEFENSE;
		OCG_DuelNewCard(d, &info);
	}
}
static std::string prelude() {
	char b[2048];
	std::snprintf(b, sizeof(b),
	              "EFFECT_TYPE_SINGLE=%d EFFECT_TYPE_FIELD=%d EFFECT_TYPE_CONTINUOUS=%d EFFECT_COUNTER_PERMIT=%d\n"
	              "EVENT_PHASE_START=%d PHASE_DRAW=%d ACTIVITY_SUMMON=%d\n"
	              "LOCATION_HAND=%d LOCATION_MZONE=%d LOCATION_FZONE=%d LOCATION_GRAVE=%d REASON_COST=%d REASON_EFFECT=%d\n"
	              "POS_FACEUP=%d POS_FACEUP_ATTACK=%d\n",
	              EFFECT_TYPE_SINGLE, EFFECT_TYPE_FIELD, EFFECT_TYPE_CONTINUOUS, EFFECT_COUNTER_PERMIT,
	              EVENT_PHASE_START, PHASE_DRAW, static_cast<int>(ACTIVITY_SUMMON),
	              LOCATION_HAND, LOCATION_MZONE, LOCATION_FZONE, LOCATION_GRAVE, REASON_COST, REASON_EFFECT,
	              POS_FACEUP, POS_FACEUP_ATTACK);
	return b;
}
// n duelists with the given teams (empty: team = seat). n == 2: no setup call.
static OCG_Duel make_n(int n, const std::string& lua, std::vector<int> teams = {}) {
	OCG_Duel d = make_duel(7);
	if(n > 2) {
		if(teams.empty())
			for(int t = 0; t < n; ++t)
				teams.push_back(t);
		std::string call = "Debug.SetupDuelists(" + std::to_string(n);
		for(int t : teams)
			call += "," + std::to_string(t);
		call += ")";
		if(!run_lua(d, call)) {
			std::printf("FAIL: %s\n", call.c_str());
			std::exit(2);
		}
	}
	if(!run_lua(d, prelude())) {
		std::printf("FAIL: prelude\n");
		std::exit(2);
	}
	if(!lua.empty() && !run_lua(d, lua)) {
		std::printf("FAIL: scenario lua\n");
		std::exit(2);
	}
	for(int s = 0; s < n; ++s)
		add_deck(d, static_cast<uint8_t>(s), 40);
	return d;
}

struct Msg {
	uint8_t id;
	std::vector<uint8_t> data; // payload after the id
};
static std::vector<Msg> parse(const uint8_t* buffer, uint32_t from, uint32_t length) {
	std::vector<Msg> out;
	for(uint32_t offset = from; offset + 4 <= length;) {
		uint32_t size = 0;
		std::memcpy(&size, buffer + offset, 4);
		if(size > 0)
			out.push_back({buffer[offset + 4], std::vector<uint8_t>(buffer + offset + 5, buffer + offset + 4 + size)});
		offset += 4 + size;
	}
	return out;
}
// Runs until the core waits for an answer (any prompt) or the duel ends. Returns every message of the run.
static std::vector<Msg> run_until_prompt(OCG_Duel d) {
	std::vector<Msg> all;
	for(int i = 0; i < 2000; ++i) {
		const int status = OCG_DuelProcess(d);
		uint32_t length = 0;
		const auto* buf = static_cast<const uint8_t*>(OCG_DuelGetMessage(d, &length));
		auto msgs = parse(buf, 0, length);
		all.insert(all.end(), msgs.begin(), msgs.end());
		if(status == OCG_DUEL_STATUS_END || status == OCG_DUEL_STATUS_AWAITING)
			break;
	}
	return all;
}
// A global effect that runs `body` at the start of the Draw Phase of the first turn (turn player 0).
static std::string driver(const std::string& body) {
	return "local d=Effect.GlobalEffect()\n d:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)\n"
	       " d:SetCode(EVENT_PHASE_START+PHASE_DRAW)\n d:SetOperation(function()\n Debug.Message('driver')\n" + body +
	       "\n end)\n Duel.RegisterEffect(d,0)\n";
}
static std::string add_mon(int code, int owner, int zone) {
	return "Debug.AddCard(" + std::to_string(code) + "," + std::to_string(owner) + "," + std::to_string(owner) +
	       ",LOCATION_MZONE," + std::to_string(zone) + ",POS_FACEUP_ATTACK)\n";
}
static std::vector<std::string> driver_log() {
	std::vector<std::string> out;
	bool in = false;
	for(auto& l : g_log) {
		if(l == "driver")
			in = true;
		else if(in)
			out.push_back(l);
	}
	return out;
}
static bool has(const std::vector<std::string>& v, const std::string& s) {
	return std::find(v.begin(), v.end(), s) != v.end();
}

// ---- disf: Duel.SelectDisableField(playerid, 1, 0, LOCATION_MZONE, 0). The prompt flag has the own zones in the low
// 16 bits and the zones of ONE opponent in the high half. A set bit = not selectable (occupied).
struct Disf {
	bool prompt = false;
	int player = -1;
	uint32_t flag = 0;
};
static Disf disf_case(const char* label, int n, int caller, int eliminated, const std::vector<std::pair<int, int>>& monsters) {
	g_log.clear();
	std::string lua;
	for(auto& m : monsters)
		lua += add_mon(21 + m.first, m.first, m.second);
	lua += driver("Duel.SelectDisableField(" + std::to_string(caller) + ",1,0,LOCATION_MZONE,0)");
	OCG_Duel d = make_n(n, lua);
	if(eliminated >= 0)
		F(d).player[eliminated].eliminated = true;
	OCG_StartDuel(d);
	Disf r;
	for(auto& m : run_until_prompt(d)) {
		if(m.id == MSG_SELECT_DISFIELD) {
			r.prompt = true;
			r.player = m.data[0];
			std::memcpy(&r.flag, m.data.data() + 2, 4);
		}
	}
	OCG_DestroyDuel(d);
	std::printf("DATA disf %s: n=%d caller=%d eliminated=%d -> prompt=%d player=%d flag=%08x\n", label, n, caller, eliminated, r.prompt, r.player, r.flag);
	return r;
}
static void mode_disf() {
	const int before = failures;
	// n=3, seat 2 asks. The next duelist in turn order is seat 0 (not seat 1, not seat 255).
	// Seat 0 has a monster in zone 0, seat 1 in zone 1: only zone 0 may be marked in the opponent half (bit 16).
	auto a = disf_case("n3-seat2", 3, 2, -1, {{0, 0}, {1, 1}});
	EXPECT(a.prompt && a.player == 2, "n3-seat2: prompt to seat 2");
	EXPECT((a.flag & 0x10000u) != 0, "n3-seat2: seat 0 zone 0 (occupied) must be marked");
	EXPECT((a.flag & 0x20000u) == 0, "n3-seat2: seat 1 zone 1 must NOT be in the opponent half");
	// n=4, seat 3 asks: next is seat 0.
	auto b = disf_case("n4-seat3", 4, 3, -1, {{0, 2}, {1, 3}, {2, 4}});
	EXPECT(b.prompt && b.player == 3, "n4-seat3: prompt to seat 3");
	EXPECT((b.flag & 0x40000u) != 0, "n4-seat3: seat 0 zone 2 must be marked");
	EXPECT((b.flag & 0x80000u) == 0 && (b.flag & 0x100000u) == 0, "n4-seat3: zones of seats 1 and 2 must not be in the opponent half");
	// n=3, seat 1 eliminated before the first turn, seat 0 asks: the next LIVING duelist is seat 2 (not seat 1).
	auto c = disf_case("n3-seat1-dead", 3, 0, 1, {{1, 2}, {2, 3}});
	EXPECT(c.prompt && c.player == 0, "n3-dead: prompt to seat 0");
	EXPECT((c.flag & 0x80000u) != 0, "n3-dead: seat 2 zone 3 must be marked");
	EXPECT((c.flag & 0x40000u) == 0, "n3-dead: the eliminated seat 1 zone 2 must NOT be in the opponent half");
	std::printf("RESULT disf %s\n", failures == before ? "PASS" : "FAIL");
}

// ---- top: Lua values that are not a seat must give an empty group and no read out of range
static void mode_top() {
	const int before = failures;
	g_log.clear();
	OCG_Duel d = make_n(4, driver(
	    "local a=Duel.GetDecktopGroup(255,3) Debug.Message('top255 '..a:GetCount())\n"
	    "local b=Duel.GetDeckbottomGroup(254,2) Debug.Message('bottom254 '..b:GetCount())\n"
	    "local c=Duel.GetExtraTopGroup(4,1) Debug.Message('extra4 '..c:GetCount())\n"
	    "local e=Duel.GetDecktopGroup(3,3) Debug.Message('top3 '..e:GetCount())"));
	OCG_StartDuel(d);
	run_until_prompt(d);
	OCG_DestroyDuel(d);
	auto out = driver_log();
	for(auto& l : out)
		std::printf("DATA top: %s\n", l.c_str());
	EXPECT(has(out, "top255 0"), "GetDecktopGroup(255) must be an empty group");
	EXPECT(has(out, "bottom254 0"), "GetDeckbottomGroup(254) must be an empty group");
	EXPECT(has(out, "extra4 0"), "GetExtraTopGroup(4) must be an empty group");
	EXPECT(has(out, "top3 3"), "GetDecktopGroup(3,3) of a real seat must still give 3 cards");
	std::printf("RESULT top %s\n", failures == before ? "PASS" : "FAIL");
}

// ---- env: a face-up Field Spell in the Field Zone of seat 2 (n=3) and seat 3 (n=4)
static std::vector<std::string> env_run(int n, int seat) {
	g_log.clear();
	std::string lua = "Debug.AddCard(77," + std::to_string(seat) + "," + std::to_string(seat) + ",LOCATION_FZONE,0,POS_FACEUP)\n";
	lua += driver("local code,p=Duel.GetEnvironment() Debug.Message('env '..code..' '..p)");
	OCG_Duel d = make_n(n, lua);
	OCG_StartDuel(d);
	run_until_prompt(d);
	OCG_DestroyDuel(d);
	auto out = driver_log();
	for(auto& l : out)
		std::printf("DATA env n=%d seat=%d: %s\n", n, seat, l.c_str());
	return out;
}
static void mode_env() {
	const int before = failures;
	EXPECT(has(env_run(3, 2), "env 77 2"), "n=3: the Field Spell of seat 2 must give environment 77, controller 2");
	EXPECT(has(env_run(4, 3), "env 77 3"), "n=4: the Field Spell of seat 3 must give environment 77, controller 3");
	EXPECT(has(env_run(4, 1), "env 77 1"), "n=4: the Field Spell of seat 1 (control)");
	std::printf("RESULT env %s\n", failures == before ? "PASS" : "FAIL");
}

// ---- rel: seat 2 has a monster that it can release
static std::vector<std::string> rel_run(int n, int seat) {
	g_log.clear();
	std::string lua = add_mon(31, seat, 0);
	lua += driver(
	    "local r=Duel.CheckReleaseGroup(" + std::to_string(seat) + ",function() return true end,1,nil)\n"
	    "Debug.Message('check '..type(r)..' '..tostring(r))\n"
	    "local g=Duel.SelectReleaseGroup(" + std::to_string(seat) + ",function() return true end,1,1,nil)\n"
	    "Debug.Message('select '..type(g)..' '..(g and g:GetCount() or -1))");
	OCG_Duel d = make_n(n, lua);
	OCG_StartDuel(d);
	run_until_prompt(d);
	OCG_DestroyDuel(d);
	auto out = driver_log();
	for(auto& l : out)
		std::printf("DATA rel n=%d seat=%d: %s\n", n, seat, l.c_str());
	return out;
}
static void mode_rel() {
	const int before = failures;
	auto a = rel_run(3, 2);
	EXPECT(has(a, "check boolean true"), "n=3: CheckReleaseGroup for seat 2 must answer true (monster in the zone)");
	auto b = rel_run(4, 3);
	EXPECT(has(b, "check boolean true"), "n=4: CheckReleaseGroup for seat 3 must answer true");
	auto c = rel_run(3, 1);
	EXPECT(has(c, "check boolean true"), "n=3: CheckReleaseGroup for seat 1 (control)");
	std::printf("RESULT rel %s\n", failures == before ? "PASS" : "FAIL");
}

// ---- cnt: Tag duel, seats 0 and 2 are partners (team = seat % 2). Both have a card with 1 counter.
// Duel.RemoveCounter(0, 1, 0, 0x1, 2, REASON_COST): own side only, count 2. The partner counts as own side, so the
// SelectCounter prompt must list both cards (2). Before the fix the partner was treated as an opponent: one card only.
static void mode_cnt() {
	const int before = failures;
	g_log.clear();
	std::string lua =
	    "local function permit(c)\n"
	    " local e=Effect.CreateEffect(c) e:SetType(EFFECT_TYPE_SINGLE) e:SetCode(EFFECT_COUNTER_PERMIT+0x1)\n"
	    " e:SetRange(LOCATION_MZONE) e:SetValue(LOCATION_MZONE) c:RegisterEffect(e)\n"
	    "end\n";
	lua += "local A=Debug.AddCard(41,0,0,LOCATION_MZONE,0,POS_FACEUP_ATTACK)\n"
	       "local B=Debug.AddCard(42,2,2,LOCATION_MZONE,0,POS_FACEUP_ATTACK)\n"
	       "permit(A) permit(B)\n";
	lua += driver(
	    "local a,b=A,B\n"
	    "Debug.Message('add '..tostring(a:AddCounter(0x1,1))..' '..tostring(b:AddCounter(0x1,1)))\n"
	    "Debug.Message('have '..Duel.GetCounter(0,1,0,0x1)..' a='..a:GetCounter(0x1)..' b='..b:GetCounter(0x1)..' fieldA='..a:GetLocation()..' fieldB='..b:GetLocation())\n"
	    "local ok=Duel.RemoveCounter(0,1,0,0x1,2,REASON_COST)\n"
	    "Debug.Message('removed '..tostring(ok)..' a='..a:GetCounter(0x1)..' b='..b:GetCounter(0x1)..' left='..Duel.GetCounter(0,1,1,0x1))");
	OCG_Duel d = make_n(4, lua, {0, 1, 0, 1});
	OCG_StartDuel(d);
	int cards = -1, prompts = 0;
	auto cnt_msgs = run_until_prompt(d);
	for(auto& m : cnt_msgs) {
		if(m.id == MSG_SELECT_COUNTER) {
			++prompts;
			uint32_t size = 0;
			std::memcpy(&size, m.data.data() + 5, 4);
			cards = static_cast<int>(size);
		}
	}
	OCG_DestroyDuel(d);
	for(auto& l : driver_log())
		std::printf("DATA cnt: %s\n", l.c_str());
	std::printf("DATA cnt: SELECT_COUNTER prompts=%d cards=%d\n", prompts, cards);
	EXPECT(has(driver_log(), "add true true") && has(driver_log(), "have 2 a=1 b=1 fieldA=4 fieldB=4"), "scenario: both cards got a counter (setup of the check)");
	EXPECT(prompts == 1 && cards == 2, "the prompt must list the card of the partner too (2 cards), got prompts=%d cards=%d", prompts, cards);
	std::printf("RESULT cnt %s\n", failures == before ? "PASS" : "FAIL");
}

// ---- act: a value that is not a seat must give 0
static void mode_act() {
	const int before = failures;
	g_log.clear();
	OCG_Duel d = make_n(3,
	    "Duel.AddCustomActivityCounter(5,ACTIVITY_SUMMON,function(c) return true end)\n" +
	    driver("Debug.Message('act255 '..Duel.GetCustomActivityCount(5,255,ACTIVITY_SUMMON))\n"
	           "Debug.Message('act2 '..Duel.GetCustomActivityCount(5,2,ACTIVITY_SUMMON))"));
	OCG_StartDuel(d);
	run_until_prompt(d);
	OCG_DestroyDuel(d);
	auto out = driver_log();
	for(auto& l : out)
		std::printf("DATA act: %s\n", l.c_str());
	EXPECT(has(out, "act255 0"), "GetCustomActivityCount for 255 must be 0");
	EXPECT(has(out, "act2 0"), "GetCustomActivityCount for seat 2 (nothing summoned) is 0");
	std::printf("RESULT act %s\n", failures == before ? "PASS" : "FAIL");
}


// ---- abs: Effect.SetAbsoluteRange(playerid, 1, 0). Stock swaps s and o for playerid != 0. At n > 2 no swap.
static void abs_case(const char* label, int n, int seat, int want_s, int want_o) {
	OCG_Duel d = make_n(n, "local e=Effect.GlobalEffect() e:SetCode(30583) e:SetAbsoluteRange(" + std::to_string(seat) + ",1,0)\n");
	int s = -1, o = -1, found = 0;
	for(effect* e : static_cast<duel*>(d)->effects) {
		if(e->code == 30583) {
			s = e->s_range;
			o = e->o_range;
			++found;
		}
	}
	OCG_DestroyDuel(d);
	std::printf("DATA abs %s: n=%d seat=%d -> s_range=%d o_range=%d\n", label, n, seat, s, o);
	EXPECT(found == 1 && s == want_s && o == want_o, "abs %s: want s=%d o=%d, got s=%d o=%d (found %d)", label, want_s, want_o, s, o, found);
}
static void mode_abs() {
	const int before = failures;
	abs_case("n3-seat2", 3, 2, 1, 0);
	abs_case("n4-seat3", 4, 3, 1, 0);
	abs_case("n3-seat0", 3, 0, 1, 0);
	std::printf("RESULT abs %s\n", failures == before ? "PASS" : "FAIL");
}

// ---- dd / tr / uq: a Lua value that is not a seat (255 = 1-tp at seat 2) must give the empty result, no crash
static std::vector<std::string> not_seat_run(int n, const std::string& body) {
	g_log.clear();
	OCG_Duel d = make_n(n, "local C=Debug.AddCard(31,2,2,LOCATION_HAND,0,POS_FACEUP_ATTACK)\n" + driver(body));
	OCG_StartDuel(d);
	run_until_prompt(d);
	OCG_DestroyDuel(d);
	return driver_log();
}
static void mode_dd() {
	const int before = failures;
	auto out = not_seat_run(4, "local r=Duel.DiscardDeck(255,2,REASON_EFFECT) Debug.Message('dd255 '..tostring(r))\n"
	                           "local q=Duel.DiscardDeck(2,2,REASON_EFFECT) Debug.Message('dd2 '..tostring(q))");
	for(auto& l : out)
		std::printf("DATA dd: %s\n", l.c_str());
	EXPECT(has(out, "dd255 0"), "DiscardDeck(255) must discard nothing");
	EXPECT(has(out, "dd2 2"), "DiscardDeck of a real seat still discards 2");
	std::printf("RESULT dd %s\n", failures == before ? "PASS" : "FAIL");
}
static void mode_tr() {
	const int before = failures;
	auto out = not_seat_run(4, "Debug.Message('tr255 '..tostring(Duel.CheckTribute(C,1,1,nil,255)))\n"
	                           "Debug.Message('tr254 '..tostring(Duel.CheckTribute(C,1,1,nil,254)))");
	for(auto& l : out)
		std::printf("DATA tr: %s\n", l.c_str());
	EXPECT(has(out, "tr255 false") && has(out, "tr254 false"), "CheckTribute with a toplayer that is not a seat must be false");
	std::printf("RESULT tr %s\n", failures == before ? "PASS" : "FAIL");
}
static void mode_uq() {
	const int before = failures;
	auto out = not_seat_run(4, "Debug.Message('uq255 '..tostring(C:CheckUniqueOnField(255)))\n"
	                           "Debug.Message('uq2 '..tostring(C:CheckUniqueOnField(2)))");
	for(auto& l : out)
		std::printf("DATA uq: %s\n", l.c_str());
	EXPECT(has(out, "uq255 true"), "CheckUniqueOnField(255): no card of that field can conflict");
	EXPECT(has(out, "uq2 true"), "CheckUniqueOnField of a real seat without a unique card is true");
	std::printf("RESULT uq %s\n", failures == before ? "PASS" : "FAIL");
}

// ---- n2: the same calls at n == 2 (stock behaviour; the DATA lines must be identical on both libraries)
static void mode_n2() {
	const int before = failures;
	auto a = disf_case("n2-seat0", 2, 0, -1, {{1, 2}});
	EXPECT(a.prompt && a.player == 0 && (a.flag & 0x40000u) != 0 && (a.flag & 0x20000u) == 0, "n2 disf: seat 1 zone 2 in the opponent half");
	auto b = disf_case("n2-seat1", 2, 1, -1, {{0, 3}});
	EXPECT(b.prompt && b.player == 1 && (b.flag & 0x80000u) != 0, "n2 disf (seat 1): seat 0 zone 3 in the opponent half");
	abs_case("n2-seat1", 2, 1, 0, 1);
	abs_case("n2-seat0", 2, 0, 1, 0);
	g_log.clear();
	OCG_Duel d = make_n(2, add_mon(31, 1, 0) + "Debug.AddCard(77,0,0,LOCATION_FZONE,0,POS_FACEUP)\n" + driver(
	    "local a=Duel.GetDecktopGroup(1,3) Debug.Message('top1 '..a:GetCount())\n"
	    "local code,p=Duel.GetEnvironment() Debug.Message('env '..code..' '..p)\n"
	    "local r=Duel.CheckReleaseGroup(1,function() return true end,1,nil) Debug.Message('check '..tostring(r))\n"
	    "Debug.Message('activity '..Duel.GetCustomActivityCount(5,0,ACTIVITY_SUMMON))"));
	OCG_StartDuel(d);
	run_until_prompt(d);
	OCG_DestroyDuel(d);
	for(auto& l : driver_log())
		std::printf("DATA n2: %s\n", l.c_str());
	EXPECT(has(driver_log(), "top1 3") && has(driver_log(), "env 77 0") && has(driver_log(), "check true"), "n2 values");
	std::printf("RESULT n2 %s\n", failures == before ? "PASS" : "FAIL");
}

int main(int argc, char** argv) {
	const std::string mode = argc > 1 ? argv[1] : "all";
	if(mode == "disf" || mode == "all")
		mode_disf();
	if(mode == "top" || mode == "all")
		mode_top();
	if(mode == "env" || mode == "all")
		mode_env();
	if(mode == "rel" || mode == "all")
		mode_rel();
	if(mode == "cnt" || mode == "all")
		mode_cnt();
	if(mode == "act" || mode == "all")
		mode_act();
	if(mode == "abs" || mode == "all")
		mode_abs();
	if(mode == "dd" || mode == "all")
		mode_dd();
	if(mode == "tr" || mode == "all")
		mode_tr();
	if(mode == "uq" || mode == "all")
		mode_uq();
	if(mode == "n2" || mode == "all")
		mode_n2();
	std::printf("failures: %d\n", failures);
	return failures;
}
