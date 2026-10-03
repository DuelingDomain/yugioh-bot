// F3C native check: the library prompts and the absolute range of a field effect under the perspective fold.
// Build and run: bash packages/duel-server/scripts/native/checks/run.sh <check name> (see README.md).
// It links the F3C dev tree core built with -DYGO_N_TRAP -D_GLIBCXX_ASSERTIONS.
// Every seat owns a test card (code 90001 + seat) in its monster zone. The card is a mandatory trigger on the
// standby phase. Its operation calls each prompt function of item 2 twice (who = tp, then who = 1-tp) and logs a
// marker before each call. The harness logs the player byte of every prompt, so a call is checked by the seat that got
// the prompt: tp -> the seat of the card, 1-tp -> the bound opponent (F5, see below). Then it registers field effects with
// SetAbsoluteRange + Duel.RegisterEffect and reads the ATK of every test card.
// F5 binding: the operation reads Duel.GetTurnPlayer() first. On the turn of an opponent that read binds this opponent
// (silent, no prompt). On an own turn the first "1-tp" asks the activator which opponent it means (MSG_SELECT_OPTION, every
// desc 0xFFFE0000|seat, ascending, living opponents only); the driver answers option k % options for pick number k, so the bound opponent is that seat (a core
// that ignores the answer fails). With one living opponent the bind is silent. Every pick here is the fallback pick of the operation
// step; the pick at activation is covered by opponent-pick. The pick prompts are counted, not treated as library prompts.
//   ffa3, ffa4, tag     n > 2
//   ffa4e               FFA4 with seat 1 marked eliminated: no prompt may go to seat 1
//   n2, n2s             n == 2 without and with Debug.SetupDuelists(2,0,1): same message bytes
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


#define HINT_PLACE_SEAT 0xF0  // MSG_HINT type of core patch 0045: the target seat of a place prompt
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
	local g=Duel.GetFieldGroup(tp,LOCATION_MZONE,LOCATION_MZONE)
	Debug.Message(string.format("F3C who s=%d tp=%d turn=%d",seat,tp,Duel.GetTurnPlayer()))
	-- who: "a" = tp, "b" = 1-tp. Every call is one prompt function of item 2.
	local calls={
		{"yesno",function(w) return Duel.SelectYesNo(w,0) end},
		{"option",function(w) return Duel.SelectOption(w,0,1) end},
		{"position",function(w) return Duel.SelectPosition(w,c,POS_FACEUP) end},
		{"annrace",function(w) return Duel.AnnounceRace(w,1,RACE_ALL) end},
		{"annattr",function(w) return Duel.AnnounceAttribute(w,1,ATTRIBUTE_ALL) end},
		{"anntype",function(w) return Duel.AnnounceType(w) end},
		{"anncoin",function(w) return Duel.AnnounceCoin(w) end},
		{"annnum",function(w) return Duel.AnnounceNumber(w,1,2,3) end},
		{"anncard",function(w) return Duel.AnnounceCard(w) end},
		{"disfield",function(w) return Duel.SelectDisableField(w,1,LOCATION_MZONE,0,0) end},
		{"fieldzone",function(w) return Duel.SelectFieldZone(w,1,LOCATION_MZONE,0,0) end},
		{"gselect",function(w) return g:Select(w,1,1,nil) end},
		{"gunsel",function(w) return g:SelectUnselect(Group.CreateGroup(),w,true,true,1,1) end},
		{"sumeq",function(w) return g:SelectWithSumEqual(w,function(tc) return 1 end,1,1,1) end},
		{"sumgt",function(w) return g:SelectWithSumGreater(w,function(tc) return 2 end,1) end},
		{"movec",function(w)
			local t=Duel.CreateToken(tp,5000+seat)
			local r=Duel.MoveToField(t,w,tp,LOCATION_MZONE,POS_FACEUP_ATTACK,true)
			if t:IsLocation(LOCATION_MZONE) then Duel.SendtoGrave(t,REASON_RULE) end
			return r end},
		{"moveo",function(w)
			local t=Duel.CreateToken(tp,5000+seat)
			local r=Duel.MoveToField(t,tp,w,LOCATION_MZONE,POS_FACEUP_ATTACK,true)
			if t:IsLocation(LOCATION_MZONE) then Duel.SendtoGrave(t,REASON_RULE) end
			return r end},
	}
	for _,cl in ipairs(calls) do
		for k,who in ipairs({tp,1-tp}) do
			local tag=k==1 and "a" or "b"
			Debug.Message(string.format("F3C call s=%d fn=%s who=%s",seat,cl[1],tag))
			cl[2](who)
			Debug.Message(string.format("F3C done s=%d fn=%s who=%s",seat,cl[1],tag))
		end
	end
	-- item 3: a field effect +500 ATK with SetAbsoluteRange(named) registered by Duel.RegisterEffect(e,reg)
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
	local function absboost(named,reg)
		local t0=snap()
		local e3=Effect.CreateEffect(c)
		e3:SetType(EFFECT_TYPE_FIELD)
		e3:SetCode(EFFECT_UPDATE_ATTACK)
		e3:SetValue(500)
		e3:SetAbsoluteRange(named,LOCATION_MZONE,0)
		e3:SetReset(RESET_PHASE+PHASE_END)
		Duel.RegisterEffect(e3,reg)
		return boosted(t0,snap())
	end
	local ra=absboost(tp,tp)
	local rb=absboost(1-tp,1-tp)
	local rc=absboost(1-tp,tp)
	local rd=absboost(tp,1-tp)
	Debug.Message(string.format("F3C abs s=%d tt=%s oo=%s ot=%s to=%s",seat,ra,rb,rc,rd))
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
	if(text && std::strncmp(text, "F3C ", 4) == 0 && g_duel) {
		Rec r;
		r.text = text;
		auto& f = F(g_duel);
		r.turn_player = f.infos.turn_player;
		std::memcpy(r.chosen, g_chosen, sizeof(r.chosen));
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
	for(int& c : g_chosen) c = -1;
	g_pick_no = 0;
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
		case MSG_SELECT_YESNO: case MSG_SELECT_EFFECTYN: case MSG_SELECT_OPTION: {
			if(m->id == MSG_SELECT_OPTION && m->size >= 2) {
				// u8 player, u8 count, count x u64 desc: the F5 pick of an opponent
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
					const int idx = static_cast<int>(g_pick_no++ % seats.size());
					if(who >= 0 && who < MAX_DUELISTS) g_chosen[who] = seats[idx];
					answer32(idx);
					break;
				}
			}
			Rec pr;
			pr.text = "F3C prompt p=" + std::to_string(m->p[0]) + " id=" + std::to_string(m->id);
			pr.turn_player = F(d).infos.turn_player;
			std::memset(pr.lp, 0, sizeof(pr.lp));
			std::memcpy(pr.chosen, g_chosen, sizeof(pr.chosen));
			g_recs.push_back(std::move(pr));
			answer32(m->id == MSG_SELECT_OPTION ? 0 : 1);
			break;
		}
		case MSG_SELECT_CHAIN: {
			const bool forced = m->size > 2 && m->p[2] != 0;
			answer32(forced ? 0 : -1);
			break;
		}
		case MSG_SORT_CHAIN: { const uint8_t r[1] = { 0xFF }; OCG_DuelSetResponse(d, r, 1); break; }
		case MSG_SELECT_CARD: case MSG_SELECT_SUM: case MSG_SELECT_UNSELECT_CARD: case MSG_SELECT_PLACE: case MSG_SELECT_DISFIELD:
		case MSG_SELECT_POSITION: case MSG_ANNOUNCE_RACE: case MSG_ANNOUNCE_ATTRIB: case MSG_ANNOUNCE_NUMBER: case MSG_ANNOUNCE_CARD: {
			{
				Rec pr;
				pr.text = "F3C prompt p=" + std::to_string(m->p[0]) + " id=" + std::to_string(m->id);
				pr.turn_player = F(d).infos.turn_player;
				std::memset(pr.lp, 0, sizeof(pr.lp));
				std::memcpy(pr.chosen, g_chosen, sizeof(pr.chosen));
				g_recs.push_back(std::move(pr));
			}
			if(m->id == MSG_SELECT_CARD) {
				uint32_t min = 0;
				std::memcpy(&min, m->p + 2, 4);
				std::vector<uint32_t> r{ 0, min };
				for(uint32_t i = 0; i < min; ++i) r.push_back(i);
				OCG_DuelSetResponse(d, r.data(), static_cast<uint32_t>(r.size() * 4));
			} else if(m->id == MSG_SELECT_SUM) {
				const uint32_t r[3] = { 0, 1, 0 };
				OCG_DuelSetResponse(d, r, sizeof(r));
			} else if(m->id == MSG_SELECT_UNSELECT_CARD) {
				answer32(-1);
			} else if(m->id == MSG_SELECT_PLACE || m->id == MSG_SELECT_DISFIELD) {
				uint32_t flag = 0;
				std::memcpy(&flag, m->p + 2, 4);
				uint8_t who = m->p[0], seat = who, seq = 0xff;
				for(uint8_t i = 0; i < 5 && seq == 0xff; ++i)
					if(!(flag & (1u << i))) seq = i;
				if(seq == 0xff) {
					// the zones of the other duelist: any living seat but the chooser
					for(uint8_t i = 0; i < 5 && seq == 0xff; ++i)
						if(!(flag & (1u << (16 + i)))) seq = i;
					for(uint8_t q = 0; q < sc.n; ++q)
						if(q != who && static_cast<int>(q) != sc.eliminate) { seat = q; break; }
					// F8: at n > 2 the core names the seat in a MSG_HINT 0xF0 right before the prompt and accepts no other seat
					if(msgs.size() >= 2) {
						const Msg& h = msgs[msgs.size() - 2];
						uint64_t hs = 0;
						if(h.id == MSG_HINT && h.size >= 10 && h.p[0] == HINT_PLACE_SEAT && h.p[1] == who) {
							std::memcpy(&hs, h.p + 2, 8);
							if(hs < 255) seat = static_cast<uint8_t>(hs);
						}
					}
				}
				const uint8_t r[3] = { seat, LOCATION_MZONE, seq == 0xff ? uint8_t(0) : seq };
				OCG_DuelSetResponse(d, r, sizeof(r));
			} else if(m->id == MSG_SELECT_POSITION) {
				answer32(POS_FACEUP_ATTACK);
			} else if(m->id == MSG_ANNOUNCE_RACE) {
				uint64_t avail = 0;
				std::memcpy(&avail, m->p + 2, 8);
				uint64_t v = avail & (~avail + 1);
				OCG_DuelSetResponse(d, &v, sizeof(v));
			} else if(m->id == MSG_ANNOUNCE_ATTRIB) {
				uint32_t avail = 0;
				std::memcpy(&avail, m->p + 2, 4);
				uint32_t v = avail & (~avail + 1);
				OCG_DuelSetResponse(d, &v, sizeof(v));
			} else if(m->id == MSG_ANNOUNCE_NUMBER) {
				answer32(0);
			} else {
				answer32(static_cast<int32_t>(kDeckBase));
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

// ---- stderr capture for the NFOLD records
static std::vector<std::string> run_captured(const Scenario& sc, Outcome& out) {
	std::vector<std::string> lines;
	std::string path_template = check_tmp_template("f3c-check-stderr"); char* path = path_template.data();
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
	// is an opponent (the GetTurnPlayer read binds it), else the only living opponent (silent bind), else the pick (option
	// k % options: chosen[P] is the seat of the last answer of seat P)
	int bound(int P, int T, const int* chosen) const {
		if(!fold()) return 1 - P;
		if(!same_team(P, T)) return T;
		const auto v = opponents(P);
		if(v.empty()) return -1;
		return v.size() == 1 ? v[0] : chosen[P];
	}
};

static std::map<std::string, std::string> fields(const std::string& text) {
	std::map<std::string, std::string> m;
	std::istringstream ss(text);
	std::string tok;
	ss >> tok;  // "F3C"
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
	int firings = 0, calls = 0, abs_lines = 0;
	std::string cur_fn, cur_who;
	int cur_s = -1, cur_t = -1;
	int snap[MAX_DUELISTS];  // chosen[] of the last record that was read (the pick of a call is answered before its prompts)
	for(int& c : snap) c = -1;
	std::vector<int> pl;     // the player byte of every prompt since the last call marker
	std::map<std::string, int> ncalls;
	auto close_call = [&]() {
		if(cur_fn.empty())
			return;
		++calls;
		++ncalls[cur_fn];
		const int P = cur_s, T = cur_t;
		// MoveToField(card, move_player, field_owner, ...): the zone prompt goes to move_player (the card of seat P), never to the
		// field owner, so the "moveo" call (field owner = who) has the chooser P in both rounds.
		const int want = (cur_who == "a" || cur_fn == "moveo") ? P : M.bound(P, T, snap);
		if(want < 0) {
			EXPECT(false, "%s: %s/%s seat %d turn seat %d: no bound opponent in the model", sc.name, cur_fn.c_str(), cur_who.c_str(), P, T);
			cur_fn.clear();
			pl.clear();
			return;
		}
		if(sc.eliminate >= 0) {
			for(int p : pl)
				EXPECT(p != sc.eliminate, "%s: %s/%s seat %d: a prompt went to the eliminated seat %d", sc.name, cur_fn.c_str(), cur_who.c_str(), P, sc.eliminate);
		} else {
			EXPECT(!pl.empty(), "%s: %s/%s seat %d turn seat %d: no prompt", sc.name, cur_fn.c_str(), cur_who.c_str(), P, T);
			for(int p : pl)
				EXPECT(p == want, "%s: %s/%s seat %d turn seat %d: the prompt went to seat %d, want seat %d", sc.name, cur_fn.c_str(), cur_who.c_str(), P, T, p, want);
		}
		cur_fn.clear();
		pl.clear();
	};
	for(const auto& r : g_recs) {
		auto m = fields_of(r.text);
		const std::string& k = m["kind"];
		if(k == "prompt") {
			std::memcpy(snap, r.chosen, sizeof(snap));
			pl.push_back(as_int(m, "p"));
			continue;
		}
		if(k == "call") {
			close_call();
			std::memcpy(snap, r.chosen, sizeof(snap));
			cur_fn = m["fn"];
			cur_who = m["who"];
			cur_s = as_int(m, "s");
			cur_t = r.turn_player;
			pl.clear();
			continue;
		}
		if(k == "done") {
			std::memcpy(snap, r.chosen, sizeof(snap));
			close_call();
			continue;
		}
		if(k == "who") {
			EXPECT(as_int(m, "s") != sc.eliminate, "%s: the card of the eliminated seat %d fired: %s", sc.name, sc.eliminate, r.text.c_str());
			++firings;
			continue;
		}
		if(k == "abs" && sc.eliminate < 0) {
			++abs_lines;
			const int P = as_int(m, "s");
			// the monsters of the seats whose folded value (as the script sees it) is the named player get the boost:
			// FFA: tp = seat P only, 1-tp = every opponent. Tag: the team id names a whole team. n == 2: the stock seat.
			auto want_for = [&](int named) {
				std::string w;
				for(int i = 0; i < 4; ++i)
					w += (i < M.n && M.f(P, i) == named) ? '1' : '0';
				return w;
			};
			const std::string wt = want_for(M.f(P, P)), wo = want_for(M.fold() ? 1 - M.f(P, P) : 1 - P);
			// tt: SetAbsoluteRange(tp) + RegisterEffect(e,tp). oo: SetAbsoluteRange(1-tp) + RegisterEffect(e,1-tp), the case of
			// item 3: the effect named the opponents and the owner changes to the bound opponent.
			// FFA: the range is stored relative to the owner, so after RegisterEffect(e,1-tp) the named side is the one seat that
			// "1" means (the bound opponent), not every opponent of tp. The other modes name the same seats as wo.
			std::string wb = wo;
			if(M.fold() && !M.tag) {
				wb.assign(4, '0');
				const int bw = M.bound(P, r.turn_player, r.chosen);
				EXPECT(bw >= 0, "%s: SetAbsoluteRange seat %d: no bound opponent in the model", sc.name, P);
				if(bw >= 0) wb[bw] = '1';
			}
			EXPECT(m["tt"] == wt && m["oo"] == wb, "%s: SetAbsoluteRange seat %d: tt=%s oo=%s, want tt=%s oo=%s", sc.name, P, m["tt"].c_str(), m["oo"].c_str(), wt.c_str(), wb.c_str());
			// ot: named 1-tp, owner stays tp (the effect is stored relative to the owner, so it is exact in FFA)
			if(!M.tag)
				EXPECT(m["ot"] == wb, "%s: SetAbsoluteRange seat %d: ot=%s, want %s", sc.name, P, m["ot"].c_str(), wb.c_str());
			// to: named tp, owner changes to the bound opponent: in FFA only the two sides (owner / others) exist. The owner
			// side gets the o range (nobody) and every other seat gets s: tp is boosted, with the seats beside it. Report only.
			std::printf("         abs seat %d tt=%s oo=%s ot=%s to=%s\n", P, m["tt"].c_str(), m["oo"].c_str(), m["ot"].c_str(), m["to"].c_str());
		}
	}
	close_call();
	EXPECT(firings > 0, "%s: no operation ran", sc.name);
	if(sc.eliminate < 0) {
		EXPECT(abs_lines == firings, "%s: %d operations, %d abs lines", sc.name, firings, abs_lines);
		for(const char* fn : { "yesno", "option", "position", "annrace", "annattr", "anntype", "anncoin", "annnum", "anncard", "disfield", "fieldzone", "gselect", "gunsel", "sumeq", "sumgt", "movec", "moveo" })
			EXPECT(ncalls[fn] == 2 * firings, "%s: %s ran %d times, want %d", sc.name, fn, ncalls[fn], 2 * firings);
	}
	EXPECT(out.depth_bad == 0, "%s: scope depth not 0 at %zu of %zu prompts", sc.name, out.depth_bad, out.prompts);
	EXPECT(g_errors == 0, "%s: %ld Lua errors, first: %s", sc.name, g_errors, g_error_text.empty() ? "" : g_error_text[0].c_str());
	if(M.fold()) {
		// F5: no unbound fallback (a), no binding conflict (b), no bad player value (d). There is one opponent prompt
		// per firing on an own turn of a seat with at least 2 living opponents, none on an opponent's turn (the
		// GetTurnPlayer read binds the turn player) and none with one living opponent (silent bind).
		int want_picks = 0;
		for(const auto& r : g_recs) {
			auto m = fields_of(r.text);
			if(m["kind"] != "who") continue;
			const int P = as_int(m, "s");
			if(M.same_team(P, r.turn_player) && M.opponents(P).size() >= 2) ++want_picks;
		}
		EXPECT(count_kind(nfold, 'a') == 0, "%s: %d kind (a) records (an unbound fallback), want 0", sc.name, count_kind(nfold, 'a'));
		EXPECT(count_kind(nfold, 'b') == 0 && count_kind(nfold, 'd') == 0, "%s: kind b/d records: %d/%d", sc.name, count_kind(nfold, 'b'), count_kind(nfold, 'd'));
		// R-COMMON-OPP-PICK and owner Q5: a permitted Tag chooser prompt is not a late-read violation.
		const int want_c = 0;
		EXPECT(count_kind(nfold, 'c') == want_c, "%s: %d kind (c) records, want %d", sc.name, count_kind(nfold, 'c'), want_c);
		EXPECT(out.picks == static_cast<size_t>(want_picks), "%s: %zu pick prompts, want %d", sc.name, out.picks, want_picks);
		EXPECT(out.pick_bad.empty(), "%s: a pick prompt is wrong: %s", sc.name, out.pick_bad.empty() ? "" : out.pick_bad[0].c_str());
	} else {
		EXPECT(nfold.empty() && out.picks == 0, "%s: %zu fold records and %zu pick prompts at n == 2", sc.name, nfold.size(), out.picks);
	}
	std::printf("%-6s n=%d firings=%d calls=%d prompts=%zu depth-bad=%zu errors=%ld picks=%zu nfold(a/b/c/d)=%d/%d/%d/%d\n", sc.name, sc.n, firings, calls,
	            out.prompts, out.depth_bad, g_errors, out.picks, count_kind(nfold, 'a'), count_kind(nfold, 'b'), count_kind(nfold, 'c'), count_kind(nfold, 'd'));
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
		std::printf("F3C CHECK FAIL: %d failure(s)\n", failures);
		return 1;
	}
	std::printf("F3C CHECK OK\n");
	return 0;
}
