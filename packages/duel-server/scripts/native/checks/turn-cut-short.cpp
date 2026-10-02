// Native check: a turn cut short by the loss of its turn player (n > 2, ADR 0002, elimination).
// Rule: the turn counts as an ended turn for every turn count ("until the end of the Nth turn", RESET_*_TURN with a count),
// so the End Phase event of that turn is not skipped for the others: a continuous EVENT_PHASE+PHASE_END effect of a living
// duelist fires in it, and the effect ends exactly as if the turn had reached its End Phase. Nobody is asked in that
// End Phase (no optional effect, no free chain window). Finding s3-turns-1 (Nightmare's Steelcage was never destroyed).
// The effect is the Steelcage pattern with no card script: a continuous field effect of seat 0 (owner: a card of seat 0) that fires in an End Phase
// of an opponent turn (count limit 1 for each turn) and resets with RESET_PHASE+PHASE_END+RESET_OPPO_TURN, count 2, and a
// player effect (code 91001) with the same reset that shows when the reset has run.
//   A  FFA4, seat 2 gives up in its own turn 3: the End Phase of turn 2 and of the cut-short turn 3 fire, the effect is gone
//      from turn 4
//   B  FFA4, seat 1 gives up in its own turn 2 (the first counted turn): fires in turns 2 and 3, gone from turn 4
//   C  FFA4, nobody out: the same result (control)
//   D  Tag, seat 1 gives up in its own turn 2: turn 2 counts, the partner turn 3 does not count (R-TAG-PARTNER): fires in
//      turns 2 and 4, gone from turn 5
#include "scripted-duel.h"

static const uint32_t kFiller = 5000;

struct Run {
	std::vector<int> fired;    // turn ids in which the continuous effect fired
	std::vector<int> present;  // present[t-1]: the player effect is there at the first idle prompt of turn t
	int cut_end_prompts = 0;   // MSG_SELECT_CHAIN in the End Phase of the cut-short turn (none is expected)
	int to_dead = 0;           // prompts for a seat after it was eliminated
	bool eliminated_seen = false;
};

static const char* kRegister = R"LUA(
local c=Duel.GetFieldGroup(0,LOCATION_DECK,0):GetFirst()
local e=Effect.CreateEffect(c)
e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
e:SetCode(EVENT_PHASE+PHASE_END)
e:SetCountLimit(1)
e:SetCondition(function(e,tp) return Duel.IsTurnPlayer(1-tp) end)
e:SetOperation(function(e,tp) Debug.Message("CHK fire "..Duel.GetTurnCount()) end)
e:SetReset(RESET_PHASE+PHASE_END+RESET_OPPO_TURN,2)
Duel.RegisterEffect(e,0)
local g=Effect.CreateEffect(c)
g:SetType(EFFECT_TYPE_FIELD)
g:SetCode(91001)
g:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
g:SetTargetRange(1,0)
g:SetReset(RESET_PHASE+PHASE_END+RESET_OPPO_TURN,2)
Duel.RegisterEffect(g,0)
)LUA";

// out_turn = the turn in which `out_seat` gives up (0 = nobody)
static Run play(const std::string& setup, int n, int out_turn, int out_seat, int turns) {
	Run run;
	sd::stray_logs = 0;
	sd::on_line = [&run](const std::string& line) {
		int t = 0;
		if(std::sscanf(line.c_str(), "CHK fire %d", &t) == 1) run.fired.push_back(t);
	};
	OCG_Duel d = sd::create(setup);
	for(int p = 0; p < n; ++p)
		for(int i = 0; i < 30; ++i) sd::add(d, static_cast<uint8_t>(p), kFiller, LOCATION_DECK);
	OCG_StartDuel(d);
	std::vector<sd::Msg> msgs;
	const sd::Msg* pm = nullptr;
	int last_turn = 0;
	for(int steps = 0; steps < 4000; ++steps) {
		const int status = sd::step(d, msgs, pm);
		if(status == OCG_DUEL_STATUS_END) break;
		if(status != OCG_DUEL_STATUS_AWAITING) continue;
		if(!pm) { std::printf("FAIL: awaiting without a prompt\n"); ++failures; break; }
		auto& f = sd::F(d);
		if(run.eliminated_seen && pm->len > 0 && pm->p[0] == out_seat) ++run.to_dead;
		if(pm->id == MSG_SELECT_CHAIN) {
			if(run.eliminated_seen && f.infos.turn_id == out_turn && f.infos.phase == PHASE_END) ++run.cut_end_prompts;
			sd::answer32(d, -1);
			continue;
		}
		if(pm->id == MSG_SELECT_CARD) {  // the discard at the end of a turn with more than 6 cards in hand: the first cards
			uint32_t min = 0;
			std::memcpy(&min, pm->p + 2, 4);
			std::vector<uint32_t> rr{ 0, min };
			for(uint32_t i = 0; i < min; ++i) rr.push_back(i);
			OCG_DuelSetResponse(d, rr.data(), static_cast<uint32_t>(rr.size() * 4));
			continue;
		}
		if(pm->id != MSG_SELECT_IDLECMD) {
			std::printf("FAIL: unexpected prompt %u\n", pm->id);
			++failures;
			break;
		}
		const int turn = static_cast<int>(f.infos.turn_id);
		if(turn != last_turn) {
			last_turn = turn;
			if(turn == 1) sd::lua(d, kRegister);
			run.present.push_back(f.is_player_affected_by_effect(0, 91001) != nullptr);
			if(turn >= turns) break;
			if(turn == out_turn && out_seat >= 0) {
				f.eliminate(static_cast<uint8_t>(out_seat), 1);
				run.eliminated_seen = true;
			}
		}
		sd::answer32(d, 7);  // end the turn
	}
	OCG_DestroyDuel(d);
	return run;
}

static std::string list(const std::vector<int>& v) {
	std::string s;
	for(int x : v) s += (s.empty() ? "" : ",") + std::to_string(x);
	return s.empty() ? "-" : s;
}

static void expect_run(const char* name, const Run& r, const std::vector<int>& fired, int last_present, int turns) {
	EXPECT(r.fired == fired, "%s: fired in turns %s, want %s", name, list(r.fired).c_str(), list(fired).c_str());
	EXPECT(static_cast<int>(r.present.size()) == turns, "%s: %zu turns played, want %d", name, r.present.size(), turns);
	for(size_t i = 0; i < r.present.size(); ++i) {
		const int turn = static_cast<int>(i) + 1;
		EXPECT(r.present[i] == (turn <= last_present), "%s: turn %d player effect present=%d, want %d", name, turn, r.present[i], turn <= last_present);
	}
	EXPECT(r.cut_end_prompts == 0, "%s: %d chain prompt(s) in the End Phase of the cut-short turn, want none", name, r.cut_end_prompts);
	EXPECT(r.to_dead == 0, "%s: %d prompt(s) for the seat that gave up", name, r.to_dead);
	EXPECT(sd::stray_logs == 0, "%s: %d unexpected core log line(s)", name, sd::stray_logs);
	std::printf("ok   %s: fired in turns %s, player effect gone from turn %d\n", name, list(r.fired).c_str(), last_present + 1);
}

int main() {
	const std::string ffa4 = "Debug.SetupDuelists(4,0,1,2,3)";
	const std::string tag = "Debug.SetupDuelists(4,0,1,0,1)";
	// C: control, nobody out. The turns of seats 1 and 2 count and end the effect at the end of turn 3.
	expect_run("C ffa4 nobody out", play(ffa4, 4, 0, -1, 6), { 2, 3 }, 3, 6);
	// A: seat 2 gives up in its own turn 3. The cut-short turn counts: same result as the control.
	expect_run("A ffa4 seat 2 out in turn 3", play(ffa4, 4, 3, 2, 6), { 2, 3 }, 3, 6);
	// B: seat 1 gives up in its own turn 2. The cut-short turn is the 1st counted turn, turn 3 (seat 2) the 2nd.
	expect_run("B ffa4 seat 1 out in turn 2", play(ffa4, 4, 2, 1, 6), { 2, 3 }, 3, 6);
	// D: Tag, seat 1 gives up in its own turn 2 (it was the 1st opposing turn). The partner turn 3 does not count and
	// no one is asked. Turn 4 (seat 3) is the 2nd opposing turn, so the effect fires in turns 2 and 4 and is gone from turn 5.
	expect_run("D tag seat 1 out in turn 2", play(tag, 4, 2, 1, 7), { 2, 4 }, 4, 7);
	std::printf("%s: %d failure(s)\n", failures ? "FAIL" : "PASS", failures);
	return failures ? 1 : 0;
}
