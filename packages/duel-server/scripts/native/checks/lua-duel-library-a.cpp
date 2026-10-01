// F3a native check: the Lua library functions of libduel.cpp (top to GetChainEvent) under the perspective fold.
// Build and run: bash packages/duel-server/scripts/native/checks/run.sh <check name> (see README.md).
// It links the dev tree core built with -DYGO_N_TRAP -D_GLIBCXX_ASSERTIONS.
// Every seat owns a test card (code 90001 + seat) in its monster zone. The card is a mandatory trigger in the Standby
// Phase of every duelist (so it fires on its own turn and on every other turn). Its operation runs ONE probe (CHECK_PROBE
// or all of them in turn), logs "F3 pre" / "F3 mid" / "F3 post" lines with the card seat, and asks SelectYesNo.
// The logger stores the hand / deck / monster-zone counts of every seat at each line, so the expectations compare
// the state before and after the call.
// F5 (opponent binding, core 29fff80): the first read of "1" binds one opponent for the whole chain link. On the turn of an
// opponent the read of the turn player (the Standby Phase event) is that opponent. On a turn of the own team the core
// asks the activator to pick one (MSG_SELECT_OPTION, every desc 0xFFFE0000|seat, ascending, living opponents only, in the
// operation step: one kind (c) record). The harness answers option 0, the lowest living opponent. With one living
// opponent the bind is silent (ffa3e: seat 2 eliminated, so no pick prompt and no record). There is never a guess:
// no kind (a) record. Probes that read a single "1" (draw, sendtohand, moveopp) pick once per own-team firing.
//   draw        Duel.Draw(1-tp,1,REASON_EFFECT): the bound opponent draws (own turn: the picked, lowest living opponent)
//   confirm     Duel.ConfirmCards(1-tp,g): one MSG_CONFIRM_CARDS for every duelist of the other side
//   sendtohand  Duel.SendtoHand(g,1-tp) with a card of the opponent, then Duel.SendtoHand(g2,tp)
//   move        Duel.MoveToField(c,tp,tp,...): the place prompt goes to the card seat, the card lands on its field
//   moveopp     Duel.MoveToField(c,tp,1-tp,...): the prompt goes to the card seat, the card lands on the opponent's field
// n == 2 (plain and with Debug.SetupDuelists(2,0,1)) must give the same message bytes.
#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
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
static const uint32_t kTestBase = 90001;
static const uint32_t kDeckBase = 5000;
// The pick is always option 0 (the lowest living opponent), so seat 0 is the target of most firings and loses 2 cards
// per firing: the Decks must outlast the whole duel.
static const int kDeckSize = 90;
static std::string g_probe;

static const char* kHead = R"LUA(
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
	Debug.Message(string.format("F3 pre s=%d tp=%d",seat,tp))
	local doit=1
)LUA";
static const char* kTail = R"LUA(
	Debug.Message(string.format("F3 post s=%d do=%d",seat,doit))
	Duel.SelectYesNo(tp,0)
end
)LUA";

static std::string probe_body(const std::string& p) {
	if(p == "draw")
		return "\tDuel.Draw(1-tp,1,REASON_EFFECT)\n";
	if(p == "confirm")
		return "\tlocal g=Duel.GetDecktopGroup(tp,1)\n\tDuel.ConfirmCards(1-tp,g)\n";
	if(p == "sendtohand")
		return "\tlocal g=Duel.GetDecktopGroup(1-tp,1)\n\tDuel.SendtoHand(g,1-tp,REASON_EFFECT)\n"
		       "\tDebug.Message(string.format(\"F3 mid s=%d\",seat))\n"
		       "\tlocal g2=Duel.GetDecktopGroup(1-tp,1)\n\tDuel.SendtoHand(g2,tp,REASON_EFFECT)\n";
	if(p == "move")
		return "\tif Duel.GetLocationCount(tp,LOCATION_MZONE)>0 then\n"
		       "\t\tlocal c=Duel.GetDecktopGroup(tp,1):GetFirst()\n"
		       "\t\tDuel.MoveToField(c,tp,tp,LOCATION_MZONE,POS_FACEUP_ATTACK,true)\n\telse doit=0 end\n";
	if(p == "moveopp")
		return "\tif Duel.GetLocationCount(1-tp,LOCATION_MZONE)>0 then\n"
		       "\t\tlocal c=Duel.GetDecktopGroup(tp,1):GetFirst()\n"
		       "\t\tDuel.MoveToField(c,tp,1-tp,LOCATION_MZONE,POS_FACEUP_ATTACK,true)\n\telse doit=0 end\n";
	return "";
}

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
			text = std::string(kHead) + probe_body(g_probe) + kTail;
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
	int turn_player;
	int hand[MAX_DUELISTS];
	int deck[MAX_DUELISTS];
	int mz[MAX_DUELISTS];
};
static std::vector<Rec> g_recs;
static long g_errors = 0;
static std::vector<std::string> g_error_text;
static OCG_Duel g_duel = nullptr;
static int g_cur_seat = -1;
static int g_cur_turn = -1;
static int g_fire_id = 0;   // counts the "F3 pre" lines: one per firing of a test card
static std::vector<std::pair<int, int>> g_confirms;     // (card seat, viewer) of every MSG_CONFIRM_CARDS
static std::vector<std::pair<int, int>> g_places;       // (card seat, seat that got the prompt) of every MSG_SELECT_PLACE
static std::vector<int> g_place_turn;
static std::vector<std::pair<int, int>> g_confirm_turn;

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
	if(text && std::strncmp(text, "F3 ", 3) == 0 && g_duel) {
		Rec r;
		r.text = text;
		auto& f = F(g_duel);
		r.turn_player = f.infos.turn_player;
		for(int i = 0; i < MAX_DUELISTS; ++i) {
			r.hand[i] = r.deck[i] = r.mz[i] = 0;
			if(i < f.n_duelists) {
				r.hand[i] = static_cast<int>(f.player[i].list_hand.size());
				r.deck[i] = static_cast<int>(f.player[i].list_main.size());
				for(auto* c : f.player[i].list_mzone)
					if(c) ++r.mz[i];
			}
		}
		if(std::strncmp(text, "F3 pre ", 7) == 0) {
			const char* sp = std::strstr(text, "s=");
			g_cur_seat = sp ? std::atoi(sp + 2) : -1;
			g_cur_turn = r.turn_player;
			++g_fire_id;
		}
		if(std::getenv("CHECK_LOG"))
			std::fprintf(stderr, "T=%d hand=%d,%d,%d,%d deck=%d,%d,%d,%d mz=%d,%d,%d,%d %s\n", r.turn_player, r.hand[0], r.hand[1], r.hand[2], r.hand[3],
			             r.deck[0], r.deck[1], r.deck[2], r.deck[3], r.mz[0], r.mz[1], r.mz[2], r.mz[3], text);
		g_recs.push_back(std::move(r));
	}
}

struct Scenario {
	const char* name;
	int n;
	std::vector<int> team;
	bool setup_call;
	int turns;
	int eliminate = -1;   // a seat that is marked eliminated after the start of the duel
};

struct Outcome {
	uint64_t hash = 0;
	int turns = 0;
	size_t depth_bad = 0;
	size_t prompts = 0;
	size_t picks = 0;                    // F5 pick prompts (every option 0xFFFE0000|seat) that were answered
	std::vector<std::string> pick_bad;   // a pick prompt that is not the ascending list of the living opponents
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

struct Model {
	int n;
	bool tag;
	int eliminate = -1;
	std::vector<int> team;
	bool same_team(int a, int b) const { return n > 2 ? team[a] == team[b] : a == b; }
	// the living opponents of P, ascending: the options of the F5 pick prompt
	std::vector<int> opponents(int P) const {
		std::vector<int> r;
		for(int q = 0; q < n; ++q)
			if(q != eliminate && !same_team(P, q)) r.push_back(q);
		return r;
	}
	// the opponent that "1" means in the operation of the card of seat P (F5). The Standby Phase event names nobody and
	// the operation does not read the turn player, so on every turn the first read of "1" is the pick, which the harness
	// answers with option 0 (the lowest living opponent); or the only living opponent (silent bind)
	int bound(int P, int /*T*/) const {
		if(n == 2) return 1 - P;
		const auto o = opponents(P);
		return o.empty() ? -1 : o[0];
	}
	// every duelist of the other side (FFA: every other seat, Tag: the other team, n == 2: the opponent)
	std::set<int> others(int P) const {
		std::set<int> s;
		for(int q = 0; q < n; ++q)
			if(q != eliminate && (n == 2 ? q != P : !same_team(P, q))) s.insert(q);
		return s;
	}
};

static Model g_model;

static Outcome play(const Scenario& sc) {
	Outcome out;
	g_recs.clear();
	g_confirms.clear();
	g_places.clear();
	g_place_turn.clear();
	g_confirm_turn.clear();
	g_errors = 0;
	g_error_text.clear();
	g_cur_seat = g_cur_turn = -1;
	g_fire_id = 0;
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
		for(int i = 0; i < kDeckSize; ++i)
			add_card(d, static_cast<uint8_t>(s), LOCATION_DECK, kDeckBase + s, POS_FACEDOWN_DEFENSE);
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
				if(buf[off + 4] == MSG_CONFIRM_CARDS && size > 2 && g_cur_seat >= 0) {
					g_confirms.push_back({ g_cur_seat, buf[off + 5] });
					g_confirm_turn.push_back({ g_fire_id, g_cur_seat });
				}
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
		if(std::getenv("CHECK_LOG"))
			std::fprintf(stderr, "prompt msg=%u size=%u turn=%d tp=%d phase=%d\n", static_cast<unsigned>(m->id), m->size, out.turns, F(d).infos.turn_player, F(d).infos.phase);
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
				if(seats != g_model.opponents(who) || seats.size() < 2)
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
			uint32_t min = 0;
			std::memcpy(&min, m->p + 2, 4);
			std::vector<uint32_t> r{ 0, min };
			for(uint32_t i = 0; i < min; ++i) r.push_back(i);
			OCG_DuelSetResponse(d, r.data(), static_cast<uint32_t>(r.size() * 4));
			break;
		}
		case MSG_SELECT_PLACE: {
			// u8 player, u8 count, u32 flag. The prompt must go to the seat of the card (the chooser).
			const int prompt_player = m->p[0];
			uint32_t flag = 0;
			std::memcpy(&flag, m->p + 2, 4);
			g_places.push_back({ g_cur_seat, prompt_player });
			if(std::getenv("CHECK_LOG")) std::fprintf(stderr, "place prompt to %d flag=%08x card seat %d turn %d\n", prompt_player, flag, g_cur_seat, g_cur_turn);
			g_place_turn.push_back(g_cur_turn);
			// the zone is on the field of the chooser (move) or of the bound opponent (moveopp)
			// (a prompt that has no free zone on that field is answered on the field of the chooser)
			int owner = g_probe == "moveopp" ? g_model.bound(g_cur_seat, g_cur_turn) : g_cur_seat;
			int seq = -1;
			for(int attempt = 0; attempt < 2 && seq < 0; ++attempt) {
				const bool own = owner == prompt_player;
				for(int q = 0; q < 5 && seq < 0; ++q)
					if(!(flag & ((1u << q) << (own ? 0 : 16)))) seq = q;
				if(seq < 0) owner = prompt_player;
			}
			if(seq < 0) { out.why = "no free place in the prompt"; break; }
			const uint8_t r[3] = { static_cast<uint8_t>(owner), static_cast<uint8_t>(LOCATION_MZONE), static_cast<uint8_t>(seq) };
			OCG_DuelSetResponse(d, r, 3);
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

static std::vector<std::string> run_captured(const Scenario& sc, Outcome& out) {
	std::vector<std::string> lines;
	std::string path_template = check_tmp_template("f3a-check-stderr"); char* path = path_template.data();
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

static int seat_of(const std::string& t) {
	const auto p = t.find(" s=");
	return p == std::string::npos ? -1 : std::atoi(t.c_str() + p + 3);
}
static int do_of(const std::string& t) {
	const auto p = t.find(" do=");
	return p == std::string::npos ? 1 : std::atoi(t.c_str() + p + 4);
}

static int count_kind(const std::vector<std::string>& nfold, char kind, const char* fn = nullptr) {
	int c = 0;
	for(const auto& l : nfold)
		if(l.size() > 6 && l[6] == kind && (!fn || l.find(std::string(" fn=") + fn) != std::string::npos))
			++c;
	return c;
}

// expected change between two records: +delta at seat q of the given array
struct Delta { int hand[MAX_DUELISTS] = {}; int deck[MAX_DUELISTS] = {}; int mz[MAX_DUELISTS] = {}; };

static bool same_delta(const Rec& a, const Rec& b, const Delta& d, int n) {
	for(int q = 0; q < n; ++q)
		if(b.hand[q] - a.hand[q] != d.hand[q] || b.deck[q] - a.deck[q] != d.deck[q] || b.mz[q] - a.mz[q] != d.mz[q])
			return false;
	return true;
}

static std::string show(const Rec& a, const Rec& b, int n) {
	std::string s;
	char buf[96];
	for(int q = 0; q < n; ++q) {
		std::snprintf(buf, sizeof(buf), " [seat %d hand%+d deck%+d mz%+d]", q, b.hand[q] - a.hand[q], b.deck[q] - a.deck[q], b.mz[q] - a.mz[q]);
		s += buf;
	}
	return s;
}

static void check_probe(const Scenario& sc, const Outcome& out, const std::vector<std::string>& nfold) {
	const Model& M = g_model;
	const int n = sc.n;
	std::map<int, Rec> pre, mid;
	int firings = 0, done = 0, own_firings = 0;
	std::set<int> done_seats;
	for(const auto& r : g_recs) {
		const int P = seat_of(r.text);
		if(P < 0) continue;
		const int T = r.turn_player;
		const int B = M.bound(P, T);
		if(r.text.compare(0, 7, "F3 pre ") == 0) {
			pre[P] = r;
			++firings;
			if(M.same_team(P, T)) ++own_firings;
		} else if(r.text.compare(0, 7, "F3 mid ") == 0) {
			mid[P] = r;
		} else if(r.text.compare(0, 8, "F3 post ") == 0 && pre.count(P)) {
			const Rec& a = pre[P];
			Delta d;
			const bool did = do_of(r.text) == 1;
			if(g_probe == "draw") {
				d.hand[B] = 1; d.deck[B] = -1;
				EXPECT(same_delta(a, r, d, n), "%s draw: seat %d turn %d: want the draw for seat %d, got:%s", sc.name, P, T, B, show(a, r, n).c_str());
			} else if(g_probe == "confirm") {
				EXPECT(same_delta(a, r, d, n), "%s confirm: seat %d turn %d changed the board:%s", sc.name, P, T, show(a, r, n).c_str());
			} else if(g_probe == "sendtohand") {
				EXPECT(mid.count(P) > 0, "%s sendtohand: no mid record for seat %d", sc.name, P);
				if(mid.count(P)) {
					Delta d1;
					d1.hand[B] = 1; d1.deck[B] = -1;
					EXPECT(same_delta(a, mid[P], d1, n), "%s sendtohand(g,1-tp): seat %d turn %d: want the card in the hand of seat %d, got:%s", sc.name, P, T, B, show(a, mid[P], n).c_str());
					Delta d2;
					d2.hand[P] += 1; d2.deck[B] -= 1;
					EXPECT(same_delta(mid[P], r, d2, n), "%s sendtohand(g,tp): seat %d turn %d: want the opponent card (seat %d) in the own hand, got:%s", sc.name, P, T, B, show(mid[P], r, n).c_str());
				}
			} else if(g_probe == "move") {
				if(did) { d.mz[P] = 1; d.deck[P] = -1; }
				EXPECT(same_delta(a, r, d, n), "%s move: seat %d turn %d (do=%d): want the card on the own field, got:%s", sc.name, P, T, did, show(a, r, n).c_str());
			} else if(g_probe == "moveopp") {
				// GetLocationCount(1-tp) reads the bound opponent (F5 binds at this first read), so the guard passes
				// exactly when that opponent has a free zone
				EXPECT(did == (a.mz[B] < 5), "%s moveopp: seat %d turn %d: do=%d, but seat %d has %d monsters", sc.name, P, T, did, B, a.mz[B]);
				if(did) { d.mz[B] = 1; d.deck[P] = -1; }
				EXPECT(same_delta(a, r, d, n), "%s moveopp: seat %d turn %d (do=%d): want the card on the field of seat %d, got:%s", sc.name, P, T, did, B, show(a, r, n).c_str());
			}
			if(did) { ++done; done_seats.insert(P); }
			pre.erase(P);
			mid.erase(P);
		}
	}
	EXPECT(firings > 0, "%s %s: the card never fired", sc.name, g_probe.c_str());
	EXPECT(done == firings || g_probe == "move" || g_probe == "moveopp", "%s %s: %d of %d operations finished", sc.name, g_probe.c_str(), done, firings);
	EXPECT(out.ended_ok, "%s %s: the duel did not reach turn %d: %s (turns=%d)", sc.name, g_probe.c_str(), sc.turns, out.why.c_str(), out.turns);
	EXPECT(out.depth_bad == 0, "%s %s: scope depth not 0 at %zu of %zu prompts", sc.name, g_probe.c_str(), out.depth_bad, out.prompts);
	EXPECT(g_errors == 0, "%s %s: %ld Lua errors, first: %s", sc.name, g_probe.c_str(), g_errors, g_error_text.empty() ? "" : g_error_text[0].c_str());
	EXPECT(count_kind(nfold, 'd') == 0 && count_kind(nfold, 'b') == 0, "%s %s: unexpected kind b/d records (d=%d b=%d)", sc.name, g_probe.c_str(),
	       count_kind(nfold, 'd'), count_kind(nfold, 'b'));
	if(n > 2) {
		// F5: no guess at all (no kind a). The pick prompt is the logged kind (c): one per firing of a probe that reads
		// a single "1" (the event names nobody, on every turn), none when only one opponent lives (silent bind) or
		// when the probe reads no single "1".
		EXPECT(count_kind(nfold, 'a') == 0, "%s %s: %d kind (a) records (an unbound fallback), want 0", sc.name, g_probe.c_str(), count_kind(nfold, 'a'));
		const bool reads_one = g_probe == "draw" || g_probe == "sendtohand" || g_probe == "moveopp";
		const int want_c = (reads_one && M.eliminate < 0) ? firings : 0;
		EXPECT(count_kind(nfold, 'c') == want_c, "%s %s: %d kind (c) records, want %d", sc.name, g_probe.c_str(), count_kind(nfold, 'c'), want_c);
		EXPECT(out.picks == static_cast<size_t>(want_c), "%s %s: %zu pick prompts, want %d", sc.name, g_probe.c_str(), out.picks, want_c);
		EXPECT(out.pick_bad.empty(), "%s %s: a pick prompt is wrong: %s", sc.name, g_probe.c_str(), out.pick_bad.empty() ? "" : out.pick_bad[0].c_str());
	} else {
		EXPECT(nfold.empty() && out.picks == 0, "%s %s: %zu fold records and %zu pick prompts at n == 2", sc.name, g_probe.c_str(), nfold.size(), out.picks);
	}
	if(g_probe == "confirm") {
		// every firing: one MSG_CONFIRM_CARDS per duelist of the other side, none to the card seat
		std::map<int, std::multiset<int>> by_firing_idx;
		// group the confirm messages by their (turn, seat) pair; one firing per pair and turn index is unique per step
		std::multimap<std::pair<int, int>, int> viewers;
		for(size_t i = 0; i < g_confirms.size(); ++i)
			viewers.insert({ g_confirm_turn[i], g_confirms[i].second });
		int groups = 0;
		for(auto it = viewers.begin(); it != viewers.end();) {
			const auto key = it->first;
			std::multiset<int> got;
			for(; it != viewers.end() && it->first == key; ++it) got.insert(it->second);
			++groups;
			const int P = key.second;
			const auto want = M.others(P);
			// the same (turn, seat) pair can fire once per turn only (count limit 1), so one group = one firing
			EXPECT(got.size() == want.size() && std::set<int>(got.begin(), got.end()) == want, "%s confirm: seat %d firing %d: %zu messages to the viewers, want one each for %zu duelists", sc.name, P, key.first, got.size(), want.size());
		}
		EXPECT(groups > 0 && groups == firings, "%s confirm: %d confirmed firings, %d firings", sc.name, groups, firings);
	}
	if(g_probe == "move" || g_probe == "moveopp") {
		EXPECT(done > 0, "%s %s: no operation did the move", sc.name, g_probe.c_str());
		EXPECT(static_cast<int>(g_places.size()) >= done, "%s %s: %zu place prompts for %d moves", sc.name, g_probe.c_str(), g_places.size(), done);
		int wrong = 0;
		for(const auto& p : g_places)
			if(p.first != p.second) ++wrong;
		EXPECT(wrong == 0, "%s %s: %d place prompts went to a seat that is not the chooser", sc.name, g_probe.c_str(), wrong);
		if(n > 2)
			EXPECT(static_cast<int>(done_seats.size()) == n - (M.eliminate >= 0 ? 1 : 0), "%s %s: only %zu of %d living seats did the move", sc.name, g_probe.c_str(), done_seats.size(), n - (M.eliminate >= 0 ? 1 : 0));
	}
	std::printf("%-6s %-10s n=%d firings=%d done=%d own-turn=%d prompts=%zu places=%zu confirms=%zu errors=%ld nfold(a/b/c/d)=%d/%d/%d/%d\n", sc.name, g_probe.c_str(), n, firings, done,
	            own_firings, out.prompts, g_places.size(), g_confirms.size(), g_errors, count_kind(nfold, 'a'), count_kind(nfold, 'b'), count_kind(nfold, 'c'), count_kind(nfold, 'd'));
}

int main(int argc, char** argv) {
	const std::string only = argc > 1 ? argv[1] : "";
	const std::vector<std::string> probes = { "draw", "confirm", "sendtohand", "move", "moveopp" };
	const std::vector<Scenario> scenarios = {
		{ "ffa3", 3, { 0, 1, 2 }, true, 7 },
		{ "ffa4", 4, { 0, 1, 2, 3 }, true, 9 },
		{ "tag", 4, { 0, 1, 0, 1 }, true, 9 },
		{ "ffa3e", 3, { 0, 1, 2 }, true, 7, 2 },
	};
	for(const auto& p : probes) {
		if(!only.empty() && only != p) continue;
		g_probe = p;
		for(const auto& sc : scenarios) {
			g_model.n = sc.n; g_model.team = sc.team; g_model.tag = true; g_model.eliminate = sc.eliminate;
			Outcome out;
			const auto nfold = run_captured(sc, out);
			check_probe(sc, out, nfold);
		}
		// n == 2: plain and with SetupDuelists(2,0,1) give the same bytes and the same log
		Scenario a{ "n2", 2, { 0, 1 }, false, 6 };
		Scenario b{ "n2s", 2, { 0, 1 }, true, 6 };
		g_model.n = 2; g_model.team = { 0, 1 }; g_model.tag = false; g_model.eliminate = -1;
		Outcome oa, ob;
		const auto na = run_captured(a, oa);
		check_probe(a, oa, na);
		std::vector<std::string> ta;
		for(const auto& r : g_recs) ta.push_back(r.text);
		const auto nb = run_captured(b, ob);
		check_probe(b, ob, nb);
		std::vector<std::string> tb;
		for(const auto& r : g_recs) tb.push_back(r.text);
		EXPECT(oa.hash == ob.hash && ta == tb && !ta.empty(), "n2 %s: bytes differ between plain and setup-always (%llx vs %llx)", p.c_str(), static_cast<unsigned long long>(oa.hash), static_cast<unsigned long long>(ob.hash));
		std::printf("n2     %-10s message bytes plain == setup-always: %s (hash %016llx)\n", p.c_str(), oa.hash == ob.hash ? "yes" : "NO", static_cast<unsigned long long>(oa.hash));
	}
	if(failures) {
		std::printf("F3a CHECK FAIL: %d failure(s)\n", failures);
		return 1;
	}
	std::printf("F3a CHECK OK\n");
	return 0;
}
