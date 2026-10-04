// Revalidate a queue-time causal seat against the player who actually activates.
#include "scripted-duel.h"
#include "effect.h"

int main() {
	for(const auto* setup : {"Debug.SetupDuelists(3,0,1,2)", "Debug.SetupDuelists(4,0,1,2,3)", "Debug.SetupDuelists(4,0,1,0,1)"}) {
		for(bool partner : {false, true}) {
			auto d = sd::create(setup);
			auto* duel = static_cast<::duel*>(d);
			auto& f = sd::F(d);
			if(partner && f.n_teams == f.n_duelists) { OCG_DestroyDuel(d); continue; }
			sd::add(d, 0, 5000, LOCATION_MZONE, POS_FACEUP_ATTACK);
			auto* c = f.player[0].list_mzone[0];
			auto* e = duel->new_effect();
			e->owner = e->handler = c;
			e->type = EFFECT_TYPE_SINGLE | EFFECT_TYPE_TRIGGER_O | EFFECT_TYPE_ACTIONS;
			chain queued{};
			queued.triggering_effect = e;
			queued.triggering_player = 0;
			queued.evt.event_code = EVENT_DAMAGE;
			queued.evt.event_player = 1;
			queued.evt.reason = REASON_EFFECT;
			queued.evt.reason_player = 0;
			queued.set_triggering_state(c);
			if(queued.bound_opp != 1 || queued.causal_opp != 1) return 1;
			// PointEvent refresh after a control change retains the event and saved seat.
			const uint8_t activating = partner ? 3 : 1;
			f.set_control(c, activating, 0, 0);
			queued.set_triggering_state(c);
			queued.triggering_player = activating;
			f.core.new_chains.push_back(queued);
			Processors::AddChain adding{0};
			f.process(adding);
			const auto& accepted = f.core.new_chains.front();
			if(accepted.bound_opp != 0 || accepted.causal_opp != DUELIST_NONE || accepted.causal_activation_failed) {
				std::printf("FAIL activating-team seat setup=%s activator=%u: bound=%u causal=%u\n", setup, activating, accepted.bound_opp, accepted.causal_opp);
				return 2;
			}
			// A separate, declared binding is not the saved causal binding.
			queued.bound_opp = 0;
			f.core.new_chains.clear();
			f.core.new_chains.push_back(queued);
			Processors::AddChain declared{0};
			f.process(declared);
			if(f.core.new_chains.front().bound_opp != 0 || f.core.new_chains.front().causal_opp != 1) return 3;
			OCG_DestroyDuel(d);
		}
	}
	// Tag: a teammate event does not supply "your opponent"; the reason can.
	for(uint8_t event : {uint8_t{1}, uint8_t{2}}) {
		for(uint8_t reason : {uint8_t{1}, uint8_t{2}}) {
			auto d = sd::create("Debug.SetupDuelists(4,0,1,0,1)");
			auto* duel = static_cast<::duel*>(d);
			auto& f = sd::F(d);
			sd::add(d, 0, 5000, LOCATION_MZONE, POS_FACEUP_ATTACK);
			auto* c = f.player[0].list_mzone[0];
			auto* e = duel->new_effect();
			e->owner = e->handler = c;
			e->type = EFFECT_TYPE_SINGLE | EFFECT_TYPE_TRIGGER_O | EFFECT_TYPE_ACTIONS;
			chain queued{};
			queued.triggering_effect = e;
			queued.triggering_player = 0;
			queued.evt.event_code = EVENT_DAMAGE;
			queued.evt.event_player = event;
			queued.evt.reason = REASON_EFFECT;
			queued.evt.reason_player = reason;
			queued.set_triggering_state(c);
			const uint8_t expected = event == 1 || reason == 1 ? 1 : DUELIST_NONE;
			if(queued.bound_opp != expected || queued.causal_opp != expected) return 4;
			f.player[2].eliminated = true;
			if(f.causal_opponent_gone(queued)) return 5;
			f.player[1].eliminated = true;
			if(f.causal_opponent_gone(queued) != (expected == 1)) return 6;
			OCG_DestroyDuel(d);
		}
	}
	if(sd::stray_logs) return 7;
	std::printf("PASS activating-player and Tag teammate bindings; Tag teammate/opponent departure controls\n");
	return 0;
}
