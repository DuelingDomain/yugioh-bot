// FX10 native check: summon sites in operations.cpp / processor.cpp at n_duelists == 3, pass loop after a late elimination,
// one battle site. Each mode prints what it saw and a line "RESULT <mode> PASS|FAIL". A trap build aborts with
// "YGO_N_TRAP opponent_of file:line" when the code calls opponent_of at n > 2 (the "before" proof for the trap modes).
//   chooser  EFFECT_OPPO_CHOOSES_SPSUMMON_ZONE at seat 0 (n=3): the chooser of the zone must be seat 1
//   oath     old-rule summon oath with CATEGORY_SPECIAL_SUMMON and PLAYER_ALL (n=3, seat 0): counter of seat 1
//   faceup   DUEL_1_FACEUP_FIELD (n=3): a Field Spell is activated, the Field Spells of the other seats go
//   pass     ChangePos at n=3 (MR4 without the old-rule flags): seat 0 done, seat 0 eliminated at the prompt of seat 1; seat 2 must still get its pass
//   battle   a direct attack of seat 0 against seat 1 (n=3): the battle damage
//   orange   summon procedures with EFFECT_FLAG_SPSUM_PARAM and o_range (n=3): seat 0 cannot summon onto seat 1, so the
//            monster must go to seat 2 (Normal Summon and Special Summon procedure). Needs the card.cpp of FX7 (base7|fix7).
//   discard  Duel.DiscardDeck with a player that is not a duelist (7, 254) at n=3: no trap, no read out of range, result 0
//   all      every mode above except orange
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
	              "REASON_EFFECT=%d CATEGORY_SPECIAL_SUMMON=%d\n",
	              EFFECT_TYPE_ACTIVATE, EFFECT_TYPE_FIELD, EVENT_FREE_CHAIN, LOCATION_HAND, LOCATION_MZONE,
	              static_cast<int>(EFFECT_FLAG_PLAYER_TARGET), EFFECT_OPPO_CHOOSES_SPSUMMON_ZONE, POS_FACEUP_ATTACK, POS_FACEDOWN_DEFENSE,
	              REASON_EFFECT, 0x200);
	std::string r = b;
	char c[512];
	std::snprintf(c, sizeof(c),
	              "EFFECT_TYPE_SINGLE=%d LOCATION_SZONE=%d EFFECT_CANNOT_SUMMON=%d EFFECT_CANNOT_SPECIAL_SUMMON=%d EFFECT_SUMMON_PROC=%d\n"
	              "EFFECT_SPSUMMON_PROC=%d EFFECT_FLAG_SPSUM_PARAM=%d\n",
	              EFFECT_TYPE_SINGLE, LOCATION_SZONE, EFFECT_CANNOT_SUMMON, EFFECT_CANNOT_SPECIAL_SUMMON, EFFECT_SUMMON_PROC,
	              EFFECT_SPSUMMON_PROC, static_cast<int>(EFFECT_FLAG_SPSUM_PARAM));
	return r + c;
}
static std::string activate_spell(unsigned code, const std::string& target_fn, const std::string& op_fn) {
	return "function c" + std::to_string(code) + ".initial_effect(c)\n local e1=Effect.CreateEffect(c)\n"
	       " e1:SetType(EFFECT_TYPE_ACTIVATE)\n e1:SetCode(EVENT_FREE_CHAIN)\n" +
	       (target_fn.empty() ? "" : " e1:SetTarget(" + target_fn + ")\n") + " e1:SetOperation(" + op_fn + ")\n c:RegisterEffect(e1)\nend\n";
}
static const char* kRestrict =
    "function c119.initial_effect(c)\n"
    " for _,code in ipairs({EFFECT_CANNOT_SUMMON,EFFECT_CANNOT_SPECIAL_SUMMON}) do\n"
    "  local e1=Effect.CreateEffect(c) e1:SetType(EFFECT_TYPE_FIELD) e1:SetCode(code) e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET)\n"
    "  e1:SetRange(LOCATION_SZONE) e1:SetTargetRange(1,0)\n"
    "  e1:SetTarget(function(e,c,sump,sumtype,sumpos,targetp) return targetp==1 end) c:RegisterEffect(e1)\n"
    " end\n"
    "end\n";
static std::string summon_proc(unsigned code, const char* proc_code, const char* type) {
	return "function c" + std::to_string(code) + ".initial_effect(c)\n local e1=Effect.CreateEffect(c) e1:SetType(" + std::string(type) + ")\n"
	       " e1:SetCode(" + proc_code + ") e1:SetProperty(EFFECT_FLAG_SPSUM_PARAM) e1:SetTargetRange(POS_FACEUP_ATTACK,1)\n"
	       " e1:SetRange(LOCATION_HAND)\n c:RegisterEffect(e1)\nend\n";
}
static void init_scripts() {
	// 110: registers EFFECT_OPPO_CHOOSES_SPSUMMON_ZONE for its owner, then summons a 111 from its hand to its own field.
	g_scripts[110] = activate_spell(110, "",
	    "function(e,tp) local e2=Effect.CreateEffect(e:GetHandler()) e2:SetType(EFFECT_TYPE_FIELD)"
	    " e2:SetCode(EFFECT_OPPO_CHOOSES_SPSUMMON_ZONE) e2:SetProperty(EFFECT_FLAG_PLAYER_TARGET) e2:SetTargetRange(1,0)"
	    " Duel.RegisterEffect(e2,tp)"
	    " local tc=Duel.GetFirstMatchingCard(function(c) return c:IsCode(111) end,tp,LOCATION_HAND,0,nil)"
	    " Debug.Message('c110 summon '..Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP_ATTACK)) end");
	// 112: a chain link with CATEGORY_SPECIAL_SUMMON and PLAYER_ALL (254 at more than 2 duelists) for exactly 2 cards.
	g_scripts[112] = activate_spell(112,
	    "function(e,tp,eg,ep,ev,re,r,rp,chk) if chk==0 then return true end"
	    " local g=Duel.GetFieldGroup(tp,LOCATION_HAND,0):Filter(function(c) return c:IsCode(111) end,nil)"
	    " Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,g,2,254,0) end",
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
static OCG_Duel make_duel(uint32_t flags) {
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
// An n = 3 duel (seats 0, 1, 2; every seat alone on its team) with 40 filler cards per seat.
static OCG_Duel make_ffa3(uint32_t flags, const Setup& s, uint64_t late_flags = 0) {
	OCG_Duel d = make_duel(flags);
	if(!run_lua(d, "Debug.SetupDuelists(3,0,1,2)") || !run_lua(d, prelude())) {
		std::printf("FAIL: setup\n");
		std::exit(2);
	}
	for(uint8_t seat = 0; seat < 3; ++seat) {
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
};
template<typename F>
static void play(OCG_Duel d, Play& p, F&& on_prompt, uint32_t activate_cmd = 5) {
	std::vector<Msg> msgs;
	bool in_chain = false;
	for(int steps = 0; steps < 6000 && !p.done; ++steps) {
		const int status = advance(d, msgs);
		for(const auto& m : msgs) {
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

// ---- oath: old-rule oath with PLAYER_ALL
static void mode_oath() {
	Setup s;
	s.hand = {{112, 111, 111}, {}, {}};
	OCG_Duel d = make_ffa3(DUEL_MODE_MR5, s, DUEL_SPSUMMON_ONCE_OLD_NEGATE | DUEL_CANNOT_SUMMON_OATH_OLD);
	Play p;
	std::vector<int> counts;
	bool sampled = false;
	play(d, p, [&](const Msg& m) {
		if(m.id == MSG_SELECT_CHAIN && p.activated && !sampled) {
			sampled = true;
			auto& f = F(d);
			for(int q = 0; q < 3; ++q)
				counts.push_back(static_cast<int>(f.core.spsummon_state_count[q]));
		}
		return false;
	});
	std::printf("n=3, old-rule oath flags, seat 0 chains a CATEGORY_SPECIAL_SUMMON(PLAYER_ALL, 2 cards) link. spsummon counter of seats 0 1 2 while the link is open: %s (want seat 0 >= 1, seat 1 >= 1, seat 2 = 0)\n",
	            seats(counts).c_str());
	EXPECT(sampled, "no prompt with the chain open");
	bool ok = false;
	if(sampled) {
		EXPECT(counts[0] >= 1, "summon player counter %d", counts[0]);
		EXPECT(counts[1] >= 1, "first living opponent (seat 1) counter %d", counts[1]);
		EXPECT(counts[2] == 0, "seat 2 counter %d", counts[2]);
		ok = counts[0] >= 1 && counts[1] >= 1 && counts[2] == 0 && logged("c112 resolves");
	}
	EXPECT(logged("c112 resolves"), "the link did not resolve");
	std::printf("RESULT oath %s\n", ok ? "PASS" : "FAIL");
	OCG_DestroyDuel(d);
}

// ---- faceup: DUEL_1_FACEUP_FIELD
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
	const bool ok = p.card_seats == want && killed && w2 == "grave";
	EXPECT(p.card_seats == want, "SELECT_CARD seats %s", seats(p.card_seats).c_str());
	EXPECT(killed, "seat 1 never chose");
	EXPECT(w2 == "grave", "seat 2 got no pass (115 is %s)", w2.c_str());
	EXPECT(p.done && logged("c117 group 5"), "all five Trap Monsters were read and the effect finished");
	// This fixture tests the pass loop. It sets the loss flag without elimination cleanup.
	for(int q = 0; q < 3; ++q)
		EXPECT(count_in(d, q, LOCATION_GRAVE, 115) == 1, "seat %d: one Trap Monster must go to the Graveyard", q);
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
static void orange_one(const char* label, uint32_t code, uint32_t idle_cmd) {
	Setup s;
	s.hand = {{code}, {}, {}};
	s.szone = {{{119, 1}}, {}, {}};
	OCG_Duel d = make_ffa3(DUEL_MODE_MR5, s);
	Play p;
	play(d, p, [&](const Msg& m) {
		if(m.id == MSG_SELECT_PLACE && p.activated) {
			answer_place(d, 2, LOCATION_MZONE, 0); // any seat but the summoner is the "other field" half of the mask
			return true;
		}
		return false;
	}, idle_cmd);
	const std::string w0 = where(d, 0, code), w1 = where(d, 1, code), w2 = where(d, 2, code);
	std::printf("n=3, %s with o_range, seat 0 cannot summon onto seat 1. Monster %u: on seat 0 field %s, seat 1 %s, seat 2 %s; SELECT_PLACE seats %s (want seat 2 mzone)\n",
	            label, code, w0.c_str(), w1.c_str(), w2.c_str(), seats(p.place_seats).c_str());
	const bool ok = w2 == "mzone" && w1 != "mzone" && w0 != "mzone";
	EXPECT(ok, "%s: 118/120 went to seat 0 %s, seat 1 %s, seat 2 %s", label, w0.c_str(), w1.c_str(), w2.c_str());
	std::printf("RESULT orange-%s %s\n", label, ok ? "PASS" : "FAIL");
	OCG_DestroyDuel(d);
}
static void mode_orange() {
	orange_one("summon", 118, 0);
	orange_one("spsummon", 120, 1);
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
	if(mode == "orange") mode_orange();
	std::printf("failures: %d\n", failures);
	return failures;
}
