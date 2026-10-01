// F6 native check: Tag partner negation (P4). Model: setup-duelists.cpp.
// Links the gate's libocgcore-multi.a (NON-trap, ASan + UBSan). Real card scripts: Solemn Judgment (41420027),
// Ash Blossom (14558127), Reinforcement of the Army (32807846), Jinzo (77585513).
//
// "Offered" means: effect::is_activateable(seat, event) is true for the effect. That is the function that
// builds every chain prompt (check_chain) and every summon window. Its partner check does not depend on the
// priority order, so the check calls it directly (the priority order for n > 2 is task T3).
// Where a real prompt is cheap, the check also uses it: the chain prompt to seat 1 with Ash Blossom, and
// the real Normal Summon window.
//
// Usage: check <cards.tsv> <card-scripts dir> [setup|solemn|ash|jinzo|backstop|n2]   (default: all)
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <functional>
#include <sstream>
#include <string>
#include <unordered_map>
#include <vector>
#include "ocgapi.h"
#include "ocgapi_constants.h"
#include "duel.h"
#include "field.h"
#include "card.h"
#include "effect.h"
#include "common.h"

namespace fs = std::filesystem;

static int passes = 0;
#undef EXPECT
#define EXPECT(cond, ...) do { if(!(cond)) { ++failures; std::printf("FAIL %s:%d: ", __FILE__, __LINE__); std::printf(__VA_ARGS__); std::printf("\n"); } else ++passes; } while(0)

static constexpr uint32_t FILLER = 99000001; // vanilla Warrior, level 4
static constexpr uint32_t CODE_SOLEMN = 41420027, CODE_ASH = 14558127, CODE_REINF = 32807846, CODE_JINZO = 77585513;

// ---- card data and scripts --------------------------------------------------------------------------------
static std::unordered_map<uint32_t, OCG_CardData> g_cards;
static std::unordered_map<std::string, std::string> g_scripts;
static std::string g_log;

static void load_cards(const std::string& path) {
	std::ifstream in(path);
	if(!in) { std::fprintf(stderr, "cannot read %s\n", path.c_str()); std::exit(2); }
	std::string line;
	while(std::getline(in, line)) {
		std::istringstream ss(line);
		OCG_CardData d;
		std::memset(&d, 0, sizeof(d));
		unsigned long long race = 0;
		long long atk = 0, def = 0;
		uint32_t code = 0, alias = 0, type = 0, level = 0, attr = 0, ls = 0, rs = 0, lm = 0;
		ss >> code >> alias >> type >> level >> attr >> race >> atk >> def >> ls >> rs >> lm;
		d.code = code; d.alias = alias; d.type = type; d.level = level; d.attribute = attr; d.race = race;
		d.attack = static_cast<int32_t>(atk); d.defense = static_cast<int32_t>(def);
		d.lscale = ls; d.rscale = rs; d.link_marker = lm;
		static uint16_t no_sets[1] = {0};
		d.setcodes = no_sets;
		g_cards.emplace(code, d);
	}
}
static void index_scripts(const std::string& dir) {
	for(const auto& e : fs::recursive_directory_iterator(dir)) {
		if(!e.is_regular_file() || e.path().extension() != ".lua") continue;
		g_scripts[e.path().filename().string()] = e.path().string();
	}
}
static void read_card(void*, uint32_t code, OCG_CardData* data) {
	auto it = g_cards.find(code);
	if(it != g_cards.end()) { *data = it->second; return; }
	std::memset(data, 0, sizeof(*data));
	data->code = code;
	data->type = TYPE_MONSTER | TYPE_NORMAL;
	data->level = 4;
	data->attribute = 1;
	data->race = RACE_WARRIOR;
	data->attack = 1000;
	data->defense = 1000;
	static uint16_t no_sets[1] = {0};
	data->setcodes = no_sets;
}
static int read_script(void*, OCG_Duel duel, const char* name) {
	std::string n(name);
	auto slash = n.find_last_of("/\\");
	if(slash != std::string::npos) n = n.substr(slash + 1);
	auto it = g_scripts.find(n);
	if(it == g_scripts.end()) return 0;
	std::ifstream in(it->second, std::ios::binary);
	std::stringstream buf;
	buf << in.rdbuf();
	const std::string text = buf.str();
	return OCG_LoadScript(duel, text.data(), static_cast<uint32_t>(text.size()), name);
}
static void on_log(void*, const char* text, int type) {
	g_log += text ? text : "";
	g_log += "\n";
	if(std::getenv("CHECK_LOG") || type == OCG_LOG_TYPE_ERROR)
		std::fprintf(stderr, "core log [%d]: %s\n", type, text);
}

// ---- board ------------------------------------------------------------------------------------------------
struct Put { uint32_t code; uint8_t con; uint32_t loc; uint32_t seq; uint32_t pos; };

static field& F(OCG_Duel d) { return *static_cast<duel*>(d)->game_field; }
static bool run_lua(OCG_Duel d, const std::string& code) {
	return OCG_LoadScript(d, code.c_str(), static_cast<uint32_t>(code.size()), "check.lua") != 0;
}

// setup: n == 0 means "no SetupDuelists call, 2 duelists". teams has n entries.
static OCG_Duel make_board(int n, const std::vector<int>& teams, const std::vector<Put>& puts, bool use_setup_for_two = false) {
	OCG_DuelOptions options;
	std::memset(&options, 0, sizeof(options));
	options.seed[0] = 11; options.seed[1] = 22; options.seed[2] = 33; options.seed[3] = 44;
	options.flags = DUEL_MODE_MR5;
	const uint32_t lp = teams.size() == 4 && teams[0] == teams[2] ? 16000 : 8000;
	options.team1 = {lp, 5, 1};
	options.team2 = {lp, 5, 1};
	options.cardReader = read_card;
	options.scriptReader = read_script;
	options.logHandler = on_log;
	OCG_Duel d = nullptr;
	if(OCG_CreateDuel(&d, &options) != OCG_DUEL_CREATION_SUCCESS) { std::printf("FAIL: OCG_CreateDuel\n"); std::exit(2); }
	read_script(nullptr, d, "constant.lua");
	read_script(nullptr, d, "utility.lua");
	if(n > 2 || use_setup_for_two) {
		std::string code = "Debug.SetupDuelists(" + std::to_string(n);
		for(int t : teams) code += "," + std::to_string(t);
		code += ")";
		if(!run_lua(d, code)) { std::printf("FAIL: %s\n", code.c_str()); std::exit(2); }
	}
	const int seats = n;
	for(int s = 0; s < seats; ++s) {
		for(int i = 0; i < 40; ++i) {
			OCG_NewCardInfo info;
			std::memset(&info, 0, sizeof(info));
			info.team = static_cast<uint8_t>(s); info.duelist = 0; info.code = FILLER; info.con = static_cast<uint8_t>(s);
			info.loc = LOCATION_DECK; info.seq = 0; info.pos = POS_FACEDOWN_DEFENSE;
			OCG_DuelNewCard(d, &info);
		}
	}
	for(const auto& p : puts) {
		OCG_NewCardInfo info;
		std::memset(&info, 0, sizeof(info));
		info.team = p.con; info.duelist = 0; info.code = p.code; info.con = p.con;
		info.loc = p.loc; info.seq = p.seq; info.pos = p.pos;
		OCG_DuelNewCard(d, &info);
	}
	return d;
}

struct Prompt { int status; int id; int seat; std::vector<uint8_t> bytes; bool retry; uint32_t place_flag = 0; };

// Runs OCG_DuelProcess until the core waits for an answer (or ends). Reports the last select message.
static Prompt run_to_prompt(OCG_Duel d, int max_steps = 400) {
	Prompt p{OCG_DUEL_STATUS_CONTINUE, 0, -1, {}, false};
	for(int i = 0; i < max_steps; ++i) {
		p.status = OCG_DuelProcess(d);
		uint32_t length = 0;
		const auto* buffer = static_cast<const uint8_t*>(OCG_DuelGetMessage(d, &length));
		p.bytes.assign(buffer, buffer + length);
		for(uint32_t off = 0; off + 4 <= length;) {
			uint32_t size = 0;
			std::memcpy(&size, buffer + off, 4);
			if(size > 0) {
				const int id = buffer[off + 4];
				if(std::getenv("CHECK_TRACE")) std::fprintf(stderr, "msg %d size %u seat %d\n", id, size, size > 1 ? buffer[off + 5] : -1);
				if(std::getenv("CHECK_HEX") && (id == MSG_SELECT_IDLECMD || id == MSG_SELECT_CHAIN)) { for(uint32_t k = 0; k < size; ++k) std::fprintf(stderr, "%02x ", buffer[off + 4 + k]); std::fprintf(stderr, "\n"); }
				if(id == MSG_RETRY) p.retry = true;
				if(id == MSG_SELECT_IDLECMD || id == MSG_SELECT_CHAIN || id == MSG_SELECT_BATTLECMD || id == MSG_SELECT_CARD
				   || id == MSG_SELECT_EFFECTYN || id == MSG_SELECT_YESNO || id == MSG_SELECT_OPTION || id == MSG_SELECT_PLACE
				   || id == MSG_SELECT_POSITION || id == MSG_SELECT_TRIBUTE || id == MSG_SELECT_UNSELECT_CARD) {
					p.id = id;
					p.seat = size > 1 ? buffer[off + 5] : -1;
					if(id == MSG_SELECT_PLACE && size >= 7) std::memcpy(&p.place_flag, buffer + off + 7, 4);
				}
			}
			off += 4 + size;
		}
		if(p.status != OCG_DUEL_STATUS_CONTINUE) break;
	}
	return p;
}
static void answer(OCG_Duel d, uint32_t value) { OCG_DuelSetResponse(d, &value, sizeof(value)); }
// Answers a placement prompt with the first free zone.
static Prompt settle(OCG_Duel d, Prompt p) {
	for(int i = 0; i < 4 && (p.id == MSG_SELECT_PLACE || p.id == MSG_SELECT_POSITION); ++i) {
		if(p.id == MSG_SELECT_POSITION) {
			answer(d, POS_FACEUP_ATTACK);
			p = run_to_prompt(d);
			continue;
		}
		uint32_t bit = 0;
		while(bit < 32 && (p.place_flag & (1u << bit))) ++bit;
		const uint8_t resp[3] = {static_cast<uint8_t>(p.seat), static_cast<uint8_t>(bit < 8 ? LOCATION_MZONE : LOCATION_SZONE),
		                         static_cast<uint8_t>(bit < 8 ? bit : bit - 8)};
		OCG_DuelSetResponse(d, resp, sizeof(resp));
		p = run_to_prompt(d);
	}
	return p;
}
static bool contains_code(const std::vector<uint8_t>& b, uint32_t code) {
	for(size_t i = 0; i + 4 <= b.size(); ++i)
		if(std::memcmp(&b[i], &code, 4) == 0) return true;
	return false;
}
// Start the duel and stop at the first prompt of seat 0 (idle command).
static Prompt start_to_idle(OCG_Duel d) {
	OCG_StartDuel(d);
	Prompt p = run_to_prompt(d);
	if(std::getenv("CHECK_HEX")) for(card* c : static_cast<duel*>(d)->cards) if(c->current.controler == 0 && c->current.location == LOCATION_HAND) std::fprintf(stderr, "hand card code %u type %x level %u\n", c->data.code, c->data.type, c->data.level);
	if(std::getenv("CHECK_HEX")) std::fprintf(stderr, "hand0=%u deck0=%u\n", OCG_DuelQueryCount(d, 0, LOCATION_HAND), OCG_DuelQueryCount(d, 0, LOCATION_DECK));
	return p;
}

// ---- helpers on the core ----------------------------------------------------------------------------------
static card* find_card(OCG_Duel d, uint32_t code, int con, uint32_t loc) {
	card* best = nullptr;
	for(card* c : static_cast<duel*>(d)->cards)
		if(c->data.code == code && c->current.controler == con && (c->current.location & loc))
			if(!best || c->current.sequence < best->current.sequence) best = c;
	return best;
}
static effect* find_effect(card* c, uint32_t ecode) {
	if(!c) return nullptr;
	for(auto& kv : c->field_effect)
		if(kv.second->code == ecode && (kv.second->type & EFFECT_TYPE_ACTIVATE || kv.second->type & EFFECT_TYPE_QUICK_O))
			return kv.second;
	return nullptr;
}
// The activation check of the core for one effect, one seat, one event.
static bool offered(OCG_Duel d, effect* e, int seat, int event_player, uint32_t ev_value = 0, effect* re = nullptr) {
	tevent te{};
	te.event_player = static_cast<uint8_t>(event_player);
	te.reason_player = static_cast<uint8_t>(event_player);
	te.event_value = ev_value;
	te.reason_effect = re;
	te.event_code = e->code;
	return e->is_activateable(static_cast<uint8_t>(seat), te, 0, 0, 0, 0, 0) != 0;
}

static const uint32_t POS_SET = POS_FACEDOWN;

// ---- scenarios --------------------------------------------------------------------------------------------
// Solemn Judgment (summon effects e1..e3) at the idle prompt of seat 0.
static void solemn_matrix(const char* label, int n, const std::vector<int>& teams, bool tag) {
	std::vector<Put> puts;
	for(int s = 1; s < n; ++s)
		puts.push_back({CODE_SOLEMN, static_cast<uint8_t>(s), LOCATION_SZONE, 0, POS_FACEDOWN});
	OCG_Duel d = make_board(n, teams, puts);
	Prompt p = start_to_idle(d);
	EXPECT(p.id == MSG_SELECT_IDLECMD && p.seat == 0, "%s: first prompt id %d seat %d", label, p.id, p.seat);
	int checked = 0;
	for(int owner = 1; owner < n; ++owner) {
		card* c = find_card(d, CODE_SOLEMN, owner, LOCATION_SZONE);
		EXPECT(c != nullptr, "%s: Solemn of seat %d missing", label, owner);
		if(!c) continue;
		for(uint32_t ecode : {EVENT_SUMMON, EVENT_FLIP_SUMMON, EVENT_SPSUMMON}) {
			effect* e = find_effect(c, ecode);
			EXPECT(e != nullptr, "%s: Solemn seat %d has no effect code %u", label, owner, ecode);
			if(!e) continue;
			for(int ep = 0; ep < n; ++ep) {
				if(ep == owner) continue;
				const bool partner = tag && (teams[ep] == teams[owner]);
				const bool got = offered(d, e, owner, ep);
				EXPECT(got == !partner, "%s: Solemn seat %d vs event code %u by seat %d: offered=%d want %d", label, owner, ecode, ep, got, !partner);
				++checked;
			}
		}
	}
	std::printf("ok   %s: Solemn Judgment summon effects, %d (seat, event) cases\n", label, checked);
	OCG_DestroyDuel(d);
}

// Real Normal Summon window: seat 0 summons, the core asks seat 1 (opponent) about Solemn. Seat 2's Solemn is
// offered by the same function but the stock prompt order does not reach it (task T3), so it is checked directly above.
static void real_summon_prompt() {
	std::vector<Put> puts = {
		{CODE_SOLEMN, 1, LOCATION_SZONE, 0, POS_FACEDOWN},
		{CODE_SOLEMN, 2, LOCATION_SZONE, 0, POS_FACEDOWN},
		{CODE_SOLEMN, 3, LOCATION_SZONE, 0, POS_FACEDOWN},
	};
	OCG_Duel d = make_board(4, {0, 1, 0, 1}, puts);
	Prompt p = start_to_idle(d);
	EXPECT(p.id == MSG_SELECT_IDLECMD && p.seat == 0, "real summon: first prompt id %d seat %d", p.id, p.seat);
	answer(d, 0); // Normal Summon, index 0
	p = settle(d, run_to_prompt(d));
	for(int i = 0; i < 3 && p.id == MSG_SELECT_CHAIN && p.seat == 0; ++i) { answer(d, 0xFFFFFFFFu); p = settle(d, run_to_prompt(d)); }
	EXPECT(p.id == MSG_SELECT_CHAIN && p.seat == 1 && contains_code(p.bytes, CODE_SOLEMN),
	       "real summon: prompt id %d seat %d (want chain prompt of seat 1 with Solemn)", p.id, p.seat);
	std::printf("ok   Tag 0,1,0,1: a real Normal Summon of seat 0 gives seat 1 the Solemn Judgment prompt (prompt id %d seat %d)\n", p.id, p.seat);
	// Seat 2's and seat 3's Solemn at this same window, event player = the summoner.
	card* c2 = find_card(d, CODE_SOLEMN, 2, LOCATION_SZONE);
	card* c3 = find_card(d, CODE_SOLEMN, 3, LOCATION_SZONE);
	effect* e2 = find_effect(c2, EVENT_SUMMON);
	effect* e3 = find_effect(c3, EVENT_SUMMON);
	EXPECT(e2 && e3, "real summon: effects missing");
	if(e2 && e3) {
		const bool o2 = offered(d, e2, 2, 0), o3 = offered(d, e3, 3, 0);
		EXPECT(!o2, "real summon window: Solemn of partner seat 2 offered against seat 0");
		EXPECT(o3, "real summon window: Solemn of opponent seat 3 not offered against seat 0");
		std::printf("ok   same window: seat 2 (partner of the summoner) offered=%d, seat 3 (opponent) offered=%d\n", o2, o3);
	}
	OCG_DestroyDuel(d);
}

struct AshBoard { OCG_Duel d; Prompt p; };
// Seat 0 activates Reinforcement of the Army (a search). Seat 1 holds Ash Blossom: the real chain prompt of seat 1.
static AshBoard ash_board(int n, const std::vector<int>& teams, std::vector<Put> extra = {}) {
	std::vector<Put> puts = {{CODE_REINF, 0, LOCATION_HAND, 0, POS_FACEDOWN}};
	for(int s = 1; s < n; ++s) puts.push_back({CODE_ASH, static_cast<uint8_t>(s), LOCATION_HAND, 0, POS_FACEDOWN});
	for(auto& x : extra) puts.push_back(x);
	AshBoard b{make_board(n, teams, puts), {}};
	Prompt p = start_to_idle(b.d);
	EXPECT(p.id == MSG_SELECT_IDLECMD && p.seat == 0, "ash board n=%d: first prompt id %d seat %d", n, p.id, p.seat);
	bool activated = false;
	for(uint32_t idx = 0; idx < 8 && !activated; ++idx) {
		answer(b.d, (idx << 16) | 5);
		p = settle(b.d, run_to_prompt(b.d));
		if(!p.retry) activated = true;
		else p = run_to_prompt(b.d);
	}
	b.p = p;
	EXPECT(activated, "ash board n=%d: could not activate Reinforcement of the Army", n);
	return b;
}
static void ash_matrix(const char* label, int n, const std::vector<int>& teams, bool tag) {
	std::vector<Put> extra = {{CODE_SOLEMN, 2, LOCATION_SZONE, 0, POS_FACEDOWN}};
	if(n < 3) extra.clear();
	AshBoard b = ash_board(n, teams, extra);
	OCG_Duel d = b.d;
	EXPECT(b.p.id == MSG_SELECT_CHAIN && b.p.seat == 1 && contains_code(b.p.bytes, CODE_ASH),
	       "%s: chain prompt id %d seat %d (want seat 1 with Ash Blossom)", label, b.p.id, b.p.seat);
	std::printf("ok   %s: real chain prompt after a search by seat 0: id %d to seat %d, Ash Blossom in the list: %d\n",
	            label, b.p.id, b.p.seat, contains_code(b.p.bytes, CODE_ASH));
	field& f = F(d);
	EXPECT(f.core.current_chain.size() == 1, "%s: chain size %zu", label, f.core.current_chain.size());
	if(f.core.current_chain.size() != 1) { OCG_DestroyDuel(d); return; }
	effect* link = f.core.current_chain[0].triggering_effect;
	int checked = 0;
	for(int owner = 1; owner < n; ++owner) {
		card* c = find_card(d, CODE_ASH, owner, LOCATION_HAND);
		effect* e = find_effect(c, EVENT_CHAINING);
		EXPECT(e != nullptr, "%s: Ash of seat %d has no effect", label, owner);
		if(!e) continue;
		for(int ep = 0; ep < n; ++ep) {
			if(ep == owner) continue;
			const bool partner = tag && (teams[ep] == teams[owner]);
			const bool got = offered(d, e, owner, ep, 1, link);
			EXPECT(got == !partner, "%s: Ash seat %d vs a chain link of seat %d: offered=%d want %d", label, owner, ep, got, !partner);
			++checked;
		}
	}
	// Solemn Judgment, chain effect (category NEGATE), seat 2.
	if(n >= 3) {
		card* c = find_card(d, CODE_SOLEMN, 2, LOCATION_SZONE);
		effect* e = find_effect(c, EVENT_CHAINING);
		EXPECT(e != nullptr, "%s: Solemn chain effect missing", label);
		if(e) {
			for(int ep = 0; ep < n; ++ep) {
				if(ep == 2) continue;
				const bool partner = tag && (teams[ep] == teams[2]);
				const bool got = offered(d, e, 2, ep, 1, link);
				EXPECT(got == !partner, "%s: Solemn (chain) seat 2 vs a chain link of seat %d: offered=%d want %d", label, ep, got, !partner);
				++checked;
			}
		}
	}
	std::printf("ok   %s: Ash Blossom and Solemn Judgment chain effects, %d (seat, event) cases\n", label, checked);
	OCG_DestroyDuel(d);
}

// Jinzo (continuous) of seat 0 still stops the Traps of seat 2 (the partner) and seat 3.
static void jinzo_check() {
	for(int with_jinzo = 0; with_jinzo < 2; ++with_jinzo) {
		std::vector<Put> puts = {
			{CODE_SOLEMN, 2, LOCATION_SZONE, 0, POS_FACEDOWN},
			{CODE_SOLEMN, 3, LOCATION_SZONE, 0, POS_FACEDOWN},
		};
		if(with_jinzo)
			puts.push_back({CODE_JINZO, 0, LOCATION_MZONE, 0, POS_FACEUP_ATTACK});
		OCG_Duel d = make_board(4, {0, 1, 0, 1}, puts);
		Prompt p = start_to_idle(d);
		EXPECT(p.id == MSG_SELECT_IDLECMD && p.seat == 0, "jinzo: first prompt id %d seat %d", p.id, p.seat);
		// Event players that are opponents of the trap owner, so the partner rule is not involved.
		const bool a = offered(d, find_effect(find_card(d, CODE_SOLEMN, 2, LOCATION_SZONE), EVENT_SUMMON), 2, 1);
		const bool b = offered(d, find_effect(find_card(d, CODE_SOLEMN, 3, LOCATION_SZONE), EVENT_SUMMON), 3, 0);
		if(with_jinzo) {
			EXPECT(find_card(d, CODE_JINZO, 0, LOCATION_MZONE) != nullptr, "jinzo: not on the field");
			EXPECT(!a && !b, "jinzo: Solemn of seat 2 offered=%d, of seat 3 offered=%d (want both 0: continuous effects hit everyone)", a, b);
			std::printf("ok   Tag: with Jinzo of seat 0 on the field, Solemn of seat 2 (partner) offered=%d and of seat 3 offered=%d\n", a, b);
		} else {
			EXPECT(a && b, "jinzo baseline: Solemn of seat 2 offered=%d, of seat 3 offered=%d (want both 1)", a, b);
			std::printf("ok   Tag: without Jinzo the same two Solemn effects are offered (%d, %d)\n", a, b);
		}
		OCG_DestroyDuel(d);
	}
}

// Backstop: NegateActivation, NegateEffect, NegateSummon with a reason effect of the partner.
static void backstop_check() {
	AshBoard b = ash_board(4, {0, 1, 0, 1}, {{CODE_SOLEMN, 2, LOCATION_SZONE, 0, POS_FACEDOWN}});
	OCG_Duel d = b.d;
	field& f = F(d);
	EXPECT(f.core.current_chain.size() == 1, "backstop: chain size %zu", f.core.current_chain.size());
	if(f.core.current_chain.size() != 1) { OCG_DestroyDuel(d); return; }
	effect* reason = find_effect(find_card(d, CODE_SOLEMN, 2, LOCATION_SZONE), EVENT_CHAINING);
	EXPECT(reason != nullptr, "backstop: reason effect missing");
	if(!reason) { OCG_DestroyDuel(d); return; }
	auto call = [&](const char* expr, effect* re, uint8_t rp) {
		g_log.clear();
		f.core.reason_effect = re;
		f.core.reason_player = rp;
		run_lua(d, std::string("Debug.Message('R='..tostring(") + expr + "))");
		return g_log.find("R=true") != std::string::npos;
	};
	// The link belongs to seat 0. Reason player 2 is the partner of seat 0.
	bool r1 = call("Duel.NegateActivation(1)", reason, 2);
	EXPECT(!r1 && !(f.core.current_chain[0].flag & CHAIN_DISABLE_ACTIVATE), "backstop: NegateActivation by the partner: result %d flag %x", r1, f.core.current_chain[0].flag);
	bool r2 = call("Duel.NegateEffect(1)", reason, 2);
	EXPECT(!r2 && !(f.core.current_chain[0].flag & CHAIN_DISABLE_EFFECT), "backstop: NegateEffect by the partner: result %d flag %x", r2, f.core.current_chain[0].flag);
	std::printf("ok   backstop: Duel.NegateActivation and Duel.NegateEffect of seat 2 on a link of seat 0 do nothing (%d, %d)\n", r1, r2);
	// A continuous reason effect still negates (Imperial Order style: type FIELD + CONTINUOUS).
	effect* cont = static_cast<duel*>(d)->new_effect();
	cont->owner = find_card(d, CODE_SOLEMN, 2, LOCATION_SZONE);
	cont->handler = cont->owner;
	cont->type = EFFECT_TYPE_FIELD | EFFECT_TYPE_CONTINUOUS;
	bool r3 = call("Duel.NegateEffect(1)", cont, 2);
	EXPECT(r3 && (f.core.current_chain[0].flag & CHAIN_DISABLE_EFFECT), "backstop: continuous reason effect must still negate: result %d", r3);
	std::printf("ok   backstop: a continuous reason effect of seat 2 still negates the link of seat 0 (%d)\n", r3);
	// An opponent (seat 1) negates the link: works.
	bool r4 = call("Duel.NegateActivation(1)", reason, 1);
	EXPECT(r4 && (f.core.current_chain[0].flag & CHAIN_DISABLE_ACTIVATE), "backstop: opponent negation must work: result %d", r4);
	std::printf("ok   backstop: a reason player on the other team (seat 1) negates the link of seat 0 (%d)\n", r4);
	OCG_DestroyDuel(d);

	// NegateSummon: a card summoned by seat 0 (set by hand: no real summon needed).
	for(int rp : {2, 1}) {
		OCG_Duel d2 = make_board(4, {0, 1, 0, 1}, {{CODE_SOLEMN, 2, LOCATION_SZONE, 0, POS_FACEDOWN}});
		Prompt p = start_to_idle(d2);
		EXPECT(p.id == MSG_SELECT_IDLECMD, "negate summon: first prompt %d", p.id);
		card* m = F(d2).player[0].list_hand.empty() ? nullptr : F(d2).player[0].list_hand.front();
		EXPECT(m != nullptr, "negate summon: no card in hand of seat 0");
		if(m) {
			for(card* hc : F(d2).player[0].list_hand) hc->summon.player = 0;
			field& g = F(d2);
			effect* re = find_effect(find_card(d2, CODE_SOLEMN, 2, LOCATION_SZONE), EVENT_SUMMON);
			g.core.reason_effect = re;
			g.core.reason_player = static_cast<uint8_t>(rp);
			run_lua(d2, "Duel.NegateSummon(Duel.GetFieldGroup(0,LOCATION_HAND,0):GetFirst())");
			bool disabled = false;
			for(card* hc : g.player[0].list_hand) disabled = disabled || hc->is_status(STATUS_SUMMON_DISABLED);
			EXPECT(disabled == (rp == 1), "negate summon by seat %d on a summon of seat 0: disabled=%d want %d", rp, disabled, rp == 1);
			std::printf("ok   backstop: Duel.NegateSummon by seat %d on a summon of seat 0: summon negated=%d\n", rp, disabled);
		}
		OCG_DestroyDuel(d2);
	}
}

// n = 2: the same boards give the stock answers, with and without SetupDuelists(2,0,1).
static void n2_check() {
	for(int setup = 0; setup < 2; ++setup) {
		OCG_Duel d = make_board(2, {0, 1}, {{CODE_SOLEMN, 1, LOCATION_SZONE, 0, POS_FACEDOWN}}, setup == 1);
		Prompt p = start_to_idle(d);
		EXPECT(p.id == MSG_SELECT_IDLECMD && p.seat == 0, "n2: first prompt id %d seat %d", p.id, p.seat);
		const bool got = offered(d, find_effect(find_card(d, CODE_SOLEMN, 1, LOCATION_SZONE), EVENT_SUMMON), 1, 0);
		EXPECT(got, "n2 (setup %d): Solemn of seat 1 not offered against seat 0", setup);
		std::printf("ok   n=2 (SetupDuelists call %d): Solemn of seat 1 offered against seat 0 = %d\n", setup, got);
		OCG_DestroyDuel(d);
	}
	for(int setup = 0; setup < 2; ++setup) {
		AshBoard b = ash_board(2, {0, 1});
		(void)setup;
		field& f = F(b.d);
		EXPECT(b.p.id == MSG_SELECT_CHAIN && b.p.seat == 1 && contains_code(b.p.bytes, CODE_ASH), "n2 ash: prompt id %d seat %d", b.p.id, b.p.seat);
		if(f.core.current_chain.size() == 1) {
			effect* e = find_effect(find_card(b.d, CODE_ASH, 1, LOCATION_HAND), EVENT_CHAINING);
			const bool got = e && offered(b.d, e, 1, 0, 1, f.core.current_chain[0].triggering_effect);
			EXPECT(got, "n2 ash: Ash of seat 1 not offered against a search by seat 0");
			std::printf("ok   n=2: Ash Blossom of seat 1 offered against a search by seat 0 = %d (real chain prompt to seat %d)\n", got, b.p.seat);
		}
		OCG_DestroyDuel(b.d);
		break;
	}
}

int main(int argc, char** argv) {
	if(argc < 3) { std::fprintf(stderr, "usage: check <cards.tsv> <card-scripts> [mode]\n"); return 2; }
	load_cards(argv[1]);
	index_scripts(argv[2]);
	const std::string mode = argc > 3 ? argv[3] : "all";
	const bool all = mode == "all";
	if(all || mode == "solemn") {
		solemn_matrix("Tag 0,1,0,1", 4, {0, 1, 0, 1}, true);
		solemn_matrix("FFA 3", 3, {0, 1, 2}, false);
		solemn_matrix("FFA 4", 4, {0, 1, 2, 3}, false);
		real_summon_prompt();
	}
	if(all || mode == "ash") {
		ash_matrix("Tag 0,1,0,1", 4, {0, 1, 0, 1}, true);
		ash_matrix("FFA 3", 3, {0, 1, 2}, false);
		ash_matrix("FFA 4", 4, {0, 1, 2, 3}, false);
	}
	if(all || mode == "jinzo")
		jinzo_check();
	if(all || mode == "backstop")
		backstop_check();
	if(all || mode == "n2")
		n2_check();
	std::printf("%s: %d passed, %d failure(s)\n", failures ? "FAIL" : "PASS", passes, failures);
	return failures ? 1 : 0;
}
