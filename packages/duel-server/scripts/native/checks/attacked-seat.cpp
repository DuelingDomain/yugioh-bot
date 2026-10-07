// Native check for core patch 0058 (Duel.MPAttackedSeat() gives the real seat of the duelist that the current attack goes at, at n > 2).
// The Lua values 0 and 1 fold every opponent to 1, so a script cannot tell a direct attack at itself from a direct attack at another
// opponent that also has no monster (Number 100 Numeron Dragon). The card of seat 0 logs Duel.MPAttackedSeat() at the attack events
// (announce, "ann"; attack negated, "disabled"; battle start, "bstart"; after the battle, "battled"; end of the damage step, "dsend").
// Cases: a direct attack at seat 1 and at seat 2 (the direct-attack pick), a direct attack with one open opponent (no pick), an attack on a
// monster of seat 2, FFA4, and Tag (the attacked seat is a real seat of the other team).
// Redirect cases: Duel.ChangeAttackTarget to a monster of another opponent (FFA3 and Tag: the value moves with the attack), to nil (the
// attack becomes direct and the value stays the seat of the old target: its controller takes the damage), Duel.NegateAttack (the value is
// kept for the "disabled" event, no damage), Duel.ChainAttack (FFA3 and FFA4: the second attack goes at the next seat), and a target that
// leaves the field at the battle start (the value stays). Every case asserts the value at each event and the LP of every seat.
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

static const uint32_t kTestBase = 90001;  // test card of seat s = kTestBase + s
static const uint32_t kDeckBase = 5000;   // deck card of seat s = kDeckBase + s
static const uint32_t kToken = 91001;      // a monster that the calls put on a field
static const uint32_t kSpell = 91002;      // a Spell that SSet puts on a field

// variant "atk": the card of seat 0 (code 90001) logs Duel.MPAttackedSeat() when an attack is announced
static const char* kAtkScript = R"LUA(
local s,id=GetID()
local function log(tag) Debug.Message("PA "..tag.." "..tostring(Duel.MPAttackedSeat())) end
function s.initial_effect(c)
	local function reg(code,fn)
		local e=Effect.CreateEffect(c)
		e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
		e:SetCode(code)
		e:SetRange(LOCATION_MZONE)
		e:SetOperation(fn)
		c:RegisterEffect(e)
	end
	reg(EVENT_ATTACK_ANNOUNCE,function(e,tp)
		log("ann")
		s.n=(s.n or 0)+1
		if s.n>1 then return end
		if MPX_MODE=="negate" then Duel.NegateAttack() log("negated") elseif MPX_MODE=="tonil" then Duel.ChangeAttackTarget(nil) log("after")
		elseif MPX_MODE=="toother" then
			local cur=Duel.MPAttackedSeat()
			local g=Duel.GetMatchingGroup(function(tc) return Duel.MPSeatOf(tc)~=cur end,tp,0,LOCATION_MZONE,nil)
			Duel.ChangeAttackTarget(g:GetFirst()) log("after")
		end
	end)
	reg(EVENT_ATTACK_DISABLED,function() log("disabled") end)
	reg(EVENT_BATTLE_START,function(e,tp)
		log("bstart")
		if MPX_MODE=="leave" and Duel.GetAttackTarget() then Duel.SendtoGrave(Duel.GetAttackTarget(),REASON_EFFECT) log("left") end
	end)
	reg(EVENT_BATTLED,function(e,tp)
		log("battled")
		if MPX_MODE=="chain" and not s.chained then s.chained=true Duel.ChainAttack() end
	end)
	reg(EVENT_DAMAGE_STEP_END,function() log("dsend") end)
	if MPX_MODE=="negate" then
		local e=Effect.CreateEffect(c)
		e:SetType(EFFECT_TYPE_QUICK_O)
		e:SetCode(EVENT_ATTACK_ANNOUNCE)
		e:SetRange(LOCATION_MZONE)
		e:SetOperation(function() Duel.NegateAttack() log("negated") end)
		c:RegisterEffect(e)
	end
end
)LUA";

static OCG_Duel g_duel = nullptr;
static long g_errors = 0;
static std::vector<std::string> g_error_text;
static int g_ops = 0;
static std::vector<std::string> g_atk;  // the values of Duel.MPAttackedSeat() that the card of seat 0 logged

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
	if(code == kTestBase) data->attack = 2000;
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
		if(code == kTestBase)
			text = kAtkScript;
		else if((code > kTestBase && code < kTestBase + 4) || code == kToken || code == kSpell)
			text = "local s,id=GetID()\nfunction s.initial_effect(c) end\n";
	}
	if(text.empty()) {
		const std::string roots[] = { std::string(check_scripts_dir()) + "/", std::string(check_scripts_dir()) + "/official/", std::string(check_scripts_dir()) + "/pre-release/" };
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


static void on_log(void*, const char* text, int type) {
	if(type == OCG_LOG_TYPE_ERROR || type == OCG_LOG_TYPE_UNDEFINED) {
		++g_errors;
		if(g_error_text.size() < 8) g_error_text.push_back(text ? text : "");
		if(std::getenv("CHECK_LOG")) std::fprintf(stderr, "core log [%d]: %s\n", type, text);
		return;
	}
	if(text && std::strncmp(text, "PA ", 3) == 0) g_atk.push_back(text + 3);  // "tag value"
}

static void add_card(OCG_Duel d, uint8_t con, uint32_t loc, uint32_t code, uint32_t pos) {
	OCG_NewCardInfo info;
	std::memset(&info, 0, sizeof(info));
	info.team = con; info.duelist = 0; info.code = code; info.con = con; info.loc = loc; info.seq = 0; info.pos = pos;
	OCG_DuelNewCard(d, &info);
}

struct Msg { uint8_t id; const uint8_t* p; uint32_t size; };

// Duel.MPAttackedSeat: seat 0 (turn 1, DUEL_ATTACK_FIRST_TURN) attacks. mons = the seats (bit s) that control a plain monster besides the attacker;
// direct = the answer to "direct attack?" when it is asked (1 = direct, 0 = a monster); dpick = the seat that the direct-attack pick names
// (-1: no such pick must open); mode = what the card of seat 0 does at the attack announce (none, tonil, toother, negate, chain, leave);
// seq = the log of Duel.MPAttackedSeat() at each event, in
// order ("tag=value"); lp = the LP of every seat at the end (the attacker has 2000 ATK, the plain monsters 1000; in Tag the LP of a
// team is kept by its first seat, so the other seat of the team stays at 8000).
struct AScenario {
	const char* name;
	int n;
	std::vector<int> team;
	int mons;
	int direct;
	int dpick;
	const char* mode;
	const char* seq;
	std::vector<int> lp;
};

static void run_attack(const AScenario& sc) {
	g_errors = 0; g_error_text.clear(); g_ops = 0; g_atk.clear();
	OCG_DuelOptions options;
	std::memset(&options, 0, sizeof(options));
	options.seed[0] = 7; options.seed[1] = 2; options.seed[2] = 3; options.seed[3] = 4;
	options.flags = DUEL_MODE_MR5 | DUEL_ATTACK_FIRST_TURN;
	options.team1 = { 8000, 5, 1 };
	options.team2 = { 8000, 5, 1 };
	options.cardReader = read_card;
	options.scriptReader = read_script;
	options.logHandler = on_log;
	OCG_Duel d = nullptr;
	if(OCG_CreateDuel(&d, &options) != OCG_DUEL_CREATION_SUCCESS) { EXPECT(false, "%s: OCG_CreateDuel", sc.name); return; }
	g_duel = d;
	for(const char* name : { "constant.lua", "utility.lua" })
		if(!read_script(nullptr, d, name)) { EXPECT(false, "%s: script %s", sc.name, name); g_duel = nullptr; OCG_DestroyDuel(d); return; }
	std::string code = "Debug.SetupDuelists(" + std::to_string(sc.n);
	for(int t : sc.team) code += "," + std::to_string(t);
	code += ")";
	if(!OCG_LoadScript(d, code.c_str(), static_cast<uint32_t>(code.size()), "setup.lua") || g_errors) {
		EXPECT(false, "%s: SetupDuelists", sc.name); g_duel = nullptr; OCG_DestroyDuel(d); return;
	}
	for(int s = 0; s < sc.n; ++s)
		for(int i = 0; i < 30; ++i)
			add_card(d, static_cast<uint8_t>(s), LOCATION_DECK, kDeckBase + s, POS_FACEDOWN_DEFENSE);
	add_card(d, 0, LOCATION_MZONE, kTestBase, POS_FACEUP_ATTACK);
	for(int s = 0; s < sc.n; ++s)
		if(s != 0 && ((sc.mons >> s) & 1))
			add_card(d, static_cast<uint8_t>(s), LOCATION_MZONE, kToken, POS_FACEUP_ATTACK);
	{ std::string m = std::string("MPX_MODE=\"") + sc.mode + "\""; OCG_LoadScript(d, m.c_str(), (uint32_t)m.size(), "mode.lua"); }
	OCG_StartDuel(d);
	int turns = 0, dpicks = 0, attacked = 0;
	bool done = false;
	std::string why;
	for(int steps = 0; steps < 4000 && !done; ++steps) {
		const int status = OCG_DuelProcess(d);
		uint32_t length = 0;
		const auto* buf = static_cast<const uint8_t*>(OCG_DuelGetMessage(d, &length));
		std::vector<Msg> msgs;
		for(uint32_t off = 0; off + 4 <= length;) {
			uint32_t size = 0;
			std::memcpy(&size, buf + off, 4);
			if(size > 0) {
				msgs.push_back({ buf[off + 4], buf + off + 5, size - 1 });
				if(buf[off + 4] == MSG_NEW_TURN) ++turns;
			}
			off += 4 + size;
		}
		if(status == OCG_DUEL_STATUS_END) { why = "duel ended"; break; }
		if(status != OCG_DUEL_STATUS_AWAITING) continue;
		const Msg* m = msgs.empty() ? nullptr : &msgs.back();
		if(!m) { why = "awaiting without a message"; break; }
		auto answer32 = [&](int32_t v) { OCG_DuelSetResponse(d, &v, sizeof(v)); };
		if(std::getenv("CHECK_LOG")) std::fprintf(stderr, "%s turn %d prompt msg %u\n", sc.name, turns, static_cast<unsigned>(m->id));
		if(turns >= 2) { done = true; break; }
		switch(m->id) {
		case MSG_SELECT_IDLECMD: answer32(!attacked ? 6 : 7); break;
		case MSG_SELECT_BATTLECMD: { const int mx = std::string(sc.mode) == "chain" ? 2 : 1; uint32_t nc; std::memcpy(&nc, m->p + 1, 4); uint32_t na; std::memcpy(&na, m->p + 5 + nc * 19, 4); if(attacked < mx && na > 0) { ++attacked; answer32(1); } else answer32(3); break; }
		case MSG_SELECT_YESNO: answer32(sc.direct); break;
		case MSG_SELECT_EFFECTYN: answer32(1); break;
		case MSG_SELECT_OPTION: {
			const int count = m->p[1];
			int idx = 0;
			for(int i = 0; i < count; ++i) {
				uint64_t desc = 0;
				std::memcpy(&desc, m->p + 2 + 8 * i, 8);
				EXPECT((desc & 0xFFFF0000ULL) == 0xFFFF0000ULL, "%s: an option prompt that is not the direct-attack pick (%llx)", sc.name, static_cast<unsigned long long>(desc));
				if(static_cast<int>(desc & 0xFF) == sc.dpick) idx = i;
			}
			++dpicks;
			answer32(idx);
			break;
		}
		case MSG_SELECT_CARD: {
			uint32_t min = 0;
			std::memcpy(&min, m->p + 2, 4);
			std::vector<uint32_t> r{ 0, min };
			for(uint32_t i = 0; i < min; ++i) r.push_back(i);
			OCG_DuelSetResponse(d, r.data(), static_cast<uint32_t>(r.size() * 4));
			break;
		}
		case MSG_SELECT_CHAIN: answer32(m->size > 2 && m->p[2] != 0 ? 0 : -1); break;
		case MSG_SORT_CHAIN: { const uint8_t r[1] = { 0xFF }; OCG_DuelSetResponse(d, r, 1); break; }
		case MSG_SELECT_POSITION: answer32(POS_FACEUP_ATTACK); break;
		default: { char b[64]; std::snprintf(b, sizeof(b), "unhandled prompt %u", static_cast<unsigned>(m->id)); why = b; break; }
		}
		if(!why.empty()) break;
	}
	EXPECT(done, "%s: the duel did not reach turn 2: %s", sc.name, why.c_str());
	EXPECT(g_errors == 0, "%s: %ld Lua errors, first: %s", sc.name, g_errors, g_error_text.empty() ? "" : g_error_text[0].c_str());
	std::string seq;
	for(auto& x : g_atk) {
		std::string t = x;
		const auto sp = t.find(' ');
		if(sp != std::string::npos) t[sp] = '=';
		seq += (seq.empty() ? "" : " ") + t;
	}
	std::vector<int> lp;
	{ auto* pd = reinterpret_cast<duel*>(d); for(int s = 0; s < sc.n; ++s) lp.push_back(static_cast<int>(pd->game_field->player[s].lp)); }
	std::string lps;
	for(int v : lp) lps += (lps.empty() ? "" : " ") + std::to_string(v);
	EXPECT(seq == sc.seq, "%s: Duel.MPAttackedSeat() at the events gave \"%s\", want \"%s\"", sc.name, seq.c_str(), sc.seq);
	EXPECT(lp == sc.lp, "%s: the LP of the seats are \"%s\", want the ones of the scenario", sc.name, lps.c_str());
	EXPECT((sc.dpick >= 0) == (dpicks == 1) && dpicks <= 1, "%s: %d direct-attack picks, want %d", sc.name, dpicks, sc.dpick >= 0 ? 1 : 0);
	std::printf("%-16s n=%d events: %s  LP: %s  direct-attack picks=%d\n", sc.name, sc.n, seq.c_str(), lps.c_str(), dpicks);
	g_duel = nullptr;
	OCG_DestroyDuel(d);
}

int main(int argc, char** argv) {
	const std::string only = argc > 1 ? argv[1] : "";
	const std::vector<AScenario> attacks = {
		// name, n, teams, monsters (bit = seat), direct, direct pick seat, mode, events, LP
		{ "atk-direct-p1", 3, { 0, 1, 2 }, 0, 1, 1, "none", "ann=1 bstart=1 battled=1 dsend=1", { 8000, 6000, 8000 } },
		{ "atk-direct-p2", 3, { 0, 1, 2 }, 0, 1, 2, "none", "ann=2 bstart=2 battled=2 dsend=2", { 8000, 8000, 6000 } },
		{ "atk-direct-1op", 3, { 0, 1, 2 }, 2, 1, -1, "none", "ann=2 bstart=2 battled=2 dsend=2", { 8000, 8000, 6000 } },
		{ "atk-monster-p2", 3, { 0, 1, 2 }, 4, 0, -1, "none", "ann=2 bstart=2 battled=2 dsend=2", { 8000, 8000, 7000 } },
		{ "atk-direct-ffa4", 4, { 0, 1, 2, 3 }, 0, 1, 3, "none", "ann=3 bstart=3 battled=3 dsend=3", { 8000, 8000, 8000, 6000 } },
		{ "atk-direct-tag", 4, { 0, 1, 0, 1 }, 0, 1, 3, "none", "ann=3 bstart=3 battled=3 dsend=3", { 8000, 6000, 8000, 8000 } },
		{ "redir-toother", 3, { 0, 1, 2 }, 6, 0, -1, "toother", "ann=1 after=2 bstart=2 battled=2 dsend=2", { 8000, 8000, 7000 } },
		{ "redir-toother-tag", 4, { 0, 1, 0, 1 }, 10, 0, -1, "toother", "ann=1 after=3 bstart=3 battled=3 dsend=3", { 8000, 7000, 8000, 8000 } },
		{ "redir-tonil", 3, { 0, 1, 2 }, 6, 0, -1, "tonil", "ann=1 after=1 bstart=1 battled=1 dsend=1", { 8000, 6000, 8000 } },
		{ "redir-tonil-tag", 4, { 0, 1, 0, 1 }, 10, 0, -1, "tonil", "ann=1 after=1 bstart=1 battled=1 dsend=1", { 8000, 6000, 8000, 8000 } },
		{ "redir-negate", 3, { 0, 1, 2 }, 6, 0, -1, "negate", "ann=1 disabled=1 negated=1", { 8000, 8000, 8000 } },
		{ "redir-chain", 3, { 0, 1, 2 }, 6, 0, -1, "chain", "ann=1 bstart=1 battled=1 dsend=1 ann=2 bstart=2 battled=2 dsend=2", { 8000, 7000, 7000 } },
		{ "redir-chain-ffa4", 4, { 0, 1, 2, 3 }, 6, 0, -1, "chain", "ann=1 bstart=1 battled=1 dsend=1 ann=2 bstart=2 battled=2 dsend=2", { 8000, 7000, 7000, 8000 } },
		{ "redir-leave", 3, { 0, 1, 2 }, 2, 0, -1, "leave", "ann=1 bstart=1 left=1 dsend=1", { 8000, 8000, 8000 } },
	};
	for(const auto& sc : attacks) {
		if(!only.empty() && only != sc.name) continue;
		run_attack(sc);
	}
	if(failures) { std::printf("FAIL attacked-seat: %d failure(s)\n", failures); return 1; }
	std::printf("PASS attacked-seat\n");
	return 0;
}
