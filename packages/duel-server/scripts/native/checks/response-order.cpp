// T3 native check: the response cursor for n > 2 (priority windows, SEGOC order, phase-change windows).
// Build and run: bash packages/duel-server/scripts/native/checks/run.sh <check name> (see README.md).
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <algorithm>
#include <functional>
#include <map>
#include <string>
#include <vector>
#include "ocgapi.h"
#include "ocgapi_constants.h"
#include "duel.h"
#include "field.h"
#include "common.h"


// Cards: 100 Normal Spell (free chain activation), 200 quick effect monster (hand), 300 forced trigger monster
// (hand, the draw of any card (EVENT_DRAW)), 301 optional trigger monster (hand, the draw of any card (EVENT_DRAW)), 2 Fusion, others vanilla.
static void read_card(void*, uint32_t code, OCG_CardData* data) {
	std::memset(data, 0, sizeof(*data));
	data->code = code;
	if(code == 100)
		data->type = TYPE_SPELL;
	else if(code == 200 || code == 300 || code == 301)
		data->type = TYPE_MONSTER | TYPE_EFFECT | TYPE_SPSUMMON;
	else
		data->type = TYPE_MONSTER | (code == 2 ? TYPE_FUSION : (TYPE_NORMAL | TYPE_SPSUMMON));
	data->level = 4;
	data->attribute = 1;
	data->race = 1;
	data->attack = 1000;
	data->defense = 1000;
}
static const char* script_text(uint32_t code) {
	switch(code) {
	case 100:
		return "local s=self_table function s.initial_effect(c) local e=Effect.CreateEffect(c) e:SetType(0x10) e:SetCode(1002) "
		       "e:SetHintTiming(0xffff,0xffff) e:SetOperation(function() end) c:RegisterEffect(e) end";
	case 200:
		return "local s=self_table function s.initial_effect(c) local e=Effect.CreateEffect(c) e:SetType(0x100) e:SetCode(1002) "
		       "e:SetRange(2) e:SetHintTiming(0xffff,0xffff) e:SetOperation(function() end) c:RegisterEffect(e) end";
	case 300:
		return "local s=self_table function s.initial_effect(c) local e=Effect.CreateEffect(c) e:SetType(0x202) e:SetCode(1110) "
		       "e:SetRange(2) e:SetOperation(function() end) c:RegisterEffect(e) end";
	case 301:
		return "local s=self_table function s.initial_effect(c) local e=Effect.CreateEffect(c) e:SetType(0x82) e:SetCode(1110) "
		       "e:SetRange(2) e:SetOperation(function() end) c:RegisterEffect(e) end";
	}
	return nullptr;
}
static int read_script(void*, OCG_Duel d, const char* name) {
	unsigned code = 0;
	if(std::sscanf(name, "c%u.lua", &code) != 1)
		return 0;
	const char* text = script_text(code);
	if(!text)
		return 0;
	return OCG_LoadScript(d, text, static_cast<uint32_t>(std::strlen(text)), name) ? 1 : 0;
}
static void on_log(void*, const char* text, int type) {
	if(std::getenv("CHECK_LOG"))
		std::fprintf(stderr, "core log [%d]: %s\n", type, text);
}
static uint32_t g_extra_flags = 0; // the optional SEGOC cases add DUEL_TRIGGER_WHEN_PRIVATE_KNOWLEDGE (hand triggers are then public)
static OCG_Duel make_duel(uint32_t seed = 1) {
	OCG_DuelOptions options;
	std::memset(&options, 0, sizeof(options));
	options.seed[0] = seed;
	options.seed[1] = 2;
	options.seed[2] = 3;
	options.seed[3] = 4;
	options.flags = DUEL_MODE_MR5 | (std::getenv("CHECK_HAND_LIMIT") ? 0u : static_cast<uint32_t>(DUEL_NO_HAND_LIMIT)) | g_extra_flags;
	options.team1 = {8000, 5, 1};
	options.team2 = {8000, 5, 1};
	options.cardReader = read_card;
	options.scriptReader = read_script;
	options.logHandler = on_log;
	OCG_Duel duel = nullptr;
	if(OCG_CreateDuel(&duel, &options) != OCG_DUEL_CREATION_SUCCESS) {
		std::printf("FAIL: OCG_CreateDuel\n");
		std::exit(2);
	}
	return duel;
}
static field& F(OCG_Duel d) { return *static_cast<duel*>(d)->game_field; }
static bool run_lua(OCG_Duel d, const std::string& code) {
	return OCG_LoadScript(d, code.c_str(), static_cast<uint32_t>(code.size()), "check.lua") != 0;
}
static void add_cards(OCG_Duel d, uint8_t con, uint32_t loc, int count, uint32_t code) {
	for(int i = 0; i < count; ++i) {
		OCG_NewCardInfo info;
		std::memset(&info, 0, sizeof(info));
		info.team = con;
		info.duelist = 0;
		info.code = code;
		info.con = con;
		info.loc = loc;
		info.seq = 0;
		info.pos = POS_FACEDOWN_DEFENSE;
		OCG_DuelNewCard(d, &info);
	}
}

struct Layout {
	const char* name;
	int n;
	std::vector<int> team;
};
static const Layout FFA3{"FFA3", 3, {0, 1, 2}};
static const Layout FFA4{"FFA4", 4, {0, 1, 2, 3}};
static const Layout TAG{"Tag", 4, {0, 1, 0, 1}};
static const Layout TWO{"n=2 via SetupDuelists", 2, {0, 1}};

// What each seat holds in its hand (besides the opening draw): counts of spell, quick monster, trigger monsters.
struct Hand {
	int spell = 0, quick = 0, forced = 0, optional = 0;
};

struct Run;
using Hook = std::function<bool(Run&, uint8_t type, const uint8_t* b, uint32_t len, std::vector<uint8_t>& resp)>;
struct Run {
	OCG_Duel d = nullptr;
	std::vector<std::string> ev;
	std::vector<uint8_t> all;
	Hook hook;
	int turns = 0;
	int steps = 0;
	bool hang = false, retry = false, unknown = false, win = false;
	int unknown_type = 0;
	int retries_limit = 0;
};

static Run make_run(const Layout* layout, const std::vector<Hand>& hands, uint32_t seed, bool setup2 = false) {
	Run r;
	r.d = make_duel(seed);
	const int n = layout ? layout->n : 2;
	if(layout) {
		std::string code = "Debug.SetupDuelists(" + std::to_string(layout->n);
		for(int t : layout->team)
			code += "," + std::to_string(t);
		code += ")";
		if(!run_lua(r.d, code)) {
			std::printf("FAIL: %s\n", code.c_str());
			std::exit(2);
		}
	}
	(void)setup2;
	for(int p = 0; p < n; ++p) {
		const uint8_t con = static_cast<uint8_t>(p);
		add_cards(r.d, con, LOCATION_DECK, 40, 1);
		const Hand h = p < static_cast<int>(hands.size()) ? hands[p] : Hand{};
		add_cards(r.d, con, LOCATION_HAND, h.spell, 100);
		add_cards(r.d, con, LOCATION_HAND, h.quick, 200);
		add_cards(r.d, con, LOCATION_HAND, h.forced, 300);
		add_cards(r.d, con, LOCATION_HAND, h.optional, 301);
	}
	if(std::getenv("CHECK_HANDS")) {
		for(int p = 0; p < n; ++p) {
			std::string t;
			for(auto* c : F(r.d).player[p].list_hand)
				t += std::to_string(c->data.code) + " ";
			std::printf("  hand %d before start: %s\n", p, t.c_str());
		}
	}
	OCG_StartDuel(r.d);
	return r;
}

static std::string u(unsigned v) { return std::to_string(v); }
static uint32_t rd32(const uint8_t* p) { uint32_t v; std::memcpy(&v, p, 4); return v; }

struct Idle {
	std::vector<uint32_t> summon, act;
	bool to_bp = false, to_ep = false;
};
static Idle parse_idle(const uint8_t* b) {
	Idle r;
	size_t o = 1;
	const size_t sizes[5] = {10, 10, 7, 10, 10};
	for(int k = 0; k < 5; ++k) {
		const uint32_t count = rd32(b + o);
		o += 4;
		for(uint32_t i = 0; i < count; ++i) {
			if(k == 0)
				r.summon.push_back(rd32(b + o));
			o += sizes[k];
		}
	}
	const uint32_t count = rd32(b + o);
	o += 4;
	for(uint32_t i = 0; i < count; ++i) {
		r.act.push_back(rd32(b + o));
		o += 19;
	}
	r.to_bp = b[o] != 0;
	r.to_ep = b[o + 1] != 0;
	return r;
}
static std::vector<uint8_t> bytes32(uint32_t v) {
	std::vector<uint8_t> r(4);
	std::memcpy(r.data(), &v, 4);
	return r;
}
static int find_code(const std::vector<uint32_t>& v, uint32_t code) {
	for(size_t i = 0; i < v.size(); ++i)
		if(v[i] == code)
			return static_cast<int>(i);
	return -1;
}

// Runs until done(run) is true, the duel ends, a prompt has no answer, or max_steps passes.
static void dump_units(Run& r);
static void run_until(Run& r, const std::function<bool(Run&)>& done, int max_steps = 3000) {
	for(int i = 0; i < max_steps; ++i) {
		if(done(r) || r.win)
			return;
		++r.steps;
		if(std::getenv("CHECK_TOP") && r.steps > max_steps - 12) {
			dump_units(r);
		}
		const int status = OCG_DuelProcess(r.d);
		uint32_t length = 0;
		const auto* buffer = static_cast<const uint8_t*>(OCG_DuelGetMessage(r.d, &length));
		r.all.insert(r.all.end(), buffer, buffer + length);
		int prompt_type = -1;
		const uint8_t* prompt_body = nullptr;
		uint32_t prompt_len = 0;
		for(uint32_t offset = 0; offset + 4 <= length;) {
			const uint32_t size = rd32(buffer + offset);
			if(size > 0) {
				const uint8_t type = buffer[offset + 4];
				const uint8_t* b = buffer + offset + 5;
				switch(type) {
				case MSG_SELECT_CHAIN: r.ev.push_back("C" + u(b[0])); break;
				case MSG_SELECT_IDLECMD: r.ev.push_back("I" + u(b[0])); break;
				case MSG_SELECT_BATTLECMD: r.ev.push_back("B" + u(b[0])); break;
				case MSG_HINT:
					if(b[0] == HINT_EVENT) {
						uint64_t v;
						std::memcpy(&v, b + 2, 8);
						r.ev.push_back("H" + u(b[1]) + ":" + std::to_string(v));
					}
					break;
				case MSG_NEW_TURN: r.ev.push_back("T" + u(b[0])); ++r.turns; break;
				case MSG_NEW_PHASE: { uint16_t ph; std::memcpy(&ph, b, 2); r.ev.push_back("P" + u(ph)); break; }
				case MSG_CHAINING: r.ev.push_back("G" + u(b[14])); break;
				case MSG_CHAIN_SOLVING: r.ev.push_back("S"); break;
				case MSG_WIN: r.ev.push_back("W"); r.win = true; break;
				case MSG_RETRY: r.ev.push_back("RETRY"); r.retry = true; break;
				default: break;
				}
				switch(type) {
				case MSG_SELECT_IDLECMD: case MSG_SELECT_BATTLECMD: case MSG_SELECT_CHAIN: case MSG_SELECT_CARD:
				case MSG_SELECT_PLACE: case MSG_SELECT_POSITION: case MSG_SELECT_OPTION: case MSG_SELECT_TRIBUTE:
				case MSG_SELECT_SUM: case MSG_SELECT_UNSELECT_CARD: case MSG_SELECT_EFFECTYN: case MSG_SELECT_YESNO:
					prompt_type = type;
					prompt_body = b;
					prompt_len = size - 1;
					break;
				default: break;
				}
			}
			offset += 4 + size;
		}
		if(std::getenv("CHECK_TRACE")) {
			static size_t printed = 0;
			if(printed > r.ev.size())
				printed = 0;
			for(; printed < r.ev.size(); ++printed)
				std::fprintf(stderr, "EV %s\n", r.ev[printed].c_str());
		}
		if(r.retry) {
			return;
		}
		if(status == OCG_DUEL_STATUS_END)
			return;
		if(status != OCG_DUEL_STATUS_AWAITING)
			continue;
		if(prompt_type < 0) {
			r.unknown = true;
			return;
		}
		std::vector<uint8_t> resp;
		bool handled = r.hook && r.hook(r, static_cast<uint8_t>(prompt_type), prompt_body, prompt_len, resp);
		if(!handled) {
			switch(prompt_type) {
			case MSG_SELECT_CHAIN: resp = bytes32(static_cast<uint32_t>(-1)); break;
			case MSG_SELECT_IDLECMD: resp = bytes32(7); break;
			case MSG_SELECT_BATTLECMD: resp = bytes32(3); break;
			case MSG_SELECT_POSITION: resp = bytes32(POS_FACEUP_ATTACK); break;
			case MSG_SELECT_PLACE: {
				const uint8_t player = prompt_body[0];
				const uint32_t flag = rd32(prompt_body + 2);
				int seq = 0;
				while(seq < 7 && ((flag >> seq) & 1))
					++seq;
				if(seq < 7) {
					resp = {player, static_cast<uint8_t>(LOCATION_MZONE), static_cast<uint8_t>(seq)};
				} else {
					seq = 0;
					while(seq < 5 && ((flag >> (8 + seq)) & 1))
						++seq;
					resp = {player, static_cast<uint8_t>(LOCATION_SZONE), static_cast<uint8_t>(seq)};
				}
				break;
			}
			case MSG_SELECT_CARD: {
				const uint32_t min = rd32(prompt_body + 2);
				std::vector<uint32_t> v{0, min};
				for(uint32_t i = 0; i < min; ++i)
					v.push_back(i);
				resp.resize(v.size() * 4);
				std::memcpy(resp.data(), v.data(), resp.size());
				break;
			}
			default:
				r.unknown = true;
				r.unknown_type = prompt_type;
				return;
			}
		}
		OCG_DuelSetResponse(r.d, resp.data(), static_cast<uint32_t>(resp.size()));
	}
	r.hang = true;
}

// Tokens after the first `from` marker until the first token that starts with one of "IBTSW", keeping only kinds.
static std::string window_at(const Run& r, size_t i, const std::string& kinds) {
	const std::string from = i < r.ev.size() ? r.ev[i] : "";
	std::string out;
	for(++i; i < r.ev.size(); ++i) {
		const char c = r.ev[i][0];
		if(std::strchr("IBTSW", c) && r.ev[i] != from)
			break;
		if(kinds.find(c) != std::string::npos)
			out += (out.empty() ? "" : " ") + r.ev[i];
	}
	return out;
}
static std::string window(const Run& r, const std::string& from, const std::string& kinds, size_t nth = 0) {
	size_t i = 0, seen = 0;
	for(; i < r.ev.size(); ++i)
		if(r.ev[i] == from && seen++ == nth)
			break;
	return window_at(r, i, kinds);
}
static size_t turn_index(const Run& r, int k) {
	for(size_t i = 0, seen = 0; i < r.ev.size(); ++i)
		if(r.ev[i][0] == 'T' && seen++ == static_cast<size_t>(k))
			return i;
	return r.ev.size();
}
static std::string all_tokens(const Run& r, const char* kinds) {
	std::string out;
	for(const auto& t : r.ev)
		if(std::strchr(kinds, t[0]))
			out += (out.empty() ? "" : " ") + t;
	return out;
}
static void dump_units(Run& r) {
	static const char* names[] = {"Adjust", "Turn", "RefreshLoc", "Startup", "SelectBattleCmd", "SelectIdleCmd", "SelectEffectYesNo", "SelectYesNo", "SelectOption", "SelectCard", "SelectCardCodes", "SelectUnselectCard", "SelectChain", "SelectPlace", "SelectPosition", "SelectTributeP", "SortChain", "SelectCounter", "SelectSum", "SortCard", "SelectRelease", "SelectTribute", "QuickEffect", "IdleCommand", "PhaseEvent", "PointEvent", "BattleCommand", "DamageStep", "ForcedBattle", "AddChain", "SolveChain", "SolveContinuous", "ExecuteCost", "ExecuteOperation", "ExecuteTarget", "Destroy", "Release", "SendTo", "DestroyReplace", "ReleaseReplace", "SendToReplace", "MoveToField", "ChangePos", "OperationReplace", "ActivateEffect", "SummonRule", "SpSummonRule", "SpSummon", "FlipSummon", "MonsterSet", "SpellSet", "SpSummonStep", "SpellSetGroup", "SpSummonRuleGroup", "Draw", "Damage", "Recover", "Equip", "GetControl", "SwapControl", "ControlAdjust", "SelfDestroyUnique", "SelfDestroy", "SelfToGrave", "TrapMonsterAdjust", "PayLPCost", "RemoveCounter", "AttackDisable", "AnnounceRace", "AnnounceAttribute", "AnnounceCard", "AnnounceNumber", "TossCoin", "TossDice", "RockPaperScissors", "SelectFusion", "DiscardHand", "DiscardDeck", "SortDeck", "RemoveOverlay", "XyzOverlay", "RefreshRelay"};
	std::string t;
	int shown = 0;
	for(auto it = F(r.d).core.units.rbegin(); it != F(r.d).core.units.rend() && shown < 8; ++it, ++shown) {
		std::visit([&](auto& v) { t += std::string(names[it->index()]) + "/" + std::to_string(v.step) + " "; }, *it);
	}
	std::printf("   processors (top first): %s\n", t.c_str());
	{
		auto& f = F(r.d);
		std::printf("   hands:");
		for(uint8_t p = 0; p < f.n_duelists; ++p)
			std::printf(" %zu", f.player[p].list_hand.size());
		std::printf(" tp %d phase %d hand_adjusted %d select_chains %zu\n", f.infos.turn_player, f.infos.phase, (int)f.core.hand_adjusted, f.core.select_chains.size());
	}
}
static void finish(Run& r) {
	OCG_DestroyDuel(r.d);
	r.d = nullptr;
}
static void expect_clean(const Run& r, const std::string& name) {
	if(r.hang && r.d)
		dump_units(const_cast<Run&>(r));
	if(r.hang || r.retry || r.unknown || std::getenv("CHECK_EV")) {
		std::string t;
		for(size_t i = r.ev.size() > 60 ? r.ev.size() - 60 : 0; i < r.ev.size(); ++i)
			t += r.ev[i] + " ";
		std::printf("   events (last 60): %s\n", t.c_str());
	}
	EXPECT(!r.hang && !r.retry && !r.unknown, "%s: hang %d retry %d unknown %d (prompt type %d) after %d steps", name.c_str(),
	       r.hang, r.retry, r.unknown, r.unknown_type, r.steps);
}

// tp answers its first idle prompt with the summon or the spell, marks the window, then ends turns.
static Hook activate_hook(uint32_t code, bool spell, std::function<bool(Run&, uint8_t player, uint8_t spe)> chain_yes, int* marked) {
	return [=](Run& r, uint8_t type, const uint8_t* b, uint32_t, std::vector<uint8_t>& resp) {
		if(type == MSG_SELECT_IDLECMD && *marked == 0) {
			const Idle idle = parse_idle(b);
			int idx = spell ? find_code(idle.act, code) : find_code(idle.summon, code);
			if(idx < 0)
				return false;
			*marked = 1;
			r.ev.push_back(spell ? "@ACT" : "@SUM");
			resp = bytes32((static_cast<uint32_t>(idx) << 16) | (spell ? 5u : 0u));
			return true;
		}
		if(type == MSG_SELECT_CHAIN) {
			const bool yes = *marked != 0 && chain_yes && chain_yes(r, b[0], b[1]);
			resp = bytes32(yes ? 0u : static_cast<uint32_t>(-1));
			return true;
		}
		return false;
	};
}

static void check_link_window(const Layout& l, const std::string& name, const std::string& want, std::function<bool(Run&, uint8_t, uint8_t)> yes,
                              const std::vector<int>& eliminated = {}) {
	std::vector<Hand> hands(static_cast<size_t>(l.n));
	for(auto& h : hands)
		h.quick = 2;
	hands[0].spell = 1;
	Run r = make_run(&l, hands, 1);
	for(int p : eliminated)
		F(r.d).player[p].eliminated = true;
	int marked = 0;
	r.hook = activate_hook(100, true, yes, &marked);
	run_until(r, [&](Run& x) { return marked && window(x, "@ACT", "S").size() == 0 && std::count(x.ev.begin(), x.ev.end(), std::string("S")) > 0; });
	const std::string got = window(r, "@ACT", "C");
	std::printf("%s %s: MSG_SELECT_CHAIN recipients [%s] (want [%s])\n", l.name, name.c_str(), got.c_str(), want.c_str());
	EXPECT(marked == 1, "%s %s: the spell was never activated", l.name, name.c_str());
	EXPECT(got == want, "%s %s: got [%s] want [%s]", l.name, name.c_str(), got.c_str(), want.c_str());
	expect_clean(r, name);
	finish(r);
}

static void check_windows() {
	auto none = [](Run&, uint8_t, uint8_t) { return false; };
	check_link_window(FFA4, "tp 0 adds a link, all pass", "C1 C2 C3 C0", none);
	// R-FFA-CHAIN: each new link restarts clockwise after its activator, with that seat last.
	check_link_window(FFA4, "tp 0 adds a link, 3 chains", "C1 C2 C3 C0 C1 C2 C3", [](Run& r, uint8_t p, uint8_t) {
		return p == 3 && std::count(r.ev.begin(), r.ev.end(), std::string("G3")) == 0;
	});
	check_link_window(FFA4, "tp 0 adds a link, 1 chains (then 2 first)", "C1 C2 C3 C0 C1", [](Run& r, uint8_t p, uint8_t) {
		return p == 1 && std::count(r.ev.begin(), r.ev.end(), std::string("G1")) == 0;
	});
	check_link_window(TAG, "L=0 adds a link, all pass", "C1 C3 C2 C0", none);
	check_link_window(TAG, "L=0 adds, L=1 chains", "C1 C2 C0 C3 C1", [](Run& r, uint8_t p, uint8_t) {
		return p == 1 && std::count(r.ev.begin(), r.ev.end(), std::string("G1")) == 0;
	});
	check_link_window(FFA3, "tp 0 adds a link, all pass", "C1 C2 C0", none);
}

static void check_eliminated() {
	auto none = [](Run&, uint8_t, uint8_t) { return false; };
	check_link_window(FFA4, "seat 2 eliminated", "C1 C3 C0", none, {2});
	// Through a few turns: no prompt of any kind to the eliminated seat.
	std::vector<Hand> hands(4);
	for(auto& h : hands)
		h.quick = 2;
	Run r = make_run(&FFA4, hands, 1);
	F(r.d).player[2].eliminated = true;
	run_until(r, [](Run& x) { return x.turns >= 5; });
	const std::string prompts = all_tokens(r, "CIB");
	EXPECT(prompts.find("C2") == std::string::npos && prompts.find("I2") == std::string::npos && prompts.find("B2") == std::string::npos,
	       "seat 2 eliminated was prompted: %s", prompts.c_str());
	std::printf("FFA4 seat 2 eliminated, %d turns: turn order [%s], prompts to seat 2: %s\n", r.turns, all_tokens(r, "T").c_str(),
	            (prompts.find("2") == std::string::npos) ? "none" : "SOME");
	expect_clean(r, "eliminated turns");
	finish(r);
}

static void check_phase_window() {
	std::vector<Hand> hands(3);
	for(auto& h : hands)
		h.quick = 2;
	Run r = make_run(&FFA3, hands, 1);
	r.hook = [](Run& x, uint8_t type, const uint8_t* b, uint32_t, std::vector<uint8_t>& resp) {
		if(type == MSG_SELECT_IDLECMD) {
			const Idle idle = parse_idle(b);
			if(b[0] == 0 && x.turns == 4 && idle.to_bp && std::count(x.ev.begin(), x.ev.end(), std::string("@BP")) == 0) {
				x.ev.push_back("@BP");
				resp = bytes32(6);
				return true;
			}
			if(x.turns == 1 && std::count(x.ev.begin(), x.ev.end(), std::string("@EP")) == 0)
				x.ev.push_back("@EP");
		}
		return false;
	};
	run_until(r, [](Run& x) { return x.turns >= 5; });
	// Only the window right after the marker: it ends at the first token of seat 0 (the next phase starts with seat 0).
	auto cut = [](const std::string& w) { const size_t k = w.find(" H0"); return k == std::string::npos ? w : w.substr(0, k); };
	const std::string ep = cut(window(r, "@EP", "CH")), bp = cut(window(r, "@BP", "CH"));
	std::printf("FFA3 turn 1 M1 -> EP: [%s]\nFFA3 turn 4 M1 -> BP: [%s]\n", ep.c_str(), bp.c_str());
	EXPECT(ep == "H1:23 H2:23 C1 C2", "M1 -> EP window: [%s]", ep.c_str());
	EXPECT(bp == "H1:23 H2:23 C1 C2", "M1 -> BP window: [%s]", bp.c_str());
	expect_clean(r, "phase window");
	finish(r);
}

static void check_segoc() {
	struct Case { const Layout* l; bool optional; };
	const Case cases[] = {{&FFA3, false}, {&FFA3, true}, {&FFA4, false}, {&TAG, false}, {&TAG, true}};
	for(const auto& c : cases) {
		const int n = c.l->n;
		const bool tag = c.l == &TAG;
		std::vector<Hand> hands(static_cast<size_t>(n));
		for(auto& h : hands)
			(c.optional ? h.optional : h.forced) = 1;
		g_extra_flags = c.optional ? DUEL_TRIGGER_WHEN_PRIVATE_KNOWLEDGE : 0;
		Run r = make_run(c.l, hands, 1);
		g_extra_flags = 0;
		// Optional triggers are asked through MSG_SELECT_CHAIN with spe_count 0x7f: accept there, pass in quick windows.
		r.hook = [](Run&, uint8_t type, const uint8_t* b, uint32_t, std::vector<uint8_t>& resp) {
			if(type == MSG_SELECT_EFFECTYN) {
				resp = bytes32(1);
				return true;
			}
			if(type == MSG_SELECT_CHAIN) {
				resp = bytes32(b[1] == 0x7f ? 0u : static_cast<uint32_t>(-1)); // only the SEGOC prompt (spe 0x7f) accepts
				return true;
			}
			return false;
		};
		run_until(r, [&](Run& x) { return x.turns >= n + 2; });
		for(int k = 1; k < n + 1; ++k) {
			const size_t at = turn_index(r, k);
			if(at >= r.ev.size())
				continue;
			const int tp = r.ev[at][1] - '0';
			std::string want;
			for(int i = 0; i < n; ++i) {
				const int off = tag ? (i == 0 ? 0 : i == 1 ? 2 : i == 2 ? 1 : 3) : i;
				const unsigned who = static_cast<unsigned>((tp + off) % n);
				want += (want.empty() ? "G" : " G") + u(who);
			}
			const std::string got = window_at(r, at, "G"), prompts = window_at(r, at, "C");
			std::printf("%s SEGOC %s turn %d (tp %d): MSG_CHAINING controllers [%s] (want [%s]), prompts [%s]\n", c.l->name,
			            c.optional ? "optional" : "forced", k + 1, tp, got.c_str(), want.c_str(), prompts.c_str());
			EXPECT(got == want, "%s SEGOC %s turn %d: got [%s] want [%s]", c.l->name, c.optional ? "optional" : "forced", k + 1, got.c_str(), want.c_str());
		}
		expect_clean(r, "segoc");
		finish(r);
	}
}

static void check_rounds() {
	for(const Layout* l : {&FFA3, &FFA4, &TAG}) {
		std::vector<Hand> hands(static_cast<size_t>(l->n));
		for(auto& h : hands)
			h.quick = 1;
		for(int variant = 0; variant < 2; ++variant) {
			Run r = make_run(l, hands, 7);
			if(variant == 1) {
				// Also walk through the Battle Phase when the core allows it.
				r.hook = [](Run&, uint8_t type, const uint8_t* b, uint32_t, std::vector<uint8_t>& resp) {
					if(type == MSG_SELECT_IDLECMD && parse_idle(b).to_bp) {
						resp = bytes32(6);
						return true;
					}
					return false;
				};
			}
			const int target = 2 * l->n + 1;
			run_until(r, [&](Run& x) { return x.turns >= target; }, 6000);
			std::map<int, int> started;
			for(const auto& t : r.ev)
				if(t[0] == 'T')
					++started[t[1] - '0'];
			bool all = true;
			for(int p = 0; p < l->n; ++p)
				all = all && started[p] >= 2;
			std::printf("%s round%s: turn order [%s], %d steps\n", l->name, variant ? " with BP" : "", all_tokens(r, "T").c_str(), r.steps);
			EXPECT(all, "%s: not every seat played two turns (%d turns)", l->name, r.turns);
			EXPECT(r.turns >= target, "%s: only %d turns", l->name, r.turns);
			expect_clean(r, std::string(l->name) + " round");
			finish(r);
		}
	}
}

// n=2: the same policy, with and without SetupDuelists(2,0,1): identical bytes.
static std::vector<uint8_t> run_two(bool setup, uint32_t seed, int& chain_prompts) {
	std::vector<Hand> hands(2);
	for(auto& h : hands) {
		h.quick = 2;
		h.forced = 1;
	}
	hands[0].spell = 1;
	hands[1].spell = 1;
	Run r = make_run(setup ? &TWO : nullptr, hands, seed);
	int counter = 0;
	r.hook = [&](Run& x, uint8_t type, const uint8_t* b, uint32_t, std::vector<uint8_t>& resp) {
		if(type == MSG_SELECT_CHAIN) {
			resp = bytes32((counter++ % 3 == 1) ? 0u : static_cast<uint32_t>(-1));
			return true;
		}
		if(type == MSG_SELECT_IDLECMD && x.turns <= 6) {
			const Idle idle = parse_idle(b);
			int idx = find_code(idle.act, 100);
			if(idx >= 0 && (x.turns % 2 == 1)) {
				resp = bytes32((static_cast<uint32_t>(idx) << 16) | 5u);
				return true;
			}
			idx = find_code(idle.summon, 300);
			if(idx >= 0) {
				resp = bytes32(static_cast<uint32_t>(idx) << 16);
				return true;
			}
		}
		return false;
	};
	run_until(r, [](Run& x) { return x.turns >= 8; }, 4000);
	chain_prompts = static_cast<int>(std::count_if(r.ev.begin(), r.ev.end(), [](const std::string& t) { return t[0] == 'C'; }));
	EXPECT(!r.retry && !r.unknown, "n=2 run: retry %d unknown %d", r.retry, r.unknown);
	std::vector<uint8_t> out = r.all;
	finish(r);
	return out;
}
static void check_identity() {
	for(uint32_t seed : {1u, 77u, 4242u}) {
		int ca = 0, cb = 0;
		const auto a = run_two(false, seed, ca);
		const auto b = run_two(true, seed, cb);
		EXPECT(a == b, "n=2 seed %u: bytes differ", seed);
		EXPECT(ca > 0, "n=2 seed %u: no chain prompt happened", seed);
		std::printf("n=2 seed %u: %zu bytes, %d chain prompts, identical with and without SetupDuelists(2,0,1): %s\n", seed, a.size(), ca,
		            a == b ? "yes" : "NO");
	}
}

int main(int argc, char** argv) {
	const std::string mode = argc > 1 ? argv[1] : "check";
	if(mode == "dbg") {
		std::vector<Hand> hands(3);
		for(auto& h : hands)
			h.quick = 2;
		Run r = make_run(&FFA3, hands, 1);
		run_until(r, [](Run& x) { return x.turns >= 2; });
		return 0;
	}
	check_windows();
	check_phase_window();
	check_segoc();
	check_eliminated();
	check_rounds();
	check_identity();
	std::printf("%s: %d failure(s)\n", failures ? "FAIL" : "PASS", failures);
	return failures ? 1 : 0;
}
