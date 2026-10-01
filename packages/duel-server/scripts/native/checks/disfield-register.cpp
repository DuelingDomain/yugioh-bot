// F9 native check: zone-disabling effects and the bound opponent (n = 3 and n = 4, free-for-all).
// A Spell of seat 0 reads the hand of "1" in its target check, so the F5 pick binds one opponent. The harness answers the
// pick with option 1, which is SEAT 2 (the second opponent), not seat 1: seat 1 is the next seat in turn order, so a
// wrong "first opponent" or "next seat" reading can not pass for the bound seat.
//   card        the target runs Duel.SelectDisableField(tp,1,0,MZONE,0); the operation registers an EFFECT_DISABLE_FIELD
//               effect with Card.RegisterEffect on a monster, SetOperation(function returns the label). Six official
//               scripts do this (c40669071, c53244294, ...). Review finding: Card.RegisterEffect did not record the
//               opponent of the prompt, so the zone went to the next living opponent (seat 1).
//   value       the same with Duel.RegisterEffect and SetValue(label)
//   card_dead, value_dead
//               the same, then seat 2 is eliminated after the chain (Debug.EliminateDuelist). Review finding: a recorded
//               opponent that is eliminated moved the zone to another seat. The zone must go to nobody (F5: no fallback).
//   dis, fz, sset
//               seat 2 is bound and then marked eliminated INSIDE the operation (the harness sets the flag when the
//               script prints "CHK kill"; a script can not do this by itself). SelectDisableField and SelectFieldZone must
//               open no zone and give no prompt (they return nothing); Duel.SSet toward the bound opponent returns 0 and sets
//               no card on any field (it must not fall back to the own field).
#include "scripted-duel.h"

static const uint32_t kFiller = 5000;
static const uint32_t kSpell = 91001;
static const uint32_t kTrap = 91002;
static const uint32_t kMonster = 91003;

static const char* kScript = R"LUA(
local s,id=GetID()
local V="@VARIANT@"
function s.initial_effect(c)
	local e1=Effect.CreateEffect(c)
	e1:SetType(EFFECT_TYPE_ACTIVATE)
	e1:SetCode(EVENT_FREE_CHAIN)
	e1:SetTarget(s.tg)
	e1:SetOperation(s.op)
	c:RegisterEffect(e1)
end
function s.tg(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return Duel.GetFieldGroupCount(tp,0,LOCATION_HAND)>0 end
	if V=="card" or V=="value" or V=="card_dead" or V=="value_dead" then
		local z=Duel.SelectDisableField(tp,1,0,LOCATION_MZONE,0)
		e:SetLabel(z)
	end
end
function s.disop(e,tp)
	return e:GetLabel()
end
function s.op(e,tp,eg,ep,ev,re,r,rp)
	local c=e:GetHandler()
	if V=="card" or V=="card_dead" then
		local m=Duel.GetFirstMatchingCard(Card.IsCode,tp,LOCATION_MZONE,0,nil,91003)
		local e1=Effect.CreateEffect(m)
		e1:SetType(EFFECT_TYPE_FIELD)
		e1:SetRange(LOCATION_MZONE)
		e1:SetCode(EFFECT_DISABLE_FIELD)
		e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)
		e1:SetOperation(s.disop)
		e1:SetLabel(e:GetLabel())
		m:RegisterEffect(e1)
		Debug.Message("CHK reg "..e:GetLabel())
	elseif V=="value" or V=="value_dead" then
		local e1=Effect.CreateEffect(c)
		e1:SetType(EFFECT_TYPE_FIELD)
		e1:SetCode(EFFECT_DISABLE_FIELD)
		e1:SetValue(e:GetLabel())
		Duel.RegisterEffect(e1,tp)
		Debug.Message("CHK reg "..e:GetLabel())
	elseif V=="dis" then
		Debug.Message("CHK kill")
		local z=Duel.SelectDisableField(tp,1,0,LOCATION_MZONE,0)
		Debug.Message("CHK z "..tostring(z))
	elseif V=="fz" then
		Debug.Message("CHK kill")
		local z=Duel.SelectFieldZone(tp,1,0,LOCATION_MZONE,0)
		Debug.Message("CHK z "..tostring(z))
	elseif V=="sset" then
		Debug.Message("CHK kill")
		local t=Duel.GetFieldGroup(tp,LOCATION_HAND,0):Filter(Card.IsType,nil,TYPE_TRAP):GetFirst()
		Debug.Message("CHK sset "..tostring(Duel.SSet(tp,t,1)))
	end
end
)LUA";

static OCG_Duel g_d = nullptr;
static int g_kill_seat = 2;
static std::vector<std::string> g_lines;

struct Result {
	bool ok = false;
	int place_prompts = 0, hint_seat = -1, place_who = -1;
	uint32_t dis[4] = { 0, 0, 0, 0 };        // disabled_location (low 16 bits) of each seat at the idle prompt after the chain
	uint32_t dis_later[4] = { 0, 0, 0, 0 };  // the same two turns later (variants with an elimination after the chain)
	int szone[4] = { 0, 0, 0, 0 };
	std::string z, sset;
};

static Result play(int n, const std::string& variant) {
	std::string text = kScript;
	text.replace(text.find("@VARIANT@"), 9, variant);
	sd::scripts[kSpell] = text;
	sd::scripts[kTrap] = sd::scripts[kMonster] = "local s,id=GetID()\nfunction s.initial_effect(c) end\n";
	sd::types[kSpell] = TYPE_SPELL;
	sd::types[kTrap] = TYPE_TRAP;
	sd::stray_logs = 0;
	g_lines.clear();
	Result r;
	OCG_Duel d = sd::create(n == 3 ? "Debug.SetupDuelists(3,0,1,2)" : "Debug.SetupDuelists(4,0,1,2,3)");
	g_d = d;
	sd::on_line = [&](const std::string& t) {
		g_lines.push_back(t);
		if(t == "CHK kill") sd::F(d).player[g_kill_seat].eliminated = true;
		if(t.compare(0, 6, "CHK z ") == 0) r.z = t.substr(6);
		if(t.compare(0, 9, "CHK sset ") == 0) r.sset = t.substr(9);
	};
	for(int p = 0; p < n; ++p) {
		for(int i = 0; i < 30; ++i) sd::add(d, static_cast<uint8_t>(p), kFiller, LOCATION_DECK);
		for(int i = 0; i < 2; ++i) sd::add(d, static_cast<uint8_t>(p), kFiller, LOCATION_HAND);
	}
	sd::add(d, 0, kSpell, LOCATION_HAND);
	sd::add(d, 0, kTrap, LOCATION_HAND);
	sd::add(d, 0, kMonster, LOCATION_MZONE, POS_FACEUP_ATTACK);
	OCG_StartDuel(d);
	const bool dead_after = variant == "card_dead" || variant == "value_dead";
	std::vector<sd::Msg> msgs;
	const sd::Msg* pm = nullptr;
	int stage = 0;  // 0 = activate, 1 = chain is over and read, 2 = elimination sent, 3 = done
	int idles_after = 0;
	for(int steps = 0; steps < 600 && stage < 3; ++steps) {
		const int status = sd::step(d, msgs, pm);
		if(status == OCG_DUEL_STATUS_END) break;
		if(status != OCG_DUEL_STATUS_AWAITING) continue;
		if(!pm) {
			std::printf("FAIL: awaiting without a prompt, messages:");
			for(const auto& x : msgs) std::printf(" %u", x.id);
			std::printf("\n");
			++failures;
			break;
		}
		auto& f = sd::F(d);
		if(std::getenv("CHECK_LOG")) std::fprintf(stderr, "prompt %u seat %d\n", pm->id, pm->p[0]);
		switch(pm->id) {
		case MSG_SELECT_IDLECMD:
			if(stage == 0) {
				sd::answer32(d, 5);  // the Spell is the only activatable card
				stage = 1;
			} else if(stage == 1) {
				for(int p = 0; p < n; ++p) {
					r.dis[p] = f.player[p].disabled_location & 0xffff;
					r.szone[p] = sd::szone_count(d, p);
				}
				if(dead_after) {
					sd::lua(d, "Debug.EliminateDuelist(2,4)");
					stage = 2;
					sd::answer32(d, 7);
				} else {
					r.ok = true;
					stage = 3;
				}
			} else {
				if(++idles_after == 2) {
					for(int p = 0; p < n; ++p) r.dis_later[p] = f.player[p].disabled_location & 0xffff;
					r.ok = true;
					stage = 3;
				}
				sd::answer32(d, 7);
			}
			break;
		case MSG_SELECT_OPTION:
			sd::answer32(d, 1);  // the second living opponent: seat 2
			break;
		case MSG_SELECT_CHAIN:
			sd::answer32(d, -1);
			break;
		case MSG_SELECT_CARD: {
			uint32_t min = 0;
			std::memcpy(&min, pm->p + 2, 4);
			std::vector<uint32_t> rr{ 0, min };
			for(uint32_t i = 0; i < min; ++i) rr.push_back(i);
			OCG_DuelSetResponse(d, rr.data(), static_cast<uint32_t>(rr.size() * 4));
			break;
		}
		case MSG_SELECT_PLACE: case MSG_SELECT_DISFIELD: {
			uint32_t flag = 0;
			std::memcpy(&flag, pm->p + 2, 4);
			int seat = pm->p[0];
			int hint = -1;
			if(msgs.size() >= 2) {
				const sd::Msg& h = msgs[msgs.size() - 2];
				if(h.id == MSG_HINT && h.len >= 10 && h.p[0] == HINT_PLACE_SEAT) {
					uint64_t t = 0;
					std::memcpy(&t, h.p + 2, 8);
					hint = static_cast<int>(t);
					seat = hint;
				}
			}
			if(hint >= 0) {  // a prompt of a call under test
				++r.place_prompts;
				r.place_who = pm->p[0];
				r.hint_seat = hint;
			}
			// the activation of the Spell asks for a Spell zone of the own field (no hint, low half open): not a call under test
			const bool own_prompt = hint < 0 || seat == pm->p[0];
			const int base = own_prompt ? 0 : 16;
			uint8_t loc = LOCATION_MZONE, seq = 0;
			for(int i = 0; i < 13; ++i) {
				if(i == 7) continue;
				if(!(flag & (1u << (base + i)))) {
					loc = i < 8 ? LOCATION_MZONE : LOCATION_SZONE;
					seq = static_cast<uint8_t>(i < 8 ? i : i - 8);
					break;
				}
			}
			const uint8_t resp[3] = { static_cast<uint8_t>(seat), loc, seq };
			if(std::getenv("CHECK_LOG")) std::fprintf(stderr, "place flag %08x hint %d -> seat %d seq %d\n", flag, hint, seat, seq);
			OCG_DuelSetResponse(d, resp, sizeof(resp));
			break;
		}
		case MSG_SELECT_YESNO: case MSG_SELECT_EFFECTYN: sd::answer32(d, 0); break;
		default:
			std::printf("FAIL: unexpected prompt %u\n", pm->id);
			++failures;
			stage = 3;
		}
	}
	if(variant == "sset") {
		for(int p = 0; p < n; ++p) r.szone[p] = sd::szone_count(d, p);
	}
	sd::on_line = nullptr;
	g_d = nullptr;
	OCG_DestroyDuel(d);
	return r;
}

int main() {
	for(int n : { 3, 4 }) {
		// ---- card and value: the zone goes to the bound opponent (seat 2) only
		for(const char* v : { "card", "value" }) {
			const Result r = play(n, v);
			EXPECT(r.ok, "n=%d %s: the scenario did not finish", n, v);
			EXPECT(r.place_who == 0 && r.hint_seat == 2, "n=%d %s: place prompt of seat %d with hint seat %d, want seat 0 and hint 2", n, v, r.place_who, r.hint_seat);
			EXPECT(r.dis[2] == 0x1, "n=%d %s: seat 2 has disabled zones %04x, want 0001", n, v, r.dis[2]);
			EXPECT(r.dis[0] == 0 && r.dis[1] == 0 && (n < 4 || r.dis[3] == 0), "n=%d %s: other seats have disabled zones %04x %04x %04x, want 0", n, v, r.dis[0], r.dis[1], n == 4 ? r.dis[3] : 0);
			EXPECT(sd::stray_logs == 0, "n=%d %s: %d unexpected core log line(s)", n, v, sd::stray_logs);
			std::printf("ok   n=%d %s: disabled zones seat0..%d = %04x %04x %04x%s\n", n, v, n - 1, r.dis[0], r.dis[1], r.dis[2], n == 4 ? "" : "");
		}
		// ---- the bound opponent is eliminated after the registration: the zone goes to nobody
		for(const char* v : { "card_dead", "value_dead" }) {
			const Result r = play(n, v);
			EXPECT(r.ok, "n=%d %s: the scenario did not finish", n, v);
			EXPECT(r.dis[2] == 0x1, "n=%d %s: before the elimination seat 2 has disabled zones %04x, want 0001", n, v, r.dis[2]);
			for(int p = 0; p < n; ++p)
				if(p != 2)
					EXPECT(r.dis_later[p] == 0, "n=%d %s: after the elimination of seat 2 seat %d has disabled zones %04x, want 0", n, v, p, r.dis_later[p]);
			EXPECT(sd::stray_logs == 0, "n=%d %s: %d unexpected core log line(s)", n, v, sd::stray_logs);
			std::printf("ok   n=%d %s: after the elimination seats 0,1,3 have %04x %04x %04x\n", n, v, r.dis_later[0], r.dis_later[1], r.dis_later[3]);
		}
		// ---- the bound opponent is eliminated inside the operation: no prompt, no zone, no card
		for(const char* v : { "dis", "fz" }) {
			const Result r = play(n, v);
			EXPECT(r.ok, "n=%d %s: the scenario did not finish", n, v);
			EXPECT(r.place_prompts == 0, "n=%d %s: %d place prompt(s) for a dead bound opponent (hint seat %d, prompt seat %d), want none", n, v, r.place_prompts, r.hint_seat, r.place_who);
			EXPECT(r.z == "nil", "n=%d %s: the call returned '%s', want nothing (nil: no zone is open)", n, v, r.z.c_str());
			std::printf("ok   n=%d %s: dead bound opponent, %d prompts, result %s\n", n, v, r.place_prompts, r.z.c_str());
		}
		{
			const Result r = play(n, "sset");
			EXPECT(r.ok, "n=%d sset: the scenario did not finish", n);
			EXPECT(r.sset == "0", "n=%d sset: Duel.SSet returned '%s', want 0", n, r.sset.c_str());
			int total = 0;
			for(int p = 0; p < n; ++p) total += r.szone[p];
			EXPECT(total == 0, "n=%d sset: %d card(s) set on the fields (seat 0: %d, seat 1: %d, seat 2: %d), want none", n, total, r.szone[0], r.szone[1], r.szone[2]);
			std::printf("ok   n=%d sset toward a dead bound opponent: result %s, %d cards set\n", n, r.sset.c_str(), total);
		}
	}
	std::printf("%s: %d failure(s)\n", failures ? "FAIL" : "PASS", failures);
	return failures ? 1 : 0;
}
