// A causal opponent belongs to the queued link, including after immediate surrender.
#include "scripted-duel.h"
#include "effect.h"
#include "interpreter.h"

int main() {
	for(int n : {2, 3, 4}) {
		for(uint32_t code : {EVENT_ATTACK_ANNOUNCE, EVENT_BATTLE_DESTROYED, EVENT_DAMAGE, EVENT_DESTROYED}) {
			auto d = sd::create(n == 2 ? "" : n == 3 ? "Debug.SetupDuelists(3,0,1,2)" : "Debug.SetupDuelists(4,0,1,2,3)");
			auto* duel = static_cast<::duel*>(d);
			auto& f = sd::F(d);
			sd::add(d, 0, 5000, LOCATION_MZONE, POS_FACEUP_ATTACK);
			sd::add(d, 1, 5001, LOCATION_MZONE, POS_FACEUP_ATTACK);
			auto* c = f.player[0].list_mzone[0];
			auto* e = duel->new_effect();
			e->owner = e->handler = c;
			e->type = EFFECT_TYPE_SINGLE | EFFECT_TYPE_TRIGGER_O | EFFECT_TYPE_ACTIONS;
			f.core.attacker = c;
			f.core.attack_target = f.player[1].list_mzone[0];
			chain queued{};
			queued.triggering_effect = e;
			queued.triggering_player = 0;
			queued.evt.event_code = code;
			queued.evt.global_id = 37;
			queued.evt.event_player = 1;
			queued.evt.reason = REASON_EFFECT;
			queued.evt.reason_player = 1;
			queued.set_triggering_state(c);
			const uint8_t expected = n == 2 ? DUELIST_NONE : 1;
			if(queued.bound_opp != expected) {
				std::printf("FAIL queued opponent n=%d event=%u: expected %u, got %u\n", n, code, expected, queued.bound_opp);
				return 1;
			}
			if(n > 2) {
				// The battle pointers and event source can change before AddChain. The copy keeps its seat.
				f.player[1].eliminated = true;
				f.core.attack_target = nullptr;
				f.core.attacker = nullptr;
				queued.set_triggering_state(c);
				f.core.current_chain.push_back(queued);
				auto& link = f.core.current_chain.back();
				if(link.bound_opp != 1) return 2;
				duel->lua->push_scope(0, &link.bound_opp, false, false, e, true);
				if(!sd::lua(d, "assert(Duel.GetLocationCount(1,LOCATION_MZONE)==0) assert(Duel.GetFieldGroupCount(0,0,LOCATION_MZONE)==0)")) return 3;
				duel->lua->pop_scope();
				if(!f.causal_opponent_gone(link)) return 8;
				// Unstarted cost/target callbacks cannot build an empty option list.
				// The operation also completes with no effect, without executing Lua.
				if(!sd::lua(d, "function queued_callback(e,tp,eg,ep,ev,re,r,rp,chk) if chk==0 then return Duel.GetLocationCount(1-tp,LOCATION_MZONE)>0 end error('dead causal callback ran') end")) return 9;
				for(auto* slot : {&e->cost, &e->target, &e->operation}) {
					lua_getglobal(duel->lua->lua_state, "queued_callback");
					*slot = luaL_ref(duel->lua->lua_state, LUA_REGISTRYINDEX);
				}
				f.core.new_chains.push_back(queued);
				Processors::AddChain prepare{0};
				f.process(prepare);
				if(!f.core.new_chains.front().causal_activation_failed) return 12;
				link = f.core.new_chains.front();
				f.core.new_chains.clear();
				const auto pending = f.core.units.size();
				Processors::AddChain adding{6};
				adding.step = 6;
				f.process(adding);
				adding.step = 7;
				f.process(adding);
				Processors::SolveChain solving{2, false, false, false};
				solving.step = 2;
				f.process(solving);
				if(f.core.units.size() != pending || solving.step != 3) return 10;
				// An own-only check still passes after the causal seat leaves.
				luaL_unref(duel->lua->lua_state, LUA_REGISTRYINDEX, e->cost);
				luaL_unref(duel->lua->lua_state, LUA_REGISTRYINDEX, e->target);
				e->cost = 0;
				if(!sd::lua(d, "function queued_own_check(e,tp) return Duel.GetLocationCount(tp,LOCATION_MZONE)>0 end")) return 13;
				lua_getglobal(duel->lua->lua_state, "queued_own_check");
				e->target = luaL_ref(duel->lua->lua_state, LUA_REGISTRYINDEX);
				f.core.new_chains.push_back(queued);
				prepare.step = 0;
				f.process(prepare);
				if(f.core.new_chains.front().causal_activation_failed) return 14;
				f.core.new_chains.clear();
				for(int p = 0; p < n; ++p) if(f.player[p].lp != 8000) return 4;
				if(link.bound_opp != 1) return 5;
				// A later event with no causal opponent must not inherit this link's binding.
				chain fresh{};
				fresh.triggering_effect = e;
				fresh.triggering_player = 0;
				fresh.evt.event_code = EVENT_FREE_CHAIN;
				fresh.set_triggering_state(c);
				if(fresh.bound_opp != DUELIST_NONE) return 6;
			}
			OCG_DestroyDuel(d);
		}
	}
	for(int n : {3, 4}) {
		auto d = sd::create(n == 3 ? "Debug.SetupDuelists(3,0,1,2)" : "Debug.SetupDuelists(4,0,1,2,3)");
		auto* duel = static_cast<::duel*>(d);
		auto& f = sd::F(d);
		sd::add(d, 0, 5000, LOCATION_MZONE, POS_FACEUP_ATTACK);
		auto* c = f.player[0].list_mzone[0];
		c->set_status(STATUS_EFFECT_ENABLED, TRUE);
		f.infos.phase = PHASE_MAIN1;
		auto* e = duel->new_effect();
		e->owner = e->handler = c;
		e->type = EFFECT_TYPE_FIELD | EFFECT_TYPE_QUICK_F | EFFECT_TYPE_ACTIONS;
		e->range = LOCATION_MZONE;
		e->code = EVENT_DAMAGE;
		f.add_effect(e, 0);
		f.infos.event_id = 37;
		f.raise_event(nullptr, EVENT_DAMAGE, nullptr, REASON_EFFECT, 0, 1, 100);
		f.process_instant_event();
		if(f.core.quick_f_chain.size() != 1) return 15;
		const auto first = f.core.quick_f_chain.at(e);
		if(first.bound_opp != 1 || first.causal_opp != 1) return 16;
		// Real events can share global_id. Replacing the map entry must reset its binding.
		f.raise_event(nullptr, EVENT_DAMAGE, nullptr, REASON_EFFECT, 0, 2, 100);
		f.process_instant_event();
		const auto& second = f.core.quick_f_chain.at(e);
		if(second.chain_id == first.chain_id || second.evt.global_id != first.evt.global_id
			|| second.evt.event_player != 2 || second.bound_opp != 2 || second.causal_opp != 2) return 17;
		OCG_DestroyDuel(d);
	}
	if(sd::stray_logs) return 7;
	std::printf("PASS queued battle, battle destruction, damage and effect destruction opponents: FFA3, FFA4; stock 1v1 unchanged\n");
	return 0;
}
