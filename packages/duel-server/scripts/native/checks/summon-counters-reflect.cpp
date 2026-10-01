// FX1 native check: special summon counters, reflected damage, empty unique choice, opponent_of reads at n > 2.
// Usage: check <scenario>   (build.sh runs every scenario in its own process; a sanitizer abort ends only that one)
// Every scenario plays a real duel with a seeded Lua global effect. EXPECT lines state the FIXED behaviour, so the
// same program on the base lib (03389c6) shows each bug (a sanitizer report, a wrong seat, a hang) and on the fixed lib passes.
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <array>
#include <string>
#include <vector>
#include "ocgapi.h"
#include "ocgapi_constants.h"
#include "duel.h"
#include "field.h"
#include "card.h"
#include "common.h"

static std::string g_log;
#undef EXPECT
#define EXPECT(cond, ...) do { if(!(cond)) { ++failures; std::printf("FAIL: "); std::printf(__VA_ARGS__); std::printf("\n"); } } while(0)

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
	g_log += text ? text : "";
	g_log += "\n";
	if(std::getenv("CHECK_LOG"))
		std::fprintf(stderr, "core log [%d]: %s\n", type, text);
}
static field& F(OCG_Duel d) { return *static_cast<duel*>(d)->game_field; }
static bool run_lua(OCG_Duel d, const std::string& code) {
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
		info.pos = POS_FACEDOWN_DEFENSE;
		OCG_DuelNewCard(d, &info);
	}
}

struct Msg { uint8_t id; std::vector<uint8_t> data; };
struct Run {
	std::string fail;
	bool hang = false;
	bool saw_win = false;
	int turn = 0;
	int steps = 0;
	int32_t lp0[4] = {}, lp1[4] = {};    // lp_ref at duel start / end
	uint8_t max_state_count[4] = {};     // highest core.spsummon_state_count seen after a step
	uint16_t max_card_counter[4] = {};   // highest spsummon_counter of the seat 0 monster
	uint32_t timing_or[4] = {};          // every hint_timing bit seen
	std::vector<Msg> msgs;
	std::string log;
	int mzone_count[4] = {};
	size_t max_unique_cards = 0, max_unique_destroy = 0;
	int select_card_msgs = 0;
};

static bool step(OCG_Duel d, Run& r, bool& answered) {
	answered = false;
	const int status = OCG_DuelProcess(d);
	uint32_t length = 0;
	const auto* buffer = static_cast<const uint8_t*>(OCG_DuelGetMessage(d, &length));
	bool idle = false, chain = false, select_card = false, place = false;
	uint32_t select_min = 0, place_flag = 0;
	uint8_t place_player = 0;
	for(uint32_t offset = 0; offset + 4 <= length;) {
		uint32_t size = 0;
		std::memcpy(&size, buffer + offset, 4);
		if(size > 0) {
			const uint8_t id = buffer[offset + 4];
			r.msgs.push_back({id, std::vector<uint8_t>(buffer + offset + 5, buffer + offset + 4 + size)});
			if(id == MSG_WIN) r.saw_win = true;
			if(std::getenv("CHECK_TRACE")) std::fprintf(stderr, "msg %u size %u\n", static_cast<unsigned>(id), size);
			if(id == MSG_SELECT_IDLECMD) idle = true;
			if(id == MSG_SELECT_CHAIN) chain = true;
			if(id == MSG_SELECT_PLACE) { place = true; place_player = buffer[offset + 5]; std::memcpy(&place_flag, buffer + offset + 7, 4); }
			if(id == MSG_SELECT_CARD) ++r.select_card_msgs;
			if(size > 10 && id == MSG_SELECT_CARD) { select_card = true; std::memcpy(&select_min, buffer + offset + 7, 4); }
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
			uint8_t seq = 0;
			while(seq < 5 && (place_flag & (1u << seq))) ++seq;
			const uint8_t response[3] = { place_player, LOCATION_MZONE, seq };
			OCG_DuelSetResponse(d, response, sizeof(response));
			answered = true;
		} else if(select_card) {
			std::vector<uint32_t> response{ 0, select_min };
			for(uint32_t i = 0; i < select_min; ++i) response.push_back(i);
			OCG_DuelSetResponse(d, response.data(), static_cast<uint32_t>(response.size() * sizeof(uint32_t)));
			answered = true;
		}
	}
	return status != OCG_DUEL_STATUS_END;
}

struct Scn {
	int n = 4;
	std::vector<int> team{0, 1, 2, 3};
	std::vector<std::string> pre;   // Lua run after the cards are placed, before the duel starts
	std::vector<std::array<int, 3>> board; // (seat, zone seq, code) of a monster added to the field
	int act_turn = 1;               // the operation runs at the start of Main Phase 1 of this turn
	int reg = 0;                    // player the operation effect is registered for (reason player)
	std::string op;                 // Lua of the operation
	std::vector<int> dead;          // seats set eliminated before the start
	bool no_controller = false;     // set the controller of the last card in the Graveyard of seat 0 to none_id()
	int stop_after = 3;             // process steps after the turn of the operation
};

static Run play(const Scn& s, uint32_t seed = 7) {
	Run r;
	g_log.clear();
	OCG_DuelOptions options;
	std::memset(&options, 0, sizeof(options));
	options.seed[0] = seed; options.seed[1] = 2; options.seed[2] = 3; options.seed[3] = 4;
	options.flags = DUEL_MODE_MR5;
	options.team1 = {8000, 5, 1};
	options.team2 = {8000, 5, 1};
	options.cardReader = read_card;
	options.scriptReader = read_script;
	options.logHandler = on_log;
	OCG_Duel d = nullptr;
	if(OCG_CreateDuel(&d, &options) != OCG_DUEL_CREATION_SUCCESS) { std::printf("FAIL: OCG_CreateDuel\n"); std::exit(2); }
	std::string setup = "Debug.SetupDuelists(" + std::to_string(s.n);
	for(int t : s.team) setup += "," + std::to_string(t);
	setup += ")";
	if(!run_lua(d, setup)) { r.fail = "setup: " + g_log; OCG_DestroyDuel(d); return r; }
	for(int p = 0; p < s.n; ++p) {
		add_cards(d, static_cast<uint8_t>(p), LOCATION_DECK, 40);
		add_cards(d, static_cast<uint8_t>(p), LOCATION_EXTRA, 2, 2);
	}
	for(auto& b : s.board) {
		const std::string add = "Debug.AddCard(" + std::to_string(b[2]) + "," + std::to_string(b[0]) + "," + std::to_string(b[0]) + ",4," + std::to_string(b[1]) + ",1)";
		if(!run_lua(d, add)) { r.fail = add + ": " + g_log; OCG_DestroyDuel(d); return r; }
	}
	for(auto& l : s.pre)
		if(!run_lua(d, l)) { r.fail = "pre: " + l + ": " + g_log; OCG_DestroyDuel(d); return r; }
	if(!s.op.empty()) {
		const std::string script =
			"local done=false\n"
			"local e=Effect.GlobalEffect()\n"
			"e:SetType(0x802)\n"
			"e:SetCode(0x2004)\n"
			"e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)\n"
			"  if not done and Duel.GetTurnCount()==" + std::to_string(s.act_turn) + " then\n"
			"    done=true\n" + s.op + "\n"
			"  end\n"
			"end)\n"
			"Duel.RegisterEffect(e," + std::to_string(s.reg) + ")\n";
		if(!run_lua(d, script)) { r.fail = "operation script: " + g_log; OCG_DestroyDuel(d); return r; }
	}
	for(int q : s.dead) F(d).player[q].eliminated = true;
	if(s.no_controller) {
		// Direct access to the internals: the Lua API gives every card a seat, so a controller-less card is made by hand.
		auto& gy = F(d).player[0].list_grave;
		if(gy.empty()) { r.fail = "no grave card"; OCG_DestroyDuel(d); return r; }
		gy.back()->current.controler = F(d).none_id();
	}
	OCG_StartDuel(d);
	for(int i = 0; i < s.n; ++i) r.lp0[i] = F(d).lp_ref(static_cast<uint8_t>(i));
	card* c0 = F(d).player[0].list_mzone.empty() ? nullptr : F(d).player[0].list_mzone[0];
	int extra = -1;
	for(int i = 0; i < 6000 && !r.saw_win; ++i) {
		bool answered = false;
		const bool alive = step(d, r, answered);
		++r.steps;
		auto& f = F(d);
		for(int p = 0; p < 4; ++p) {
			if(f.core.spsummon_state_count[p] > r.max_state_count[p]) r.max_state_count[p] = f.core.spsummon_state_count[p];
			r.timing_or[p] |= f.core.hint_timing[p];
			if(c0 && c0->spsummon_counter[p] > r.max_card_counter[p]) r.max_card_counter[p] = c0->spsummon_counter[p];
		}
		for(int p = 0; p < 4; ++p) if(f.core.unique_cards[p].size() > r.max_unique_cards) r.max_unique_cards = f.core.unique_cards[p].size();
		if(f.core.unique_destroy_set.size() > r.max_unique_destroy) r.max_unique_destroy = f.core.unique_destroy_set.size();
		if(std::getenv("CHECK_UNIQ")) for(int p = 0; p < 4; ++p) for(auto* uc : f.core.unique_cards[p]) { card_set cs; uc->get_unique_target(&cs, p); std::fprintf(stderr, "step %d seat %d: loc=%u pos=%u enabled=%d disabled=%d cset=%zu turn=%d selfdes_disabled=%d\n", i, p, uc->current.location, uc->current.position, uc->get_status(STATUS_EFFECT_ENABLED) ? 1 : 0, uc->get_status(STATUS_DISABLED | STATUS_FORBIDDEN) ? 1 : 0, cs.size(), f.infos.turn_id, f.core.selfdes_disabled ? 1 : 0); }
		if(!alive) break;
		if(!answered && !r.msgs.empty() && false) break;
		if(f.infos.turn_id > s.act_turn && extra < 0) extra = s.stop_after;
		if(extra == 0) break;
		if(extra > 0) --extra;
		r.turn = f.infos.turn_id;
		if(i == 5999) r.hang = true;
	}
	if(r.steps >= 6000) r.hang = true;
	auto& f = F(d);
	for(int i = 0; i < s.n; ++i) {
		r.lp1[i] = f.lp_ref(static_cast<uint8_t>(i));
		r.mzone_count[i] = 0;
		for(auto* pc : f.player[i].list_mzone) if(pc) ++r.mzone_count[i];
	}
	r.log = g_log;
	OCG_DestroyDuel(d);
	return r;
}

static std::string lpdelta(const Run& r, int n) {
	std::string s;
	for(int i = 0; i < n; ++i) s += (i ? " " : "") + std::to_string(r.lp1[i] - r.lp0[i]);
	return s;
}
static std::string arr4(const uint8_t* a) { char b[64]; std::snprintf(b, sizeof b, "%u,%u,%u,%u", a[0], a[1], a[2], a[3]); return b; }
static std::string arr4(const uint16_t* a) { char b[64]; std::snprintf(b, sizeof b, "%u,%u,%u,%u", a[0], a[1], a[2], a[3]); return b; }

// --- scenarios --------------------------------------------------------------------------------------------------
// Special summons: Step/Complete with a different summon player per card, from a global effect.
static const char* spsummon_op(const char* seats /* e.g. "2,3" */) {
	static std::string s;
	s = std::string("local ss={") + seats + "}\n"
		"for _,p in ipairs(ss) do\n"
		"  local c=Duel.GetFieldGroup(p,2,0):GetFirst()\n"
		"  Duel.SpecialSummonStep(c,0,p,p,true,true,1)\n"
		"end\n"
		"Duel.SpecialSummonComplete()";
	return s.c_str();
}
static const char* kCounterEffect =
	"local c=Duel.GetFieldCard(0,4,0)\n"
	"local e=Effect.CreateEffect(c)\n"
	"e:SetType(2)\n"        // EFFECT_TYPE_FIELD
	"e:SetCode(330)\n"      // EFFECT_SPSUMMON_COUNT_LIMIT
	"e:SetRange(4)\n"       // LOCATION_MZONE
	"e:SetTargetRange(1,1)\n"
	"e:SetValue(9)\n"
	"c:RegisterEffect(e)\n";

static void sc_spsummon(const char* name, int act_turn, const char* seats, const int expect_seats[4]) {
	Scn s;
	s.board = {{0, 0, 1}};
	s.pre = {kCounterEffect};
	s.act_turn = act_turn;
	s.reg = 0;
	s.op = spsummon_op(seats);
	const Run r = play(s);
	std::printf("RESULT %s: turn_player=%d steps=%d fail='%s' state_count=%s card_counter=%s\n", name, (act_turn - 1) % 4, r.steps, r.fail.c_str(),
	            arr4(r.max_state_count).c_str(), arr4(r.max_card_counter).c_str());
	EXPECT(r.fail.empty(), "%s: %s", name, r.fail.c_str());
	for(int p = 0; p < 4; ++p) {
		EXPECT(r.max_state_count[p] == expect_seats[p], "%s: seat %d state count %u, want %d", name, p, r.max_state_count[p], expect_seats[p]);
		EXPECT(r.max_card_counter[p] == expect_seats[p], "%s: seat %d card counter %u, want %d", name, p, r.max_card_counter[p], expect_seats[p]);
	}
}

static const char* kReflect =
	"local r=Effect.GlobalEffect()\n"
	"r:SetType(2)\n"        // EFFECT_TYPE_FIELD
	"r:SetCode(83)\n"       // EFFECT_REFLECT_DAMAGE
	"r:SetProperty(0x800)\n" // EFFECT_FLAG_PLAYER_TARGET
	"r:SetTargetRange(1,0)\n"
	"r:SetValue(function(e,re,val,r,rp,rc) return true end)\n";
// holder: seat with the reflect effect; hurt: the duelist that is the damage target; reason: reason player (registration seat).
static void sc_reflect(const char* name, std::vector<int> team, int holder, int reason, bool step_form, std::vector<int> dead, const std::vector<int>& want_delta) {
	Scn s;
	s.team = team;
	s.pre = {std::string(kReflect) + "Duel.RegisterEffect(r," + std::to_string(holder) + ")"};
	s.reg = reason;
	s.dead = dead;
	s.op = step_form ? "Duel.Damage(" + std::to_string(holder) + ",500,0x40,true)\nDuel.RDComplete()" : "Duel.Damage(" + std::to_string(holder) + ",500,0x40)";
	const Run r = play(s);
	std::printf("RESULT %s: holder=%d reason=%d lp_delta=[%s] fail='%s' hang=%d\n", name, holder, reason, lpdelta(r, 4).c_str(), r.fail.c_str(), r.hang);
	EXPECT(r.fail.empty(), "%s: %s", name, r.fail.c_str());
	for(int i = 0; i < 4; ++i)
		EXPECT(r.lp1[i] - r.lp0[i] == want_delta[i], "%s: seat %d LP delta %d, want %d", name, i, r.lp1[i] - r.lp0[i], want_delta[i]);
	// The damage message must name the new target, never a seat that is not a duelist.
	for(auto& m : r.msgs)
		if(m.id == MSG_DAMAGE)
			EXPECT(m.data[0] < 4, "%s: MSG_DAMAGE player %u", name, m.data[0]);
}

static void sc_unique() {
	Scn s;
	// Seat 2 gets a card A with SetUniqueOnField(0,1,7,MZONE) (opponents only). The card is listed for seats 0, 1 and 3.
	// For seat 3 the unique target is seat 3 ^ 1 = 2: two code 7 cards B and C of seat 2. Seat 3 owns none of them, so the
	// own-cards step of the stock code finds nothing and then walks opponent_of() off the seat range (empty choice, hang).
	// With the fix seat 2 (a living owner) chooses and one of B and C is destroyed.
	s.board = {{2, 1, 7}, {2, 2, 7}};
	s.reg = 2;
	s.op =
		"local c=Duel.GetFieldGroup(2,2,0):GetFirst()\n"
		"Duel.SpecialSummon(c,0,2,2,true,true,1)\n"
		"c:SetUniqueOnField(0,1,7,4)";
	s.act_turn = 1;
	s.stop_after = 6;
	const Run r = play(s);
	std::printf("RESULT unique-empty-choice: steps=%d hang=%d turn=%d mzone=%d,%d,%d,%d unique_cards=%zu unique_destroy=%zu select_card_msgs=%d fail='%s'\n", r.steps, r.hang, r.turn,
	            r.mzone_count[0], r.mzone_count[1], r.mzone_count[2], r.mzone_count[3], r.max_unique_cards, r.max_unique_destroy, r.select_card_msgs, r.fail.c_str());
	EXPECT(r.fail.empty(), "unique: %s", r.fail.c_str());
	EXPECT(!r.hang, "unique: duel hangs (step limit)");
	EXPECT(r.mzone_count[2] == 2, "unique: seat 2 has %d monsters, want 2 (A and one of B and C)", r.mzone_count[2]);
}

// SendTo case 6: a card without controller goes from the Graveyard to the Deck. The stock code writes hint_timing[control_player]
// and check_decktop_visibility[control_player] with control_player = 0xFF (out of bounds).
static void sc_sendto_nocontroller() {
	Scn s;
	s.pre = {"Debug.AddCard(9,0,0,16,0,1)"};
	s.no_controller = true;
	s.reg = 0;
	s.op = "local g=Duel.GetFieldGroup(0,16,0)\nDebug.Message('RESULT_GROUP '..g:GetCount())\nDuel.SendtoDeck(g,nil,2,64)";
	const Run r = play(s);
	std::printf("RESULT sendto-no-controller: steps=%d hang=%d fail='%s' group_msg=%d\n", r.steps, r.hang, r.fail.c_str(), r.log.find("RESULT_GROUP 1") != std::string::npos);
	EXPECT(r.fail.empty(), "sendto: %s", r.fail.c_str());
	EXPECT(r.log.find("RESULT_GROUP 1") != std::string::npos, "sendto: the operation did not see the controller-less card (log: %s)", r.log.c_str());
	EXPECT(!r.hang, "sendto: duel hangs");
}

static void sc_draw_confirm() {
	Scn s;
	// Every deck is reversed: the cards drawn at the start of a turn are confirmed to the opponents.
	s.pre = {"local e=Effect.GlobalEffect()\ne:SetType(2)\ne:SetCode(294)\ne:SetProperty(0x800)\ne:SetTargetRange(1,1)\nDuel.RegisterEffect(e,0)"};
	s.act_turn = 4;
	s.stop_after = 6;
	const Run r = play(s);
	std::string seen;
	bool bad = false;
	for(auto& m : r.msgs)
		if(m.id == MSG_CONFIRM_CARDS) {
			seen += std::to_string(m.data[0]) + " ";
			if(m.data[0] >= 4) bad = true;
		}
	std::printf("RESULT draw-confirm: MSG_CONFIRM_CARDS players: %s fail='%s'\n", seen.c_str(), r.fail.c_str());
	EXPECT(r.fail.empty(), "draw-confirm: %s", r.fail.c_str());
	EXPECT(!bad, "draw-confirm: a MSG_CONFIRM_CARDS names a seat that is not a duelist");
	EXPECT(!seen.empty(), "draw-confirm: no MSG_CONFIRM_CARDS seen (scenario did not reach the site)");
}

static void sc_dice() {
	Scn s;
	s.act_turn = 1;
	s.reg = 2;
	s.op = "Duel.TossDice(2,1,1)";
	const Run r = play(s);
	std::string seen;
	bool bad = false;
	for(auto& m : r.msgs)
		if(m.id == MSG_TOSS_DICE) {
			seen += std::to_string(m.data[0]) + " ";
			if(m.data[0] >= 4) bad = true;
		}
	std::printf("RESULT toss-dice: MSG_TOSS_DICE players: %s fail='%s'\n", seen.c_str(), r.fail.c_str());
	EXPECT(r.fail.empty(), "dice: %s", r.fail.c_str());
	EXPECT(!bad, "dice: MSG_TOSS_DICE names a seat that is not a duelist");
	EXPECT(seen == "2 3 ", "dice: players '%s', want '2 3 '", seen.c_str());
}

// Duel.IsPlayerCanDiscardDeckAsCost(2,2) with a redirect effect of seat 3 (deck -> removed).
static void sc_discard(bool seat3_cannot_remove) {
	Scn s;
	s.act_turn = 1;
	s.reg = 0;
	std::string pre =
		"local e=Effect.GlobalEffect()\n"
		"e:SetType(2)\n"
		"e:SetCode(63)\n"            // EFFECT_TO_GRAVE_REDIRECT
		"e:SetTargetRange(1,1)\n"     // s_range, o_range = LOCATION_DECK (0x1)
		"e:SetValue(0x20)\n"          // LOCATION_REMOVED
		"Duel.RegisterEffect(e,3)\n";
	if(seat3_cannot_remove)
		pre +=
			"local k=Effect.GlobalEffect()\n"
			"k:SetType(2)\n"
			"k:SetCode(67)\n"           // EFFECT_CANNOT_REMOVE
			"k:SetProperty(0x800)\n"
			"k:SetTargetRange(1,0)\n"
			"Duel.RegisterEffect(k,3)\n";
	s.pre = {pre};
	s.op = "Debug.Message('RESULT_BOOL '..tostring(Duel.IsPlayerCanDiscardDeckAsCost(2,2)))";
	const Run r = play(s);
	const bool got_true = r.log.find("RESULT_BOOL true") != std::string::npos;
	const bool got_false = r.log.find("RESULT_BOOL false") != std::string::npos;
	const char* name = seat3_cannot_remove ? "discard-cost-seat3-cannot-remove" : "discard-cost-seat3-can-remove";
	std::printf("RESULT %s: returned %s fail='%s'\n", name, got_true ? "true" : (got_false ? "false" : "nothing"), r.fail.c_str());
	EXPECT(r.fail.empty(), "%s: %s", name, r.fail.c_str());
	// A redirect to the banished zone is skipped when its owner cannot banish: then the cost can be paid (true).
	// Otherwise the redirect applies to a Main Deck card sent to the Graveyard from the deck: false.
	EXPECT(got_true == seat3_cannot_remove && got_false == !seat3_cannot_remove, "%s: wrong answer", name);
}

int main(int argc, char** argv) {
	const std::string which = argc > 1 ? argv[1] : "all";
	auto want = [&](const char* n) { return which == "all" || which == n; };
	if(want("sp-tp0")) { const int e[4] = {0, 0, 1, 1}; sc_spsummon("sp-tp0-seats-2-3", 1, "2,3", e); }
	if(want("sp-tp2")) { const int e[4] = {0, 1, 1, 1}; sc_spsummon("sp-tp2-seats-2-3-1", 3, "2,3,1", e); }
	if(want("sp-tp3")) { const int e[4] = {1, 0, 0, 1}; sc_spsummon("sp-tp3-seats-3-0", 4, "3,0", e); }
	if(want("reflect-opp2")) sc_reflect("reflect-holder1-damage-by-seat2", {0, 1, 2, 3}, 1, 2, false, {}, {0, 0, -500, 0});
	if(want("reflect-opp3")) sc_reflect("reflect-holder1-damage-by-seat3", {0, 1, 2, 3}, 1, 3, false, {}, {0, 0, 0, -500});
	if(want("reflect-self")) sc_reflect("reflect-holder1-self-damage", {0, 1, 2, 3}, 1, 1, false, {}, {0, 0, 0, 0});
	if(want("reflect-step")) sc_reflect("reflect-holder1-damage-by-seat2-step", {0, 1, 2, 3}, 1, 2, true, {}, {0, 0, -500, 0});
	if(want("reflect-dead")) sc_reflect("reflect-holder1-damage-by-dead-seat2", {0, 1, 2, 3}, 1, 2, false, {2}, {0, 0, 0, 0});
	if(want("reflect-tag-partner")) sc_reflect("reflect-tag-holder0-damage-by-partner2", {0, 1, 0, 1}, 0, 2, false, {}, {0, 0, 0, 0});
	if(want("reflect-tag-opp")) sc_reflect("reflect-tag-holder0-damage-by-opponent1", {0, 1, 0, 1}, 0, 1, false, {}, {0, -500, 0, -500});
	if(want("unique")) sc_unique();
	if(want("sendto")) sc_sendto_nocontroller();
	if(want("draw")) sc_draw_confirm();
	if(want("dice")) sc_dice();
	if(want("discard-a")) sc_discard(false);
	if(want("discard-b")) sc_discard(true);
	std::printf("%s: %d failure(s)\n", failures ? "FAIL" : "PASS", failures);
	return failures ? 1 : 0;
}
