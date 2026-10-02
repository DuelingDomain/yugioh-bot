// Native check: how a Tag team loses (patch 0019, field::check_losses_n) in the cases that no official card can make:
//   - EFFECT_CANNOT_LOSE_LP on ONE member: the team stays alive at team LP 0 (lead decision 10). The effect of a member of the
//     other team does not protect. When both teams are at 0, the team with the protected member wins (no draw).
//   - EFFECT_CANNOT_LOSE_DECK is per member: the protected member can draw from an empty Deck; the protection of the partner
//     does not save the team of a member who draws from an empty Deck.
//   - A team at 0 LP, p0 drawing from an empty Deck, and p2 drawing from an empty Deck while p0 still has cards: the other team
//     wins with the reason of the member. Both teams at 0 together: MSG_WIN(0xFF), a draw, no MSG_DUELIST_ELIMINATED.
// Stock scripts, no overlay: the effects are registered by a Lua line of the check (a player target field effect, code 400 or 401);
// the handler is a card of the Deck of seat 1 (every Deck in the effect cases has 40 cards).
// Tag layout: seats 0 and 2 are team 0, seats 1 and 3 are team 1. Turn order p0, p1, p2, p3 (turn 1 = p0, 3 = p2, 5 = p0).
#include "scripted-duel.h"

static const uint32_t kFiller = 5000;

struct Outcome {
	std::vector<std::pair<int, int>> wins;   // MSG_WIN (winner, reason)
	std::vector<int> win_turns;              // the turn in which each MSG_WIN was seen
	int n200 = 0;
	int turns = 0;                           // the last turn that started
	bool eliminated[4] = {};
	int lp[4] = {};                          // lp_ref at the end
	int other_prompts = 0;
};

// Registers a player target field effect (code 400 = CANNOT_LOSE_DECK, 401 = CANNOT_LOSE_LP) that affects `seat` only.
static std::string protect(int code, int seat) {
	char buf[600];
	std::snprintf(buf, sizeof buf, R"LUA(
local c=Duel.GetFieldGroup(1,LOCATION_DECK,0):GetFirst()
local e=Effect.CreateEffect(c)
e:SetType(EFFECT_TYPE_FIELD)
e:SetCode(%d)
e:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
e:SetTargetRange(1,0)
Duel.RegisterEffect(e,%d)
)LUA", code, seat);
	return buf;
}

// decks[s] = size of the main deck of seat s. At the first idle prompt of turn 1 the Lua text of `at_turn_1` runs. The duel is
// played (End Phase at every idle prompt) until a MSG_WIN, or until the turn `last_turn` has started.
static Outcome play(std::vector<int> decks, const std::string& at_turn_1, int last_turn) {
	Outcome out;
	sd::stray_logs = 0;
	sd::on_line = nullptr;
	OCG_Duel d = sd::create("Debug.SetupDuelists(4,0,1,0,1)");
	for(int p = 0; p < 4; ++p)
		for(int i = 0; i < decks[static_cast<size_t>(p)]; ++i) sd::add(d, static_cast<uint8_t>(p), kFiller, LOCATION_DECK);
	OCG_StartDuel(d);
	std::vector<sd::Msg> msgs;
	const sd::Msg* pm = nullptr;
	int last_seen = 0;
	bool done = false;
	for(int steps = 0; steps < 6000 && !done; ++steps) {
		const int status = sd::step(d, msgs, pm);
		auto& f = sd::F(d);
		for(const auto& m : msgs) {
			if(m.id == MSG_WIN && m.len >= 2) {
				out.wins.push_back({ m.p[0], m.p[1] });
				out.win_turns.push_back(static_cast<int>(f.infos.turn_id));
				done = true;
			}
			if(m.id == MSG_DUELIST_ELIMINATED) ++out.n200;
		}
		if(done || status == OCG_DUEL_STATUS_END) break;
		if(status != OCG_DUEL_STATUS_AWAITING) continue;
		if(!pm) { std::printf("FAIL: awaiting without a prompt\n"); ++failures; break; }
		if(pm->id == MSG_SELECT_CHAIN) { sd::answer32(d, -1); continue; }
		if(pm->id == MSG_SELECT_CARD) {  // the discard at the end of a turn with more than 6 cards in hand
			uint32_t min = 0;
			std::memcpy(&min, pm->p + 2, 4);
			std::vector<uint32_t> rr{ 0, min };
			for(uint32_t i = 0; i < min; ++i) rr.push_back(i);
			OCG_DuelSetResponse(d, rr.data(), static_cast<uint32_t>(rr.size() * 4));
			continue;
		}
		if(pm->id != MSG_SELECT_IDLECMD) {
			++out.other_prompts;
			std::printf("FAIL: unexpected prompt %u\n", pm->id);
			++failures;
			break;
		}
		const int turn = static_cast<int>(f.infos.turn_id);
		if(turn != last_seen) {
			last_seen = turn;
			out.turns = turn;
			if(turn == 1 && !at_turn_1.empty()) sd::lua(d, at_turn_1);
			if(turn >= last_turn) break;
		}
		sd::answer32(d, 7);
	}
	auto& f = sd::F(d);
	for(int s = 0; s < 4; ++s) {
		out.eliminated[s] = f.player[s].eliminated;
		out.lp[s] = f.lp_ref(static_cast<uint8_t>(s));
	}
	OCG_DestroyDuel(d);
	return out;
}

static std::string describe(const Outcome& o) {
	std::string s = "turn " + std::to_string(o.turns);
	for(size_t i = 0; i < o.wins.size(); ++i)
		s += " WIN(" + std::to_string(o.wins[i].first) + "," + std::to_string(o.wins[i].second) + ")@" + std::to_string(o.win_turns[i]);
	s += " 200x" + std::to_string(o.n200);
	return s;
}

static void expect_win(const char* name, const Outcome& o, int winner, int reason, int turn) {
	EXPECT(o.wins.size() == 1 && o.wins[0].first == winner && o.wins[0].second == reason && o.win_turns[0] == turn,
		"%s: %s, want WIN(%d,%d)@%d", name, describe(o).c_str(), winner, reason, turn);
	EXPECT(o.n200 == 0, "%s: %d MSG_DUELIST_ELIMINATED in a Tag duel", name, o.n200);
	EXPECT(o.other_prompts == 0 && sd::stray_logs == 0, "%s: %d question(s), %d stray log line(s)", name, o.other_prompts, sd::stray_logs);
	std::printf("ok   %s: %s\n", name, describe(o).c_str());
}

// No MSG_WIN, nobody eliminated: the duel is still on at the start of `turn`.
static void expect_alive(const char* name, const Outcome& o, int turn) {
	EXPECT(o.wins.empty() && o.n200 == 0 && o.turns >= turn, "%s: %s, want the duel on at turn %d", name, describe(o).c_str(), turn);
	for(int s = 0; s < 4; ++s) EXPECT(!o.eliminated[s], "%s: seat %d is eliminated", name, s);
	EXPECT(o.other_prompts == 0 && sd::stray_logs == 0, "%s: %d question(s), %d stray log line(s)", name, o.other_prompts, sd::stray_logs);
	std::printf("ok   %s: %s, nobody eliminated\n", name, describe(o).c_str());
}

int main() {
	const std::vector<int> full{ 40, 40, 40, 40 };
	const std::string zero0 = "Duel.SetLP(0,0)";
	// LP
	expect_win("L1 team 0 at 0 LP, no protection", play(full, zero0, 3), 1, 1, 1);
	{
		const auto o = play(full, protect(401, 2) + zero0, 9);
		expect_alive("L2 team 0 at 0 LP, the partner (seat 2) cannot lose LP", o, 9);
		EXPECT(o.lp[0] == 0 && o.lp[2] == 0 && o.lp[1] == 8000 && o.lp[3] == 8000, "L2: lp %d %d %d %d, want 0 8000 0 8000", o.lp[0], o.lp[1], o.lp[2], o.lp[3]);
	}
	{
		const auto o = play(full, protect(401, 0) + "Duel.SetLP(2,0)", 9);
		expect_alive("L3 team 0 at 0 LP (set by seat 2), seat 0 cannot lose LP", o, 9);
		EXPECT(o.lp[0] == 0 && o.lp[2] == 0, "L3: lp of team 0 %d %d, want 0 0", o.lp[0], o.lp[2]);
	}
	expect_win("L4 team 0 at 0 LP, a member of the other team (seat 1) cannot lose LP", play(full, protect(401, 1) + zero0, 3), 1, 1, 1);
	expect_win("L5 both teams at 0 LP, the team of seat 2 cannot lose LP: its team wins", play(full, protect(401, 2) + zero0 + "Duel.SetLP(1,0)", 3), 0, 1, 1);
	{
		const auto o = play(full, zero0 + "Duel.SetLP(3,0)", 3);
		expect_win("L6 both teams at 0 LP together: a draw", o, 0xFF, 1, 1);
	}
	// Deck
	expect_win("D1 seat 2 draws from an empty Deck while seat 0 has cards", play({ 40, 40, 5, 40 }, "", 9), 1, 2, 3);
	expect_win("D2 seat 0 draws from an empty Deck", play({ 5, 40, 40, 40 }, "", 9), 1, 2, 5);
	expect_win("D3 seat 3 draws from an empty Deck while seat 1 has cards", play({ 40, 40, 40, 5 }, "", 9), 0, 2, 4);
	{
		const auto o = play({ 40, 40, 5, 40 }, protect(400, 2), 9);
		expect_alive("D4 seat 2 cannot lose by an empty Deck and draws from one", o, 9);
	}
	expect_win("D5 seat 2 draws from an empty Deck, the partner (seat 0) cannot lose by Deck: the team loses",
		play({ 40, 40, 5, 40 }, protect(400, 0), 9), 1, 2, 3);
	expect_win("D6 seat 0 draws from an empty Deck, a member of the other team (seat 1) cannot lose by Deck",
		play({ 5, 40, 40, 40 }, protect(400, 1), 9), 1, 2, 5);
	// A member protected against LP loss is not protected against the Deck, and the other way round.
	expect_win("X1 seat 2 draws from an empty Deck, the team has a member that cannot lose LP: the team loses by Deck",
		play({ 40, 40, 5, 40 }, protect(401, 0), 9), 1, 2, 3);
	{
		const auto o = play(full, protect(400, 2) + zero0, 3);
		expect_win("X2 team 0 at 0 LP, the partner cannot lose by Deck: the team loses by LP", o, 1, 1, 1);
	}
	std::printf("%s: %d failure(s)\n", failures ? "FAIL" : "PASS", failures);
	return failures ? 1 : 0;
}
