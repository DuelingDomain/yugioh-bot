// T4 native check: battle for more than two duelists.
// T4 native check: battle for more than two duelists. Run build.sh (links the gate lib of T4).
// Modes: all (default) | n2hash (prints FNV hashes of the n=2 runs; compare with the base lib by linking it).
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

constexpr uint8_t K_MSG_ATTACK_DUELIST = 201; // the base headers do not have it
static std::string last_log;

// Code 1: vanilla deck card (ATK 1000). Code 2: Extra Deck filler. Code 3: attacker (ATK 2000).
// Code 4: defender (ATK 500).
static void read_card(void*, uint32_t code, OCG_CardData* data) {
	std::memset(data, 0, sizeof(*data));
	data->code = code;
	data->type = TYPE_MONSTER | (code == 2 ? TYPE_FUSION : TYPE_NORMAL);
	data->level = 4;
	data->attribute = 1;
	data->race = 1;
	data->attack = code == 3 ? 2000 : (code == 4 ? 500 : 1000);
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
static void add_cards(OCG_Duel d, uint8_t con, uint8_t team, uint32_t loc, int count, uint32_t code = 1) {
	for(int i = 0; i < count; ++i) {
		OCG_NewCardInfo info;
		std::memset(&info, 0, sizeof(info));
		info.team = team;
		info.duelist = 0;
		info.code = code;
		info.con = con;
		info.loc = loc;
		info.pos = POS_FACEDOWN_DEFENSE;
		OCG_DuelNewCard(d, &info);
	}
}

struct Msg {
	uint8_t id;
	std::vector<uint8_t> data; // payload after the id
};
static std::vector<Msg> parse(const uint8_t* buffer, uint32_t length) {
	std::vector<Msg> out;
	for(uint32_t offset = 0; offset + 4 <= length;) {
		uint32_t size = 0;
		std::memcpy(&size, buffer + offset, 4);
		if(size > 0)
			out.push_back({buffer[offset + 4], std::vector<uint8_t>(buffer + offset + 5, buffer + offset + 4 + size)});
		offset += 4 + size;
	}
	return out;
}
static uint32_t rd32(const std::vector<uint8_t>& v, size_t at) {
	uint32_t x = 0;
	std::memcpy(&x, v.data() + at, 4);
	return x;
}
static uint64_t rd64(const std::vector<uint8_t>& v, size_t at) {
	uint64_t x = 0;
	std::memcpy(&x, v.data() + at, 8);
	return x;
}
static uint64_t fnv(const std::vector<uint8_t>& bytes) {
	uint64_t h = 1469598103934665603ull;
	for(uint8_t b : bytes)
		h = (h ^ b) * 1099511628211ull;
	return h;
}

struct Mon {
	uint8_t owner;
	uint32_t code;
};
struct Scenario {
	const char* name;
	int n;
	std::vector<int> team;   // empty for n == 2 without a setup call
	bool setup_call;         // call Debug.SetupDuelists
	std::vector<Mon> mons;   // one monster zone 0 each (attack position)
	int pick_target;         // index in the attack-target list (-1: expect no list)
	int pick_option;         // index in the direct-attack option list (-1: expect no list)
	bool first_direct_yes;   // answer yes to "direct attack?" (desc 31)
};
struct Result {
	std::vector<uint8_t> bytes;     // every message byte of the run
	std::vector<Msg> msgs;
	uint8_t attacker_owner{};
	std::vector<uint8_t> target_list_controllers;
	std::vector<uint64_t> options;
	bool saw_direct_yesno{};
	bool saw_select_card{};
	bool attacker_direct_flag{};
	int idle_count_early{};
	int bp_offered_early{};
	int first_bp_turn{-1};
	int end_turn{};
	bool aborted{};
};

static Result play(const Scenario& sc, uint32_t seed) {
	Result r;
	OCG_Duel d = make_duel(seed);
	if(sc.setup_call) {
		std::string code = "Debug.SetupDuelists(" + std::to_string(sc.n);
		for(int t : sc.team)
			code += "," + std::to_string(t);
		code += ")";
		if(!run_lua(d, code)) {
			std::printf("FAIL: %s: %s\n", code.c_str(), last_log.c_str());
			++failures;
			r.aborted = true;
			OCG_DestroyDuel(d);
			return r;
		}
	}
	int next_seq[4] = {0, 0, 0, 0};
	for(const auto& m : sc.mons)
		if(!run_lua(d, "Debug.AddCard(" + std::to_string(m.code) + "," + std::to_string(m.owner) + "," + std::to_string(m.owner)
		                + ",4," + std::to_string(next_seq[m.owner]++) + ",1)")) { // 4 = LOCATION_MZONE, 1 = POS_FACEUP_ATTACK
			std::printf("FAIL: Debug.AddCard: %s\n", last_log.c_str());
			++failures;
			r.aborted = true;
			OCG_DestroyDuel(d);
			return r;
		}
	for(int p = 0; p < sc.n; ++p) {
		add_cards(d, static_cast<uint8_t>(p), static_cast<uint8_t>(p), LOCATION_DECK, 40);
		add_cards(d, static_cast<uint8_t>(p), static_cast<uint8_t>(p), LOCATION_EXTRA, 2, 2);
	}
	// The attacker (code 3) is the only monster of its owner that can attack.
	for(const auto& m : sc.mons)
		if(m.code == 3)
			r.attacker_owner = m.owner;
	OCG_StartDuel(d);
	bool attacked = false, target_done = false, finished = false;
	int battlecmds = 0;
	for(int steps = 0; steps < 4000 && !finished; ++steps) {
		const int status = OCG_DuelProcess(d);
		uint32_t length = 0;
		const auto* buffer = static_cast<const uint8_t*>(OCG_DuelGetMessage(d, &length));
		auto msgs = parse(buffer, length);
		r.bytes.insert(r.bytes.end(), buffer, buffer + length);
		for(auto& m : msgs)
			r.msgs.push_back(m);
		if(status == OCG_DUEL_STATUS_END)
			break;
		if(status != OCG_DUEL_STATUS_AWAITING || msgs.empty())
			continue;
		const Msg& last = msgs.back();
		if(std::getenv("CHECK_TRACE"))
			std::fprintf(stderr, "step %d turn %d phase %x prompt %u\n", steps, F(d).infos.turn_id, F(d).infos.phase, static_cast<unsigned>(last.id));
		const int turn = F(d).infos.turn_id;
		const uint8_t first_attack = static_cast<uint8_t>(F(d).first_attack_turn);
		auto respond = [&](int32_t v) { OCG_DuelSetResponse(d, &v, sizeof(v)); };
		switch(last.id) {
		case MSG_SELECT_IDLECMD: {
			const size_t n = last.data.size();
			const bool to_bp = last.data[n - 3] != 0;
			if(turn < first_attack) {
				++r.idle_count_early;
				if(to_bp)
					++r.bp_offered_early;
				respond(7);
			} else if(!attacked && last.data[0] == r.attacker_owner && to_bp) {
				r.first_bp_turn = turn;
				respond(6);
			} else {
				respond(7);
				if(attacked)
					finished = true;
			}
			break;
		}
		case MSG_SELECT_BATTLECMD: {
			++battlecmds;
			if(battlecmds == 1) {
				// activatable count (u32) then attackable list: find the direct flag of the first card
				size_t at = 1;
				const uint32_t act = rd32(last.data, at);
				at += 4 + act * (4 + 1 + 1 + 4 + 8 + 1);
				const uint32_t att = rd32(last.data, at);
				at += 4;
				if(att >= 1)
					r.attacker_direct_flag = last.data[at + 4 + 1 + 1 + 1] != 0;
				attacked = true;
				respond(1);
			} else {
				r.end_turn = turn;
				respond(3);
				finished = true;
			}
			break;
		}
		case MSG_SELECT_YESNO: {
			const uint64_t desc = rd64(last.data, 1);
			if(desc == 31) {
				r.saw_direct_yesno = true;
				respond(sc.first_direct_yes ? 1 : 0);
			} else
				respond(0);
			break;
		}
		case MSG_SELECT_OPTION: {
			const uint8_t count = last.data[1];
			for(int i = 0; i < count; ++i)
				r.options.push_back(rd64(last.data, 2 + 8 * i));
			respond(sc.pick_option < 0 ? 0 : sc.pick_option);
			break;
		}
		case MSG_SELECT_CARD: {
			const uint32_t min = rd32(last.data, 2);
			const uint32_t count = rd32(last.data, 10);
			if(attacked && !target_done) {
				target_done = true;
				r.saw_select_card = true;
				for(uint32_t i = 0; i < count; ++i)
					r.target_list_controllers.push_back(last.data[14 + i * 14 + 4]);
				const uint32_t resp[3] = {0, 1, static_cast<uint32_t>(sc.pick_target < 0 ? 0 : sc.pick_target)};
				OCG_DuelSetResponse(d, resp, sizeof(resp));
			} else {
				std::vector<uint32_t> response{0, min};
				for(uint32_t i = 0; i < min; ++i)
					response.push_back(i);
				OCG_DuelSetResponse(d, response.data(), static_cast<uint32_t>(response.size() * sizeof(uint32_t)));
			}
			break;
		}
		case MSG_SELECT_CHAIN:
			respond(-1);
			break;
		default:
			std::printf("FAIL: %s: unexpected prompt %u at step %d turn %d\n", sc.name, static_cast<unsigned>(last.id), steps, turn);
			++failures;
			r.aborted = true;
			finished = true;
		}
		for(const auto& m : msgs)
			if(m.id == MSG_RETRY) {
				std::printf("FAIL: %s: MSG_RETRY at step %d turn %d (prompt %u)\n", sc.name, steps, turn, static_cast<unsigned>(last.id));
				++failures;
				r.aborted = true;
				finished = true;
			}
	}
	OCG_DestroyDuel(d);
	return r;
}

// The messages from the first MSG_ATTACK on: the next few ids.
static int find_msg(const Result& r, uint8_t id, size_t from = 0) {
	for(size_t i = from; i < r.msgs.size(); ++i)
		if(r.msgs[i].id == id)
			return static_cast<int>(i);
	return -1;
}
static std::string ids_after_attack(const Result& r) {
	std::string s;
	const int a = find_msg(r, MSG_ATTACK);
	if(a < 0)
		return "no MSG_ATTACK";
	for(size_t i = static_cast<size_t>(a); i < r.msgs.size(); ++i) {
		s += std::to_string(r.msgs[i].id);
		if(r.msgs[i].id == K_MSG_ATTACK_DUELIST || r.msgs[i].id == MSG_DAMAGE)
			s += "(" + std::to_string(r.msgs[i].data[0]) + ")";
		if(r.msgs[i].id == MSG_DAMAGE)
			break;
		s += " ";
	}
	return s;
}

struct Expect {
	int list_size;                    // attack-target list size, -1 = no list
	std::vector<int> list_controllers; // sorted expectation, empty = do not check
	bool direct_yesno;
	std::vector<uint64_t> options;    // empty = no option prompt
	int attacked_duelist;             // the 201 payload, -1 = no 201
	int damaged_duelist;
	uint32_t damage;
};

static void verify(const Scenario& sc, const Result& r, const Expect& e) {
	if(r.aborted)
		return;
	EXPECT(r.saw_select_card == (e.list_size >= 0), "%s: target list prompt %d", sc.name, r.saw_select_card);
	if(e.list_size >= 0) {
		EXPECT(static_cast<int>(r.target_list_controllers.size()) == e.list_size, "%s: target list size %zu", sc.name, r.target_list_controllers.size());
		if(!e.list_controllers.empty()) {
			std::vector<int> got(r.target_list_controllers.begin(), r.target_list_controllers.end());
			EXPECT(got == e.list_controllers, "%s: target list controllers differ", sc.name);
		}
	}
	EXPECT(r.saw_direct_yesno == e.direct_yesno, "%s: direct yes/no %d", sc.name, r.saw_direct_yesno);
	EXPECT(r.options == e.options, "%s: option list has %zu entries", sc.name, r.options.size());
	const int a = find_msg(r, MSG_ATTACK);
	EXPECT(a >= 0, "%s: no MSG_ATTACK", sc.name);
	if(a < 0)
		return;
	const int dm = find_msg(r, K_MSG_ATTACK_DUELIST, static_cast<size_t>(a));
	if(e.attacked_duelist < 0) {
		EXPECT(dm < 0, "%s: unexpected K_MSG_ATTACK_DUELIST", sc.name);
	} else {
		EXPECT(dm == a + 1, "%s: K_MSG_ATTACK_DUELIST is not right after MSG_ATTACK (at %d, attack at %d)", sc.name, dm, a);
		if(dm >= 0)
			EXPECT(r.msgs[static_cast<size_t>(dm)].data.size() == 1 && r.msgs[static_cast<size_t>(dm)].data[0] == e.attacked_duelist,
			       "%s: attacked duelist %d", sc.name, dm >= 0 ? r.msgs[static_cast<size_t>(dm)].data[0] : -1);
	}
	const int dmg = find_msg(r, MSG_DAMAGE, static_cast<size_t>(a));
	EXPECT(dmg >= 0, "%s: no MSG_DAMAGE", sc.name);
	if(dmg >= 0) {
		const auto& m = r.msgs[static_cast<size_t>(dmg)];
		EXPECT(m.data[0] == e.damaged_duelist && rd32(m.data, 1) == e.damage, "%s: MSG_DAMAGE(%d, %u) want (%d, %u)", sc.name,
		       m.data[0], rd32(m.data, 1), e.damaged_duelist, e.damage);
		// only one MSG_DAMAGE
		EXPECT(find_msg(r, MSG_DAMAGE, static_cast<size_t>(dmg) + 1) < 0, "%s: a second MSG_DAMAGE", sc.name);
	}
	std::printf("ok   %-34s attacker seat %d turn %d, list %zu, options %zu, after MSG_ATTACK: %s\n", sc.name, r.attacker_owner,
	            r.first_bp_turn, r.target_list_controllers.size(), r.options.size(), ids_after_attack(r).c_str());
}

// The attack-turn seat: turn t is played by seat (t - 1) % n (no eliminated duelist).
static uint8_t seat_of_turn(int n, int turn) { return static_cast<uint8_t>((turn - 1) % n); }

static void check_battle() {
	const uint64_t opt1 = 0xFFFF0000ull | 1, opt2 = 0xFFFF0000ull | 2, opt3 = 0xFFFF0000ull | 3, opt0 = 0xFFFF0000ull;
	// FFA3: the first attack is on turn 4, played by seat 0.
	{
		Scenario s{"ffa3 both opponents have monsters -> seat 2's", 3, {0, 1, 2}, true, {{0, 3}, {1, 4}, {2, 4}}, 1, -1, true};
		// The list is sorted by card order: seat 1's monster, then seat 2's (both zone 0).
		auto r = play(s, 11);
		verify(s, r, {2, {1, 2}, false, {}, -1, 2, 1500});
	}
	{
		Scenario s{"ffa3 both opponents have monsters -> seat 1's", 3, {0, 1, 2}, true, {{0, 3}, {1, 4}, {2, 4}}, 0, -1, true};
		auto r = play(s, 12);
		verify(s, r, {2, {1, 2}, false, {}, -1, 1, 1500});
	}
	{
		Scenario s{"ffa3 both opponents empty -> option 1 (seat 2)", 3, {0, 1, 2}, true, {{0, 3}}, -1, 1, true};
		auto r = play(s, 13);
		verify(s, r, {-1, {}, false, {opt1, opt2}, 2, 2, 2000});
		EXPECT(r.attacker_direct_flag, "direct flag in MSG_SELECT_BATTLECMD");
	}
	{
		Scenario s{"ffa3 both opponents empty -> option 0 (seat 1)", 3, {0, 1, 2}, true, {{0, 3}}, -1, 0, true};
		auto r = play(s, 14);
		verify(s, r, {-1, {}, false, {opt1, opt2}, 1, 1, 2000});
	}
	{
		Scenario s{"ffa3 seat 1 has a monster, seat 2 open", 3, {0, 1, 2}, true, {{0, 3}, {1, 4}}, -1, -1, true};
		auto r = play(s, 15);
		verify(s, r, {-1, {}, true, {}, 2, 2, 2000});
	}
	{
		Scenario s{"ffa3 seat 2 has a monster, seat 1 open", 3, {0, 1, 2}, true, {{0, 3}, {2, 4}}, -1, -1, true};
		auto r = play(s, 16);
		verify(s, r, {-1, {}, true, {}, 1, 1, 2000});
	}
	{
		// One open opponent and a monster: the attack can also go to the monster (answer no).
		Scenario s{"ffa3 seat 1 has a monster, attack it (no direct)", 3, {0, 1, 2}, true, {{0, 3}, {1, 4}}, 0, -1, false};
		auto r = play(s, 17);
		verify(s, r, {1, {1}, true, {}, -1, 1, 1500});
	}
	{
		Scenario s{"ffa4 all three opponents empty -> option 2 (seat 3)", 4, {0, 1, 2, 3}, true, {{0, 3}}, -1, 2, true};
		auto r = play(s, 18);
		verify(s, r, {-1, {}, false, {opt1, opt2, opt3}, 3, 3, 2000});
	}
	{
		Scenario s{"ffa4 seat 2 has a monster -> options 1 and 3", 4, {0, 1, 2, 3}, true, {{0, 3}, {2, 4}}, -1, 1, true};
		auto r = play(s, 19);
		verify(s, r, {-1, {}, true, {opt1, opt3}, 3, 3, 2000});
	}
	{
		// Tag (teams seat % 2): seat 3 attacks on turn 4; opponents are seats 0 and 2, partner is seat 1.
		Scenario s{"tag opponents empty -> option 1 (seat 2)", 4, {0, 1, 0, 1}, true, {{3, 3}}, -1, 1, true};
		auto r = play(s, 20);
		verify(s, r, {-1, {}, false, {opt0, opt2}, 2, 2, 2000});
	}
	{
		Scenario s{"tag both opponents have monsters -> seat 0's", 4, {0, 1, 0, 1}, true, {{3, 3}, {0, 4}, {2, 4}}, 0, -1, true};
		auto r = play(s, 21);
		verify(s, r, {2, {0, 2}, false, {}, -1, 0, 1500});
	}
	// No Battle Phase before first_attack_turn.
	struct Early { const char* name; int n; std::vector<int> team; int first; };
	const Early early[] = {
		{"ffa3", 3, {0, 1, 2}, 4}, {"ffa4", 4, {0, 1, 2, 3}, 5}, {"tag", 4, {0, 1, 0, 1}, 4},
	};
	for(const auto& e : early) {
		const uint8_t who = seat_of_turn(e.n, e.first);
		Scenario s{e.name, e.n, e.team, true, {{who, 3}}, -1, 0, true};
		auto r = play(s, 30);
		EXPECT(!r.aborted, "%s early: aborted", e.name);
		EXPECT(r.idle_count_early == e.first - 1, "%s: %d idle prompts before turn %d", e.name, r.idle_count_early, e.first);
		EXPECT(r.bp_offered_early == 0, "%s: Battle Phase offered %d times before turn %d", e.name, r.bp_offered_early, e.first);
		EXPECT(r.first_bp_turn == e.first, "%s: first Battle Phase on turn %d (want %d)", e.name, r.first_bp_turn, e.first);
		std::printf("ok   %-34s turns 1-%d: no Battle Phase offered (%d idle prompts), Battle Phase on turn %d\n", e.name, e.first - 1,
		            r.idle_count_early, r.first_bp_turn);
	}
}

// n = 2: the same scenarios as the base. Prints an FNV hash of all message bytes. The build script
// compares the hashes of the T4 lib and of the base lib.
static void n2hash() {
	struct Case { const char* name; bool setup; std::vector<Mon> mons; int pick_target; };
	// Turn 2 is seat 1's. Seat 1 attacks seat 0.
	const Case cases[] = {
		{"n2 attack a monster", false, {{1, 3}, {0, 4}}, 0},
		{"n2 direct attack", false, {{1, 3}}, -1},
		{"n2 direct attack (SetupDuelists(2,0,1))", true, {{1, 3}}, -1},
		{"n2 attack a monster (SetupDuelists(2,0,1))", true, {{1, 3}, {0, 4}}, 0},
		{"n2 two defenders", false, {{1, 3}, {0, 4}, {0, 4}}, 1},
	};
	for(const auto& c : cases) {
		for(uint32_t seed : {5u, 6u}) {
			Scenario s{c.name, 2, {0, 1}, c.setup, c.mons, c.pick_target, -1, true};
			// Two monsters of one owner sit in zone 0 each: the second AddCard needs zone 1.
			auto r = play(s, seed);
			std::printf("n2hash %s seed %u bytes %zu hash %016llx aborted %d\n", c.name, seed, r.bytes.size(),
			            static_cast<unsigned long long>(fnv(r.bytes)), r.aborted ? 1 : 0);
			if(r.aborted)
				++failures;
			else {
				const int a = find_msg(r, MSG_ATTACK);
				const int dm = find_msg(r, MSG_DAMAGE, a < 0 ? 0 : static_cast<size_t>(a));
				EXPECT(a >= 0 && dm >= 0 && find_msg(r, K_MSG_ATTACK_DUELIST) < 0, "%s: n=2 battle messages", c.name);
			}
		}
	}
}

int main(int argc, char** argv) {
	const std::string mode = argc > 1 ? argv[1] : "all";
	if(mode == "all" || mode == "n2hash")
		n2hash();
	if(mode == "all")
		check_battle();
	std::printf("%s: %d failure(s)\n", failures ? "FAIL" : "PASS", failures);
	return failures ? 1 : 0;
}
