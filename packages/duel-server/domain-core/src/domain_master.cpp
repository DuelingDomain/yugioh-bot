#include "domain_master.h"
#include <algorithm>
#include "card.h"
#include "duel.h"
#include "effect.h"
#include "field.h"

bool domain_is_extra_type(const card* pcard) {
	if(!pcard)
		return false;
	return pcard->is_extra_deck_monster() || (pcard->data.type & (TYPE_FUSION | TYPE_SYNCHRO | TYPE_XYZ | TYPE_LINK)) != 0;
}

bool domain_is_main_pendulum(const card* pcard) {
	return pcard && (pcard->data.type & TYPE_PENDULUM) && !domain_is_extra_type(pcard);
}

uint32_t domain_leave_tax(uint32_t returns) {
	return returns * DOMAIN_LEAVE_TAX_STEP;
}

uint8_t field::domain_owner_of(card* pcard) const {
	if(!pcard)
		return PLAYER_NONE;
	if(pcard->owner <= 1 && player[pcard->owner].deck_master_card == pcard)
		return pcard->owner;
	for(uint8_t p = 0; p < 2; ++p) {
		if(player[p].deck_master_card == pcard)
			return p;
	}
	return PLAYER_NONE;
}

bool field::domain_is_deck_master(card* pcard) const {
	return domain_owner_of(pcard) != PLAYER_NONE;
}

uint32_t field::domain_location_kind(card* pcard) const {
	if(!pcard)
		return 0;
	if(pcard->overlay_target)
		return LOCATION_OVERLAY;
	uint32_t loc = pcard->current.location;
	if(loc & (LOCATION_MZONE | LOCATION_SZONE))
		return LOCATION_ONFIELD;
	return loc;
}

uint32_t field::domain_leave_tax_for(uint8_t playerid) const {
	if(playerid > 1)
		return 0;
	return domain_leave_tax(player[playerid].deck_master_returns);
}

bool field::domain_can_pay_leave_tax(uint8_t playerid) {
	if(playerid > 1)
		return false;
	uint32_t tax = domain_leave_tax_for(playerid);
	if(tax == 0)
		return true;
	const bool nested = cost[playerid].count > 0;
	if(!nested)
		save_lp_cost();
	const bool payable = check_lp_cost(playerid, tax) != FALSE;
	if(!nested)
		restore_lp_cost();
	return payable;
}

void field::domain_pay_leave_tax(uint8_t playerid) {
	domain_pay_leave_tax(playerid, nullptr, true);
}

void field::domain_pay_leave_tax(uint8_t playerid, effect* reason, bool lock_reason) {
	if(playerid > 1)
		return;
	uint32_t tax = domain_leave_tax_for(playerid);
	if(tax == 0)
		return;
	if(lock_reason)
		emplace_process<Processors::PayLPCost>(playerid, tax, reason, true);
	else
		emplace_process<Processors::PayLPCost>(playerid, tax);
}

bool field::domain_card_leaving_dmz(card* pcard) const {
	return pcard && domain_is_deck_master(pcard) && pcard->current.location == LOCATION_DECKMASTER;
}

bool field::domain_is_open_game_state() const {
	if(core.current_chain.size())
		return false;
	if(infos.phase & (PHASE_DAMAGE | PHASE_DAMAGE_CAL))
		return false;
	return true;
}

void field::domain_note_kind(card* pcard) {
	if(!pcard)
		return;
	const uint8_t owner = domain_owner_of(pcard);
	if(owner == PLAYER_NONE)
		return;
	auto& info = player[owner];
	const uint32_t kind = domain_location_kind(pcard);
	if(kind == 0)
		return;
	if(info.deck_master_last_kind == 0) {
		info.deck_master_last_kind = kind;
		return;
	}
	if(kind != info.deck_master_last_kind)
		info.deck_master_kind_changed = true;
}

void field::domain_after_add_card(card* pcard) {
	if(!pcard)
		return;
	domain_note_kind(pcard);
	if(pcard->current.location != LOCATION_DECKMASTER)
		return;
	uint8_t owner = pcard->owner;
	if(owner > 1)
		owner = pcard->current.controler;
	if(owner > 1)
		return;
	auto& info = player[owner];
	if(!info.deck_master_card)
		info.deck_master_card = pcard;
	if(info.deck_master_card != pcard)
		return;
	info.deck_master_code = pcard->data.code;
	if(pcard->previous.location && pcard->previous.location != LOCATION_DECKMASTER)
		++info.deck_master_returns;
	info.deck_master_last_kind = LOCATION_DECKMASTER;
	info.deck_master_was_on_field = false;
	info.deck_master_kind_changed = false;
	pcard->current.position = POS_FACEUP;
}

void field::domain_collect_idle_summons() {
	uint8_t tp = infos.turn_player;
	if(tp > 1)
		return;
	if(player[tp].list_deckmaster.empty())
		return;
	card* dm = player[tp].list_deckmaster[0];
	if(!dm || dm->current.location != LOCATION_DECKMASTER)
		return;
	if(!domain_can_pay_leave_tax(tp))
		return;
	if(!domain_is_extra_type(dm) && dm->is_can_be_summoned(tp, FALSE, nullptr, 0)) {
		if(std::find(core.summonable_cards.begin(), core.summonable_cards.end(), dm) == core.summonable_cards.end())
			core.summonable_cards.push_back(dm);
	}
}

bool field::domain_has_pending_recall(uint8_t playerid) const {
	if(playerid > 1)
		return false;
	const auto& info = player[playerid];
	card* dm = info.deck_master_card;
	if(!dm)
		return false;
	if(!info.deck_master_kind_changed)
		return false;
	if(dm->overlay_target)
		return false;
	uint32_t kind = domain_location_kind(dm);
	if(kind == LOCATION_DECKMASTER || kind == LOCATION_ONFIELD || kind == LOCATION_OVERLAY)
		return false;
	if(!(kind & (LOCATION_GRAVE | LOCATION_REMOVED | LOCATION_HAND | LOCATION_DECK | LOCATION_EXTRA)))
		return false;
	return true;
}

void field::domain_snapshot_open_kinds() {
	for(uint8_t p = 0; p < 2; ++p) {
		card* dm = player[p].deck_master_card;
		player[p].deck_master_last_kind = dm ? domain_location_kind(dm) : 0;
		player[p].deck_master_kind_changed = false;
	}
}

void field::domain_raise_recall_events(card* dm, uint32_t previous_location, uint8_t owner) {
	if(!dm)
		return;
	if(previous_location == LOCATION_GRAVE) {
		raise_single_event(dm, nullptr, EVENT_LEAVE_GRAVE, nullptr, REASON_RULE, PLAYER_NONE, owner, 0);
		process_single_event();
		raise_event(dm, EVENT_LEAVE_GRAVE, nullptr, REASON_RULE, PLAYER_NONE, owner, 0);
		process_instant_event();
	}
}

void field::domain_apply_recall_answer(int32_t answer) {
	uint8_t playerid = core.domain_recall_player;
	core.domain_recall_player = PLAYER_NONE;
	if(playerid > 1)
		return;
	auto& info = player[playerid];
	card* dm = info.deck_master_card;
	if(!dm)
		return;
	uint32_t kind = domain_location_kind(dm);
	if(!answer) {
		info.deck_master_kind_changed = false;
		info.deck_master_last_kind = kind;
		return;
	}
	if(dm->overlay_target || kind == LOCATION_DECKMASTER || kind == LOCATION_ONFIELD || kind == LOCATION_OVERLAY) {
		info.deck_master_kind_changed = false;
		info.deck_master_last_kind = kind;
		return;
	}
	uint32_t prev = dm->current.location;
	move_card(playerid, dm, LOCATION_DECKMASTER, 0, FALSE);
	dm->current.position = POS_FACEUP;
	info.deck_master_last_kind = LOCATION_DECKMASTER;
	info.deck_master_kind_changed = false;
	domain_raise_recall_events(dm, prev, playerid);
	emplace_process<Processors::PointEvent>(false, true, false);
}

bool field::domain_offer_recalls() {
	if(!domain_is_open_game_state())
		return false;
	uint8_t tp = infos.turn_player;
	if(tp > 1)
		return false;
	const uint8_t order[2] = { tp, static_cast<uint8_t>(1 - tp) };
	for(uint8_t p : order) {
		if(!domain_has_pending_recall(p))
			continue;
		core.domain_recall_player = p;
		emplace_process<Processors::SelectYesNo>(p, static_cast<uint64_t>(DOMAIN_RECALL_DESC));
		return true;
	}
	domain_snapshot_open_kinds();
	return false;
}

bool field::domain_process_recall_step(uint16_t& step, uint16_t resume_step) {
	if(step == DOMAIN_RECALL_STEP + 1) {
		if(domain_offer_recalls()) {
			step = DOMAIN_RECALL_STEP - 1;
			return true;
		}
		if(resume_step == 0)
			step = Processors::restart;
		else
			step = static_cast<uint16_t>(resume_step - 1);
		return true;
	}
	if(step == DOMAIN_RECALL_STEP) {
		domain_apply_recall_answer(returns.at<int32_t>(0));
		step = DOMAIN_RECALL_STEP;
		return true;
	}
	if(step != resume_step)
		return false;
	if(!domain_offer_recalls())
		return false;
	step = DOMAIN_RECALL_STEP - 1;
	return true;
}

bool field::domain_begin_idle_recall(Processors::IdleCommand& arg) {
	return domain_process_recall_step(arg.step, 0);
}

bool field::domain_begin_battle_recall(Processors::BattleCommand& arg) {
	return domain_process_recall_step(arg.step, 0);
}

bool field::domain_begin_phase_recall(Processors::PhaseEvent& arg) {
	return domain_process_recall_step(arg.step, 20);
}

void field::save_lp_cost() {
	for(uint8_t playerid = 0; playerid < 2; ++playerid) {
		if(cost[playerid].count < 8)
			cost[playerid].lpstack[cost[playerid].count] = cost[playerid].amount;
		++cost[playerid].count;
	}
}

void field::restore_lp_cost() {
	for(uint8_t playerid = 0; playerid < 2; ++playerid) {
		--cost[playerid].count;
		if(cost[playerid].count < 8 && cost[playerid].count >= 0)
			cost[playerid].amount = cost[playerid].lpstack[cost[playerid].count];
	}
}
