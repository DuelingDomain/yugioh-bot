// F4 native check: the library functions of libcard / libgroup / libeffect under the perspective fold.
// Build and run: bash packages/duel-server/scripts/native/checks/run.sh <check name> (see README.md).
// It links the dev tree core built with -DYGO_N_TRAP -D_GLIBCXX_ASSERTIONS.
// Scenarios (each one plays whole turns; every seat owns a test card, code 90001 + seat, in its monster zone):
//   ffa3, ffa4, tag     n > 2: Card.IsControler / GetControler / card info inside a filter, Group.Select with tp and 1-tp
//                       (who gets the prompt), an Effect.SetOwnerPlayer / GetOwnerPlayer / count limit round trip
//   ffa4e               FFA4 with seat 1 marked eliminated: no prompt may go to seat 1
//   n2, n2s             n == 2 without and with Debug.SetupDuelists(2,0,1): same message bytes and raw ids
// The test card is a mandatory trigger on EVENT_PHASE+PHASE_STANDBY (as in the F1 check).
// F5 binding: the operation reads Duel.GetTurnPlayer() first. On the turn of an opponent that read binds this opponent
// (silent). On an own turn the first yieldable read of "1" (Card.IsType with the viewer 1-tp) asks the activator which
// opponent it means (MSG_SELECT_OPTION, every desc 0xFFFE0000|seat, ascending, living opponents only). The driver answers 0:
// the bound opponent is the lowest living opponent. Group.Select(1-tp) and SetOwnerPlayer(1-tp) then use that seat.
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
	Debug.Message(string.format("F4 who s=%d tp=%d turn=%d own=%d hp=%d ctl=%d owner=%d",seat,tp,Duel.GetTurnPlayer(),e:GetOwnerPlayer(),e:GetHandlerPlayer(),c:GetControler(),c:GetOwner()))
	local g=Duel.GetFieldGroup(tp,LOCATION_MZONE,LOCATION_MZONE)
	local opp=g:Filter(function(tc) return tc:IsControler(1-tp) end,nil)
	local mine=g:Filter(function(tc) return tc:IsControler(tp) end,nil)
	local tc=opp:GetFirst()
	Debug.Message(string.format("F4 filt s=%d all=%d opp=%d mine=%d tcode=%d tctl=%d tprev=%d tsum=%d",seat,g:GetCount(),opp:GetCount(),mine:GetCount(),tc:GetCode(),tc:GetControler(),tc:GetPreviousControler(),tc:GetSummonPlayer()))
	Debug.Message(string.format("F4 info s=%d type=%s race=%s attr=%s code=%d setcode=%s sumplayer=%s",seat,
		tostring(tc:IsType(TYPE_MONSTER,nil,0,1-tp)),tostring(tc:IsRace(1,nil,0,1-tp)),tostring(tc:IsAttribute(1,nil,0,tp)),tc:GetCode(nil,0,1-tp),
		tostring(tc:IsSetCard(0x1,nil,0,1-tp)),tostring(tc:IsSummonPlayer(1-tp))))
	Debug.Message(string.format("F4 cond s=%d hand=%s rem=%s disc=%s ssetable=%s sp=%s link=%d",seat,
		tostring(tc:IsAbleToHand(1-tp)),tostring(tc:IsAbleToRemove(tp)),tostring(tc:IsDiscardable(REASON_COST,1-tp)),tostring(tc:IsSSetable(false,1-tp)),
		tostring(c:IsCanBeSpecialSummoned(e,0,tp,false,false,POS_FACEUP,1-tp)),c:GetLinkedZone(1-tp)))
	local e2=Effect.CreateEffect(c)
	e2:SetOwnerPlayer(1-tp)
	local o1=e2:GetOwnerPlayer()
	e2:SetOwnerPlayer(tp)
	local o2=e2:GetOwnerPlayer()
	e2:SetOwnerPlayer(7)
	local o3=e2:GetOwnerPlayer()
	e2:SetCountLimit(1,90100+seat)
	local k1=e2:CheckCountLimit(tp)
	e2:UseCountLimit(tp)
	local k2=e2:CheckCountLimit(tp)
	local k3=e2:CheckCountLimit(1-tp)
	e2:RestoreCountLimit(tp)
	local k4=e2:CheckCountLimit(tp)
	Debug.Message(string.format("F4 eff s=%d o1=%d o2=%d o3=%d k=%s,%s,%s,%s",seat,o1,o2,o3,tostring(k1),tostring(k2),tostring(k3),tostring(k4)))
	-- SetAbsoluteRange through the real consumer (effect.cpp): a field effect of +500 ATK on the test card (Duel.RegisterEffect folds in F3a). A string of 4 digits per
	-- named value: digit i is 1 when the monster of seat i got the boost. The ATK is read after every registration.
	local function snap()
		local t={}
		local tc=g:GetFirst()
		while tc do t[tc:GetCode()-90001]=tc:GetAttack() tc=g:GetNext() end
		return t
	end
	local function boosted(t0,t1)
		local r=""
		for i=0,3 do r=r..((t0[i] and t1[i] and t1[i]>t0[i]) and "1" or "0") end
		return r
	end
	local function absboost(named)
		local t0=snap()
		local e3=Effect.CreateEffect(c)
		e3:SetType(EFFECT_TYPE_FIELD)
		e3:SetCode(EFFECT_UPDATE_ATTACK)
		e3:SetValue(500)
		e3:SetAbsoluteRange(named,LOCATION_MZONE,0)
		e3:SetRange(LOCATION_MZONE)
		e3:SetReset(RESET_EVENT+RESETS_STANDARD)
		c:RegisterEffect(e3)
		return boosted(t0,snap())
	end
	local ra=absboost(tp)
	local rb=absboost(1-tp)
	local rc=absboost(0)
	Debug.Message(string.format("F4 abs s=%d a=%s b=%s c=%s",seat,ra,rb,rc))
	local sg=g:Select(tp,1,1,nil)
	Debug.Message(string.format("F4 sel1 s=%d tp=%d got=%d",seat,tp,sg:GetCount()))
	local sg2=g:Select(1-tp,1,1,nil)
	Debug.Message(string.format("F4 sel2 s=%d tp=%d got=%d",seat,tp,sg2:GetCount()))
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
	std::string n(name);
	std::replace(n.begin(), n.end(), '\\', '/');
	const auto slash = n.find_last_of('/');
	const std::string base = slash == std::string::npos ? n : n.substr(slash + 1);
	std::string text;
	if(base.size() > 6 && base.compare(0, 1, "c") == 0 && base.compare(base.size() - 4, 4, ".lua") == 0) {
		const uint32_t code = static_cast<uint32_t>(std::strtoul(base.c_str() + 1, nullptr, 10));
		if(code >= kTestBase && code < kTestBase + 4)
		{
			// "multi" guards the probe with a value that is not a seat: at n == 2 the core is the stock one and
			// indexes player[] with it.
			text = std::string("local multi=") + (static_cast<struct duel*>(duel)->game_field->n_duelists > 2 ? "true" : "false") + "\n" + kTestScript;
			if(const char* cut = std::getenv("CHECK_CUT")) {
				const auto pos = text.find(cut);
				if(pos != std::string::npos)
					text.replace(pos, std::strlen(cut), "--");
			}
		}
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

struct Rec {
	std::string text;
	int turn_player;         // raw seat at the time of the log line
	int lp[MAX_DUELISTS];    // raw lp_ref of every seat at the time of the log line
};
static std::vector<Rec> g_recs;
static long g_errors = 0;
static std::vector<std::string> g_error_text;
static OCG_Duel g_duel = nullptr;

static field& F(OCG_Duel d) { return *static_cast<duel*>(d)->game_field; }

static void on_log(void*, const char* text, int type) {
	if(type == OCG_LOG_TYPE_ERROR || type == OCG_LOG_TYPE_UNDEFINED) {
		++g_errors;
		if(g_error_text.size() < 8)
			g_error_text.push_back(text ? text : "");
		if(std::getenv("CHECK_LOG"))
			std::fprintf(stderr, "core log [%d]: %s\n", type, text);
		return;
	}
	if(text && std::strncmp(text, "F4 ", 3) == 0 && g_duel) {
		Rec r;
		r.text = text;
		auto& f = F(g_duel);
		r.turn_player = f.infos.turn_player;
		for(int i = 0; i < MAX_DUELISTS; ++i)
			r.lp[i] = i < f.n_duelists ? f.lp_ref(static_cast<uint8_t>(i)) : 0;
		if(std::getenv("CHECK_LOG"))
			std::fprintf(stderr, "T=%d lp=%d,%d,%d,%d %s\n", r.turn_player, r.lp[0], r.lp[1], r.lp[2], r.lp[3], text);
		g_recs.push_back(std::move(r));
	}
}

// ---- duel setup and driver
struct Scenario {
	const char* name;
	int n;
	std::vector<int> team;
	bool setup_call;      // call Debug.SetupDuelists (always for n > 2)
	bool test_cards;      // a test card in the monster zone of every seat
	int turns;
	int eliminate = -1;   // mark this seat eliminated after the start
};

struct Outcome {
	uint64_t hash = 0;
	int turns = 0;
	size_t depth_bad = 0;     // prompts at which the scope depth was not 0
	size_t prompts = 0;
	size_t picks = 0;         // F5 pick prompts (every option 0xFFFE0000|seat) that were answered
	std::vector<std::string> pick_bad;  // a pick prompt that is not the ascending list of the living opponents of the asked seat
	std::vector<std::string> nfold;
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

static Outcome play(const Scenario& sc) {
	Outcome out;
	g_recs.clear();
	g_errors = 0;
	g_error_text.clear();
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
	if(sc.test_cards)
		for(int s = 0; s < sc.n; ++s)
			add_card(d, static_cast<uint8_t>(s), LOCATION_MZONE, kTestBase + s, POS_FACEUP_ATTACK);
	OCG_StartDuel(d);
	if(sc.eliminate >= 0)
		F(d).player[sc.eliminate].eliminated = true;

	auto* pd = static_cast<duel*>(d);
	out.hash = 1469598103934665603ull;
	bool win = false;
	for(int steps = 0; steps < 20000; ++steps) {
		const int status = OCG_DuelProcess(d);
		uint32_t length = 0;
		const auto* buf = static_cast<const uint8_t*>(OCG_DuelGetMessage(d, &length));
		out.hash = fnv(out.hash, buf, length);
		struct Msg { uint8_t id; const uint8_t* p; uint32_t size; };
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
		if(out.turns >= sc.turns) {
			out.ended_ok = true;
			break;
		}
		const Msg* m = msgs.empty() ? nullptr : &msgs.back();
		if(m && std::getenv("CHECK_LOG"))
			std::fprintf(stderr, "prompt msg=%u size=%u turn=%d tp=%d phase=%d\n", static_cast<unsigned>(m->id), m->size, out.turns, F(d).infos.turn_player, F(d).infos.phase);
		if(m && std::getenv("CHECK_LOG")) {
			std::string hex;
			char b[4];
			for(uint32_t i = 0; i < m->size; ++i) { std::snprintf(b, sizeof(b), "%02x ", m->p[i]); hex += b; }
			std::fprintf(stderr, "  bytes: %s\n", hex.c_str());
		}
		if(!m) { out.why = "awaiting without a message"; break; }
		auto answer32 = [&](int32_t v) { OCG_DuelSetResponse(d, &v, sizeof(v)); };
		switch(m->id) {
		case MSG_SELECT_IDLECMD: answer32(7); break;
		case MSG_SELECT_YESNO: case MSG_SELECT_EFFECTYN: answer32(1); break;
		case MSG_SELECT_OPTION: {
			// u8 player, u8 count, count x u64 desc: the F5 pick of an opponent is answered with option 0
			const int who = m->p[0], count = m->p[1];
			std::vector<int> seats, want;
			bool pick = count > 0;
			for(int i = 0; i < count; ++i) {
				uint64_t desc = 0;
				std::memcpy(&desc, m->p + 2 + 8 * i, 8);
				pick = pick && (desc >> 16) == 0xFFFE;
				seats.push_back(static_cast<int>(desc & 0xff));
			}
			if(pick) {
				++out.picks;
				for(int q = 0; q < sc.n; ++q)
					if(who >= 0 && who < sc.n && sc.team[q] != sc.team[who] && q != sc.eliminate) want.push_back(q);
				if(seats != want || seats.size() < 2)
					out.pick_bad.push_back("seat " + std::to_string(who) + " got " + std::to_string(seats.size()) + " options");
			}
			answer32(0);
			break;
		}
		case MSG_SELECT_CHAIN: {
			const bool forced = m->size > 2 && m->p[2] != 0;
			answer32(forced ? 0 : -1);
			break;
		}
		case MSG_SORT_CHAIN: { const uint8_t r[1] = { 0xFF }; OCG_DuelSetResponse(d, r, 1); break; }
		case MSG_SELECT_CARD: {
			{
				Rec pr;
				pr.text = "F4 prompt p=" + std::to_string(m->p[0]);
				pr.turn_player = F(d).infos.turn_player;
				std::memset(pr.lp, 0, sizeof(pr.lp));
				g_recs.push_back(std::move(pr));
			}
			uint32_t min = 0;
			std::memcpy(&min, m->p + 2, 4);
			std::vector<uint32_t> r{ 0, min };
			for(uint32_t i = 0; i < min; ++i) r.push_back(i);
			OCG_DuelSetResponse(d, r.data(), static_cast<uint32_t>(r.size() * 4));
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

// ---- stderr capture for the NFOLD records
static std::vector<std::string> run_captured(const Scenario& sc, Outcome& out) {
	std::vector<std::string> lines;
	std::string path_template = check_tmp_template("f4-check-stderr"); char* path = path_template.data();
	const bool capture = !std::getenv("CHECK_NOCAPTURE");
	int fd = -1, saved = -1;
	if(capture) {
		fd = mkstemp(path);
		if(fd >= 0) {
			std::fflush(stderr);
			saved = dup(2);
			dup2(fd, 2);
		}
	}
	out = play(sc);
	if(capture && fd >= 0) {
		std::fflush(stderr);
		dup2(saved, 2);
		close(saved);
		close(fd);
		std::ifstream in(path);
		std::string line;
		while(std::getline(in, line)) {
			if(line.compare(0, 6, "NFOLD ") == 0)
				lines.push_back(line);
			else
				std::fprintf(stderr, "%s\n", line.c_str());
		}
		unlink(path);
	}
	return lines;
}

// ---- expectations
struct Model {
	int n;
	bool tag;
	std::vector<int> team;
	int eliminate = -1;
	bool fold() const { return n > 2; }
	int team_of(int s) const { return team[s]; }
	bool same_team(int a, int b) const { return team[a] == team[b]; }
	// the value that Lua sees for the core seat d, in the scope of seat P
	int f(int P, int d) const {
		if(!fold()) return d;
		if(!tag) return d == P ? 0 : 1;
		return team_of(d);
	}
	// the living opponents of seat P, ascending
	std::vector<int> opponents(int P) const {
		std::vector<int> v;
		for(int q = 0; q < n; ++q)
			if(!same_team(P, q) && q != eliminate) v.push_back(q);
		return v;
	}
	// the opponent that "1" means during the operation of the card of seat P on the turn of seat T: the turn player when it
	// is an opponent (the GetTurnPlayer read binds it), else the pick (option 0 = the lowest living opponent)
	int bound(int P, int T) const {
		if(!fold()) return 1 - P;
		if(!same_team(P, T)) return T;
		const auto v = opponents(P);
		return v.empty() ? -1 : v[0];
	}
};

static std::map<std::string, std::string> fields(const std::string& text) {
	std::map<std::string, std::string> m;
	std::istringstream ss(text);
	std::string tok;
	ss >> tok;  // "F4"
	ss >> tok;  // kind
	m["kind"] = tok;
	while(ss >> tok) {
		const auto eq = tok.find('=');
		if(eq != std::string::npos)
			m[tok.substr(0, eq)] = tok.substr(eq + 1);
	}
	return m;
}

static int count_kind(const std::vector<std::string>& nfold, char kind, const char* fn = nullptr) {
	int c = 0;
	for(const auto& l : nfold) {
		if(l.size() > 6 && l[6] == kind && (!fn || l.find(std::string("fn=") + fn) != std::string::npos))
			++c;
	}
	return c;
}

static std::map<std::string, std::string> fields_of(const std::string& text) { return fields(text); }

static int as_int(std::map<std::string, std::string>& m, const char* k) { return std::atoi(m[k].c_str()); }

static void check_test_cards(const Scenario& sc, const Outcome& out, const std::vector<std::string>& nfold) {
	Model M;
	M.n = sc.n;
	M.team = sc.team;
	M.eliminate = sc.eliminate;
	M.tag = sc.n > 2 && std::set<int>(sc.team.begin(), sc.team.end()).size() < static_cast<size_t>(sc.n);
	int firings = 0, sel1 = 0, sel2 = 0;
	std::vector<int> prompts;   // MSG_SELECT_CARD players since the last sel line
	for(const auto& r : g_recs) {
		auto m = fields_of(r.text);
		const std::string& k = m["kind"];
		if(k == "prompt") {
			prompts.push_back(as_int(m, "p"));
			if(sc.eliminate >= 0)
				EXPECT(as_int(m, "p") != sc.eliminate, "%s: a prompt went to the eliminated seat %d", sc.name, sc.eliminate);
			continue;
		}
		if(sc.eliminate >= 0 && k == "sel2")
			++sel2;   // the test card chose for 1-tp: it must have run, and no prompt went to the eliminated seat
		if(m.count("s") == 0 || sc.eliminate >= 0)
			continue;
		const int P = as_int(m, "s");
		const int T = r.turn_player;
		const int B = M.bound(P, T);
		if(k == "who") {
			++firings;
			prompts.clear();   // other card prompts (the end phase hand limit) are not ours
			EXPECT(as_int(m, "tp") == M.f(P, P) && as_int(m, "turn") == M.f(P, T), "%s: %s", sc.name, r.text.c_str());
			EXPECT(as_int(m, "own") == M.f(P, P) && as_int(m, "hp") == M.f(P, P) && as_int(m, "ctl") == M.f(P, P) && as_int(m, "owner") == M.f(P, P),
			       "%s: GetOwnerPlayer / GetHandlerPlayer / GetControler / GetOwner of the own card seat %d: %s, want %d", sc.name, P, r.text.c_str(), M.f(P, P));
		} else if(k == "filt") {
			const int want_opp = M.tag ? 2 : M.n - 1;
			const int want_mine = M.tag ? 2 : 1;
			EXPECT(as_int(m, "all") == M.n && as_int(m, "opp") == want_opp && as_int(m, "mine") == want_mine,
			       "%s: IsControler filter seat %d: %s, want all=%d opp=%d mine=%d", sc.name, P, r.text.c_str(), M.n, want_opp, want_mine);
			const int tseat = as_int(m, "tcode") - static_cast<int>(kTestBase);
			EXPECT(tseat >= 0 && tseat < M.n && !M.same_team(P, tseat), "%s: the first opponent card is of seat %d (own team?)", sc.name, tseat);
			EXPECT(as_int(m, "tctl") == M.f(P, tseat), "%s: GetControler of an opponent card (seat %d) seen by seat %d: %s, want %d", sc.name, tseat, P, r.text.c_str(), M.f(P, tseat));
		} else if(k == "info") {
			EXPECT(m["type"] == "true" && m["race"] == "true" && m["attr"] == "true" && !m["code"].empty(), "%s: card info with a viewer: %s", sc.name, r.text.c_str());
		} else if(k == "eff") {
			const int own = M.f(P, P);
			EXPECT(as_int(m, "o1") == M.f(P, B) && as_int(m, "o2") == own && as_int(m, "o3") == own,
			       "%s: SetOwnerPlayer round trip seat %d turn %d: %s, want o1=%d o2=%d o3=%d", sc.name, P, T, r.text.c_str(), M.f(P, B), own, own);
			EXPECT(m["k"] == "true,false,true,true", "%s: count limit round trip seat %d: %s", sc.name, P, r.text.c_str());
		} else if(k == "abs") {
			// The monsters of the seats whose folded value (as the script sees it) is the named player get the boost:
			// n > 2 FFA: tp = seat P only, 1-tp = every opponent. Tag: the team id names a whole team (so a seat of team 1
			// names its own team with tp, and the opponents with 0). n == 2: the stock seat.
			auto want_for = [&](int named) {
				std::string w;
				for(int i = 0; i < 4; ++i)
					w += (i < M.n && M.f(P, i) == named) ? '1' : '0';
				return w;
			};
			const std::string wa = want_for(M.f(P, P)), wb = want_for(M.fold() ? 1 - M.f(P, P) : 1 - P), wc = want_for(0);
			EXPECT(m["a"] == wa && m["b"] == wb && m["c"] == wc, "%s: SetAbsoluteRange seat %d: a=%s b=%s c=%s, want a=%s b=%s c=%s",
			       sc.name, P, m["a"].c_str(), m["b"].c_str(), m["c"].c_str(), wa.c_str(), wb.c_str(), wc.c_str());
		} else if(k == "sel1" || k == "sel2") {
			if(k == "sel1") ++sel1; else ++sel2;
			EXPECT(prompts.size() == 1, "%s: %s seat %d: %zu card prompts before the log line", sc.name, k.c_str(), P, prompts.size());
			if(!prompts.empty()) {
				const int want = k == "sel1" ? P : B;
				EXPECT(prompts.back() == want, "%s: Group.Select(%s) seat %d turn %d: the prompt went to seat %d, want seat %d", sc.name, k == "sel1" ? "tp" : "1-tp", P, T, prompts.back(), want);
			}
			EXPECT(as_int(m, "got") == 1 && as_int(m, "tp") == M.f(P, P), "%s: after the Select yield seat %d: %s", sc.name, P, r.text.c_str());
			prompts.clear();
		}
	}
	if(sc.eliminate >= 0)
		EXPECT(sel2 > 0, "%s: no Group.Select(1-tp) ran", sc.name);
	else
		EXPECT(firings > 0 && firings == sel1 && firings == sel2, "%s: %d operations, %d sel1, %d sel2", sc.name, firings, sel1, sel2);
	EXPECT(out.depth_bad == 0, "%s: scope depth not 0 at %zu of %zu prompts", sc.name, out.depth_bad, out.prompts);
	EXPECT(g_errors == 0, "%s: %ld Lua errors, first: %s", sc.name, g_errors, g_error_text.empty() ? "" : g_error_text[0].c_str());
	if(M.fold()) {
		// one kind (d) record per firing: SetOwnerPlayer(7); nothing else of F4 may write kind (d), (b) or (c)
		if(sc.eliminate < 0)
			EXPECT(count_kind(nfold, 'd') == firings, "%s: %d kind (d) records, want %d", sc.name, count_kind(nfold, 'd'), firings);
		EXPECT(count_kind(nfold, 'b') == 0, "%s: %d kind (b) records (a binding conflict)", sc.name, count_kind(nfold, 'b'));
		// F5: no unbound fallback (a). The first read of a single "1" in a yieldable operation is Card.IsType with the viewer
		// 1-tp: on an own turn of a seat with at least 2 living opponents the core asks for a pick (kind c, fn=IsType, one per
		// firing); on an opponent's turn the GetTurnPlayer read has bound the turn player; one living opponent binds silently.
		int want_picks = 0;
		for(const auto& r : g_recs) {
			auto m = fields_of(r.text);
			if(m["kind"] != "who") continue;
			const int P = as_int(m, "s");
			if(M.same_team(P, r.turn_player) && M.opponents(P).size() >= 2) ++want_picks;
		}
		EXPECT(count_kind(nfold, 'a') == 0, "%s: %d kind (a) records (an unbound fallback), want 0", sc.name, count_kind(nfold, 'a'));
		EXPECT(count_kind(nfold, 'c') == want_picks && count_kind(nfold, 'c', "IsType") == want_picks, "%s: %d kind (c) records (%d from IsType), want %d", sc.name,
		       count_kind(nfold, 'c'), count_kind(nfold, 'c', "IsType"), want_picks);
		EXPECT(out.picks == static_cast<size_t>(want_picks), "%s: %zu pick prompts, want %d", sc.name, out.picks, want_picks);
		EXPECT(out.pick_bad.empty(), "%s: a pick prompt is wrong: %s", sc.name, out.pick_bad.empty() ? "" : out.pick_bad[0].c_str());
		for(const auto& l : nfold)
			if(l.size() > 6 && l[6] == 'd' && l.find("fn=SetOwnerPlayer") == std::string::npos)
				EXPECT(false, "%s: kind (d) record of another function: %s", sc.name, l.c_str());
	} else {
		EXPECT(nfold.empty() && out.picks == 0, "%s: %zu fold records and %zu pick prompts at n == 2", sc.name, nfold.size(), out.picks);
	}
	std::printf("%-6s n=%d firings=%d prompts=%zu picks=%zu depth-bad=%zu errors=%ld nfold(a/b/c/d)=%d/%d/%d/%d\n", sc.name, sc.n, firings,
	            out.prompts, out.picks, out.depth_bad, g_errors, count_kind(nfold, 'a'), count_kind(nfold, 'b'), count_kind(nfold, 'c'), count_kind(nfold, 'd'));
	// per function counts (the lead reads these)
	std::map<std::string, int> per;
	for(const auto& l : nfold) {
		const auto p = l.find("fn=");
		if(p != std::string::npos)
			++per[std::string(1, l[6]) + ":" + l.substr(p + 3)];
	}
	for(const auto& kv : per)
		std::printf("         %s x%d\n", kv.first.c_str(), kv.second);
}

int main(int argc, char** argv) {
	const std::string only = argc > 1 ? argv[1] : "";
	auto want = [&](const char* n) { return only.empty() || only == n; };
	const std::vector<Scenario> scenarios = {
		{ "ffa3", 3, { 0, 1, 2 }, true, true, 7 },
		{ "ffa4", 4, { 0, 1, 2, 3 }, true, true, 9 },
		{ "tag", 4, { 0, 1, 0, 1 }, true, true, 9 },
		{ "ffa4e", 4, { 0, 1, 2, 3 }, true, true, 9, 1 },
	};
	for(const auto& sc : scenarios) {
		if(!want(sc.name)) continue;
		Outcome out;
		const auto nfold = run_captured(sc, out);
		EXPECT(out.ended_ok, "%s: the duel did not reach turn %d: %s (turns=%d)", sc.name, sc.turns, out.why.c_str(), out.turns);
		check_test_cards(sc, out, nfold);
	}
	if(want("n2") || want("n2s")) {
		Scenario a{ "n2", 2, { 0, 1 }, false, true, 6 };
		Scenario b{ "n2s", 2, { 0, 1 }, true, true, 6 };
		Outcome oa, ob;
		const auto na = run_captured(a, oa);
		const std::vector<Rec> recs_a = g_recs;
		const auto nb = run_captured(b, ob);
		EXPECT(oa.ended_ok && ob.ended_ok, "n2: the duels did not finish: %s / %s", oa.why.c_str(), ob.why.c_str());
		check_test_cards(b, ob, nb);
		EXPECT(oa.hash == ob.hash, "n2: message bytes differ between plain and setup-always (%llx vs %llx)", static_cast<unsigned long long>(oa.hash), static_cast<unsigned long long>(ob.hash));
		std::vector<std::string> ta, tb;
		for(const auto& r : recs_a) ta.push_back(r.text);
		for(const auto& r : g_recs) tb.push_back(r.text);
		EXPECT(ta == tb && !ta.empty(), "n2: the Lua log differs between plain and setup-always");
		EXPECT(na.empty(), "n2: fold records in the plain run");
		std::printf("n2     message bytes plain == setup-always: %s (hash %016llx), %zu log lines equal\n", oa.hash == ob.hash ? "yes" : "NO", static_cast<unsigned long long>(oa.hash), ta.size());
	}
	if(failures) {
		std::printf("F4 CHECK FAIL: %d failure(s)\n", failures);
		return 1;
	}
	std::printf("F4 CHECK OK\n");
	return 0;
}
