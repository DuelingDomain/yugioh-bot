// Nightly fuzz n2/n3 seed 73 (2026-10-20): a card banished with REASON_TEMPORARY comes back after the effect that banished
// it was deleted. Time Chain (100463005) banishes from an EVENT_BATTLED effect that resets at the end of the Damage Phase;
// the return runs turns later. delete_effect (patch 0001) clears current.reason_effect, and MoveToField (ret = 1) read
// current.reason_effect->owner on that null pointer. Patch 0120 compares owners only while both effects exist.
// Scenario (stock scripts, no overlay): a Spell of seat 0 registers an End Phase effect "d" (reset at the end of that phase).
// "d" banishes the monster of seat 0 with REASON_TEMPORARY. After "d" is deleted, the next Standby Phase of seat 1 runs a
// second effect that calls Duel.ReturnToField. The monster must be back on the field of seat 0 and no Lua error may occur.
#include "scripted-duel.h"
#include "card.h"
static constexpr uint32_t kSpell = 91701;
static constexpr uint32_t kMonster = 91702;
static const char* kScript = R"LUA(local s,id=GetID()
function s.initial_effect(c)
	local e=Effect.CreateEffect(c)
	e:SetType(EFFECT_TYPE_ACTIVATE)
	e:SetCode(EVENT_FREE_CHAIN)
	e:SetOperation(s.op)
	c:RegisterEffect(e)
end
function s.op(e,tp)
	local c=e:GetHandler()
	local m=Duel.GetFirstMatchingCard(Card.IsCode,tp,LOCATION_MZONE,0,nil,91702)
	local d=Effect.CreateEffect(c)
	d:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
	d:SetCode(EVENT_PHASE+PHASE_END)
	d:SetCountLimit(1)
	d:SetOperation(function(e,tp)
		Duel.Remove(m,POS_FACEUP,REASON_EFFECT+REASON_TEMPORARY)
		Debug.Message("CHK removed "..m:GetLocation())
		local r=Effect.CreateEffect(c)
		r:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
		r:SetCode(EVENT_PHASE+PHASE_STANDBY)
		r:SetOperation(function(e,tp)
			if not m:IsLocation(LOCATION_REMOVED) then return end
			Debug.Message("CHK reason effect gone "..tostring(m:GetReasonEffect()==nil))
			Duel.ReturnToField(m)
			Debug.Message("CHK return called")
			e:Reset()
		end)
		Duel.RegisterEffect(r,tp)
	end)
	d:SetReset(RESET_PHASE+PHASE_END)
	Duel.RegisterEffect(d,tp)
end
)LUA";

static void flow(int n) {
	sd::types[kSpell] = TYPE_SPELL;
	sd::scripts[kSpell] = kScript;
	sd::stray_logs = 0;
	std::vector<std::string> lines;
	sd::on_line = [&](const std::string& t) { lines.push_back(t); };
	OCG_Duel d = sd::create(n == 2 ? "" : "Debug.SetupDuelists(3,0,1,2)");
	for(int p = 0; p < n; ++p)
		for(int i = 0; i < 30; ++i) sd::add(d, p, 5000, LOCATION_DECK);
	sd::add(d, 0, kSpell, LOCATION_HAND);
	sd::add(d, 0, kMonster, LOCATION_MZONE, POS_FACEUP_ATTACK);
	OCG_StartDuel(d);
	std::vector<sd::Msg> msgs;
	const sd::Msg* pm = nullptr;
	bool activated = false, done = false;
	for(int i = 0; i < 600 && !done; ++i) {
		const int st = sd::step(d, msgs, pm);
		for(const auto& t : lines) if(t == "CHK return called") done = true;
		if(done || st != OCG_DUEL_STATUS_AWAITING) continue;
		if(!pm) break;
		switch(pm->id) {
		case MSG_SELECT_IDLECMD:
			if(!activated) { sd::answer32(d, 5); activated = true; } else sd::answer32(d, 7);
			break;
		case MSG_SELECT_CHAIN: sd::answer32(d, -1); break;
		case MSG_SELECT_PLACE: {
			// u8 player, u8 count, u32 mask of zones that are NOT free: bits 0-6 monster zones, bits 8-12 spell and trap zones
			uint32_t mask = 0;
			std::memcpy(&mask, pm->p + 2, 4);
			uint8_t a[] = { pm->p[0], 0, 0 };
			for(uint8_t seq = 0; seq < 5 && !a[1]; ++seq)
				if(!(mask & (1u << seq))) { a[1] = LOCATION_MZONE; a[2] = seq; }
			for(uint8_t seq = 0; seq < 5 && !a[1]; ++seq)
				if(!(mask & (1u << (8 + seq)))) { a[1] = LOCATION_SZONE; a[2] = seq; }
			OCG_DuelSetResponse(d, a, sizeof(a));
			break;
		}
		case MSG_SELECT_YESNO: case MSG_SELECT_EFFECTYN: sd::answer32(d, 1); break;
		default: EXPECT(false, "n%d: unexpected prompt %u", n, pm->id); done = true;
		}
	}
	// The return is a queued step: let the core finish it, then read the field
	for(int i = 0; i < 20; ++i) {
		const int st = sd::step(d, msgs, pm);
		if(st != OCG_DUEL_STATUS_CONTINUE) break;
	}
	auto has = [&](const std::string& want) { for(const auto& t : lines) if(t == want) return true; return false; };
	EXPECT(has("CHK removed 32"), "n%d: the monster is banished by the End Phase effect", n);
	EXPECT(has("CHK reason effect gone true"), "n%d: the banishing effect was deleted before the return", n);
	EXPECT(sd::mzone_count(d, 0) == 1 && sd::F(d).player[0].list_remove.empty(), "n%d: the monster is back in a monster zone of seat 0", n);
	EXPECT(sd::stray_logs == 0, "n%d: Lua errors %d", n, sd::stray_logs);
	OCG_DestroyDuel(d);
	std::printf("ok temporary return after the banisher effect is gone: %d seats\n", n);
}
int main() {
	flow(2);
	flow(3);
	std::printf("%s temporary-return-banisher-gone: %d failure(s)\n", failures ? "FAIL" : "PASS", failures);
	return failures ? 1 : 0;
}
