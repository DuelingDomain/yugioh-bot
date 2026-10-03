// F1 native check: the Lua perspective fold on the core side (scope, folded params, fold API, vertical slice).
// Build and run: bash packages/duel-server/scripts/native/checks/run.sh <check name> (see README.md).
// It links the dev tree core built with -DYGO_N_TRAP -D_GLIBCXX_ASSERTIONS (the scope depth assert is on).
// Scenarios (each one plays whole turns; every seat owns a test card, code 90001 + seat, in its monster zone):
//   ffa3, ffa4, tag     n > 2: the folded values that cost/target/operation get, the slice, the yield, the fold records
//   n2, n2s             n == 2 without and with Debug.SetupDuelists(2,0,1): same message bytes, raw ids, no records
//   nibiru              FFA3, Nibiru (27204311) in the hand of seat 2: no Lua error, its condition runs with tp = 0
// The test card is a mandatory trigger on EVENT_PHASE+PHASE_STANDBY. It fires in the Standby Phase of every duelist,
// so ep (the event player) is the turn player: the own side on its own turn, an opponent on the others.
// SetCountLimit(1) is needed: the core offers a phase trigger again after each resolution.
// F5 (opponent binding, core 29fff80): "1" is one opponent, bound for the whole chain link. The test card reads "1" first
// in its operation (GetLocationCount), after the turn player is read. On the turn of an opponent that read binds that
// opponent. On a turn of the own team nothing is bound, so the core asks the activator to pick one (MSG_SELECT_OPTION,
// every desc 0xFFFE0000|seat, ascending, living opponents only; the pick happens in the operation step, kind (c)
// record). The harness answers option k % options for pick number k, so the bound seat changes from firing to firing and a
// core that ignores the answer fails. With one living opponent the bind is silent (no
// prompt, no record). Scope: the test card has no target or cost, so every pick here is the fallback pick of the operation step;
// the pick at activation is covered by opponent-pick, and a bound opponent that is eliminated after the bind by zone-seat-sset. No guess is ever made: no kind (a) record (unbound fallback), no kind (b) (conflict).
//   ffa3e               FFA3 with seat 2 eliminated: every seat has one living opponent, so no pick prompt at all
// Its operation logs through Debug.Message ("F1 ..." lines, tagged with s=<seat of the card>), asks for a Select
// prompt (SelectYesNo after Duel.Damage, which yields too) and logs again after the resume.
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
static const uint32_t kNibiru = 27204311;

static const char* kTestScript = R"LUA(
local s,id=GetID()
local seat=id-90001
function s.initial_effect(c)
	local e1=Effect.CreateEffect(c)
	e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_F)
	e1:SetCode(EVENT_PHASE+PHASE_STANDBY)
	e1:SetRange(LOCATION_MZONE)
	e1:SetCountLimit(1)
	e1:SetCondition(s.con)
	e1:SetCost(s.cost)
	e1:SetTarget(s.tg)
	e1:SetOperation(s.op)
	c:RegisterEffect(e1)
end
function s.con(e,tp,eg,ep,ev,re,r,rp)
	Debug.Message(string.format("F1 con s=%d tp=%d ep=%d rp=%d",seat,tp,ep,rp))
	return true
end
function s.cost(e,tp,eg,ep,ev,re,r,rp,chk)
	Debug.Message(string.format("F1 cost s=%d chk=%d tp=%d ep=%d rp=%d",seat,chk,tp,ep,rp))
	return true
end
function s.tg(e,tp,eg,ep,ev,re,r,rp,chk)
	Debug.Message(string.format("F1 tg s=%d chk=%d tp=%d ep=%d rp=%d",seat,chk,tp,ep,rp))
	return true
end
function s.op(e,tp,eg,ep,ev,re,r,rp)
	Debug.Message(string.format("F1 op1 s=%d tp=%d ep=%d rp=%d turn=%d",seat,tp,ep,rp,Duel.GetTurnPlayer()))
	Debug.Message(string.format("F1 loc s=%d own=%d opp=%d",seat,Duel.GetLocationCount(tp,LOCATION_MZONE),Duel.GetLocationCount(1-tp,LOCATION_MZONE)))
	local og=Duel.GetDecktopGroup(1-tp,1):GetFirst()
	local own=Duel.GetDecktopGroup(tp,1):GetFirst()
	Debug.Message(string.format("F1 slice s=%d opp=%d own=%d oppIsOpp=%s ownIsOpp=%s ownIsOwn=%s ctl=%d",seat,og:GetCode(),own:GetCode(),
		tostring(og:IsControler(1-tp)),tostring(own:IsControler(1-tp)),tostring(own:IsControler(tp)),og:GetControler()))
	if multi then Debug.Message(string.format("F1 bad s=%d n=%d",seat,Duel.GetDecktopGroup(7,1):GetCount())) end
	Debug.Message(string.format("F1 lp0 s=%d own=%d opp=%d",seat,Duel.GetLP(tp),Duel.GetLP(1-tp)))
	Duel.Damage(1-tp,100,REASON_EFFECT)
	Debug.Message(string.format("F1 lp1 s=%d own=%d opp=%d",seat,Duel.GetLP(tp),Duel.GetLP(1-tp)))
	Duel.SelectYesNo(tp,0)
	Debug.Message(string.format("F1 op2 s=%d tp=%d isturn=%s turn=%d",seat,tp,tostring(Duel.IsTurnPlayer(tp)),Duel.GetTurnPlayer()))
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
	if(code == kNibiru) {
		data->type = TYPE_MONSTER | TYPE_EFFECT;
		data->level = 11;
		data->attribute = 0x10;
		data->race = 0x80;
		data->attack = 3000;
		data->defense = 600;
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

static bool g_instrument_nibiru = false;
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
		if(g_instrument_nibiru && base == "c27204311.lua") {
			// Log every run of the condition with the tp that it gets.
			text += "\nlocal _con=s.condition\ns.condition=function(e,tp,...) Debug.Message(string.format(\"F1 nib tp=%d\",tp)) return _con(e,tp,...) end\n";
		}
	}
	return OCG_LoadScript(duel, text.data(), static_cast<uint32_t>(text.size()), name);
}

struct Rec {
	std::string text;
	int turn_player;         // raw seat at the time of the log line
	int lp[MAX_DUELISTS];    // raw lp_ref of every seat at the time of the log line
	int chosen[MAX_DUELISTS];  // the seat that the last pick prompt of every seat bound (-1: none yet)
};
static std::vector<Rec> g_recs;
// the harness answers pick prompt number k with option k % options, so a core that ignores the answer binds a seat
// that the model does not expect
static int g_chosen[MAX_DUELISTS];
static size_t g_pick_no = 0;
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
	if(text && std::strncmp(text, "F1 ", 3) == 0 && g_duel) {
		Rec r;
		r.text = text;
		auto& f = F(g_duel);
		r.turn_player = f.infos.turn_player;
		for(int i = 0; i < MAX_DUELISTS; ++i)
			r.lp[i] = i < f.n_duelists ? f.lp_ref(static_cast<uint8_t>(i)) : 0;
		std::memcpy(r.chosen, g_chosen, sizeof(r.chosen));
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
	bool nibiru;          // Nibiru in the hand of seat 2
	int turns;
	int eliminate = -1;   // a seat that is marked eliminated after the start of the duel
};

struct Outcome {
	uint64_t hash = 0;
	int turns = 0;
	size_t depth_bad = 0;     // prompts at which the scope depth was not 0
	size_t prompts = 0;
	size_t picks = 0;                    // F5 pick prompts (every option 0xFFFE0000|seat) that were answered
	std::vector<std::string> pick_bad;   // a pick prompt that is not the ascending list of the living opponents
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
	for(int& c : g_chosen) c = -1;
	g_pick_no = 0;
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
	if(sc.nibiru)
		add_card(d, 2, LOCATION_HAND, kNibiru, POS_FACEDOWN_DEFENSE);
	OCG_StartDuel(d);
	if(sc.eliminate >= 0)
		F(d).eliminate(static_cast<uint8_t>(sc.eliminate), 0);  // as in a duel: the cards leave the field, a message 200 is sent

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
			// u8 player, u8 count, count x u64 desc
			const int who = m->p[0], count = m->p[1];
			std::vector<int> seats;
			bool pick = count > 0;
			for(int i = 0; i < count; ++i) {
				uint64_t desc = 0;
				std::memcpy(&desc, m->p + 2 + 8 * i, 8);
				pick = pick && (desc >> 16) == 0xFFFE;
				seats.push_back(static_cast<int>(desc & 0xff));
			}
			if(pick) {
				++out.picks;
				std::vector<int> want;
				for(int q = 0; q < sc.n; ++q)
					if(q != sc.eliminate && sc.team[q] != sc.team[who])
						want.push_back(q);
				if(seats != want || seats.size() < 2)
					out.pick_bad.push_back("seat " + std::to_string(who) + " got " + std::to_string(seats.size()) + " options");
			}
			int idx = 0;
			if(pick) {
				idx = static_cast<int>(g_pick_no++ % seats.size());
				g_chosen[who] = seats[idx];
			}
			answer32(idx);
			break;
		}
		case MSG_SELECT_CHAIN: {
			const bool forced = m->size > 2 && m->p[2] != 0;
			answer32(forced ? 0 : -1);
			break;
		}
		case MSG_SORT_CHAIN: { const uint8_t r[1] = { 0xFF }; OCG_DuelSetResponse(d, r, 1); break; }
		case MSG_SELECT_CARD: {
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
	std::string path_template = check_tmp_template("f1-check-stderr"); char* path = path_template.data();
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
	int eliminate = -1;
	std::vector<int> team;
	bool fold() const { return n > 2; }
	int team_of(int s) const { return team[s]; }
	bool same_team(int a, int b) const { return team[a] == team[b]; }
	// the value that Lua sees for the core seat d, in the scope of seat P
	int f(int P, int d) const {
		if(!fold()) return d;
		if(!tag) return d == P ? 0 : 1;
		return team_of(d);
	}
	// the living opponents of P, ascending: the options of the F5 pick prompt
	std::vector<int> opponents(int P) const {
		std::vector<int> r;
		for(int q = 0; q < n; ++q)
			if(q != eliminate && !same_team(P, q)) r.push_back(q);
		return r;
	}
	// the opponent that "1" means during the operation of the card of seat P on the turn of seat T (F5): the turn
	// player when it is an opponent (the read binds it); the only living opponent (silent bind); else the one that the
	// last pick prompt of seat P bound (chosen[P], the option that the harness answered)
	int bound(int P, int T, const int* chosen) const {
		if(!fold()) return 1 - P;
		if(!same_team(P, T)) return T;
		const auto o = opponents(P);
		if(o.empty()) return -1;
		return o.size() == 1 ? o[0] : chosen[P];
	}
};

static std::map<std::string, std::string> fields(const std::string& text) {
	std::map<std::string, std::string> m;
	std::istringstream ss(text);
	std::string tok;
	ss >> tok;  // "F1"
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

static void check_test_cards(const Scenario& sc, const Outcome& out, const std::vector<std::string>& nfold) {
	Model M;
	M.n = sc.n;
	M.team = sc.team;
	M.eliminate = sc.eliminate;
	M.tag = sc.n > 2 && std::set<int>(sc.team.begin(), sc.team.end()).size() < static_cast<size_t>(sc.n);
	int firings = 0, own_firings = 0, cond_seen = 0, cost_seen = 0, tg_seen = 0, op2_seen = 0, slice_seen = 0;
	std::map<int, Rec> lp0;
	for(const auto& r : g_recs) {
		auto m = fields(r.text);
		if(m.count("s") == 0)
			continue;
		const int P = std::atoi(m["s"].c_str());
		const int T = r.turn_player;
		EXPECT(P != sc.eliminate, "%s: the card of the eliminated seat %d wrote a record: %s", sc.name, P, r.text.c_str());
		const int ex_tp = M.f(P, P), ex_ep = M.f(P, T), ex_rp = 2;
		const std::string& k = m["kind"];
		if(k == "con" || k == "cost" || k == "tg") {
			EXPECT(std::atoi(m["tp"].c_str()) == ex_tp && std::atoi(m["ep"].c_str()) == ex_ep && std::atoi(m["rp"].c_str()) == ex_rp,
			       "%s: %s seat %d turn %d: got tp=%s ep=%s rp=%s, want tp=%d ep=%d rp=%d", sc.name, k.c_str(), P, T,
			       m["tp"].c_str(), m["ep"].c_str(), m["rp"].c_str(), ex_tp, ex_ep, ex_rp);
			if(k == "con") ++cond_seen; else if(k == "cost") ++cost_seen; else ++tg_seen;
		} else if(k == "op1") {
			++firings;
			if(M.same_team(P, T)) ++own_firings;
			EXPECT(std::atoi(m["tp"].c_str()) == ex_tp && std::atoi(m["ep"].c_str()) == ex_ep && std::atoi(m["rp"].c_str()) == ex_rp
			       && std::atoi(m["turn"].c_str()) == M.f(P, T),
			       "%s: op1 seat %d turn %d: %s", sc.name, P, T, r.text.c_str());
		} else if(k == "loc") {
			EXPECT(std::atoi(m["own"].c_str()) == 4 && std::atoi(m["opp"].c_str()) == 4, "%s: loc seat %d: %s", sc.name, P, r.text.c_str());
		} else if(k == "slice") {
			++slice_seen;
			const int B = M.bound(P, T, r.chosen);
			if(B < 0) { EXPECT(false, "%s: slice seat %d turn %d: no bound opponent in the model", sc.name, P, T); continue; }
			EXPECT(std::atoi(m["opp"].c_str()) == static_cast<int>(kDeckBase) + B, "%s: GetDecktopGroup(1-tp) seat %d turn %d read code %s, want seat %d", sc.name, P, T, m["opp"].c_str(), B);
			EXPECT(std::atoi(m["own"].c_str()) == static_cast<int>(kDeckBase) + P, "%s: GetDecktopGroup(tp) seat %d read %s", sc.name, P, m["own"].c_str());
			EXPECT(m["oppIsOpp"] == "true" && m["ownIsOpp"] == "false" && m["ownIsOwn"] == "true", "%s: IsControler seat %d turn %d: %s", sc.name, P, T, r.text.c_str());
			EXPECT(std::atoi(m["ctl"].c_str()) == M.f(P, B), "%s: GetControler seat %d: %s, want %d", sc.name, P, r.text.c_str(), M.f(P, B));
		} else if(k == "bad") {
			EXPECT(m["n"] == "0", "%s: GetDecktopGroup(7,1) gave %s cards", sc.name, m["n"].c_str());
		} else if(k == "lp0" || k == "lp1") {
			const int B = M.bound(P, T, r.chosen);
			if(B < 0) { EXPECT(false, "%s: %s seat %d turn %d: no bound opponent in the model", sc.name, k.c_str(), P, T); continue; }
			// the opponent is the bound one on every turn (F5 binds it at the first read, before any LP read); the own
			// value is the own team's LP
			int lpv[MAX_DUELISTS];
			std::memcpy(lpv, r.lp, sizeof(lpv));
			const int own = lpv[P];
			const int opp = lpv[B];
			EXPECT(std::atoi(m["own"].c_str()) == own && std::atoi(m["opp"].c_str()) == opp, "%s: %s seat %d turn %d: %s, want own=%d opp=%d", sc.name, k.c_str(), P, T, r.text.c_str(), own, opp);
			if(k == "lp0") {
				lp0[P] = r;
			} else if(lp0.count(P)) {
				const Rec& b = lp0[P];
				const int target = M.bound(P, T, r.chosen);
				for(int q = 0; q < M.n; ++q) {
					const int want = b.lp[q] - (M.same_team(q, target) ? 100 : 0);
					EXPECT(r.lp[q] == want, "%s: Damage(1-tp) seat %d turn %d: seat %d LP %d, want %d (target seat %d)", sc.name, P, T, q, r.lp[q], want, target);
				}
			}
		} else if(k == "op2") {
			++op2_seen;
			EXPECT(std::atoi(m["tp"].c_str()) == ex_tp && std::atoi(m["turn"].c_str()) == M.f(P, T) && m["isturn"] == (M.same_team(P, T) ? "true" : "false"),
			       "%s: after the yield seat %d turn %d the scope is wrong: %s", sc.name, P, T, r.text.c_str());
		}
	}
	EXPECT(firings > 0 && firings == op2_seen && firings == slice_seen, "%s: %d operations, %d resumes, %d slice lines", sc.name, firings, op2_seen, slice_seen);
	EXPECT(cond_seen > 0 && cost_seen > 0 && tg_seen > 0, "%s: condition/cost/target seen %d/%d/%d", sc.name, cond_seen, cost_seen, tg_seen);
	EXPECT(out.depth_bad == 0, "%s: scope depth not 0 at %zu of %zu prompts", sc.name, out.depth_bad, out.prompts);
	EXPECT(g_errors == 0, "%s: %ld Lua errors, first: %s", sc.name, g_errors, g_error_text.empty() ? "" : g_error_text[0].c_str());
	if(M.fold()) {
		// F5: never a guess (a) or a conflict (b). A pick prompt in the operation step is the logged kind (c): one per
		// own-team firing that has two or more living opponents, none when the bind is silent.
		const int want_c = M.eliminate >= 0 ? 0 : own_firings;
		EXPECT(count_kind(nfold, 'a') == 0, "%s: %d kind (a) records (an unbound fallback), want 0", sc.name, count_kind(nfold, 'a'));
		EXPECT(count_kind(nfold, 'b') == 0, "%s: %d kind (b) records (a binding conflict), want 0", sc.name, count_kind(nfold, 'b'));
		EXPECT(count_kind(nfold, 'c') == want_c, "%s: %d kind (c) records, want %d", sc.name, count_kind(nfold, 'c'), want_c);
		EXPECT(out.picks == static_cast<size_t>(want_c), "%s: %zu pick prompts, want %d", sc.name, out.picks, want_c);
		EXPECT(out.pick_bad.empty(), "%s: a pick prompt is wrong: %s", sc.name, out.pick_bad.empty() ? "" : out.pick_bad[0].c_str());
		EXPECT(count_kind(nfold, 'd') == firings, "%s: %d kind (d) records, want %d", sc.name, count_kind(nfold, 'd'), firings);
	} else {
		EXPECT(nfold.empty() && out.picks == 0, "%s: %zu fold records and %zu pick prompts at n == 2", sc.name, nfold.size(), out.picks);
	}
	std::printf("%-6s n=%d firings=%d own-turn=%d prompts=%zu depth-bad=%zu errors=%ld picks=%zu nfold(a/b/c/d)=%d/%d/%d/%d\n", sc.name, sc.n, firings, own_firings,
	            out.prompts, out.depth_bad, g_errors, out.picks, count_kind(nfold, 'a'), count_kind(nfold, 'b'), count_kind(nfold, 'c'), count_kind(nfold, 'd'));
}


// ---- the fold API (fold.h) with a scope that the check pushes by hand
template<typename F>
static std::vector<std::string> capture_nfold(F&& body) {
	std::vector<std::string> lines;
	std::string path_template = check_tmp_template("f1-check-api"); char* path = path_template.data();
	int fd = mkstemp(path);
	int saved = -1;
	if(fd >= 0) {
		std::fflush(stderr);
		saved = dup(2);
		dup2(fd, 2);
	}
	body();
	if(fd >= 0) {
		std::fflush(stderr);
		dup2(saved, 2);
		close(saved);
		close(fd);
		std::ifstream in(path);
		std::string line;
		while(std::getline(in, line))
			if(line.compare(0, 6, "NFOLD ") == 0)
				lines.push_back(line);
		unlink(path);
	}
	return lines;
}

static OCG_Duel make_api_duel(int n, const std::vector<int>& team) {
	OCG_DuelOptions options;
	std::memset(&options, 0, sizeof(options));
	options.seed[0] = 1; options.seed[1] = 2; options.seed[2] = 3; options.seed[3] = 4;
	options.flags = DUEL_MODE_MR5;
	options.team1 = { 8000, 5, 1 };
	options.team2 = { 8000, 5, 1 };
	options.cardReader = read_card;
	options.scriptReader = read_script;
	options.logHandler = on_log;
	OCG_Duel d = nullptr;
	if(OCG_CreateDuel(&d, &options) != OCG_DUEL_CREATION_SUCCESS)
		return nullptr;
	if(n > 2) {
		std::string code = "Debug.SetupDuelists(" + std::to_string(n);
		for(int t : team)
			code += "," + std::to_string(t);
		code += ")";
		OCG_LoadScript(d, code.c_str(), static_cast<uint32_t>(code.size()), "setup.lua");
	}
	return d;
}

using Seats = std::vector<int>;
static Seats to_seats(const uint8_t (&a)[MAX_DUELISTS], uint8_t n) {
	return Seats(a, a + n);
}

static void api_check() {
	// FFA4, P = 2
	{
		OCG_Duel d = make_api_duel(4, { 0, 1, 2, 3 });
		auto* pd = static_cast<duel*>(d);
		auto& f = *pd->game_field;
		uint8_t out[MAX_DUELISTS];
		EXPECT(fold::active(pd) == nullptr, "api: active() without a scope");
		EXPECT(fold::unfold_action(pd, 1, "t") == 1 && fold::matches(pd, 1, 1) && !fold::matches(pd, 0, 1), "api: identity without a scope");
		pd->lua->push_scope(2);
		EXPECT(fold::active(pd) != nullptr, "api: active() in a scope");
		auto rec = capture_nfold([&] {
			EXPECT(fold::unfold_action(pd, 0, "t") == 2, "api: action 0 is P");
			EXPECT(fold::unfold_action(pd, 1, "t") == 3, "api: action 1 unbound is the next opponent (seat 3)");
			EXPECT(fold::unfold_action(pd, 2, "t") == f.none_id(), "api: action PLAYER_NONE");
			EXPECT(fold::unfold_action(pd, 3, "t") == f.all_id(), "api: action PLAYER_ALL");
			EXPECT(fold::unfold_action(pd, 5, "t") == fold::INVALID, "api: action 5 is invalid");
			EXPECT(fold::unfold_action(pd, 255, "t") == fold::INVALID, "api: action 255 is invalid");
		});
		EXPECT(count_kind(rec, 'a') == 1 && count_kind(rec, 'd') == 2 && rec.size() == 3, "api: %zu records, want a=1 d=2", rec.size());
		rec = capture_nfold([&] {
			const auto n1 = fold::query_list(pd, 1, out, "q");
			EXPECT(to_seats(out, n1) == Seats({ 0, 1, 3 }), "api: query 1 unbound lists every opponent");
			EXPECT(pd->lua->current_scope()->touched, "api: query marks the scope touched");
			const auto n0 = fold::query_list(pd, 0, out, "q");
			EXPECT(to_seats(out, n0) == Seats({ 2 }), "api: query 0 is P");
			EXPECT(fold::query_list(pd, 2, out, "q") == 0 && fold::query_list(pd, 3, out, "q") == 0, "api: query NONE/ALL is empty");
			EXPECT(fold::query_list(pd, 4, out, "q") == 0, "api: query 4 is empty");
			const auto m0 = fold::field_list(pd, 0, out, "f");
			EXPECT(to_seats(out, m0) == Seats({ 2 }), "api: field 0 is the own team");
			const auto m1 = fold::field_list(pd, 1, out, "f");
			EXPECT(to_seats(out, m1) == Seats({ 0, 1, 3 }), "api: field 1 is every opponent");
			const auto v0 = fold::field_side(pd, 0, "f");
			const auto v1 = fold::field_side(pd, 1, "f");
			const auto v2 = fold::field_side(pd, 2, "f");
			EXPECT(v0.ok && v0.self == 2 && !v0.swap && v1.ok && v1.self == 2 && v1.swap && !v2.ok, "api: field_side");
			EXPECT(fold::matches(pd, 0, 2) && fold::matches(pd, 1, 3) && fold::matches(pd, 1, 0) && !fold::matches(pd, 1, 2) && !fold::matches(pd, 0, 3), "api: matches in FFA");
			EXPECT(fold::matches(pd, 2, f.none_id()) && fold::matches(pd, 3, f.all_id()), "api: matches keeps NONE/ALL");
			Seats others;
			fold::for_each_other(pd, 2, [&](uint8_t q) { others.push_back(q); });
			EXPECT(others == Seats({ 0, 1, 3 }), "api: for_each_other");
			Seats all;
			fold::for_each_target(pd, 3, "x", [&](uint8_t q) { all.push_back(q); });
			EXPECT(all == Seats({ 0, 1, 2, 3 }), "api: for_each_target ALL");
			Seats one;
			fold::for_each_target(pd, 0, "x", [&](uint8_t q) { one.push_back(q); });
			EXPECT(one == Seats({ 2 }), "api: for_each_target 0");
		});
		EXPECT(rec.size() == 1 && count_kind(rec, 'd') == 1, "api: %zu records in the list block, want one d (field_side 2 is NONE, query 4 is d)", rec.size());
		pd->lua->pop_scope();
		// a bound opponent
		uint8_t bound = 1;
		pd->lua->push_scope(2, &bound);
		rec = capture_nfold([&] {
			EXPECT(fold::unfold_action(pd, 1, "t") == 1, "api: bound action 1 is seat 1");
			const auto n1 = fold::query_list(pd, 1, out, "q");
			EXPECT(to_seats(out, n1) == Seats({ 1 }) && !pd->lua->current_scope()->touched, "api: bound query 1 is seat 1, not touched");
		});
		EXPECT(rec.empty(), "api: bound: %zu records", rec.size());
		pd->lua->pop_scope();
		// bind on read: through the scope
		uint8_t none = DUELIST_NONE;
		pd->lua->push_scope(2, &none);
		EXPECT(pd->lua->scope_bind(3) && none == 3, "api: scope_bind binds the first opponent");
		EXPECT(!pd->lua->scope_bind(0) && none == 3, "api: a second opponent does not bind (first wins)");
		EXPECT(pd->lua->fold_out(3) == 1 && pd->lua->fold_out(2) == 0 && pd->lua->fold_out(f.none_id()) == PLAYER_NONE, "api: fold_out");
		pd->lua->pop_scope();
		// an eliminated duelist is skipped
		f.player[3].eliminated = true;
		pd->lua->push_scope(2);
		rec = capture_nfold([&] {
			EXPECT(fold::unfold_action(pd, 1, "t") == 0, "api: the next living opponent skips the eliminated seat 3");
			const auto n1 = fold::query_list(pd, 1, out, "q");
			EXPECT(to_seats(out, n1) == Seats({ 0, 1 }), "api: the query skips the eliminated seat");
		});
		pd->lua->pop_scope();
		EXPECT(pd->lua->scopes.empty(), "api: scopes empty after pop");
		OCG_DestroyDuel(d);
	}
	// Tag, P = 3 (team id 1)
	{
		OCG_Duel d = make_api_duel(4, { 0, 1, 0, 1 });
		auto* pd = static_cast<duel*>(d);
		uint8_t out[MAX_DUELISTS];
		pd->lua->push_scope(3);
		auto rec = capture_nfold([&] {
			EXPECT(fold::unfold_action(pd, 1, "t") == 3, "api tag: action 1 is the own team value, P");
			EXPECT(fold::unfold_action(pd, 0, "t") == 0, "api tag: action 0 is the next opponent (seat 0)");
			EXPECT(fold::unfold_action(pd, 0, "t", true) == 0, "api tag: team-level action 0");
			const auto m1 = fold::field_list(pd, 1, out, "f");
			EXPECT(to_seats(out, m1) == Seats({ 3, 1 }), "api tag: field 1 is the own team (P first)");
			const auto m0 = fold::field_list(pd, 0, out, "f");
			EXPECT(to_seats(out, m0) == Seats({ 0, 2 }), "api tag: field 0 is the other team");
			const auto v1 = fold::field_side(pd, 1, "f");
			const auto v0 = fold::field_side(pd, 0, "f");
			EXPECT(v1.ok && v1.self == 3 && !v1.swap && v0.ok && v0.self == 3 && v0.swap, "api tag: field_side");
			EXPECT(fold::matches(pd, 1, 1) && fold::matches(pd, 1, 3) && fold::matches(pd, 0, 0) && fold::matches(pd, 0, 2) && !fold::matches(pd, 1, 0), "api tag: matches by team");
		});
		EXPECT(count_kind(rec, 'a') == 1 && rec.size() == 1, "api tag: %zu records, want a=1 (the team-level call writes none)", rec.size());
		pd->lua->pop_scope();
		OCG_DestroyDuel(d);
	}
	// n == 2: identity, even with a scope pushed by hand
	{
		OCG_Duel d = make_api_duel(2, { 0, 1 });
		auto* pd = static_cast<duel*>(d);
		uint8_t out[MAX_DUELISTS];
		pd->lua->push_scope(1);
		auto rec = capture_nfold([&] {
			EXPECT(fold::active(pd) == nullptr, "api n2: not active");
			EXPECT(fold::unfold_action(pd, 0, "t") == 0 && fold::unfold_action(pd, 1, "t") == 1 && fold::unfold_action(pd, 7, "t") == 7, "api n2: action is the identity");
			EXPECT(fold::query_list(pd, 1, out, "q") == 1 && out[0] == 1 && fold::query_list(pd, 2, out, "q") == 0, "api n2: query");
			const auto v = fold::field_side(pd, 1, "f");
			EXPECT(v.ok && v.self == 1 && !v.swap, "api n2: field_side");
			EXPECT(fold::matches(pd, 1, 1) && !fold::matches(pd, 0, 1), "api n2: matches");
			EXPECT(pd->lua->fold_out(0) == 0 && pd->lua->fold_out(1) == 1 && pd->lua->fold_out(2) == 2, "api n2: fold_out");
		});
		EXPECT(rec.empty(), "api n2: %zu records", rec.size());
		pd->lua->pop_scope();
		OCG_DestroyDuel(d);
	}
	std::printf("api    fold.h helpers checked in FFA4 (P=2, bound, eliminated), Tag (P=3) and n=2\n");
}

int main(int argc, char** argv) {
	const std::string only = argc > 1 ? argv[1] : "";
	auto want = [&](const char* n) { return only.empty() || only == n; };
	const std::vector<Scenario> scenarios = {
		{ "ffa3", 3, { 0, 1, 2 }, true, true, false, 7 },
		{ "ffa4", 4, { 0, 1, 2, 3 }, true, true, false, 9 },
		{ "tag", 4, { 0, 1, 0, 1 }, true, true, false, 9 },
		{ "ffa3e", 3, { 0, 1, 2 }, true, true, false, 7, 2 },
	};
	for(const auto& sc : scenarios) {
		if(!want(sc.name)) continue;
		Outcome out;
		const auto nfold = run_captured(sc, out);
		EXPECT(out.ended_ok, "%s: the duel did not reach turn %d: %s (turns=%d)", sc.name, sc.turns, out.why.c_str(), out.turns);
		check_test_cards(sc, out, nfold);
	}
	if(want("n2") || want("n2s")) {
		Scenario a{ "n2", 2, { 0, 1 }, false, true, false, 6 };
		Scenario b{ "n2s", 2, { 0, 1 }, true, true, false, 6 };
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
	if(want("api"))
		api_check();
	if(want("nibiru")) {
		g_instrument_nibiru = true;
		Scenario sc{ "nibiru", 3, { 0, 1, 2 }, true, false, true, 7 };
		Outcome out;
		const auto nfold = run_captured(sc, out);
		g_instrument_nibiru = false;
		int nib = 0, bad_tp = 0;
		for(const auto& r : g_recs) {
			auto m = fields(r.text);
			if(m["kind"] == "nib") {
				++nib;
				if(m["tp"] != "0") ++bad_tp;
			}
		}
		EXPECT(out.ended_ok, "nibiru: the duel did not reach turn %d: %s", sc.turns, out.why.c_str());
		EXPECT(g_errors == 0, "nibiru: %ld Lua errors, first: %s", g_errors, g_error_text.empty() ? "" : g_error_text[0].c_str());
		EXPECT(nib > 0 && bad_tp == 0, "nibiru: condition ran %d times, %d with tp != 0", nib, bad_tp);
		EXPECT(out.depth_bad == 0, "nibiru: scope depth not 0 at %zu prompts", out.depth_bad);
		std::printf("nibiru seat 2 in FFA3: condition ran %d times, all with tp=0; Lua errors=%ld; nfold records=%zu\n", nib, g_errors, nfold.size());
	}
	if(failures) {
		std::printf("F1 CHECK FAIL: %d failure(s)\n", failures);
		return 1;
	}
	std::printf("F1 CHECK OK\n");
	return 0;
}
