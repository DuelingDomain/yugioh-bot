// F9 native check: Duel.SSet toward the bound opponent (n = 3 and n = 4).
// A Spell of seat 0 reads the hand of "1" (the F5 pick binds one opponent), then runs Duel.SSet(tp, Trap, 1): toplayer 1
// is the bound opponent. The harness answers the pick with option 1: SEAT 2, the second opponent, not seat 1 (the next
// seat in turn order), so the Trap can only land on seat 2 when the core uses the bound seat and not the turn order.
// Control: the Trap lands on seat 2 (the place prompt goes to the setter). Loss case: the host eliminates seat 2 while
// the chain waits for answers (Debug.EliminateDuelist; the loss is applied only after the chain, so the operation still
// sees a living seat 2). The elimination must then leave no card on the field of the dead seat. A bound opponent that
// is eliminated BEFORE the operation (SSet returns 0 and sets nothing, no fallback to the own field) is in
// disfield-register, variant sset.
#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>
#include "ocgapi.h"
#include "ocgapi_constants.h"
#include "duel.h"
#include "field.h"
#include "card.h"
#include "common.h"

static const uint32_t kFiller = 5000;   // deck and hand filler
static const uint32_t kSpell = 91001;   // reads the hand of the bound opponent, then SSets a Trap with toplayer 1
static const uint32_t kTrap = 91002;    // the Trap that is set

static const char* kSpellScript = R"LUA(
local s,id=GetID()
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
end
function s.op(e,tp,eg,ep,ev,re,r,rp)
	local t=Duel.GetFieldGroup(tp,LOCATION_HAND,0):Filter(Card.IsType,nil,TYPE_TRAP):GetFirst()
	Debug.Message("SSET "..tostring(Duel.SSet(tp,t,1)))
end
)LUA";

static void read_card(void*, uint32_t code, OCG_CardData* data) {
	std::memset(data, 0, sizeof(*data));
	data->code = code;
	data->type = code == kSpell ? TYPE_SPELL : code == kTrap ? TYPE_TRAP : (TYPE_MONSTER | TYPE_NORMAL);
	data->level = 4;
	data->attribute = 1;
	data->race = 1;
	data->attack = 1000;
	data->defense = 1000;
}
static int g_lua_errors = 0;
static int read_script(void*, OCG_Duel duel, const char* name) {
	std::string n(name);
	std::replace(n.begin(), n.end(), '\\', '/');
	const auto slash = n.find_last_of('/');
	const std::string base = slash == std::string::npos ? n : n.substr(slash + 1);
	std::string text;
	if(base == "c91001.lua") {
		text = kSpellScript;
	} else {
		const std::string dir = check_scripts_dir();
		for(const std::string root : { dir + "/", dir + "/official/", dir + "/pre-release/" }) {
			std::ifstream in(root + base, std::ios::binary);
			if(!in) continue;
			std::stringstream buf;
			buf << in.rdbuf();
			text = buf.str();
			break;
		}
		if(text.empty()) return 0;
	}
	return OCG_LoadScript(duel, text.data(), static_cast<uint32_t>(text.size()), name);
}
static void on_log(void*, const char* text, int) {
	const std::string t = text ? text : "";
	if(t.find("SSET ") == std::string::npos && t.find("CallCardFunction") == std::string::npos && t.find("F5 ") == std::string::npos)
		++g_lua_errors;
	if(std::getenv("CHECK_LOG"))
		std::fprintf(stderr, "core log: %s\n", t.c_str());
}
static field& F(OCG_Duel d) { return *static_cast<duel*>(d)->game_field; }
static void run_lua(OCG_Duel d, const std::string& code) {
	if(!OCG_LoadScript(d, code.c_str(), static_cast<uint32_t>(code.size()), "zone-seat-sset.lua")) {
		++failures;
		std::printf("FAIL: lua error in: %s\n", code.c_str());
	}
}
static void add_one(OCG_Duel d, uint8_t p, uint32_t code, uint32_t loc, uint32_t pos) {
	OCG_NewCardInfo info;
	std::memset(&info, 0, sizeof(info));
	info.team = p; info.con = p; info.code = code; info.loc = loc; info.seq = 0; info.pos = pos;
	OCG_DuelNewCard(d, &info);
}
static int count_szone(OCG_Duel d, int seat) {
	int n = 0;
	for(auto* c : F(d).player[seat].list_szone) n += c != nullptr;
	return n;
}

struct Result { int on_bound = 0, on_setter = 0, on_others = 0, ok = 0, dead_at_end = 0, sset_msgs = 0; };
// kill = the host eliminates seat 2 (the bound opponent) at the first chain window of another seat.
static Result play(int n, bool kill) {
	OCG_DuelOptions options;
	std::memset(&options, 0, sizeof(options));
	options.seed[0] = 1; options.seed[1] = 2; options.seed[2] = 3; options.seed[3] = 4;
	options.flags = DUEL_MODE_MR5;
	options.team1 = {8000, 5, 1};
	options.team2 = {8000, 5, 1};
	options.cardReader = read_card;
	options.scriptReader = read_script;
	options.logHandler = on_log;
	OCG_Duel d = nullptr;
	if(OCG_CreateDuel(&d, &options) != OCG_DUEL_CREATION_SUCCESS) {
		std::printf("FAIL: OCG_CreateDuel\n");
		std::exit(2);
	}
	for(const char* name : { "constant.lua", "utility.lua" })
		if(!read_script(nullptr, d, name)) {
			std::printf("FAIL: script %s not found\n", name);
			std::exit(2);
		}
	run_lua(d, n == 3 ? "Debug.SetupDuelists(3,0,1,2)" : "Debug.SetupDuelists(4,0,1,2,3)");
	for(int p = 0; p < n; ++p) {
		for(int i = 0; i < 40; ++i) add_one(d, static_cast<uint8_t>(p), kFiller, LOCATION_DECK, POS_FACEDOWN_DEFENSE);
		for(int i = 0; i < 2; ++i) add_one(d, static_cast<uint8_t>(p), kFiller, LOCATION_HAND, POS_FACEDOWN_DEFENSE);
	}
	add_one(d, 0, kSpell, LOCATION_HAND, POS_FACEDOWN_DEFENSE);
	add_one(d, 0, kTrap, LOCATION_HAND, POS_FACEDOWN_DEFENSE);
	OCG_StartDuel(d);
	Result r;
	bool killed = !kill, activated = false, done = false;
	for(int steps = 0; steps < 400 && !done; ++steps) {
		const int status = OCG_DuelProcess(d);
		uint32_t length = 0;
		const auto* buf = static_cast<const uint8_t*>(OCG_DuelGetMessage(d, &length));
		struct M { uint8_t id; const uint8_t* p; uint32_t len; };
		std::vector<M> msgs;
		for(uint32_t off = 0; off + 4 <= length;) {
			uint32_t size = 0;
			std::memcpy(&size, buf + off, 4);
			if(size > 0) msgs.push_back({ buf[off + 4], buf + off + 5, size - 1 });
			off += 4 + size;
		}
		if(status == OCG_DUEL_STATUS_END) break;
		if(status != OCG_DUEL_STATUS_AWAITING) continue;
		const M* pm = nullptr;
		for(const auto& x : msgs)
			if(x.id >= 10 && x.id <= 27 && x.id != 17) pm = &x;
		if(!pm) { std::printf("FAIL: awaiting without a prompt\n"); ++failures; break; }
		const M& m = *pm;
		const int who = m.p[0];
		auto answer32 = [&](int32_t v) { OCG_DuelSetResponse(d, &v, sizeof(v)); };
		if(std::getenv("CHECK_LOG")) std::fprintf(stderr, "prompt %u seat %d\n", m.id, who);
		switch(m.id) {
		case MSG_SELECT_IDLECMD:
			if(!activated) {
				// the Spell is the only activatable card: activate it (index 0)
				answer32(5);
				activated = true;
			} else {
				done = true; // the chain is over
			}
			break;
		case MSG_SELECT_OPTION:
			answer32(1); // the second living opponent: seat 2 (seat 1 is the next seat in turn order)
			break;
		case MSG_SELECT_CHAIN:
			if(!killed && who != 0) {
				run_lua(d, "Debug.EliminateDuelist(2,4)");
				killed = true;
			}
			answer32(-1);
			break;
		case MSG_SELECT_PLACE: {
			uint32_t flag = 0;
			std::memcpy(&flag, m.p + 2, 4);
			// the low half of the flag is the field of the chooser, the high half the field of the other seat
			const bool own = (flag & 0x1f00) != 0x1f00;
			uint8_t seq = 0;
			for(int i = 8; i < 13; ++i)
				if(!(flag & (1u << (own ? i : 16 + i)))) { seq = static_cast<uint8_t>(i - 8); break; }
			const uint8_t resp[3] = { static_cast<uint8_t>(own ? who : 2), LOCATION_SZONE, seq };
			if(std::getenv("CHECK_LOG")) std::fprintf(stderr, "place who %d flag %08x -> seat %d seq %d\n", who, flag, resp[0], seq);
			OCG_DuelSetResponse(d, resp, sizeof(resp));
			break;
		}
		case MSG_SELECT_CARD: {
			uint32_t min = 0;
			std::memcpy(&min, m.p + 2, 4);
			std::vector<uint32_t> rr{ 0, min };
			for(uint32_t i = 0; i < min; ++i) rr.push_back(i);
			OCG_DuelSetResponse(d, rr.data(), static_cast<uint32_t>(rr.size() * 4));
			break;
		}
		case MSG_SELECT_YESNO: case MSG_SELECT_EFFECTYN: answer32(0); break;
		default:
			std::printf("FAIL: unexpected prompt %u (seat %d)\n", m.id, who);
			++failures;
			done = true;
		}
	}
	r.ok = done;
	r.dead_at_end = !F(d).is_alive(2);
	r.on_setter = count_szone(d, 0);
	r.on_bound = count_szone(d, 2);
	for(int p = 1; p < n; ++p)
		if(p != 2) r.on_others += count_szone(d, p);
	OCG_DestroyDuel(d);
	return r;
}

int main(int argc, char**) {
	(void)argc;
	for(int n : { 3, 4 }) {
		g_lua_errors = 0;
		const Result a = play(n, true);
		EXPECT(a.ok, "n=%d bound opponent eliminated: the chain never ended", n);
		EXPECT(a.dead_at_end, "n=%d bound opponent eliminated: seat 2 is still alive at the end (the scenario did not kill it)", n);
		EXPECT(a.on_bound == 0, "n=%d bound opponent eliminated: %d card(s) left on the field of the dead seat", n, a.on_bound);
		EXPECT(a.on_others == 0, "n=%d bound opponent eliminated: %d card(s) on other seats", n, a.on_others);
		std::printf("ok   n=%d bound opponent eliminated: dead seat %d card(s), setter %d, others %d\n", n, a.on_bound, a.on_setter, a.on_others);
		const Result b = play(n, false);
		EXPECT(b.ok, "n=%d living bound opponent: the chain never ended", n);
		EXPECT(b.on_bound == 1, "n=%d living bound opponent: seat 2 has %d card(s), want 1", n, b.on_bound);
		EXPECT(b.on_setter == 0 && b.on_others == 0, "n=%d living bound opponent: %d on the setter, %d on other seats", n, b.on_setter, b.on_others);
		std::printf("ok   n=%d living bound opponent: seat 2 %d, setter %d\n", n, b.on_bound, b.on_setter);
		EXPECT(g_lua_errors == 0, "n=%d: %d unexpected core log line(s)", n, g_lua_errors);
	}
	std::printf("%s: %d failure(s)\n", failures ? "FAIL" : "PASS", failures);
	return failures ? 1 : 0;
}
