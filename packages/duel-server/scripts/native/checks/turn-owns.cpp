// Native check: Duel.MPTurnOwns(c) at n > 2 (finding s2-duelstyle-swap-1, Snatch Steal). The Lua values 0 and 1 fold every
// opponent to 1, so a script could not tell the OWNER of a controlled card from another opponent. MPTurnOwns(c) is true when
// the turn player is the real owner of c and alive, asks nothing, and binds that owner as the opponent of the scope, so that the
// Recover(1, ...) of the same scope gains the LP of exactly that owner (Tag: of the owner's team).
// A continuous Standby Phase effect of seat 0 (the "controller") recovers 1000 for "its opponent" only when MPTurnOwns(c) holds:
//   A  FFA3, c owned by seat 2: seat 2 gains 1000 in each of its Standby Phases (turns 3 and 6), nobody else gains, no question
//   B  FFA3, c owned by seat 1: seat 1 gains in turns 2 and 5 (an owner that is not the next seat after the controller)
//   C  Tag (seats 0,2 against 1,3), c owned by seat 3: the team of seat 3 gains 1000 in turn 4 only (not in turn 2, the
//      Standby Phase of the partner of the owner)
//   D  FFA3, owner seat 2 is eliminated in turn 2: the effect never gives LP (the owner is not alive), no error
#include "scripted-duel.h"

static const uint32_t kFiller = 5000;

struct Run {
	std::vector<int> rec_turns;   // turns in which the operation recovered
	int lp[4][8] = {};            // lp_ref of each seat at the first idle prompt of turn t (index t)
	int other_prompts = 0;        // prompts that are no idle command, chain or hand-limit prompt
	int turns = 0;
};

static std::string registration(int owner) {
	char buf[1200];
	std::snprintf(buf, sizeof buf, R"LUA(
local c=Duel.GetFieldGroup(0,LOCATION_DECK,0):GetFirst()
local tc=Duel.GetFieldGroup(%d,LOCATION_DECK,0):GetFirst()
local e=Effect.CreateEffect(c)
e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
e:SetCode(EVENT_PHASE+PHASE_STANDBY)
e:SetCountLimit(1)
e:SetCondition(function(e,tp) return Duel.MPTurnOwns(tc) end)
e:SetOperation(function(e,tp)
	if Duel.MPTurnOwns(tc) then
		Duel.Recover(1,1000,REASON_EFFECT)
		Debug.Message("CHK rec "..Duel.GetTurnCount())
	end
end)
Duel.RegisterEffect(e,0)
)LUA", owner);
	return buf;
}

// out_turn = the turn in which `out_seat` is eliminated at its first idle prompt (0 = nobody)
static Run play(const std::string& setup, int n, int owner, int turns, int out_turn = 0, int out_seat = -1) {
	Run run;
	sd::stray_logs = 0;
	sd::on_line = [&run](const std::string& line) {
		int t = 0;
		if(std::sscanf(line.c_str(), "CHK rec %d", &t) == 1) run.rec_turns.push_back(t);
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
		if(pm->id == MSG_SELECT_CHAIN) {
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
			++run.other_prompts;
			std::printf("FAIL: unexpected prompt %u\n", pm->id);
			++failures;
			break;
		}
		const int turn = static_cast<int>(f.infos.turn_id);
		if(turn != last_turn) {
			last_turn = turn;
			if(turn == 1) sd::lua(d, registration(owner));
			for(int s = 0; s < n; ++s) run.lp[s][turn] = f.lp_ref(static_cast<uint8_t>(s));
			run.turns = turn;
			if(turn >= turns) break;
			if(turn == out_turn && out_seat >= 0) f.eliminate(static_cast<uint8_t>(out_seat), 1);
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

// gained[s] = the total LP that seat s gained over the run (lp at the last turn start minus lp at turn 1)
static void expect_run(const char* name, const Run& r, const std::vector<int>& rec, const std::vector<int>& gained, int n) {
	EXPECT(r.rec_turns == rec, "%s: recovered in turns %s, want %s", name, list(r.rec_turns).c_str(), list(rec).c_str());
	for(int s = 0; s < n; ++s) {
		const int got = r.lp[s][r.turns] - r.lp[s][1];
		EXPECT(got == gained[static_cast<size_t>(s)], "%s: seat %d gained %d LP, want %d", name, s, got, gained[static_cast<size_t>(s)]);
	}
	EXPECT(r.other_prompts == 0, "%s: %d question(s) were asked", name, r.other_prompts);
	EXPECT(sd::stray_logs == 0, "%s: %d unexpected core log line(s)", name, sd::stray_logs);
	std::printf("ok   %s: recovered in turns %s\n", name, list(r.rec_turns).c_str());
}

int main() {
	const std::string ffa3 = "Debug.SetupDuelists(3,0,1,2)";
	const std::string tag = "Debug.SetupDuelists(4,0,1,0,1)";
	// A: the turn of seat 2 is turn 3 and turn 6; the controller is seat 0
	expect_run("A ffa3 owner seat 2", play(ffa3, 3, 2, 7), { 3, 6 }, { 0, 0, 2000 }, 3);
	// B: seat 1 is the next seat after the controller: turns 2 and 5
	expect_run("B ffa3 owner seat 1", play(ffa3, 3, 1, 7), { 2, 5 }, { 0, 2000, 0 }, 3);
	// C: Tag: the team LP is shared, seats 1 and 3 are one team. Seat 1 (the partner of the owner) takes turn 2: no LP.
	// Seat 3 (the owner) takes turn 4: +1000 for its team, so seat 1 and seat 3 both show it.
	expect_run("C tag owner seat 3", play(tag, 4, 3, 5), { 4 }, { 0, 1000, 0, 1000 }, 4);
	// D: the owner gives up in turn 2 (before its own turn): no LP at all and no problem
	expect_run("D ffa3 owner out", play(ffa3, 3, 2, 7, 2, 2), {}, { 0, 0, 0 }, 3);
	std::printf("%s: %d failure(s)\n", failures ? "FAIL" : "PASS", failures);
	return failures ? 1 : 0;
}
