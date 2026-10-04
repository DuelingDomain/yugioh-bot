// A failed causal activation must still enable a Continuous Spell/Trap on the field.
#include "scripted-duel.h"
#include "effect.h"
#include "interpreter.h"

int main() {
	for(const auto* setup : {"Debug.SetupDuelists(3,0,1,2)", "Debug.SetupDuelists(4,0,1,2,3)", "Debug.SetupDuelists(4,0,1,0,1)"}) {
		for(uint32_t type : {TYPE_TRAP | TYPE_CONTINUOUS, TYPE_SPELL | TYPE_CONTINUOUS}) {
			sd::types[5001] = type;
			auto d = sd::create(setup);
			auto* duel = static_cast<::duel*>(d);
			auto& f = sd::F(d);
			sd::add(d, 0, 5000, LOCATION_MZONE, POS_FACEUP_ATTACK);
			sd::add(d, 0, 5001, LOCATION_SZONE, POS_FACEUP);
			auto* monster = f.player[0].list_mzone[0];
			auto* c = f.player[0].list_szone[0];
			auto* continuous = duel->new_effect();
			continuous->owner = c;
			continuous->type = EFFECT_TYPE_FIELD;
			continuous->code = EFFECT_UPDATE_ATTACK;
			continuous->range = LOCATION_SZONE;
			continuous->s_range = LOCATION_MZONE;
			continuous->value = 300;
			c->add_effect(continuous);
			c->enable_field_effect(false);
			if(monster->get_attack() != 1000) return 1;
			auto* e = duel->new_effect();
			e->owner = e->handler = c;
			e->type = EFFECT_TYPE_ACTIVATE | EFFECT_TYPE_ACTIONS;
			if(!sd::lua(d, "function queued_continuous(e,tp,eg,ep,ev,re,r,rp,chk) if chk==0 then return Duel.GetLocationCount(1-tp,LOCATION_MZONE)>0 end error('failed continuous callback ran') end")) return 2;
			for(auto* slot : {&e->cost, &e->target, &e->operation}) {
				lua_getglobal(duel->lua->lua_state, "queued_continuous");
				*slot = luaL_ref(duel->lua->lua_state, LUA_REGISTRYINDEX);
			}
			chain queued{};
			queued.triggering_effect = e;
			queued.triggering_player = 0;
			queued.chain_id = 37;
			queued.chain_count = 1;
			queued.evt.event_code = EVENT_DAMAGE;
			queued.evt.event_player = 1;
			queued.set_triggering_state(c);
			if(queued.bound_opp != 1 || queued.causal_opp != 1) return 3;
			// Isolate the processor path in Tag too. A real Tag surrender ends the duel.
			f.player[1].eliminated = true;
			f.core.new_chains.push_back(queued);
			Processors::AddChain adding{0};
			f.process(adding);
			queued = f.core.new_chains.front();
			if(!queued.causal_activation_failed) return 4;
			f.core.new_chains.clear();
			f.core.current_chain.push_back(queued);
			c->create_relation(queued);
			const auto pending = f.core.units.size();
			const auto pending_callbacks = f.core.subunits.size();
			adding.step = 6;
			f.process(adding);
			adding.step = 7;
			f.process(adding);
			Processors::SolveChain solving{2, false, false, false};
			solving.step = 2;
			f.process(solving);
			if(!c->get_status(STATUS_EFFECT_ENABLED) || monster->get_attack() != 1300) {
				std::printf("FAIL continuous activation type=%u setup=%s: enabled=%d attack=%d\n", type, setup, c->get_status(STATUS_EFFECT_ENABLED), monster->get_attack());
				return 5;
			}
			if(c->current.location != LOCATION_SZONE || !c->is_position(POS_FACEUP)
				|| f.core.units.size() != pending || f.core.subunits.size() != pending_callbacks
				|| solving.step != 3) return 6;
			OCG_DestroyDuel(d);
		}
	}
	if(sd::stray_logs) return 7;
	std::printf("PASS failed Continuous Trap and Spell activations retain enabled field effects: FFA3, FFA4, Tag processor control\n");
	return 0;
}
