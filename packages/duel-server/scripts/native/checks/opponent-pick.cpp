// F5 native check: one opponent is bound at activation (event, probe, pick, lazy prompt, summon procedures).
// Build and run: bash packages/duel-server/scripts/native/checks/run.sh <check name> (see README.md).
// It links the dev tree core built with -DYGO_N_TRAP -D_GLIBCXX_ASSERTIONS. Real card scripts are used for
// Ookazi, Don Zaloog, Dark Bribe and Lava Golem; two small stand-in spells cover the hand-check cards (Mind Crush kind).
// Every scenario sets up a few cards, drives one action with a plan (see Plan) and reads the core state afterwards.
// The default answer of every prompt that the plan does not name is the first legal one.
#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fcntl.h>
#include <fstream>
#include <functional>
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
#include "common.h"


static const char* kScripts = check_scripts_dir();
static const uint32_t kDeckBase = 5000;     // deck card of seat s = kDeckBase + s
static const uint32_t kHandCard = 5100;     // filler card for the hands
static const uint32_t kMindCrush = 91001;   // stand-in: needs a card in the hand of "1", discards one of them
static const uint32_t kPlainSpell = 91002;  // stand-in: activates, does nothing
static const uint32_t kMonster = 91003;     // vanilla monster for the fields
static const uint32_t kTrigChainEnd = 91005; // stand-in: field trigger on EVENT_CHAIN_END, like Mind Crush
static const uint32_t kLpSpell = 91006;     // stand-in: activates when "1" has LP (a team level read in Tag)
static const uint32_t kOokazi = 19523799;
static const uint32_t kZaloog = 76922029;
static const uint32_t kBribe = 77538567;
static const uint32_t kLava = 102380;

static const char* kMindCrushScript = R"LUA(
local s,id=GetID()
function s.initial_effect(c)
	local e1=Effect.CreateEffect(c)
	e1:SetType(EFFECT_TYPE_ACTIVATE)
	e1:SetCode(EVENT_FREE_CHAIN)
	e1:SetCategory(CATEGORY_HANDES)
	e1:SetTarget(s.tg)
	e1:SetOperation(s.op)
	c:RegisterEffect(e1)
end
function s.tg(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return Duel.GetFieldGroupCount(tp,0,LOCATION_HAND)>0 end
end
function s.op(e,tp,eg,ep,ev,re,r,rp)
	local g=Duel.GetFieldGroup(tp,0,LOCATION_HAND)
	local c=g:GetFirst()
	if c then Duel.SendtoGrave(c,REASON_EFFECT+REASON_DISCARD) end
end
)LUA";
static const char* kPlainSpellScript = R"LUA(
local s,id=GetID()
function s.initial_effect(c)
	local e1=Effect.CreateEffect(c)
	e1:SetType(EFFECT_TYPE_ACTIVATE)
	e1:SetCode(EVENT_FREE_CHAIN)
	e1:SetOperation(function() Debug.Message("F5 plain op") end)
	c:RegisterEffect(e1)
end
)LUA";

// Triggers of the review round: the event raises with reason_player 0 (and, for the chain end, event_player 0).
static std::string trigger_script(const char* code) {
	return std::string(R"LUA(
local s,id=GetID()
function s.initial_effect(c)
	local e1=Effect.CreateEffect(c)
	e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_O)
	e1:SetRange(LOCATION_MZONE)
	e1:SetCode()LUA") + code + R"LUA()
	e1:SetCountLimit(1)
	e1:SetTarget(s.tg)
	e1:SetOperation(s.op)
	c:RegisterEffect(e1)
end
function s.tg(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return Duel.GetFieldGroupCount(tp,0,LOCATION_HAND)>0 end
end
function s.op(e,tp,eg,ep,ev,re,r,rp)
	local g=Duel.GetFieldGroup(tp,0,LOCATION_HAND)
	local c=g:GetFirst()
	if c then Duel.SendtoGrave(c,REASON_EFFECT+REASON_DISCARD) end
end
)LUA";
}
static const char* kLpSpellScript = R"LUA(
local s,id=GetID()
function s.initial_effect(c)
	local e1=Effect.CreateEffect(c)
	e1:SetType(EFFECT_TYPE_ACTIVATE)
	e1:SetCode(EVENT_FREE_CHAIN)
	e1:SetTarget(s.tg)
	e1:SetOperation(function() Debug.Message("F5 lp op") end)
	c:RegisterEffect(e1)
end
function s.tg(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return Duel.GetLP(1-tp)>0 end
end
)LUA";

static void read_card(void*, uint32_t code, OCG_CardData* data) {
	std::memset(data, 0, sizeof(*data));
	data->code = code;
	data->type = TYPE_MONSTER | TYPE_NORMAL;
	data->level = 4;
	data->attribute = 1;
	data->race = 1;
	data->attack = 1000;
	data->defense = 1000;
	switch(code) {
	case kMindCrush: case kPlainSpell: case kOokazi: case kLpSpell:
		data->type = TYPE_SPELL;
		break;
	case kTrigChainEnd:
		data->type = TYPE_MONSTER | TYPE_EFFECT;
		break;
	case kBribe:
		data->type = TYPE_TRAP | TYPE_COUNTER;
		break;
	case kZaloog:
		data->type = TYPE_MONSTER | TYPE_EFFECT;
		data->attack = 1400;
		data->defense = 1500;
		break;
	case kLava:
		data->type = TYPE_MONSTER | TYPE_EFFECT | TYPE_SPSUMMON;
		data->level = 8;
		data->attribute = 0x20;
		data->race = 0x8;
		data->attack = 3000;
		data->defense = 2500;
		break;
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
	std::string n(name);
	std::replace(n.begin(), n.end(), '\\', '/');
	const auto slash = n.find_last_of('/');
	const std::string base = slash == std::string::npos ? n : n.substr(slash + 1);
	std::string text;
	if(base == "c91001.lua")
		text = kMindCrushScript;
	else if(base == "c91002.lua")
		text = kPlainSpellScript;
	else if(base == "c91005.lua")
		text = trigger_script("EVENT_CHAIN_END");
	else if(base == "c91006.lua")
		text = kLpSpellScript;
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

static long g_errors = 0;
static std::vector<std::string> g_error_text;
static std::vector<std::string> g_logs;
static void on_log(void*, const char* text, int type) {
	if(type == OCG_LOG_TYPE_ERROR || type == OCG_LOG_TYPE_UNDEFINED) {
		++g_errors;
		if(g_error_text.size() < 8)
			g_error_text.push_back(text ? text : "");
		if(std::getenv("CHECK_LOG"))
			std::fprintf(stderr, "core log [%d]: %s\n", type, text);
		return;
	}
	if(text && std::strncmp(text, "F5 ", 3) == 0)
		g_logs.push_back(text);
}

static field& F(OCG_Duel d) { return *static_cast<duel*>(d)->game_field; }

// ---- message parsing
template<typename T> static T rd(const uint8_t* p, size_t off) { T v; std::memcpy(&v, p + off, sizeof(T)); return v; }
struct Prompt {
	uint8_t id = 0;
	std::vector<uint8_t> b;
};
struct IdleEnt { uint32_t code; uint8_t con, loc; uint32_t seq; };
struct Idle {
	std::vector<IdleEnt> summon, spsummon, repo, mset, sset, act;
	bool to_bp = false, to_ep = false;
};
static Idle parse_idle(const Prompt& m) {
	Idle r;
	const uint8_t* p = m.b.data();
	size_t off = 1; // player
	auto list = [&](std::vector<IdleEnt>& v, size_t entry, size_t seqsize) {
		const uint32_t count = rd<uint32_t>(p, off);
		off += 4;
		for(uint32_t i = 0; i < count; ++i) {
			IdleEnt e;
			e.code = rd<uint32_t>(p, off);
			e.con = p[off + 4];
			e.loc = p[off + 5];
			e.seq = seqsize == 4 ? rd<uint32_t>(p, off + 6) : p[off + 6];
			v.push_back(e);
			off += entry;
		}
	};
	list(r.summon, 10, 4);
	list(r.spsummon, 10, 4);
	list(r.repo, 7, 1);
	list(r.mset, 10, 4);
	list(r.sset, 10, 4);
	list(r.act, 10 + 8 + 1, 4);
	r.to_bp = p[off] != 0;
	r.to_ep = p[off + 1] != 0;
	return r;
}
struct ChainEnt { uint32_t code; };
static std::vector<ChainEnt> parse_chain(const Prompt& m, bool& forced) {
	std::vector<ChainEnt> v;
	const uint8_t* p = m.b.data();
	forced = p[2] != 0;
	const uint32_t count = rd<uint32_t>(p, 3 + 4 + 4);
	size_t off = 3 + 4 + 4 + 4;
	for(uint32_t i = 0; i < count; ++i) {
		v.push_back({ rd<uint32_t>(p, off) });
		off += 4 + 10 + 8 + 1;
	}
	return v;
}
struct Battle {
	std::vector<uint32_t> attackers;
	bool to_m2 = false, to_ep = false;
};
static Battle parse_battle(const Prompt& m) {
	Battle r;
	const uint8_t* p = m.b.data();
	size_t off = 1;
	const uint32_t acts = rd<uint32_t>(p, off);
	off += 4 + acts * (4 + 1 + 1 + 4 + 8 + 1);
	const uint32_t atk = rd<uint32_t>(p, off);
	off += 4;
	for(uint32_t i = 0; i < atk; ++i) {
		r.attackers.push_back(rd<uint32_t>(p, off));
		off += 8;
	}
	r.to_m2 = p[off] != 0;
	r.to_ep = p[off + 1] != 0;
	return r;
}

// ---- the plan of one scenario and what it records
struct OptionPrompt { int player; std::vector<uint64_t> descs; };
struct Plan {
	const char* name = "";
	int n = 3;
	std::vector<int> team;
	int max_steps = 6000;
	// cards: seat, location, code, sequence
	struct Card { int seat; uint32_t loc; uint32_t code; uint32_t seq; };
	std::vector<Card> cards;
	// what to do
	int idle_player = -1;           // activate/special summon in the idle prompt of this seat ...
	uint32_t idle_act = 0;          // ... this card (activation)
	uint32_t idle_sp = 0;           // ... or this card (special summon procedure)
	uint32_t chain_act = 0;         // activate this card at the chain prompt of chain_player
	int chain_player = -1;
	int battle_player = -1;         // go to the Battle Phase and attack directly with the first attacker (seat's turn)
	int attack_seat = -1;           // the seat to pick for the direct attack
	int pick_seat = -1;             // the seat to answer at the 0xFFFE pick
	bool illegal_first = false;     // answer the first pick with an index that is out of range
	int eliminate_seat = -1;        // eliminate this seat at the first idle prompt of idle_player
	std::function<void(field&)> direct; // when set: called once after the duel started; the plan then plays no prompts
};
struct Result {
	bool activated = false;         // the plan's action was offered and taken
	bool offered = true;            // false when the card was not in the idle list
	std::vector<OptionPrompt> picks;      // the 0xFFFE prompts
	std::vector<OptionPrompt> others;     // the other option prompts
	std::vector<std::string> nfold;
	int retries = 0;
	std::vector<int> draws;         // MSG_DRAW players after the activation
	size_t hand_before[MAX_DUELISTS] = {};
	size_t hand_after[MAX_DUELISTS] = {};
	int lp_before[MAX_DUELISTS] = {};
	int lp_after[MAX_DUELISTS] = {};
	size_t mzone_after[MAX_DUELISTS] = {};
	bool lava_on[MAX_DUELISTS] = {};
	std::vector<uint32_t> spsummon_list;  // codes in the special summon list of the idle prompt of idle_player
	int scope_bad = 0;
	std::string why;
	bool done = false;
};

static void add_card(OCG_Duel d, uint8_t con, uint32_t loc, uint32_t code, uint32_t pos, uint32_t seq = 0) {
	OCG_NewCardInfo info;
	std::memset(&info, 0, sizeof(info));
	info.team = con;
	info.duelist = 0;
	info.code = code;
	info.con = con;
	info.loc = loc;
	info.seq = seq;
	info.pos = pos;
	OCG_DuelNewCard(d, &info);
}

static void snapshot(OCG_Duel d, size_t* hand, int* lp, size_t* mz, bool* lava) {
	auto& f = F(d);
	for(int s = 0; s < f.n_duelists; ++s) {
		hand[s] = f.player[s].list_hand.size();
		lp[s] = f.lp_ref(static_cast<uint8_t>(s));
		if(mz) {
			mz[s] = 0;
			for(auto* c : f.player[s].list_mzone) {
				if(c) {
					++mz[s];
					if(lava && c->data.code == kLava)
						lava[s] = true;
				}
			}
		}
	}
}

static Result play(const Plan& pl) {
	Result res;
	g_errors = 0;
	g_error_text.clear();
	g_logs.clear();
	OCG_DuelOptions options;
	std::memset(&options, 0, sizeof(options));
	options.seed[0] = 7; options.seed[1] = 2; options.seed[2] = 3; options.seed[3] = 4;
	options.flags = DUEL_MODE_MR5;
	options.team1 = { 8000, 0, 1 };
	options.team2 = { 7000, 0, 1 };
	options.cardReader = read_card;
	options.scriptReader = read_script;
	options.logHandler = on_log;
	OCG_Duel d = nullptr;
	if(OCG_CreateDuel(&d, &options) != OCG_DUEL_CREATION_SUCCESS) {
		res.why = "OCG_CreateDuel";
		return res;
	}
	for(const char* name : { "constant.lua", "utility.lua" }) {
		if(!read_script(nullptr, d, name)) {
			res.why = std::string("script ") + name;
			OCG_DestroyDuel(d);
			return res;
		}
	}
	if(pl.n > 2) {
		std::string code = "Debug.SetupDuelists(" + std::to_string(pl.n);
		for(int t : pl.team)
			code += "," + std::to_string(t);
		code += ")";
		if(!OCG_LoadScript(d, code.c_str(), static_cast<uint32_t>(code.size()), "setup.lua") || g_errors) {
			res.why = "SetupDuelists failed";
			OCG_DestroyDuel(d);
			return res;
		}
	}
	for(int s = 0; s < pl.n; ++s)
		for(int i = 0; i < 30; ++i)
			add_card(d, static_cast<uint8_t>(s), LOCATION_DECK, kDeckBase + s, POS_FACEDOWN_DEFENSE);
	for(const auto& c : pl.cards) {
		uint32_t pos = POS_FACEDOWN_DEFENSE;
		if(c.loc == LOCATION_MZONE)
			pos = POS_FACEUP_ATTACK;
		add_card(d, static_cast<uint8_t>(c.seat), c.loc, c.code, pos, c.seq);
	}
	OCG_StartDuel(d);
	if(pl.direct) {
		pl.direct(F(d));
		res.done = true;
		OCG_DestroyDuel(d);
		return res;
	}

	auto* pd = static_cast<duel*>(d);
	int turns = 0;
	Prompt last;
	bool illegal_sent = false, eliminated = false, attacked = false, bp_sent = false, spsummon_sent = false;
	bool saw_before = false;
	for(int steps = 0; steps < pl.max_steps && !res.done; ++steps) {
		const int status = OCG_DuelProcess(d);
		uint32_t length = 0;
		const auto* buf = static_cast<const uint8_t*>(OCG_DuelGetMessage(d, &length));
		std::vector<Prompt> msgs;
		bool retry = false;
		for(uint32_t off = 0; off + 4 <= length;) {
			const uint32_t size = rd<uint32_t>(buf, off);
			if(size > 0) {
				const uint8_t id = buf[off + 4];
				if(id == MSG_NEW_TURN)
					++turns;
				if(id == MSG_RETRY)
					retry = true;
				if(id == MSG_DRAW && res.activated)
					res.draws.push_back(buf[off + 5]);
				Prompt m;
				m.id = id;
				m.b.assign(buf + off + 5, buf + off + 4 + size);
				msgs.push_back(std::move(m));
			}
			off += 4 + size;
		}
		if(status == OCG_DUEL_STATUS_END) {
			res.why = "duel ended";
			break;
		}
		if(status != OCG_DUEL_STATUS_AWAITING)
			continue;
		if(pd->lua->scopes.size() != 0)
			++res.scope_bad;
		Prompt m;
		bool have = false;
		for(auto it = msgs.rbegin(); it != msgs.rend(); ++it) {
			if(it->id != MSG_RETRY && it->id >= MSG_SELECT_BATTLECMD && it->id <= MSG_SELECT_UNSELECT_CARD) {
				m = *it;
				have = true;
				break;
			}
		}
		if(retry) {
			++res.retries;
			if(!have)
				m = last;
		} else if(!have) {
			res.why = "awaiting without a prompt";
			break;
		}
		last = m;
		if(std::getenv("CHECK_TRACE"))
			std::fprintf(stdout, "  [%s] prompt %u player %d retry=%d turns=%d\n", pl.name, m.id, m.b.empty() ? -1 : m.b[0], retry, turns);
		auto answer32 = [&](int32_t v) { OCG_DuelSetResponse(d, &v, sizeof(v)); };
		auto answer_vec = [&](const std::vector<uint32_t>& v) { OCG_DuelSetResponse(d, v.data(), static_cast<uint32_t>(v.size() * 4)); };
		const int player = m.b.empty() ? -1 : m.b[0];
		switch(m.id) {
		case MSG_SELECT_IDLECMD: {
			const Idle idle = parse_idle(m);
			if(res.activated) {
				snapshot(d, res.hand_after, res.lp_after, res.mzone_after, res.lava_on);
				res.done = true;
				break;
			}
			if(pl.eliminate_seat >= 0 && !eliminated && player == pl.idle_player) {
				eliminated = true;
				F(d).eliminate(static_cast<uint8_t>(pl.eliminate_seat), 0);
			}
			if(player == pl.idle_player && (pl.idle_act || pl.idle_sp)) {
				if(!saw_before) {
					saw_before = true;
					snapshot(d, res.hand_before, res.lp_before, nullptr, nullptr);
				}
				const auto& list = pl.idle_act ? idle.act : idle.spsummon;
				for(const auto& e : idle.spsummon)
					res.spsummon_list.push_back(e.code);
				const uint32_t want = pl.idle_act ? pl.idle_act : pl.idle_sp;
				int idx = -1;
				for(size_t i = 0; i < list.size(); ++i) {
					if(list[i].code == want) {
						idx = static_cast<int>(i);
						break;
					}
				}
				if(idx < 0) {
					res.offered = false;
					snapshot(d, res.hand_after, res.lp_after, res.mzone_after, res.lava_on);
					res.done = true;
					break;
				}
				res.activated = true;
				spsummon_sent = pl.idle_sp != 0;
				answer32(static_cast<int32_t>((idx << 16) | (pl.idle_act ? 5 : 1)));
				break;
			}
			if(pl.battle_player == player && !bp_sent && idle.to_bp) {
				bp_sent = true;
				answer32(6);
				break;
			}
			answer32(idle.to_ep ? 7 : (idle.to_bp ? 6 : 7));
			break;
		}
		case MSG_SELECT_BATTLECMD: {
			const Battle b = parse_battle(m);
			if(res.activated) {
				snapshot(d, res.hand_after, res.lp_after, res.mzone_after, res.lava_on);
				res.done = true;
				break;
			}
			if(player == pl.battle_player && !attacked && !b.attackers.empty()) {
				attacked = true;
				if(!saw_before) {
					saw_before = true;
					snapshot(d, res.hand_before, res.lp_before, nullptr, nullptr);
				}
				answer32(static_cast<int32_t>((0 << 16) | 1));
				break;
			}
			answer32(b.to_ep ? 3 : 2);
			break;
		}
		case MSG_SELECT_EFFECTYN: {
			// a lone optional trigger is asked as yes/no: byte 0 player, then the u32 card code
			const uint32_t code = rd<uint32_t>(m.b.data(), 1);
			if(pl.chain_act && player == pl.chain_player && code == pl.chain_act && !res.activated) {
				if(!saw_before) {
					saw_before = true;
					snapshot(d, res.hand_before, res.lp_before, nullptr, nullptr);
				}
				res.activated = true;
				answer32(1);
			} else
				answer32(res.activated ? 1 : 0);
			break;
		}
		case MSG_SELECT_YESNO:
			answer32(1);
			break;
		case MSG_SELECT_OPTION: {
			OptionPrompt op;
			op.player = player;
			const int count = m.b[1];
			for(int i = 0; i < count; ++i)
				op.descs.push_back(rd<uint64_t>(m.b.data(), 2 + i * 8));
			bool pick = count > 0, attack = count > 0;
			for(auto dsc : op.descs) {
				pick = pick && ((dsc >> 16) == 0xFFFE);
				attack = attack && ((dsc >> 16) == 0xFFFF);
			}
			if(pick) {
				if(!retry)
					res.picks.push_back(op);
				if(pl.illegal_first && !illegal_sent) {
					illegal_sent = true;
					answer32(static_cast<int32_t>(op.descs.size()) + 3);
					break;
				}
				int idx = 0;
				for(size_t i = 0; i < op.descs.size(); ++i)
					if(static_cast<int>(op.descs[i] & 0xFFFF) == pl.pick_seat)
						idx = static_cast<int>(i);
				answer32(idx);
			} else if(attack) {
				int idx = 0;
				for(size_t i = 0; i < op.descs.size(); ++i)
					if(static_cast<int>(op.descs[i] & 0xFFFF) == pl.attack_seat)
						idx = static_cast<int>(i);
				answer32(idx);
			} else {
				if(!retry)
					res.others.push_back(op);
				answer32(0);
			}
			break;
		}
		case MSG_SELECT_CHAIN: {
			bool forced = false;
			const auto list = parse_chain(m, forced);
			if(std::getenv("CHECK_TRACE")) {
				std::fprintf(stdout, "    chain list (forced=%d):", forced);
				for(const auto& ce : list) std::fprintf(stdout, " %u", ce.code);
				std::fprintf(stdout, "\n");
			}
			if(pl.chain_act && player == pl.chain_player) {
				bool took = false;
				for(size_t i = 0; i < list.size(); ++i) {
					if(list[i].code == pl.chain_act) {
						if(!saw_before) {
							saw_before = true;
							snapshot(d, res.hand_before, res.lp_before, nullptr, nullptr);
						}
						res.activated = true;
						took = true;
						answer32(static_cast<int32_t>(i));
						break;
					}
				}
				if(took)
					break;
			}
			answer32(forced ? 0 : -1);
			break;
		}
		case MSG_SORT_CHAIN: { const uint8_t r[1] = { 0xFF }; OCG_DuelSetResponse(d, r, 1); break; }
		case MSG_SELECT_CARD: {
			const uint32_t min = rd<uint32_t>(m.b.data(), 2);
			std::vector<uint32_t> r{ 0, min };
			for(uint32_t i = 0; i < min; ++i) r.push_back(i);
			answer_vec(r);
			break;
		}
		case MSG_SELECT_TRIBUTE: {
			const uint32_t min = rd<uint32_t>(m.b.data(), 2);
			std::vector<uint32_t> r{ 0, min };
			for(uint32_t i = 0; i < min; ++i) r.push_back(i);
			answer_vec(r);
			break;
		}
		case MSG_SELECT_UNSELECT_CARD: {
			const bool finishable = m.b[1] != 0;
			if(finishable)
				answer32(-1);
			else {
				std::vector<uint32_t> r{ 1, 0 };
				answer_vec(r);
			}
			break;
		}
		case MSG_SELECT_POSITION: {
			const uint8_t pos = m.b[5];
			int32_t v = (pos & 1) ? 1 : (pos & 2) ? 2 : (pos & 4) ? 4 : 8;
			answer32(v);
			break;
		}
		case MSG_SELECT_PLACE: case MSG_SELECT_DISFIELD: {
			// the seat that the summoned monster goes to: the plan's pick seat (the bound opponent) when it is set
			const uint8_t count = m.b[1];
			const uint32_t flag = rd<uint32_t>(m.b.data(), 2);
			std::vector<uint8_t> r;
			uint32_t used = flag;
			for(uint8_t i = 0; i < count; ++i) {
				bool found = false;
				const int seat = (spsummon_sent && pl.pick_seat >= 0) ? pl.pick_seat : player;
				const bool own = seat == player;
				for(int zone = 0; zone < 2 && !found; ++zone) {
					const uint32_t loc = zone == 0 ? LOCATION_MZONE : LOCATION_SZONE;
					for(uint8_t seq = 0; seq < (zone == 0 ? 7 : 8) && !found; ++seq) {
						const uint32_t bit = ((1u << seq) << (zone == 0 ? 0 : 8)) << (own ? 0 : 16);
						if(used & bit)
							continue;
						used |= bit;
						r.push_back(static_cast<uint8_t>(seat));
						r.push_back(static_cast<uint8_t>(loc));
						r.push_back(seq);
						found = true;
					}
				}
				if(!found) {
					res.why = "no free zone";
					res.done = true;
				}
			}
			OCG_DuelSetResponse(d, r.data(), static_cast<uint32_t>(r.size()));
			break;
		}
		default: {
			char b[64];
			std::snprintf(b, sizeof(b), "unhandled prompt %u", static_cast<unsigned>(m.id));
			res.why = b;
			res.done = true;
			break;
		}
		}
	}
	if(!res.done && res.why.empty())
		res.why = "step limit";
	OCG_DestroyDuel(d);
	return res;
}

// ---- stderr capture for the NFOLD records
static Result run_captured(const Plan& pl) {
	std::string path_template = check_tmp_template("f5-check-stderr"); char* path = path_template.data();
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
	Result r = play(pl);
	if(capture && fd >= 0) {
		std::fflush(stderr);
		dup2(saved, 2);
		close(saved);
		close(fd);
		std::ifstream in(path);
		std::string line;
		while(std::getline(in, line)) {
			if(line.compare(0, 6, "NFOLD ") == 0)
				r.nfold.push_back(line);
			else
				std::fprintf(stderr, "%s\n", line.c_str());
		}
		unlink(path);
	}
	return r;
}

static size_t nfold_for(const Result& r, uint32_t code) {
	size_t n = 0;
	const std::string key = "card=" + std::to_string(code) + " ";
	for(const auto& l : r.nfold)
		if(l.find(key) != std::string::npos)
			++n;
	return n;
}
static std::string descs_text(const OptionPrompt& p) {
	std::string s = "seat" + std::to_string(p.player) + ":";
	char b[32];
	for(auto d : p.descs) { std::snprintf(b, sizeof(b), " %llx", static_cast<unsigned long long>(d)); s += b; }
	return s;
}
static void common(const char* name, const Result& r, uint32_t code) {
	EXPECT(r.why == "" && r.done, "%s: why=%s done=%d", name, r.why.c_str(), r.done);
	EXPECT(r.offered, "%s: the card was not offered", name);
	EXPECT(r.activated, "%s: the action was not taken", name);
	EXPECT(g_errors == 0, "%s: %ld Lua errors, first: %s", name, g_errors, g_error_text.empty() ? "" : g_error_text[0].c_str());
	EXPECT(r.scope_bad == 0, "%s: scope depth not 0 at %d prompts", name, r.scope_bad);
	EXPECT(nfold_for(r, code) == 0, "%s: %zu NFOLD records for card %u (first: %s)", name, nfold_for(r, code), code, r.nfold.empty() ? "" : r.nfold[0].c_str());
}
static std::vector<int> pick_seats(const OptionPrompt& p) {
	std::vector<int> v;
	for(auto d : p.descs) v.push_back(static_cast<int>(d & 0xFFFF));
	return v;
}
static std::vector<Plan::Card> fill_hands(const std::vector<std::pair<int, int>>& hands) {
	std::vector<Plan::Card> v;
	for(auto [seat, count] : hands)
		for(int i = 0; i < count; ++i)
			v.push_back({ seat, LOCATION_HAND, kHandCard, 0 });
	return v;
}

int main(int argc, char** argv) {
	const std::string only = argc > 1 ? argv[1] : "";
	auto want = [&](const char* n) { return only.empty() || only == n; };

	// ---- Mind Crush kind: the hand check decides
	if(want("mc-one")) {
		// FFA3: seat 1 has no hand, seat 2 has: bound to seat 2 without a prompt
		Plan pl; pl.name = "mc-one"; pl.n = 3; pl.team = { 0, 1, 2 };
		pl.cards = fill_hands({ { 2, 3 } });
		pl.cards.push_back({ 0, LOCATION_HAND, kMindCrush, 0 });
		pl.idle_player = 0; pl.idle_act = kMindCrush;
		const Result r = run_captured(pl);
		common(pl.name, r, kMindCrush);
		EXPECT(r.picks.empty(), "mc-one: a pick prompt was shown: %s", r.picks.empty() ? "" : descs_text(r.picks[0]).c_str());
		EXPECT(r.hand_after[2] + 1 == r.hand_before[2], "mc-one: seat 2 hand %zu -> %zu", r.hand_before[2], r.hand_after[2]);
		EXPECT(r.hand_after[1] == r.hand_before[1], "mc-one: seat 1 hand changed");
		std::printf("mc-one    FFA3 one qualifying opponent: silent bind, seat 2 hand %zu -> %zu, picks=%zu, nfold(card)=%zu\n", r.hand_before[2], r.hand_after[2], r.picks.size(), nfold_for(r, kMindCrush));
	}
	if(want("mc-two")) {
		// FFA3: both opponents have a hand: pick prompt with options 1 and 2; an illegal answer is rejected; 2 is chosen
		Plan pl; pl.name = "mc-two"; pl.n = 3; pl.team = { 0, 1, 2 };
		pl.cards = fill_hands({ { 1, 2 }, { 2, 3 } });
		pl.cards.push_back({ 0, LOCATION_HAND, kMindCrush, 0 });
		pl.idle_player = 0; pl.idle_act = kMindCrush; pl.pick_seat = 2; pl.illegal_first = true;
		const Result r = run_captured(pl);
		common(pl.name, r, kMindCrush);
		EXPECT(r.picks.size() == 1, "mc-two: %zu pick prompts", r.picks.size());
		if(r.picks.size() == 1) {
			EXPECT(r.picks[0].player == 0, "mc-two: the pick went to seat %d", r.picks[0].player);
			EXPECT(pick_seats(r.picks[0]) == std::vector<int>({ 1, 2 }), "mc-two: options %s", descs_text(r.picks[0]).c_str());
			EXPECT((r.picks[0].descs[0] >> 16) == 0xFFFE, "mc-two: desc %llx", static_cast<unsigned long long>(r.picks[0].descs[0]));
		}
		EXPECT(r.retries == 1, "mc-two: %d MSG_RETRY (the illegal answer must be rejected once)", r.retries);
		EXPECT(r.hand_after[2] + 1 == r.hand_before[2] && r.hand_after[1] == r.hand_before[1], "mc-two: hands seat1 %zu -> %zu, seat2 %zu -> %zu", r.hand_before[1], r.hand_after[1], r.hand_before[2], r.hand_after[2]);
		std::printf("mc-two    FFA3 two qualifying: pick options %s, illegal answer -> %d MSG_RETRY, chosen seat 2 hand %zu -> %zu, seat 1 %zu -> %zu\n",
			r.picks.empty() ? "-" : descs_text(r.picks[0]).c_str(), r.retries, r.hand_before[2], r.hand_after[2], r.hand_before[1], r.hand_after[1]);
	}
	if(want("mc-elim")) {
		// FFA4: seat 2 is eliminated: it is not in the legal set (options 1 and 3)
		Plan pl; pl.name = "mc-elim"; pl.n = 4; pl.team = { 0, 1, 2, 3 };
		pl.cards = fill_hands({ { 1, 2 }, { 2, 2 }, { 3, 2 } });
		pl.cards.push_back({ 0, LOCATION_HAND, kMindCrush, 0 });
		pl.idle_player = 0; pl.idle_act = kMindCrush; pl.pick_seat = 3; pl.eliminate_seat = 2;
		const Result r = run_captured(pl);
		common(pl.name, r, kMindCrush);
		EXPECT(r.picks.size() == 1, "mc-elim: %zu pick prompts", r.picks.size());
		if(r.picks.size() == 1)
			EXPECT(pick_seats(r.picks[0]) == std::vector<int>({ 1, 3 }), "mc-elim: options %s", descs_text(r.picks[0]).c_str());
		EXPECT(r.hand_after[3] + 1 == r.hand_before[3] && r.hand_after[1] == r.hand_before[1], "mc-elim: hands changed wrongly");
		std::printf("mc-elim   FFA4, seat 2 eliminated: pick options %s, chosen seat 3 hand %zu -> %zu\n", r.picks.empty() ? "-" : descs_text(r.picks[0]).c_str(), r.hand_before[3], r.hand_after[3]);
	}
	if(want("mc-elim1")) {
		// FFA3: seat 2 is eliminated, seat 1 has a hand: bound silently to seat 1
		Plan pl; pl.name = "mc-elim1"; pl.n = 3; pl.team = { 0, 1, 2 };
		pl.cards = fill_hands({ { 1, 2 }, { 2, 2 } });
		pl.cards.push_back({ 0, LOCATION_HAND, kMindCrush, 0 });
		pl.idle_player = 0; pl.idle_act = kMindCrush; pl.eliminate_seat = 2;
		const Result r = run_captured(pl);
		common(pl.name, r, kMindCrush);
		EXPECT(r.picks.empty(), "mc-elim1: a pick prompt was shown");
		EXPECT(r.hand_after[1] + 1 == r.hand_before[1], "mc-elim1: seat 1 hand %zu -> %zu", r.hand_before[1], r.hand_after[1]);
		std::printf("mc-elim1  FFA3, seat 2 eliminated: silent bind to seat 1, hand %zu -> %zu, picks=%zu\n", r.hand_before[1], r.hand_after[1], r.picks.size());
	}
	if(want("mc-tag")) {
		// Tag (0,1,0,1): the hand of the partner (seat 2) does not count; the opponents are seats 1 and 3
		Plan pl; pl.name = "mc-tag"; pl.n = 4; pl.team = { 0, 1, 0, 1 };
		pl.cards = fill_hands({ { 1, 2 }, { 2, 2 }, { 3, 2 } });
		pl.cards.push_back({ 0, LOCATION_HAND, kMindCrush, 0 });
		pl.idle_player = 0; pl.idle_act = kMindCrush; pl.pick_seat = 3;
		const Result r = run_captured(pl);
		common(pl.name, r, kMindCrush);
		EXPECT(r.picks.size() == 1, "mc-tag: %zu pick prompts", r.picks.size());
		if(r.picks.size() == 1)
			EXPECT(pick_seats(r.picks[0]) == std::vector<int>({ 1, 3 }), "mc-tag: options %s", descs_text(r.picks[0]).c_str());
		EXPECT(r.hand_after[3] + 1 == r.hand_before[3] && r.hand_after[1] == r.hand_before[1] && r.hand_after[2] == r.hand_before[2], "mc-tag: hands changed wrongly");
		std::printf("mc-tag    Tag: pick options %s (the partner is not offered), chosen seat 3 hand %zu -> %zu\n", r.picks.empty() ? "-" : descs_text(r.picks[0]).c_str(), r.hand_before[3], r.hand_after[3]);
	}
	if(want("mc-n2")) {
		Plan pl; pl.name = "mc-n2"; pl.n = 2; pl.team = {};
		pl.cards = fill_hands({ { 1, 2 } });
		pl.cards.push_back({ 0, LOCATION_HAND, kMindCrush, 0 });
		pl.idle_player = 0; pl.idle_act = kMindCrush;
		const Result r = run_captured(pl);
		common(pl.name, r, kMindCrush);
		EXPECT(r.picks.empty() && r.others.empty(), "mc-n2: an option prompt was shown");
		EXPECT(r.hand_after[1] + 1 == r.hand_before[1], "mc-n2: seat 1 hand %zu -> %zu", r.hand_before[1], r.hand_after[1]);
		std::printf("mc-n2     n=2: no prompt, seat 1 hand %zu -> %zu\n", r.hand_before[1], r.hand_after[1]);
	}

	// ---- Ookazi: the lazy prompt in the target (damage to "1")
	if(want("ookazi")) {
		Plan pl; pl.name = "ookazi"; pl.n = 3; pl.team = { 0, 1, 2 };
		pl.cards = { { 0, LOCATION_HAND, kOokazi, 0 } };
		pl.idle_player = 0; pl.idle_act = kOokazi; pl.pick_seat = 2; pl.illegal_first = true;
		const Result r = run_captured(pl);
		common(pl.name, r, kOokazi);
		EXPECT(r.picks.size() == 1, "ookazi: %zu pick prompts", r.picks.size());
		if(r.picks.size() == 1)
			EXPECT(pick_seats(r.picks[0]) == std::vector<int>({ 1, 2 }), "ookazi: options %s", descs_text(r.picks[0]).c_str());
		EXPECT(r.retries == 1, "ookazi: %d MSG_RETRY", r.retries);
		EXPECT(r.lp_after[2] == r.lp_before[2] - 800 && r.lp_after[1] == r.lp_before[1] && r.lp_after[0] == r.lp_before[0], "ookazi: LP before %d,%d,%d after %d,%d,%d",
			r.lp_before[0], r.lp_before[1], r.lp_before[2], r.lp_after[0], r.lp_after[1], r.lp_after[2]);
		std::printf("ookazi    FFA3: lazy pick %s, illegal -> %d MSG_RETRY, LP %d,%d,%d -> %d,%d,%d\n", r.picks.empty() ? "-" : descs_text(r.picks[0]).c_str(), r.retries,
			r.lp_before[0], r.lp_before[1], r.lp_before[2], r.lp_after[0], r.lp_after[1], r.lp_after[2]);
	}
	if(want("ookazi-tag")) {
		Plan pl; pl.name = "ookazi-tag"; pl.n = 4; pl.team = { 0, 1, 0, 1 };
		pl.cards = { { 0, LOCATION_HAND, kOokazi, 0 } };
		pl.idle_player = 0; pl.idle_act = kOokazi;
		const Result r = run_captured(pl);
		common(pl.name, r, kOokazi);
		EXPECT(r.picks.size() <= 1, "ookazi-tag: %zu pick prompts", r.picks.size());
		if(r.picks.size() == 1)
			EXPECT(pick_seats(r.picks[0]) == std::vector<int>({ 1, 3 }), "ookazi-tag: options %s", descs_text(r.picks[0]).c_str());
		EXPECT(r.lp_after[1] == r.lp_before[1] - 800 && r.lp_after[0] == r.lp_before[0], "ookazi-tag: team LP %d,%d -> %d,%d", r.lp_before[0], r.lp_before[1], r.lp_after[0], r.lp_after[1]);
		std::printf("ookazi-tag Tag: SetTargetPlayer asks (options 1,3), the answer does not matter for team LP, team LP %d,%d -> %d,%d\n", r.lp_before[0], r.lp_before[1], r.lp_after[0], r.lp_after[1]);
	}

	// ---- Don Zaloog: the damaged player binds without a prompt
	if(want("zaloog")) {
		Plan pl; pl.name = "zaloog"; pl.n = 3; pl.team = { 0, 1, 2 };
		pl.cards = fill_hands({ { 0, 3 }, { 2, 3 } });
		pl.cards.push_back({ 1, LOCATION_MZONE, kZaloog, 0 });
		pl.battle_player = 1; pl.attack_seat = 2; pl.chain_act = kZaloog; pl.chain_player = 1;
		pl.max_steps = 20000;
		const Result r = run_captured(pl);
		common(pl.name, r, kZaloog);
		EXPECT(r.picks.empty(), "zaloog: a 0xFFFE pick prompt was shown: %s", r.picks.empty() ? "" : descs_text(r.picks[0]).c_str());
		EXPECT(r.hand_after[2] + 1 == r.hand_before[2] && r.hand_after[0] == r.hand_before[0], "zaloog: hands seat0 %zu -> %zu, seat2 %zu -> %zu", r.hand_before[0], r.hand_after[0], r.hand_before[2], r.hand_after[2]);
		std::printf("zaloog    FFA3: damaged seat 2 binds silently, hand seat 2 %zu -> %zu, seat 0 %zu -> %zu, picks=%zu\n", r.hand_before[2], r.hand_after[2], r.hand_before[0], r.hand_after[0], r.picks.size());
	}

	// ---- Dark Bribe: binds to the activator of the chain link it answers
	if(want("bribe")) {
		Plan pl; pl.name = "bribe"; pl.n = 3; pl.team = { 0, 1, 2 };
		pl.cards = { { 0, LOCATION_SZONE, kBribe, 0 }, { 2, LOCATION_HAND, kPlainSpell, 0 } };
		pl.idle_player = 2; pl.idle_act = kPlainSpell; pl.chain_act = kBribe; pl.chain_player = 0;
		pl.max_steps = 20000;
		const Result r = run_captured(pl);
		EXPECT(r.activated, "bribe: not activated (offered=%d, why=%s)", r.offered, r.why.c_str());
		EXPECT(g_errors == 0, "bribe: %ld Lua errors, first: %s", g_errors, g_error_text.empty() ? "" : g_error_text[0].c_str());
		EXPECT(r.picks.empty(), "bribe: a 0xFFFE pick prompt was shown: %s", r.picks.empty() ? "" : descs_text(r.picks[0]).c_str());
		EXPECT(nfold_for(r, kBribe) == 0, "bribe: %zu NFOLD records", nfold_for(r, kBribe));
		EXPECT(r.draws.size() == 1 && r.draws[0] == 2, "bribe: %zu draws after the activation", r.draws.size());
		std::printf("bribe     FFA3: picks=%zu, draws after the activation by seat: ", r.picks.size());
		for(int p : r.draws) std::printf("%d ", p);
		std::printf("\n");
	}

	// ---- Lava Golem: Tribute monsters of one opponent, goes to that opponent's field
	auto lava_plan = [&](const char* name, int n, std::vector<int> team, std::vector<std::pair<int, int>> monsters) {
		Plan pl; pl.name = name; pl.n = n; pl.team = std::move(team);
		pl.cards = { { 0, LOCATION_HAND, kLava, 0 } };
		for(auto [seat, count] : monsters)
			for(int i = 0; i < count; ++i)
				pl.cards.push_back({ seat, LOCATION_MZONE, kMonster, static_cast<uint32_t>(i) });
		pl.idle_player = 0; pl.idle_sp = kLava;
		pl.max_steps = 20000;
		return pl;
	};
	if(want("lava-one")) {
		Plan pl = lava_plan("lava-one", 3, { 0, 1, 2 }, { { 2, 2 }, { 1, 0 } });
		pl.pick_seat = 2;
		const Result r = run_captured(pl);
		common(pl.name, r, kLava);
		EXPECT(r.picks.empty(), "lava-one: a pick prompt was shown (only seat 2 qualifies)");
		EXPECT(r.lava_on[2] && !r.lava_on[0] && !r.lava_on[1], "lava-one: Golem on seat0=%d seat1=%d seat2=%d", r.lava_on[0], r.lava_on[1], r.lava_on[2]);
		EXPECT(r.mzone_after[2] == 1, "lava-one: seat 2 has %zu monsters (Golem only expected)", r.mzone_after[2]);
		std::printf("lava-one  FFA3 (2 monsters on seat 2): Golem on seat 2 field=%d, seat 2 monsters %zu, picks=%zu\n", r.lava_on[2], r.mzone_after[2], r.picks.size());
	}
	if(want("lava-split")) {
		Plan pl = lava_plan("lava-split", 3, { 0, 1, 2 }, { { 1, 1 }, { 2, 1 } });
		const Result r = run_captured(pl);
		EXPECT(!r.offered, "lava-split: the Golem was offered with one monster on each opponent (list: %zu entries)", r.spsummon_list.size());
		EXPECT(g_errors == 0, "lava-split: %ld Lua errors", g_errors);
		std::printf("lava-split FFA3 (1 monster each on seats 1 and 2): offered=%d (must be 0)\n", r.offered);
	}
	if(want("lava-two")) {
		Plan pl = lava_plan("lava-two", 3, { 0, 1, 2 }, { { 1, 2 }, { 2, 2 } });
		pl.pick_seat = 2; pl.illegal_first = true;
		const Result r = run_captured(pl);
		common(pl.name, r, kLava);
		EXPECT(r.picks.size() == 1, "lava-two: %zu pick prompts", r.picks.size());
		if(r.picks.size() == 1)
			EXPECT(pick_seats(r.picks[0]) == std::vector<int>({ 1, 2 }), "lava-two: options %s", descs_text(r.picks[0]).c_str());
		EXPECT(r.retries >= 1, "lava-two: %d MSG_RETRY", r.retries);
		EXPECT(r.lava_on[2] && !r.lava_on[1], "lava-two: Golem on seat1=%d seat2=%d", r.lava_on[1], r.lava_on[2]);
		EXPECT(r.mzone_after[1] == 2 && r.mzone_after[2] == 1, "lava-two: monsters seat1=%zu seat2=%zu", r.mzone_after[1], r.mzone_after[2]);
		std::printf("lava-two  FFA3 (2+2): pick %s, illegal -> %d MSG_RETRY, Golem on seat 2=%d, monsters seat1=%zu seat2=%zu\n", r.picks.empty() ? "-" : descs_text(r.picks[0]).c_str(), r.retries, r.lava_on[2], r.mzone_after[1], r.mzone_after[2]);
	}

	// ---- review round: the event opponent must come from an event that really names a player
	if(want("mc-seat1")) {
		// FFA3: seat 1 activates (the idle activation has no event: event_player and reason_player are 0). Seats 0 and 2
		// both have a hand: the pick goes to seat 1 with options 0 and 2. It must not bind seat 0 without a question.
		Plan pl; pl.name = "mc-seat1"; pl.n = 3; pl.team = { 0, 1, 2 };
		pl.cards = fill_hands({ { 0, 2 }, { 2, 3 } });
		pl.cards.push_back({ 1, LOCATION_HAND, kMindCrush, 0 });
		pl.idle_player = 1; pl.idle_act = kMindCrush; pl.pick_seat = 2;
		const Result r = run_captured(pl);
		common(pl.name, r, kMindCrush);
		EXPECT(r.picks.size() == 1, "mc-seat1: %zu pick prompts", r.picks.size());
		if(r.picks.size() == 1) {
			EXPECT(r.picks[0].player == 1, "mc-seat1: the pick went to seat %d", r.picks[0].player);
			EXPECT(pick_seats(r.picks[0]) == std::vector<int>({ 0, 2 }), "mc-seat1: options %s", descs_text(r.picks[0]).c_str());
		}
		EXPECT(r.hand_after[2] + 1 == r.hand_before[2] && r.hand_after[0] == r.hand_before[0], "mc-seat1: hands seat0 %zu -> %zu, seat2 %zu -> %zu", r.hand_before[0], r.hand_after[0], r.hand_before[2], r.hand_after[2]);
		std::printf("mc-seat1  FFA3, seat 1 activates, seats 0 and 2 qualify: pick %s, chosen seat 2 hand %zu -> %zu, seat 0 %zu -> %zu\n",
			r.picks.empty() ? "-" : descs_text(r.picks[0]).c_str(), r.hand_before[2], r.hand_after[2], r.hand_before[0], r.hand_after[0]);
	}
	// trigger scenarios: seat 1 has the trigger on EVENT_CHAIN_END (raised with event_player 0 and reason_player 0)
	// (a trigger on the start of a phase is not offered by this harness in MR5 at all: see event-table for those events)
	auto trig_plan = [&](const char* name, uint32_t code, std::vector<std::pair<int, int>> hands) {
		Plan pl; pl.name = name; pl.n = 3; pl.team = { 0, 1, 2 };
		pl.cards = fill_hands(hands);
		pl.cards.push_back({ 1, LOCATION_MZONE, code, 0 });
		pl.chain_act = code; pl.chain_player = 1; pl.pick_seat = 2;
		// seat 0 makes a chain (a plain spell); its end raises EVENT_CHAIN_END with event_player 0 and reason_player 0
		pl.cards.push_back({ 0, LOCATION_HAND, kPlainSpell, 0 });
		pl.idle_player = 0; pl.idle_act = kPlainSpell; pl.chain_act = 0;
		pl.max_steps = 20000;
		return pl;
	};
	for(const uint32_t code : { kTrigChainEnd }) {
		const char* tag = "chainend";
		const std::string n1 = std::string("trig-") + tag + "-solo", n2 = std::string("trig-") + tag + "-two";
		if(want(n1.c_str())) {
			// only seat 2 has a hand: the trigger is offered (it must not bind seat 0 and fail) and binds seat 2 silently
			Plan pl = trig_plan(n1.c_str(), code, { { 2, 3 } });
			const Result r = run_captured(pl);
			common(pl.name, r, code);
			EXPECT(r.picks.empty(), "%s: a pick prompt was shown: %s", pl.name, r.picks.empty() ? "" : descs_text(r.picks[0]).c_str());
			const size_t own0 = code == kTrigChainEnd ? 1 : 0; // the plain spell of seat 0 leaves its hand
			EXPECT(r.hand_after[2] + 1 == r.hand_before[2] && r.hand_after[0] + own0 == r.hand_before[0], "%s: hands seat0 %zu -> %zu, seat2 %zu -> %zu", pl.name, r.hand_before[0], r.hand_after[0], r.hand_before[2], r.hand_after[2]);
			std::printf("%-9s FFA3 seat 1 trigger (%s), only seat 2 has a hand: silent bind to seat 2, hand %zu -> %zu, picks=%zu\n", pl.name, tag, r.hand_before[2], r.hand_after[2], r.picks.size());
		}
		if(want(n2.c_str())) {
			// seats 0 and 2 have a hand: seat 1 picks between 0 and 2 (the event names nobody)
			Plan pl = trig_plan(n2.c_str(), code, { { 0, 2 }, { 2, 3 } });
			const Result r = run_captured(pl);
			common(pl.name, r, code);
			EXPECT(r.picks.size() == 1, "%s: %zu pick prompts", pl.name, r.picks.size());
			if(r.picks.size() == 1) {
				EXPECT(r.picks[0].player == 1, "%s: the pick went to seat %d", pl.name, r.picks[0].player);
				EXPECT(pick_seats(r.picks[0]) == std::vector<int>({ 0, 2 }), "%s: options %s", pl.name, descs_text(r.picks[0]).c_str());
			}
			const size_t own0 = code == kTrigChainEnd ? 1 : 0;
			EXPECT(r.hand_after[2] + 1 == r.hand_before[2] && r.hand_after[0] + own0 == r.hand_before[0], "%s: hands seat0 %zu -> %zu, seat2 %zu -> %zu", pl.name, r.hand_before[0], r.hand_after[0], r.hand_before[2], r.hand_after[2]);
			std::printf("%-9s FFA3 seat 1 trigger (%s), seats 0 and 2 have a hand: pick %s, chosen seat 2 hand %zu -> %zu\n", pl.name, tag, r.picks.empty() ? "-" : descs_text(r.picks[0]).c_str(), r.hand_before[2], r.hand_after[2]);
		}
	}
	// ---- the event opponent of a table of events (direct calls of field::event_opponent, FFA3, P = seat 1)
	if(want("event-table")) {
		Plan pl; pl.name = "event-table"; pl.n = 3; pl.team = { 0, 1, 2 };
		pl.direct = [&](field& f) {
			struct Row { const char* what; uint32_t code; uint8_t ep, rp; bool has_effect; uint32_t reason; uint8_t want; };
			const uint8_t NO = DUELIST_NONE;
			const Row rows[] = {
				{ "phase start (turn player 0)", EVENT_PHASE_START + PHASE_BATTLE_START, 0, 0, false, 0, NO },
				{ "turn end (turn player 0)", EVENT_TURN_END, 0, 0, false, 0, NO },
				{ "chain end (0, 0)", EVENT_CHAIN_END, 0, 0, false, 0, NO },
				{ "idle activation (nil event, PLAYER_NONE)", 0, PLAYER_NONE, PLAYER_NONE, false, 0, NO },
				{ "free chain with ep 2", EVENT_FREE_CHAIN, 2, 2, false, 0, NO },
				{ "default event (0, 0)", 0, 0, 0, false, 0, NO },
				{ "battle damage to seat 2 (Zaloog)", EVENT_BATTLE_DAMAGE, 2, 1, false, 0, 2 },
				{ "damage to seat 0", EVENT_DAMAGE, 0, 2, true, REASON_EFFECT, 0 },
				{ "chaining by seat 2 (Dark Bribe)", EVENT_CHAINING, 2, 2, true, 0, 2 },
				{ "move, reason effect of seat 0, destination seat 1", EVENT_MOVE, 1, 0, true, REASON_EFFECT, 0 },
				{ "destroy, rule reason 0 and rp 0", EVENT_DESTROY, 0, 0, false, 0, NO },
				{ "destroyed by a battle (reason set, rp 2)", EVENT_DESTROYED, 0, 2, false, REASON_BATTLE, 2 },
				{ "custom event, ep 2", EVENT_CUSTOM + 7, 2, 0, false, 0, 2 },
				{ "own summon (ep 1)", EVENT_SPSUMMON_SUCCESS, 1, 1, false, 0, NO },
			};
			for(const auto& row : rows) {
				tevent e;
				e.event_code = row.code;
				e.event_player = row.ep;
				e.reason_player = row.rp;
				e.reason = row.reason;
				e.reason_effect = row.has_effect ? reinterpret_cast<effect*>(&e) : nullptr; // only the null test is read
				const uint8_t got = f.event_opponent(1, e);
				EXPECT(got == row.want, "event-table: %s: seat %u, want %u", row.what, static_cast<unsigned>(got), static_cast<unsigned>(row.want));
				std::printf("event-table  %-52s -> %s\n", row.what, got == NO ? "none" : std::to_string(got).c_str());
			}
		};
		const Result r = run_captured(pl);
		EXPECT(r.why == "" && r.done, "event-table: why=%s", r.why.c_str());
	}
	// ---- Tag: a team level read of the LP needs no opponent
	if(want("tag-lp")) {
		Plan pl; pl.name = "tag-lp"; pl.n = 4; pl.team = { 0, 1, 0, 1 };
		pl.cards = { { 0, LOCATION_HAND, kLpSpell, 0 } };
		pl.idle_player = 0; pl.idle_act = kLpSpell;
		const Result r = run_captured(pl);
		common(pl.name, r, kLpSpell);
		EXPECT(r.picks.empty() && r.others.empty(), "tag-lp: a prompt was shown for a team level LP read: %s", r.picks.empty() ? "" : descs_text(r.picks[0]).c_str());
		std::printf("tag-lp    Tag: GetLP(1-tp) is a team level read: picks=%zu, other option prompts=%zu\n", r.picks.size(), r.others.size());
	}
	if(want("ffa-lp")) {
		// FFA3: the same read depends on the opponent, both pass: the pick is shown (unchanged)
		Plan pl; pl.name = "ffa-lp"; pl.n = 3; pl.team = { 0, 1, 2 };
		pl.cards = { { 0, LOCATION_HAND, kLpSpell, 0 } };
		pl.idle_player = 0; pl.idle_act = kLpSpell;
		const Result r = run_captured(pl);
		common(pl.name, r, kLpSpell);
		EXPECT(r.picks.size() == 1 && pick_seats(r.picks[0]) == std::vector<int>({ 1, 2 }), "ffa-lp: picks=%zu", r.picks.size());
		std::printf("ffa-lp    FFA3: GetLP(1-tp) with two opponents: picks=%zu\n", r.picks.size());
	}
	if(failures) {
		std::printf("F5 CHECK FAIL: %d failure(s)\n", failures);
		return 1;
	}
	std::printf("F5 CHECK OK\n");
	return 0;
}
