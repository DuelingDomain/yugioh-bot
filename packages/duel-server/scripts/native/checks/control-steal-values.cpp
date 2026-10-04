// Live API checks for Lua literals, callbacks, zone masks and absolute core values.
#include "common.h"
#include "scripted-duel.h"
#include "card.h"
#include "effect.h"
#include "interpreter.h"

static void run_case(int n, bool tag, int thief, int victim, const std::string& mode) {
	const uint32_t source_code = 910000 + thief, target_code = 920000 + victim;
	std::string setup = n == 2 ? "" : "Debug.SetupDuelists(" + std::to_string(n);
	if(n > 2) {
		for(int q = 0; q < n; ++q) setup += "," + std::to_string(tag ? q % 2 : q);
		setup += ")";
	}
	std::string op;
	if(mode == "get-zone")
		op = "Duel.GetControl(t,tp,PHASE_END,1,0x10)";
	else if(mode == "get-chooser")
		op = "Duel.GetControl(t,tp,PHASE_END,1,0x10,Duel.MPActionSeat(" + std::to_string(victim) + "))";
	else if(mode == "move")
		// MoveToField relocates a card; an independent control effect must authorize
		// its continued control in the new MZONE, as in stock 1v1.
		op = "local x=Effect.CreateEffect(c) x:SetType(EFFECT_TYPE_SINGLE) x:SetCode(EFFECT_SET_CONTROL) "
			"x:SetValue(tp) t:RegisterEffect(x) Duel.MoveToField(t,tp,tp,LOCATION_MZONE,POS_FACEUP_ATTACK,true,0x10)";
	else if(mode == "swap")
		op = "Duel.SwapControl(c,t,PHASE_END,1)";
	else {
		op = "local x=Effect.CreateEffect(c) x:SetType(EFFECT_TYPE_SINGLE) ";
		if(mode != "late-code") op += "x:SetCode(EFFECT_SET_CONTROL) ";
		op += "x:SetValue(tp) ";
		if(mode == "late-code") op += "x:SetCode(EFFECT_SET_CONTROL) ";
		if(mode == "clone") op += "x=x:Clone() ";
		op += "x:SetReset(RESET_PHASE|PHASE_END) t:RegisterEffect(x)";
	}
	sd::types[source_code] = TYPE_MONSTER | TYPE_EFFECT;
	sd::scripts[source_code] = "function c" + std::to_string(source_code) + ".initial_effect(c) "
		"local e=Effect.CreateEffect(c) e:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS) "
		"e:SetCode(EVENT_PHASE_START|PHASE_MAIN1) e:SetRange(LOCATION_MZONE) e:SetCountLimit(1) "
		"local done=false e:SetOperation(function(e,tp) if done or Duel.GetTurnCount()~=" + std::to_string(thief + 1) + " then return end done=true "
		"local t=Duel.GetMatchingGroup(function(z) return z:IsCode(" + std::to_string(target_code) + ") end,tp,0,LOCATION_MZONE,nil):GetFirst() "
		+ op + " end) c:RegisterEffect(e) end";
	OCG_Duel d = sd::create(setup);
	for(int q = 0; q < n; ++q) {
		for(int k = 0; k < 30; ++k) sd::add(d, q, 1, LOCATION_DECK);
		sd::lua(d, "Debug.AddCard(" + std::to_string(q == thief ? source_code : q == victim ? target_code : 930000 + q)
			+ "," + std::to_string(q) + "," + std::to_string(q) + ",LOCATION_MZONE,0,POS_FACEUP_ATTACK)");
	}
	card* source = sd::F(d).get_field_card(thief, LOCATION_MZONE, 0);
	card* target = sd::F(d).get_field_card(victim, LOCATION_MZONE, 0);
	OCG_StartDuel(d);
	bool saw_taken = false, saw_returned = false;
	for(int guard = 0; guard < 3000; ++guard) {
		std::vector<sd::Msg> messages;
		const sd::Msg* prompt = nullptr;
		const auto status = sd::step(d, messages, prompt);
		if(status == OCG_DUEL_STATUS_END) break;
		if(status != OCG_DUEL_STATUS_AWAITING || !prompt) continue;
		if(prompt->id == MSG_SELECT_IDLECMD) {
			const auto turn = sd::F(d).infos.turn_id;
			if(turn == static_cast<uint32_t>(thief + 1) || turn == static_cast<uint32_t>(thief + 2)) {
				const bool returned = turn == static_cast<uint32_t>(thief + 2) && mode != "move";
				const auto expected = returned ? victim : thief;
				EXPECT(target->current.controler == expected, "n=%d tag=%d %s %d from %d: controller %u, want %d", n, tag, mode.c_str(), thief, victim, target->current.controler, expected);
				if(mode == "get-zone" || mode == "get-chooser" || mode == "move")
					EXPECT(returned || target->current.sequence == 4, "%s: destination is not m4", mode.c_str());
				for(int q = 0; q < n; ++q) {
					const int want = mode == "swap" || returned ? 1 : q == thief ? 2 : q == victim ? 0 : 1;
					EXPECT(sd::mzone_count(d, q) == want, "n=%d %s: seat %d has %d monsters, want %d", n, mode.c_str(), q, sd::mzone_count(d, q), want);
				}
				EXPECT(source->current.controler == (mode == "swap" && !returned ? victim : thief), "%s: source moved to wrong seat", mode.c_str());
				if(turn == static_cast<uint32_t>(thief + 1)) saw_taken = true;
				else { saw_returned = true; break; }
			}
			sd::answer32(d, 7);
		} else if(prompt->id == MSG_SELECT_CHAIN) sd::answer32(d, -1);
		else if(prompt->id == MSG_SELECT_PLACE) {
			uint32_t flag; std::memcpy(&flag, prompt->p + 2, 4);
			const bool other = (flag & 0x1f) == 0x1f;
			const uint8_t seat = other ? thief : prompt->p[0];
			const uint32_t mask = other ? flag >> 16 : flag;
			uint8_t seq = 0; while(seq < 5 && (mask & (1u << seq))) ++seq;
			const uint8_t answer[] = { seat, LOCATION_MZONE, seq };
			OCG_DuelSetResponse(d, answer, sizeof(answer));
		} else {
			EXPECT(false, "%s: unexpected prompt %u", mode.c_str(), prompt->id);
			break;
		}
	}
	EXPECT(saw_taken && saw_returned, "n=%d tag=%d %s %d from %d: missing control or return checkpoint", n, tag, mode.c_str(), thief, victim);
	OCG_DestroyDuel(d);
}

// Core control and reset effects contain real seats, even inside a Lua scope.
static void absolute_in_scope(int n, bool tag, int thief, int victim) {
	std::string setup = n == 2 ? "" : "Debug.SetupDuelists(" + std::to_string(n);
	if(n > 2) {
		for(int q = 0; q < n; ++q) setup += "," + std::to_string(tag ? q % 2 : q);
		setup += ")";
	}
	OCG_Duel d = sd::create(setup);
	sd::lua(d, "Debug.AddCard(1," + std::to_string(victim) + "," + std::to_string(victim) + ",LOCATION_MZONE,0,POS_FACEUP_ATTACK)");
	auto* engine = static_cast<duel*>(d);
	auto* target = sd::F(d).get_field_card(victim, LOCATION_MZONE, 0);
	auto* e = engine->new_effect();
	e->owner = target;
	e->type = EFFECT_TYPE_SINGLE;
	e->code = EFFECT_SET_CONTROL;
	e->value = thief;
	e->flag[0] = EFFECT_FLAG_CANNOT_DISABLE;
	target->add_effect(e);
	{
		interpreter::scope_guard scope(engine->lua);
		scope.push(victim);
		EXPECT(target->refresh_control_status().first == thief,
			"core value in scope: n=%d tag=%d real controller %d, Lua scope %d", n, tag, thief, victim);
	}
	OCG_DestroyDuel(d);
}

// A rejected scope must use the stock value, even when another scope is active.
static void failed_scope_push(int n, bool tag) {
  std::string setup = "Debug.SetupDuelists(" + std::to_string(n);
  for(int q = 0; q < n; ++q) setup += "," + std::to_string(tag ? q % 2 : q);
  setup += ")";
  OCG_Duel d = sd::create(setup);
  sd::add(d, 0, 1, LOCATION_MZONE);
  auto* engine = static_cast<duel*>(d);
  auto* target = sd::F(d).get_field_card(0, LOCATION_MZONE, 0);
  auto* e = engine->new_effect();
  e->owner = target;
  e->handler = target;
  e->type = EFFECT_TYPE_SINGLE;
  e->code = EFFECT_SET_CONTROL;
  e->value = 1;
  e->value_player = MAX_DUELISTS; // not a real seat, not the core-created sentinel
  {
  interpreter::scope_guard outer(engine->lua);
  EXPECT(outer.push(2), "failed-scope fixture: outer scope did not open");
  EXPECT(e->get_control_value(target) == 1, "failed scope: n=%d tag=%d inherited the outer fold", n, tag);
  EXPECT(engine->lua->current_scope()->P == 2, "failed scope changed the outer seat");
  }
  OCG_DestroyDuel(d);
}

int main() {
  failed_scope_push(3, false);
  failed_scope_push(4, false);
  failed_scope_push(4, true);
	for(int n : { 2, 3, 4 }) for(bool tag : { false, true }) {
		if(tag && n != 4) continue;
		for(int thief = 0; thief < n; ++thief) for(int victim = 0; victim < n; ++victim) {
			if(thief == victim || (tag && thief % 2 == victim % 2)) continue;
			absolute_in_scope(n, tag, thief, victim);
			for(const std::string mode : { "literal", "late-code", "clone", "get-zone", "move", "swap" })
				run_case(n, tag, thief, victim, mode);
			if(n > 2) run_case(n, tag, thief, victim, "get-chooser");
		}
	}
	std::printf("%s: 194 live API cases, 28 core-value scope cases and 3 rejected-scope cases, %d failure(s)\n", failures ? "FAIL" : "PASS", failures);
	return failures ? 1 : 0;
}
