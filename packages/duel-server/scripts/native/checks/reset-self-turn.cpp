// F9 native check: effects that reset by turn (RESET_PHASE with RESET_SELF_TURN or RESET_OPPO_TURN) in a Tag duel
// (n = 4, teams {0,1,0,1}, turn order 0,1,2,3,0,...).
// The rule (ADR 0002): RESET_SELF_TURN alone counts the turns of the duelist who owns the effect, not the turns of his
// partner. RESET_OPPO_TURN alone counts the turns of the other team. Both flags together (the default of SetReset)
// count every turn. Review finding (ee46639 had "same team" for the self turn): a partner turn used up a self turn.
//   A  seat 0, SELF alone, 2 turns    own turns are 1 and 5: the effect is there in turns 1..5, gone from turn 6
//   B  seat 0, default flags, 2 turns every turn counts: there in turns 1..2, gone from turn 3
//   C  seat 0, OPPO alone, 1 turn     the other team: turn 2 (seat 1) ends it, the partner turn 3 does not count
//   D  seat 2, SELF alone, 1 turn     the partner of seat 0 registers it in turn 1: it must live until its own turn 3
// Then the same rule through Duel.SkipPhase (it builds RESET_PHASE|RESET_SELF_TURN): SkipPhase(3, PHASE_DRAW, ...)
// registered in turn 1 toward seat 3, the second opponent of seat 0, must skip the Draw Phase of seat 3 (turn 4), and
// the Draw Phase of seat 1 (turn 2, the other duelist of the same team) must stay. Control: n = 2 reads the same way.
// The effects are registered by the host (Lua script) at the first idle prompt, so no card script is needed.
#include "scripted-duel.h"

static const uint32_t kFiller = 5000;

struct Probe { int turn; int tp; int present[4]; int hand; };

static std::vector<Probe> play(const std::string& setup, int n, const std::string& at_turn1, int turns) {
	sd::stray_logs = 0;
	sd::on_line = nullptr;
	OCG_Duel d = sd::create(setup);
	for(int p = 0; p < n; ++p)
		for(int i = 0; i < 30; ++i) sd::add(d, static_cast<uint8_t>(p), kFiller, LOCATION_DECK);
	OCG_StartDuel(d);
	std::vector<Probe> out;
	std::vector<sd::Msg> msgs;
	const sd::Msg* pm = nullptr;
	int last_turn = 0;
	bool done = false;
	for(int steps = 0; steps < 4000 && !done; ++steps) {
		const int status = sd::step(d, msgs, pm);
		if(status == OCG_DUEL_STATUS_END) break;
		if(status != OCG_DUEL_STATUS_AWAITING) continue;
		if(!pm) { std::printf("FAIL: awaiting without a prompt\n"); ++failures; break; }
		if(pm->id == MSG_SELECT_CHAIN) {  // a chain window (a phase event of the core): pass
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
		auto& f = sd::F(d);
		const int turn = static_cast<int>(f.infos.turn_id);
		if(turn != last_turn) {
			last_turn = turn;
			if(turn == 1 && !at_turn1.empty()) sd::lua(d, at_turn1);
			Probe pr{ turn, f.infos.turn_player, { 0, 0, 0, 0 }, static_cast<int>(f.player[f.infos.turn_player].list_hand.size()) };
			// the effect code that is probed on each seat: A 91001 (seat 0), B 91002 (seat 0), C 91003 (seat 0), D 91004 (seat 2)
			pr.present[0] = f.is_player_affected_by_effect(0, 91001) != nullptr;
			pr.present[1] = f.is_player_affected_by_effect(0, 91002) != nullptr;
			pr.present[2] = f.is_player_affected_by_effect(0, 91003) != nullptr;
			pr.present[3] = n > 2 && f.is_player_affected_by_effect(2, 91004) != nullptr;
			out.push_back(pr);
			if(turn >= turns) { done = true; break; }
		}
		sd::answer32(d, 7);  // end the turn
	}
	OCG_DestroyDuel(d);
	return out;
}

static const char* kRegister = R"LUA(
local function reg(code,tp,flags,count)
	local e=Effect.GlobalEffect()
	e:SetType(EFFECT_TYPE_FIELD)
	e:SetCode(code)
	e:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
	e:SetTargetRange(1,0)
	e:SetReset(flags,count)
	Duel.RegisterEffect(e,tp)
end
reg(91001,0,RESET_PHASE+PHASE_END+RESET_SELF_TURN,2)
reg(91002,0,RESET_PHASE+PHASE_END,2)
reg(91003,0,RESET_PHASE+PHASE_END+RESET_OPPO_TURN,1)
reg(91004,2,RESET_PHASE+PHASE_END+RESET_SELF_TURN,1)
)LUA";

int main() {
	// ---- Tag: the four reset forms
	{
		const auto pr = play("Debug.SetupDuelists(4,0,1,0,1)", 4, kRegister, 8);
		EXPECT(pr.size() == 8, "tag: %zu turns played, want 8", pr.size());
		const int last_present[4] = { 5, 2, 2, 3 };  // the last turn in which each effect is still there
		const char* name[4] = { "A seat 0 SELF alone x2", "B seat 0 default x2", "C seat 0 OPPO alone x1", "D seat 2 SELF alone x1" };
		for(const auto& p : pr)
			for(int k = 0; k < 4; ++k) {
				const int want = p.turn <= last_present[k];
				EXPECT(p.present[k] == want, "tag %s: turn %d (seat %d) present=%d, want %d", name[k], p.turn, p.tp, p.present[k], want);
			}
		std::printf("ok   tag reset forms: present rows");
		for(int k = 0; k < 4; ++k) {
			std::printf("  %c=", 'A' + k);
			for(const auto& p : pr) std::printf("%d", p.present[k]);
		}
		std::printf("\n");
		EXPECT(sd::stray_logs == 0, "tag reset forms: %d unexpected core log line(s)", sd::stray_logs);
	}
	// ---- Tag: SkipPhase toward the second opposing seat
	{
		const auto pr = play("Debug.SetupDuelists(4,0,1,0,1)", 4, "Duel.SkipPhase(3,PHASE_DRAW,RESET_PHASE+PHASE_DRAW,1)", 5);
		EXPECT(pr.size() == 5, "tag skip: %zu turns played, want 5", pr.size());
		if(pr.size() == 5) {
			// the hand of the turn player at the first idle prompt: 5 cards plus the draw of the turn
			EXPECT(pr[1].hand == 6, "tag skip: seat 1 (same team as seat 3) hand %d in turn 2, want 6 (its Draw Phase stays)", pr[1].hand);
			EXPECT(pr[2].hand == 6, "tag skip: seat 2 hand %d in turn 3, want 6", pr[2].hand);
			EXPECT(pr[3].hand == 5, "tag skip: seat 3 hand %d in turn 4, want 5 (its Draw Phase is skipped)", pr[3].hand);
			std::printf("ok   tag SkipPhase toward seat 3: hands in turns 2..4: %d %d %d\n", pr[1].hand, pr[2].hand, pr[3].hand);
		}
		EXPECT(sd::stray_logs == 0, "tag skip: %d unexpected core log line(s)", sd::stray_logs);
		// control: with no SkipPhase seat 3 draws in turn 4
		const auto nc = play("Debug.SetupDuelists(4,0,1,0,1)", 4, "", 4);
		if(nc.size() == 4) EXPECT(nc[3].hand == 6, "tag no skip: seat 3 hand %d in turn 4, want 6", nc[3].hand);
	}
	// ---- n = 2: SELF alone counts the own turns, the stock rule
	{
		const auto pr = play("", 2, kRegister, 6);
		EXPECT(pr.size() == 6, "n2: %zu turns played, want 6", pr.size());
		// seat 2 does not exist at n = 2: probe D is skipped. A: own turns 1 and 3, so turns 1..3. B: 1..2. C: turn 2 ends it, so 1..2.
		const int last_present[3] = { 3, 2, 2 };
		for(const auto& p : pr)
			for(int k = 0; k < 3; ++k)
				EXPECT(p.present[k] == (p.turn <= last_present[k]), "n2 effect %c: turn %d present=%d", 'A' + k, p.turn, p.present[k]);
		std::printf("ok   n2 reset forms\n");
	}
	std::printf("%s: %d failure(s)\n", failures ? "FAIL" : "PASS", failures);
	return failures ? 1 : 0;
}
