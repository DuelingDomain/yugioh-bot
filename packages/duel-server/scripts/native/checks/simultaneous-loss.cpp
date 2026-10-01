// FX4 native check (non-trap core, ASan + UBSan). One scenario per run: check <mode>.
// Exit 0 = every expectation held.
//   s1       FFA4: seats 1 and 2 lose at the same time (LP 0 together), seats 0 and 3 stay: two bodies, cards of each side.
//   s2       FFA3: seat 1 out first, then the last two living duelists lose together (draw).
//   s2all    FFA3: all three lose together (draw).
//   tagdraw  Tag 4: both teams lose together: MSG_WIN only, no 200 (must not change).
//   s3       FFA3: reason_player of the BattleCommand unit must be none_id() (0xFF).
//   s3n2     2 duelists: reason_player of the BattleCommand unit stays PLAYER_NONE (2).
//   s4       FFA3: calculate_battle_damage of a direct attack with no defender gives no damage (unit call).
//   s4n2     2 duelists: the direct attack damage is unchanged.
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <functional>
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
	data->type = TYPE_MONSTER | TYPE_NORMAL;
	data->level = 4;
	data->attribute = 1;
	data->race = 1;
	data->attack = 1000;
	data->defense = 1000;
}
static int read_script(void*, OCG_Duel, const char*) { return 0; }
static void on_log(void*, const char* text, int) { last_log = text ? text : ""; }
static field& F(OCG_Duel d) { return *static_cast<duel*>(d)->game_field; }
static bool run_lua(OCG_Duel d, const std::string& code) {
	last_log.clear();
	return OCG_LoadScript(d, code.c_str(), static_cast<uint32_t>(code.size()), "fx4.lua") != 0;
}
static OCG_Duel make_duel() {
	OCG_DuelOptions options;
	std::memset(&options, 0, sizeof(options));
	options.seed[0] = 1; options.seed[1] = 2; options.seed[2] = 3; options.seed[3] = 4;
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
static card* put(OCG_Duel d, uint8_t con, uint8_t owner, uint32_t loc, uint32_t seq, uint32_t pos = POS_FACEUP_ATTACK) {
	OCG_NewCardInfo info;
	std::memset(&info, 0, sizeof(info));
	info.team = owner; info.duelist = 0; info.code = 1; info.con = con; info.loc = loc; info.seq = seq; info.pos = pos;
	OCG_DuelNewCard(d, &info);
	auto& pl = F(d).player[con];
	if(loc == LOCATION_MZONE)
		return pl.list_mzone[seq];
	return nullptr;
}
template<typename Fn>
static void for_each_list(field& f, Fn fn) {
	for(int p = 0; p < MAX_DUELISTS; ++p) {
		auto& pl = f.player[p];
		for(auto* lst : { &pl.list_mzone, &pl.list_szone, &pl.list_main, &pl.list_hand, &pl.list_grave, &pl.list_remove, &pl.list_extra })
			for(auto* x : *lst)
				if(x) fn(x);
	}
}
static bool in_any_list(field& f, card* c) {
	bool found = false;
	for_each_list(f, [&](card* x) { if(x == c) found = true; });
	return found;
}
static int cards_of_in_lists(field& f, uint8_t owner) {
	int n = 0;
	for_each_list(f, [&](card* x) { if(x->owner == owner) ++n; });
	return n;
}
static int count_owned(OCG_Duel d, uint8_t p) {
	int n = 0;
	for(auto* c : static_cast<duel*>(d)->cards)
		if(c->owner == p) ++n;
	return n;
}

struct Msg { uint8_t id; std::vector<uint8_t> data; };
struct Game {
	OCG_Duel d = nullptr;
	int n = 2;
	std::vector<Msg> log;
	int idle_no = 0;
	int steps = 0;
	bool stuck = false;
	bool stop = false;
	bool want_bp = false;
	std::vector<Msg> of(uint8_t id) const {
		std::vector<Msg> r;
		for(const auto& m : log) if(m.id == id) r.push_back(m);
		return r;
	}
	size_t index_of(uint8_t id) const {
		for(size_t i = 0; i < log.size(); ++i)
			if(log[i].id == id) return i;
		return SIZE_MAX;
	}
	~Game() { if(d) OCG_DestroyDuel(d); }
};
static bool lua(Game& g, const std::string& code) {
	const bool ok = run_lua(g.d, code);
	EXPECT(ok, "lua '%s': %s", code.c_str(), last_log.c_str());
	return ok;
}
// tag: seats get teams 0,1,0,1. Cards are added by the scenario.
static void setup(Game& g, int n, bool tag) {
	g.n = n;
	g.d = make_duel();
	if(n > 2) {
		std::string code = "Debug.SetupDuelists(" + std::to_string(n);
		for(int i = 0; i < n; ++i)
			code += "," + std::to_string(tag ? i % 2 : i);
		code += ")";
		if(!run_lua(g.d, code)) { std::printf("FAIL: %s: %s\n", code.c_str(), last_log.c_str()); std::exit(2); }
	}
}
static void fill_decks(Game& g) {
	for(int p = 0; p < g.n; ++p)
		for(int i = 0; i < 40; ++i)
			put(g.d, static_cast<uint8_t>(p), static_cast<uint8_t>(p), LOCATION_DECK, 0, POS_FACEDOWN_DEFENSE);
}
using Hook = std::function<void(Game&, const Msg&)>;
// Runs steps. hook(g, msg) runs at every idle prompt and every battle prompt before the answer.
static void drive(Game& g, int max_steps, const Hook& hook, int stop_turn = 1 << 30) {
	for(int i = 0; i < max_steps && !g.stuck && !g.stop; ++i) {
		++g.steps;
		const int status = OCG_DuelProcess(g.d);
		uint32_t length = 0;
		const auto* buffer = static_cast<const uint8_t*>(OCG_DuelGetMessage(g.d, &length));
		bool chain = false, select_card = false;
		int idle = -1, battle = -1;
		uint32_t select_min = 0;
		for(uint32_t offset = 0; offset + 4 <= length;) {
			uint32_t size = 0;
			std::memcpy(&size, buffer + offset, 4);
			if(size > 0) {
				Msg m;
				m.id = buffer[offset + 4];
				m.data.assign(buffer + offset + 5, buffer + offset + 4 + size);
				g.log.push_back(m);
				if(m.id == MSG_SELECT_IDLECMD) idle = static_cast<int>(g.log.size() - 1);
				if(m.id == MSG_SELECT_BATTLECMD) battle = static_cast<int>(g.log.size() - 1);
				if(m.id == MSG_SELECT_CHAIN) chain = true;
				if(m.id == MSG_SELECT_CARD && size > 10) { select_card = true; std::memcpy(&select_min, buffer + offset + 7, 4); }
			}
			offset += 4 + size;
		}
		if(status == OCG_DUEL_STATUS_END)
			return;
		if(status != OCG_DUEL_STATUS_AWAITING)
			continue;
		if(idle >= 0) {
			++g.idle_no;
			const Msg m = g.log[idle];
			if(hook) hook(g, m);
			if(g.stop || F(g.d).infos.turn_id > stop_turn) return;
			const bool to_bp = m.data.size() >= 3 && m.data[m.data.size() - 3];
			const uint32_t resp = (g.want_bp && to_bp) ? 6 : 7;
			OCG_DuelSetResponse(g.d, &resp, sizeof(resp));
		} else if(battle >= 0) {
			const Msg m = g.log[battle];
			if(hook) hook(g, m);
			if(g.stop) return;
			const uint32_t end_phase = 3;
			OCG_DuelSetResponse(g.d, &end_phase, sizeof(end_phase));
		} else if(chain) {
			const int32_t no_chain = -1;
			OCG_DuelSetResponse(g.d, &no_chain, sizeof(no_chain));
		} else if(select_card) {
			std::vector<uint32_t> response{0, select_min};
			for(uint32_t k = 0; k < select_min; ++k) response.push_back(k);
			OCG_DuelSetResponse(g.d, response.data(), static_cast<uint32_t>(response.size() * sizeof(uint32_t)));
		} else {
			g.stuck = true;
			std::printf("     stuck: status %d, last messages:", status);
			for(size_t k = g.log.size() > 4 ? g.log.size() - 4 : 0; k < g.log.size(); ++k) std::printf(" %u", static_cast<unsigned>(g.log[k].id));
			std::printf("\n");
			if(std::getenv("CHECK_DUMP"))
				for(const auto& m : g.log) { std::printf("       msg %u:", static_cast<unsigned>(m.id)); for(auto b : m.data) std::printf(" %u", static_cast<unsigned>(b)); std::printf("\n"); }
		}
	}
}
static std::string summary(const Game& g) {
	std::string s;
	for(const auto& m : g.log)
		if(m.id == 200 || m.id == MSG_WIN)
			s += (m.id == 200 ? "200(" : "WIN(") + std::to_string(m.data[0]) + "," + std::to_string(m.data.size() > 1 ? m.data[1] : 0) + ") ";
	return s;
}

// ---------------------------------------------------------------- s1
static void check_s1() {
	Game g;
	setup(g, 4, false);
	fill_decks(g);
	// Seat 1 owns c1 (seat 2 controls it) and c1b. Seat 2 owns c2 (seat 1 controls it) and c2b.
	// Seat 0 owns c3 (seat 1 controls it) and c4 (seat 2 controls it): both go to the grave of seat 0.
	card* c2 = put(g.d, 1, 2, LOCATION_MZONE, 0);
	card* c3 = put(g.d, 1, 0, LOCATION_MZONE, 1);
	card* c1b = put(g.d, 1, 1, LOCATION_MZONE, 2);
	card* c1 = put(g.d, 2, 1, LOCATION_MZONE, 0);
	card* c4 = put(g.d, 2, 0, LOCATION_MZONE, 1);
	card* c2b = put(g.d, 2, 2, LOCATION_MZONE, 2);
	put(g.d, 0, 0, LOCATION_MZONE, 0);
	put(g.d, 3, 3, LOCATION_MZONE, 0);
	// Without an EFFECT_SET_CONTROL the Adjust gives a foreign card back to its owner (and asks for a zone).
	lua(g, "for _,a in ipairs({{1,0},{1,1},{2,0},{2,1}}) do\n"
		"  local c=Duel.GetFieldCard(a[1],4,a[2])\n"
		"  local e=Effect.CreateEffect(c)\n"
		"  e:SetType(1)\n"          // EFFECT_TYPE_SINGLE
		"  e:SetCode(4)\n"          // EFFECT_SET_CONTROL
		"  e:SetProperty(1024)\n"   // EFFECT_FLAG_CANNOT_DISABLE
		"  local who=a[1]\n"
		"  e:SetValue(function(e,c) return who end)\n"
		"  c:RegisterEffect(e)\n"
		"end\n");
	OCG_StartDuel(g.d);
	int owned1 = 0, owned2 = 0;
	size_t mark = 0;
	drive(g, 4000, [&](Game& g, const Msg&) {
		if(g.idle_no != 1) return;
		owned1 = count_owned(g.d, 1);
		owned2 = count_owned(g.d, 2);
		mark = g.log.size();
		lua(g, "Duel.SetLP(1,0) Duel.SetLP(2,0)");
	}, 6);
	auto& f = F(g.d);
	std::printf("     messages: %s (%d steps)\n", summary(g).c_str(), g.steps);
	EXPECT(!g.stuck, "stuck on a prompt");
	size_t n200 = 0, i200a = SIZE_MAX, i200b = SIZE_MAX;
	for(size_t i = mark; i < g.log.size(); ++i)
		if(g.log[i].id == MSG_DUELIST_ELIMINATED) {
			++n200;
			if(g.log[i].data[0] == 1) i200a = i;
			if(g.log[i].data[0] == 2) i200b = i;
		}
	EXPECT(n200 == 2 && i200a != SIZE_MAX && i200b != SIZE_MAX && i200a < i200b, "want exactly two 200 (seat 1 then seat 2), got %zu", n200);
	EXPECT(g.of(MSG_WIN).empty(), "no MSG_WIN expected (seats 0 and 3 stay)");
	EXPECT(f.player[1].eliminated && f.player[2].eliminated && !f.player[0].eliminated && !f.player[3].eliminated, "flags");
	EXPECT(cards_of_in_lists(f, 1) == 0 && cards_of_in_lists(f, 2) == 0, "cards of seat 1/2 left in a list: %d / %d", cards_of_in_lists(f, 1), cards_of_in_lists(f, 2));
	EXPECT(f.player[1].list_grave.empty() && f.player[2].list_grave.empty(), "a dead seat has a grave: %zu / %zu", f.player[1].list_grave.size(), f.player[2].list_grave.size());
	for(card* c : { c1, c1b, c2, c2b })
		EXPECT(c->current.location == 0 && !in_any_list(f, c), "card of a loser should be out of the game (loc %d)", c->current.location);
	for(card* c : { c3, c4 })
		EXPECT(c->current.location == LOCATION_GRAVE && c->current.controler == 0 && in_any_list(f, c), "card of seat 0 should be in its grave (loc %d con %d)", c->current.location, c->current.controler);
	std::printf("     cards owned before: seat1 %d seat2 %d\n", owned1, owned2);
	if(!failures)
		std::printf("ok   s1: two 200 (1 then 2), cards of both losers gone, c3 and c4 in the grave of seat 0\n");
}

// ---------------------------------------------------------------- s2 / s2all / tagdraw
static void check_s2() {
	Game g;
	setup(g, 3, false);
	fill_decks(g);
	OCG_StartDuel(g.d);
	size_t mark = 0;
	drive(g, 4000, [&](Game& g, const Msg&) {
		if(g.idle_no == 1) lua(g, "Duel.SetLP(1,0)");
		if(g.idle_no == 2) { mark = g.log.size(); lua(g, "Duel.SetLP(0,0) Duel.SetLP(2,0)"); }
	}, 7);
	std::printf("     messages: %s (%d steps)\n", summary(g).c_str(), g.steps);
	const auto wins = g.of(MSG_WIN);
	EXPECT(wins.size() == 1 && wins[0].data[0] == 0xFF, "want one MSG_WIN(0xFF), got %zu", wins.size());
	size_t n200 = 0; bool has0 = false, has2 = false, before_win = true;
	const size_t iw = g.index_of(MSG_WIN);
	for(size_t i = mark; i < g.log.size(); ++i)
		if(g.log[i].id == MSG_DUELIST_ELIMINATED) {
			++n200;
			has0 = has0 || g.log[i].data[0] == 0;
			has2 = has2 || g.log[i].data[0] == 2;
			before_win = before_win && i < iw;
		}
	EXPECT(n200 == 2 && has0 && has2 && before_win, "draw: want 200 for seats 0 and 2 before MSG_WIN, got %zu", n200);
	EXPECT(g.of(MSG_DUELIST_ELIMINATED).size() == 3, "total 200 messages %zu, want 3", g.of(MSG_DUELIST_ELIMINATED).size());
	if(!failures) std::printf("ok   s2: seat 1 out, then 200 for seats 0 and 2 before MSG_WIN(0xFF)\n");
}
static void check_s2all() {
	Game g;
	setup(g, 3, false);
	fill_decks(g);
	OCG_StartDuel(g.d);
	drive(g, 4000, [&](Game& g, const Msg&) {
		if(g.idle_no == 1) lua(g, "Duel.SetLP(0,0) Duel.SetLP(1,0) Duel.SetLP(2,0)");
	}, 7);
	std::printf("     messages: %s (%d steps)\n", summary(g).c_str(), g.steps);
	const auto wins = g.of(MSG_WIN);
	const size_t iw = g.index_of(MSG_WIN);
	size_t n200 = 0; bool seat[3] = {};
	bool before_win = true;
	for(size_t i = 0; i < g.log.size(); ++i)
		if(g.log[i].id == MSG_DUELIST_ELIMINATED) { ++n200; seat[g.log[i].data[0] % 3] = true; before_win = before_win && i < iw; }
	EXPECT(wins.size() == 1 && wins[0].data[0] == 0xFF, "want one MSG_WIN(0xFF), got %zu", wins.size());
	EXPECT(n200 == 3 && seat[0] && seat[1] && seat[2] && before_win, "want three 200 before MSG_WIN, got %zu", n200);
	if(!failures) std::printf("ok   s2all: three 200 then MSG_WIN(0xFF)\n");
}
static void check_tagdraw() {
	Game g;
	setup(g, 4, true);
	fill_decks(g);
	OCG_StartDuel(g.d);
	drive(g, 4000, [&](Game& g, const Msg&) {
		if(g.idle_no == 1) lua(g, "Duel.SetLP(0,0) Duel.SetLP(1,0)");
	}, 7);
	std::printf("     messages: %s (%d steps)\n", summary(g).c_str(), g.steps);
	const auto wins = g.of(MSG_WIN);
	EXPECT(wins.size() == 1 && wins[0].data[0] == 0xFF, "want one MSG_WIN(0xFF), got %zu", wins.size());
	EXPECT(g.of(MSG_DUELIST_ELIMINATED).empty(), "Tag end must not send 200 (got %zu)", g.of(MSG_DUELIST_ELIMINATED).size());
	if(!failures) std::printf("ok   tagdraw: MSG_WIN(0xFF) only, no 200\n");
}

// ---------------------------------------------------------------- s3
static void check_s3(int n) {
	Game g;
	setup(g, n, false);
	fill_decks(g);
	for(int p = 0; p < n; ++p)
		put(g.d, static_cast<uint8_t>(p), static_cast<uint8_t>(p), LOCATION_MZONE, 0);
	OCG_StartDuel(g.d);
	g.want_bp = true;
	int seen = 0;
	const uint8_t want = n == 2 ? PLAYER_NONE : DUELIST_NONE;
	drive(g, 4000, [&](Game& g, const Msg& m) {
		if(m.id != MSG_SELECT_BATTLECMD) return;
		auto& f = F(g.d);
		for(auto* list : { &f.core.units, &f.core.subunits })
			for(auto& unit : *list) {
				auto* bc = Processors::get_opt_variant<Processors::BattleCommand>(unit);
				if(!bc) continue;
				++seen;
				std::printf("     BattleCommand (step %u) reason_player = %u at turn %d\n", static_cast<unsigned>(bc->step), static_cast<unsigned>(bc->reason_player), f.infos.turn_id);
				EXPECT(bc->reason_player == want, "reason_player %u, want %u", static_cast<unsigned>(bc->reason_player), static_cast<unsigned>(want));
			}
		if(seen) g.stop = true;
	}, 12);
	EXPECT(seen > 0, "no BattleCommand unit seen at a battle prompt");
	if(!failures) std::printf("ok   s3 n=%d: reason_player == %u\n", n, static_cast<unsigned>(want));
}

// ---------------------------------------------------------------- s4
static void check_s4(int n) {
	Game g;
	setup(g, n, false);
	fill_decks(g);
	card* atk = put(g.d, 0, 0, LOCATION_MZONE, 0);
	OCG_StartDuel(g.d);
	bool done = false;
	drive(g, 4000, [&](Game& g, const Msg&) {
		if(g.idle_no != 1) return;
		auto& f = F(g.d);
		effect* dc = nullptr; card* rc = nullptr; std::array<bool, 2> bd{};
		f.core.attacker = atk;
		f.core.attack_target = nullptr;
		f.core.battle_defender = DUELIST_NONE;
		f.calculate_battle_damage(&dc, &rc, &bd);
		std::printf("     no defender: damage [%d %d %d %d], reason card %s\n", f.core.battle_damage[0], f.core.battle_damage[1],
			f.core.battle_damage[2], f.core.battle_damage[3], rc ? "set" : "none");
		if(n > 2) {
			EXPECT(f.core.battle_damage[0] == 0 && f.core.battle_damage[1] == 0 && f.core.battle_damage[2] == 0 && f.core.battle_damage[3] == 0,
				"damage with no defender");
			EXPECT(rc == nullptr, "reason card set with no defender");
			f.core.battle_defender = 1;
			f.calculate_battle_damage(&dc, &rc, &bd);
			std::printf("     defender seat 1: damage [%d %d %d %d]\n", f.core.battle_damage[0], f.core.battle_damage[1], f.core.battle_damage[2], f.core.battle_damage[3]);
			EXPECT(f.core.battle_damage[1] == 1000 && f.core.battle_damage[0] == 0 && f.core.battle_damage[2] == 0 && rc == atk, "damage to the chosen defender");
		} else {
			EXPECT(f.core.battle_damage[1] == 1000 && f.core.battle_damage[0] == 0 && rc == atk, "n=2 direct attack damage");
		}
		f.core.attacker = nullptr;
		f.core.battle_defender = DUELIST_NONE;
		done = true;
		g.stop = true;
	});
	EXPECT(done, "hook did not run");
	if(!failures) std::printf("ok   s4 n=%d\n", n);
}

int main(int argc, char** argv) {
	const std::string mode = argc > 1 ? argv[1] : "";
	if(mode == "s1") check_s1();
	else if(mode == "s2") check_s2();
	else if(mode == "s2all") check_s2all();
	else if(mode == "tagdraw") check_tagdraw();
	else if(mode == "s3") check_s3(3);
	else if(mode == "s3n2") check_s3(2);
	else if(mode == "s4") check_s4(3);
	else if(mode == "s4n2") check_s4(2);
	else { std::printf("unknown mode\n"); return 2; }
	std::printf("%s %s: %d failure(s)\n", failures ? "FAIL" : "PASS", mode.c_str(), failures);
	return failures ? 1 : 0;
}
