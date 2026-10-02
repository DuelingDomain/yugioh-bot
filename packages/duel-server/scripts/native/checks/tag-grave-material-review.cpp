// Review 5c. Real Djinn and Magical Knight Dragon scripts register the extra-material effects.
// Calls the material builders with a registered Ritual Spell as the reason effect. Includes both Tag teams,
// FFA3, FFA4 and stock two-seat controls. Ordinary Graveyard monsters are never extra material.
#include "scripted-duel.h"
#include "card.h"
#include "effect.h"

static constexpr uint32_t DJINN = 77153811, MAGIC = 72064891, RITUAL = 55761792;
static constexpr uint32_t PLAIN = 5000, FILLER = 5001;

static card* in_grave(field& f, int seat, uint32_t code) {
	for(auto* c : f.player[seat].list_grave) if(c->data.code == code) return c;
	return nullptr;
}

static void run(const char* name, const std::string& setup, int n, int actor, bool tag) {
	sd::stray_logs = 0;
	sd::types[DJINN] = TYPE_MONSTER | TYPE_EFFECT;
	sd::types[MAGIC] = TYPE_MONSTER | TYPE_EFFECT | TYPE_FUSION;
	sd::types[RITUAL] = TYPE_SPELL | TYPE_RITUAL;
	OCG_Duel d = sd::create(setup, 1, n > 2);
	auto& f = sd::F(d);
	for(int q = 0; q < n; ++q) {
		for(int i = 0; i < 20; ++i) sd::add(d, q, FILLER, LOCATION_DECK);
		sd::add(d, q, DJINN, LOCATION_GRAVE, POS_FACEUP_ATTACK);
		sd::add(d, q, PLAIN, LOCATION_GRAVE, POS_FACEUP_ATTACK);
	}
	sd::add(d, actor, MAGIC, LOCATION_MZONE, POS_FACEUP_ATTACK);
	sd::add(d, actor, RITUAL, LOCATION_HAND);
	OCG_StartDuel(d);
	f.adjust_instant();
	card* spell = nullptr;
	for(auto* c : f.player[actor].list_hand) if(c->data.code == RITUAL) spell = c;
	effect* reason = nullptr;
	if(spell) for(auto& entry : spell->field_effect)
		if(entry.second->type & EFFECT_TYPE_ACTIVATE) reason = entry.second;
	EXPECT(reason != nullptr, "%s: real Black Luster Ritual has an activation effect", name);
	if(!reason) { OCG_DestroyDuel(d); return; }
	f.core.reason_effect = reason;
	f.core.reason_player = actor;
	card_set ritual, fusion;
	f.get_ritual_material(actor, reason, &ritual, true);
	f.get_fusion_material(actor, &fusion);
	int ritual_graves = 0, fusion_graves = 0;
	for(int q = 0; q < n; ++q) {
		card* djinn = in_grave(f, q, DJINN);
		card* plain = in_grave(f, q, PLAIN);
		const bool own = q == actor || (tag && q % 2 == actor % 2);
		EXPECT(djinn && djinn->is_affected_by_effect(EFFECT_EXTRA_RITUAL_MATERIAL), "%s: Djinn seat %d registers its real Graveyard effect", name, q);
		EXPECT(djinn && static_cast<bool>(ritual.count(djinn)) == own,
		       "%s: Ritual extra material seat %d is %d, want %d", name, q, djinn && ritual.count(djinn), own);
		EXPECT(plain && !ritual.count(plain), "%s: plain monster seat %d has no extra Ritual effect", name, q);
		EXPECT(djinn && static_cast<bool>(fusion.count(djinn)) == own,
		       "%s: Fusion extra material seat %d is %d, want %d", name, q, djinn && fusion.count(djinn), own);
		EXPECT(plain && static_cast<bool>(fusion.count(plain)) == own,
		       "%s: Magical Knight Dragon gives the GY monster seat %d extra Fusion material: got %d, want %d", name, q, plain && fusion.count(plain), own);
		EXPECT(plain && static_cast<bool>(plain->is_affected_by_effect(EFFECT_EXTRA_FUSION_MATERIAL)) == own,
		       "%s: real Magical Knight Dragon effect applies to seat %d on its side only", name, q);
		if(djinn && ritual.count(djinn)) ++ritual_graves;
		if(plain && fusion.count(plain)) ++fusion_graves;
		EXPECT(f.player[q].list_grave.size() == 2 && sd::mzone_count(d, q) == (q == actor ? 1 : 0)
		       && f.player[q].list_remove.empty() && f.lp_ref(q) == 8000,
		       "%s: the material query keeps the state of seat %d", name, q);
	}
	EXPECT(sd::stray_logs == 0, "%s: %d Lua errors", name, sd::stray_logs);
	std::printf("%s Ritual GY=%d Fusion GY=%d\n", name, ritual_graves, fusion_graves);
	f.core.reason_effect = nullptr;
	OCG_DestroyDuel(d);
}

int main() {
	run("grave-tag-team0", "Debug.SetupDuelists(4,0,1,0,1)", 4, 0, true);
	run("grave-tag-team1", "Debug.SetupDuelists(4,0,1,0,1)", 4, 1, true);
	run("grave-ffa3", "Debug.SetupDuelists(3,0,1,2)", 3, 0, false);
	run("grave-ffa4", "Debug.SetupDuelists(4,0,1,2,3)", 4, 0, false);
	run("grave-ffa4-late-seat", "Debug.SetupDuelists(4,0,1,2,3)", 4, 3, false);
	run("grave-1v1-seat0", "", 2, 0, false);
	run("grave-1v1-seat1", "", 2, 1, false);
	std::printf("%s tag-grave-material-review: %d failure(s)\n", failures ? "FAIL" : "PASS", failures);
	return failures ? 1 : 0;
}
