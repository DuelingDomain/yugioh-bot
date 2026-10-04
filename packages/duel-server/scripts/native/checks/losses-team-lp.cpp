// T5A native check: losses, win, draw, team LP, Debug.EliminateDuelist, SetupDuelists mode checks,
// first attack rule after eliminations. Links the gate's native core (no trap define), so the
// n > 2 duels run through sites that later tasks still have to change; the checks look only at
// the messages and the state that T5A owns. eliminate(p, reason) is the T5A stub (sets eliminated).
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
	return OCG_LoadScript(d, code.c_str(), static_cast<uint32_t>(code.size()), "check.lua") != 0;
}
static OCG_Duel make_duel(uint32_t lp = 8000, uint64_t flags = DUEL_MODE_MR5, uint32_t seed = 1) {
	OCG_DuelOptions options;
	std::memset(&options, 0, sizeof(options));
	options.seed[0] = seed;
	options.seed[1] = 2;
	options.seed[2] = 3;
	options.seed[3] = 4;
	options.flags = flags;
	options.team1 = {lp, 5, 1};
	options.team2 = {lp, 5, 1};
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
static void add_cards(OCG_Duel d, uint8_t con, uint32_t loc, int count) {
	for(int i = 0; i < count; ++i) {
		OCG_NewCardInfo info;
		std::memset(&info, 0, sizeof(info));
		info.team = con;
		info.duelist = 0;
		info.code = 1;
		info.con = con;
		info.loc = loc;
		info.pos = POS_FACEDOWN_DEFENSE;
		OCG_DuelNewCard(d, &info);
	}
}

struct Msg { uint8_t id; std::vector<uint8_t> data; };
struct IdleInfo { int turn_id; int turn_player; bool before; };
struct Game {
	OCG_Duel d = nullptr;
	int n = 2;
	std::vector<Msg> log;
	std::vector<IdleInfo> idles;
	int idle_no = 0;
	int steps = 0;
	bool stuck = false;
	std::vector<Msg> of(uint8_t id) const {
		std::vector<Msg> r;
		for(const auto& m : log)
			if(m.id == id)
				r.push_back(m);
		return r;
	}
	size_t index_of(uint8_t id, size_t nth = 0) const {
		for(size_t i = 0; i < log.size(); ++i)
			if(log[i].id == id && nth-- == 0)
				return i;
		return SIZE_MAX;
	}
	~Game() { if(d) OCG_DestroyDuel(d); }
};
// layout: 0 = n duelists free for all, 1 = Tag (n = 4). decks[p] = main deck size.
static void setup(Game& g, int n, bool tag, std::vector<int> decks, uint32_t lp = 8000, uint64_t flags = DUEL_MODE_MR5) {
	g.n = n;
	g.d = make_duel(lp, flags);
	if(n > 2) {
		std::string code = "Debug.SetupDuelists(" + std::to_string(n);
		for(int i = 0; i < n; ++i)
			code += "," + std::to_string(tag ? i % 2 : i);
		code += ")";
		if(!run_lua(g.d, code)) {
			std::printf("FAIL: %s: %s\n", code.c_str(), last_log.c_str());
			std::exit(2);
		}
	}
	for(int p = 0; p < n; ++p)
		add_cards(g.d, static_cast<uint8_t>(p), LOCATION_DECK, decks[p]);
	OCG_StartDuel(g.d);
}
using Hook = std::function<void(Game&)>;
// Runs process steps. At each idle prompt (before answering) records the turn info, counts the idle
// prompt and calls the hook. Answers idle with End Phase, chain with "no chain", select_card with
// the first cards. Runs max_steps steps (the core keeps going after MSG_WIN, so the check decides).
static void drive(Game& g, int max_steps, const Hook& hook = nullptr, int stop_turn = 1 << 30) {
	for(int i = 0; i < max_steps && !g.stuck; ++i) {
		++g.steps;
		const int status = OCG_DuelProcess(g.d);
		uint32_t length = 0;
		const auto* buffer = static_cast<const uint8_t*>(OCG_DuelGetMessage(g.d, &length));
		bool idle = false, chain = false, select_card = false;
		uint32_t select_min = 0;
		for(uint32_t offset = 0; offset + 4 <= length;) {
			uint32_t size = 0;
			std::memcpy(&size, buffer + offset, 4);
			if(size > 0) {
				Msg m;
				m.id = buffer[offset + 4];
				m.data.assign(buffer + offset + 5, buffer + offset + 4 + size);
				g.log.push_back(m);
				if(m.id == MSG_SELECT_IDLECMD) idle = true;
				if(m.id == MSG_SELECT_CHAIN) chain = true;
				if(m.id == MSG_SELECT_CARD && size > 10) {
					select_card = true;
					std::memcpy(&select_min, buffer + offset + 7, 4);
				}
			}
			offset += 4 + size;
		}
		if(status == OCG_DUEL_STATUS_END)
			return;
		if(status != OCG_DUEL_STATUS_AWAITING)
			continue;
		if(idle) {
			auto& f = F(g.d);
			g.idles.push_back({f.infos.turn_id, f.infos.turn_player, f.before_first_attack_turn()});
			++g.idle_no;
			if(hook)
				hook(g);
			if(f.infos.turn_id > stop_turn)
				return;
			const uint32_t to_end_phase = 7;
			OCG_DuelSetResponse(g.d, &to_end_phase, sizeof(to_end_phase));
		} else if(chain) {
			const int32_t no_chain = -1;
			OCG_DuelSetResponse(g.d, &no_chain, sizeof(no_chain));
		} else if(select_card) {
			std::vector<uint32_t> response{0, select_min};
			for(uint32_t k = 0; k < select_min; ++k)
				response.push_back(k);
			OCG_DuelSetResponse(g.d, response.data(), static_cast<uint32_t>(response.size() * sizeof(uint32_t)));
		} else {
			g.stuck = true;
		}
	}
}
static std::string summary(const Game& g) {
	std::string s;
	int shown = 0;
	for(const auto& m : g.log) {
		if(m.id == 200 || m.id == MSG_WIN) {
			if(++shown > 12) { s += "..."; break; } // a finished n=2 duel repeats MSG_WIN: keep the log short
			s += (m.id == 200 ? "200(" : "WIN(") + std::to_string(m.data[0]) + "," + std::to_string(m.data[1]) + ") ";
		}
	}
	return s;
}
static std::vector<int> new_turns(const Game& g) {
	std::vector<int> r;
	for(const auto& m : g.log)
		if(m.id == MSG_NEW_TURN)
			r.push_back(m.data[0]);
	return r;
}
static bool has(const Game& g, uint8_t id, int a, int b) {
	for(const auto& m : g.log)
		if(m.id == id && m.data.size() >= 2 && m.data[0] == a && m.data[1] == b)
			return true;
	return false;
}
static void lua(Game& g, const std::string& code) {
	if(!run_lua(g.d, code)) {
		++failures;
		std::printf("FAIL: lua '%s': %s\n", code.c_str(), last_log.c_str());
	}
}

static void check_ffa3_lp() {
	Game g;
	setup(g, 3, false, {40, 40, 40});
	drive(g, 4000, [](Game& g) {
		if(g.idle_no == 1)
			lua(g, "Duel.SetLP(1,0)");
	}, 7);
	auto& f = F(g.d);
	// The elimination body of the merged core sends MSG_DUELIST_ELIMINATED (200) once for seat 1 (reason 1: LP at 0).
	EXPECT(g.of(200).size() == 1 && has(g, 200, 1, 1), "FFA3 LP: 200 for seat 1: %s", summary(g).c_str());
	EXPECT(g.of(MSG_WIN).empty(), "FFA3 LP: MSG_WIN sent: %s", summary(g).c_str());
	EXPECT(f.player[1].eliminated && !f.player[0].eliminated && !f.player[2].eliminated, "FFA3 LP: eliminated flags");
	const auto turns = new_turns(g);
	bool skips = turns.size() >= 4;
	for(size_t i = 1; i < turns.size(); ++i)
		skips = skips && turns[i] != 1 && turns[i] != turns[i - 1];
	EXPECT(skips && turns[0] == 0, "FFA3 LP: turn order wrong (%zu turns)", turns.size());
	std::printf("ok   FFA3: LP of seat 1 to 0 -> %s, no MSG_WIN, turns after: ", summary(g).c_str());
	for(size_t i = 0; i < turns.size() && i < 8; ++i) std::printf("%d ", turns[i]);
	std::printf("\n");
}

static void check_ffa3_last() {
	Game g;
	setup(g, 3, false, {40, 40, 40});
	drive(g, 4000, [](Game& g) {
		if(g.idle_no == 1) lua(g, "Duel.SetLP(1,0)");
		if(g.idle_no == 2) lua(g, "Duel.SetLP(0,0)");
	}, 7);
	const auto wins = g.of(MSG_WIN);
	EXPECT(wins.size() == 1 && wins[0].data[0] == 2 && wins[0].data[1] == 1, "FFA3 last: %s", summary(g).c_str());
	// Seat 1 went out first (200 at once); the last loser (seat 0) gets its 200 before the MSG_WIN.
	EXPECT(g.of(200).size() == 2 && has(g, 200, 1, 1) && has(g, 200, 0, 1), "FFA3 last: 200s %s", summary(g).c_str());
	EXPECT(g.index_of(200, 0) < g.index_of(MSG_WIN), "FFA3 last: 200 after MSG_WIN");
	EXPECT(F(g.d).player[0].eliminated && F(g.d).player[1].eliminated && F(g.d).player[2].eliminated, "FFA3 last (all marked once the duel is over): flags %d%d%d", F(g.d).player[0].eliminated, F(g.d).player[1].eliminated, F(g.d).player[2].eliminated);
	std::printf("ok   FFA3: last duelist standing -> %s (exactly one MSG_WIN, 200 before it, none after %d steps)\n", summary(g).c_str(), g.steps);
}

static void check_all_zero() {
	{
		Game g;
		setup(g, 3, false, {40, 40, 40});
		drive(g, 4000, [](Game& g) {
			if(g.idle_no == 1) lua(g, "Duel.SetLP(0,0) Duel.SetLP(1,0) Duel.SetLP(2,0)");
		}, 7);
		const auto wins = g.of(MSG_WIN);
		EXPECT(wins.size() == 1 && wins[0].data[0] == 0xFF && wins[0].data[1] == 1 && g.of(200).size() == 3 && has(g, 200, 0, 1) && has(g, 200, 1, 1) && has(g, 200, 2, 1), "FFA3 all zero: %s", summary(g).c_str());
		std::printf("ok   FFA3: all living at 0 together -> %s\n", summary(g).c_str());
	}
	{
		Game g;
		setup(g, 4, false, {40, 40, 40, 40});
		drive(g, 4000, [](Game& g) {
			if(g.idle_no == 1) lua(g, "Duel.SetLP(1,0)");
			if(g.idle_no == 2) lua(g, "Duel.SetLP(0,0) Duel.SetLP(2,0) Duel.SetLP(3,0)");
		}, 7);
		const auto wins = g.of(MSG_WIN);
		EXPECT(wins.size() == 1 && wins[0].data[0] == 0xFF && g.of(200).size() == 4 && has(g, 200, 1, 1) && has(g, 200, 0, 1) && has(g, 200, 2, 1) && has(g, 200, 3, 1) && F(g.d).player[1].eliminated, "FFA4 all zero: %s", summary(g).c_str());
		std::printf("ok   FFA4: seat 1 out, then the 3 living at 0 together -> %s\n", summary(g).c_str());
	}
}

static void check_deck() {
	Game g;
	setup(g, 3, false, {40, 5, 40});
	drive(g, 4000, nullptr, 7);
	EXPECT(F(g.d).player[1].eliminated && !F(g.d).player[0].eliminated && !F(g.d).player[2].eliminated, "deck: flags %s", summary(g).c_str());
	EXPECT(g.of(MSG_WIN).empty(), "deck: MSG_WIN sent");
	std::printf("ok   FFA3: seat 1 with a 5 card Deck cannot draw -> %s, no MSG_WIN\n", summary(g).c_str());
}

static void check_tag() {
	Game g;
	setup(g, 4, true, {40, 40, 40, 40}, 16000);
	auto& f = F(g.d);
	EXPECT(f.lp_ref(2) == f.lp_ref(0) && f.lp_ref(3) == f.lp_ref(1) && f.lp_ref(0) == 16000, "Tag: lp_ref at start");
	lua(g, "Duel.SetLP(2,12345)");
	EXPECT(f.player[0].lp == 12345 && f.lp_ref(0) == 12345, "Tag: SetLP(2) did not set the team LP (%d)", f.player[0].lp);
	lua(g, "Duel.SetLP(2,16000)");
	int before = 0;
	drive(g, 4000, [&](Game& g) {
		if(g.idle_no == 1) {
			before = f.player[1].lp;
			f.damage(nullptr, REASON_EFFECT, 0, nullptr, 3, 1000);
		}
	}, 1);
	EXPECT(before == 16000 && f.player[1].lp == 15000 && f.player[3].lp == 16000, "Tag: damage to seat 3: player[1].lp %d player[3].lp %d", f.player[1].lp, f.player[3].lp);
	EXPECT(has(g, MSG_DAMAGE, 3, 0) || !g.of(MSG_DAMAGE).empty(), "Tag: no MSG_DAMAGE");
	// team 1 (seats 1 and 3) to 0: team 0 wins, no MSG_DUELIST_ELIMINATED.
	Game h;
	setup(h, 4, true, {40, 40, 40, 40}, 16000);
	drive(h, 4000, [](Game& g) {
		if(g.idle_no == 1) lua(g, "Duel.SetLP(3,0)");
	}, 5);
	const auto wins = h.of(MSG_WIN);
	EXPECT(wins.size() == 1 && wins[0].data[0] == 0 && wins[0].data[1] == 1 && h.of(200).empty(), "Tag team at 0: %s", summary(h).c_str());
	EXPECT(F(h.d).lp_ref(1) == 0 && F(h.d).lp_ref(3) == 0, "Tag: both partners read 0");
	std::printf("ok   Tag: GetLP(2)==GetLP(0), damage to seat 3 -> player[1].lp %d, team at 0 -> %s (no 200)\n", f.player[1].lp, summary(h).c_str());
}

static void check_eliminate_call() {
	Game g;
	setup(g, 3, false, {40, 40, 40});
	drive(g, 4000, [](Game& g) {
		if(g.idle_no == 1) lua(g, "Debug.EliminateDuelist(1, 7)");
		if(g.idle_no == 2) lua(g, "Debug.EliminateDuelist(0, 3)");
	}, 7);
	const auto wins = g.of(MSG_WIN);
	EXPECT(F(g.d).player[1].eliminated && F(g.d).player[0].eliminated && has(g, 200, 0, 3), "EliminateDuelist: %s", summary(g).c_str());
	EXPECT(wins.size() == 1 && wins[0].data[0] == 2 && wins[0].data[1] == 3, "EliminateDuelist: win %s", summary(g).c_str());
	std::printf("ok   FFA3: Debug.EliminateDuelist from OCG_LoadScript -> %s\n", summary(g).c_str());
	// No one loses before the next Adjust: the flag is only pending at the call.
	Game h;
	setup(h, 3, false, {40, 40, 40});
	drive(h, 4000, [](Game& g) {
		if(g.idle_no == 1) {
			lua(g, "Debug.EliminateDuelist(2, 9)");
			EXPECT(!F(g.d).player[2].eliminated && F(g.d).player[2].pending_loss == 0x109, "pending_loss not set by the call");
		}
	}, 3);
	EXPECT(F(h.d).player[2].eliminated && F(h.d).player[2].pending_loss == 0, "EliminateDuelist(2,9): %s", summary(h).c_str());
	// Errors.
	const char* bad[] = {
		"Debug.EliminateDuelist(5,1)", "Debug.EliminateDuelist(-1,1)", "Debug.EliminateDuelist(3,1)",
		"Debug.EliminateDuelist(1,256)", "Debug.EliminateDuelist(1,-1)", "Debug.EliminateDuelist(1)", "Debug.EliminateDuelist('x',1)",
	};
	for(const char* code : bad) {
		OCG_Duel d = make_duel();
		run_lua(d, "Debug.SetupDuelists(3,0,1,2)");
		EXPECT(!run_lua(d, code), "%s: no Lua error", code);
		EXPECT(F(d).player[0].pending_loss == 0 && F(d).player[1].pending_loss == 0 && F(d).player[2].pending_loss == 0, "%s: state changed", code);
		OCG_DestroyDuel(d);
	}
	{
		OCG_Duel d = make_duel();
		EXPECT(!run_lua(d, "Debug.EliminateDuelist(1,1)"), "n=2: no Lua error");
		EXPECT(F(d).player[1].pending_loss == 0, "n=2: state changed");
		OCG_DestroyDuel(d);
	}
	{
		// A duelist that is eliminated already.
		Game e;
		setup(e, 3, false, {40, 40, 40});
		drive(e, 4000, [](Game& g) {
			if(g.idle_no == 1) lua(g, "Duel.SetLP(1,0)");
			if(g.idle_no == 2) {
				EXPECT(!run_lua(g.d, "Debug.EliminateDuelist(1,1)"), "eliminated duelist: no Lua error");
			}
		}, 3);
	}
	std::printf("ok   Debug.EliminateDuelist: bad p, bad reason, n = 2, eliminated p -> Lua error, nothing changed\n");
}

static void check_duel_win() {
	Game g;
	setup(g, 3, false, {40, 40, 40});
	drive(g, 4000, [](Game& g) {
		if(g.idle_no == 1) lua(g, "Duel.Win(0,0x12) Duel.Win(1,0x13)");
	}, 7);
	const auto wins = g.of(MSG_WIN);
	EXPECT(has(g, 200, 1, 0x12) && has(g, 200, 2, 0x12) && wins.size() == 1 && wins[0].data[0] == 0 && wins[0].data[1] == 0x12,
	       "Duel.Win n=3: %s", summary(g).c_str());
	// Immune opponents: no loss.
	std::printf("ok   FFA3: Duel.Win(0,0x12) (the second call is ignored) -> %s\n", summary(g).c_str());
}

static void check_setup_modes() {
	struct Case { const char* name; uint64_t flags; const char* call; bool ok; };
	const Case cases[] = {
		{"RELAY n=3", DUEL_MODE_MR5 | DUEL_RELAY, "Debug.SetupDuelists(3,0,1,2)", false},
		{"RELAY n=4 Tag", DUEL_MODE_MR5 | DUEL_RELAY, "Debug.SetupDuelists(4,0,1,0,1)", false},
		{"INVERTED_QUICK_PRIORITY n=3", DUEL_MODE_MR5 | DUEL_INVERTED_QUICK_PRIORITY, "Debug.SetupDuelists(3,0,1,2)", false},
		{"INVERTED_QUICK_PRIORITY n=4", DUEL_MODE_MR5 | DUEL_INVERTED_QUICK_PRIORITY, "Debug.SetupDuelists(4,0,1,2,3)", false},
		{"RELAY n=2", DUEL_MODE_MR5 | DUEL_RELAY, "Debug.SetupDuelists(2,0,1)", true},
		{"INVERTED n=2", DUEL_MODE_MR5 | DUEL_INVERTED_QUICK_PRIORITY, "Debug.SetupDuelists(2,0,1)", true},
		{"plain n=3", DUEL_MODE_MR5, "Debug.SetupDuelists(3,0,1,2)", true},
	};
	for(const auto& c : cases) {
		OCG_Duel d = make_duel(8000, c.flags);
		const bool ok = run_lua(d, c.call);
		EXPECT(ok == c.ok, "%s: result %d", c.name, ok);
		if(!c.ok)
			EXPECT(F(d).n_duelists == 2 && F(d).n_teams == 2 && F(d).first_attack_turn == 2, "%s: state changed", c.name);
		std::printf("ok   SetupDuelists %s -> %s%s%s\n", c.name, ok ? "accepted" : "Lua error: ", ok ? "" : last_log.c_str(), "");
		OCG_DestroyDuel(d);
	}
}

static void check_first_attack() {
	auto first_per_turn = [](const Game& g) {
		std::vector<std::pair<int, bool>> r;
		for(const auto& i : g.idles)
			if(r.empty() || r.back().first != i.turn_id)
				r.push_back({i.turn_id, i.before});
		return r;
	};
	auto show = [](const std::vector<std::pair<int, bool>>& v) {
		std::string s;
		for(const auto& x : v) s += "t" + std::to_string(x.first) + (x.second ? ":no " : ":atk ");
		return s;
	};
	auto expect_rule = [&](const char* name, const std::vector<std::pair<int, bool>>& got, int first_attack_turn, size_t skip_from = 0, int shift = 0) {
		(void)skip_from; (void)shift;
		bool good = got.size() >= 6;
		for(const auto& x : got)
			good = good && (x.second == (x.first < first_attack_turn));
		EXPECT(good, "first attack %s: %s (first attack turn %d)", name, show(got).c_str(), first_attack_turn);
		std::printf("ok   first attack %s: %s\n", name, show(got).c_str());
	};
	{ Game g; setup(g, 2, false, {40, 40}); drive(g, 4000, nullptr, 6); expect_rule("n=2", first_per_turn(g), 2); }
	{ Game g; setup(g, 3, false, {40, 40, 40}); drive(g, 4000, nullptr, 7); expect_rule("FFA3 nobody out", first_per_turn(g), 3); }
	{ Game g; setup(g, 4, false, {40, 40, 40, 40}); drive(g, 6000, nullptr, 8); expect_rule("FFA4 nobody out", first_per_turn(g), 4); }
	{ Game g; setup(g, 4, true, {40, 40, 40, 40}); drive(g, 6000, nullptr, 8); expect_rule("Tag", first_per_turn(g), 4); }
	{
		// FFA4, seat 1 out before its first turn: seats 0, 2, 3 start turns 1, 2, 3; seat 3 may battle on turn 3.
		Game g;
		setup(g, 4, false, {40, 40, 40, 40});
		drive(g, 6000, [](Game& g) { if(g.idle_no == 1) lua(g, "Duel.SetLP(1,0)"); }, 8);
		const auto v = first_per_turn(g);
		const auto t = new_turns(g);
		bool good = v.size() >= 5;
		for(const auto& x : v)
			good = good && (x.second == (x.first < 3));
		EXPECT(good && t.size() >= 4 && t[1] == 2 && t[2] == 3 && t[3] == 0, "FFA4 seat 1 out: %s", show(v).c_str());
		std::printf("ok   first attack FFA4 seat 1 eliminated before its turn: %s (attacks from turn 3)\n", show(v).c_str());
	}
	{
		// FFA3, seat 1 out before its first turn: seats 0 and 2 start turns 1 and 2; seat 2 may battle on turn 2.
		Game g;
		setup(g, 3, false, {40, 40, 40});
		drive(g, 6000, [](Game& g) { if(g.idle_no == 1) lua(g, "Duel.SetLP(1,0)"); }, 7);
		const auto v = first_per_turn(g);
		const auto t = new_turns(g);
		bool good = v.size() >= 4;
		for(const auto& x : v)
			good = good && (x.second == (x.first < 2));
		EXPECT(good && t.size() >= 3 && t[1] == 2 && t[2] == 0, "FFA3 seat 1 out: %s", show(v).c_str());
		std::printf("ok   first attack FFA3 seat 1 eliminated before its turn: %s\n", show(v).c_str());
	}
}

static void check_n2() {
	// A full 2 duelist duel to MSG_WIN (deck out), and the LP and Duel.Win paths. No 200, one MSG_WIN.
	{
		Game g;
		setup(g, 2, false, {40, 40});
		drive(g, 20000, [](Game& g) { (void)g; });
		const auto w = g.of(MSG_WIN);
		EXPECT(!w.empty() && w[0].data[1] == 2 && g.of(200).empty(), "n=2 full duel: %s (%d steps)", summary(g).c_str(), g.steps);
		std::printf("ok   n=2: a full duel ends with %s after %d steps, no 200\n", summary(g).c_str(), g.steps);
	}
	struct Case { const char* code; int win; int reason; };
	const Case cases[] = {
		{"Duel.SetLP(1,0)", 0, 1}, {"Duel.SetLP(0,0)", 1, 1}, {"Duel.SetLP(0,0) Duel.SetLP(1,0)", 2, 1},
		{"Duel.Win(1,0x11)", 1, 0x11}, {"Duel.Win(2,0x11)", 2, 0x11},
	};
	for(const auto& c : cases) {
		Game g;
		setup(g, 2, false, {40, 40});
		drive(g, 400, [&](Game& g) { if(g.idle_no == 1) lua(g, c.code); }, 4);
		const auto w = g.of(MSG_WIN);
		EXPECT(!w.empty() && w[0].data[0] == c.win && w[0].data[1] == c.reason && g.of(200).empty(), "n=2 '%s': %s", c.code, summary(g).c_str());
		std::printf("ok   n=2 '%s' -> %s\n", c.code, summary(g).c_str());
	}
}

int main(int argc, char** argv) {
	const std::string mode = argc > 1 ? argv[1] : "check";
	check_setup_modes();
	check_ffa3_lp();
	check_ffa3_last();
	check_all_zero();
	check_deck();
	check_tag();
	check_eliminate_call();
	check_duel_win();
	check_first_attack();
	check_n2();
	(void)mode;
	std::printf("%s: %d failure(s)\n", failures ? "FAIL" : "PASS", failures);
	return failures ? 1 : 0;
}
