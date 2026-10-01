// T9 native check: seats 2 and 3 are real seats (n = 3 and n = 4), PLAYER_NONE and PLAYER_ALL are not.
// Links a non-trap core (the gate's lib). Modes: check (all), hash (print the n = 2 hash, for a B2 compare).
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include "ocgapi.h"
#include "ocgapi_constants.h"
#include "effect_constants.h"
#include "duel.h"
#include "field.h"
#include "card.h"
#include "common.h"

#ifdef BASE // compiled against the B2 tree (no none_id/all_id): the expected values are written as constants
#define NONE_ID(f, n) ((n) == 2 ? 2 : 0xFF)
#define ALL_ID(f, n) ((n) == 2 ? 3 : 0xFE)
#else
#define NONE_ID(f, n) ((f).none_id())
#define ALL_ID(f, n) ((f).all_id())
#endif
static std::vector<std::string> logs;

static void read_card(void*, uint32_t code, OCG_CardData* data) {
	std::memset(data, 0, sizeof(*data));
	data->code = code;
	if(code == 89431) { // a Field Spell
		data->type = TYPE_SPELL | TYPE_FIELD;
		return;
	}
	data->type = TYPE_MONSTER | TYPE_NORMAL;
	data->level = 4;
	data->attribute = 1;
	data->race = 1;
	data->attack = 1000;
	data->defense = 1000;
}
static int read_script(void*, OCG_Duel, const char*) { return 0; }
static void on_log(void*, const char* text, int) { logs.push_back(text ? text : ""); }

static OCG_Duel make_duel(uint32_t seed = 1) {
	OCG_DuelOptions options;
	std::memset(&options, 0, sizeof(options));
	options.seed[0] = seed; options.seed[1] = 2; options.seed[2] = 3; options.seed[3] = 4;
	options.flags = DUEL_MODE_MR5;
	options.team1 = {8000, 5, 1};
	options.team2 = {8000, 5, 1};
	options.cardReader = read_card;
	options.scriptReader = read_script;
	options.logHandler = on_log;
	OCG_Duel duel = nullptr;
	if(OCG_CreateDuel(&duel, &options) != OCG_DUEL_CREATION_SUCCESS) { std::printf("FAIL: OCG_CreateDuel\n"); std::exit(2); }
	return duel;
}
static field& F(OCG_Duel d) { return *static_cast<duel*>(d)->game_field; }
static bool run_lua(OCG_Duel d, const std::string& code) {
	logs.clear();
	static const std::string pre = // no constant.lua is loaded: define what the snippets use
		"LOCATION_MZONE=" + std::to_string(LOCATION_MZONE) + " LOCATION_FZONE=" + std::to_string(LOCATION_FZONE)
		+ " EFFECT_TYPE_SINGLE=" + std::to_string(EFFECT_TYPE_SINGLE) + " EFFECT_TYPE_FIELD=" + std::to_string(EFFECT_TYPE_FIELD)
		+ " EFFECT_UPDATE_ATTACK=" + std::to_string(EFFECT_UPDATE_ATTACK) + "\n";
	const std::string full = pre + code;
	return OCG_LoadScript(d, full.c_str(), static_cast<uint32_t>(full.size()), "check.lua") != 0;
}
static void add(OCG_Duel d, uint8_t con, uint32_t loc, uint32_t seq, uint32_t code, int pos = POS_FACEUP_ATTACK, int count = 1) {
	for(int i = 0; i < count; ++i) {
		OCG_NewCardInfo info;
		std::memset(&info, 0, sizeof(info));
		info.team = con; info.duelist = 0; info.code = code; info.con = con; info.loc = loc; info.seq = seq; info.pos = pos;
		OCG_DuelNewCard(d, &info);
	}
}
static std::string msg(const char* key) { // the text of the last Debug.Message that starts with key
	for(auto it = logs.rbegin(); it != logs.rend(); ++it)
		if(it->rfind(key, 0) == 0) return it->substr(std::strlen(key));
	return "<missing>";
}
static std::string setup_code(int n) { return n == 3 ? "Debug.SetupDuelists(3,0,1,2)" : "Debug.SetupDuelists(4,0,1,2,3)"; }

// Seat `s` of an n duelist free for all.
static void seat_checks(int n, int s) {
	const int f0 = failures;
	OCG_Duel d = make_duel();
	EXPECT(run_lua(d, setup_code(n)), "setup n=%d", n);
	for(int p = 0; p < n; ++p) {
		add(d, (uint8_t)p, LOCATION_DECK, 0, 1, POS_FACEDOWN_DEFENSE, 10);
		add(d, (uint8_t)p, LOCATION_MZONE, 0, 1);
		add(d, (uint8_t)p, LOCATION_MZONE, 1, 1);
	}
	auto& f = F(d);
	EXPECT(NONE_ID(f, n) == 0xFF && ALL_ID(f, n) == 0xFE, "n=%d helper values %u %u", n, (unsigned)NONE_ID(f, n), (unsigned)ALL_ID(f, n));
	EXPECT(f.core.reason_player == 0xFF && f.core.conti_player == 0xFF && f.nil_event.event_player == 0xFF
	       && f.nil_event.reason_player == 0xFF, "n=%d reset_sentinels", n);
	for(int p = 0; p < n; ++p)
		EXPECT(OCG_DuelQueryCount(d, (uint8_t)p, LOCATION_MZONE) == 2, "n=%d seat %d MZONE count", n, p);
	const std::string S = std::to_string(s);
	// (1) a single EFFECT_UPDATE_ATTACK on a seat s monster
	const std::string lua1 =
		"local c=Duel.GetFieldCard(" + S + ",LOCATION_MZONE,0)\n"
		"Debug.Message('A0:'..c:GetAttack())\n"
		"local e=Effect.CreateEffect(c) e:SetType(EFFECT_TYPE_SINGLE) e:SetCode(EFFECT_UPDATE_ATTACK) e:SetValue(500) c:RegisterEffect(e)\n"
		"Debug.Message('A1:'..c:GetAttack())\n";
	EXPECT(run_lua(d, lua1), "n=%d lua1", n);
	EXPECT(msg("A0:") == "1000", "n=%d seat %d base ATK %s", n, s, msg("A0:").c_str());
	EXPECT(msg("A1:") == "1500", "n=%d seat %d single UPDATE_ATTACK: ATK %s (want 1500)", n, s, msg("A1:").c_str());
	// (2) a Field effect of seat s: own monsters only
	const std::string lua2 =
		"local c=Duel.GetFieldCard(" + S + ",LOCATION_MZONE,0)\n"
		"local c2=Duel.GetFieldCard(" + S + ",LOCATION_MZONE,1)\n"
		"local f=Effect.CreateEffect(c) f:SetType(EFFECT_TYPE_FIELD) f:SetCode(EFFECT_UPDATE_ATTACK) f:SetRange(LOCATION_MZONE)\n"
		"f:SetTargetRange(LOCATION_MZONE,0) f:SetValue(300) c:RegisterEffect(f)\n"
		"Debug.Message('B1:'..c2:GetAttack())\n"
		"Debug.Message('B2:'..c:GetAttack())\n"
		"for p=0," + std::to_string(n - 1) + " do if p~=" + S + " then Debug.Message('B3_'..p..':'..Duel.GetFieldCard(p,LOCATION_MZONE,1):GetAttack()) end end\n";
	EXPECT(run_lua(d, lua2), "n=%d lua2", n);
	EXPECT(msg("B1:") == "1300", "n=%d seat %d field effect on its own monster: ATK %s (want 1300)", n, s, msg("B1:").c_str());
	EXPECT(msg("B2:") == "1800", "n=%d seat %d field effect + single on the source: ATK %s (want 1800)", n, s, msg("B2:").c_str());
	for(int p = 0; p < n; ++p)
		if(p != s)
			EXPECT(msg(("B3_" + std::to_string(p) + ":").c_str()) == "1000", "n=%d seat %d effect leaked to seat %d: %s", n, s, p,
			       msg(("B3_" + std::to_string(p) + ":").c_str()).c_str());
	// (3) removal from the zone list (the stock remove_card returns early for controler == 2)
	card* pc = f.player[s].list_mzone[0];
	EXPECT(pc != nullptr && pc->current.controler == s, "n=%d seat %d card controler", n, s);
	f.remove_card(pc);
	EXPECT(f.player[s].list_mzone[0] == nullptr, "n=%d seat %d card still in list_mzone[0]", n, s);
	EXPECT(OCG_DuelQueryCount(d, (uint8_t)s, LOCATION_MZONE) == 1, "n=%d seat %d MZONE count after remove_card: %u", n, s,
	       OCG_DuelQueryCount(d, (uint8_t)s, LOCATION_MZONE));
	EXPECT(pc->current.controler == NONE_ID(f, n) && pc->current.location == 0, "n=%d removed card controler %u", n, pc->current.controler);
	// the field effect of the removed card is not cancelled by remove_card alone; cancel it like SendTo does
	pc->cancel_field_effect();
	EXPECT(run_lua(d, "Debug.Message('C1:'..Duel.GetFieldCard(" + S + ",LOCATION_MZONE,1):GetAttack())"), "lua3");
	EXPECT(msg("C1:") == "1000", "n=%d seat %d field effect still applies after cancel_field_effect: %s", n, s, msg("C1:").c_str());
	if(failures == f0) std::printf("ok   n=%d seat %d: single effect 1500, field effect 1300/1800 (no leak), remove_card empties the zone, count 2 -> 1, removed card controler 0xFF\n", n, s);
	OCG_DestroyDuel(d);
}

// A Field Spell in seat s's Field Zone and Duel.IsEnvironment with the "all" id (254 at n > 2 = all_id()).
static void all_checks(int n, int s) {
	const int f0 = failures;
	OCG_Duel d = make_duel();
	EXPECT(run_lua(d, setup_code(n)), "setup");
	for(int p = 0; p < n; ++p)
		add(d, (uint8_t)p, LOCATION_DECK, 0, 1, POS_FACEDOWN_DEFENSE, 10);
	add(d, (uint8_t)s, LOCATION_SZONE, 5, 89431, POS_FACEUP);
	const std::string S = std::to_string(s);
	std::string lua = "Debug.Message('E_all:'..tostring(Duel.IsEnvironment(89431,254,LOCATION_FZONE)))\n"
	                  "Debug.Message('E_own:'..tostring(Duel.IsEnvironment(89431," + S + ",LOCATION_FZONE)))\n";
	for(int p = 0; p < n; ++p)
		if(p != s)
			lua += "Debug.Message('E_" + std::to_string(p) + ":'..tostring(Duel.IsEnvironment(89431," + std::to_string(p) + ",LOCATION_FZONE)))\n";
	EXPECT(run_lua(d, lua), "n=%d all lua: %s", n, logs.empty() ? "" : logs.back().c_str());
	EXPECT(msg("E_all:") == "true", "n=%d seat %d: IsEnvironment with all_id (254): %s", n, s, msg("E_all:").c_str());
	EXPECT(msg("E_own:") == "true", "n=%d seat %d: IsEnvironment with its own seat: %s", n, s, msg("E_own:").c_str());
	for(int p = 0; p < n; ++p)
		if(p != s)
			EXPECT(msg(("E_" + std::to_string(p) + ":").c_str()) == "false", "n=%d seat %d: IsEnvironment(seat %d) is %s (want false; before T9 seat 3 meant all)", n, s, p,
			       msg(("E_" + std::to_string(p) + ":").c_str()).c_str());
	if(failures == f0) std::printf("ok   n=%d Field Spell of seat %d: IsEnvironment(all_id 254) true, own seat true, other seats false\n", n, s);
	OCG_DestroyDuel(d);
}

// n = 2 stays the stock values.
static void two_checks() {
	OCG_Duel d = make_duel();
	auto& f = F(d);
	EXPECT(NONE_ID(f, 2) == PLAYER_NONE && ALL_ID(f, 2) == PLAYER_ALL, "n=2 helper values");
	EXPECT(f.core.reason_player == PLAYER_NONE && f.core.conti_player == PLAYER_NONE && f.nil_event.event_player == PLAYER_NONE, "n=2 sentinels");
	add(d, 0, LOCATION_DECK, 0, 1, POS_FACEDOWN_DEFENSE, 10);
	add(d, 1, LOCATION_DECK, 0, 1, POS_FACEDOWN_DEFENSE, 10);
	add(d, 1, LOCATION_SZONE, 5, 89431, POS_FACEUP);
	EXPECT(run_lua(d, "Debug.Message('E3:'..tostring(Duel.IsEnvironment(89431)))\nDebug.Message('E2:'..tostring(Duel.IsEnvironment(89431,0,LOCATION_FZONE)))\n"
	                  "Debug.Message('E1:'..tostring(Duel.IsEnvironment(89431,1,LOCATION_FZONE)))"), "n=2 lua");
	EXPECT(msg("E3:") == "true" && msg("E2:") == "false" && msg("E1:") == "true", "n=2 IsEnvironment %s %s %s", msg("E3:").c_str(), msg("E2:").c_str(), msg("E1:").c_str());
	std::printf("ok   n=2: none_id 2, all_id 3, IsEnvironment default (all) true\n");
	OCG_DestroyDuel(d);
}

// n = 2 replay hash (FNV-1a of every message byte and the final QueryField), to compare with a B2 build.
static bool saw_win = false;
static uint64_t run_hash(uint32_t seed, int setup) {
	OCG_Duel d = make_duel(seed);
	if(setup && !run_lua(d, "Debug.SetupDuelists(2,0,1)")) { ++failures; }
	for(uint8_t t = 0; t < 2; ++t) {
		add(d, t, LOCATION_DECK, 0, 1, POS_FACEDOWN_DEFENSE, 40);
		add(d, t, LOCATION_MZONE, 0, 1);
	}
	OCG_StartDuel(d);
	uint64_t h = 1469598103934665603ull;
	auto feed = [&](const uint8_t* p, uint32_t n) { for(uint32_t i = 0; i < n; ++i) { h ^= p[i]; h *= 1099511628211ull; } };
	saw_win = false;
	for(int i = 0; i < 5000 && !saw_win; ++i) {
		int status = OCG_DuelProcess(d);
		uint32_t length = 0;
		const auto* b = static_cast<const uint8_t*>(OCG_DuelGetMessage(d, &length));
		feed(b, length);
		bool idle = false, chain = false, select_card = false;
		uint32_t select_min = 0;
		for(uint32_t off = 0; off + 4 <= length;) {
			uint32_t size = 0;
			std::memcpy(&size, b + off, 4);
			if(size > 0 && b[off + 4] == MSG_WIN) saw_win = true;
			if(size > 0 && b[off + 4] == MSG_SELECT_IDLECMD) idle = true;
			if(size > 0 && b[off + 4] == MSG_SELECT_CHAIN) chain = true;
			if(size > 10 && b[off + 4] == MSG_SELECT_CARD) { select_card = true; std::memcpy(&select_min, b + off + 7, 4); }
			off += 4 + size;
		}
		if(status == OCG_DUEL_STATUS_END) break;
		if(status != OCG_DUEL_STATUS_AWAITING) continue;
		if(chain) { const int32_t r = -1; OCG_DuelSetResponse(d, &r, sizeof(r)); }
		else if(idle) { const uint32_t r = 7; OCG_DuelSetResponse(d, &r, sizeof(r)); }
		else if(select_card) {
			std::vector<uint32_t> r{ 0, select_min };
			for(uint32_t k = 0; k < select_min; ++k) r.push_back(k);
			OCG_DuelSetResponse(d, r.data(), (uint32_t)(r.size() * 4));
		} else break;
	}
	uint32_t length = 0;
	const auto* q = static_cast<const uint8_t*>(OCG_DuelQueryField(d, &length));
	feed(q, length);
	OCG_DestroyDuel(d);
	return h;
}

int main(int argc, char** argv) {
	const std::string mode = argc > 1 ? argv[1] : "check";
	if(mode == "hash") {
		for(uint32_t seed : {1u, 77u, 4242u})
			std::printf("HASH seed %u %016llx\n", seed, (unsigned long long)run_hash(seed, 0));
		return 0;
	}
	if(mode == "unique") { // probe: a unique-on-field card of seat 2 at n = 4 (add_unique_card uses opponent_of)
		OCG_Duel d = make_duel();
		run_lua(d, setup_code(4));
		add(d, 2, LOCATION_DECK, 0, 1, POS_FACEDOWN_DEFENSE, 10);
		add(d, 2, LOCATION_MZONE, 0, 1);
		std::printf("probe: SetUniqueOnField(1,1,1) on a seat 2 monster\n");
		std::fflush(stdout);
		const bool ok = run_lua(d, "local c=Duel.GetFieldCard(2,LOCATION_MZONE,0) c:SetUniqueOnField(1,1,1,LOCATION_MZONE)");
		std::printf("probe done: lua ok=%d\n", ok);
		return 0;
	}
	two_checks();
	for(int n : {3, 4})
		for(int s = 2; s < n; ++s) {
			seat_checks(n, s);
		}
	// The Field Spell is in seat 0: Duel.IsEnvironment still loops over seats 0 and 1 only (stock "p < 2" sites, not T9),
	// so the PLAYER_ALL path is tested with a seat 0 card.
	all_checks(3, 0);
	all_checks(4, 0);
	seat_checks(3, 0); // control: seat 0
	for(uint32_t seed : {1u, 77u, 4242u}) {
		const auto a = run_hash(seed, 0), b = run_hash(seed, 1);
		EXPECT(a == b, "n=2 seed %u: hash differs with SetupDuelists(2,0,1)", seed);
		std::printf("ok   n=2 seed %u: hash %016llx%s, same with SetupDuelists(2,0,1)\n", seed, (unsigned long long)a, saw_win ? " (to MSG_WIN)" : "");
	}
	std::printf("%s: %d failure(s)\n", failures ? "FAIL" : "PASS", failures);
	return failures ? 1 : 0;
}
