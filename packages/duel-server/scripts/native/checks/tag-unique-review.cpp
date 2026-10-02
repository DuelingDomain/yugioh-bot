// Review 5a: native checks for card::get_unique_target and field add/remove/check_unique_onfield.
// The live official-card scenarios in tag-unique-review.ts prove the action and every seat outcome.
// These small Lua cards isolate the registry path from the candidate's own unique restriction.
#include "scripted-duel.h"
#include "card.h"
#include "effect.h"

static constexpr uint32_t kMonster = 99006101, kSpell = 99006102, kSentinel = 99006103;

static std::string setup(int seats, bool tag) {
	if(seats == 2) return "";
	return tag ? "Debug.SetupDuelists(4,0,1,0,1)" : seats == 3 ? "Debug.SetupDuelists(3,0,1,2)" : "Debug.SetupDuelists(4,0,1,2,3)";
}

static void check(const char* id, int seats, bool tag, uint8_t actor, uint8_t sourceSeat, uint32_t location, bool otherSide = false) {
	const uint32_t code = location == LOCATION_MZONE ? kMonster : kSpell;
	sd::stray_logs = 0;
	OCG_Duel d = sd::create(setup(seats, tag));
	for(uint8_t p = 0; p < seats; ++p) sd::add(d, p, kSentinel, LOCATION_MZONE, POS_FACEUP_ATTACK, 1);
	sd::add(d, sourceSeat, code, location, POS_FACEUP_ATTACK);
	sd::add(d, actor, code, LOCATION_HAND);
	auto& f = sd::F(d);
	card* source = location == LOCATION_MZONE ? f.player[sourceSeat].list_mzone[0] : f.player[sourceSeat].list_szone[0];
	card* candidate = f.player[actor].list_hand.back();
	EXPECT(source && candidate && source->unique_effect, "%s: missing cards or unique effect", id);
	if(!source || !candidate || !source->unique_effect) { OCG_DestroyDuel(d); return; }
	source->unique_pos[1] = otherSide;
	candidate->unique_pos[1] = otherSide;
	source->set_status(STATUS_EFFECT_ENABLED, true);
	f.remove_unique_card(source);
	f.add_unique_card(source);
	source->unique_fieldid = 1;
	const bool sameSide = tag ? actor % 2 == sourceSeat % 2 : actor == sourceSeat;
	const bool wantConflict = sameSide || otherSide;
	for(uint8_t p = 0; p < seats; ++p) {
		const bool same = tag ? p % 2 == sourceSeat % 2 : p == sourceSeat;
		EXPECT((f.core.unique_cards[p].count(source) != 0) == (same || otherSide), "%s add: seat %u has source=%d, want=%d", id, p, f.core.unique_cards[p].count(source) != 0, same || otherSide);
	}
	card_set targets;
	candidate->get_unique_target(&targets, actor);
	EXPECT((targets.count(source) != 0) == wantConflict && targets.size() == static_cast<size_t>(wantConflict), "%s target: got %zu target(s), want=%d", id, targets.size(), wantConflict);
	candidate->get_unique_target(&targets, actor, source);
	EXPECT(targets.empty(), "%s target: ignored card was included", id);
	// With no unique code on the candidate, only the registered source can block it.
	candidate->unique_code = 0;
	EXPECT((f.check_unique_onfield(candidate, actor, location) != nullptr) == wantConflict, "%s registry: conflict does not match team", id);
	EXPECT(f.check_unique_onfield(candidate, actor, location, source) == nullptr, "%s registry: ignored source still blocks", id);
	source->current.position = POS_FACEDOWN_DEFENSE;
	EXPECT(f.check_unique_onfield(candidate, actor, location) == nullptr, "%s registry: a face-down source blocks", id);
	source->current.position = POS_FACEUP_ATTACK;
	f.remove_unique_card(source);
	for(uint8_t p = 0; p < seats; ++p) EXPECT(f.core.unique_cards[p].count(source) == 0, "%s remove: source remains in seat %u registry", id, p);
	EXPECT(f.check_unique_onfield(candidate, actor, location) == nullptr, "%s remove: removed source still blocks", id);
	// Restore the candidate's own rule. This now tests the independent field scan.
	candidate->unique_code = code;
	EXPECT((f.check_unique_onfield(candidate, actor, location) != nullptr) == wantConflict, "%s scan: conflict does not match team", id);
	EXPECT(f.check_unique_onfield(candidate, actor, location, source) == nullptr, "%s scan: ignored source still blocks", id);
	for(uint8_t p = 0; p < seats; ++p) {
		EXPECT(f.player[p].list_mzone[1] && f.player[p].list_mzone[1]->data.code == kSentinel, "%s: sentinel of seat %u changed", id, p);
		EXPECT(f.player[p].list_grave.empty() && f.player[p].list_remove.empty(), "%s: grave or banishment of seat %u changed", id, p);
	}
	EXPECT(sd::stray_logs == 0, "%s: %d Lua error log(s)", id, sd::stray_logs);
	OCG_DestroyDuel(d);
}

int main() {
	sd::types[kMonster] = TYPE_MONSTER | TYPE_EFFECT;
	sd::types[kSpell] = TYPE_SPELL | TYPE_CONTINUOUS;
	sd::scripts[kMonster] = "local s,id=GetID() function s.initial_effect(c) c:SetUniqueOnField(1,0,id,LOCATION_MZONE) end";
	sd::scripts[kSpell] = "local s,id=GetID() function s.initial_effect(c) c:SetUniqueOnField(1,0,id,LOCATION_SZONE) end";
	for(uint32_t loc : { LOCATION_MZONE, LOCATION_SZONE }) {
		const std::string suffix = loc == LOCATION_MZONE ? "monster" : "spell";
		check(("unique-tag-team-0-partner-" + suffix).c_str(), 4, true, 0, 2, loc);
		check(("unique-tag-team-1-partner-" + suffix).c_str(), 4, true, 1, 3, loc);
		check(("unique-tag-opponent-" + suffix).c_str(), 4, true, 0, 3, loc);
		check(("unique-tag-both-sides-" + suffix).c_str(), 4, true, 0, 3, loc, true);
		check(("unique-ffa3-other-" + suffix).c_str(), 3, false, 0, 2, loc);
		check(("unique-ffa4-other-" + suffix).c_str(), 4, false, 1, 3, loc);
		check(("unique-ffa4-own-" + suffix).c_str(), 4, false, 3, 3, loc);
		check(("unique-n2-own-" + suffix).c_str(), 2, false, 0, 0, loc);
		check(("unique-n2-opponent-" + suffix).c_str(), 2, false, 0, 1, loc);
		check(("unique-n2-both-sides-" + suffix).c_str(), 2, false, 0, 1, loc, true);
	}
	std::printf("%s unique review: %d failure(s)\n", failures ? "FAIL" : "PASS", failures);
	return failures ? 1 : 0;
}
