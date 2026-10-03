// FX10 native check: summon sites in operations.cpp / processor.cpp at n_duelists == 3, pass loop after a late elimination,
// one battle site. Each mode prints what it saw and a line "RESULT <mode> PASS|FAIL". A trap build aborts with
// "YGO_N_TRAP opponent_of file:line" when the code calls opponent_of at n > 2 (the "before" proof for the trap modes).
//   chooser  EFFECT_OPPO_CHOOSES_SPSUMMON_ZONE at seat 0 (n=3): the chooser of the zone must be seat 1
//   oath     old-rule flags and MR1-MR4 are refused in FFA3, FFA4 and Tag; stock oath counters at n=2
//   faceup   DUEL_1_FACEUP_FIELD (n=3): a Field Spell is activated, the Field Spells of the other seats go
//   pass     synthetic site check: ChangePos at n=3 (MR4 without the old-rule flags): seat 0 done, seat 0 eliminated at the prompt of seat 1; seat 2 must still get its pass
//   battle   a direct attack of seat 0 against seat 1 (n=3): the battle damage
//   orange   summon procedures with EFFECT_FLAG_SPSUM_PARAM and o_range (n=3): seat 0 cannot summon onto seat 1, so the
//            monster must go to seat 2 (Normal Summon and Special Summon procedure). Needs the card.cpp of FX7 (base7|fix7).
//   discard  Duel.DiscardDeck with a player that is not a duelist (7, 254) at n=3: no trap, no read out of range, result 0
//   all      every mode above except orange; orange has its own checks.tsv row
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <map>
#include <string>
#include <vector>
#include "ocgapi.h"
#include "ocgapi_constants.h"
#include "effect_constants.h"
#include "duel.h"
#include "field.h"
#include "common.h"


static std::map<uint32_t, std::string> g_scripts;
static std::vector<std::string> g_log;

static void read_card(void*, uint32_t code, OCG_CardData* data) {
	std::memset(data, 0, sizeof(*data));
	data->code = code;
	switch(code) {
	case 119: data->type = TYPE_SPELL | TYPE_CONTINUOUS; break;                // seat 0 cannot summon onto the field of seat 1
	case 118: case 120: data->type = TYPE_MONSTER | TYPE_EFFECT; break;       // summon procedures with o_range
	case 110: case 112: case 117: case 121: data->type = TYPE_SPELL; break;               // Spells that are activated from the hand               // Spells that are activated from the hand
	case 113: case 114: data->type = TYPE_SPELL | TYPE_FIELD; break;           // Field Spells
	case 116: data->type = TYPE_SPELL | TYPE_CONTINUOUS; break;                // S/T zone filler
	case 115: data->type = TYPE_MONSTER | TYPE_NORMAL | 0x100 /*TYPE_TRAPMONSTER*/; break;
	default:  data->type = TYPE_MONSTER | TYPE_NORMAL; break;
	}
	if(data->type & TYPE_MONSTER) {
		data->level = (code == 118 || code == 120) ? 5 : 4;
		data->attribute = 1;
		data->race = 1;
		data->attack = 1000;
		data->defense = 1000;
	}
}
static int read_script(void*, OCG_Duel d, const char* name) {
	const char* base = std::strrchr(name, '/');
	base = base ? base + 1 : name;
	unsigned code = 0;
	if(std::sscanf(base, "c%u.lua", &code) != 1)
		return 0;
	auto it = g_scripts.find(code);
	if(it == g_scripts.end())
		return 0;
	return OCG_LoadScript(d, it->second.data(), static_cast<uint32_t>(it->second.size()), name);
}
static void on_log(void*, const char* text, int type) {
	g_log.push_back(text ? text : "");
	if(std::getenv("CHECK_LOG"))
		std::fprintf(stderr, "core log [%d]: %s\n", type, text ? text : "");
}
static std::string prelude() {
	char b[1024];
	std::snprintf(b, sizeof(b),
	              "EFFECT_TYPE_ACTIVATE=%d EFFECT_TYPE_FIELD=%d EVENT_FREE_CHAIN=%d LOCATION_HAND=%d LOCATION_MZONE=%d\n"
	              "EFFECT_FLAG_PLAYER_TARGET=%d EFFECT_OPPO_CHOOSES_SPSUMMON_ZONE=%d POS_FACEUP_ATTACK=%d POS_FACEDOWN_DEFENSE=%d\n"
	              "REASON_EFFECT=%d CATEGORY_SPECIAL_SUMMON=%d PLAYER_ALL=%d\n",
	              EFFECT_TYPE_ACTIVATE, EFFECT_TYPE_FIELD, EVENT_FREE_CHAIN, LOCATION_HAND, LOCATION_MZONE,
	              static_cast<int>(EFFECT_FLAG_PLAYER_TARGET), EFFECT_OPPO_CHOOSES_SPSUMMON_ZONE, POS_FACEUP_ATTACK, POS_FACEDOWN_DEFENSE,
	              REASON_EFFECT, 0x200, PLAYER_ALL);
	std::string r = b;
	char c[512];
	std::snprintf(c, sizeof(c),
	              "EFFECT_TYPE_SINGLE=%d LOCATION_SZONE=%d EFFECT_CANNOT_SUMMON=%d EFFECT_CANNOT_SPECIAL_SUMMON=%d EFFECT_SUMMON_PROC=%d\n"
	              "EFFECT_SPSUMMON_PROC=%d EFFECT_FLAG_SPSUM_PARAM=%d EFFECT_TYPE_CONTINUOUS=%d EVENT_CHAIN_END=%d\n",
	              EFFECT_TYPE_SINGLE, LOCATION_SZONE, EFFECT_CANNOT_SUMMON, EFFECT_CANNOT_SPECIAL_SUMMON, EFFECT_SUMMON_PROC,
	              EFFECT_SPSUMMON_PROC, static_cast<int>(EFFECT_FLAG_SPSUM_PARAM), EFFECT_TYPE_CONTINUOUS, EVENT_CHAIN_END);
	return r + c;
}
static std::string activate_spell(unsigned code, const std::string& target_fn, const std::string& op_fn) {
	return "function c" + std::to_string(code) + ".initial_effect(c)\n local e1=Effect.CreateEffect(c)\n"
	       " e1:SetType(EFFECT_TYPE_ACTIVATE)\n e1:SetCode(EVENT_FREE_CHAIN)\n" +
	       (target_fn.empty() ? "" : " e1:SetTarget(" + target_fn + ")\n") + " e1:SetOperation(" + op_fn + ")\n c:RegisterEffect(e1)\nend\n";
}
// The target player is a Lua side in this callback. MPSeat reads its bound real seat.
static const char* kRestrict =
    "function c119.initial_effect(c)\n"
    " for _,code in ipairs({EFFECT_CANNOT_SUMMON,EFFECT_CANNOT_SPECIAL_SUMMON}) do\n"
    "  local e1=Effect.CreateEffect(c) e1:SetType(EFFECT_TYPE_FIELD) e1:SetCode(code) e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET)\n"
    "  e1:SetRange(LOCATION_SZONE) e1:SetTargetRange(1,0)\n"
    "  e1:SetTarget(function(e,c,sump,sumtype,sumpos,targetp) return Duel.MPSeat(targetp)==1 end) c:RegisterEffect(e1)\n"
    " end\n"
    "end\n";
static std::string summon_proc(unsigned code, const char* proc_code, const char* type, bool with_condition = false) {
	return "function c" + std::to_string(code) + ".initial_effect(c)\n local e1=Effect.CreateEffect(c) e1:SetType(" + std::string(type) + ")\n"
	       " e1:SetCode(" + proc_code + ") e1:SetProperty(EFFECT_FLAG_SPSUM_PARAM) e1:SetTargetRange(POS_FACEUP_ATTACK,1)\n"
	       " e1:SetRange(LOCATION_HAND)\n" +
	       (with_condition ? " e1:SetCondition(function() return true end)\n" : "") + " c:RegisterEffect(e1)\nend\n";
}
static void init_scripts() {
	// 110: registers EFFECT_OPPO_CHOOSES_SPSUMMON_ZONE for its owner, then summons a 111 from its hand to its own field.
	g_scripts[110] = activate_spell(110, "",
	    "function(e,tp) local e2=Effect.CreateEffect(e:GetHandler()) e2:SetType(EFFECT_TYPE_FIELD)"
	    " e2:SetCode(EFFECT_OPPO_CHOOSES_SPSUMMON_ZONE) e2:SetProperty(EFFECT_FLAG_PLAYER_TARGET) e2:SetTargetRange(1,0)"
	    " Duel.RegisterEffect(e2,tp)"
	    " local tc=Duel.GetFirstMatchingCard(function(c) return c:IsCode(111) end,tp,LOCATION_HAND,0,nil)"
	    " Debug.Message('c110 summon '..Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP_ATTACK)) end");
	// 112: a two-seat chain link with CATEGORY_SPECIAL_SUMMON and symbolic PLAYER_ALL for exactly 2 cards.
	g_scripts[112] = activate_spell(112,
	    "function(e,tp,eg,ep,ev,re,r,rp,chk) if chk==0 then return true end"
	    " local g=Duel.GetFieldGroup(tp,LOCATION_HAND,0):Filter(function(c) return c:IsCode(111) end,nil)"
	    " Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,g,2,PLAYER_ALL,0) end",
	    "function(e,tp) Debug.Message('c112 resolves') end");
	// 114: a Field Spell that is activated from the hand. 113 is the face-up Field Spell on the other fields.
	g_scripts[114] = activate_spell(114, "", "function(e,tp) Debug.Message('c114 resolves') end");
	// 117: R-COMMON-ALL-BOTH. Both location arguments include every field in a card scope.
	g_scripts[117] = activate_spell(117, "",
	    "function(e,tp) local g=Duel.GetMatchingGroup(function(c) return c:IsCode(115) end,tp,LOCATION_MZONE,LOCATION_MZONE,nil)"
	    " Debug.Message('c117 group '..g:GetCount()) Debug.Message('c117 change '..Duel.ChangePosition(g,POS_FACEDOWN_DEFENSE)) end");
	// 121: DiscardDeck for a seat above the table, for PLAYER_ALL and for the own seat.
	g_scripts[121] = activate_spell(121, "",
	    "function(e,tp) Debug.Message('c121 seat7 '..Duel.DiscardDeck(7,1,REASON_EFFECT))"
	    " Debug.Message('c121 all '..Duel.DiscardDeck(254,1,REASON_EFFECT))"
	    " Debug.Message('c121 own '..Duel.DiscardDeck(tp,1,REASON_EFFECT)) end");
	g_scripts[119] = kRestrict;
	g_scripts[118] = summon_proc(118, "EFFECT_SUMMON_PROC", "EFFECT_TYPE_SINGLE");
	g_scripts[120] = summon_proc(120, "EFFECT_SPSUMMON_PROC", "EFFECT_TYPE_FIELD");
}
static OCG_Duel make_duel(uint64_t flags) {
	OCG_DuelOptions options;
	std::memset(&options, 0, sizeof(options));
	options.seed[0] = 1; options.seed[1] = 2; options.seed[2] = 3; options.seed[3] = 4;
	options.flags = flags;
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
static void add_cards(OCG_Duel d, uint8_t seat, uint32_t loc, int count, uint32_t code, uint32_t pos = POS_FACEDOWN_DEFENSE, uint32_t seq0 = 0) {
	for(int i = 0; i < count; ++i) {
		OCG_NewCardInfo info;
		std::memset(&info, 0, sizeof(info));
		info.team = seat;
		info.duelist = 0;
		info.code = code;
		info.con = seat;
		info.loc = loc;
		info.seq = seq0 + i;
		info.pos = pos;
		OCG_DuelNewCard(d, &info);
	}
}
struct Setup {
	std::vector<std::vector<uint32_t>> hand;                                      // extra hand codes per seat
	std::vector<std::vector<std::pair<uint32_t, uint32_t>>> mzone;                // (code, count) face-up attack per seat
	std::vector<std::vector<std::pair<uint32_t, uint32_t>>> szone;                // (code, count) face-up per seat
};
// One setup path for two-seat and FFA3 duels, with 40 filler cards per seat.
static OCG_Duel make_seats(uint64_t flags, const Setup& s, uint8_t n, const char* setup_lua, uint64_t late_flags = 0) {
	OCG_Duel d = make_duel(flags);
	if((setup_lua && !run_lua(d, setup_lua)) || !run_lua(d, prelude())) {
		std::printf("FAIL: setup\n");
		std::exit(2);
	}
	for(uint8_t seat = 0; seat < n; ++seat) {
		add_cards(d, seat, LOCATION_DECK, 40, 1);
		if(seat < s.hand.size())
			for(uint32_t code : s.hand[seat])
				add_cards(d, seat, LOCATION_HAND, 1, code);
		if(seat < s.mzone.size()) {
			uint32_t seq = 0;
			for(auto& [code, count] : s.mzone[seat]) {
				add_cards(d, seat, LOCATION_MZONE, static_cast<int>(count), code, POS_FACEUP_ATTACK, seq);
				seq += count;
			}
		}
		if(seat < s.szone.size()) {
			uint32_t seq = 0;
			for(auto& [code, count] : s.szone[seat]) {
				add_cards(d, seat, LOCATION_SZONE, static_cast<int>(count), code, POS_FACEUP, (code == 113) ? 5 : seq);
				seq += count;
			}
		}
	}
	// Debug.SetupDuelists refuses the old-rule flags at n > 2 (their code paths are not supported), so they are set after it.
	F(d).core.duel_options |= late_flags;
	OCG_StartDuel(d);
	return d;
}
// An FFA3 duel: each seat has its own team.
static OCG_Duel make_ffa3(uint64_t flags, const Setup& s, uint64_t late_flags = 0) {
	return make_seats(flags, s, 3, "Debug.SetupDuelists(3,0,1,2)", late_flags);
}
struct Msg { uint8_t id; uint8_t b1; uint8_t b2; std::vector<uint8_t> raw; };
static int advance(OCG_Duel d, std::vector<Msg>& msgs) {
	msgs.clear();
	const int status = OCG_DuelProcess(d);
	uint32_t length = 0;
	const auto* buf = static_cast<const uint8_t*>(OCG_DuelGetMessage(d, &length));
	for(uint32_t off = 0; off + 4 <= length;) {
		uint32_t size = 0;
		std::memcpy(&size, buf + off, 4);
		if(size > 0)
			msgs.push_back({buf[off + 4], size > 1 ? buf[off + 5] : uint8_t(0), size > 2 ? buf[off + 6] : uint8_t(0), std::vector<uint8_t>(buf + off + 4, buf + off + 4 + size)});
		off += 4 + size;
	}
	return status;
}
static void answer_i32(OCG_Duel d, int32_t v) { OCG_DuelSetResponse(d, &v, sizeof(v)); }
static void answer_u32(OCG_Duel d, uint32_t v) { OCG_DuelSetResponse(d, &v, sizeof(v)); }
static void answer_place(OCG_Duel d, uint8_t field_owner, uint8_t loc, uint8_t seq) {
	const uint8_t place[3] = {field_owner, loc, seq};
	OCG_DuelSetResponse(d, place, sizeof(place));
}
// SELECT_CARD answer: the first n cards (type 2 = u8 indexes).
static void answer_cards(OCG_Duel d, uint32_t n) {
	uint8_t buf[8 + 8]{};
	const int32_t type = 2;
	std::memcpy(buf, &type, 4);
	std::memcpy(buf + 4, &n, 4);
	for(uint32_t i = 0; i < n; ++i)
		buf[8 + i] = static_cast<uint8_t>(i);
	OCG_DuelSetResponse(d, buf, 8 + n);
}
static std::string seats(const std::vector<int>& v) {
	std::string s;
	for(size_t i = 0; i < v.size(); ++i)
		s += (i ? " " : "") + std::to_string(v[i]);
	return s.empty() ? "(none)" : s;
}
static bool logged(const std::string& needle) {
	for(auto& l : g_log)
		if(l.find(needle) != std::string::npos)
			return true;
	return false;
}
static const char* loc_name(uint32_t loc) {
	switch(loc) {
	case LOCATION_HAND: return "hand";
	case LOCATION_MZONE: return "mzone";
	case LOCATION_SZONE: return "szone";
	case LOCATION_GRAVE: return "grave";
	case LOCATION_DECK: return "deck";
	default: return "other";
	}
}
// Plays a duel: the turn player (seat 0) activates the first spell in its hand (idle cmd 5, index 0), every other prompt gets
// `on_prompt` (return true when it answered) or the default answer. Stops at the next idle prompt after the chain is done.
struct Play {
	std::vector<int> place_seats;  // seat of each SELECT_PLACE
	std::vector<int> card_seats;   // seat of each SELECT_CARD
	bool activated = false;
	bool done = false;
	int place_hint = -1;
	int place_hint_player = -1;
};
template<typename F>
static void play(OCG_Duel d, Play& p, F&& on_prompt, uint32_t activate_cmd = 5) {
	std::vector<Msg> msgs;
	bool in_chain = false;
	for(int steps = 0; steps < 6000 && !p.done; ++steps) {
		const int status = advance(d, msgs);
		for(const auto& m : msgs) {
			if(m.id == MSG_HINT && m.raw.size() >= 11 && m.raw[1] == HINT_PLACE_SEAT) {
				uint64_t seat = 0;
				std::memcpy(&seat, m.raw.data() + 3, 8);
				p.place_hint = static_cast<int>(seat);
				p.place_hint_player = m.raw[2];
			}
			if(m.id == MSG_CHAINING)
				in_chain = true;
			if(m.id == MSG_CHAIN_END)
				in_chain = false;
		}
		if(status == OCG_DUEL_STATUS_END)
			break;
		if(status != OCG_DUEL_STATUS_AWAITING)
			continue;
		const Msg last = msgs.back();
		if(std::getenv("CHECK_TRACE")) {
			std::fprintf(stderr, "prompt id=%d b1=%d (%zu msgs; before: %d) raw:", last.id, last.b1, msgs.size(), msgs.size() > 1 ? msgs[msgs.size() - 2].id : -1);
			for(size_t i = 0; i < last.raw.size() && i < 400; ++i)
				std::fprintf(stderr, " %02x", last.raw[i]);
			std::fprintf(stderr, "\n");
		}
		if(last.id == MSG_SELECT_IDLECMD && last.b1 == 0 && !p.activated) {
			if(on_prompt(last))
				continue;
			p.activated = true;
			answer_u32(d, (0u << 16) | activate_cmd);
			continue;
		}
		if(p.activated && !in_chain && last.id == MSG_SELECT_IDLECMD) {
			p.done = true;
			break;
		}
		if(last.id == MSG_SELECT_PLACE)
			p.place_seats.push_back(last.b1);
		if(last.id == MSG_SELECT_CARD)
			p.card_seats.push_back(last.b1);
		if(on_prompt(last))
			continue;
		if(last.id == MSG_SELECT_CHAIN)
			answer_i32(d, -1);
		else if(last.id == MSG_SELECT_IDLECMD)
			answer_u32(d, 7);
		else if(last.id == MSG_SELECT_PLACE)
			answer_place(d, last.b1, LOCATION_SZONE, 0);
		else if(last.id == MSG_SELECT_EFFECTYN || last.id == MSG_SELECT_YESNO)
			answer_i32(d, 0);
		else {
			std::printf("stop: prompt %d not handled\n", last.id);
			break;
		}
	}
}
static std::string where(OCG_Duel d, uint8_t seat, uint32_t code) {
	auto& f = F(d);
	for(uint32_t loc : {LOCATION_MZONE, LOCATION_SZONE, LOCATION_GRAVE, LOCATION_HAND, LOCATION_DECK}) {
		for(card* c : (loc == LOCATION_MZONE ? f.player[seat].list_mzone : loc == LOCATION_SZONE ? f.player[seat].list_szone :
		               loc == LOCATION_GRAVE ? f.player[seat].list_grave : loc == LOCATION_HAND ? f.player[seat].list_hand : f.player[seat].list_main)) {
			if(c && c->data.code == code)
				return std::string(loc_name(loc));
		}
	}
	return "gone";
}
static int count_in(OCG_Duel d, uint8_t seat, uint32_t loc, uint32_t code) {
	auto& f = F(d);
	int n = 0;
	for(card* c : (loc == LOCATION_MZONE ? f.player[seat].list_mzone : loc == LOCATION_SZONE ? f.player[seat].list_szone :
	               loc == LOCATION_GRAVE ? f.player[seat].list_grave : f.player[seat].list_hand))
		if(c && c->data.code == code)
			++n;
	return n;
}

// ---- chooser: EFFECT_OPPO_CHOOSES_SPSUMMON_ZONE
static void mode_chooser() {
	Setup s;
	s.hand = {{110, 111}, {}, {}};
	OCG_Duel d = make_ffa3(DUEL_MODE_MR5, s);
	Play p;
	std::vector<int> choosers;
	play(d, p, [&](const Msg& m) {
		if(m.id == MSG_SELECT_PLACE && p.activated) {
			choosers.push_back(m.b1);
			// the first prompt is the Spell zone of seat 0; a prompt for another seat is the zone of the summon
			if(m.b1 != 0) {
				answer_place(d, 0, LOCATION_MZONE, 0);
				return true;
			}
		}
		return false;
	});
	std::printf("n=3, seat 0 summons with EFFECT_OPPO_CHOOSES_SPSUMMON_ZONE. SELECT_PLACE seats: %s (want 0 then 1)\n", seats(choosers).c_str());
	const std::vector<int> want{0, 1};
	EXPECT(choosers == want, "SELECT_PLACE seats %s", seats(choosers).c_str());
	EXPECT(logged("c110 summon 1"), "the summon did not work");
	std::printf("  monster 111 of seat 0 is in: %s\n", where(d, 0, 111).c_str());
	std::printf("RESULT chooser %s\n", choosers == want ? "PASS" : "FAIL");
	OCG_DestroyDuel(d);
}

// ---- oath: stock two-seat counters and refused multi-seat flags
static void mode_oath_n2() {
	g_log.clear();
	Setup s;
	s.hand = {{112, 111, 111}, {}};
	// No Debug.SetupDuelists call: this is the stock two-seat setup.
	OCG_Duel d = make_seats(DUEL_MODE_MR4, s, 2, nullptr);
	Play p;
	std::vector<int> counts;
	bool sampled = false;
	play(d, p, [&](const Msg& m) {
		if(m.id == MSG_SELECT_CHAIN && p.activated && !sampled) {
			sampled = true;
			for(int q = 0; q < 2; ++q)
				counts.push_back(static_cast<int>(F(d).core.spsummon_state_count[q]));
		}
		return false;
	});
	std::printf("n=2, MR4, seat 0 chains CATEGORY_SPECIAL_SUMMON(PLAYER_ALL, 2 cards). Open-chain counters: %s (want both >= 1)\n",
	            seats(counts).c_str());
	EXPECT(sampled, "no prompt with the chain open");
	bool ok = sampled && p.done && logged("c112 resolves");
	if(sampled) {
		EXPECT(counts[0] >= 1, "seat 0 counter %d", counts[0]);
		EXPECT(counts[1] >= 1, "seat 1 counter %d", counts[1]);
		ok = ok && counts[0] >= 1 && counts[1] >= 1;
	}
	EXPECT(p.done && logged("c112 resolves"), "the link did not finish");
	std::printf("RESULT oath-n2 %s\n", ok ? "PASS" : "FAIL");
	OCG_DestroyDuel(d);
}
static void mode_oath() {
	struct Layout { const char* name; const char* lua; } layouts[] = {
	    {"FFA3", "Debug.SetupDuelists(3,0,1,2)"},
	    {"FFA4", "Debug.SetupDuelists(4,0,1,2,3)"},
	    {"Tag", "Debug.SetupDuelists(4,0,1,0,1)"}};
	struct Flag { uint64_t flags; const char* name; const char* label; } flags[] = {
	    {DUEL_MODE_MR5 | DUEL_CANNOT_SUMMON_OATH_OLD, "DUEL_CANNOT_SUMMON_OATH_OLD", "OATH_OLD"},
	    {DUEL_MODE_MR5 | DUEL_SPSUMMON_ONCE_OLD_NEGATE, "DUEL_SPSUMMON_ONCE_OLD_NEGATE", "ONCE_OLD_NEGATE"},
	    {DUEL_MODE_MR5 | DUEL_1_FACEUP_FIELD, "DUEL_1_FACEUP_FIELD", "1_FACEUP_FIELD"},
	    {DUEL_MODE_MR1, nullptr, "MR1"}, {DUEL_MODE_MR2, nullptr, "MR2"},
	    {DUEL_MODE_MR3, nullptr, "MR3"}, {DUEL_MODE_MR4, nullptr, "MR4"}};
	bool ok = true;
	for(const auto& l : layouts)
		for(const auto& fl : flags) {
			g_log.clear();
			OCG_Duel d = make_duel(fl.flags);
			const bool ran = run_lua(d, l.lua);
			const bool msg = logged("is not supported with more than 2 duelists") && (!fl.name || logged(fl.name));
			EXPECT(!ran, "%s with %s: setup must fail", l.name, fl.label);
			EXPECT(msg, "%s with %s: refusal message", l.name, fl.label);
			EXPECT(F(d).n_duelists == 2, "%s with %s: state must stay at 2 duelists", l.name, fl.label);
			const bool refused = !ran && msg && F(d).n_duelists == 2;
			ok = ok && refused;
			std::printf("DATA oath-refused %s %s: refused=%d n=%d\n", l.name, fl.label, refused, F(d).n_duelists);
			OCG_DestroyDuel(d);
		}
	std::printf("RESULT oath-refused %s\n", ok ? "PASS" : "FAIL");
	mode_oath_n2();
}

// ---- faceup: DUEL_1_FACEUP_FIELD
// Synthetic site check: this mode forces a flag that Debug.SetupDuelists refuses at n > 2.
static void mode_faceup() {
	Setup s;
	s.hand = {{114}, {}, {}};
	s.szone = {{}, {{113, 1}}, {{113, 1}}};
	OCG_Duel d = make_ffa3(DUEL_MODE_MR5, s, DUEL_1_FACEUP_FIELD);
	Play p;
	play(d, p, [&](const Msg&) { return false; });
	const std::string w1 = where(d, 1, 113), w2 = where(d, 2, 113);
	std::printf("n=3, DUEL_1_FACEUP_FIELD, seat 0 activates a Field Spell. Face-up Field Spell 113 of seat 1: %s, of seat 2: %s (want grave grave)\n", w1.c_str(), w2.c_str());
	EXPECT(logged("c114 resolves"), "the Field Spell did not resolve");
	EXPECT(w1 == "grave" && w2 == "grave", "other Field Spells %s %s", w1.c_str(), w2.c_str());
	std::printf("RESULT faceup %s\n", (w1 == "grave" && w2 == "grave" && logged("c114 resolves")) ? "PASS" : "FAIL");
	OCG_DestroyDuel(d);
}

// ---- pass: ChangePos pass loop, late elimination
// Synthetic site check: these MR4-like flags at n=3 are not a product MR5 duel.
static void mode_pass() {
	Setup s;
	s.hand = {{117}, {}, {}};
	s.mzone = {{{115, 2}}, {{115, 2}}, {{115, 1}}};
	s.szone = {{{116, 3}}, {{116, 4}}, {{116, 5}}};
	OCG_Duel d = make_ffa3(DUEL_PZONE | DUEL_EMZONE | DUEL_RETURN_TO_DECK_TRIGGERS, s);
	Play p;
	bool killed = false;
	play(d, p, [&](const Msg& m) {
		if(m.id == MSG_SELECT_PLACE) {
			answer_place(d, m.b1, LOCATION_SZONE, 3); // seq 0..2 hold the fillers
			return true;
		}
		if(m.id == MSG_SELECT_CARD) {
			if(m.b1 == 1 && !killed) {
				F(d).player[0].eliminated = true; // seat 0 passed already; it is eliminated while seat 1 chooses
				killed = true;
			}
			answer_cards(d, 1);
			return true;
		}
		return false;
	});
	std::printf("n=3, seat 0 changes the Trap Monsters of all seats to face-down; free S/T zones: seat 0 -> 1, seat 1 -> 1, seat 2 -> 0.\n");
	std::printf("  SELECT_CARD seats: %s (want 0 1); seat 0 eliminated at the prompt of seat 1: %s\n", seats(p.card_seats).c_str(), killed ? "yes" : "no");
	const std::string w2 = where(d, 2, 115);
	std::printf("  Trap Monster 115 of seat 2 after the change: %s (want grave: it has no free S/T zone, so it is sent to the grave at its pass)\n", w2.c_str());
	std::printf("  Trap Monsters in grave: seat 0 %d, seat 1 %d, seat 2 %d\n", count_in(d, 0, LOCATION_GRAVE, 115), count_in(d, 1, LOCATION_GRAVE, 115),
	            count_in(d, 2, LOCATION_GRAVE, 115));
	const std::vector<int> want{0, 1};
	bool ok = p.card_seats == want && killed && w2 == "grave" && p.done && logged("c117 group 5");
	EXPECT(p.card_seats == want, "SELECT_CARD seats %s", seats(p.card_seats).c_str());
	EXPECT(killed, "seat 1 never chose");
	EXPECT(w2 == "grave", "seat 2 got no pass (115 is %s)", w2.c_str());
	EXPECT(p.done && logged("c117 group 5"), "all five Trap Monsters were read and the effect finished");
	// This fixture tests the pass loop. It sets the loss flag without elimination cleanup.
	for(int q = 0; q < 3; ++q) {
		const bool one = count_in(d, q, LOCATION_GRAVE, 115) == 1;
		EXPECT(one, "seat %d: one Trap Monster must go to the Graveyard", q);
		ok = ok && one;
	}
	std::printf("RESULT pass %s\n", ok ? "PASS" : "FAIL");
	OCG_DestroyDuel(d);
}

// ---- battle: a direct attack at n=3
static void mode_battle() {
	Setup s;
	s.mzone = {{{111, 1}}, {}, {}};
	OCG_Duel d = make_ffa3(DUEL_MODE_MR5, s);
	auto& f = F(d);
	f.infos.turn_id = 5;
	for(auto& t : f.infos.turn_id_by_player)
		t = 2;
	std::vector<Msg> msgs;
	int stage = 0;
	for(int steps = 0; steps < 4000 && stage < 5; ++steps) {
		const int status = advance(d, msgs);
		if(status == OCG_DUEL_STATUS_END)
			break;
		if(status != OCG_DUEL_STATUS_AWAITING)
			continue;
		const Msg last = msgs.back();
		if(last.id == MSG_SELECT_IDLECMD && last.b1 == 0 && stage == 0) {
			stage = 1;
			answer_u32(d, 6); // to the Battle Phase
		} else if(last.id == MSG_SELECT_BATTLECMD && stage == 1) {
			stage = 2;
			answer_u32(d, 1); // attack with the first attacker
		} else if(last.id == MSG_SELECT_OPTION) {
			answer_i32(d, 0); // the duelist to attack: the first one offered
		} else if(last.id == MSG_SELECT_CHAIN) {
			answer_i32(d, -1);
		} else if(last.id == MSG_SELECT_BATTLECMD && stage == 2) {
			stage = 5; // back at the battle command after the attack
		} else if(last.id == MSG_SELECT_EFFECTYN || last.id == MSG_SELECT_YESNO) {
			answer_i32(d, 0);
		} else {
			std::printf("stop: prompt %d (stage %d) not handled\n", last.id, stage);
			break;
		}
	}
	const int lp1 = f.player[1].lp, lp2 = f.player[2].lp;
	std::printf("n=3, seat 0 attacks directly. LP seat 1 %d, seat 2 %d (one of them must be 7000, the other 8000)\n", lp1, lp2);
	const bool ok = (lp1 == 7000 && lp2 == 8000) || (lp1 == 8000 && lp2 == 7000);
	EXPECT(ok, "battle damage LP %d %d", lp1, lp2);
	std::printf("RESULT battle %s\n", ok ? "PASS" : "FAIL");
	OCG_DestroyDuel(d);
}

// ---- orange: a summon procedure with o_range, seat 0 cannot summon onto seat 1
static void orange_one(const char* label, uint32_t code, uint32_t idle_cmd, bool with_condition = false, bool restricted = true, bool outer_reason = false, bool tag = false) {
	const int destination = tag ? 3 : 2;
	const int seat_count = tag ? 4 : 3;
	const int before = failures;
	g_log.clear();
	const std::string saved_script = g_scripts.at(code);
	const std::string saved_outer = g_scripts[110], saved_restrict = g_scripts[119];
	if(with_condition)
		g_scripts[code] = summon_proc(code, idle_cmd == 0 ? "EFFECT_SUMMON_PROC" : "EFFECT_SPSUMMON_PROC",
		    idle_cmd == 0 ? "EFFECT_TYPE_SINGLE" : "EFFECT_TYPE_FIELD", true);
	if(outer_reason) {
		// The restriction permits seat 2 only when se is the outer continuous effect.
		// Passing the procedure effect removes a legal seat and stops this summon.
		g_scripts[119] =
		    "function c119.initial_effect(c) local e=Effect.CreateEffect(c)"
		    " e:SetType(EFFECT_TYPE_FIELD) e:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)"
		    " e:SetProperty(EFFECT_FLAG_PLAYER_TARGET) e:SetRange(LOCATION_SZONE) e:SetTargetRange(1,0)"
		    " e:SetTarget(function(e,c,sp,st,pos,tp,se)"
		    " local code=se and se:GetHandler():GetCode() or 0"
		    " Debug.Message('orange outer reason '..code)"
		    " return code~=110 or Duel.MPSeat(tp)==1 end) c:RegisterEffect(e) end";
		// Run after the activation chain. A rule summon inside an activation chain is
		// deferred until that chain ends, when the activation reason has been cleared.
		g_scripts[110] = activate_spell(110, "",
		    "function(e,tp) local e2=Effect.CreateEffect(e:GetHandler())"
		    " e2:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS) e2:SetCode(EVENT_CHAIN_END) e2:SetCountLimit(1)"
		    " e2:SetOperation(function(e,tp)"
		    " local c=Duel.GetFirstMatchingCard(function(c) return c:IsCode(120) end,tp,LOCATION_HAND,0,nil)"
		    " local ok=c:IsSpecialSummonable(0) Debug.Message('orange outer eligible '..tostring(ok))"
		    " if ok then Duel.SpecialSummonRule(tp,c,0) end end) Duel.RegisterEffect(e2,tp) end");
	}
	if(tag && restricted)
		// Global effects receive real seat parameters. Tag MPSeat returns a team.
		g_scripts[119] =
		    "function c119.initial_effect(c) for _,code in ipairs({EFFECT_CANNOT_SUMMON,EFFECT_CANNOT_SPECIAL_SUMMON}) do"
		    " local e=Effect.GlobalEffect() e:SetType(EFFECT_TYPE_FIELD) e:SetCode(code)"
		    " e:SetProperty(EFFECT_FLAG_PLAYER_TARGET) e:SetTargetRange(1,0)"
		    " e:SetTarget(function(e,c,sp,st,pos,targetp) return targetp==1 end) Duel.RegisterEffect(e,0) end end";
	Setup s;
	s.hand = {{code}, {}, {}};
	if(outer_reason)
		s.hand[0].push_back(110);
	if(restricted)
		s.szone = {{{119, 1}}, {}, {}};
	if(tag)
		s.hand = {{code}, {122}, {123}, {124}};
	OCG_Duel d = tag ? make_seats(DUEL_MODE_MR5, s, 4, "Debug.SetupDuelists(4,0,1,0,1)") : make_ffa3(DUEL_MODE_MR5, s);
	// Check the fixture before the command. The control permits both opponents.
	card* target = nullptr;
	for(card* c : F(d).player[0].list_hand)
		if(c && c->data.code == code)
			target = c;
	EXPECT(target, "%s: the test card is absent from the hand", label);
	if(target && !outer_reason) {
		const bool blocked = idle_cmd == 0 ? !F(d).is_player_can_summon(0, 0, target, 1) :
		    !F(d).is_player_can_spsummon(nullptr, 0, POS_FACEUP_ATTACK, 0, 1, target);
		const bool free = idle_cmd == 0 ? F(d).is_player_can_summon(0, 0, target, destination) :
		    F(d).is_player_can_spsummon(nullptr, 0, POS_FACEUP_ATTACK, 0, destination, target);
		EXPECT(blocked == restricted && free, "%s: seat 1 blocked=%d (want %d), seat %d free=%d", label, blocked, restricted, destination, free);
	}
	Play p;
	int picked = -1, pick_count = 0;
	bool place_seen = false, blocked_offered = false;
	std::vector<int> offered, hints;
	play(d, p, [&](const Msg& m) {
		if(!outer_reason && m.id == MSG_SELECT_IDLECMD && m.b1 == 0 && !p.activated) {
			// Read the two summon lists. Each entry has code, controller, location and sequence.
			size_t off = 2;
			int index = -1;
			for(uint32_t cmd = 0; cmd <= idle_cmd; ++cmd) {
				if(off + 4 > m.raw.size())
					break;
				uint32_t count = 0;
				std::memcpy(&count, m.raw.data() + off, 4);
				off += 4;
				if(count > (m.raw.size() - off) / 10)
					break;
				for(uint32_t i = 0; i < count; ++i) {
					uint32_t offered_code = 0;
					std::memcpy(&offered_code, m.raw.data() + off + 10 * i, 4);
					if(cmd == idle_cmd && offered_code == code)
						index = static_cast<int>(i);
				}
				off += 10 * count;
			}
			EXPECT(index >= 0, "%s: card %u is not offered for command %u", label, code, idle_cmd);
			if(index < 0)
				return false;
			p.activated = true;
			answer_u32(d, (static_cast<uint32_t>(index) << 16) | idle_cmd);
			return true;
		}
		if(m.id == MSG_SELECT_OPTION) {
			const size_t count = m.raw.size() >= 3 ? m.raw[2] : 0;
			const bool valid = count > 0 && m.raw.size() == 3 + 8 * count;
			EXPECT(valid, "%s: invalid option message", label);
			if(!valid)
				return false;
			std::vector<int> choices;
			bool any_pick = false, all_pick = true;
			for(size_t i = 0; i < count; ++i) {
				uint64_t desc = 0;
				std::memcpy(&desc, m.raw.data() + 3 + 8 * i, 8);
				const bool seat_desc = (desc >> 16) == 0xFFFE;
				any_pick = any_pick || seat_desc;
				all_pick = all_pick && seat_desc && desc == (0xFFFE0000ull | (desc & 0xff));
				choices.push_back(static_cast<int>(desc & 0xff));
			}
			if(any_pick) {
				++pick_count;
				offered.insert(offered.end(), choices.begin(), choices.end());
				for(int seat : choices)
					blocked_offered = blocked_offered || (restricted && seat == 1);
				if(blocked_offered)
					std::printf("CORE DEFECT orange-%s: the opponent pick offers blocked seat 1; ADR 0002 line 76 requires a legal opponent choice.\n", label);
				const std::vector<int> legal = restricted ? std::vector<int>{destination} : std::vector<int>{1, destination};
				EXPECT(all_pick && m.b1 == 0 && choices == legal,
				       "%s: the opponent pick must offer %s (got %s)", label, seats(legal).c_str(), seats(choices).c_str());
				int index = 0;
				for(size_t i = 0; i < choices.size(); ++i)
					if(choices[i] == destination)
						index = static_cast<int>(i);
				picked = choices[index];
				std::printf("DATA orange-%s pick: offered %s, picked %d\n", label, seats(choices).c_str(), picked);
				answer_i32(d, index);
			} else {
				answer_i32(d, 0); // The first ordinary procedure option.
			}
			return true;
		}
		if(m.id == MSG_SELECT_PLACE && p.activated) {
			if(outer_reason && p.place_hint < 0) {
				answer_place(d, 0, LOCATION_SZONE, 1); // Card 119 occupies sequence 0.
				return true;
			}
			place_seen = true;
			const int hint = p.place_hint;
			hints.push_back(hint);
			blocked_offered = blocked_offered || (restricted && hint == 1);
			std::printf("DATA orange-%s place: chooser %u, hint %d, picked %d, picks %d\n", label, m.b1, hint, picked, pick_count);
			if(restricted && hint == 1 && pick_count == 0) {
				std::printf("CORE DEFECT orange-%s: blocked seat 1 is offered with no opponent pick; ADR 0002 line 76 requires the summoning player to pick one opponent.\n", label);
				EXPECT(false, "%s: blocked seat 1 is hinted with no pick (ADR 0002 line 76)", label);
			}
			EXPECT(hint == destination && p.place_hint_player == m.b1, "%s: place hint must name seat %d for chooser %u (got seat %d, chooser %d)",
			       label, destination, m.b1, hint, p.place_hint_player);
			EXPECT(picked < 0 || picked == hint, "%s: hint %d differs from picked seat %d", label, hint, picked);
			// Use the received seat. A wrong core hint must remain a failed outcome.
			const int seat = hint >= 0 ? hint : picked;
			p.place_hint = -1;
			p.place_hint_player = -1;
			if(seat < 0 || seat >= seat_count)
				return false;
			answer_place(d, static_cast<uint8_t>(seat), LOCATION_MZONE, 0);
			return true;
		}
		if(m.id == MSG_RETRY)
			EXPECT(false, "%s: the core refused the command or the received place seat", label);
		return false;
	}, outer_reason ? 5 : idle_cmd);
	const std::string w0 = where(d, 0, code), w1 = where(d, 1, code), w2 = where(d, 2, code);
	std::printf("n=%d, %s with o_range. Monster %u: seat 0 %s, seat 1 %s, seat 2 %s; opponent picks %s; place hints %s\n",
	            seat_count, label, code, w0.c_str(), w1.c_str(), w2.c_str(), seats(offered).c_str(), seats(hints).c_str());
	EXPECT(place_seen && !blocked_offered, "%s: a place must be offered and blocked seat 1 must not be offered", label);
	if(!restricted)
		EXPECT(pick_count == 1 && offered == std::vector<int>({1, destination}) && picked == destination,
		       "%s: one pick with exactly seats 1 and %d is required", label, destination);
	if(outer_reason)
		EXPECT(logged("orange outer eligible true") && logged("orange outer reason 110"),
		       "%s: the procedure must be legal under outer effect 110", label);
	EXPECT(p.done, "%s: the summon did not finish", label);
	const std::string w3 = tag ? where(d, 3, code) : "absent";
	EXPECT((tag ? w3 : w2) == "mzone" && (!tag || w2 != "mzone") && w1 != "mzone" && w0 != "mzone", "%s: monster %u went to seat 0 %s, seat 1 %s, seat 2 %s",
	       label, code, w0.c_str(), w1.c_str(), w2.c_str());
	if(tag) {
		std::printf("DATA orange-%s all seats: 0=%s 1=%s 2=%s 3=%s\n", label, w0.c_str(), w1.c_str(), w2.c_str(), w3.c_str());
		for(int seat : offered)
			EXPECT(seat == 1 || seat == 3, "%s: own seat or partner %d was offered", label, seat);
		EXPECT(where(d, 1, 122) == "hand" && where(d, 2, 123) == "hand" && where(d, 3, 124) == "hand",
		       "%s: hand marker of an opposing member or partner changed", label);
	}
	std::printf("RESULT orange-%s %s\n", label, failures == before ? "PASS" : "FAIL");
	OCG_DestroyDuel(d);
	g_scripts[code] = saved_script;
	g_scripts[110] = saved_outer;
	g_scripts[119] = saved_restrict;
}
static void mode_orange() {
	orange_one("summon", 118, 0);
	orange_one("spsummon", 120, 1);
	// A condition uses the real opponent pick path. The same seat restriction must apply.
	orange_one("summon-condition", 118, 0, true);
	orange_one("spsummon-condition", 120, 1, true);
	// Both fields are legal. The summoning player must choose between them.
	orange_one("summon-two-legal", 118, 0, true, false);
	orange_one("spsummon-two-legal", 120, 1, true, false);
}

// Tag uses opposing seats 1 and 3. Seat 2 is the partner.
static void mode_orange_tag() {
	orange_one("tag-summon-blocked", 118, 0, true, true, false, true);
	orange_one("tag-spsummon-blocked", 120, 1, true, true, false, true);
	orange_one("tag-summon-two-legal", 118, 0, true, false, false, true);
	orange_one("tag-spsummon-two-legal", 120, 1, true, false, false, true);
}

// The outer effect must reach the procedure mask and the core filter unchanged.
static void mode_orange_reason() {
	orange_one("spsummon-outer-reason", 120, 1, true, true, true);
}

// ---- discard: a player value that is not a duelist
static void mode_discard() {
	Setup s;
	s.hand = {{121}, {}, {}};
	OCG_Duel d = make_ffa3(DUEL_MODE_MR5, s);
	Play p;
	play(d, p, [&](const Msg&) { return false; });
	const bool ok = logged("c121 seat7 0") && logged("c121 all 0") && logged("c121 own 1");
	std::printf("n=3, Duel.DiscardDeck(7), (254), (own seat): seat7 0 %d, all 0 %d, own 1 %d\n", logged("c121 seat7 0"), logged("c121 all 0"), logged("c121 own 1"));
	EXPECT(ok, "DiscardDeck results");
	std::printf("RESULT discard %s\n", ok ? "PASS" : "FAIL");
	OCG_DestroyDuel(d);
}

int main(int argc, char** argv) {
	const std::string mode = argc > 1 ? argv[1] : "all";
	init_scripts();
	if(mode == "chooser" || mode == "all") mode_chooser();
	if(mode == "oath" || mode == "all") mode_oath();
	if(mode == "faceup" || mode == "all") mode_faceup();
	if(mode == "pass" || mode == "all") mode_pass();
	if(mode == "battle" || mode == "all") mode_battle();
	if(mode == "discard" || mode == "all") mode_discard();
	if(mode == "orange") { mode_orange(); mode_orange_reason(); mode_orange_tag(); }
	if(mode == "orange-tag") mode_orange_tag();
	if(mode == "orange-reason") mode_orange_reason();
	std::printf("failures: %d\n", failures);
	return failures;
}
