// Owner decision 2026-10-06: a cost that removes the final FFA link returns
// to one open-state round. A surviving lower link owns the restarted round.
#define main response_cursor_original_main
#include "response-cursor.cpp"
#undef main

static void cost_elimination(int n, int tp, bool lower_link, bool tag = false) {
	init_scripts();
	// 103 is a free hand quick effect. 101 has the same timing but pays 1000 LP.
	g_scripts[101] = g_scripts[103];
	auto& script = g_scripts[101];
	script.replace(script.find("c103"), 4, "c101");
	script.insert(script.find(" e1:SetOperation"),
		" e1:SetCost(function(e,tp,eg,ep,ev,re,r,rp,chk) if chk==0 then return Duel.CheckLPCost(tp,1000) end Duel.PayLPCost(tp,1000) end)\n");
	OCG_Duel d = make_duel(0);
	EXPECT(run_lua(d, tag ? "Debug.SetupDuelists(4,0,1,0,1)" :
		(n == 4 ? "Debug.SetupDuelists(4,0,1,2,3)" : "Debug.SetupDuelists(3,0,1,2)")), "setup");
	EXPECT(run_lua(d, prelude()), "prelude");
	const int leaver = n - 1;
	const int lower = n == 4 ? 1 : 0;
	for(int seat = 0; seat < n; ++seat) {
		add_cards(d, seat, LOCATION_DECK, 40, 1);
		add_cards(d, seat, LOCATION_HAND, 1, seat == leaver ? 101 : 103);
	}
	F(d).lp_ref(leaver) = 1000;
	OCG_StartDuel(d);
	bool lower_added = false, paid = false, eliminated = false, ended = false, solved = false, reached_boundary = false;
	int ends = 0, wins = 0;
	std::vector<int> before_end, after_end;
	std::vector<Msg> msgs;
	for(int step = 0; step < 1000 && !reached_boundary; ++step) {
		const int status = advance(d, msgs);
		for(const auto& msg : msgs) {
			if(msg.id == MSG_WIN) ++wins;
			if(msg.id == 200 && msg.b1 == leaver) eliminated = true;
			if(eliminated && msg.id == MSG_CHAIN_SOLVING) solved = true;
			if(eliminated && msg.id == MSG_CHAIN_END) { ended = true; ++ends; }
			if(ended && (msg.id == MSG_NEW_PHASE || msg.id == MSG_SELECT_IDLECMD)) reached_boundary = true;
			if(eliminated && !solved && !ended && msg.id == MSG_SELECT_CHAIN) before_end.push_back(msg.b1);
			// The later phase-change request is a distinct timing window.
			if(ended && msg.id == MSG_SELECT_CHAIN && (F(d).core.hint_timing[msg.b1] & TIMING_CHAIN_END))
				after_end.push_back(msg.b1);
		}
		if(status == OCG_DUEL_STATUS_END || reached_boundary) break;
		if(status != OCG_DUEL_STATUS_AWAITING) continue;
		EXPECT(!msgs.empty(), "awaiting without prompt");
		if(msgs.empty()) break;
		const auto last = msgs.back();
		if(last.id == MSG_SELECT_CHAIN && F(d).infos.turn_player == tp) {
			if(lower_link && !lower_added && last.b1 == lower) {
				lower_added = true; answer_i32(d, 0); continue;
			}
			if(!paid && (!lower_link || lower_added) && last.b1 == leaver) {
				paid = true; answer_i32(d, 0); continue;
			}
		}
		EXPECT(answer_default(d, last), "unexpected prompt %u", last.id);
	}
	EXPECT(paid && (tag ? wins == 1 : eliminated), "n%d tp%d lower%d tag%d did not exercise cost elimination", n, tp, lower_link, tag);
	if(tag) {
		EXPECT(!ended && wins == 1 && F(d).lp_ref(leaver) == 0, "Tag loss must finish the duel without an FFA open round");
	} else {
		EXPECT(ended && reached_boundary && ends == 1, "chain end/boundary missing or repeated");
		EXPECT(solved == lower_link, "removed link resolved or living lower link failed to resolve");
		std::vector<int> want;
		for(int i = 0; i < n; ++i) {
			const int seat = (tp + i) % n;
			if(seat != leaver) want.push_back(seat);
		}
		EXPECT(after_end == want, "n%d tp%d lower%d open round %s, want %s", n, tp, lower_link, seats(after_end).c_str(), seats(want).c_str());
		want.clear();
		if(lower_link) for(int i = 1; i <= n; ++i) {
			const int seat = (lower + i) % n;
			if(seat != leaver) want.push_back(seat);
		}
		EXPECT(before_end == want, "n%d tp%d lower%d pre-end round %s, want %s", n, tp, lower_link, seats(before_end).c_str(), seats(want).c_str());
	}
	std::printf("cost elimination n%d tp%d lower%d tag%d: before [%s], after [%s]\n", n, tp, lower_link, tag, seats(before_end).c_str(), seats(after_end).c_str());
	OCG_DestroyDuel(d);
}

int main() {
	for(int n : {3, 4}) {
		cost_elimination(n, n - 2, false);
		cost_elimination(n, n - 2, true);
		cost_elimination(n, n - 1, false);
		cost_elimination(n, n - 1, true);
	}
	cost_elimination(4, 2, false, true);
	std::printf("RESULT cost-elimination-response %s\n", failures ? "FAIL" : "PASS");
	return failures ? 1 : 0;
}
