// R-COMMON-SURRENDER-EOT, owner answer 2026-10-04: an empty phase window
// stays open. Finish it before the next turn; open no later empty window
// in the cut-short turn. Reuse the unchanged response-cursor fixture.
#define main response_cursor_original_main
#include "response-cursor.cpp"
#undef main

static void surrender_phase(int leaver) {
	OCG_Duel d = make_ffa4({{103}, {103}, {103}, {103}}, 0);
	std::vector<Msg> msgs;
	std::vector<int> first_window;
	bool surrendered = false, reached_idle = false;
	int later_empty_prompts = 0, closed_windows = 0, losses = 0, retries = 0;
	for(int steps = 0; steps < 4000; ++steps) {
		const int status = advance(d, msgs);
		for(const auto& m : msgs) {
			if(m.id == 203) ++closed_windows;
			if(m.id == 200 && m.b1 == leaver) ++losses;
			if(m.id == MSG_RETRY) ++retries;
		}
		if(status == OCG_DUEL_STATUS_END) break;
		if(status != OCG_DUEL_STATUS_AWAITING) continue;
		EXPECT(!msgs.empty(), "awaiting without messages");
		if(msgs.empty()) break;
		const Msg last = msgs.back();
		auto& f = F(d);
		if(last.id == MSG_SELECT_IDLECMD) {
			reached_idle = true;
			EXPECT(f.infos.turn_player == (leaver == 0 ? 1 : 0), "next idle turn player %d", f.infos.turn_player);
			EXPECT(f.infos.turn_id == (leaver == 0 ? 2 : 1), "next idle turn id %d", f.infos.turn_id);
			EXPECT(f.infos.phase == PHASE_MAIN1, "next idle phase %u", f.infos.phase);
			break;
		}
		if(last.id == MSG_SELECT_CHAIN) {
			if(f.infos.turn_id == 1 && f.infos.phase == PHASE_DRAW)
				first_window.push_back(last.b1);
			else if(leaver == 0 && f.infos.turn_id == 1)
				++later_empty_prompts;
			if(!surrendered && last.b1 == leaver + 1) {
				EXPECT(f.infos.turn_player == 0 && f.core.current_chain.empty(), "surrender fixture has no chain in turn 0");
				EXPECT(f.response_window_participants() == 0, "empty phase window has participants %u", f.response_window_participants());
				EXPECT(run_lua(d, "Debug.SurrenderDuelist(" + std::to_string(leaver) + ")"), "Debug.SurrenderDuelist failed");
				surrendered = true;
				EXPECT(!f.is_alive(leaver), "seat %d did not leave immediately", leaver);
			}
			answer_i32(d, -1);
			continue;
		}
		EXPECT(answer_default(d, last), "unexpected prompt %u", last.id);
	}
	EXPECT(surrendered && reached_idle, "surrendered=%d reached_idle=%d", surrendered, reached_idle);
	const std::vector<int> want{0, 1, 2, 3};
	EXPECT(first_window == want, "Debug surrender seat %d: first window %s, want 0 1 2 3", leaver, seats(first_window).c_str());
	EXPECT(later_empty_prompts == 0, "cut-short turn opened %d later empty prompts", later_empty_prompts);
	EXPECT(closed_windows == 0, "empty phase window emitted %d closure messages", closed_windows);
	EXPECT(losses == 1, "seat %d emitted %d loss messages, want 1", leaver, losses);
	EXPECT(retries == 0, "%d retries", retries);
	std::printf("Debug.SurrenderDuelist(%d): prompts %s; later empty prompts %d; closures %d; losses %d\n",
	            leaver, seats(first_window).c_str(), later_empty_prompts, closed_windows, losses);
	OCG_DestroyDuel(d);
}

// A living player can use the kept window. Its chain finishes, but the
// departed turn must not start a new empty response round after the chain.
static void surrender_then_activate(bool during_chain) {
	OCG_Duel d = make_ffa4({{103}, {103}, {103}, {103}}, 0);
	std::vector<Msg> msgs;
	bool activated = false, surrendered = false, reached_idle = false, chain_ended = false;
	int solved = 0, empty_after_chain = 0;
	for(int steps = 0; steps < 4000; ++steps) {
		const int status = advance(d, msgs);
		for(const auto& m : msgs) {
			if(m.id == MSG_CHAIN_SOLVED) ++solved;
			if(m.id == MSG_CHAIN_END && activated) chain_ended = true;
		}
		if(status == OCG_DUEL_STATUS_END) break;
		if(status != OCG_DUEL_STATUS_AWAITING) continue;
		if(msgs.empty()) { EXPECT(false, "awaiting without messages"); break; }
		const Msg last = msgs.back();
		auto& f = F(d);
		if(last.id == MSG_SELECT_IDLECMD) {
			reached_idle = true;
			EXPECT(f.infos.turn_player == 1 && f.infos.turn_id == 2, "living chain did not reach next turn");
			break;
		}
		if(last.id == MSG_SELECT_CHAIN) {
			if(!activated && last.b1 == 1) {
				if(!during_chain) {
					EXPECT(run_lua(d, "Debug.SurrenderDuelist(0)"), "turn player surrender failed");
					EXPECT(!f.is_alive(0), "turn player did not leave before living activation");
					surrendered = true;
				}
				activated = true;
				answer_i32(d, 0);
			} else {
				if(during_chain && !surrendered && !f.core.current_chain.empty()) {
					EXPECT(run_lua(d, "Debug.SurrenderDuelist(0)"), "chain surrender failed");
					EXPECT(f.is_alive(0) && f.player[0].pending_loss, "chain surrender did not defer the loss");
					surrendered = true;
				}
				if(chain_ended && f.infos.turn_id == 1 && f.core.current_chain.empty()
				   && f.response_window_participants() == 0) ++empty_after_chain;
				answer_i32(d, -1);
			}
			continue;
		}
		EXPECT(answer_default(d, last), "unexpected living-chain prompt %u", last.id);
	}
	EXPECT(activated && surrendered && reached_idle, "activated=%d surrendered=%d reached_idle=%d", activated, surrendered, reached_idle);
	EXPECT(!F(d).is_alive(0), "turn player remains after living chain");
	EXPECT(solved == 1, "living link solved %d times, want 1", solved);
	EXPECT(empty_after_chain == 0, "%d new empty prompts after the living chain", empty_after_chain);
	std::printf("Living activation (surrender during chain %d): solved %d; new empty prompts %d\n", during_chain, solved, empty_after_chain);
	OCG_DestroyDuel(d);
}

// Cancelling the leaver's pre-chain zone choice must not open a new empty window.
static void surrender_cancel_activation() {
	OCG_Duel d = make_ffa4({{100}, {103}, {103}, {103}}, 0);
	std::vector<Msg> msgs;
	bool activated = false, surrendered = false, reached_idle = false;
	int solved = 0, new_empty = 0;
	for(int steps = 0; steps < 4000; ++steps) {
		const int status = advance(d, msgs);
		for(const auto& m : msgs) if(m.id == MSG_CHAIN_SOLVED) ++solved;
		if(status == OCG_DUEL_STATUS_END) break;
		if(status != OCG_DUEL_STATUS_AWAITING) continue;
		if(msgs.empty()) { EXPECT(false, "awaiting without messages"); break; }
		const Msg last = msgs.back();
		auto& f = F(d);
		if(last.id == MSG_SELECT_IDLECMD) {
			if(!activated) {
				EXPECT(last.b1 == 0, "initial idle seat %d", last.b1);
				activated = true;
				answer_u32(d, 5);
				continue;
			}
			reached_idle = true;
			EXPECT(f.infos.turn_player == 1 && f.infos.turn_id == 2, "cancelled activation did not reach next turn");
			break;
		}
		if(activated && !surrendered && last.id == MSG_SELECT_PLACE) {
			EXPECT(f.core.current_chain.empty(), "place choice already has a chain");
			EXPECT(run_lua(d, "Debug.SurrenderDuelist(0)"), "pre-chain surrender failed");
			EXPECT(!f.is_alive(0), "pre-chain surrender was not immediate");
			surrendered = true;
		}
		if(surrendered && f.infos.turn_id == 1 && last.id == MSG_SELECT_CHAIN
		   && f.core.current_chain.empty() && f.response_window_participants() == 0) ++new_empty;
		EXPECT(answer_default(d, last), "unexpected cancelled-activation prompt %u", last.id);
	}
	EXPECT(activated && surrendered && reached_idle, "activated=%d surrendered=%d reached_idle=%d", activated, surrendered, reached_idle);
	EXPECT(solved == 0, "cancelled link solved %d times", solved);
	EXPECT(new_empty == 0, "%d new empty prompts after cancelled activation", new_empty);
	std::printf("Cancelled activation: solved %d; new empty prompts %d\n", solved, new_empty);
	OCG_DestroyDuel(d);
}

int main() {
	init_scripts();
	// FX3: a seat which passed, and is not the turn player, is removed at seat 2's prompt.
	mode_phase(1, 2, "non-turn-passed");
	surrender_phase(0);
	surrender_phase(1);
	surrender_then_activate(false);
	surrender_then_activate(true);
	surrender_cancel_activation();
	std::printf("%s: %d failure(s)\n", failures ? "FAIL" : "PASS", failures);
	return failures ? 1 : 0;
}
