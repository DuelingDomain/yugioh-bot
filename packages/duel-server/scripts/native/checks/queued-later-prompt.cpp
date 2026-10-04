// A saved causal opponent can depart after AddChain step 0, during a later prompt.
#include "scripted-duel.h"
#include "effect.h"
#include "interpreter.h"

static bool has_message(OCG_Duel d, uint8_t wanted) {
	uint32_t length = 0;
	const auto* data = static_cast<const uint8_t*>(OCG_DuelGetMessage(d, &length));
	bool found = false;
	for(uint32_t offset = 0; offset + 4 < length;) {
		uint32_t size = 0;
		std::memcpy(&size, data + offset, 4);
		if(data[offset + 4] == wanted) found = true;
		offset += 4 + size;
	}
	return found;
}

int main(int argc, char** argv) {
	const bool cost_prompt = argc > 1 && std::string(argv[1]) == "cost";
	for(const auto* setup : {"Debug.SetupDuelists(3,0,1,2)", "Debug.SetupDuelists(4,0,1,2,3)", "Debug.SetupDuelists(4,0,1,0,1)"}) {
		sd::types[5001] = TYPE_TRAP;
		auto d = sd::create(setup);
		auto* duel = static_cast<::duel*>(d);
		auto& f = sd::F(d);
		sd::add(d, 0, 5001, LOCATION_HAND);
		auto* c = f.player[0].list_hand[0];
		auto* e = duel->new_effect();
		e->owner = e->handler = c;
		e->type = EFFECT_TYPE_ACTIVATE | EFFECT_TYPE_ACTIONS;
		e->flag[0] = EFFECT_FLAG_COUNT_LIMIT;
		e->count_limit = e->count_limit_max = 1;
		if(!sd::lua(d, R"(
cost_checks=0 target_checks=0 cost_calls=0 target_calls=0
function later_cost(e,tp,eg,ep,ev,re,r,rp,chk)
 if chk==0 then cost_checks=cost_checks+1 return Duel.GetLocationCount(1-tp,LOCATION_MZONE)>0 end
 cost_calls=cost_calls+1
 Duel.PayLPCost(tp,100)
 Duel.SelectOption(tp,1,2)
end
function later_target(e,tp,eg,ep,ev,re,r,rp,chk)
 if chk==0 then target_checks=target_checks+1 return Duel.GetLocationCount(1-tp,LOCATION_MZONE)>0 end
 target_calls=target_calls+1 error('departed causal target ran')
end
function later_operation() error('departed causal operation ran') end
)") ) return 1;
		for(const auto& entry : {std::make_pair(&e->cost, "later_cost"), std::make_pair(&e->target, "later_target"), std::make_pair(&e->operation, "later_operation")}) {
			lua_getglobal(duel->lua->lua_state, entry.second);
			*entry.first = luaL_ref(duel->lua->lua_state, LUA_REGISTRYINDEX);
		}
		chain queued{};
		queued.triggering_effect = e;
		queued.triggering_player = 0;
		queued.chain_id = 37;
		queued.chain_count = 1;
		queued.evt.event_code = EVENT_DAMAGE;
		queued.evt.event_player = 1;
		queued.set_triggering_state(c);
		if(queued.bound_opp != 1) return 2;
		e->dec_count(0); // The accepted activation uses its once-per-turn count, including a failed link.
		f.core.new_chains.push_back(queued);
		Processors::AddChain adding{0};
		f.process(adding);
		if(f.core.new_chains.front().causal_activation_failed) return 3;
		if(!cost_prompt) {
			for(uint64_t description : {1, 2}) {
				auto* permission = duel->new_effect();
				permission->owner = c;
				permission->type = EFFECT_TYPE_SINGLE;
				permission->code = EFFECT_TRAP_ACT_IN_HAND;
				permission->description = description;
				permission->flag[0] = EFFECT_FLAG_COUNT_LIMIT;
				permission->count_limit = permission->count_limit_max = 1;
				c->add_effect(permission);
			}
			adding.step = 10;
			f.process(adding);
			if(f.core.select_options.size() != 2 || f.core.subunits.size() != 1) return 4;
			if(f.process() != OCG_DUEL_STATUS_AWAITING || !has_message(d, MSG_SELECT_OPTION)) return 5;
			// The permission prompt is open before the chain starts. Tag uses a processor control;
			// the host ends a real Tag duel when a teammate or opponent surrenders.
			f.player[1].eliminated = true;
			f.returns.set<int32_t>(0, 0);
			if(f.process() != OCG_DUEL_STATUS_CONTINUE || !f.core.units.empty()) return 6;
			adding.step = 11;
			f.process(adding);
			adding.step = 2;
			f.process(adding);
			const auto pending = f.core.subunits.size();
			adding.step = 6;
			f.process(adding);
			adding.step = 7;
			f.process(adding);
			if(!f.core.current_chain.back().causal_activation_failed || f.core.subunits.size() != pending) {
				std::printf("FAIL later permission prompt setup=%s: failed=%d callbacks=%zu\n", setup, f.core.current_chain.back().causal_activation_failed, f.core.subunits.size()-pending);
				return 7;
			}
			if(f.player[0].lp != 8000 || !sd::lua(d, "assert(cost_calls==0 and target_calls==0)")) return 8;
		} else {
			adding.step = 2;
			f.process(adding);
			adding.step = 6;
			f.process(adding);
			for(int guard=0; guard<10; ++guard) {
				if(f.process() == OCG_DUEL_STATUS_AWAITING) break;
			}
			if(!has_message(d, MSG_SELECT_OPTION) || f.player[0].lp != 7900) return 9;
			// Isolate an actual departure during cost. Surrender with a live chain is deferred.
			f.player[1].eliminated = true;
			f.returns.set<int32_t>(0, 0);
			for(int guard=0; guard<10 && !f.core.units.empty(); ++guard) f.process();
			if(!f.core.units.empty() || !f.core.subunits.empty()) return 10;
			if(!sd::lua(d, "cost_checks_before_target=cost_checks")) return 11;
			adding.step = 7;
			f.process(adding);
			if(!f.core.current_chain.back().causal_activation_failed || !f.core.subunits.empty()) {
				std::printf("FAIL later cost prompt setup=%s: failed=%d targets=%zu\n", setup, f.core.current_chain.back().causal_activation_failed, f.core.subunits.size());
				return 12;
			}
			if(f.player[0].lp != 7900 || !sd::lua(d, "assert(cost_calls==1 and target_calls==0 and cost_checks==cost_checks_before_target)")) return 13;
		}
		const auto& link = f.core.current_chain.back();
		if(link.bound_opp != 1 || link.causal_opp != 1 || e->check_count_limit(0)) return 14;
		const auto pending = f.core.subunits.size();
		Processors::SolveChain solving{2, false, false, false};
		solving.step = 2;
		f.process(solving);
		if(solving.step != 3 || f.core.subunits.size() != pending) return 15;
		if(has_message(d, MSG_CHAIN_DISABLED)) return 16;
		OCG_DestroyDuel(d);
	}
	if(sd::stray_logs) return 17;
	std::printf("PASS departed causal seat during %s prompt: FFA3, FFA4, Tag processor control; count retained, no callback widening\n", cost_prompt ? "cost" : "step 10 permission");
	return 0;
}
