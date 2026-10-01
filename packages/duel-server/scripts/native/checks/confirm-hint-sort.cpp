// FX5 native check: ConfirmCards event players, Duel.Hint HINT_OPSELECTED, card_operation_sort at n > 2.
// Build and run: bash packages/duel-server/scripts/native/checks/run.sh <check name> (see README.md).
// Modes (each prints DATA lines and "RESULT <name> PASS|FAIL"; the exit code is the number of failures):
//   conf      FFA4, seat 2 confirms a seat 3 monster and a seat 1 hand card: event player of every event
//   tohand    the same, but the cards were just added to the hand (EVENT_TOHAND_CONFIRM is raised too)
//   hint      Duel.Hint(HINT_OPSELECTED, ...) from seat 1 and seat 2 in FFA4, FFA3, and FFA4 with seat 2 eliminated
//   sort      card_operation_sort with turn player 0..3 and cards of every seat (FFA4)
//   n2        the same three things at n == 2 (the output must be identical on both libraries)
//   all       every mode above
// A mode that the patch fixes prints FAIL on the "before" library on purpose: that is the "before" proof.
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
	char b[1024];
	std::snprintf(b, sizeof(b),
	              "EFFECT_TYPE_SINGLE=%d EFFECT_TYPE_FIELD=%d EFFECT_TYPE_CONTINUOUS=%d\n"
	              "EVENT_CONFIRM=%d EVENT_TOHAND_CONFIRM=%d EVENT_TO_HAND=%d EVENT_PHASE_START=%d PHASE_DRAW=%d\n"
	              "LOCATION_HAND=%d LOCATION_MZONE=%d LOCATION_GRAVE=%d REASON_EFFECT=%d POS_FACEUP_ATTACK=%d HINT_OPSELECTED=%d\n",
	              EFFECT_TYPE_SINGLE, EFFECT_TYPE_FIELD, EFFECT_TYPE_CONTINUOUS,
	              EVENT_CONFIRM, EVENT_TOHAND_CONFIRM, EVENT_TO_HAND, EVENT_PHASE_START, PHASE_DRAW,
	              LOCATION_HAND, LOCATION_MZONE, LOCATION_GRAVE, REASON_EFFECT, POS_FACEUP_ATTACK, HINT_OPSELECTED);
	return b;
}
// n duelists. n == 2: no setup call. Teams: seat.
static OCG_Duel make_n(int n, const std::string& lua) {
	OCG_Duel d = make_duel(7);
	if(n > 2) {
		std::string call = "Debug.SetupDuelists(" + std::to_string(n);
		for(int t = 0; t < n; ++t)
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
// Runs the duel until the first idle command prompt. Returns false on a stop.
static bool run_to_idle(OCG_Duel d) {
	for(int i = 0; i < 2000; ++i) {
		const int status = OCG_DuelProcess(d);
		uint32_t length = 0;
		const auto* buf = static_cast<const uint8_t*>(OCG_DuelGetMessage(d, &length));
		auto msgs = parse(buf, 0, length);
		if(status == OCG_DUEL_STATUS_END)
			return false;
		if(status == OCG_DUEL_STATUS_AWAITING && !msgs.empty())
			return msgs.back().id == MSG_SELECT_IDLECMD;
	}
	return false;
}
// ---- conf / tohand: event players of ConfirmCards
// A: code 21, seat 3 (monster zone, or grave for tohand). B: code 22, seat 1 (hand, or grave for tohand).
// The driver runs in the Draw Phase of turn 1 (turn player 0). Seat 2 confirms both cards.
// Inside an effect Lua sees only "own" (0) and "opponents" (1) (the Lua fold), so seat 2 confirms through an effect that
// is registered for seat 2 and calls ConfirmCards(0, ...). confirmer = the registering seat ("2"; "0" at n == 2).
static std::string conf_lua(bool tohand, const char* confirmer = "2") {
	// Lua sees seats relative to the seat the effect runs for (the Lua fold). To print the raw seats, one observer per
	// seat watches each group event: the observer of seat q sees "own" (0) exactly when the event player (or the
	// controller of a card) is q. The line is printed when the last of the observers has seen the event.
	// A single-card effect sees ep = 0 when the event player is the controller of its card, 1 otherwise.
	std::string s =
	    "local NSEAT=" + std::string(confirmer[0] == '0' ? "1" : "4") + "\n"
	    "local RAW=(NSEAT==1)\n" // n == 2: no fold, Lua sees the raw seats
	    "local function glob(code,name)\n"
	    " local acc={ep=-1,codes={},ctl={},cnt=0}\n"
	    " for q=0,NSEAT-1 do\n"
	    "  local e=Effect.GlobalEffect()\n e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)\n e:SetCode(code)\n"
	    "  e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)\n"
	    "   if RAW then acc.ep=ep elseif ep==0 then acc.ep=q end\n"
	    "   local i=0\n"
	    "   local tc=eg:GetFirst()\n"
	    "   while tc do i=i+1 acc.codes[i]=tc:GetCode() local cc=tc:GetControler() if RAW then acc.ctl[i]=cc elseif cc==0 then acc.ctl[i]=q end tc=eg:GetNext() end\n"
	    "   acc.cnt=acc.cnt+1\n"
	    "   if acc.cnt==NSEAT then\n"
	    "    local s=name..' ep='..acc.ep..' cards='\n"
	    "    for k=1,i do s=s..acc.codes[k]..'(c'..tostring(acc.ctl[k])..') ' end\n"
	    "    Debug.Message(s)\n"
	    "    acc.ep=-1 acc.codes={} acc.ctl={} acc.cnt=0\n"
	    "   end\n"
	    "  end)\n Duel.RegisterEffect(e,q)\n"
	    " end\n"
	    "end\n"
	    "local function single(c,code,name)\n"
	    " local e=Effect.CreateEffect(c)\n e:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_CONTINUOUS)\n e:SetCode(code)\n"
	    " e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp) Debug.Message(name..' card='..e:GetHandler():GetCode()..' ep='..ep) end)\n"
	    " c:RegisterEffect(e)\n"
	    "end\n";
	if(tohand)
		s += "local A=Debug.AddCard(21,3,3,LOCATION_GRAVE,0,POS_FACEUP_ATTACK)\n"
		     "local B=Debug.AddCard(22,1,1,LOCATION_GRAVE,0,POS_FACEUP_ATTACK)\n";
	else
		s += "local A=Debug.AddCard(21,3,3,LOCATION_MZONE,0,POS_FACEUP_ATTACK)\n"
		     "local B=Debug.AddCard(22,1,1,LOCATION_HAND,0,POS_FACEUP_ATTACK)\n";
	s += "single(A,EVENT_CONFIRM,'single CONFIRM') single(B,EVENT_CONFIRM,'single CONFIRM')\n"
	     "single(A,EVENT_TOHAND_CONFIRM,'single TOHAND_CONFIRM') single(B,EVENT_TOHAND_CONFIRM,'single TOHAND_CONFIRM')\n"
	     "glob(EVENT_CONFIRM,'group CONFIRM')\nglob(EVENT_TOHAND_CONFIRM,'group TOHAND_CONFIRM')\n"
	     "local g=Group.FromCards(A,B)\n";
	if(tohand) {
		s += "local h=Effect.GlobalEffect()\n h:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)\n h:SetCode(EVENT_TO_HAND)\n"
		     "h:SetOperation(function(e,tp,eg) Debug.Message('to hand seen') Duel.ConfirmCards(0,eg) end)\n Duel.RegisterEffect(h," + std::string(confirmer) + ")\n"
		     "local d=Effect.GlobalEffect()\n d:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)\n d:SetCode(EVENT_PHASE_START+PHASE_DRAW)\n"
		     "d:SetOperation(function() Debug.Message('driver') Duel.SendtoHand(g,nil,REASON_EFFECT) end)\n Duel.RegisterEffect(d,0)\n";
	} else {
		s += "local d=Effect.GlobalEffect()\n d:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)\n d:SetCode(EVENT_PHASE_START+PHASE_DRAW)\n"
		     "d:SetOperation(function() Debug.Message('driver') Duel.ConfirmCards(0,g) end)\n Duel.RegisterEffect(d," + std::string(confirmer) + ")\n";
	}
	return s;
}
static std::vector<std::string> run_conf(bool tohand) {
	g_log.clear();
	OCG_Duel d = make_n(4, conf_lua(tohand));
	OCG_StartDuel(d);
	run_to_idle(d);
	OCG_DestroyDuel(d);
	std::vector<std::string> out;
	bool in_driver = false;
	for(auto& l : g_log) {
		if(l == "driver")
			in_driver = true;
		if(in_driver)
			out.push_back(l);
	}
	return out;
}
static int count_prefix(const std::vector<std::string>& v, const char* prefix) {
	int c = 0;
	for(auto& s : v)
		if(s.rfind(prefix, 0) == 0)
			++c;
	return c;
}
static bool has(const std::vector<std::string>& v, const std::string& s) {
	return std::find(v.begin(), v.end(), s) != v.end();
}
static void mode_conf(bool tohand) {
	const char* name = tohand ? "tohand" : "conf";
	auto out = run_conf(tohand);
	for(auto& l : out)
		std::printf("DATA %s: %s\n", name, l.c_str());
	const int before_failures = failures;
	// Single events: the controller of each card (A = seat 3, B = seat 1).
	EXPECT(has(out, "single CONFIRM card=21 ep=0"), "single CONFIRM of the seat 3 card: the event player is its controller (Lua ep 0)");
	EXPECT(has(out, "single CONFIRM card=22 ep=0"), "single CONFIRM of the seat 1 card: the event player is its controller (Lua ep 0)");
	// Group events: one per controller, with that controller's cards.
	EXPECT(has(out, "group CONFIRM ep=3 cards=21(c3) "), "group CONFIRM for seat 3 with card 21");
	EXPECT(has(out, "group CONFIRM ep=1 cards=22(c1) "), "group CONFIRM for seat 1 with card 22");
	EXPECT(count_prefix(out, "group CONFIRM") == 2, "two group CONFIRM events, saw %d", count_prefix(out, "group CONFIRM"));
	{
		// Order of the group events: the turn player is seat 0, so seat 1 comes before seat 3.
		auto it1 = std::find(out.begin(), out.end(), "group CONFIRM ep=1 cards=22(c1) ");
		auto it3 = std::find(out.begin(), out.end(), "group CONFIRM ep=3 cards=21(c3) ");
		EXPECT(it1 < it3, "group CONFIRM events must go seat 1, then seat 3");
	}
	if(tohand) {
		EXPECT(has(out, "single TOHAND_CONFIRM card=21 ep=0"), "single TOHAND_CONFIRM seat 3");
		EXPECT(has(out, "single TOHAND_CONFIRM card=22 ep=0"), "single TOHAND_CONFIRM seat 1");
		EXPECT(has(out, "group TOHAND_CONFIRM ep=3 cards=21(c3) "), "group TOHAND_CONFIRM for seat 3");
		EXPECT(has(out, "group TOHAND_CONFIRM ep=1 cards=22(c1) "), "group TOHAND_CONFIRM for seat 1");
		EXPECT(count_prefix(out, "group TOHAND_CONFIRM") == 2, "two group TOHAND_CONFIRM events, saw %d", count_prefix(out, "group TOHAND_CONFIRM"));
	}
	std::printf("RESULT %s %s\n", name, failures == before_failures ? "PASS" : "FAIL");
}

// ---- hint: Duel.Hint(HINT_OPSELECTED, caller, 777)
static std::vector<int> hint_players(int n, int caller, int eliminated) {
	OCG_Duel d = make_n(n, "");
	OCG_StartDuel(d);
	run_to_idle(d);
	if(eliminated >= 0)
		F(d).player[eliminated].eliminated = true;
	uint32_t before_len = 0;
	OCG_DuelGetMessage(d, &before_len);
	run_lua(d, "Duel.Hint(HINT_OPSELECTED," + std::to_string(caller) + ",777)");
	uint32_t length = 0;
	const auto* buf = static_cast<const uint8_t*>(OCG_DuelGetMessage(d, &length));
	std::vector<int> out;
	for(auto& m : parse(buf, before_len, length)) {
		if(m.id != MSG_HINT)
			continue;
		uint64_t desc = 0;
		std::memcpy(&desc, m.data.data() + 2, 8);
		EXPECT(m.data[0] == HINT_OPSELECTED && desc == 777, "hint type/desc changed: type %u desc %llu", m.data[0], static_cast<unsigned long long>(desc));
		out.push_back(m.data[1]);
	}
	OCG_DestroyDuel(d);
	return out;
}
static std::string fmt(const std::vector<int>& v) {
	std::string s;
	for(int x : v)
		s += (s.empty() ? "" : " ") + std::to_string(x);
	return "[" + s + "]";
}
static void hint_case(const char* label, int n, int caller, int eliminated, std::vector<int> want) {
	auto got = hint_players(n, caller, eliminated);
	std::printf("DATA hint %s: n=%d caller=%d eliminated=%d -> hints to %s\n", label, n, caller, eliminated, fmt(got).c_str());
	EXPECT(got == want, "hint %s: got %s, want %s", label, fmt(got).c_str(), fmt(want).c_str());
}
static void mode_hint() {
	const int before = failures;
	hint_case("ffa4-s1", 4, 1, -1, {0, 2, 3});
	hint_case("ffa4-s2", 4, 2, -1, {0, 1, 3});
	hint_case("ffa3-s1", 3, 1, -1, {0, 2});
	hint_case("ffa3-s2", 3, 2, -1, {0, 1});
	hint_case("ffa4-s1-seat2-dead", 4, 1, 2, {0, 3});
	hint_case("ffa3-s1-seat2-dead", 3, 1, 2, {0});
	std::printf("RESULT hint %s\n", failures == before ? "PASS" : "FAIL");
}

// ---- sort: card::card_operation_sort
static std::vector<int> sorted_controllers(OCG_Duel d, int tp, const std::vector<int>& seats) {
	std::vector<card*> cards;
	for(int s : seats)
		cards.push_back(F(d).player[s].list_mzone[0]);
	F(d).infos.turn_player = static_cast<uint8_t>(tp);
	std::sort(cards.begin(), cards.end(), card::card_operation_sort);
	std::vector<int> out;
	for(card* c : cards)
		out.push_back(c->current.controler);
	return out;
}
static void sort_case(const char* label, OCG_Duel d, int tp, std::vector<int> seats, std::vector<int> want) {
	auto got = sorted_controllers(d, tp, seats);
	std::printf("DATA sort %s: tp=%d -> %s\n", label, tp, fmt(got).c_str());
	EXPECT(got == want, "sort %s tp %d: got %s, want %s", label, tp, fmt(got).c_str(), fmt(want).c_str());
}
static void mode_sort() {
	const int before = failures;
	std::string lua;
	for(int s = 0; s < 4; ++s)
		lua += "Debug.AddCard(" + std::to_string(30 + s) + "," + std::to_string(s) + "," + std::to_string(s) + ",LOCATION_MZONE,0,POS_FACEUP_ATTACK)\n";
	OCG_Duel d = make_n(4, lua);
	OCG_StartDuel(d);
	// Rotation from the turn player.
	sort_case("all", d, 0, {3, 1, 2, 0}, {0, 1, 2, 3});
	sort_case("all", d, 1, {3, 1, 2, 0}, {1, 2, 3, 0});
	sort_case("all", d, 2, {3, 1, 2, 0}, {2, 3, 0, 1});
	sort_case("all", d, 3, {3, 1, 2, 0}, {3, 0, 1, 2});
	// The example of the brief: tp 3 with cards of seats 0 and 2.
	sort_case("seats-0-2", d, 3, {2, 0}, {0, 2});
	sort_case("seats-0-2", d, 2, {0, 2}, {2, 0});
	sort_case("seats-1-3", d, 2, {1, 3}, {3, 1});
	OCG_DestroyDuel(d);
	std::printf("RESULT sort %s\n", failures == before ? "PASS" : "FAIL");
}

// ---- n2: the same calls at n == 2 (stock behaviour; the DATA lines must be identical on both libraries)
static void mode_n2() {
	const int before = failures;
	// Hint from seat 0 and seat 1 at n == 2: one hint to the other seat.
	hint_case("n2-s0", 2, 0, -1, {1});
	hint_case("n2-s1", 2, 1, -1, {0});
	// Sort at n == 2: tp 0 ascending, tp 1 descending (stock).
	std::string lua;
	for(int s = 0; s < 2; ++s)
		lua += "Debug.AddCard(" + std::to_string(30 + s) + "," + std::to_string(s) + "," + std::to_string(s) + ",LOCATION_MZONE,0,POS_FACEUP_ATTACK)\n";
	OCG_Duel d = make_n(2, lua);
	OCG_StartDuel(d);
	sort_case("n2", d, 0, {1, 0}, {0, 1});
	sort_case("n2", d, 1, {0, 1}, {1, 0});
	OCG_DestroyDuel(d);
	// ConfirmCards at n == 2: seat 0 confirms a seat 1 card to itself... event player = the opponent of the viewer.
	g_log.clear();
	std::string clua = conf_lua(false, "0");
	// Re-target the script to a 2 duelist duel: seats 3 and 1 become seats 1 and 1; confirm by seat 0.
	for(size_t pos; (pos = clua.find("Debug.AddCard(21,3,3,")) != std::string::npos;)
		clua.replace(pos, 21, "Debug.AddCard(21,1,1,");
	OCG_Duel e = make_n(2, clua);
	OCG_StartDuel(e);
	run_to_idle(e);
	OCG_DestroyDuel(e);
	bool in_driver = false;
	int events = 0;
	for(auto& l : g_log) {
		if(l == "driver")
			in_driver = true;
		if(in_driver) {
			std::printf("DATA n2 confirm: %s\n", l.c_str());
			if(l.find("CONFIRM") != std::string::npos)
				++events;
		}
	}
	// Both cards are seat 1 cards at n == 2: one group event each, ep = 1 (the opponent of seat 0)
	EXPECT(has(g_log, "group CONFIRM ep=1 cards=21(c1) 22(c1) ") || has(g_log, "group CONFIRM ep=1 cards=22(c1) 21(c1) "), "n == 2 group event");
	EXPECT(events == 5, "n == 2: five CONFIRM lines (2 single CONFIRM, 1 single TOHAND, 2 group), saw %d", events);
	std::printf("RESULT n2 %s\n", failures == before ? "PASS" : "FAIL");
}

int main(int argc, char** argv) {
	const std::string mode = argc > 1 ? argv[1] : "all";
	if(mode == "conf" || mode == "all")
		mode_conf(false);
	if(mode == "tohand" || mode == "all")
		mode_conf(true);
	if(mode == "hint" || mode == "all")
		mode_hint();
	if(mode == "sort" || mode == "all")
		mode_sort();
	if(mode == "n2" || mode == "all")
		mode_n2();
	std::printf("failures: %d\n", failures);
	return failures;
}
