// Review 5d. Register the real EFFECT_SELF_ATTACK player effect, then call get_attack_target.
// Each target is checked by card pointer and seat. The attacker is excluded. Both Tag teams, FFA3,
// FFA4 and stock two-seat rules are tested, with effect/no-effect and EFFECT_ATTACK_ALL controls.
#include "scripted-duel.h"
#include "card.h"
#include "effect.h"

static constexpr uint32_t ATTACKER = 5000, TARGET = 5001, FILLER = 5002;

static void run(const char* name, const std::string& setup, int n, int actor, bool tag, bool enabled, bool all = false) {
	sd::stray_logs = 0;
	OCG_Duel d = sd::create(setup);
	auto& f = sd::F(d);
	for(int q = 0; q < n; ++q) {
		for(int i = 0; i < 20; ++i) sd::add(d, q, FILLER, LOCATION_DECK);
		sd::add(d, q, TARGET, LOCATION_MZONE, POS_FACEUP_ATTACK);
	}
	sd::add(d, actor, ATTACKER, LOCATION_MZONE, POS_FACEUP_ATTACK, 1);
	if(enabled) sd::lua(d,
		"local e=Effect.GlobalEffect() e:SetType(EFFECT_TYPE_FIELD) e:SetCode(EFFECT_SELF_ATTACK) "
		"e:SetProperty(EFFECT_FLAG_PLAYER_TARGET) e:SetTargetRange(1,0) Duel.RegisterEffect(e," + std::to_string(actor) + ")");
	if(all) sd::lua(d,
		"local c=Duel.GetFieldGroup(" + std::to_string(actor) + ",LOCATION_MZONE,0):Filter(Card.IsCode,nil,5000):GetFirst() "
		"local e=Effect.CreateEffect(c) e:SetType(EFFECT_TYPE_SINGLE) e:SetCode(EFFECT_ATTACK_ALL) e:SetValue(1) c:RegisterEffect(e)");
	OCG_StartDuel(d);
	f.adjust_instant();
	card* attacker = f.player[actor].list_mzone[1];
	EXPECT(attacker && attacker->data.code == ATTACKER, "%s: real attacker", name);
	EXPECT(static_cast<bool>(f.is_player_affected_by_effect(actor, EFFECT_SELF_ATTACK)) == enabled, "%s: registered self attack effect is %d", name, enabled);
	f.core.attacker = attacker;
	card_vector targets;
	f.get_attack_target(attacker, &targets, false, true);
	EXPECT(std::find(targets.begin(), targets.end(), attacker) == targets.end(), "%s: the attacker cannot attack itself", name);
	int want_count = 0;
	for(int q = 0; q < n; ++q) {
		const bool own = q == actor || (tag && q % 2 == actor % 2);
		const bool want = !own || (enabled && !all);
		card* target = f.player[q].list_mzone[0];
		const bool got = std::find(targets.begin(), targets.end(), target) != targets.end();
		EXPECT(got == want, "%s: target seat %d is %d, want %d", name, q, got, want);
		want_count += want;
		EXPECT(sd::mzone_count(d, q) == (q == actor ? 2 : 1) && f.player[q].list_grave.empty()
		       && f.player[q].list_remove.empty() && f.lp_ref(q) == 8000,
		       "%s: target query keeps the state of seat %d", name, q);
	}
	EXPECT(static_cast<int>(targets.size()) == want_count, "%s: target count %zu, want %d", name, targets.size(), want_count);
	EXPECT(sd::stray_logs == 0, "%s: %d Lua errors", name, sd::stray_logs);
	std::printf("%s targets=%zu want=%d\n", name, targets.size(), want_count);
	f.core.attacker = nullptr;
	OCG_DestroyDuel(d);
}

int main() {
	for(bool enabled : {false, true}) {
		run(enabled ? "self-tag-team0" : "self-tag-team0-no-effect", "Debug.SetupDuelists(4,0,1,0,1)", 4, 0, true, enabled);
		run(enabled ? "self-tag-team1" : "self-tag-team1-no-effect", "Debug.SetupDuelists(4,0,1,0,1)", 4, 1, true, enabled);
		run(enabled ? "self-ffa3" : "self-ffa3-no-effect", "Debug.SetupDuelists(3,0,1,2)", 3, 0, false, enabled);
		run(enabled ? "self-ffa4" : "self-ffa4-no-effect", "Debug.SetupDuelists(4,0,1,2,3)", 4, 0, false, enabled);
		run(enabled ? "self-ffa4-late-seat" : "self-ffa4-late-seat-no-effect", "Debug.SetupDuelists(4,0,1,2,3)", 4, 3, false, enabled);
		run(enabled ? "self-1v1" : "self-1v1-no-effect", "", 2, 0, false, enabled);
	}
	run("self-tag-team0-attack-all", "Debug.SetupDuelists(4,0,1,0,1)", 4, 0, true, true, true);
	run("self-tag-team1-attack-all", "Debug.SetupDuelists(4,0,1,0,1)", 4, 1, true, true, true);
	run("self-ffa4-attack-all", "Debug.SetupDuelists(4,0,1,2,3)", 4, 0, false, true, true);
	run("self-1v1-attack-all", "", 2, 0, false, true, true);
	std::printf("%s tag-self-attack-review: %d failure(s)\n", failures ? "FAIL" : "PASS", failures);
	return failures ? 1 : 0;
}
