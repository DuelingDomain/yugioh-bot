// F3b native check: the Duel library functions from SkipPhase to the end (choosers, field-zone prompts, IsPlayerCan*).
// Build and run: bash packages/duel-server/scripts/native/checks/run.sh <check name> (see README.md).
// Scenarios (each one plays whole turns; every living seat owns a test card, code 90001 + seat, in its monster zone):
//   ffa4          4 duelists, free for all
//   ffa4e         the same with seat 3 eliminated before the start (it has no test card and the biggest Deck)
//   tag           4 duelists, teams 0,1,0,1
//   n2, n2s       2 duelists without and with Debug.SetupDuelists(2,0,1): same message bytes, same Lua log
// The test card is a mandatory trigger on EVENT_PHASE+PHASE_STANDBY. It fires in the Standby Phase of every duelist.
// Its operation (scope = the seat of the card) does, in this order:
//   IsPlayerCanDiscardDeck(1-tp,20) and IsPlayerCanDraw(1-tp,1)   query: the first read of "1", so it asks the pick; the answer is for the bound opponent
//   SelectYesNo / SelectOption / AnnounceNumber with 1-tp         the prompt goes to the bound opponent, a living one
//   SelectDisableField / SelectFieldZone with tp                  the prompt goes to the seat of the card, the answer is accepted
// F5 binding: at n > 2 the first read of "1-tp" in the operation (the IsPlayerCanDiscardDeck query) makes the core ask the
// activator which opponent it means (MSG_SELECT_OPTION, every desc 0xFFFE0000|seat, ascending, living opponents only). The
// driver answers option k % options for pick number k, so the bound opponent of a firing is that seat. The query and the
// prompts SelectYesNo/SelectOption/AnnounceNumber all use the bound opponent. The Deck sizes of the seats differ, so a core
// that ignores the answer fails the query check.
// The driver notes the seat that got each prompt. No prompt may go to an eliminated seat.
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
	local d=Duel.IsPlayerCanDiscardDeck(1-tp,20)
	local w=Duel.IsPlayerCanDraw(1-tp,1)
	Debug.Message(string.format("F3B can s=%d disc=%s draw=%s",seat,tostring(d),tostring(w)))
	local yn=Duel.SelectYesNo(1-tp,0)
	Debug.Message(string.format("F3B yn s=%d r=%s",seat,tostring(yn)))
	local o=Duel.SelectOption(1-tp,false,1,2)
	Debug.Message(string.format("F3B opt s=%d r=%d",seat,o))
	local n=Duel.AnnounceNumber(1-tp,5,7)
	Debug.Message(string.format("F3B num s=%d r=%d",seat,n))
	local z=Duel.SelectDisableField(tp,1,LOCATION_MZONE,0,0)
	Debug.Message(string.format("F3B dis s=%d z=%d",seat,z))
	local f=Duel.SelectFieldZone(tp,1,LOCATION_MZONE,0,0)
	Debug.Message(string.format("F3B fz s=%d z=%d",seat,f))
	Debug.Message(string.format("F3B end s=%d",seat))
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
			text = kTestScript;
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
	int turn_player = 0;               // raw seat at the time of the log line
	int prompt_id = 0;                 // the last prompt that the driver answered
	int prompt_player = -1;            // its seat byte
	int answer_seq = -1;               // zone that the driver answered for a field prompt
	size_t deck[MAX_DUELISTS] = {};
	bool elim[MAX_DUELISTS] = {};
	int chosen[MAX_DUELISTS] = { -1, -1, -1, -1 };  // the seat that the last pick prompt of every seat bound (-1: none yet)
};
static std::vector<Rec> g_recs;
// the harness answers pick prompt number k with option k % options, so a core that ignores the answer binds a seat
// that the model does not expect
static int g_chosen[MAX_DUELISTS] = { -1, -1, -1, -1 };
static size_t g_pick_no = 0;
static long g_errors = 0;
static std::vector<std::string> g_error_text;
static OCG_Duel g_duel = nullptr;
static int g_prompt_id = 0, g_prompt_player = -1, g_answer_seq = -1;

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
	if(text && std::strncmp(text, "F3B ", 4) == 0 && g_duel) {
		Rec r;
		r.text = text;
		auto& f = F(g_duel);
		r.turn_player = f.infos.turn_player;
		r.prompt_id = g_prompt_id;
		r.prompt_player = g_prompt_player;
		r.answer_seq = g_answer_seq;
		std::memcpy(r.chosen, g_chosen, sizeof(r.chosen));
		for(int i = 0; i < f.n_duelists; ++i) {
			r.deck[i] = f.player[i].list_main.size();
			r.elim[i] = f.player[i].eliminated;
		}
		if(std::getenv("CHECK_LOG"))
			std::fprintf(stderr, "T=%d prompt=%d/%d seq=%d %s\n", r.turn_player, r.prompt_id, r.prompt_player, r.answer_seq, text);
		g_recs.push_back(std::move(r));
	}
}

// ---- duel setup and driver
struct Scenario {
	const char* name;
	int n;
	std::vector<int> team;
	bool setup_call;              // call Debug.SetupDuelists (always for n > 2)
	std::vector<size_t> deck;     // Deck size per seat
	int eliminated;               // seat that is eliminated before the start, or -1
	int turns;
};

struct Outcome {
	uint64_t hash = 0;
	int turns = 0;
	size_t depth_bad = 0;
	size_t prompts = 0;
	size_t retries = 0;           // MSG_RETRY: an answer that the core rejected
	size_t bad_prompt = 0;        // a select prompt to a seat that is not a living duelist
	size_t picks = 0;             // F5 pick prompts (every option 0xFFFE0000|seat) that were answered
	std::vector<std::string> pick_bad;  // a pick prompt that is not the ascending list of the living opponents of the asked seat
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
	for(int& c : g_chosen) c = -1;
	g_pick_no = 0;
	g_errors = 0;
	g_error_text.clear();
	g_prompt_id = 0; g_prompt_player = -1; g_answer_seq = -1;
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
		for(size_t i = 0; i < sc.deck[s]; ++i)
			add_card(d, static_cast<uint8_t>(s), LOCATION_DECK, kDeckBase + s, POS_FACEDOWN_DEFENSE);
	for(int s = 0; s < sc.n; ++s)
		if(s != sc.eliminated)
			add_card(d, static_cast<uint8_t>(s), LOCATION_MZONE, kTestBase + s, POS_FACEUP_ATTACK);
	OCG_StartDuel(d);
	if(sc.eliminated >= 0)
		F(d).eliminate(static_cast<uint8_t>(sc.eliminated), 0);  // as in a duel: the cards leave the field, a message 200 is sent

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
				if(buf[off + 4] == MSG_RETRY)
					++out.retries;
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
		if(!m) { out.why = "awaiting without a message"; break; }
		g_prompt_id = m->id;
		g_prompt_player = m->size > 0 ? m->p[0] : -1;
		g_answer_seq = -1;
		const bool select_prompt = m->id == MSG_SELECT_YESNO || m->id == MSG_SELECT_OPTION || m->id == MSG_SELECT_DISFIELD || m->id == MSG_ANNOUNCE_NUMBER;
		if(select_prompt) {
			const int who = g_prompt_player;
			if(who < 0 || who >= sc.n || F(d).player[who].eliminated)
				++out.bad_prompt;
		}
		auto answer32 = [&](int32_t v) { OCG_DuelSetResponse(d, &v, sizeof(v)); };
		switch(m->id) {
		case MSG_SELECT_IDLECMD: answer32(7); break;
		case MSG_SELECT_YESNO: case MSG_SELECT_EFFECTYN: answer32(1); break;
		case MSG_SELECT_OPTION: {
			// u8 player, u8 count, count x u64 desc
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
					if(who >= 0 && who < sc.n && sc.team[q] != sc.team[who] && !F(d).player[q].eliminated) want.push_back(q);
				if(seats != want || seats.size() < 2)
					out.pick_bad.push_back("seat " + std::to_string(who) + " got " + std::to_string(seats.size()) + " options");
			}
			int idx = 0;
			if(pick && who >= 0 && who < MAX_DUELISTS) {
				idx = static_cast<int>(g_pick_no++ % seats.size());
				g_chosen[who] = seats[idx];
			}
			answer32(idx);
			break;
		}
		case MSG_ANNOUNCE_NUMBER: answer32(0); break;
		case MSG_SELECT_DISFIELD: {
			// payload: player, count, flag (4 bytes). The answer is player, location, sequence: the first free own zone.
			uint32_t flag = 0;
			std::memcpy(&flag, m->p + 2, 4);
			int seq = -1;
			for(int i = 0; i < 7; ++i)
				if(!(flag & (1u << i))) { seq = i; break; }
			if(seq < 0) { out.why = "no free zone in the flag"; break; }
			g_answer_seq = seq;
			const uint8_t r[3] = { m->p[0], LOCATION_MZONE, static_cast<uint8_t>(seq) };
			OCG_DuelSetResponse(d, r, 3);
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
	std::string path_template = check_tmp_template("f3b-check-stderr"); char* path = path_template.data();
	int fd = mkstemp(path), saved = -1;
	if(fd >= 0) {
		std::fflush(stderr);
		saved = dup(2);
		dup2(fd, 2);
	}
	out = play(sc);
	if(fd >= 0) {
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

static std::map<std::string, std::string> fields(const std::string& text) {
	std::map<std::string, std::string> m;
	std::istringstream ss(text);
	std::string tok;
	ss >> tok;  // "F3B"
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
	for(const auto& l : nfold)
		if(l.size() > 6 && l[6] == kind && (!fn || l.find(std::string("fn=") + fn) != std::string::npos))
			++c;
	return c;
}

static void check_scenario(const Scenario& sc, const Outcome& out, const std::vector<std::string>& nfold) {
	const bool fold = sc.n > 2;
	const bool tag = fold && std::set<int>(sc.team.begin(), sc.team.end()).size() < static_cast<size_t>(sc.n);
	auto same_team = [&](int a, int b) { return !fold ? a == b : sc.team[a] == sc.team[b]; };
	auto opponents_alive = [&](const Rec& r, int P) {
		std::vector<int> v;
		for(int q = 0; q < sc.n; ++q)
			if(!same_team(P, q) && !r.elim[q]) v.push_back(q);
		return v;
	};
	// the opponent that 1-tp means for the card of seat P: the one the driver picked (option k % options, the seat of
	// the last answer of seat P), or the only living opponent (silent bind)
	auto bound = [&](const Rec& r, int P, int /*T*/) {
		if(!fold) return 1 - P;
		const auto v = opponents_alive(r, P);
		if(v.empty()) return -1;
		return v.size() == 1 ? v[0] : r.chosen[P];
	};
	std::map<std::string, int> seen;
	int firings = 0, own_firings = 0;
	for(const auto& r : g_recs) {
		auto m = fields(r.text);
		if(m.count("s") == 0)
			continue;
		const int P = std::atoi(m["s"].c_str());
		const int T = r.turn_player;
		EXPECT(P != sc.eliminated, "%s: the card of the eliminated seat %d wrote a record: %s", sc.name, P, r.text.c_str());
		const std::string& k = m["kind"];
		++seen[k];
		if(k == "can") {
			++firings;
			if(same_team(P, T)) ++own_firings;
			// the query is the first read of "1" in the operation step: the core asks the pick (the logged fallback) and
			// answers for the bound opponent. The Deck sizes differ, so a core that ignores the answer gives another result.
			const int B = bound(r, P, T);
			if(B < 0) { EXPECT(false, "%s: can seat %d turn %d: no bound opponent in the model", sc.name, P, T); continue; }
			const bool disc = r.deck[B] >= 20, draw = r.deck[B] >= 1;
			EXPECT(m["disc"] == (disc ? "true" : "false") && m["draw"] == (draw ? "true" : "false"),
			       "%s: seat %d turn %d: %s, want disc=%d draw=%d (the bound opponent, seat %d)", sc.name, P, T, r.text.c_str(), disc, draw, B);
		} else if(k == "yn" || k == "opt" || k == "num") {
			const int want_id = k == "yn" ? MSG_SELECT_YESNO : k == "opt" ? MSG_SELECT_OPTION : MSG_ANNOUNCE_NUMBER;
			const int B = bound(r, P, T);
			EXPECT(r.prompt_id == want_id, "%s: %s seat %d: last prompt %d, want %d", sc.name, k.c_str(), P, r.prompt_id, want_id);
			EXPECT(B >= 0 && r.prompt_player == B && !(r.prompt_player >= 0 && r.elim[r.prompt_player]),
			       "%s: %s with 1-tp: the card of seat %d on turn %d sent the prompt to seat %d, want the bound living opponent seat %d", sc.name, k.c_str(), P, T, r.prompt_player, B);
			EXPECT(k != "yn" || m["r"] == "true", "%s: SelectYesNo gave %s", sc.name, m["r"].c_str());
			EXPECT(k != "opt" || m["r"] == "0", "%s: SelectOption gave %s", sc.name, m["r"].c_str());
			EXPECT(k != "num" || m["r"] == "5", "%s: AnnounceNumber gave %s", sc.name, m["r"].c_str());
		} else if(k == "dis" || k == "fz") {
			EXPECT(r.prompt_id == MSG_SELECT_DISFIELD, "%s: %s seat %d: last prompt %d", sc.name, k.c_str(), P, r.prompt_id);
			EXPECT(r.prompt_player == P, "%s: %s with tp: the card of seat %d on turn %d sent the prompt to seat %d", sc.name, k.c_str(), P, T, r.prompt_player);
			const long z = std::atol(m["z"].c_str());
			EXPECT(r.answer_seq >= 0 && z == (1l << r.answer_seq), "%s: %s seat %d: answered zone %d, got mask %ld", sc.name, k.c_str(), P, r.answer_seq, z);
		}
	}
	const int live_cards = sc.n - (sc.eliminated >= 0 ? 1 : 0);
	EXPECT(firings > 0 && firings >= live_cards, "%s: the test cards fired %d times", sc.name, firings);
	for(const char* k : { "can", "yn", "opt", "num", "dis", "fz", "end" })
		EXPECT(seen[k] == firings, "%s: %d '%s' lines, want %d", sc.name, seen[k], k, firings);
	if(sc.eliminated >= 0) {
		for(const auto& r : g_recs)
			EXPECT(r.turn_player != sc.eliminated, "%s: a turn of the eliminated seat %d", sc.name, sc.eliminated);
	}
	EXPECT(out.retries == 0, "%s: %zu answers were rejected (MSG_RETRY)", sc.name, out.retries);
	EXPECT(out.bad_prompt == 0, "%s: %zu select prompts went to an eliminated or non-duelist seat", sc.name, out.bad_prompt);
	EXPECT(out.depth_bad == 0, "%s: scope depth not 0 at %zu of %zu prompts", sc.name, out.depth_bad, out.prompts);
	EXPECT(g_errors == 0, "%s: %ld Lua errors, first: %s", sc.name, g_errors, g_error_text.empty() ? "" : g_error_text[0].c_str());
	int d_mine = 0;
	for(const char* fn : { "IsPlayerCanDiscardDeck", "IsPlayerCanDraw", "SelectYesNo", "SelectOption", "AnnounceNumber", "SelectDisableField", "SelectFieldZone" })
		d_mine += count_kind(nfold, 'd', fn);
	if(fold) {
		EXPECT(d_mine == 0, "%s: %d kind (d) records for the functions of this check", sc.name, d_mine);
		EXPECT(count_kind(nfold, 'b') == 0 && count_kind(nfold, 'd') == 0, "%s: kind b/d records: %d/%d", sc.name, count_kind(nfold, 'b'), count_kind(nfold, 'd'));
		// F5: no unbound fallback (kind a). The pick prompt is the logged kind (c): exactly one per firing (every living
		// seat has at least 2 living opponents here), asked of the card seat.
		EXPECT(count_kind(nfold, 'a') == 0, "%s: %d kind (a) records (an unbound fallback), want 0", sc.name, count_kind(nfold, 'a'));
		EXPECT(count_kind(nfold, 'c') == firings, "%s: %d kind (c) records, want %d (one pick per firing)", sc.name, count_kind(nfold, 'c'), firings);
		EXPECT(out.picks == static_cast<size_t>(firings), "%s: %zu pick prompts, want %d", sc.name, out.picks, firings);
		EXPECT(out.pick_bad.empty(), "%s: a pick prompt is wrong: %s", sc.name, out.pick_bad.empty() ? "" : out.pick_bad[0].c_str());
	} else {
		EXPECT(nfold.empty() && out.picks == 0, "%s: %zu fold records and %zu pick prompts at n == 2", sc.name, nfold.size(), out.picks);
	}
	std::printf("%-6s n=%d%s firings=%d own-turn=%d prompts=%zu retries=%zu bad-prompt=%zu errors=%ld picks=%zu nfold(a/b/c/d)=%d/%d/%d/%d\n", sc.name, sc.n, tag ? " tag" : "",
	            firings, own_firings, out.prompts, out.retries, out.bad_prompt, g_errors, out.picks, count_kind(nfold, 'a'), count_kind(nfold, 'b'), count_kind(nfold, 'c'), count_kind(nfold, 'd'));
}

int main(int argc, char** argv) {
	const std::string only = argc > 1 ? argv[1] : "";
	auto want = [&](const char* n) { return only.empty() || only == n; };
	const std::vector<Scenario> scenarios = {
		{ "ffa4", 4, { 0, 1, 2, 3 }, true, { 40, 10, 10, 10 }, -1, 9 },
		{ "ffa4e", 4, { 0, 1, 2, 3 }, true, { 10, 10, 10, 40 }, 3, 8 },
		{ "tag", 4, { 0, 1, 0, 1 }, true, { 40, 10, 10, 10 }, -1, 9 },
	};
	for(const auto& sc : scenarios) {
		if(!want(sc.name)) continue;
		Outcome out;
		const auto nfold = run_captured(sc, out);
		EXPECT(out.ended_ok, "%s: the duel did not reach turn %d: %s (turns=%d)", sc.name, sc.turns, out.why.c_str(), out.turns);
		check_scenario(sc, out, nfold);
	}
	if(want("n2") || want("n2s")) {
		Scenario a{ "n2", 2, { 0, 1 }, false, { 40, 10 }, -1, 6 };
		Scenario b{ "n2s", 2, { 0, 1 }, true, { 40, 10 }, -1, 6 };
		Outcome oa, ob;
		const auto na = run_captured(a, oa);
		const std::vector<Rec> recs_a = g_recs;
		check_scenario(a, oa, na);
		const auto nb = run_captured(b, ob);
		EXPECT(oa.ended_ok && ob.ended_ok, "n2: the duels did not finish: %s / %s", oa.why.c_str(), ob.why.c_str());
		check_scenario(b, ob, nb);
		EXPECT(oa.hash == ob.hash, "n2: message bytes differ between plain and setup-always (%llx vs %llx)", static_cast<unsigned long long>(oa.hash), static_cast<unsigned long long>(ob.hash));
		std::vector<std::string> ta, tb;
		for(const auto& r : recs_a) ta.push_back(r.text);
		for(const auto& r : g_recs) tb.push_back(r.text);
		EXPECT(ta == tb && !ta.empty(), "n2: the Lua log differs between plain and setup-always");
		std::printf("n2     message bytes plain == setup-always: %s, %zu log lines equal\n", oa.hash == ob.hash ? "yes" : "NO", ta.size());
		std::printf("N2HASH %016llx\n", static_cast<unsigned long long>(oa.hash));
	}
	if(failures) {
		std::printf("F3B CHECK FAIL: %d failure(s)\n", failures);
		return 1;
	}
	std::printf("F3B CHECK OK\n");
	return 0;
}
