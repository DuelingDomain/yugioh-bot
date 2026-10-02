// Review 5b: only own/team ownership bypasses cannot-change-control for REASON_EFFECT.
// The official-card live scenarios prove the Gabonga trigger, target list, attach, and all seats.
#include "scripted-duel.h"
#include "card.h"
#include "effect.h"

static constexpr uint32_t kXyz = 99006111, kLocked = 99006112, kFree = 99006113, kToken = 99006114;

static void check(const char* id, int seats, bool tag, uint8_t actor, uint8_t materialSeat, bool locked, bool want) {
	const std::string setup = seats == 2 ? "" : tag ? "Debug.SetupDuelists(4,0,1,0,1)" : seats == 3 ? "Debug.SetupDuelists(3,0,1,2)" : "Debug.SetupDuelists(4,0,1,2,3)";
	sd::stray_logs = 0;
	OCG_Duel d = sd::create(setup);
	sd::add(d, actor, kXyz, LOCATION_MZONE, POS_FACEUP_ATTACK);
	const uint32_t code = locked ? kLocked : kFree;
	sd::add(d, materialSeat, code, LOCATION_MZONE, POS_FACEUP_ATTACK, 1);
	for(uint8_t p = 0; p < seats; ++p) sd::add(d, p, kFree, LOCATION_MZONE, POS_FACEUP_ATTACK, 2);
	auto& f = sd::F(d);
	card* xyz = f.player[actor].list_mzone[0];
	card* material = f.player[materialSeat].list_mzone[1];
	material->enable_field_effect(true);
	EXPECT((material->is_capable_change_control() != 0) == !locked, "%s: material control restriction is not active", id);
	EXPECT((material->is_can_be_xyz_material(xyz, actor, REASON_EFFECT) != 0) == want, "%s: REASON_EFFECT gave %d, want %d", id, material->is_can_be_xyz_material(xyz, actor, REASON_EFFECT), want);
	// Material use has a separate branch and must remain legal despite the control restriction.
	EXPECT(material->is_can_be_xyz_material(xyz, actor, REASON_XYZ | REASON_MATERIAL) != 0, "%s: summon material changed", id);
	EXPECT(xyz->is_can_be_xyz_material(xyz, actor, REASON_EFFECT) == 0, "%s: an Xyz card is its own material", id);
	sd::add(d, materialSeat, kToken, LOCATION_MZONE, POS_FACEUP_ATTACK, 3);
	EXPECT(f.player[materialSeat].list_mzone[3]->is_can_be_xyz_material(xyz, actor, REASON_EFFECT) == 0, "%s: token accepted as material", id);
	for(uint8_t p = 0; p < seats; ++p) {
		EXPECT(f.player[p].list_mzone[2] && f.player[p].list_mzone[2]->data.code == kFree, "%s: sentinel of seat %u changed", id, p);
		EXPECT(f.player[p].list_grave.empty() && f.player[p].list_remove.empty(), "%s: grave or banishment of seat %u changed", id, p);
	}
	EXPECT(sd::stray_logs == 0, "%s: %d Lua error log(s)", id, sd::stray_logs);
	OCG_DestroyDuel(d);
}

int main() {
	sd::types[kXyz] = TYPE_MONSTER | TYPE_EFFECT | TYPE_XYZ;
	sd::types[kLocked] = TYPE_MONSTER | TYPE_EFFECT;
	sd::types[kToken] = TYPE_MONSTER | TYPE_NORMAL | TYPE_TOKEN;
	sd::scripts[kXyz] = "local s,id=GetID() function s.initial_effect(c) end";
	sd::scripts[kLocked] = R"LUA(local s,id=GetID()
function s.initial_effect(c)
 local e=Effect.CreateEffect(c)
 e:SetType(EFFECT_TYPE_SINGLE)
 e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
 e:SetRange(LOCATION_MZONE)
 e:SetCode(EFFECT_CANNOT_CHANGE_CONTROL)
 c:RegisterEffect(e)
end)LUA";
	check("xyz-tag-team-0-partner-locked", 4, true, 0, 2, true, true);
	check("xyz-tag-team-1-partner-locked", 4, true, 1, 3, true, true);
	check("xyz-tag-team-0-own-locked", 4, true, 0, 0, true, true);
	check("xyz-tag-team-1-own-locked", 4, true, 1, 1, true, true);
	check("xyz-tag-opponent-locked", 4, true, 0, 3, true, false);
	check("xyz-tag-opponent-free", 4, true, 0, 3, false, true);
	check("xyz-ffa3-other-locked", 3, false, 0, 2, true, false);
	check("xyz-ffa4-other-locked", 4, false, 1, 3, true, false);
	check("xyz-ffa4-own-locked", 4, false, 3, 3, true, true);
	check("xyz-ffa4-other-free", 4, false, 1, 3, false, true);
	check("xyz-n2-own-locked", 2, false, 0, 0, true, true);
	check("xyz-n2-opponent-locked", 2, false, 0, 1, true, false);
	check("xyz-n2-opponent-free", 2, false, 0, 1, false, true);
	std::printf("%s Xyz attach review: %d failure(s)\n", failures ? "FAIL" : "PASS", failures);
	return failures ? 1 : 0;
}
