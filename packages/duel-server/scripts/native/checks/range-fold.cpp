// F02 native check: the core range fold (field.cpp two sided loops, effect.cpp is_target_player).
// Build and run: bash packages/duel-server/scripts/native/checks/run.sh <check name> (see README.md).
// Board: every duelist has one Blue-Eyes (vanilla) in the Monster Zone and one set Raigeki in the Spell/Trap Zone,
// and a Deck. Seat 1 also has a face-up Jinzo. The real card scripts come from data/duel-engine-next/card-scripts.
// The queries run from Lua at the first Main Phase prompt of the turn player, with the raw seat as the player
// argument (a bare script has no Lua scope, so the raw core seat is used). Inside an effect that belongs to a card Lua
// sees 0 and 1 only (the fold). Inside a global effect (patch 0053) Lua sees real seats. The destroy part runs both.
// Modes:
//   check      ffa3, ffa4, tag, identity
//   trap-n3    (trap build) a 3 duelist duel with the same board: prints the first trap, exit 0 if a trap line is seen
#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <map>
#include <sstream>
#include <string>
#include <unordered_map>
#include <vector>
#include "ocgapi.h"
#include "ocgapi_constants.h"
#include "duel.h"
#include "field.h"
#include "common.h"

namespace fs = std::filesystem;
static std::vector<std::string> chk_lines;


struct CardRow {
	OCG_CardData d;
	std::vector<uint16_t> sets;
};
static std::unordered_map<uint32_t, CardRow> g_cards;
static std::map<std::string, std::string> g_scripts;
// cards.tsv comes from scripts/native/dump-card-data.mjs. run.sh writes it and sets CHECK_DATA.
static std::string data_dir() {
	return check_env("CHECK_DATA", ".");
}
static std::string scripts_dir() {
	return check_scripts_dir();
}
static void load_data() {
	std::ifstream in(data_dir() + "/cards.tsv");
	if(!in) {
		std::printf("FAIL: cannot read %s/cards.tsv (run from the repo root)\n", data_dir().c_str());
		std::exit(2);
	}
	std::string line;
	while(std::getline(in, line)) {
		std::istringstream ss(line);
		CardRow row;
		std::memset(&row.d, 0, sizeof(row.d));
		unsigned long long race = 0;
		std::string sets;
		long long atk = 0, def = 0;
		uint32_t code = 0, alias = 0, type = 0, level = 0, attr = 0, ls = 0, rs = 0, lm = 0;
		ss >> code >> alias >> type >> level >> attr >> race >> atk >> def >> ls >> rs >> lm >> sets;
		row.d.code = code;
		row.d.alias = alias;
		row.d.type = type;
		row.d.level = level;
		row.d.attribute = attr;
		row.d.race = race;
		row.d.attack = static_cast<int32_t>(atk);
		row.d.defense = static_cast<int32_t>(def);
		row.d.lscale = ls;
		row.d.rscale = rs;
		row.d.link_marker = lm;
		row.sets.push_back(0);
		g_cards.emplace(code, std::move(row));
	}
	for(auto& kv : g_cards)
		kv.second.d.setcodes = kv.second.sets.data();
	for(const auto& e : fs::recursive_directory_iterator(scripts_dir())) {
		if(!e.is_regular_file() || e.path().extension() != ".lua")
			continue;
		g_scripts[e.path().filename().string()] = e.path().string();
		g_scripts[fs::relative(e.path(), scripts_dir()).generic_string()] = e.path().string();
	}
}
static void read_card(void*, uint32_t code, OCG_CardData* data) {
	auto it = g_cards.find(code);
	if(it == g_cards.end()) {
		std::memset(data, 0, sizeof(*data));
		data->code = code;
		return;
	}
	*data = it->second.d;
}
static int read_script(void*, OCG_Duel duel, const char* name) {
	std::string n(name);
	std::replace(n.begin(), n.end(), '\\', '/');
	auto it = g_scripts.find(n);
	if(it == g_scripts.end()) {
		auto slash = n.find_last_of('/');
		if(slash != std::string::npos)
			it = g_scripts.find(n.substr(slash + 1));
	}
	if(it == g_scripts.end())
		return 0;
	std::ifstream in(it->second, std::ios::binary);
	std::stringstream buf;
	buf << in.rdbuf();
	const std::string text = buf.str();
	return OCG_LoadScript(duel, text.data(), static_cast<uint32_t>(text.size()), name);
}
static void on_log(void*, const char* text, int type) {
	const std::string s = text ? text : "";
	if(type == OCG_LOG_TYPE_FROM_SCRIPT && s.rfind("CHK ", 0) == 0)
		chk_lines.push_back(s.substr(4));
	else if(type == OCG_LOG_TYPE_ERROR || std::getenv("CHECK_LOG"))
		std::fprintf(stderr, "core log [%d]: %s\n", type, s.c_str());
}

static OCG_Duel make_duel(uint32_t seed = 1) {
	OCG_DuelOptions options;
	std::memset(&options, 0, sizeof(options));
	options.seed[0] = seed;
	options.seed[1] = 2;
	options.seed[2] = 3;
	options.seed[3] = 4;
	options.flags = DUEL_MODE_MR5;
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
	for(const char* name : {"constant.lua", "utility.lua"}) {
		if(!read_script(nullptr, duel, name)) {
			std::printf("FAIL: cannot load %s\n", name);
			std::exit(2);
		}
	}
	return duel;
}
static field& F(OCG_Duel d) { return *static_cast<duel*>(d)->game_field; }
static bool run_lua(OCG_Duel d, const std::string& code) {
	return OCG_LoadScript(d, code.c_str(), static_cast<uint32_t>(code.size()), "check.lua") != 0;
}
static void add_card(OCG_Duel d, uint8_t seat, uint32_t loc, uint32_t seq, uint32_t pos, uint32_t code) {
	OCG_NewCardInfo info;
	std::memset(&info, 0, sizeof(info));
	info.team = seat;
	info.duelist = 0;
	info.code = code;
	info.con = seat;
	info.loc = loc;
	info.seq = seq;
	info.pos = pos;
	OCG_DuelNewCard(d, &info);
}

constexpr uint32_t BLUE_EYES = 89631139, RAIGEKI = 12580477, DUSTER = 18144506, JINZO = 77585513;

static bool saw_win = false;
// One process step. Answers chain prompts with "no", the idle prompt with "end phase" (unless hold_idle), select-card with
// the first min cards. Returns the status. prompt_seen is set when a prompt message arrived.
static int step(OCG_Duel d, bool hold_idle, bool& at_idle) {
	at_idle = false;
	int status = OCG_DuelProcess(d);
	uint32_t length = 0;
	const auto* buffer = static_cast<const uint8_t*>(OCG_DuelGetMessage(d, &length));
	bool idle = false, chain = false, select_card = false;
	uint32_t select_min = 0;
	for(uint32_t offset = 0; offset + 4 <= length;) {
		uint32_t size = 0;
		std::memcpy(&size, buffer + offset, 4);
		if(size > 0 && buffer[offset + 4] == MSG_WIN)
			saw_win = true;
		if(size > 0 && buffer[offset + 4] == MSG_SELECT_IDLECMD)
			idle = true;
		if(size > 0 && buffer[offset + 4] == MSG_SELECT_CHAIN)
			chain = true;
		if(size > 10 && buffer[offset + 4] == MSG_SELECT_CARD) {
			select_card = true;
			std::memcpy(&select_min, buffer + offset + 7, 4);
		}
		offset += 4 + size;
	}
	if(status == OCG_DUEL_STATUS_AWAITING) {
		if(chain) {
			const int32_t no_chain = -1;
			OCG_DuelSetResponse(d, &no_chain, sizeof(no_chain));
		} else if(idle) {
			at_idle = true;
			if(!hold_idle) {
				const uint32_t to_end_phase = 7;
				OCG_DuelSetResponse(d, &to_end_phase, sizeof(to_end_phase));
			}
		} else if(select_card) {
			std::vector<uint32_t> response{ 0, select_min };
			for(uint32_t i = 0; i < select_min; ++i)
				response.push_back(i);
			OCG_DuelSetResponse(d, response.data(), static_cast<uint32_t>(response.size() * sizeof(uint32_t)));
		}
	}
	return status;
}

struct Layout {
	const char* name;
	int n;
	std::vector<int> team;
	bool tag;
};

static std::string setup_code(const Layout& l) {
	std::string code = "Debug.SetupDuelists(" + std::to_string(l.n);
	for(int t : l.team)
		code += "," + std::to_string(t);
	return code + ")";
}
static void build_board(OCG_Duel d, const Layout& l) {
	for(int p = 0; p < l.n; ++p) {
		const auto s = static_cast<uint8_t>(p);
		for(int i = 0; i < 30; ++i)
			add_card(d, s, LOCATION_DECK, 0, POS_FACEDOWN_DEFENSE, BLUE_EYES);
		add_card(d, s, LOCATION_MZONE, 0, POS_FACEUP_ATTACK, BLUE_EYES);
		add_card(d, s, LOCATION_SZONE, 0, POS_FACEDOWN, RAIGEKI);
	}
	add_card(d, 1, LOCATION_MZONE, 1, POS_FACEUP_ATTACK, JINZO);
}
// Runs to the first idle prompt and holds there. Returns false if none was reached.
static bool to_idle(OCG_Duel d) {
	OCG_StartDuel(d);
	for(int i = 0; i < 400; ++i) {
		bool at_idle = false;
		const int status = step(d, true, at_idle);
		if(at_idle)
			return true;
		if(status == OCG_DUEL_STATUS_END)
			return false;
	}
	return false;
}
static int count_zone(field& f, int seat, uint8_t zone) {
	int c = 0;
	const auto& list = zone == 0 ? f.player[seat].list_mzone : f.player[seat].list_szone;
	for(auto* pc : list)
		if(pc)
			++c;
	return c;
}

// The expected seats, sorted, as "a,b".
static std::string seats_str(std::vector<int> v) {
	std::sort(v.begin(), v.end());
	std::string s;
	for(int x : v)
		s += (s.empty() ? "" : ",") + std::to_string(x);
	return s;
}

// Real destroy: an EVENT_ADJUST operation destroys the Raigeki group (all opposing monsters) and the Duster group (all
// opposing Spell/Trap cards). Duel.Destroy is not allowed from a bare script, so it runs in an effect. Which duelist is
// "the opposing side" depends on the kind of effect (patch 0053, R2 rule 1):
//   Card          the effect belongs to the Blue-Eyes of seat `who`. It has a seat, so Lua sees the folded values (0 = the
//                 owner, 1 = the opponents): the query player 0 is `who`.
//   Global        Effect.GlobalEffect registered for seat 0 (not for `who`). It has no seat and no fold, so the query
//                 player is a real seat: `who`. The seat that registered it plays no part.
//   GlobalSeat1   a global effect that queries with the literal player 1. That is real seat 1, not "the opponents": the
//                 side that is hit is every duelist that is not on the team of seat 1.
// The monsters and Spell/Traps of the hit duelists must be gone, all others unchanged.
enum class Kill { Card, Global, GlobalSeat1 };
static void check_destroy(const Layout& l, Kill kind) {
	const char* label = kind == Kill::Card ? "card effect" : kind == Kill::Global ? "global effect" : "global effect, literal seat 1";
	OCG_Duel d = make_duel();
	EXPECT(run_lua(d, setup_code(l)), "%s: SetupDuelists", l.name);
	build_board(d, l);
	auto& f = F(d);
	if(!to_idle(d)) {
		EXPECT(false, "%s (%s): no idle prompt", l.name, label);
		OCG_DestroyDuel(d);
		return;
	}
	const int who = l.n > 2 ? 2 : 0;
	const int killer = kind == Kill::GlobalSeat1 ? 1 : who; // the seat whose opponents are destroyed
	std::vector<int> before_mz(l.n), before_st(l.n);
	for(int q = 0; q < l.n; ++q) { before_mz[q] = count_zone(f, q, 0); before_st[q] = count_zone(f, q, 1); }
	const std::string query_player = kind == Kill::Card ? "0" : kind == Kill::Global ? std::to_string(who) : "1";
	const std::string body =
		"  Duel.Destroy(Duel.GetMatchingGroup(aux.TRUE," + query_player + ",0,LOCATION_MZONE,nil),REASON_EFFECT)\n"
		"  Duel.Destroy(Duel.GetMatchingGroup(Card.IsSpellTrap," + query_player + ",0,LOCATION_ONFIELD,nil),REASON_EFFECT)\n"
		"  Debug.Message(\"CHK killed\")\n"
		"end)\n";
	const std::string head = "local done=false\n";
	const std::string op = "e:SetOperation(function(e,tp)\n  if done then return end\n  done=true\n";
	std::string kill;
	if(kind == Kill::Card)
		kill = head + "local h=Duel.GetFieldCard(" + std::to_string(who) + ",LOCATION_MZONE,0)\nlocal e=Effect.CreateEffect(h)\n"
		       "e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)\ne:SetCode(EVENT_ADJUST)\ne:SetRange(LOCATION_MZONE)\n" + op + body + "h:RegisterEffect(e)\n";
	else
		kill = head + "local e=Effect.GlobalEffect()\ne:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)\ne:SetCode(EVENT_ADJUST)\n" + op + body +
		       "Duel.RegisterEffect(e," + (kind == Kill::Global ? std::string("0") : std::to_string(who)) + ")\n";
	chk_lines.clear();
	EXPECT(run_lua(d, kill), "%s (%s): destroy script", l.name, label);
	const uint32_t to_end_phase = 7;
	OCG_DuelSetResponse(d, &to_end_phase, sizeof(to_end_phase));
	bool killed = false;
	for(int i = 0; i < 200 && !killed; ++i) {
		bool at_idle = false;
		if(step(d, true, at_idle) == OCG_DUEL_STATUS_END)
			break;
		for(const auto& line : chk_lines)
			killed = killed || line == "killed";
	}
	for(int i = 0; i < 4; ++i) {
		bool at_idle = false;
		step(d, true, at_idle);
	}
	if(std::getenv("CHECK_DEBUG")) { for(const auto& line : chk_lines) std::printf("  chk: %s\n", line.c_str()); for(int q = 0; q < l.n; ++q) std::printf("  seat %d mz %d st %d\n", q, count_zone(f, q, 0), count_zone(f, q, 1)); }
	EXPECT(killed, "%s (%s): the Destroy operation did not run", l.name, label);
	for(int q = 0; q < l.n; ++q) {
		const bool should_die = l.team[q] != l.team[killer];
		const int expect_mz = should_die ? 0 : before_mz[q];
		const int expect_st = should_die ? 0 : before_st[q];
		EXPECT(count_zone(f, q, 0) == expect_mz, "%s (%s): after Raigeki group (seat %d) seat %d has %d monsters, want %d", l.name, label, killer, q, count_zone(f, q, 0), expect_mz);
		EXPECT(count_zone(f, q, 1) == expect_st, "%s (%s): after Duster group (seat %d) seat %d has %d S/T, want %d", l.name, label, killer, q, count_zone(f, q, 1), expect_st);
	}
	std::printf("ok   %s: %s: Destroy on the Raigeki group and the Duster group hit only the other team(s) of seat %d\n", l.name, label, killer);
	OCG_DestroyDuel(d);
}

static void check_layout(const Layout& l) {
	OCG_Duel d = make_duel();
	EXPECT(run_lua(d, setup_code(l)), "%s: SetupDuelists", l.name);
	build_board(d, l);
	auto& f = F(d);
	if(!to_idle(d)) {
		EXPECT(false, "%s: no idle prompt", l.name);
		OCG_DestroyDuel(d);
		return;
	}
	const int tp = f.infos.turn_player;
	// seats of the opponents of `who` (other team), of the team of `who` (incl. who)
	auto opp = [&](int who) { std::vector<int> v; for(int q = 0; q < l.n; ++q) if(l.team[q] != l.team[who]) v.push_back(q); return v; };
	auto team = [&](int who) { std::vector<int> v; for(int q = 0; q < l.n; ++q) if(l.team[q] == l.team[who]) v.push_back(q); return v; };
	// Lua probes. Every line is "CHK key value".
	const std::string probe = R"LUA(
local function seats(g)
  local t={}
  for c in aux.Next(g) do t[#t+1]=c:GetControler() end
  table.sort(t)
  return table.concat(t,",")
end
local n=)LUA" + std::to_string(l.n) + R"LUA(
for tp=0,n-1 do
  Debug.Message("CHK raigeki"..tp.." "..seats(Duel.GetMatchingGroup(aux.TRUE,tp,0,LOCATION_MZONE,nil)))
  Debug.Message("CHK duster"..tp.." "..seats(Duel.GetMatchingGroup(Card.IsSpellTrap,tp,0,LOCATION_ONFIELD,nil)))
  Debug.Message("CHK ownmz"..tp.." "..seats(Duel.GetMatchingGroup(aux.TRUE,tp,LOCATION_MZONE,0,nil)))
  Debug.Message("CHK cntoppmz"..tp.." "..Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE))
  Debug.Message("CHK cntownmz"..tp.." "..Duel.GetFieldGroupCount(tp,LOCATION_MZONE,0))
  Debug.Message("CHK cntopphand"..tp.." "..Duel.GetFieldGroupCount(tp,0,LOCATION_HAND))
  Debug.Message("CHK cntownhand"..tp.." "..Duel.GetFieldGroupCount(tp,LOCATION_HAND,0))
  Debug.Message("CHK exists"..tp.." "..tostring(Duel.IsExistingMatchingCard(aux.TRUE,tp,0,LOCATION_MZONE,1,nil)))
end
-- A Jinzo-like effect of seat 1: EFFECT_CANNOT_ACTIVATE, player target, range (1,1), value = "the card is a Trap".
-- (The script of Jinzo in this card pool gives e2 no range, so the real e2 never applies; this copy is the same effect.)
do
  local e=Effect.GlobalEffect()
  e:SetType(EFFECT_TYPE_FIELD)
  e:SetCode(EFFECT_CANNOT_ACTIVATE)
  e:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
  e:SetTargetRange(1,1)
  e:SetValue(function(e,re,tp) return re:GetHandler():IsTrap() end)
  Duel.RegisterEffect(e,1)
end
for tp=0,n-1 do
  local e=Duel.IsPlayerAffectedByEffect(tp,EFFECT_CANNOT_ACTIVATE)
  Debug.Message("CHK jinzo"..tp.." "..tostring(e~=nil))
end
-- a player target effect registered by seat 1: (1,0) and (0,1)
local function reg(code,s,o,who)
  local e=Effect.GlobalEffect()
  e:SetType(EFFECT_TYPE_FIELD)
  e:SetCode(code)
  e:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
  e:SetTargetRange(s,o)
  Duel.RegisterEffect(e,who)
end
reg(90000001,1,0,1)
reg(90000002,0,1,1)
reg(90000003,1,1,1)
for tp=0,n-1 do
  Debug.Message("CHK s_only"..tp.." "..tostring(Duel.IsPlayerAffectedByEffect(tp,90000001)~=nil))
  Debug.Message("CHK o_only"..tp.." "..tostring(Duel.IsPlayerAffectedByEffect(tp,90000002)~=nil))
  Debug.Message("CHK both"..tp.." "..tostring(Duel.IsPlayerAffectedByEffect(tp,90000003)~=nil))
end
)LUA";
	chk_lines.clear();
	EXPECT(run_lua(d, probe), "%s: probe script", l.name);
	std::map<std::string, std::string> r;
	for(const auto& line : chk_lines) {
		const auto sp = line.find(' ');
		r[line.substr(0, sp)] = line.substr(sp + 1);
	}
	auto want = [&](const std::string& key, const std::string& value) {
		const auto it = r.find(key);
		EXPECT(it != r.end() && it->second == value, "%s: %s = '%s', want '%s'", l.name, key.c_str(),
		       it == r.end() ? "<none>" : it->second.c_str(), value.c_str());
	};
	auto hands = [&](const std::vector<int>& v) { int c = 0; for(int q : v) c += static_cast<int>(f.player[q].list_hand.size()); return std::to_string(c); };
	for(int p = 0; p < l.n; ++p) {
		const std::string P = std::to_string(p);
		// Monsters: every seat has one Blue-Eyes, seat 1 also a Jinzo (two monsters).
		std::vector<int> mz;
		for(int q : opp(p)) { mz.push_back(q); if(q == 1) mz.push_back(q); }
		want("raigeki" + P, seats_str(mz));
		std::vector<int> st;
		for(int q : opp(p)) st.push_back(q);
		want("duster" + P, seats_str(st));
		std::vector<int> own;
		for(int q : team(p)) { own.push_back(q); if(q == 1) own.push_back(q); }
		want("ownmz" + P, seats_str(own));
		want("cntoppmz" + P, std::to_string(mz.size()));
		want("cntownmz" + P, std::to_string(own.size()));
		// Hand: the individual class. Nothing is bound, so the query uses every living opponent (and only P for the own side).
		want("cntopphand" + P, hands(opp(p)));
		want("cntownhand" + P, hands({p}));
		want("exists" + P, "true");
		// Jinzo: a (1,1) player target effect hits every duelist, the partner and Jinzo's owner included.
		want("jinzo" + P, "true");
		// Player target ranges. Registered by seat 1, viewpoint seat 1 (Tag: team 1 = seats 1 and 3).
		const bool is_self = p == 1;
		const bool is_mate = p != 1 && l.team[p] == l.team[1];
		want("s_only" + P, is_self ? "true" : "false");
		want("o_only" + P, (!is_self && !is_mate) ? "true" : "false");
		want("both" + P, "true");
	}
	std::printf("ok   %s: probes from every seat (raigeki/duster groups, counts, hand class, Jinzo, s/o/both ranges), turn player %d\n", l.name, tp);

	OCG_DestroyDuel(d);
	for(const Kill k : { Kill::Card, Kill::Global, Kill::GlobalSeat1 })
		check_destroy(l, k);
}

// n = 2 bytes identical with and without SetupDuelists(2,0,1) on the same board (plus the real card scripts).
static std::vector<uint8_t> run_two(int setup, int max_steps, uint32_t seed) {
	OCG_Duel d = make_duel(seed);
	if(setup == 1 && !run_lua(d, "Debug.SetupDuelists(2,0,1)")) {
		std::printf("FAIL: SetupDuelists(2,0,1)\n");
		++failures;
	}
	Layout l{"n2", 2, {0, 1}, false};
	build_board(d, l);
	OCG_StartDuel(d);
	std::vector<uint8_t> all;
	saw_win = false;
	for(int i = 0; i < max_steps && !saw_win; ++i) {
		bool at_idle = false;
		const int status = step(d, false, at_idle);
		uint32_t length = 0;
		const auto* buffer = static_cast<const uint8_t*>(OCG_DuelGetMessage(d, &length));
		all.insert(all.end(), buffer, buffer + length);
		if(status == OCG_DUEL_STATUS_END)
			break;
	}
	uint32_t length = 0;
	const auto* q = static_cast<const uint8_t*>(OCG_DuelQueryField(d, &length));
	all.insert(all.end(), q, q + length);
	OCG_DestroyDuel(d);
	return all;
}

static int trap_run() {
	Layout l{"ffa3", 3, {0, 1, 2}, false};
	OCG_Duel d = make_duel();
	if(!run_lua(d, setup_code(l)))
		return 3;
	build_board(d, l);
	OCG_StartDuel(d);
	for(int i = 0; i < 400; ++i) {
		bool at_idle = false;
		if(step(d, false, at_idle) == OCG_DUEL_STATUS_END)
			break;
	}
	std::printf("trap-n3: no trap in 400 steps\n");
	return 0;
}

int main(int argc, char** argv) {
	const std::string mode = argc > 1 ? argv[1] : "check";
	load_data();
	if(mode == "trap-n3")
		return trap_run();
	const Layout layouts[] = {
		{"n2", 2, {0, 1}, false},
		{"ffa3", 3, {0, 1, 2}, false},
		{"ffa4", 4, {0, 1, 2, 3}, false},
		{"tag", 4, {0, 1, 0, 1}, true},
	};
	for(const auto& l : layouts)
		check_layout(l);
	for(uint32_t seed : {1u, 77u}) {
		const auto a = run_two(0, 3000, seed);
		const auto b = run_two(1, 3000, seed);
		EXPECT(a == b, "n=2 seed %u: bytes differ with and without SetupDuelists(2,0,1)", seed);
		std::printf("ok   n=2 seed %u: %zu bytes identical with and without SetupDuelists(2,0,1)\n", seed, a.size());
	}
	std::printf("%s: %d failure(s)\n", failures ? "FAIL" : "PASS", failures);
	return failures ? 1 : 0;
}
