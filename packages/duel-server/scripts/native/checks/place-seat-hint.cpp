// F8 native check: the seat hint of a place prompt (MSG_HINT 0xF0) and the exact seat in the answer, at n > 2.
// Build and run: bash packages/duel-server/scripts/native/checks/run.sh <check name> (see README.md).
// Every seat owns a test card (code 90001 + seat) in its monster zone. The card is a mandatory trigger on the standby
// phase. Its operation does five calls that put a place prompt on the opponent field:
//   spsum     Duel.SpecialSummon(token, 0, tp, 1-tp, ...)      the token goes to the opponent field
//   movef     Duel.MoveToField(token, tp, 1-tp, MZONE, ...)
//   sset      Duel.SSet(tp, spell, 1-tp)
//   disfield  Duel.SelectDisableField(tp, 1, 0, MZONE, 0), the flag goes into EFFECT_DISABLE_FIELD: the hint seat
//             (the next seat in turn order, as the disable code binds it) must be the only seat that gets the zone
//   fieldzone Duel.SelectFieldZone(tp, 1, 0, MZONE, 0)
// Which opponent "1" means (F5, core 29fff80): on the turn of an opponent the read of the turn player binds that opponent.
// On a turn of the own team nothing is bound, so the core asks the activator to pick one opponent (MSG_SELECT_OPTION,
// every desc 0xFFFE0000|seat, ascending, living opponents only). The harness answers that pick with option 0, the
// lowest seat, and the hint must name that seat.
// The harness reads the hint, answers first with a living seat that is NOT the hint seat (must give MSG_RETRY), then
// with the hint seat (must be accepted). For the three calls that move a card it then looks at which field got it.
//   ffa3, ffa4, tag     n > 2
//   ffa4e               FFA4 with seat 1 marked eliminated: no hint names it
//   n2, n2s             n == 2 without and with Debug.SetupDuelists(2,0,1): same bytes, no hint at all
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


static const char* kScripts = check_scripts_dir();
static const uint32_t kTestBase = 90001;  // test card of seat s = kTestBase + s
static const uint32_t kDeckBase = 5000;   // deck card of seat s = kDeckBase + s
static const uint32_t kToken = 91001;      // a monster that the calls put on a field
static const uint32_t kSpell = 91002;      // a Spell that SSet puts on a field

static const char* kTestScript = R"LUA(
local s,id=GetID()
local seat=id-90001
function s.initial_effect(c)
	local e1=Effect.CreateEffect(c)
	e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_F)
	e1:SetCode(EVENT_PHASE+PHASE_STANDBY)
	e1:SetRange(LOCATION_MZONE)
	e1:SetCountLimit(1)
	e1:SetOperation(s.op)
	c:RegisterEffect(e1)
end
function s.op(e,tp,eg,ep,ev,re,r,rp)
	local c=e:GetHandler()
	-- the read of the turn player binds the opponent of the link when it is not the own turn
	Debug.Message(string.format("F8 who s=%d tp=%d turn=%d",seat,tp,Duel.GetTurnPlayer()))
	local function clean(t)
		if t:IsLocation(LOCATION_ONFIELD) then Duel.SendtoGrave(t,REASON_RULE) end
	end
	local calls={
		{"spsum",function()
			local t=Duel.CreateToken(tp,91001)
			local r=Duel.SpecialSummon(t,0,tp,1-tp,true,true,POS_FACEUP_ATTACK)
			Debug.Message(string.format("F8 at fn=spsum s=%d r=%d",seat,r))
			clean(t) end},
		{"movef",function()
			local t=Duel.CreateToken(tp,91001)
			local r=Duel.MoveToField(t,tp,1-tp,LOCATION_MZONE,POS_FACEUP_ATTACK,true)
			Debug.Message(string.format("F8 at fn=movef s=%d r=%s",seat,tostring(r)))
			clean(t) end},
		{"sset",function()
			local t=Duel.CreateToken(tp,91002)
			local r=Duel.SSet(tp,t,1-tp)
			Debug.Message(string.format("F8 at fn=sset s=%d r=%d",seat,r))
			clean(t) end},
		{"disfield",function()
			-- the zone that the prompt offers goes into an EFFECT_DISABLE_FIELD effect, as the cards do
			local z=Duel.SelectDisableField(tp,1,0,LOCATION_MZONE,0)
			-- two effects per seat are enough (no Reset, so the check does not depend on the end of turn)
			s.applied=s.applied or {}
			s.applied[seat]=(s.applied[seat] or 0)
			if z and z~=0 and s.applied[seat]<2 then
				s.applied[seat]=s.applied[seat]+1
				local e1=Effect.CreateEffect(c)
				e1:SetType(EFFECT_TYPE_FIELD)
				e1:SetCode(EFFECT_DISABLE_FIELD)
				e1:SetValue(z)
				Duel.RegisterEffect(e1,tp)
				Duel.AdjustInstantly(c)
				Debug.Message(string.format("F8 dis s=%d z=%d",seat,z))
			end
		end},
		{"fieldzone",function() return Duel.SelectFieldZone(tp,1,0,LOCATION_MZONE,0) end},
	}
	for _,cl in ipairs(calls) do
		Debug.Message(string.format("F8 call s=%d fn=%s",seat,cl[1]))
		cl[2]()
		Debug.Message(string.format("F8 done s=%d fn=%s",seat,cl[1]))
	end
end
)LUA";

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
		if(code >= kTestBase && code < kTestBase + 4)
			text = kTestScript;
		if(code == kToken || code == kSpell)
			text = "local s,id=GetID()\nfunction s.initial_effect(c) end\n";
	}
	if(text.empty()) {
		const std::string roots[] = { std::string(kScripts) + "/", std::string(kScripts) + "/official/" };
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

// ---- the scenario state that the log handler and the driver share
struct Scenario {
	const char* name;
	int n;
	std::vector<int> team;
	bool setup_call;
	int turns;
	int eliminate = -1;
};

struct Model {
	int n = 2;
	bool tag = false;
	int eliminate = -1;
	std::vector<int> team;
	bool same_team(int a, int b) const { return team[a] == team[b]; }
	// the living opponents of P in ascending order: the options of the F5 pick prompt
	std::vector<int> opponents(int P) const {
		std::vector<int> r;
		for(int q = 0; q < n; ++q)
			if(q != eliminate && !same_team(P, q)) r.push_back(q);
		return r;
	}
	// the opponent that "1" means during the operation of the card of seat P on the turn of seat T: the turn player
	// when it is an opponent (the read binds it), else the pick, which the harness answers with option 0 (lowest seat)
	int bound(int P, int T) const {
		if(!same_team(P, T)) return T;
		const auto o = opponents(P);
		return o.empty() ? -1 : o[0];
	}
};

struct Cur {
	std::string fn;
	int P = -1, T = -1, exp = -1;
	bool in_call = false;
};

static Model g_model;
static Cur g_cur;
static OCG_Duel g_duel = nullptr;
static long g_errors = 0;
static std::vector<std::string> g_error_text;
static std::map<std::string, int> g_counts;  // per fn: hint prompts, retries, accepted, landed
static int g_firings = 0;
static int g_hint_msgs = 0;  // every MSG_HINT 0xF0 in the whole duel
static int g_pick_prompts = 0;  // the 0xFFFE opponent pick prompts that were answered
static uint32_t g_dis_expect[4];  // per seat: the zones that the disable effects of this turn must have disabled

static field& F(OCG_Duel d) { return *static_cast<duel*>(d)->game_field; }

// the seat whose field holds a card of this code, -1 none
static int holder_of(uint32_t code) {
	auto& f = F(g_duel);
	for(int s = 0; s < f.n_duelists; ++s) {
		for(auto* c : f.player[s].list_mzone) if(c && c->data.code == code) return s;
		for(auto* c : f.player[s].list_szone) if(c && c->data.code == code) return s;
	}
	return -1;
}

static void on_log(void*, const char* text, int type) {
	if(type == OCG_LOG_TYPE_ERROR || type == OCG_LOG_TYPE_UNDEFINED) {
		++g_errors;
		if(g_error_text.size() < 8)
			g_error_text.push_back(text ? text : "");
		if(std::getenv("CHECK_LOG"))
			std::fprintf(stderr, "core log [%d]: %s\n", type, text);
		return;
	}
	if(!text || std::strncmp(text, "F8 ", 3) != 0 || !g_duel)
		return;
	if(std::getenv("CHECK_LOG"))
		std::fprintf(stderr, "T=%d %s\n", F(g_duel).infos.turn_player, text);
	char fn[32];
	int s = -1;
	if(std::sscanf(text, "F8 who s=%d", &s) == 1) {
		++g_firings;
	} else if(std::sscanf(text, "F8 call s=%d fn=%31s", &s, fn) == 2) {
		g_cur.fn = fn;
		g_cur.P = s;
		g_cur.T = F(g_duel).infos.turn_player;
		g_cur.exp = g_model.n > 2 ? g_model.bound(s, g_cur.T) : -1;
		if(g_model.n > 2 && g_cur.fn == "disfield") {
			// SelectDisableField offers the seat that EFFECT_DISABLE_FIELD binds: the next living seat in turn order
			int nx = -1;
			for(int i = 1; i < g_model.n && nx < 0; ++i) {
				const int q = (s + i) % g_model.n;
				if(q != g_model.eliminate) nx = q;
			}
			g_cur.exp = (nx >= 0 && !g_model.same_team(s, nx)) ? nx : -1;
		}
		g_cur.in_call = true;
	} else if(std::sscanf(text, "F8 at fn=%31s s=%d", fn, &s) == 2) {
		// the card is on a field now: it must be the field of the seat that the hint named
		const int h = holder_of(std::strcmp(fn, "sset") == 0 ? kSpell : kToken);
		if(g_model.n > 2) {
			EXPECT(h == g_cur.exp, "%s seat %d turn %d: the card landed on seat %d, want seat %d", fn, s, g_cur.T, h, g_cur.exp);
			if(h == g_cur.exp) ++g_counts[std::string(fn) + ".landed"];
		} else {
			EXPECT(h == 1 - s, "n2 %s seat %d: the card landed on seat %d", fn, s, h);
		}
	} else if(std::sscanf(text, "F8 dis s=%d", &s) == 1) {
		// the effect was registered from the returned flag: the zone must show up on the seat of the hint, and on
		// no other seat. The disabled zones are only updated by the adjust that runs after the operation, so the
		// harness collects the expected zones here and compares them at every idle prompt (see MSG_SELECT_IDLECMD).
		unsigned z = 0;
		std::sscanf(text, "F8 dis s=%*d z=%u", &z);
		if(g_model.n > 2)
		EXPECT(g_cur.exp >= 0 && (z & 0xffff) == 0 && (z >> 16) != 0, "disfield seat %d: flag %08x does not name the hint seat %d", s, z, g_cur.exp);
		if(g_model.n > 2 && g_cur.exp >= 0)
			g_dis_expect[g_cur.exp] |= (z >> 16) & 0xff7f;
		++g_counts["disfield.applied"];
		if(g_cur.exp != g_cur.T && g_cur.exp >= 0)
			++g_counts["disfield.applied_not_turn"];
	} else if(std::sscanf(text, "F8 done s=%d fn=%31s", &s, fn) == 2) {
		g_cur.in_call = false;
	}
}

// ---- duel setup and driver
struct Outcome {
	uint64_t hash = 0;
	int turns = 0;
	size_t depth_bad = 0;
	size_t prompts = 0;
	bool ended_ok = false;
	std::string why;
};

static void add_card(OCG_Duel d, uint8_t con, uint32_t loc, uint32_t code, uint32_t pos) {
	OCG_NewCardInfo info;
	std::memset(&info, 0, sizeof(info));
	info.team = con;
	info.duelist = 0;
	info.code = code;
	info.con = con;
	info.loc = loc;
	info.seq = 0;
	info.pos = pos;
	OCG_DuelNewCard(d, &info);
}

static uint64_t fnv(uint64_t h, const uint8_t* p, size_t n) {
	for(size_t i = 0; i < n; ++i) { h ^= p[i]; h *= 1099511628211ull; }
	return h;
}

struct Msg { uint8_t id; const uint8_t* p; uint32_t size; };

// A place prompt that waits for the answers
struct Pending {
	bool active = false;
	int stage = 0;          // 0 = nothing sent, 1 = wrong seat sent, 2 = right seat sent
	uint8_t who = 0;
	uint32_t flag = 0;
	int hint = -1;
	uint8_t id = 0;
	int wrong = -1;
	int right = -1;
	std::string fn;
};

static Outcome play(const Scenario& sc) {
	Outcome out;
	g_errors = 0;
	g_error_text.clear();
	g_counts.clear();
	g_firings = 0;
	g_hint_msgs = 0;
	g_pick_prompts = 0;
	std::memset(g_dis_expect, 0, sizeof(g_dis_expect));
	g_cur = Cur();
	g_model = Model();
	g_model.n = sc.n;
	g_model.team = sc.team;
	g_model.tag = sc.n > 2 && std::set<int>(sc.team.begin(), sc.team.end()).size() < static_cast<size_t>(sc.n);
	g_model.eliminate = sc.eliminate;
	OCG_DuelOptions options;
	std::memset(&options, 0, sizeof(options));
	options.seed[0] = 7; options.seed[1] = 2; options.seed[2] = 3; options.seed[3] = 4;
	options.flags = DUEL_MODE_MR5;
	options.team1 = { 8000, 5, 1 };
	options.team2 = { 7000, 5, 1 };
	options.cardReader = read_card;
	options.scriptReader = read_script;
	options.logHandler = on_log;
	OCG_Duel d = nullptr;
	if(OCG_CreateDuel(&d, &options) != OCG_DUEL_CREATION_SUCCESS) {
		out.why = "OCG_CreateDuel";
		return out;
	}
	g_duel = d;
	for(const char* name : { "constant.lua", "utility.lua" }) {
		if(!read_script(nullptr, d, name)) {
			out.why = std::string("script ") + name;
			g_duel = nullptr;
			OCG_DestroyDuel(d);
			return out;
		}
	}
	if(sc.setup_call) {
		std::string code = "Debug.SetupDuelists(" + std::to_string(sc.n);
		for(int t : sc.team)
			code += "," + std::to_string(t);
		code += ")";
		if(!OCG_LoadScript(d, code.c_str(), static_cast<uint32_t>(code.size()), "setup.lua") || g_errors) {
			out.why = "SetupDuelists failed";
			g_duel = nullptr;
			OCG_DestroyDuel(d);
			return out;
		}
	}
	for(int s = 0; s < sc.n; ++s)
		for(int i = 0; i < 30; ++i)
			add_card(d, static_cast<uint8_t>(s), LOCATION_DECK, kDeckBase + s, POS_FACEDOWN_DEFENSE);
	for(int s = 0; s < sc.n; ++s)
		add_card(d, static_cast<uint8_t>(s), LOCATION_MZONE, kTestBase + s, POS_FACEUP_ATTACK);
	OCG_StartDuel(d);
	if(sc.eliminate >= 0)
		F(d).player[sc.eliminate].eliminated = true;

	auto* pd = static_cast<duel*>(d);
	out.hash = 1469598103934665603ull;
	bool win = false;
	Pending pend;
	auto living_other = [&](int who, int not_this) {
		for(int q = 0; q < sc.n; ++q)
			if(q != who && q != not_this && q != sc.eliminate) return q;
		return -1;
	};
	for(int steps = 0; steps < 20000; ++steps) {
		const int status = OCG_DuelProcess(d);
		uint32_t length = 0;
		const auto* buf = static_cast<const uint8_t*>(OCG_DuelGetMessage(d, &length));
		out.hash = fnv(out.hash, buf, length);
		std::vector<Msg> msgs;
		for(uint32_t off = 0; off + 4 <= length;) {
			uint32_t size = 0;
			std::memcpy(&size, buf + off, 4);
			if(size > 0) {
				msgs.push_back({ buf[off + 4], buf + off + 5, size - 1 });
				if(buf[off + 4] == MSG_NEW_TURN)
					++out.turns;
				if(buf[off + 4] == MSG_WIN)
					win = true;
				if(buf[off + 4] == MSG_HINT && size - 1 >= 1 && buf[off + 5] == HINT_PLACE_SEAT)
					++g_hint_msgs;
			}
			off += 4 + size;
		}
		if(status == OCG_DUEL_STATUS_END || win) {
			out.why = "duel ended";
			break;
		}
		if(status != OCG_DUEL_STATUS_AWAITING)
			continue;
		++out.prompts;
		if(pd->lua->scopes.size() != 0)
			++out.depth_bad;
		const Msg* m = msgs.empty() ? nullptr : &msgs.back();
		if(!m) { out.why = "awaiting without a message"; break; }
		auto answer32 = [&](int32_t v) { OCG_DuelSetResponse(d, &v, sizeof(v)); };
		auto answer_place = [&](int seat) {
			// the first free zone of that side: the low half is the chooser, the high half the other one
			// (bits 0-6 monster zones, bits 8-12 Spell zones of each half)
			const bool own = seat == pend.who;
			const int base = own ? 0 : 16;
			uint8_t loc = LOCATION_MZONE, seq = 0;
			for(int i = 0; i < 13; ++i) {
				if(i == 7 || (i > 7 && i < 8)) continue;
				if(!(pend.flag & (1u << (base + i)))) {
					loc = i < 8 ? LOCATION_MZONE : LOCATION_SZONE;
					seq = static_cast<uint8_t>(i < 8 ? i : i - 8);
					break;
				}
			}
			const uint8_t r[3] = { static_cast<uint8_t>(seat), loc, seq };
			OCG_DuelSetResponse(d, r, sizeof(r));
		};
		// the answer to a place prompt: wrong seat first, then the hint seat
		if(pend.active && m->id == MSG_RETRY) {
			if(pend.stage == 1) {
				++g_counts[pend.fn + ".retry"];
				pend.stage = 2;
				answer_place(pend.right);
				continue;
			}
			EXPECT(false, "%s: the answer with the hint seat %d was rejected (prompt of seat %d)", pend.fn.c_str(), pend.right, pend.who);
			out.why = "right answer rejected";
			break;
		}
		if(pend.active) {
			// no RETRY: the last answer was accepted
			if(pend.stage == 1)
				EXPECT(false, "%s: the answer with seat %d (not the hint seat %d) was accepted", pend.fn.c_str(), pend.wrong, pend.hint);
			if(pend.stage == 2)
				++g_counts[pend.fn + ".accepted"];
			pend.active = false;
		}
		if(out.turns >= sc.turns) {
			out.ended_ok = true;
			break;
		}
		switch(m->id) {
		case MSG_SELECT_IDLECMD:
			if(sc.n > 2) {
				// the disable effects (no Reset) are in force: each seat has exactly the zones that the hint named for it
				for(int q = 0; q < sc.n; ++q)
					EXPECT((F(d).player[q].disabled_location & 0xffff) == g_dis_expect[q], "%s turn %d: seat %d has disabled zones %04x, want %04x",
					       sc.name, out.turns, q, F(d).player[q].disabled_location & 0xffff, g_dis_expect[q]);
			}
			answer32(7);
			break;
		case MSG_SELECT_OPTION: {
			// the F5 pick of one opponent: the options are exactly the living opponents of the prompted seat, ascending
			const int who = m->p[0], count = m->p[1];
			std::vector<int> seats;
			bool pick = count > 0;
			for(int i = 0; i < count; ++i) {
				uint64_t desc = 0;
				std::memcpy(&desc, m->p + 2 + 8 * i, 8);
				pick = pick && (desc >> 16) == 0xFFFE;
				seats.push_back(static_cast<int>(desc & 0xff));
			}
			if(pick && sc.n > 2) {
				++g_pick_prompts;
				EXPECT(seats == g_model.opponents(who), "%s: the pick prompt of seat %d does not list its living opponents", sc.name, who);
			}
			answer32(0);
			break;
		}
		case MSG_SELECT_YESNO: case MSG_SELECT_EFFECTYN: answer32(1); break;
		case MSG_SELECT_CHAIN: {
			const bool forced = m->size > 2 && m->p[2] != 0;
			answer32(forced ? 0 : -1);
			break;
		}
		case MSG_SORT_CHAIN: { const uint8_t r[1] = { 0xFF }; OCG_DuelSetResponse(d, r, 1); break; }
		case MSG_SELECT_POSITION: answer32(POS_FACEUP_ATTACK); break;
		case MSG_SELECT_CARD: {
			uint32_t min = 0;
			std::memcpy(&min, m->p + 2, 4);
			std::vector<uint32_t> r{ 0, min };
			for(uint32_t i = 0; i < min; ++i) r.push_back(i);
			OCG_DuelSetResponse(d, r.data(), static_cast<uint32_t>(r.size() * 4));
			break;
		}
		case MSG_SELECT_PLACE: case MSG_SELECT_DISFIELD: {
			uint32_t flag = 0;
			std::memcpy(&flag, m->p + 2, 4);
			pend = Pending();
			pend.who = m->p[0];
			pend.flag = flag;
			pend.id = m->id;
			pend.fn = g_cur.fn;
			// the hint right before this message
			if(msgs.size() >= 2) {
				const Msg& h = msgs[msgs.size() - 2];
				if(h.id == MSG_HINT && h.size >= 10 && h.p[0] == HINT_PLACE_SEAT) {
					uint64_t t = 0;
					std::memcpy(&t, h.p + 2, 8);
					pend.hint = static_cast<int>(t);
					EXPECT(h.p[1] == pend.who, "%s: the hint player %u is not the prompted seat %u", g_cur.fn.c_str(), h.p[1], pend.who);
				}
			}
			const bool high_open = (~flag & 0xffff0000u) != 0;
			const bool low_open = (~flag & 0x0000ffffu & 0x7f7f) != 0;
			if(sc.n > 2 && g_cur.in_call && high_open) {
				EXPECT(pend.hint == g_cur.exp, "%s seat %d turn %d: hint seat %d, want %d (flag %08x)", g_cur.fn.c_str(), g_cur.P, g_cur.T, pend.hint, g_cur.exp, flag);
				EXPECT(pend.who == g_cur.P, "%s: prompt went to seat %d, want %d", g_cur.fn.c_str(), pend.who, g_cur.P);
				if(sc.eliminate >= 0)
					EXPECT(pend.hint != sc.eliminate, "%s: the hint names the eliminated seat", g_cur.fn.c_str());
				if(pend.hint == g_cur.exp)
					++g_counts[g_cur.fn + ".hint"];
				pend.active = true;
				pend.stage = 1;
				pend.right = pend.hint >= 0 ? pend.hint : living_other(pend.who, -1);
				pend.wrong = living_other(pend.who, pend.right);
				EXPECT(pend.wrong >= 0, "%s: no wrong seat to try", g_cur.fn.c_str());
				answer_place(pend.wrong >= 0 ? pend.wrong : pend.right);
			} else if(sc.n > 2 && !high_open) {
				EXPECT(pend.hint == -1, "%s: a hint, but the mask offers no opponent zone (flag %08x)", g_cur.fn.c_str(), flag);
				answer_place(pend.who);
			} else if(sc.n == 2) {
				EXPECT(pend.hint == -1, "n2 %s: a hint at n == 2", g_cur.fn.c_str());
				answer_place(low_open ? pend.who : 1 - pend.who);
			} else {
				answer_place(pend.who);
			}
			break;
		}
		default: {
			char b[64];
			std::snprintf(b, sizeof(b), "unhandled prompt %u", static_cast<unsigned>(m->id));
			out.why = b;
			break;
		}
		}
		if(!out.why.empty())
			break;
	}
	if(!out.ended_ok && out.why.empty())
		out.why = "step limit";
	g_duel = nullptr;
	OCG_DestroyDuel(d);
	return out;
}

static void report(const Scenario& sc, const Outcome& out) {
	EXPECT(out.ended_ok, "%s: the duel did not reach turn %d: %s (turns=%d)", sc.name, sc.turns, out.why.c_str(), out.turns);
	EXPECT(g_firings > 0, "%s: no operation ran", sc.name);
	EXPECT(out.depth_bad == 0, "%s: scope depth not 0 at %zu of %zu prompts", sc.name, out.depth_bad, out.prompts);
	EXPECT(g_errors == 0, "%s: %ld Lua errors, first: %s", sc.name, g_errors, g_error_text.empty() ? "" : g_error_text[0].c_str());
	if(sc.n > 2) {
		for(const char* fn : { "spsum", "movef", "sset", "disfield", "fieldzone" }) {
			const std::string k = fn;
			EXPECT(g_counts[k + ".hint"] > 0, "%s: %s never gave a hint prompt", sc.name, fn);
			EXPECT(g_counts[k + ".retry"] == g_counts[k + ".hint"], "%s: %s: %d wrong answers rejected of %d hint prompts", sc.name, fn, g_counts[k + ".retry"], g_counts[k + ".hint"]);
			EXPECT(g_counts[k + ".accepted"] == g_counts[k + ".hint"], "%s: %s: %d right answers accepted of %d hint prompts", sc.name, fn, g_counts[k + ".accepted"], g_counts[k + ".hint"]);
		}
		EXPECT(g_pick_prompts > 0, "%s: no opponent pick prompt (the own-turn cases must ask the activator)", sc.name);
		EXPECT(g_counts["disfield.applied"] >= 2, "%s: disfield: the disable effect ran only %d times", sc.name, g_counts["disfield.applied"]);
		EXPECT(g_counts["disfield.applied_not_turn"] > 0, "%s: no disfield call where the disabled seat is not the turn player", sc.name);
		for(const char* fn : { "spsum", "movef", "sset" })
			EXPECT(g_counts[std::string(fn) + ".landed"] == g_counts[std::string(fn) + ".hint"], "%s: %s: landed %d of %d", sc.name, fn, g_counts[std::string(fn) + ".landed"], g_counts[std::string(fn) + ".hint"]);
	} else {
		EXPECT(g_hint_msgs == 0, "%s: %d place hints at n == 2", sc.name, g_hint_msgs);
	}
	std::printf("%-6s n=%d firings=%d prompts=%zu hints=%d | hint/retry/accepted/landed: spsum %d/%d/%d/%d movef %d/%d/%d/%d sset %d/%d/%d/%d disfield %d/%d/%d (effect applied %d times, %d with a seat that is not the turn player) fieldzone %d/%d/%d\n",
	            sc.name, sc.n, g_firings, out.prompts, g_hint_msgs,
	            g_counts["spsum.hint"], g_counts["spsum.retry"], g_counts["spsum.accepted"], g_counts["spsum.landed"],
	            g_counts["movef.hint"], g_counts["movef.retry"], g_counts["movef.accepted"], g_counts["movef.landed"],
	            g_counts["sset.hint"], g_counts["sset.retry"], g_counts["sset.accepted"], g_counts["sset.landed"],
	            g_counts["disfield.hint"], g_counts["disfield.retry"], g_counts["disfield.accepted"], g_counts["disfield.applied"], g_counts["disfield.applied_not_turn"],
	            g_counts["fieldzone.hint"], g_counts["fieldzone.retry"], g_counts["fieldzone.accepted"]);
}

int main(int argc, char** argv) {
	const std::string only = argc > 1 ? argv[1] : "";
	auto want = [&](const char* n) { return only.empty() || only == n; };
	const std::vector<Scenario> scenarios = {
		{ "ffa3", 3, { 0, 1, 2 }, true, 7 },
		{ "ffa4", 4, { 0, 1, 2, 3 }, true, 9 },
		{ "tag", 4, { 0, 1, 0, 1 }, true, 9 },
		{ "ffa4e", 4, { 0, 1, 2, 3 }, true, 9, 1 },
	};
	for(const auto& sc : scenarios) {
		if(!want(sc.name)) continue;
		const Outcome out = play(sc);
		report(sc, out);
	}
	if(want("n2") || want("n2s")) {
		Scenario a{ "n2", 2, { 0, 1 }, false, 6 };
		Scenario b{ "n2s", 2, { 0, 1 }, true, 6 };
		const Outcome oa = play(a);
		report(a, oa);
		const Outcome ob = play(b);
		report(b, ob);
		EXPECT(oa.hash == ob.hash, "n2: message bytes differ between plain and setup-always (%llx vs %llx)", static_cast<unsigned long long>(oa.hash), static_cast<unsigned long long>(ob.hash));
		std::printf("n2     message bytes plain == setup-always: %s (hash %016llx)\n", oa.hash == ob.hash ? "yes" : "NO", static_cast<unsigned long long>(oa.hash));
	}
	if(failures) {
		std::printf("F8 CHECK FAIL: %d failure(s)\n", failures);
		return 1;
	}
	std::printf("F8 CHECK OK\n");
	return 0;
}
