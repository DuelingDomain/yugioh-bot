// T0 native check for Debug.SetupDuelists and the multi-duelist interface.
// Build and run: bash packages/duel-server/scripts/native/checks/run.sh <check name> (see README.md).
// Modes:
//   check            all checks below (exit 0 = pass); setup, cards, identity = one part
//   trap-n2          (trap build) a 2-duelist duel to the end: must not abort
//   trap-n3          (trap build) a 3-duelist duel: must abort with "YGO_N_TRAP opponent_of"
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
#include "common.h"

static std::string last_log;


static void read_card(void*, uint32_t code, OCG_CardData* data) {
	std::memset(data, 0, sizeof(*data));
	data->code = code;
	// Code 2 is an Extra Deck monster (Fusion). Every other code is a vanilla Main Deck monster.
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

static OCG_Duel make_duel(uint32_t seed = 1) {
	OCG_DuelOptions options;
	std::memset(&options, 0, sizeof(options));
	options.seed[0] = seed;
	options.seed[1] = 2;
	options.seed[2] = 3;
	options.seed[3] = 4;
	options.flags = DUEL_MODE_MR5;
	// Different values for team1 and team2 show which entry a new duelist copies.
	options.team1 = {8000, 5, 1};
	options.team2 = {7000, 4, 2};
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
static void add_cards(OCG_Duel d, uint8_t con, uint8_t team, uint32_t loc, int count, uint32_t code = 1) {
	for(int i = 0; i < count; ++i) {
		OCG_NewCardInfo info;
		std::memset(&info, 0, sizeof(info));
		info.team = team;
		info.duelist = 0;
		info.code = code;
		info.con = con;
		info.loc = loc;
		info.seq = 0;
		info.pos = POS_FACEDOWN_DEFENSE;
		OCG_DuelNewCard(d, &info);
	}
}

// One process step like smoke.cpp. Returns the status. Appends the message bytes to out.
static int last_prompt = 0;
// The stock core sends MSG_WIN and goes on. The host stops there, so the check stops there too.
static bool saw_win = false;
static int step(OCG_Duel d, std::vector<uint8_t>& out, bool& answered_prompt) {
	answered_prompt = false;
	int status = OCG_DuelProcess(d);
	uint32_t length = 0;
	const auto* buffer = static_cast<const uint8_t*>(OCG_DuelGetMessage(d, &length));
	out.insert(out.end(), buffer, buffer + length);
	bool idle = false, chain = false, select_card = false;
	uint32_t select_min = 0;
	for(uint32_t offset = 0; offset + 4 <= length;) {
		uint32_t size = 0;
		std::memcpy(&size, buffer + offset, 4);
		if(size > 0)
			last_prompt = buffer[offset + 4];
		if(size > 0 && buffer[offset + 4] == MSG_WIN)
			saw_win = true;
		if(size > 0 && std::getenv("CHECK_TRACE"))
			std::fprintf(stderr, "msg %u size %u\n", static_cast<unsigned>(buffer[offset + 4]), size);
		if(size > 0 && buffer[offset + 4] == MSG_SELECT_IDLECMD)
			idle = true;
		if(size > 0 && buffer[offset + 4] == MSG_SELECT_CHAIN)
			chain = true;
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
			answered_prompt = true;
		} else if(idle) {
			const uint32_t to_end_phase = 7;
			OCG_DuelSetResponse(d, &to_end_phase, sizeof(to_end_phase));
			answered_prompt = true;
		} else if(select_card) {
			// For example the End Phase discard: pick the first min cards.
			std::vector<uint32_t> response{ 0, select_min };
			for(uint32_t i = 0; i < select_min; ++i)
				response.push_back(i);
			OCG_DuelSetResponse(d, response.data(), static_cast<uint32_t>(response.size() * sizeof(uint32_t)));
			answered_prompt = true;
		}
	}
	return status;
}

struct Layout {
	int n;
	std::vector<int> team;
	int teams;
	int first_attack;
};

static void check_success() {
	const Layout layouts[] = {
		{2, {0, 1}, 2, 2},
		{3, {0, 1, 2}, 3, 4},
		{4, {0, 1, 2, 3}, 4, 5},
		{4, {0, 1, 0, 1}, 2, 4},
	};
	for(const auto& l : layouts) {
		OCG_Duel d = make_duel();
		std::string code = "Debug.SetupDuelists(" + std::to_string(l.n);
		for(int t : l.team)
			code += "," + std::to_string(t);
		code += ")";
		const bool ok = run_lua(d, code);
		EXPECT(ok, "%s failed: %s", code.c_str(), last_log.c_str());
		auto& f = F(d);
		EXPECT(f.n_duelists == l.n, "%s: n_duelists %d", code.c_str(), f.n_duelists);
		EXPECT(f.n_teams == l.teams, "%s: n_teams %d", code.c_str(), f.n_teams);
		EXPECT(f.first_attack_turn == l.first_attack, "%s: first_attack_turn %d", code.c_str(), f.first_attack_turn);
		for(int i = 0; i < MAX_DUELISTS; ++i) {
			const int want_team = i < l.n ? l.team[i] : i;
			EXPECT(f.player[i].team == want_team, "%s: player[%d].team %d", code.c_str(), i, f.player[i].team);
			EXPECT(!f.player[i].eliminated, "%s: player[%d] eliminated", code.c_str(), i);
		}
		// Starting values: 0 = team1, 1 = team2, 2+ copy the team leader (Tag) or player 0 (FFA).
		for(int i = 0; i < l.n; ++i) {
			const int from = i < 2 ? i : (l.team[i] != i ? l.team[i] : 0);
			const int lp = from == 1 ? 7000 : 8000, sc = from == 1 ? 4 : 5, dc = from == 1 ? 2 : 1;
			const auto& p = f.player[i];
			EXPECT(p.lp == lp && p.start_lp == lp && p.start_count == sc && p.draw_count == dc,
			       "%s: player[%d] lp %d/%d start %d draw %d", code.c_str(), i, p.lp, p.start_lp, p.start_count, p.draw_count);
		}
		// lp_ref: the team LP.
		for(int i = 0; i < l.n; ++i)
			EXPECT(&f.lp_ref(static_cast<uint8_t>(i)) == &f.player[l.team[i]].lp, "%s: lp_ref(%d)", code.c_str(), i);
		std::printf("ok   %s -> n=%d teams=%d first_attack_turn=%d\n", code.c_str(), f.n_duelists, f.n_teams, f.first_attack_turn);
		OCG_DestroyDuel(d);
	}
	// A second call replaces the first one (no card yet).
	{
		OCG_Duel d = make_duel();
		EXPECT(run_lua(d, "Debug.SetupDuelists(4,0,1,2,3)"), "first call");
		EXPECT(run_lua(d, "Debug.SetupDuelists(3,0,1,2)"), "second call: %s", last_log.c_str());
		auto& f = F(d);
		EXPECT(f.n_duelists == 3 && f.n_teams == 3 && f.first_attack_turn == 4 && f.player[3].team == 3, "second call values");
		OCG_DestroyDuel(d);
		std::printf("ok   a second call before any card replaces the first\n");
	}
}

static void expect_state_unchanged(OCG_Duel d, const char* what) {
	auto& f = F(d);
	bool same = f.n_duelists == 2 && f.n_teams == 2 && f.first_attack_turn == 2;
	for(int i = 0; i < MAX_DUELISTS; ++i)
		same = same && f.player[i].team == i && !f.player[i].eliminated;
	same = same && f.player[2].lp == 0 && f.player[3].lp == 0;
	EXPECT(same, "%s: state changed after a failed call", what);
}

static void check_errors() {
	const char* bad_calls[] = {
		"Debug.SetupDuelists()",
		"Debug.SetupDuelists('x',0,1)",
		"Debug.SetupDuelists(1,0)",
		"Debug.SetupDuelists(0)",
		"Debug.SetupDuelists(-1,0,1)",
		"Debug.SetupDuelists(5,0,1,2,3,4)",
		"Debug.SetupDuelists(256,0,1)",
		"Debug.SetupDuelists(258,0,1,2)",
		"Debug.SetupDuelists(1099511627778,0,1)",
		"Debug.SetupDuelists(3,0,1)",
		"Debug.SetupDuelists(4,0,1,2)",
		"Debug.SetupDuelists(3,0,1,3)",
		"Debug.SetupDuelists(3,0,1,-1)",
		"Debug.SetupDuelists(3,0,1,258)",
		"Debug.SetupDuelists(2,0,nil)",
		"Debug.SetupDuelists(2,1,0)",
		"Debug.SetupDuelists(3,0,0,1)",
		"Debug.SetupDuelists(4,0,1,1,0)",
		"Debug.SetupDuelists(2,0,0)",
		"Debug.SetupDuelists(3,0,1,1)",
		"Debug.SetupDuelists(3,0,0,0)",
		"Debug.SetupDuelists(4,0,0,2,2)",
		"Debug.SetupDuelists(4,0,1,2,2)",
		"Debug.SetupDuelists(4,0,1,0,3)",
		"Debug.SetupDuelists(4,0,0,0,0)",
	};
	for(const char* code : bad_calls) {
		OCG_Duel d = make_duel();
		const bool ok = run_lua(d, code);
		EXPECT(!ok, "%s: no Lua error", code);
		expect_state_unchanged(d, code);
		std::printf("ok   %s -> Lua error: %s\n", code, last_log.c_str());
		OCG_DestroyDuel(d);
	}
	// A card exists already (deck card, and a relay card with duelist != 0).
	{
		OCG_Duel d = make_duel();
		add_cards(d, 0, 0, LOCATION_DECK, 1);
		const bool ok = run_lua(d, "Debug.SetupDuelists(3,0,1,2)");
		EXPECT(!ok, "card exists: no Lua error");
		expect_state_unchanged(d, "card exists");
		std::printf("ok   after OCG_DuelNewCard -> Lua error: %s\n", last_log.c_str());
		OCG_DestroyDuel(d);
	}
	{
		OCG_Duel d = make_duel();
		OCG_NewCardInfo info;
		std::memset(&info, 0, sizeof(info));
		info.team = 1;
		info.duelist = 1;
		info.code = 1;
		info.con = 1;
		info.loc = LOCATION_DECK;
		OCG_DuelNewCard(d, &info);
		const bool ok = run_lua(d, "Debug.SetupDuelists(4,0,1,0,1)");
		EXPECT(!ok, "relay card exists: no Lua error");
		expect_state_unchanged(d, "relay card exists");
		std::printf("ok   after a relay card -> Lua error: %s\n", last_log.c_str());
		OCG_DestroyDuel(d);
	}
	{
		OCG_Duel d = make_duel();
		const bool ok = run_lua(d, "Debug.AddCard(1,0,0,LOCATION_HAND or 2,0,POS_FACEUP_ATTACK or 1) Debug.SetupDuelists(3,0,1,2)");
		EXPECT(!ok, "Debug.AddCard card exists: no Lua error");
		expect_state_unchanged(d, "Debug.AddCard card exists");
		std::printf("ok   after Debug.AddCard -> Lua error: %s\n", last_log.c_str());
		OCG_DestroyDuel(d);
	}
	// The duel started: right after OCG_StartDuel (subunits), and after some process steps (turn_id).
	for(int steps = 0; steps <= 3; steps += 3) {
		OCG_Duel d = make_duel();
		OCG_StartDuel(d);
		std::vector<uint8_t> sink;
		bool answered = false;
		for(int i = 0; i < steps; ++i)
			step(d, sink, answered);
		const bool ok = run_lua(d, "Debug.SetupDuelists(3,0,1,2)");
		EXPECT(!ok, "duel started (%d steps): no Lua error", steps);
		expect_state_unchanged(d, "duel started");
		std::printf("ok   after OCG_StartDuel and %d steps (turn_id %d) -> Lua error: %s\n", steps, F(d).infos.turn_id, last_log.c_str());
		OCG_DestroyDuel(d);
	}
	// Debug.ReloadFieldBegin makes a new field with 2 duelists.
	{
		OCG_Duel d = make_duel();
		EXPECT(run_lua(d, "Debug.SetupDuelists(4,0,1,0,1)"), "setup before reload");
		EXPECT(run_lua(d, "Debug.ReloadFieldBegin(0)"), "reload: %s", last_log.c_str());
		EXPECT(F(d).n_duelists == 2 && F(d).first_attack_turn == 2, "reload keeps n=%d", F(d).n_duelists);
		OCG_DestroyDuel(d);
		std::printf("ok   Debug.ReloadFieldBegin resets to 2 duelists\n");
	}
}

static void check_cards() {
	for(int n = 3; n <= 4; ++n) {
		OCG_Duel d = make_duel();
		std::string code = n == 3 ? "Debug.SetupDuelists(3,0,1,2)" : "Debug.SetupDuelists(4,0,1,2,3)";
		EXPECT(run_lua(d, code), "%s", code.c_str());
		auto& f = F(d);
		for(int p = 0; p < n; ++p) {
			add_cards(d, static_cast<uint8_t>(p), static_cast<uint8_t>(p), LOCATION_DECK, 40);
			add_cards(d, static_cast<uint8_t>(p), static_cast<uint8_t>(p), LOCATION_EXTRA, 3, 2);
		}
		const size_t cards_before = static_cast<duel*>(d)->cards.size();
		// Not a duelist in play: con or team n and 255 are ignored.
		add_cards(d, static_cast<uint8_t>(n), 0, LOCATION_DECK, 1);
		add_cards(d, 0, static_cast<uint8_t>(n), LOCATION_DECK, 1);
		add_cards(d, 255, 0, LOCATION_HAND, 1);
		add_cards(d, 0, 255, LOCATION_HAND, 1);
		EXPECT(static_cast<duel*>(d)->cards.size() == cards_before, "a card for a duelist not in play was added");
		for(int p = 0; p < n; ++p) {
			const auto& pl = f.player[p];
			bool owned = true;
			for(auto* c : pl.list_main)
				owned = owned && c->owner == p && c->current.controler == p && c->current.location == LOCATION_DECK;
			for(auto* c : pl.list_extra)
				owned = owned && c->owner == p && c->current.controler == p && c->current.location == LOCATION_EXTRA;
			EXPECT(pl.list_main.size() == 40 && pl.list_extra.size() == 3 && owned, "n=%d con %d: deck %zu extra %zu owned %d",
			       n, p, pl.list_main.size(), pl.list_extra.size(), owned);
			EXPECT(OCG_DuelQueryCount(d, static_cast<uint8_t>(p), LOCATION_DECK) == 40, "QueryCount deck con %d", p);
			EXPECT(OCG_DuelQueryCount(d, static_cast<uint8_t>(p), LOCATION_EXTRA) == 3, "QueryCount extra con %d", p);
		}
		// Start the duel: every duelist draws the opening hand. Run to the first idle prompt.
		OCG_StartDuel(d);
		std::vector<uint8_t> sink;
		bool answered = false;
		int status = OCG_DUEL_STATUS_CONTINUE;
		for(int i = 0; i < 200 && !answered; ++i) {
			status = step(d, sink, answered);
			if(status == OCG_DUEL_STATUS_END)
				break;
		}
		// Opening hand = start_count (5 from team1, 4 from team2; duelists 2 and 3 copy player 0).
		std::string hands;
		for(int p = 0; p < n; ++p) {
			const uint32_t want = p == 1 ? 4 : 5;
			const uint32_t hand = OCG_DuelQueryCount(d, static_cast<uint8_t>(p), LOCATION_HAND);
			const uint32_t deck = OCG_DuelQueryCount(d, static_cast<uint8_t>(p), LOCATION_DECK);
			EXPECT(hand == want && deck == 40 - want, "n=%d duelist %d: hand %u deck %u", n, p, hand, deck);
			hands += (p ? "/" : "") + std::to_string(hand);
		}
		EXPECT(answered, "n=%d: no first idle prompt (status %d)", n, status);
		std::printf("ok   n=%d: 40 deck + 3 extra cards per con 0..%d, bad con/team ignored, opening hands %s, turn %d idle prompt reached\n",
		            n, n - 1, hands.c_str(), f.infos.turn_id);
		OCG_DestroyDuel(d);
	}
}

// Runs a 2-duelist duel. setup: 0 = no call, 1 = Debug.SetupDuelists(2,0,1).
// Returns the message bytes per step (max_steps steps or until the end).
static std::vector<std::vector<uint8_t>> run_two(int setup, int max_steps, uint32_t seed) {
	OCG_Duel d = make_duel(seed);
	if(setup == 1 && !run_lua(d, "Debug.SetupDuelists(2,0,1)")) {
		std::printf("FAIL: SetupDuelists(2,0,1): %s\n", last_log.c_str());
		++failures;
	}
	for(uint8_t team = 0; team < 2; ++team) {
		add_cards(d, team, team, LOCATION_DECK, 40);
		add_cards(d, team, team, LOCATION_EXTRA, 2, 2);
	}
	OCG_StartDuel(d);
	saw_win = false;
	std::vector<std::vector<uint8_t>> steps;
	for(int i = 0; i < max_steps && !saw_win; ++i) {
		std::vector<uint8_t> bytes;
		bool answered = false;
		const int status = step(d, bytes, answered);
		steps.push_back(std::move(bytes));
		if(status == OCG_DUEL_STATUS_END)
			break;
		if(status == OCG_DUEL_STATUS_AWAITING && !answered)
			break;
	}
	uint32_t length = 0;
	const auto* q = static_cast<const uint8_t*>(OCG_DuelQueryField(d, &length));
	steps.emplace_back(q, q + length);
	OCG_DestroyDuel(d);
	return steps;
}

static void check_identity() {
	for(uint32_t seed : {1u, 77u, 4242u}) {
		for(int max_steps : {50, 5000}) {
			const auto a = run_two(0, max_steps, seed);
			const auto b = run_two(1, max_steps, seed);
			size_t bytes = 0;
			for(const auto& s : a)
				bytes += s.size();
			EXPECT(a == b, "seed %u, %d steps: message bytes differ", seed, max_steps);
			std::printf("ok   n=2 seed %u, limit %d: %zu steps (%zu bytes incl. final QueryField)%s identical with and without SetupDuelists(2,0,1)\n",
			            seed, max_steps, a.size() - 1, bytes, saw_win ? ", to MSG_WIN," : "");
		}
	}
}

static int trap_run(int n) {
	OCG_Duel d = make_duel();
	if(n > 2) {
		std::string code = n == 3 ? "Debug.SetupDuelists(3,0,1,2)" : "Debug.SetupDuelists(4,0,1,2,3)";
		if(!run_lua(d, code))
			return 3;
	}
	for(int p = 0; p < n; ++p)
		add_cards(d, static_cast<uint8_t>(p), static_cast<uint8_t>(p), LOCATION_DECK, 40);
	OCG_StartDuel(d);
	saw_win = false;
	std::vector<uint8_t> sink;
	int steps = 0;
	for(; steps < 5000 && !saw_win; ++steps) {
		bool answered = false;
		const int status = step(d, sink, answered);
		if(status == OCG_DUEL_STATUS_END)
			break;
		if(status == OCG_DUEL_STATUS_AWAITING && !answered)
			break;
	}
	OCG_DestroyDuel(d);
	std::printf("trap-n%d: %d steps%s, no trap\n", n, steps, saw_win ? " to MSG_WIN" : "");
	return 0;
}

int main(int argc, char** argv) {
	const std::string mode = argc > 1 ? argv[1] : "check";
	if(mode == "trap-n2")
		return trap_run(2);
	if(mode == "trap-n3")
		return trap_run(3);
	// "check" = all, including "cards", in the trap build too.
	const bool all = mode == "check";
	if(all || mode == "setup") {
		check_success();
		check_errors();
	}
	if(all || mode == "cards")
		check_cards();
	if(all || mode == "identity")
		check_identity();
	std::printf("%s: %d failure(s)\n", failures ? "FAIL" : "PASS", failures);
	return failures ? 1 : 0;
}
