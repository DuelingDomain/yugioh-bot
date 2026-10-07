// ELIM2 native check: a seat that is not alive gets no prompt and no card (n > 2); n == 2 keeps the stock behaviour.
// Build and run: bash packages/duel-server/scripts/native/checks/run.sh <check name> (see README.md).
// It links the dev tree core built with -DYGO_N_TRAP -D_GLIBCXX_ASSERTIONS and -g1 ASan/UBSan.
// Method: seat 0 is marked as eliminated before the first step. Then the check puts the core calls that a folded Lua
// value makes (a prompt for seat 0, MoveToField with seat 0 as owner or as chooser) into the process list, as the
// library functions do today. It runs 5 turns with an automatic answer for every prompt of a living seat.
// Scenarios:
//   ffa3, ffa4, tag   seat 0 not alive: no MSG_SELECT_* for seat 0, no card on a zone of seat 0, MoveToField with the
//                     eliminated chooser asks the owner (seat 2), the same calls for a living seat still prompt
//   n2                seat 0 is marked the same way, but with two duelists the stock prompts stay: seat 0 gets them
//                     (so the guards are only in the n > 2 branch)
//   n2same            plain n == 2 duel twice: the same bytes
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>
#include "ocgapi.h"
#include "ocgapi_constants.h"
#include "duel.h"
#include "field.h"
#include "card.h"
#include "interpreter.h"
#include "common.h"


static const char* kScripts = check_scripts_dir();
static const uint32_t kDeckBase = 5000;
static const uint32_t kHandA = 6001, kHandB = 6002, kHandC = 6003;

static void read_card(void*, uint32_t code, OCG_CardData* data) {
	std::memset(data, 0, sizeof(*data));
	data->code = code;
	data->type = TYPE_MONSTER | TYPE_NORMAL;
	data->level = 4;
	data->attribute = 1;
	data->race = 1;
	data->attack = 1000;
	data->defense = 1000;
}
static bool read_file(const std::string& path, std::string& out) {
	std::ifstream in(path, std::ios::binary);
	if(!in) return false;
	std::stringstream buf;
	buf << in.rdbuf();
	out = buf.str();
	return true;
}
static int read_script(void*, OCG_Duel duel, const char* name) {
	std::string n(name), text;
	const auto slash = n.find_last_of('/');
	const std::string base = slash == std::string::npos ? n : n.substr(slash + 1);
	if(!read_file(std::string(kScripts) + "/" + base, text) && !read_file(std::string(kScripts) + "/official/" + base, text) &&
	   !read_file(std::string(kScripts) + "/pre-release/" + base, text))
		return 0;
	return OCG_LoadScript(duel, text.data(), static_cast<uint32_t>(text.size()), name);
}
static long g_errors = 0;
static void on_log(void*, const char*, int type) {
	if(type == OCG_LOG_TYPE_ERROR || type == OCG_LOG_TYPE_UNDEFINED) ++g_errors;
}
static field& F(OCG_Duel d) { return *static_cast<duel*>(d)->game_field; }

struct Scenario {
	const char* name;
	int n;
	std::vector<int> team;
	bool mark;      // seat 0 marked as not alive before the first step
	bool inject;    // the library-style core calls
};
struct Outcome {
	uint64_t hash = 1469598103934665603ull;
	int turns = 0;
	int prompts_seat0 = 0, prompts_other = 0;
	int injected_seat0 = 0;          // bit mask of the injected prompt kinds that seat 0 got: 1 yes/no, 2 option, 4 position, 8 place
	int place_prompt_seat = -1;      // the seat of the first MSG_SELECT_PLACE
	int card_a_con = -1, card_a_loc = -1, card_b_con = -1, card_b_loc = -1;
	int zone_cards_seat0 = 0;        // cards in mzone/szone lists of seat 0 at the end
	bool moved_to_seat0 = false;     // an MSG_MOVE whose destination is a zone of seat 0
	bool ended_ok = false;
	std::string why;
};
static uint64_t fnv(uint64_t h, const uint8_t* p, size_t n) {
	for(size_t i = 0; i < n; ++i) { h ^= p[i]; h *= 1099511628211ull; }
	return h;
}
static bool is_select(uint8_t id) {
	switch(id) {
	case MSG_SELECT_BATTLECMD: case MSG_SELECT_IDLECMD: case MSG_SELECT_EFFECTYN: case MSG_SELECT_YESNO:
	case MSG_SELECT_OPTION: case MSG_SELECT_CARD: case MSG_SELECT_CHAIN: case MSG_SELECT_PLACE:
	case MSG_SELECT_POSITION: case MSG_SELECT_TRIBUTE: case MSG_SELECT_COUNTER: case MSG_SELECT_SUM:
	case MSG_SELECT_DISFIELD: case MSG_SELECT_UNSELECT_CARD: case MSG_SORT_CARD: case MSG_SORT_CHAIN:
	case MSG_ANNOUNCE_RACE: case MSG_ANNOUNCE_ATTRIB: case MSG_ANNOUNCE_CARD: case MSG_ANNOUNCE_NUMBER:
		return true;
	default:
		return false;
	}
}
static void add_card(OCG_Duel d, uint8_t con, uint32_t loc, uint32_t code, uint32_t pos) {
	OCG_NewCardInfo info;
	std::memset(&info, 0, sizeof(info));
	info.team = con; info.duelist = 0; info.code = code; info.con = con; info.loc = loc; info.seq = 0; info.pos = pos;
	OCG_DuelNewCard(d, &info);
}
static card* find_hand(field& f, int seat, uint32_t code) {
	for(card* c : f.player[seat].list_hand)
		if(c && c->data.code == code) return c;
	return nullptr;
}

static Outcome play(const Scenario& sc) {
	Outcome out;
	g_errors = 0;
	OCG_DuelOptions options;
	std::memset(&options, 0, sizeof(options));
	options.seed[0] = 7; options.seed[1] = 2; options.seed[2] = 3; options.seed[3] = 4;
	options.flags = DUEL_MODE_MR5;
	options.team1 = { 8000, 5, 1 };
	options.team2 = { 8000, 5, 1 };
	options.cardReader = read_card;
	options.scriptReader = read_script;
	options.logHandler = on_log;
	OCG_Duel d = nullptr;
	if(OCG_CreateDuel(&d, &options) != OCG_DUEL_CREATION_SUCCESS) { out.why = "OCG_CreateDuel"; return out; }
	for(const char* name : { "constant.lua", "utility.lua" })
		if(!read_script(nullptr, d, name)) { out.why = std::string("script ") + name; OCG_DestroyDuel(d); return out; }
	if(sc.n > 2) {
		std::string code = "Debug.SetupDuelists(" + std::to_string(sc.n);
		for(int t : sc.team) code += "," + std::to_string(t);
		code += ")";
		if(!OCG_LoadScript(d, code.c_str(), static_cast<uint32_t>(code.size()), "setup.lua") || g_errors) {
			out.why = "SetupDuelists failed"; OCG_DestroyDuel(d); return out;
		}
	}
	for(int s = 0; s < sc.n; ++s)
		for(int i = 0; i < 30; ++i)
			add_card(d, static_cast<uint8_t>(s), LOCATION_DECK, kDeckBase + s, POS_FACEDOWN_DEFENSE);
	if(sc.n > 2) {
		add_card(d, 2, LOCATION_HAND, kHandA, POS_FACEDOWN_DEFENSE);
		add_card(d, 2, LOCATION_HAND, kHandB, POS_FACEDOWN_DEFENSE);
		add_card(d, 2, LOCATION_HAND, kHandC, POS_FACEDOWN_DEFENSE);
	}
	OCG_StartDuel(d);
	field& f = F(d);
	card *card_a = nullptr, *card_b = nullptr;
	if(sc.mark)
		f.player[0].eliminated = true;
	if(sc.inject) {
		using namespace Processors;
		// Startup is in the sub list: move it to the main list so that the calls below run before it
		f.core.units.splice(f.core.units.begin(), f.core.subunits);
		// the prompts that a folded Lua value 0 can ask for
		f.emplace_process<SelectYesNo>(uint8_t(0), uint64_t(0));
		f.core.select_options = { 11, 12 };
		f.emplace_process<SelectOption>(uint8_t(0));
		f.emplace_process<SelectPosition>(uint8_t(0), uint32_t(kHandA), uint8_t(0xf));
		f.emplace_process<SelectPlace>(uint8_t(0), uint32_t(0), uint8_t(1));
		if(sc.n > 2) {
			card_a = find_hand(f, 2, kHandA);
			card_b = find_hand(f, 2, kHandB);
			if(!card_a || !card_b) { out.why = "hand cards not found"; OCG_DestroyDuel(d); return out; }
			// owner not alive: the card stays in the hand of seat 2
			f.move_to_field(card_a, 0, 0, LOCATION_MZONE, POS_FACEUP_ATTACK);
			// chooser not alive, owner alive: the owner (seat 2) chooses the place
			f.move_to_field(card_b, 0, 2, LOCATION_MZONE, POS_FACEUP_ATTACK);
		}
		// a living seat still gets its prompt
		f.emplace_process<SelectYesNo>(uint8_t(sc.n > 2 ? 2 : 1), uint64_t(0));
	}
	for(int steps = 0; steps < 40000; ++steps) {
		const int status = OCG_DuelProcess(d);
		uint32_t length = 0;
		const auto* buf = static_cast<const uint8_t*>(OCG_DuelGetMessage(d, &length));
		out.hash = fnv(out.hash, buf, length);
		struct Msg { uint8_t id; const uint8_t* p; uint32_t size; };
		std::vector<Msg> msgs;
		bool win = false;
		for(uint32_t off = 0; off + 4 <= length;) {
			uint32_t size = 0;
			std::memcpy(&size, buf + off, 4);
			if(size > 0) {
				msgs.push_back({ buf[off + 4], buf + off + 5, size - 1 });
				const Msg& m = msgs.back();
				if(m.id == MSG_NEW_TURN) ++out.turns;
				if(m.id == MSG_WIN) win = true;
				if(m.id == MSG_MOVE && m.size >= 20) {
					// code(4) from(con,loc,seq,pos = 4x u8... layout: u32 code, loc info 8 bytes (con,loc,seq,pos), to 8 bytes)
					const uint8_t to_con = m.p[4 + 8], to_loc = m.p[4 + 8 + 1];
					if(sc.mark && sc.n > 2 && to_con == 0 && (to_loc & (LOCATION_MZONE | LOCATION_SZONE))) out.moved_to_seat0 = true;
				}
			}
			off += 4 + size;
		}
		if(status == OCG_DUEL_STATUS_END || win) { out.why = "duel ended"; out.ended_ok = true; break; }
		if(status != OCG_DUEL_STATUS_AWAITING) continue;
		if(out.turns >= 5) { out.ended_ok = true; break; }
		if(msgs.empty()) { out.why = "awaiting without a message"; break; }
		const Msg& m = msgs.back();
		const int who = m.size ? m.p[0] : -1;
		if(is_select(m.id)) {
			if(who == 0) ++out.prompts_seat0; else ++out.prompts_other;
			if(who == 0 && m.id == MSG_SELECT_YESNO) out.injected_seat0 |= 1;
			if(who == 0 && m.id == MSG_SELECT_OPTION) out.injected_seat0 |= 2;
			if(who == 0 && m.id == MSG_SELECT_POSITION) out.injected_seat0 |= 4;
			if(who == 0 && m.id == MSG_SELECT_PLACE) out.injected_seat0 |= 8;
		}
		if(m.id == MSG_SELECT_PLACE && out.place_prompt_seat < 0) out.place_prompt_seat = who;
		auto answer32 = [&](int32_t v) { OCG_DuelSetResponse(d, &v, sizeof(v)); };
		switch(m.id) {
		case MSG_SELECT_IDLECMD: answer32(7); break;
		case MSG_SELECT_BATTLECMD: answer32(3); break;
		case MSG_SELECT_YESNO: case MSG_SELECT_EFFECTYN: answer32(1); break;
		case MSG_SELECT_OPTION: answer32(0); break;
		case MSG_SELECT_POSITION: answer32(POS_FACEUP_ATTACK); break;
		case MSG_SELECT_CHAIN: answer32(m.size > 2 && m.p[2] != 0 ? 0 : -1); break;
		case MSG_SELECT_PLACE: case MSG_SELECT_DISFIELD: {
			const uint8_t r[3] = { static_cast<uint8_t>(who), LOCATION_MZONE, 0 };
			OCG_DuelSetResponse(d, r, 3);
			break;
		}
		case MSG_SORT_CHAIN: { const uint8_t r[1] = { 0xFF }; OCG_DuelSetResponse(d, r, 1); break; }
		case MSG_SELECT_CARD: {
			uint32_t min = 0;
			std::memcpy(&min, m.p + 2, 4);
			std::vector<uint32_t> r{ 0, min };
			for(uint32_t i = 0; i < min; ++i) r.push_back(i);
			OCG_DuelSetResponse(d, r.data(), static_cast<uint32_t>(r.size() * 4));
			break;
		}
		default: {
			char b[64];
			std::snprintf(b, sizeof(b), "unhandled prompt %u", static_cast<unsigned>(m.id));
			out.why = b;
			break;
		}
		}
		if(!out.why.empty()) break;
	}
	if(!out.ended_ok && out.why.empty()) out.why = "step limit";
	if(sc.n > 2) {
		out.card_a_con = card_a->current.controler; out.card_a_loc = card_a->current.location;
		out.card_b_con = card_b->current.controler; out.card_b_loc = card_b->current.location;
		for(card* c : f.player[0].list_mzone) if(c) ++out.zone_cards_seat0;
		for(card* c : f.player[0].list_szone) if(c) ++out.zone_cards_seat0;
	}
	OCG_DestroyDuel(d);
	return out;
}

int main(int argc, char** argv) {
	const std::string only = argc > 1 ? argv[1] : "";
	auto want = [&](const char* n) { return only.empty() || only == n; };
	const std::vector<Scenario> multi = {
		{ "ffa3", 3, { 0, 1, 2 }, true, true },
		{ "ffa4", 4, { 0, 1, 2, 3 }, true, true },
		{ "tag", 4, { 0, 1, 0, 1 }, true, true },
	};
	for(const auto& sc : multi) {
		if(!want(sc.name)) continue;
		const Outcome o = play(sc);
		EXPECT(o.ended_ok, "%s: the duel did not run: %s (turns=%d)", sc.name, o.why.c_str(), o.turns);
		EXPECT(o.prompts_seat0 == 0, "%s: %d prompts for the seat that is not alive", sc.name, o.prompts_seat0);
		EXPECT(o.prompts_other > 0, "%s: no prompt for a living seat", sc.name);
		EXPECT(o.injected_seat0 == 0, "%s: injected prompt kinds 0x%x reached seat 0", sc.name, o.injected_seat0);
		EXPECT(!o.moved_to_seat0 && o.zone_cards_seat0 == 0, "%s: %d cards on the zones of the seat that is not alive", sc.name, o.zone_cards_seat0);
		EXPECT(o.card_a_con == 2 && o.card_a_loc != LOCATION_MZONE && o.card_a_loc != LOCATION_SZONE, "%s: card A (owner not alive) went to a field: con=%d loc=%d", sc.name, o.card_a_con, o.card_a_loc);
		EXPECT(o.place_prompt_seat == 2, "%s: the place prompt went to seat %d, not to seat 2", sc.name, o.place_prompt_seat);
		EXPECT(o.card_b_loc == LOCATION_MZONE && o.card_b_con == 2, "%s: card B did not reach the field of seat 2: con=%d loc=%d", sc.name, o.card_b_con, o.card_b_loc);
		EXPECT(g_errors == 0, "%s: %ld Lua errors", sc.name, g_errors);
		std::printf("%-5s seat 0 not alive: prompts for seat 0 = %d, for living seats = %d, cards on seat 0 zones = %d, place prompt seat = %d, card B on seat %d\n",
			sc.name, o.prompts_seat0, o.prompts_other, o.zone_cards_seat0, o.place_prompt_seat, o.card_b_con);
	}
	if(want("n2")) {
		// two duelists: the mark has no effect, seat 0 gets the 4 stock prompts (yes/no, option, position, place)
		Scenario a{ "n2", 2, { 0, 1 }, true, true };
		const Outcome o = play(a);
		EXPECT(o.ended_ok, "n2: the duel did not run: %s", o.why.c_str());
		EXPECT(o.injected_seat0 == 15, "n2: seat 0 got the injected prompt kinds 0x%x, the 4 stock prompts (0xf) must stay", o.injected_seat0);
		std::printf("n2    mark on seat 0 has no effect: seat 0 got the injected yes/no, option, position and place prompts (kinds 0x%x)\n", o.injected_seat0);
	}
	if(want("n2same")) {
		// two duelists, no mark, no injected call: a repeat run gives the same bytes (the duel is deterministic).
		// The identity with the stock core is proved by the gate differential and by nduel --check (n2 hashes).
		Scenario a{ "n2same", 2, { 0, 1 }, false, false };
		const Outcome oa = play(a), ob = play(a);
		EXPECT(oa.ended_ok && ob.ended_ok, "n2same: a duel did not run: %s / %s", oa.why.c_str(), ob.why.c_str());
		EXPECT(oa.hash == ob.hash, "n2same: a repeat run gives other bytes");
		std::printf("n2same plain n2 duel: bytes of two runs equal: %s (hash %016llx)\n", oa.hash == ob.hash ? "yes" : "NO", static_cast<unsigned long long>(oa.hash));
	}
	if(failures) { std::printf("ELIM2 CHECK FAIL: %d failure(s)\n", failures); return 1; }
	std::printf("ELIM2 CHECK OK\n");
	return 0;
}
