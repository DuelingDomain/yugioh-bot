#!/usr/bin/env node
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = process.argv[2];
if (!root) {
  console.error("usage: apply-domain-patch.mjs <ygopro-core-dir>");
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const replacements = [];

function patch(file, pairs) {
  const path = join(root, file);
  let text = readFileSync(path, "utf8");
  for (const [from, to] of pairs) {
    if (!text.includes(from)) {
      throw new Error(`Patch failed in ${file}: pattern not found:\n${from.slice(0, 180)}`);
    }
    const next = text.replace(from, to);
    if (next === text) {
      throw new Error(`Patch failed in ${file}: replacement produced no change`);
    }
    text = next;
  }
  writeFileSync(path, text);
  replacements.push(file);
}

patch("ocgapi_constants.h", [
  [
    `#define LOCATION_OVERLAY 0x80
#define LOCATION_ONFIELD (LOCATION_MZONE | LOCATION_SZONE)`,
    `#define LOCATION_OVERLAY 0x80
#define LOCATION_DECKMASTER 0x4000
#define LOCATION_DECKMASTER_RETURNS 0x8000
#define LOCATION_ONFIELD (LOCATION_MZONE | LOCATION_SZONE)`,
  ],
]);

patch("common.h", [
  [
    `#define LOCATION_EMZONE  0x1000
//Locations redirect`,
    `#define LOCATION_EMZONE  0x1000
#ifndef LOCATION_DECKMASTER
#define LOCATION_DECKMASTER 0x4000
#endif
#ifndef LOCATION_DECKMASTER_RETURNS
#define LOCATION_DECKMASTER_RETURNS 0x8000
#endif
//Locations redirect`,
  ],
]);

patch("card.h", [
  [
    `	uint8_t controler{};
	uint8_t location{};
	uint32_t sequence{};`,
    `	uint8_t controler{};
	uint16_t location{};
	uint32_t sequence{};`,
  ],
  [
    `	static bool is_location(const T& loc_info, uint16_t loc) {
		if(loc_info.location & static_cast<uint8_t>(loc))
			return true;`,
    `	static bool is_location(const T& loc_info, uint16_t loc) {
		if(loc_info.location == LOCATION_DECKMASTER)
			return (loc & LOCATION_DECKMASTER) != 0;
		if(loc_info.location & static_cast<uint8_t>(loc))
			return true;`,
  ],
]);

patch("field.h", [
  [
    `	card_vector list_extra;
	std::vector<card_vector> extra_lists_main;`,
    `	card_vector list_extra;
	card_vector list_deckmaster;
	card* deck_master_card{nullptr};
	uint32_t deck_master_code{0};
	uint32_t deck_master_returns{0};
	uint32_t deck_master_last_kind{0};
	bool deck_master_was_on_field{false};
	bool deck_master_kind_changed{false};
	std::vector<card_vector> extra_lists_main;`,
  ],
  [
    `		list_extra.reserve(15);
	}`,
    `		list_extra.reserve(15);
		list_deckmaster.resize(1, nullptr);
	}`,
  ],
  [
    `	bool force_turn_end;
	action_counter_t summon_counter;`,
    `	bool force_turn_end;
	uint8_t domain_recall_player{ PLAYER_NONE };
	action_counter_t summon_counter;`,
  ],
  [
    `	void add_card(uint8_t playerid, card* pcard, uint8_t location, uint8_t sequence, bool pzone = false);
	void remove_card(card* pcard);
	bool move_card(uint8_t playerid, card* pcard, uint8_t location, uint8_t sequence, bool pzone = false);`,
    `	void add_card(uint8_t playerid, card* pcard, uint32_t location, uint8_t sequence, bool pzone = false);
	void remove_card(card* pcard);
	bool move_card(uint8_t playerid, card* pcard, uint32_t location, uint8_t sequence, bool pzone = false);
	uint8_t domain_owner_of(card* pcard) const;
	bool domain_is_deck_master(card* pcard) const;
	uint32_t domain_location_kind(card* pcard) const;
	uint32_t domain_leave_tax_for(uint8_t playerid) const;
	bool domain_can_pay_leave_tax(uint8_t playerid);
	void domain_pay_leave_tax(uint8_t playerid);
	void domain_pay_leave_tax(uint8_t playerid, effect* reason, bool lock_reason);
	void domain_note_kind(card* pcard);
	void domain_after_add_card(card* pcard);
	void domain_collect_idle_summons();
	bool domain_has_pending_recall(uint8_t playerid) const;
	void domain_snapshot_open_kinds();
	void domain_raise_recall_events(card* dm, uint32_t previous_location, uint8_t owner);
	void domain_apply_recall_answer(int32_t answer);
	bool domain_offer_recalls();
	bool domain_begin_idle_recall(Processors::IdleCommand& arg);
	bool domain_begin_battle_recall(Processors::BattleCommand& arg);
	bool domain_card_leaving_dmz(card* pcard) const;
	bool domain_is_open_game_state() const;
	bool domain_process_recall_step(uint16_t& step, uint16_t resume_step);
	bool domain_begin_phase_recall(Processors::PhaseEvent& arg);`,
  ],
  [
    `	//lpcost cost[2];
	field_effect effects;`,
    `	lpcost cost[2];
	field_effect effects;`,
  ],
  [
    `	void save_lp_cost() {}
	void restore_lp_cost() {}`,
    `	void save_lp_cost();
	void restore_lp_cost();`,
  ],
]);

patch("field.cpp", [
  [
    `		if(is_flag(DUEL_FSX_MMZONE) && pcard && pcard->is_position(POS_FACEDOWN) && (pcard->data.type & (get_extra_deck_types() & ~TYPE_LINK)))`,
    `		if(is_flag(DUEL_FSX_MMZONE) && pcard
				&& (pcard->is_position(POS_FACEDOWN) || pcard->current.location == LOCATION_DECKMASTER)
				&& (pcard->data.type & (get_extra_deck_types() & ~TYPE_LINK)))`,
  ],
  [
    `	if(location == LOCATION_MZONE && pcard && pcard->current.location == LOCATION_EXTRA)`,
    `	if(location == LOCATION_MZONE && pcard && (pcard->current.location == LOCATION_EXTRA
			|| (pcard->current.location == LOCATION_DECKMASTER && domain_is_extra_type(pcard))))`,
  ],
  [
    `int32_t field::get_spsummonable_count(card* pcard, uint8_t playerid, uint32_t zone, uint32_t* list) {
	if(pcard->current.location == LOCATION_EXTRA)`,
    `int32_t field::get_spsummonable_count(card* pcard, uint8_t playerid, uint32_t zone, uint32_t* list) {
	if(pcard->current.location == LOCATION_EXTRA
			|| (pcard->current.location == LOCATION_DECKMASTER && domain_is_extra_type(pcard)))`,
  ],
  [
    `void field::add_card(uint8_t playerid, card* pcard, uint8_t location, uint8_t sequence, bool pzone) {`,
    `void field::add_card(uint8_t playerid, card* pcard, uint32_t location, uint8_t sequence, bool pzone) {`,
  ],
  [
    `	if(pcard->is_extra_deck_monster() || (pcard->data.type & TYPE_FUSION) != 0) {
		if(location & (LOCATION_HAND | LOCATION_DECK)) {`,
    `	if(location != LOCATION_DECKMASTER && (pcard->is_extra_deck_monster() || (pcard->data.type & TYPE_FUSION) != 0)) {
		if(location & (LOCATION_HAND | LOCATION_DECK)) {`,
  ],
  [
    `	case LOCATION_EXTRA: {
		if(player[playerid].extra_p_count == 0 || ((pcard->data.type & TYPE_PENDULUM) && (pcard->sendto_param.position & POS_FACEUP)))
			player[playerid].list_extra.push_back(pcard);
		else
			player[playerid].list_extra.insert(player[playerid].list_extra.end() - player[playerid].extra_p_count, pcard);
		if((pcard->data.type & TYPE_PENDULUM) && (pcard->sendto_param.position & POS_FACEUP))
			++player[playerid].extra_p_count;
		reset_sequence(playerid, LOCATION_EXTRA);
		break;
	}
	}`,
    `	case LOCATION_EXTRA: {
		if(player[playerid].extra_p_count == 0 || ((pcard->data.type & TYPE_PENDULUM) && (pcard->sendto_param.position & POS_FACEUP)))
			player[playerid].list_extra.push_back(pcard);
		else
			player[playerid].list_extra.insert(player[playerid].list_extra.end() - player[playerid].extra_p_count, pcard);
		if((pcard->data.type & TYPE_PENDULUM) && (pcard->sendto_param.position & POS_FACEUP))
			++player[playerid].extra_p_count;
		reset_sequence(playerid, LOCATION_EXTRA);
		break;
	}
	case LOCATION_DECKMASTER: {
		player[playerid].list_deckmaster[0] = pcard;
		pcard->current.sequence = 0;
		pcard->sendto_param.position = POS_FACEUP;
		break;
	}
	}`,
  ],
  [
    `	if (location == LOCATION_SZONE)
		player[playerid].used_location |= 256 << sequence;
}`,
    `	if (location == LOCATION_SZONE)
		player[playerid].used_location |= 256 << sequence;
	domain_after_add_card(pcard);
}`,
  ],
  [
    `	case LOCATION_EXTRA:
		player[playerid].list_extra.erase(player[playerid].list_extra.begin() + pcard->current.sequence);
		reset_sequence(playerid, LOCATION_EXTRA);
		if((pcard->data.type & TYPE_PENDULUM) && (pcard->current.position & POS_FACEUP))
			--player[playerid].extra_p_count;
		break;
	}`,
    `	case LOCATION_EXTRA:
		player[playerid].list_extra.erase(player[playerid].list_extra.begin() + pcard->current.sequence);
		reset_sequence(playerid, LOCATION_EXTRA);
		if((pcard->data.type & TYPE_PENDULUM) && (pcard->current.position & POS_FACEUP))
			--player[playerid].extra_p_count;
		break;
	case LOCATION_DECKMASTER:
		player[playerid].list_deckmaster[0] = nullptr;
		break;
	}`,
  ],
  [
    `bool field::move_card(uint8_t playerid, card* pcard, uint8_t location, uint8_t sequence, bool pzone) {`,
    `bool field::move_card(uint8_t playerid, card* pcard, uint32_t location, uint8_t sequence, bool pzone) {`,
  ],
  [
    `	if(pcard->is_extra_deck_monster() && (location & (LOCATION_HAND | LOCATION_DECK))) {`,
    `	if(location != LOCATION_DECKMASTER && pcard->is_extra_deck_monster() && (location & (LOCATION_HAND | LOCATION_DECK))) {`,
  ],
  [
    `	case LOCATION_EXTRA: {
		if(sequence < player[playerid].list_extra.size())
			return player[playerid].list_extra[sequence];
		return nullptr;
	}
	}
	return nullptr;
}`,
    `	case LOCATION_EXTRA: {
		if(sequence < player[playerid].list_extra.size())
			return player[playerid].list_extra[sequence];
		return nullptr;
	}
	case LOCATION_DECKMASTER: {
		if(sequence == 0 && !player[playerid].list_deckmaster.empty())
			return player[playerid].list_deckmaster[0];
		return nullptr;
	}
	}
	return nullptr;
}`,
  ],
  [
    `	} else if (location == LOCATION_PZONE) {
		if(!is_flag(DUEL_PZONE))
			return FALSE;
		if(flag & (0x100u << get_pzone_index(sequence, playerid)))
			return FALSE;
	}
	return TRUE;
}`,
    `	} else if (location == LOCATION_PZONE) {
		if(!is_flag(DUEL_PZONE))
			return FALSE;
		if(flag & (0x100u << get_pzone_index(sequence, playerid)))
			return FALSE;
	} else if (location == LOCATION_DECKMASTER) {
		if(sequence != 0)
			return FALSE;
		if(!player[playerid].list_deckmaster.empty() && player[playerid].list_deckmaster[0])
			return FALSE;
	}
	return TRUE;
}`,
  ],
  [
    `		if((location & LOCATION_REMOVED) && check_list(player[self].list_remove, checkc))
			return TRUE;
	}
	return FALSE;
}`,
    `		if((location & LOCATION_REMOVED) && check_list(player[self].list_remove, checkc))
			return TRUE;
		if(location & LOCATION_DECKMASTER) {
			for(auto* pcard : player[self].list_deckmaster) {
				if(!pcard)
					continue;
				const bool extra = domain_is_extra_type(pcard);
				if(extra && !(location & LOCATION_EXTRA) && (location & LOCATION_HAND))
					continue;
				if(!extra && !(location & LOCATION_HAND) && (location & LOCATION_EXTRA))
					continue;
				if(checkc(pcard))
					return TRUE;
			}
		}
	}
	return FALSE;
}`,
  ],
  [
    `		if(location & LOCATION_REMOVED) {
			if(pgroup)
				pgroup->container.insert(player[self].list_remove.rbegin(), player[self].list_remove.rend());
			count += player[self].list_remove.size();
		}
	}
	return static_cast<int32_t>(count);
}`,
    `		if(location & LOCATION_REMOVED) {
			if(pgroup)
				pgroup->container.insert(player[self].list_remove.rbegin(), player[self].list_remove.rend());
			count += player[self].list_remove.size();
		}
		if(location & LOCATION_DECKMASTER) {
			for(auto* pcard : player[self].list_deckmaster) {
				if(!pcard)
					continue;
				const bool extra = domain_is_extra_type(pcard);
				if(extra && !(location & LOCATION_EXTRA) && (location & LOCATION_HAND))
					continue;
				if(!extra && !(location & LOCATION_HAND) && (location & LOCATION_EXTRA))
					continue;
				if(pgroup)
					pgroup->container.insert(pcard);
				++count;
			}
		}
	}
	return static_cast<int32_t>(count);
}`,
  ],
]);

patch("processor.cpp", [
  [
    `bool field::process(Processors::IdleCommand& arg) {
	switch(arg.step) {
	case 0: {
		bool must_attack = false;`,
    `bool field::process(Processors::IdleCommand& arg) {
	if(domain_begin_idle_recall(arg))
		return FALSE;
	switch(arg.step) {
	case 0: {
		bool must_attack = false;`,
  ],
  [
    `		core.summonable_cards.clear();
		for(auto& pcard : player[infos.turn_player].list_hand)
			if(pcard->is_can_be_summoned(infos.turn_player, FALSE, nullptr, 0))
				core.summonable_cards.push_back(pcard);`,
    `		core.summonable_cards.clear();
		for(auto& pcard : player[infos.turn_player].list_hand)
			if(pcard->is_can_be_summoned(infos.turn_player, FALSE, nullptr, 0))
				core.summonable_cards.push_back(pcard);
		domain_collect_idle_summons();`,
  ],
  [
    `bool field::process(Processors::BattleCommand& arg) {
	switch(arg.step) {
	case 0: {
		core.select_chains.clear();`,
    `bool field::process(Processors::BattleCommand& arg) {
	if(domain_begin_battle_recall(arg))
		return FALSE;
	switch(arg.step) {
	case 0: {
		core.select_chains.clear();`,
  ],
  [
    `bool field::process(Processors::PhaseEvent& arg) {
	auto phase = arg.phase;
	switch(arg.step) {
	case 0: {`,
    `bool field::process(Processors::PhaseEvent& arg) {
	if(domain_begin_phase_recall(arg))
		return FALSE;
	auto phase = arg.phase;
	switch(arg.step) {
	case 0: {`,
  ],
  [
    `		core.msetable_cards.clear();
		core.ssetable_cards.clear();
		for(auto& pcard : player[infos.turn_player].list_hand) {
			if(pcard->is_setable_mzone(infos.turn_player, FALSE, nullptr, 0))
				core.msetable_cards.push_back(pcard);
			if(pcard->is_setable_szone(infos.turn_player))
				core.ssetable_cards.push_back(pcard);
		}
		emplace_process<Processors::SelectIdleCmd>(infos.turn_player);`,
    `		core.msetable_cards.clear();
		core.ssetable_cards.clear();
		for(auto& pcard : player[infos.turn_player].list_hand) {
			if(pcard->is_setable_mzone(infos.turn_player, FALSE, nullptr, 0))
				core.msetable_cards.push_back(pcard);
			if(pcard->is_setable_szone(infos.turn_player))
				core.ssetable_cards.push_back(pcard);
		}
		for(auto& pcard : player[infos.turn_player].list_deckmaster) {
			if(pcard && pcard->is_setable_mzone(infos.turn_player, FALSE, nullptr, 0))
				core.msetable_cards.push_back(pcard);
			if(pcard && pcard->is_special_summonable(infos.turn_player, 0)) {
				bool already = false;
				for(auto* listed : core.spsummonable_cards) {
					if(listed == pcard) {
						already = true;
						break;
					}
				}
				if(!already)
					core.spsummonable_cards.push_back(pcard);
			}
		}
		emplace_process<Processors::SelectIdleCmd>(infos.turn_player);`,
  ],
]);

patch("effect.cpp", [
  [
    `int32_t effect::is_activateable(uint8_t playerid, const tevent& e, int32_t neglect_cond, int32_t neglect_cost, int32_t neglect_target, int32_t neglect_loc, int32_t neglect_faceup) {
	if(!(type & EFFECT_TYPE_ACTIONS))
		return FALSE;`,
    `int32_t effect::is_activateable(uint8_t playerid, const tevent& e, int32_t neglect_cond, int32_t neglect_cost, int32_t neglect_target, int32_t neglect_loc, int32_t neglect_faceup) {
	if(!(type & EFFECT_TYPE_ACTIONS))
		return FALSE;
	card* domain_handler = get_handler();
	if(domain_handler && domain_handler->current.location == LOCATION_DECKMASTER && (type & (EFFECT_TYPE_IGNITION | EFFECT_TYPE_TRIGGER_O | EFFECT_TYPE_TRIGGER_F | EFFECT_TYPE_QUICK_O | EFFECT_TYPE_QUICK_F | EFFECT_TYPE_ACTIVATE)))
		return FALSE;`,
  ],
  [
    `int32_t effect::in_range(card* pcard) {
	if(type & EFFECT_TYPE_XMATERIAL)
		return handler->overlay_target ? TRUE : FALSE;`,
    `int32_t effect::in_range(card* pcard) {
	if(type & EFFECT_TYPE_XMATERIAL)
		return handler->overlay_target ? TRUE : FALSE;
	if(pcard && pcard->current.location == LOCATION_DECKMASTER) {
		if(code == EFFECT_SPSUMMON_PROC || code == EFFECT_SPSUMMON_PROC_G) {
			if(domain_is_extra_type(pcard))
				return (range & LOCATION_EXTRA) ? TRUE : FALSE;
			return (range & LOCATION_HAND) ? TRUE : FALSE;
		}
		if((type & EFFECT_TYPE_ACTIVATE) && domain_is_main_pendulum(pcard))
			return (range & LOCATION_HAND) ? TRUE : FALSE;
	}`,
  ],
]);

patch("card.cpp", [
  [
    `		return { current.controler, current.location , current.sequence, current.position };`,
    `		uint8_t loc = current.location == LOCATION_DECKMASTER ? 0 : static_cast<uint8_t>(current.location);
		return { current.controler, loc, current.sequence, current.position };`,
  ],
  [
    `	} else if(current.location == LOCATION_HAND) {
		if(is_affected_by_effect(EFFECT_CANNOT_SUMMON)) {`,
    `	} else if(current.location == LOCATION_HAND || current.location == LOCATION_DECKMASTER) {
		if(current.location == LOCATION_DECKMASTER && domain_is_extra_type(this)) {
			pduel->game_field->restore_lp_cost();
			return FALSE;
		}
		if(current.location == LOCATION_DECKMASTER && !pduel->game_field->domain_can_pay_leave_tax(playerid)) {
			pduel->game_field->restore_lp_cost();
			return FALSE;
		}
		if(is_affected_by_effect(EFFECT_CANNOT_SUMMON)) {`,
  ],
  [
    `int32_t card::is_affect_by_effect(effect* peffect) {
	if(is_status(STATUS_SUMMONING) && (peffect && peffect->code != EFFECT_CANNOT_DISABLE_SUMMON && peffect->code != EFFECT_CANNOT_DISABLE_SPSUMMON))
		return FALSE;`,
    `int32_t card::is_affect_by_effect(effect* peffect) {
	if(current.location == LOCATION_DECKMASTER) {
		if(!peffect || peffect->is_flag(EFFECT_FLAG_IGNORE_IMMUNE))
			return TRUE;
		if(peffect->code == EFFECT_SPSUMMON_PROC || peffect->code == EFFECT_SPSUMMON_PROC_G || peffect->code == EFFECT_SUMMON_PROC)
			return TRUE;
		return FALSE;
	}
	if(is_status(STATUS_SUMMONING) && (peffect && peffect->code != EFFECT_CANNOT_DISABLE_SUMMON && peffect->code != EFFECT_CANNOT_DISABLE_SPSUMMON))
		return FALSE;`,
  ],
  [
    `int32_t card::is_can_be_fusion_material(card* fcard, uint64_t summon_type, uint8_t playerid) {
	if(this == fcard)
		return FALSE;`,
    `int32_t card::is_can_be_fusion_material(card* fcard, uint64_t summon_type, uint8_t playerid) {
	if(current.location == LOCATION_DECKMASTER)
		return FALSE;
	if(this == fcard)
		return FALSE;`,
  ],
  [
    `int32_t card::is_can_be_synchro_material(card* scard, uint8_t playerid, card* /*tuner*/) {
	if(this == scard)`,
    `int32_t card::is_can_be_synchro_material(card* scard, uint8_t playerid, card* /*tuner*/) {
	if(current.location == LOCATION_DECKMASTER)
		return FALSE;
	if(this == scard)`,
  ],
  [
    `int32_t card::is_can_be_ritual_material(card* scard, uint8_t playerid) {`,
    `int32_t card::is_can_be_ritual_material(card* scard, uint8_t playerid) {
	if(current.location == LOCATION_DECKMASTER)
		return FALSE;`,
  ],
  [
    `int32_t card::is_can_be_xyz_material(card* scard, uint8_t playerid, uint32_t reason) {`,
    `int32_t card::is_can_be_xyz_material(card* scard, uint8_t playerid, uint32_t reason) {
	if(current.location == LOCATION_DECKMASTER)
		return FALSE;`,
  ],
  [
    `int32_t card::is_can_be_link_material(card* scard, uint8_t playerid) {`,
    `int32_t card::is_can_be_link_material(card* scard, uint8_t playerid) {
	if(current.location == LOCATION_DECKMASTER)
		return FALSE;`,
  ],
  [
    `int32_t card::is_special_summonable(uint8_t playerid, uint32_t summon_type) {
	if(!(data.type & TYPE_MONSTER))
		return FALSE;
	if(is_affected_by_effect(EFFECT_CANNOT_SPECIAL_SUMMON))
		return FALSE;`,
    `int32_t card::is_special_summonable(uint8_t playerid, uint32_t summon_type) {
	if(!(data.type & TYPE_MONSTER))
		return FALSE;
	if(current.location == LOCATION_DECKMASTER && !pduel->game_field->domain_can_pay_leave_tax(playerid))
		return FALSE;
	if(is_affected_by_effect(EFFECT_CANNOT_SPECIAL_SUMMON))
		return FALSE;`,
  ],
  [
    `	if(current.location != LOCATION_HAND)
		return FALSE;
	if(is_status(STATUS_FORBIDDEN))
		return FALSE;
	if(is_affected_by_effect(EFFECT_CANNOT_MSET))
		return FALSE;`,
    `	if(current.location != LOCATION_HAND && current.location != LOCATION_DECKMASTER)
		return FALSE;
	if(current.location == LOCATION_DECKMASTER && domain_is_extra_type(this))
		return FALSE;
	if(current.location == LOCATION_DECKMASTER && !pduel->game_field->domain_can_pay_leave_tax(playerid))
		return FALSE;
	if(is_status(STATUS_FORBIDDEN))
		return FALSE;
	if(is_affected_by_effect(EFFECT_CANNOT_MSET))
		return FALSE;`,
  ],
  [
    `int32_t card::is_can_be_special_summoned(effect* reason_effect, uint32_t sumtype, uint8_t sumpos, uint8_t sumplayer, uint8_t toplayer, uint8_t nocheck, uint8_t nolimit, uint32_t zone) {
	if(reason_effect->get_handler() == this)
		reason_effect->status |= EFFECT_STATUS_SUMMON_SELF;
	if(current.location == LOCATION_MZONE)
		return FALSE;`,
    `int32_t card::is_can_be_special_summoned(effect* reason_effect, uint32_t sumtype, uint8_t sumpos, uint8_t sumplayer, uint8_t toplayer, uint8_t nocheck, uint8_t nolimit, uint32_t zone) {
	if(reason_effect->get_handler() == this)
		reason_effect->status |= EFFECT_STATUS_SUMMON_SELF;
	if(current.location == LOCATION_MZONE)
		return FALSE;
	if(current.location == LOCATION_DECKMASTER) {
		if(!pduel->game_field->domain_can_pay_leave_tax(sumplayer))
			return FALSE;
		const uint32_t mechanic = sumtype & 0xff000000u;
		if(domain_is_extra_type(this)) {
			const bool fusion = mechanic == SUMMON_TYPE_FUSION && (data.type & TYPE_FUSION);
			const bool synchro = mechanic == SUMMON_TYPE_SYNCHRO && (data.type & TYPE_SYNCHRO);
			const bool xyz = mechanic == SUMMON_TYPE_XYZ && (data.type & TYPE_XYZ);
			const bool link = mechanic == SUMMON_TYPE_LINK && (data.type & TYPE_LINK);
			if(!(fusion || synchro || xyz || link))
				return FALSE;
		} else if(mechanic != SUMMON_TYPE_RITUAL) {
			return FALSE;
		}
	}`,
  ],
]);

patch("operations.cpp", [
  [
    `	case 8: {
		--core.summon_depth;
		if(core.summon_depth)
			return TRUE;
		break_effect();
		if(ignore_count)
			return FALSE;`,
    `	case 8: {
		--core.summon_depth;
		if(core.summon_depth)
			return TRUE;
		break_effect();
		if(ignore_count) {
			if(domain_card_leaving_dmz(target))
				domain_pay_leave_tax(sumplayer);
			return FALSE;
		}`,
  ],
  [
    `			if(pextra->operation) {
				pduel->lua->add_param<LuaParam::CARD>(target);
				core.sub_solving_event.push_back(nil_event);
				emplace_process<Processors::ExecuteOperation>(pextra, sumplayer);
			}
		}
		return FALSE;
	}
	case 9: {
		uint8_t targetplayer = sumplayer;
		uint8_t positions = POS_FACEUP_ATTACK;`,
    `			if(pextra->operation) {
				pduel->lua->add_param<LuaParam::CARD>(target);
				core.sub_solving_event.push_back(nil_event);
				emplace_process<Processors::ExecuteOperation>(pextra, sumplayer);
			}
		}
		if(domain_card_leaving_dmz(target))
			domain_pay_leave_tax(sumplayer);
		return FALSE;
	}
	case 9: {
		uint8_t targetplayer = sumplayer;
		uint8_t positions = POS_FACEUP_ATTACK;`,
  ],
  [
    `		if(target->current.location != LOCATION_HAND)
			return TRUE;
		if(!(target->data.type & TYPE_MONSTER))
			return TRUE;`,
    `		if(target->current.location != LOCATION_HAND && target->current.location != LOCATION_DECKMASTER)
			return TRUE;
		if(!(target->data.type & TYPE_MONSTER))
			return TRUE;`,
  ],
  [
    `	case 8: {
		break_effect();
		if(ignore_count)
			return FALSE;
		auto pextra = arg.extra_summon_effect;
		if(!pextra)
			++core.summon_count[setplayer];`,
    `	case 8: {
		break_effect();
		if(ignore_count) {
			if(domain_card_leaving_dmz(target))
				domain_pay_leave_tax(setplayer);
			return FALSE;
		}
		auto pextra = arg.extra_summon_effect;
		if(!pextra)
			++core.summon_count[setplayer];`,
  ],
  [
    `			if(pextra->operation) {
				pduel->lua->add_param<LuaParam::CARD>(target);
				core.sub_solving_event.push_back(nil_event);
				emplace_process<Processors::ExecuteOperation>(pextra, setplayer);
			}
		}
		return FALSE;
	}
	case 9: {
		uint8_t targetplayer = setplayer;
		uint8_t positions = POS_FACEDOWN_DEFENSE;`,
    `			if(pextra->operation) {
				pduel->lua->add_param<LuaParam::CARD>(target);
				core.sub_solving_event.push_back(nil_event);
				emplace_process<Processors::ExecuteOperation>(pextra, setplayer);
			}
		}
		if(domain_card_leaving_dmz(target))
			domain_pay_leave_tax(setplayer);
		return FALSE;
	}
	case 9: {
		uint8_t targetplayer = setplayer;
		uint8_t positions = POS_FACEDOWN_DEFENSE;`,
  ],
  [
    `		proc->dec_count(sumplayer);
		return FALSE;
	}
	case 4: {
		core.must_use_mats = nullptr;`,
    `		proc->dec_count(sumplayer);
		if(domain_card_leaving_dmz(target))
			domain_pay_leave_tax(sumplayer);
		return FALSE;
	}
	case 4: {
		core.must_use_mats = nullptr;`,
  ],
]);


patch("ocgapi.cpp", [
  [
    `			game_field.add_card(info.con, pcard, (uint8_t)info.loc, (uint8_t)info.seq);`,
    `			game_field.add_card(info.con, pcard, info.loc, (uint8_t)info.seq);`,
  ],
  [
    `	if (loc == LOCATION_DECK)
		return static_cast<uint32_t>(player.list_main.size());
	uint32_t count = 0;`,
    `	if (loc == LOCATION_DECK)
		return static_cast<uint32_t>(player.list_main.size());
	if (loc == LOCATION_DECKMASTER)
		return (!player.list_deckmaster.empty() && player.list_deckmaster[0]) ? 1u : 0u;
	if (loc == LOCATION_DECKMASTER_RETURNS)
		return player.deck_master_returns;
	uint32_t count = 0;`,
  ],
  [
    `			else if(info.loc == LOCATION_DECK)
				populate(player.list_main);
		}`,
    `			else if(info.loc == LOCATION_DECK)
				populate(player.list_main);
			else if(info.loc == LOCATION_DECKMASTER)
				populate(player.list_deckmaster);
		}`,
  ],
]);
patch("processor_unit.h", [
  [
    `struct PayLPCost : public Process<false> {
	uint8_t playerid;
	uint32_t cost;
	PayLPCost(uint16_t step_, uint8_t playerid_, uint32_t cost_) :
		Process(step_), playerid(playerid_), cost(cost_) {}
};`,
    `struct PayLPCost : public Process<false> {
	uint8_t playerid;
	uint32_t cost;
	effect* pay_reason_effect;
	bool pay_reason_locked;
	PayLPCost(uint16_t step_, uint8_t playerid_, uint32_t cost_) :
		Process(step_), playerid(playerid_), cost(cost_), pay_reason_effect(nullptr), pay_reason_locked(false) {}
	PayLPCost(uint16_t step_, uint8_t playerid_, uint32_t cost_, effect* pay_reason_effect_, bool pay_reason_locked_) :
		Process(step_), playerid(playerid_), cost(cost_), pay_reason_effect(pay_reason_effect_), pay_reason_locked(pay_reason_locked_) {}
};`,
  ],
]);

patch("field.cpp", [
  [
    `	if(effect_replace_check(EFFECT_LPCOST_REPLACE, e))
		return TRUE;
	//cost[playerid].amount += val;
	if(val <= player[playerid].lp)
		return TRUE;
	return FALSE;
}`,
    `	if(effect_replace_check(EFFECT_LPCOST_REPLACE, e))
		return TRUE;
	cost[playerid].amount += val;
	if(cost[playerid].amount <= player[playerid].lp)
		return TRUE;
	return FALSE;
}`,
  ],
]);

// check_extra_link saves the card's location in a uint8_t and restores it afterwards. A Deck Master
// in the DMZ (0x4000) was truncated to 0, so remove_card() skipped it and left a stale DMZ entry.
patch("field.cpp", [
  [
    `	uint8_t cur_location = pcard->current.location;
	uint8_t cur_sequence = pcard->current.sequence;
	uint8_t cur_position = pcard->current.position;
	player[playerid].list_mzone[sequence] = pcard;`,
    `	uint32_t cur_location = pcard->current.location;
	uint8_t cur_sequence = pcard->current.sequence;
	uint8_t cur_position = pcard->current.position;
	player[playerid].list_mzone[sequence] = pcard;`,
  ],
]);


patch("operations.cpp", [
  [
    `bool field::process(Processors::PayLPCost& arg) {
	auto playerid = arg.playerid;
	auto cost = arg.cost;
	switch(arg.step) {
	case 0: {
		effect_set eset;
		int32_t val = cost;
		filter_player_effect(playerid, EFFECT_LPCOST_CHANGE, &eset);
		for(const auto& peff : eset) {
			pduel->lua->add_param<LuaParam::EFFECT>(core.reason_effect);
			pduel->lua->add_param<LuaParam::INT>(playerid);
			pduel->lua->add_param<LuaParam::INT>(val);
			val = peff->get_value(3);
		}
		if(val <= 0)
			return TRUE;
		arg.cost = val;
		tevent e;
		e.event_cards = nullptr;
		e.event_player = playerid;
		e.event_value = val;
		e.reason = 0;
		e.reason_effect = core.reason_effect;
		e.reason_player = playerid;`,
    `bool field::process(Processors::PayLPCost& arg) {
	auto playerid = arg.playerid;
	auto cost = arg.cost;
	effect* reason = arg.pay_reason_locked ? arg.pay_reason_effect : core.reason_effect;
	switch(arg.step) {
	case 0: {
		effect_set eset;
		int32_t val = cost;
		filter_player_effect(playerid, EFFECT_LPCOST_CHANGE, &eset);
		for(const auto& peff : eset) {
			pduel->lua->add_param<LuaParam::EFFECT>(reason);
			pduel->lua->add_param<LuaParam::INT>(playerid);
			pduel->lua->add_param<LuaParam::INT>(val);
			val = peff->get_value(3);
		}
		if(val <= 0)
			return TRUE;
		arg.cost = val;
		tevent e;
		e.event_cards = nullptr;
		e.event_player = playerid;
		e.event_value = val;
		e.reason = 0;
		e.reason_effect = reason;
		e.reason_player = playerid;`,
  ],
  [
    `			player[playerid].lp -= cost;
			auto message = pduel->new_message(MSG_PAY_LPCOST);
			message->write<uint8_t>(playerid);
			message->write<uint32_t>(cost);
			raise_event(nullptr, EVENT_PAY_LPCOST, core.reason_effect, 0, playerid, playerid, cost);`,
    `			player[playerid].lp -= cost;
			auto message = pduel->new_message(MSG_PAY_LPCOST);
			message->write<uint8_t>(playerid);
			message->write<uint32_t>(cost);
			raise_event(nullptr, EVENT_PAY_LPCOST, reason, 0, playerid, playerid, cost);`,
  ],
  [
    `		tevent e;
		e.event_cards = nullptr;
		e.event_player = playerid;
		e.event_value = cost;
		e.reason = 0;
		e.reason_effect = core.reason_effect;
		e.reason_player = playerid;
		solve_continuous(playerid, peffect, e);
		return TRUE;
	}
	}
	return TRUE;
}
// rplayer rmoves counter from pcard or the field`,
    `		tevent e;
		e.event_cards = nullptr;
		e.event_player = playerid;
		e.event_value = cost;
		e.reason = 0;
		e.reason_effect = reason;
		e.reason_player = playerid;
		solve_continuous(playerid, peffect, e);
		return TRUE;
	}
	}
	return TRUE;
}
// rplayer rmoves counter from pcard or the field`,
  ],
  [
    `		move_to_field(target, target->summon.player, playerid, LOCATION_MZONE, positions, FALSE, 0, zone, false, LOCATION_REASON::SPSUMMON);
		return FALSE;
	}
	case 2: {
		auto message = pduel->new_message(MSG_SPSUMMONING);`,
    `		if(domain_card_leaving_dmz(target))
			domain_pay_leave_tax(target->summon.player);
		move_to_field(target, target->summon.player, playerid, LOCATION_MZONE, positions, FALSE, 0, zone, false, LOCATION_REASON::SPSUMMON);
		return FALSE;
	}
	case 2: {
		auto message = pduel->new_message(MSG_SPSUMMONING);`,
  ],
  [
    `		move_to_field(pcard, sumplayer, sumplayer, LOCATION_MZONE, positions, FALSE, 0, zone, TRUE, LOCATION_REASON::SPSUMMON);
		return FALSE;
	}
	case 24: {`,
    `		if(domain_card_leaving_dmz(pcard))
			domain_pay_leave_tax(sumplayer);
		move_to_field(pcard, sumplayer, sumplayer, LOCATION_MZONE, positions, FALSE, 0, zone, TRUE, LOCATION_REASON::SPSUMMON);
		return FALSE;
	}
	case 24: {`,
  ],
]);

patch("processor.cpp", [
  [
    `		phandler->set_status(STATUS_ACT_FROM_HAND, phandler->current.location == LOCATION_HAND);`,
    `		phandler->set_status(STATUS_ACT_FROM_HAND, phandler->current.location == LOCATION_HAND || phandler->current.location == LOCATION_DECKMASTER);`,
  ],
  [
    `			} else if(phandler->current.location == LOCATION_HAND) {
				if(phandler->data.type & TYPE_PENDULUM) {
					loc = LOCATION_PZONE;`,
    `			} else if(phandler->current.location == LOCATION_HAND || phandler->current.location == LOCATION_DECKMASTER) {
				if(phandler->data.type & TYPE_PENDULUM) {
					loc = LOCATION_PZONE;`,
  ],
  [
    `		if(peffect->type & EFFECT_TYPE_ACTIVATE) {
			clit.set_triggering_state(phandler);
		}
		auto message = pduel->new_message(MSG_CHAINING);`,
    `		if(peffect->type & EFFECT_TYPE_ACTIVATE) {
			clit.set_triggering_state(phandler);
		}
		if(phandler->previous.location == LOCATION_DECKMASTER && (peffect->type & EFFECT_TYPE_ACTIVATE))
			domain_pay_leave_tax(clit.triggering_player, peffect, true);
		auto message = pduel->new_message(MSG_CHAINING);`,
  ],
]);

patch("effect.cpp", [
  [
    `	if(domain_handler && domain_handler->current.location == LOCATION_DECKMASTER && (type & (EFFECT_TYPE_IGNITION | EFFECT_TYPE_TRIGGER_O | EFFECT_TYPE_TRIGGER_F | EFFECT_TYPE_QUICK_O | EFFECT_TYPE_QUICK_F | EFFECT_TYPE_ACTIVATE)))
		return FALSE;`,
    `	if(domain_handler && domain_handler->current.location == LOCATION_DECKMASTER) {
		const bool pendulum_activate = (type & EFFECT_TYPE_ACTIVATE) && domain_is_main_pendulum(domain_handler);
		if(!pendulum_activate && (type & (EFFECT_TYPE_IGNITION | EFFECT_TYPE_TRIGGER_O | EFFECT_TYPE_TRIGGER_F | EFFECT_TYPE_QUICK_O | EFFECT_TYPE_QUICK_F | EFFECT_TYPE_ACTIVATE)))
			return FALSE;
	}`,
  ],
  [
    `	if(result)
		result = is_activate_ready(playerid, e, neglect_cond, neglect_cost, neglect_target);
	pduel->game_field->core.reason_effect = oreason;
	pduel->game_field->core.reason_player = op;
	pduel->game_field->restore_lp_cost();
	return result;
}
// check functions: value of EFFECT_CANNOT_ACTIVATE, target, cost of EFFECT_ACTIVATE_COST`,
    `	if(result)
		result = is_activate_ready(playerid, e, neglect_cond, neglect_cost, neglect_target);
	if(result) {
		card* tax_handler = get_handler();
		if(tax_handler && tax_handler->current.location == LOCATION_DECKMASTER
			&& (type & EFFECT_TYPE_ACTIVATE) && domain_is_main_pendulum(tax_handler)
			&& !pduel->game_field->domain_can_pay_leave_tax(playerid))
			result = FALSE;
	}
	pduel->game_field->core.reason_effect = oreason;
	pduel->game_field->core.reason_player = op;
	pduel->game_field->restore_lp_cost();
	return result;
}
// check functions: value of EFFECT_CANNOT_ACTIVATE, target, cost of EFFECT_ACTIVATE_COST`,
  ],
]);

patch("card.cpp", [
  [
    `		} else if(mechanic != SUMMON_TYPE_RITUAL) {
			return FALSE;
		}`,
    `		} else if(mechanic != SUMMON_TYPE_RITUAL && mechanic != SUMMON_TYPE_PENDULUM) {
			return FALSE;
		}`,
  ],
  [
    `	mat->current.sequence = static_cast<uint32_t>(xyz_materials.size() - 1);
	for(auto& eit : mat->xmaterial_effect) {`,
    `	mat->current.sequence = static_cast<uint32_t>(xyz_materials.size() - 1);
	pduel->game_field->domain_note_kind(mat);
	for(auto& eit : mat->xmaterial_effect) {`,
  ],
]);

const includes = [
  ["field.cpp", `#include "interpreter.h"`, `#include "interpreter.h"\n#include "domain_master.h"`],
  ["processor.cpp", `#include "interpreter.h"`, `#include "interpreter.h"\n#include "domain_master.h"`],
  ["effect.cpp", `#include "field.h"`, `#include "field.h"\n#include "domain_master.h"`],
  ["card.cpp", `#include "duel.h"`, `#include "duel.h"\n#include "domain_master.h"`],
  ["ocgapi.cpp", `#include "field.h"`, `#include "field.h"\n#include "domain_master.h"`],
  ["operations.cpp", `#include "field.h"`, `#include "field.h"\n#include "domain_master.h"`],
];
for (const [file, from, to] of includes) {
  patch(file, [[from, to]]);
}

copyFileSync(join(here, "domain_master.cpp"), join(root, "domain_master.cpp"));
copyFileSync(join(here, "domain_master.h"), join(root, "domain_master.h"));
if (!existsSync(join(root, "domain_master.cpp"))) {
  throw new Error("failed to copy domain_master.cpp");
}

console.log(`patched ${replacements.join(", ")}`);
