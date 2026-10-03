// Native check for core patch 0057 (a pick of an opponent skips a seat with a pending loss and refuses an answer that names one, at n > 2).
// A seat that gives up (Debug.EliminateDuelist) is still alive until the next Adjust. The test card of seat 0 is a mandatory trigger at its
// Standby Phase that hits "the opponent" (the folded 1, bound by the pick) for 100. Variants: cond (Duel.MPNeedPick in the condition: the
// chain-link pick), tgt (Duel.MPBindOpponent(true) in the target: the lazy pick), tgtloss (like tgt, the target first gives seat 2 a pending
// loss). Cases: a control pick of seat 2 (accepted, seat 2 loses 100), a pick answer that names a seat with a pending loss (FFA3 and FFA4:
// MSG_RETRY, then the other seat is hit), Tag (no pick), and a lazy pick that is built when seat 2 already has a pending loss (the list
// has only the living seat).
#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fcntl.h>
#include <fstream>
#include <map>
#include <set>
#include <sstream>
#include <string>
#include <unistd.h>
#include <vector>
#include "ocgapi.h"
#include "ocgapi_constants.h"
#include "duel.h"
#include "field.h"
#include "interpreter.h"
#include "fold.h"
#include "common.h"


static const uint32_t kTestBase = 90001;  // test card of seat s = kTestBase + s
static const uint32_t kDeckBase = 5000;   // deck card of seat s = kDeckBase + s
static const uint32_t kToken = 91001;      // a monster that the calls put on a field
static const uint32_t kSpell = 91002;      // a Spell that SSet puts on a field

static std::string g_variant;

// The test card of seat 0 (code 90001): a mandatory trigger at the Standby Phase of seat 0. The operation hits "the opponent" (1-tp)
// for 100: the folded 1 is the bound opponent. Variants:
//   cond     the condition calls Duel.MPNeedPick(): the pick prompt is asked when the chain link is built (processor path)
//   tgt      the target calls Duel.MPBindOpponent(true): the pick prompt is asked in the target (lazy_bind)
//   tgtloss  R-FFA-OPP-ONE: declare first, then the target flags seat 2. This is not a loss before declaration.
//   preloss  R-FFA-ELIMINATION: seat 2 is flagged before processing, so the declaration list excludes it.
static const char* kTestScript = R"LUA(
local s,id=GetID()
function s.initial_effect(c)
	local e1=Effect.CreateEffect(c)
	e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_F)
	e1:SetCode(EVENT_PHASE+PHASE_STANDBY)
	e1:SetRange(LOCATION_MZONE)
	e1:SetCountLimit(1)
	if VARIANT=='cond' then
		e1:SetCondition(function(e,tp) Duel.MPNeedPick() return true end)
	else
		e1:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
			if chk==0 then return true end
			if VARIANT=='tgtloss' then Debug.EliminateDuelist(2,7) Debug.Message("PA target-loss") end
			Duel.MPBindOpponent(true)
		end)
	end
	e1:SetOperation(function(e,tp) Debug.Message("PA op") Duel.Damage(1-tp,100,REASON_EFFECT) end)
	c:RegisterEffect(e1)
end
)LUA";

static OCG_Duel g_duel = nullptr;
static long g_errors = 0;
static std::vector<std::string> g_error_text;
static int g_ops = 0, g_picks_seen = 0, g_target_losses = 0;
static field& F(OCG_Duel d) { return *static_cast<duel*>(d)->game_field; }

// ---- card data, scripts, log
static void read_card(void*, uint32_t code, OCG_CardData* data) {
	std::memset(data, 0, sizeof(*data));
	data->code = code;
	data->type = TYPE_MONSTER | TYPE_NORMAL;
	data->level = 4;
	data->attribute = 1;
	data->race = 1;
	data->attack = 1000;
	data->defense = 1000;
	if(code >= kTestBase && code < kTestBase + 4)
		data->type = TYPE_MONSTER | TYPE_EFFECT;
	if(code == kSpell) {
		data->type = TYPE_SPELL;
		data->level = 0;
		data->attack = 0;
		data->defense = 0;
	}
}

static bool read_file(const std::string& path, std::string& out) {
	std::ifstream in(path, std::ios::binary);
	if(!in)
		return false;
	std::stringstream buf;
	buf << in.rdbuf();
	out = buf.str();
	return true;
}

static int read_script(void*, OCG_Duel duel, const char* name) {
	(void)duel;
	std::string n(name);
	std::replace(n.begin(), n.end(), '\\', '/');
	const auto slash = n.find_last_of('/');
	const std::string base = slash == std::string::npos ? n : n.substr(slash + 1);
	std::string text;
	if(base.size() > 6 && base.compare(0, 1, "c") == 0 && base.compare(base.size() - 4, 4, ".lua") == 0) {
		const uint32_t code = static_cast<uint32_t>(std::strtoul(base.c_str() + 1, nullptr, 10));
		if(code == kTestBase)
			text = std::string("VARIANT='") + g_variant + "'\n" + kTestScript;
		else if((code > kTestBase && code < kTestBase + 4) || code == kToken || code == kSpell)
			text = "local s,id=GetID()\nfunction s.initial_effect(c) end\n";
	}
	if(text.empty()) {
		const std::string roots[] = { std::string(check_scripts_dir()) + "/", std::string(check_scripts_dir()) + "/official/" };
		bool found = false;
		for(const auto& r : roots) {
			if(read_file(r + n, text) || read_file(r + base, text)) {
				found = true;
				break;
			}
		}
		if(!found)
			return 0;
	}
	return OCG_LoadScript(duel, text.data(), static_cast<uint32_t>(text.size()), name);
}


static void on_log(void*, const char* text, int type) {
	if(type == OCG_LOG_TYPE_ERROR || type == OCG_LOG_TYPE_UNDEFINED) {
		++g_errors;
		if(g_error_text.size() < 8) g_error_text.push_back(text ? text : "");
		if(std::getenv("CHECK_LOG")) std::fprintf(stderr, "core log [%d]: %s\n", type, text);
		return;
	}
	if(text && std::strncmp(text, "PA op", 5) == 0) ++g_ops;
	if(text && std::strcmp(text, "PA target-loss") == 0) {
		++g_target_losses;
		EXPECT(g_picks_seen == 1, "R-FFA-OPP-ONE: target loss ran before the declaration answer");
		EXPECT(F(g_duel).player[2].pending_loss != 0, "target did not flag seat 2");
	}
}

static void add_card(OCG_Duel d, uint8_t con, uint32_t loc, uint32_t code, uint32_t pos) {
	OCG_NewCardInfo info;
	std::memset(&info, 0, sizeof(info));
	info.team = con; info.duelist = 0; info.code = code; info.con = con; info.loc = loc; info.seq = 0; info.pos = pos;
	OCG_DuelNewCard(d, &info);
}

struct Msg { uint8_t id; const uint8_t* p; uint32_t size; };

struct Scenario {
	const char* name;
	int n;
	std::vector<int> team;
	const char* variant;
	int loss_seat;   // seat that gets a pending loss when the first pick prompt opens (-1: none)
	int first_seat;  // seat that the first answer names
	int want_retry;  // 1: the first answer must give MSG_RETRY, 0: it must be accepted
	int second_seat; // seat of the answer after a RETRY (-1: none)
	int want_prompts;  // number of pick prompts that open (the first one counted once, a RETRY is not a prompt)
	int hit_seat;    // the seat that must lose 100 LP (-1: not checked)
	int unhit_seat;  // a seat that must keep its LP (-1: not checked)
	int before_loss_seat = -1; // R-FFA-ELIMINATION: flag this seat before the declaration
};

static void run(const Scenario& sc) {
	g_variant = sc.variant;
	g_errors = 0; g_error_text.clear(); g_ops = 0; g_picks_seen = 0; g_target_losses = 0;
	OCG_DuelOptions options;
	std::memset(&options, 0, sizeof(options));
	options.seed[0] = 7; options.seed[1] = 2; options.seed[2] = 3; options.seed[3] = 4;
	options.flags = DUEL_MODE_MR5;
	options.team1 = { 8000, 5, 1 };
	options.team2 = { 8000, 5, 1 };
	options.cardReader = read_card;
	options.scriptReader = read_script;
	options.logHandler = on_log;
	OCG_Duel d = nullptr;
	if(OCG_CreateDuel(&d, &options) != OCG_DUEL_CREATION_SUCCESS) { EXPECT(false, "%s: OCG_CreateDuel", sc.name); return; }
	g_duel = d;
	for(const char* name : { "constant.lua", "utility.lua" })
		if(!read_script(nullptr, d, name)) { EXPECT(false, "%s: script %s", sc.name, name); g_duel = nullptr; OCG_DestroyDuel(d); return; }
	std::string code = "Debug.SetupDuelists(" + std::to_string(sc.n);
	for(int t : sc.team) code += "," + std::to_string(t);
	code += ")";
	if(!OCG_LoadScript(d, code.c_str(), static_cast<uint32_t>(code.size()), "setup.lua") || g_errors) {
		EXPECT(false, "%s: SetupDuelists", sc.name); g_duel = nullptr; OCG_DestroyDuel(d); return;
	}
	for(int s = 0; s < sc.n; ++s)
		for(int i = 0; i < 30; ++i)
			add_card(d, static_cast<uint8_t>(s), LOCATION_DECK, kDeckBase + s, POS_FACEDOWN_DEFENSE);
	for(int s = 0; s < sc.n; ++s)
		add_card(d, static_cast<uint8_t>(s), LOCATION_MZONE, kTestBase + s, POS_FACEUP_ATTACK);
	OCG_StartDuel(d);
	int32_t lp0[4];
	for(int s = 0; s < sc.n; ++s) lp0[s] = F(d).lp_ref(static_cast<uint8_t>(s));

	if(sc.before_loss_seat >= 0)
		F(d).player[sc.before_loss_seat].pending_loss = 0x100 | 7;

	int turns = 0, prompts = 0, retries = 0, stage = 0, picks_offered_loss = 0, accepted_after = 0;
	bool done = false;
	std::string why;
	for(int steps = 0; steps < 4000 && !done; ++steps) {
		const int status = OCG_DuelProcess(d);
		uint32_t length = 0;
		const auto* buf = static_cast<const uint8_t*>(OCG_DuelGetMessage(d, &length));
		std::vector<Msg> msgs;
		for(uint32_t off = 0; off + 4 <= length;) {
			uint32_t size = 0;
			std::memcpy(&size, buf + off, 4);
			if(size > 0) {
				msgs.push_back({ buf[off + 4], buf + off + 5, size - 1 });
				if(buf[off + 4] == MSG_NEW_TURN) ++turns;
			}
			off += 4 + size;
		}
		if(status == OCG_DUEL_STATUS_END) { why = "duel ended"; break; }
		if(status != OCG_DUEL_STATUS_AWAITING) continue;
		const Msg* m = msgs.empty() ? nullptr : &msgs.back();
		if(!m) { why = "awaiting without a message"; break; }
		auto answer32 = [&](int32_t v) { OCG_DuelSetResponse(d, &v, sizeof(v)); };
		if(m->id == MSG_SELECT_OPTION) {
			const int count = m->p[1];
			bool pick = count > 0;
			std::vector<int> seats;
			for(int i = 0; i < count; ++i) {
				uint64_t desc = 0;
				std::memcpy(&desc, m->p + 2 + 8 * i, 8);
				if((desc & 0xFFFF0000ULL) != 0xFFFE0000ULL) pick = false;
				seats.push_back(static_cast<int>(desc & 0xFF));
			}
			if(pick) {
				EXPECT(m->p[0] == 0, "%s: declaration went to seat %d", sc.name, m->p[0]);
				std::vector<int> expected;
				for(int seat = 1; seat < sc.n; ++seat)
					if(seat != sc.before_loss_seat) expected.push_back(seat);
				EXPECT(seats == expected, "%s: declaration list is wrong", sc.name);
				auto index_of = [&](int seat) { for(size_t i = 0; i < seats.size(); ++i) if(seats[i] == seat) return static_cast<int>(i); return -1; };
				if(stage == 0) {
					++prompts;
					++g_picks_seen;
					if(g_variant == "tgtloss") {
						EXPECT(g_target_losses == 0 && index_of(2) >= 0,
						       "%s: declaration must offer seat 2 before the target flags it", sc.name);
					}
					if(sc.loss_seat >= 0)
						F(d).player[sc.loss_seat].pending_loss = 0x100 | 7;
					const int want = sc.first_seat;
					int idx = index_of(want);
					EXPECT(idx >= 0, "%s: the pick prompt does not offer seat %d", sc.name, want);
					if(idx < 0) idx = 0;
					stage = 1;
					answer32(idx);
					continue;
				}
				if(stage == 2) {
					const int idx = index_of(sc.second_seat);
					EXPECT(idx >= 0, "%s: the prompt after the retry does not offer seat %d", sc.name, sc.second_seat);
					stage = 3;
					answer32(idx < 0 ? 0 : idx);
					continue;
				}
			}
		}
		if(m->id == MSG_RETRY) {
			++retries;
			EXPECT(stage == 1, "%s: MSG_RETRY outside the first answer (stage %d)", sc.name, stage);
			// after a RETRY the engine keeps the pending prompt: the core waits for a new answer to the same prompt
			// (the option list is read again from the core state)
			auto& f = F(d);
			int idx = -1;
			int i = 0;
			for(auto opt : f.core.select_options) {
				if(static_cast<int>(opt & 0xFF) == sc.second_seat) idx = i;
				++i;
			}
			EXPECT(idx >= 0, "%s: the prompt after the retry does not offer seat %d", sc.name, sc.second_seat);
			stage = 3;
			answer32(idx < 0 ? 0 : idx);
			continue;
		}
		if(stage == 1) {
			// the first answer was accepted
			EXPECT(sc.want_retry == 0, "%s: the answer with seat %d (pending loss) was accepted, want MSG_RETRY", sc.name, sc.first_seat);
			stage = 4;
		}
		if(stage == 3) { ++accepted_after; stage = 4; }
		if(turns >= 2) { done = true; break; }
		switch(m->id) {
		case MSG_SELECT_IDLECMD: answer32(7); break;
		case MSG_SELECT_YESNO: case MSG_SELECT_EFFECTYN: case MSG_SELECT_OPTION: answer32(m->id == MSG_SELECT_OPTION ? 0 : 1); break;
		case MSG_SELECT_CHAIN: answer32(m->size > 2 && m->p[2] != 0 ? 0 : -1); break;
		case MSG_SORT_CHAIN: { const uint8_t r[1] = { 0xFF }; OCG_DuelSetResponse(d, r, 1); break; }
		case MSG_SELECT_POSITION: answer32(POS_FACEUP_ATTACK); break;
		default: { char b[64]; std::snprintf(b, sizeof(b), "unhandled prompt %u", static_cast<unsigned>(m->id)); why = b; break; }
		}
		if(!why.empty()) break;
	}
	EXPECT(done, "%s: the duel did not reach turn 2: %s", sc.name, why.c_str());
	EXPECT(g_errors == 0, "%s: %ld Lua errors, first: %s", sc.name, g_errors, g_error_text.empty() ? "" : g_error_text[0].c_str());
	EXPECT(prompts == sc.want_prompts, "%s: %d pick prompts, want %d", sc.name, prompts, sc.want_prompts);
	EXPECT(retries == sc.want_retry, "%s: %d MSG_RETRY, want %d", sc.name, retries, sc.want_retry);
	EXPECT(g_ops == 1, "%s: the operation ran %d times, want 1", sc.name, g_ops);
	if(sc.hit_seat >= 0)
		EXPECT(F(d).lp_ref(static_cast<uint8_t>(sc.hit_seat)) == lp0[sc.hit_seat] - 100, "%s: LP of seat %d is %d, want %d", sc.name, sc.hit_seat, F(d).lp_ref(static_cast<uint8_t>(sc.hit_seat)), lp0[sc.hit_seat] - 100);
	if(sc.unhit_seat >= 0)
		EXPECT(F(d).lp_ref(static_cast<uint8_t>(sc.unhit_seat)) == lp0[sc.unhit_seat], "%s: LP of seat %d is %d, want %d", sc.name, sc.unhit_seat, F(d).lp_ref(static_cast<uint8_t>(sc.unhit_seat)), lp0[sc.unhit_seat]);
	// Keep the original hit checks and assert the LP and loss state of every seat.
	for(int seat = 0; seat < sc.n; ++seat) {
		const int expected = lp0[seat] - (sc.hit_seat >= 0 && sc.team[seat] == sc.team[sc.hit_seat] ? 100 : 0);
		EXPECT(F(d).lp_ref(static_cast<uint8_t>(seat)) == expected,
		       "%s: seat %d LP is %d, want %d", sc.name, seat, F(d).lp_ref(static_cast<uint8_t>(seat)), expected);
		const bool lost = seat == sc.loss_seat || seat == sc.before_loss_seat || (g_variant == "tgtloss" && seat == 2);
		EXPECT(F(d).is_alive(static_cast<uint8_t>(seat)) == !lost, "%s: seat %d loss state is wrong", sc.name, seat);
	}
	EXPECT(g_target_losses == (g_variant == "tgtloss" ? 1 : 0), "%s: target-loss count %d", sc.name, g_target_losses);
	std::printf("%-14s n=%d variant=%-8s pick prompts=%d retries=%d operation=%d LP=%d/%d/%d/%d\n", sc.name, sc.n, sc.variant, prompts, retries, g_ops,
	            F(d).lp_ref(0), sc.n > 1 ? F(d).lp_ref(1) : 0, sc.n > 2 ? F(d).lp_ref(2) : 0, sc.n > 3 ? F(d).lp_ref(3) : 0);
	(void)picks_offered_loss; (void)accepted_after;
	g_duel = nullptr;
	OCG_DestroyDuel(d);
}

int main(int argc, char** argv) {
	const std::string only = argc > 1 ? argv[1] : "";
	// name, n, teams, variant, loss seat, first answer, want retry, second answer, want prompts, hit seat, unhit seat
	const std::vector<Scenario> scenarios = {
		{ "ffa3-ctl-s2",    3, { 0, 1, 2 }, "cond",    -1, 2, 0, -1, 1, 2, 1 },
		{ "ffa3-stale",     3, { 0, 1, 2 }, "cond",     2, 2, 1,  1, 1, 1, 2 },
		{ "ffa4-stale",     4, { 0, 1, 2, 3 }, "cond",  2, 2, 1,  3, 1, 3, 2 },
		{ "tag-no-pick",    4, { 0, 1, 0, 1 }, "cond",  -1, 3, 0, -1, 0, 1, 2 },
		{ "ffa3-tgt-ctl",   3, { 0, 1, 2 }, "tgt",     -1, 2, 0, -1, 1, 2, 1 },
		// R-FFA-OPP-ONE: the one declaration precedes the callback loss. LP outcomes stay equal.
		{ "ffa3-tgt-loss",  3, { 0, 1, 2 }, "tgtloss", -1, 1, 0, -1, 1, 1, 2 },
		{ "ffa4-tgt-loss",  4, { 0, 1, 2, 3 }, "tgtloss", -1, 3, 0, -1, 1, 3, 2 },
		// Loss before declaration: only p1 is legal in FFA3. FFA4 still offers p1 and p3.
		{ "ffa3-preloss",   3, { 0, 1, 2 }, "preloss", -1, 1, 0, -1, 0, 1, 2, 2 },
		{ "ffa4-preloss",   4, { 0, 1, 2, 3 }, "preloss", -1, 3, 0, -1, 1, 3, 2, 2 },
	};
	for(const auto& sc : scenarios) {
		if(!only.empty() && only != sc.name) continue;
		run(sc);
	}
	if(failures) { std::printf("FAIL pending-loss-pick: %d failure(s)\n", failures); return 1; }
	std::printf("PASS pending-loss-pick\n");
	return 0;
}
