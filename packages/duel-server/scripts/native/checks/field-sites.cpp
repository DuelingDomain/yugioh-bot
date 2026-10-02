// FX9 native check: the n > 2 sites of field.cpp (card.cpp, effect.cpp, ocgapi.cpp).
// Build and run: bash packages/duel-server/scripts/native/checks/run.sh <check name> (see README.md).
// One mode per process, so that an abort in one mode (the base tree) does not hide the others:
//   query    OCG_DuelQuery / QueryLocation / QueryCount with con, loc, seq out of range at n = 2, 3, 4
//   tribute  field::check_tribute: summon to the field of any opponent (FFA 3, FFA 4, Tag), not to a partner
//   control  card::is_control_can_be_changed at n = 2, 3, 4 (the base already has the n > 2 branch)
//   unique   add/remove_unique_card at n = 2, 3, 4 (both unique_pos); uniquebad: also check_unique_onfield with controler 4, 200, 255
//   discard  is_player_can_discard_deck(_as_cost) with 255 (a Lua value like 1 - tp at seat 2)
//   effects  add_effect / remove_effect with owner 255 and a client hint
// Exit 0 = every EXPECT held and nothing aborted.
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include "ocgapi.h"
#include "ocgapi_constants.h"
#include "duel.h"
#include "field.h"
#include "card.h"
#include "effect.h"
#include "common.h"

static std::string last_log;

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
static int read_script(void*, OCG_Duel, const char*) { return 0; }
static void on_log(void*, const char* text, int) { last_log = text ? text : ""; }

static field& F(OCG_Duel d) { return *static_cast<duel*>(d)->game_field; }
static bool run_lua(OCG_Duel d, const std::string& code) {
	last_log.clear();
	return OCG_LoadScript(d, code.c_str(), static_cast<uint32_t>(code.size()), "check.lua") != 0;
}
// layout 0: n = 2, 1: FFA 3, 2: FFA 4, 3: Tag (4 duelists, teams 0 1 0 1)
static OCG_Duel board(int layout) {
	OCG_DuelOptions options;
	std::memset(&options, 0, sizeof(options));
	options.seed[0] = 1; options.seed[1] = 2; options.seed[2] = 3; options.seed[3] = 4;
	options.flags = DUEL_MODE_MR5;
	options.team1 = {8000, 5, 1};
	options.team2 = {8000, 5, 1};
	options.cardReader = read_card;
	options.scriptReader = read_script;
	options.logHandler = on_log;
	OCG_Duel d = nullptr;
	if(OCG_CreateDuel(&d, &options) != OCG_DUEL_CREATION_SUCCESS) {
		std::printf("FAIL: OCG_CreateDuel\n");
		std::exit(2);
	}
	static const char* setups[] = {"", "Debug.SetupDuelists(3,0,1,2)", "Debug.SetupDuelists(4,0,1,2,3)", "Debug.SetupDuelists(4,0,1,0,1)"};
	if(layout > 0 && !run_lua(d, setups[layout])) {
		std::printf("FAIL: %s: %s\n", setups[layout], last_log.c_str());
		std::exit(2);
	}
	const int n = F(d).n_duelists;
	for(int p = 0; p < n; ++p) {
		for(int i = 0; i < 10; ++i) {
			OCG_NewCardInfo info;
			std::memset(&info, 0, sizeof(info));
			info.team = static_cast<uint8_t>(p);
			info.code = 1;
			info.con = static_cast<uint8_t>(p);
			info.loc = LOCATION_DECK;
			info.pos = POS_FACEDOWN_DEFENSE;
			OCG_DuelNewCard(d, &info);
		}
	}
	return d;
}
static const int layouts[] = {0, 1, 2, 3};
static const char* layout_name[] = {"n=2", "ffa3", "ffa4", "tag"};

// Puts a monster face-up attack into mzone seq of duelist con. Returns the card.
static card* put_monster(OCG_Duel d, uint8_t con, uint32_t seq) {
	OCG_NewCardInfo info;
	std::memset(&info, 0, sizeof(info));
	info.team = con;
	info.code = 1;
	info.con = con;
	info.loc = LOCATION_MZONE;
	info.seq = seq;
	info.pos = POS_FACEUP_ATTACK;
	OCG_DuelNewCard(d, &info);
	return F(d).player[con].list_mzone[seq];
}
static card* put_hand(OCG_Duel d, uint8_t con) {
	OCG_NewCardInfo info;
	std::memset(&info, 0, sizeof(info));
	info.team = con;
	info.code = 1;
	info.con = con;
	info.loc = LOCATION_HAND;
	info.pos = POS_FACEDOWN_DEFENSE;
	OCG_DuelNewCard(d, &info);
	return F(d).player[con].list_hand.back();
}

static void mode_query() {
	const uint8_t cons[] = {0, 1, 2, 3, 4, 7, 127, 254, 255};
	const uint32_t locs[] = {0, LOCATION_DECK, LOCATION_HAND, LOCATION_MZONE, LOCATION_SZONE, LOCATION_GRAVE, LOCATION_REMOVED,
	                         LOCATION_EXTRA, LOCATION_OVERLAY | LOCATION_MZONE, LOCATION_OVERLAY, LOCATION_MZONE | LOCATION_SZONE, 0x1fff, 0xffffffffu};
	const uint32_t seqs[] = {0, 1, 4, 5, 6, 7, 255, 0xffffffffu};
	for(int layout : layouts) {
		OCG_Duel d = board(layout);
		const int n = F(d).n_duelists;
		put_monster(d, 0, 0);
		uint32_t asked = 0, found = 0;
		for(uint8_t con : cons) {
			for(uint32_t loc : locs) {
				for(uint32_t seq : seqs) {
					OCG_QueryInfo info{QUERY_CODE, con, loc, seq, 0};
					uint32_t length = 0;
					const void* p = OCG_DuelQuery(d, &length, &info);
					++asked;
					if(p && length)
						++found;
					// A card is found only for a real duelist.
					EXPECT(!(p && length) || con < n, "n=%d: Query found a card for con %d loc %x seq %u", n, con, loc, seq);
					info.overlay_seq = 3;
					OCG_DuelQuery(d, &length, &info);
				}
				OCG_QueryInfo info{QUERY_CODE, con, loc, 0, 0};
				uint32_t length = 0;
				OCG_DuelQueryLocation(d, &length, &info);
				OCG_DuelQueryCount(d, con, loc);
			}
		}
		EXPECT(found > 0, "%s: the card at con 0 mzone 0 was not found", layout_name[layout]);
		std::printf("ok   query %s: %u OCG_DuelQuery calls with con/loc/seq out of range, %u found\n", layout_name[layout], asked, found);
		OCG_DestroyDuel(d);
	}
}

static void mode_tribute() {
	// Summoner: a card in the hand of duelist 0. One monster of another duelist T is the tribute, on the field of T.
	// Expected (ADR-0002): the summon goes to T = any duelist that is not on the team of 0, so the monster is usable.
	// In Tag the monster of the partner is usable as a plain Tribute too (R-TAG-PARTNER-COST), whatever T is.
	struct Case { int layout; int toplayer; bool want; };
	const Case cases[] = {
		{0, 1, true}, {0, 0, false},
		{1, 1, true}, {1, 2, true}, {1, 0, false},
		{2, 1, true}, {2, 2, true}, {2, 3, true}, {2, 0, false},
		{3, 1, true}, {3, 3, true}, {3, 2, true}, {3, 0, false}, // Tag: the monster of the partner (2) is a Tribute of the team (R-TAG-PARTNER-COST)
	};
	for(const auto& c : cases) {
		OCG_Duel d = board(c.layout);
		card* sum = put_hand(d, 0);
		if(c.toplayer != 0)
			put_monster(d, static_cast<uint8_t>(c.toplayer), 0);
		const int32_t got = F(d).check_tribute(sum, 1, 1, nullptr, static_cast<uint8_t>(c.toplayer), 0x1f, 0xffffffffu, POS_FACEUP);
		EXPECT((got != 0) == c.want, "%s: check_tribute(summoner 0, toplayer %d) = %d, want %d", layout_name[c.layout], c.toplayer, got, c.want);
		std::printf("%s %s: check_tribute(summoner 0, tribute on the field of %d) = %d (want %d)\n", (got != 0) == c.want ? "ok  " : "FAIL",
		            layout_name[c.layout], c.toplayer, got != 0, c.want);
		OCG_DestroyDuel(d);
	}
}

static void mode_control() {
	for(int layout : layouts) {
		OCG_Duel d = board(layout);
		const int n = F(d).n_duelists;
		card* pc = put_monster(d, 0, 0);
		// Every other duelist has 5 monsters: no zone to take the card.
		for(int p = 1; p < n; ++p)
			for(uint32_t s = 0; s < 5; ++s)
				put_monster(d, static_cast<uint8_t>(p), s);
		const int32_t full = pc->is_control_can_be_changed(FALSE, 0xff);
		EXPECT(full == FALSE, "%s: full fields: can change control = %d", layout_name[layout], full);
		// The last duelist frees one zone: one duelist can take the card (an opponent at n > 2).
		card* last = F(d).player[n - 1].list_mzone[4];
		F(d).remove_card(last);
		const int32_t one = pc->is_control_can_be_changed(FALSE, 0xff);
		// In Tag the free zone of seat 3 (opponent) is usable; in the n=2 duel seat 1 is the only opponent.
		EXPECT(one == TRUE, "%s: one free zone at duelist %d: can change control = %d", layout_name[layout], n - 1, one);
		std::printf("ok   control %s: full fields -> %d, one free zone on the last duelist -> %d\n", layout_name[layout], full != 0, one != 0);
		OCG_DestroyDuel(d);
	}
}

static void mode_unique(bool bad_values) {
	for(int layout : layouts) {
		OCG_Duel d = board(layout);
		auto& f = F(d);
		const int n = f.n_duelists;
		const uint8_t con = static_cast<uint8_t>(n - 1);
		card* pc = put_monster(d, con, 0);
		pc->unique_pos[0] = 1;
		pc->unique_pos[1] = 1;
		pc->unique_code = 1;
		pc->unique_location = LOCATION_MZONE;
		f.add_unique_card(pc);
		for(int p = 0; p < n; ++p) {
			const bool want = p == con || !f.same_team(con, static_cast<uint8_t>(p));
			const bool has = f.core.unique_cards[p].count(pc) != 0;
			EXPECT(has == want, "%s: unique_cards[%d] has card %d, want %d", layout_name[layout], p, has, want);
		}
		f.remove_unique_card(pc);
		for(int p = 0; p < MAX_DUELISTS; ++p)
			EXPECT(f.core.unique_cards[p].count(pc) == 0, "%s: unique_cards[%d] not empty after remove", layout_name[layout], p);
		// A Lua value that is no duelist (255, or 1 - tp at seat 2).
		if(bad_values) {
			for(uint8_t bad : {uint8_t(4), uint8_t(200), uint8_t(255)})
				EXPECT(f.check_unique_onfield(pc, bad, LOCATION_MZONE) == nullptr, "%s: check_unique_onfield(%u) not null", layout_name[layout], bad);
		}
		std::printf("ok   unique %s: add/remove_unique_card on duelist %d (both unique_pos)%s\n",
		            layout_name[layout], con, bad_values ? ", check_unique_onfield(4/200/255) = none" : "");
		OCG_DestroyDuel(d);
	}
}

static void mode_discard() {
	for(int layout : layouts) {
		OCG_Duel d = board(layout);
		auto& f = F(d);
		const int n = f.n_duelists;
		for(int p = 0; p < n; ++p) {
			EXPECT(f.is_player_can_discard_deck(static_cast<uint8_t>(p), 1) == TRUE, "%s: can discard deck seat %d", layout_name[layout], p);
			EXPECT(f.is_player_can_discard_deck_as_cost(static_cast<uint8_t>(p), 1) == TRUE, "%s: can discard deck as cost seat %d", layout_name[layout], p);
		}
		for(uint8_t bad : {uint8_t(4), uint8_t(200), uint8_t(255)}) {
			EXPECT(f.is_player_can_discard_deck(bad, 1) == FALSE, "%s: can discard deck %u", layout_name[layout], bad);
			EXPECT(f.is_player_can_discard_deck_as_cost(bad, 1) == FALSE, "%s: can discard deck as cost %u", layout_name[layout], bad);
		}
		std::printf("ok   discard %s: seats 0..%d can discard, 4/200/255 cannot\n", layout_name[layout], n - 1);
		OCG_DestroyDuel(d);
	}
}

static void mode_effects() {
	for(int layout : layouts) {
		OCG_Duel d = board(layout);
		auto& f = F(d);
		card* pc = put_monster(d, 0, 0);
		for(uint8_t owner : {uint8_t(0), uint8_t(f.n_duelists - 1), uint8_t(255)}) {
			for(int ranges = 0; ranges < 3; ++ranges) {
				// ranges: 0 = s_range only, 1 = o_range only, 2 = both. o_range with owner 255 at n = 2 is stock (opponent_of(255) = 2).
				if(owner == 255 && f.n_duelists == 2 && ranges != 0)
					continue;
				effect* e = static_cast<duel*>(d)->new_effect();
				e->owner = pc;
				e->type = EFFECT_TYPE_FIELD;
				e->code = 12345;
				e->flag[0] = EFFECT_FLAG_PLAYER_TARGET | EFFECT_FLAG_CLIENT_HINT;
				e->s_range = ranges != 1 ? 1 : 0;
				e->o_range = ranges != 0 ? 1 : 0;
				f.add_effect(e, owner);
				f.remove_effect(e);
			}
		}
		std::printf("ok   effects %s: add_effect/remove_effect with owner 0, last seat and 255 (client hint, s/o range)\n", layout_name[layout]);
		OCG_DestroyDuel(d);
	}
}

int main(int argc, char** argv) {
	const std::string mode = argc > 1 ? argv[1] : "all";
	const bool all = mode == "all";
	if(all || mode == "query") mode_query();
	if(all || mode == "tribute") mode_tribute();
	if(all || mode == "control") mode_control();
	if(all || mode == "unique") mode_unique(false);
	if(all || mode == "uniquebad") mode_unique(true);
	if(all || mode == "discard") mode_discard();
	if(all || mode == "effects") mode_effects();
	std::printf("%s %s: %d failure(s)\n", failures ? "FAIL" : "PASS", mode.c_str(), failures);
	return failures ? 1 : 0;
}
