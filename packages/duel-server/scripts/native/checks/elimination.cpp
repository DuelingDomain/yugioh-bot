// T5B native check for field::eliminate(p, reason) (non-trap gate lib, ASan + UBSan).
// It calls eliminate directly between OCG_DuelProcess calls, like the host will.
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
#include "common.h"

static int op_count = 0;

enum : uint32_t { C_MONSTER = 1, C_FUSION = 2, C_XYZ = 3, C_EQUIP = 4, C_TRAP = 5 };
static void read_card(void*, uint32_t code, OCG_CardData* data) {
	std::memset(data, 0, sizeof(*data));
	data->code = code;
	switch(code) {
	case C_FUSION: data->type = TYPE_MONSTER | TYPE_FUSION; break;
	case C_XYZ: data->type = TYPE_MONSTER | TYPE_XYZ | TYPE_EFFECT; break;
	case C_EQUIP: data->type = TYPE_SPELL | TYPE_EQUIP; break;
	case C_TRAP: data->type = TYPE_TRAP; break;
	default: data->type = TYPE_MONSTER | TYPE_NORMAL; break;
	}
	data->level = 4;
	data->attribute = 1;
	data->race = 1;
	data->attack = 1000;
	data->defense = 1000;
}
static int read_script(void*, OCG_Duel, const char*) { return 0; }
static void on_log(void*, const char* text, int) {
	if(text && std::strstr(text, "T5B-OP"))
		++op_count;
	if(std::getenv("CHECK_LOG"))
		std::fprintf(stderr, "core log: %s\n", text ? text : "");
}
static OCG_Duel make_duel(uint32_t seed = 1) {
	OCG_DuelOptions options;
	std::memset(&options, 0, sizeof(options));
	options.seed[0] = seed; options.seed[1] = 2; options.seed[2] = 3; options.seed[3] = 4;
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
	return duel;
}
static field& F(OCG_Duel d) { return *static_cast<duel*>(d)->game_field; }
static void run_lua(OCG_Duel d, const std::string& code) {
	if(!OCG_LoadScript(d, code.c_str(), static_cast<uint32_t>(code.size()), "t5b.lua")) {
		++failures;
		std::printf("FAIL: lua error in: %s\n", code.c_str());
	}
}
static void add_one(OCG_Duel d, uint8_t con, uint8_t owner, uint32_t code, uint32_t loc, uint32_t seq, uint32_t pos) {
	OCG_NewCardInfo info;
	std::memset(&info, 0, sizeof(info));
	info.team = owner; info.duelist = 0; info.code = code; info.con = con; info.loc = loc; info.seq = seq; info.pos = pos;
	const size_t before = static_cast<duel*>(d)->cards.size();
	OCG_DuelNewCard(d, &info);
	if(static_cast<duel*>(d)->cards.size() != before + 1) {
		++failures;
		std::printf("FAIL: card not added (con %d loc %u seq %u)\n", con, loc, seq);
		return;
	}
}
static void add_many(OCG_Duel d, uint8_t p, uint32_t loc, int count, uint32_t code = C_MONSTER) {
	for(int i = 0; i < count; ++i)
		add_one(d, p, p, code, loc, 0, POS_FACEDOWN_DEFENSE);
}

struct Msg { uint8_t id; std::vector<uint8_t> d; };
static std::vector<Msg> parse(const uint8_t* b, uint32_t len) {
	std::vector<Msg> out;
	for(uint32_t off = 0; off + 4 <= len;) {
		uint32_t size = 0;
		std::memcpy(&size, b + off, 4);
		if(size > 0)
			out.push_back({ b[off + 4], std::vector<uint8_t>(b + off + 5, b + off + 4 + size) });
		off += 4 + size;
	}
	return out;
}
static bool is_prompt(uint8_t id) { return id >= 10 && id <= 27 && id != 17; }
static std::vector<Msg> all_msgs;       // every message since the start
static int status_of_last = 0;
// One OCG_DuelProcess. Appends messages to all_msgs.
static int proc(OCG_Duel d) {
	status_of_last = OCG_DuelProcess(d);
	uint32_t len = 0;
	const auto* b = static_cast<const uint8_t*>(OCG_DuelGetMessage(d, &len));
	auto m = parse(b, len);
	if(std::getenv("CHECK_TRACE"))
		for(auto& x : m) std::fprintf(stderr, "msg %u (%zu bytes)%s\n", x.id, x.d.size(), x.d.empty() ? "" : (x.d[0] < 4 ? " p" : ""));
	all_msgs.insert(all_msgs.end(), m.begin(), m.end());
	return status_of_last;
}
// Processes until a prompt (awaiting) or the end. Returns the last prompt message index in all_msgs (or -1).
static int until_prompt(OCG_Duel d, int limit = 2000) {
	for(int i = 0; i < limit; ++i) {
		const int s = proc(d);
		if(s != OCG_DUEL_STATUS_CONTINUE) {
			for(int k = static_cast<int>(all_msgs.size()) - 1; k >= 0; --k)
				if(is_prompt(all_msgs[k].id))
					return k;
			return -1;
		}
	}
	return -1;
}
static void respond(OCG_Duel d, uint32_t v) { OCG_DuelSetResponse(d, &v, sizeof(v)); }
static void respond_i(OCG_Duel d, int32_t v) { OCG_DuelSetResponse(d, &v, sizeof(v)); }
// Answers the prompt at index k the way the T0 check does (pass, end phase, discard).
static void auto_answer(OCG_Duel d, int k) {
	const Msg& m = all_msgs[k];
	if(m.id == MSG_SELECT_CHAIN)
		respond_i(d, -1);
	else if(m.id == MSG_SELECT_IDLECMD)
		respond(d, 7);
	else if(m.id == MSG_SELECT_BATTLECMD)
		respond(d, 3); // end phase
	else if(m.id == MSG_SELECT_CARD) {
		uint32_t min = 0;
		std::memcpy(&min, m.d.data() + 2, 4);
		std::vector<uint32_t> r{ 0, min };
		for(uint32_t i = 0; i < min; ++i) r.push_back(i);
		OCG_DuelSetResponse(d, r.data(), static_cast<uint32_t>(r.size() * 4));
	} else {
		std::printf("FAIL: unexpected prompt %u\n", m.id);
		++failures;
		respond_i(d, -1);
	}
}
static bool in_any_list(field& f, card* c) {
	for(int p = 0; p < MAX_DUELISTS; ++p) {
		auto& pl = f.player[p];
		for(auto* lst : { &pl.list_mzone, &pl.list_szone, &pl.list_main, &pl.list_hand, &pl.list_grave, &pl.list_remove, &pl.list_extra })
			for(auto* x : *lst)
				if(x == c) return true;
	}
	return false;
}
static card* card_at(OCG_Duel d, uint8_t con, uint32_t loc, uint32_t seq) {
	auto& pl = F(d).player[con];
	return loc == LOCATION_MZONE ? pl.list_mzone[seq] : pl.list_szone[seq];
}
static card* put(OCG_Duel d, uint8_t con, uint8_t owner, uint32_t code, uint32_t loc, uint32_t seq, uint32_t pos) {
	add_one(d, con, owner, code, loc, seq, pos);
	return card_at(d, con, loc, seq);
}
static int count_owned(OCG_Duel d, uint8_t p) {
	int n = 0;
	for(auto* c : static_cast<duel*>(d)->cards)
		if(c->owner == p) ++n;
	return n;
}
static int count_id(size_t from, uint8_t id) {
	int n = 0;
	for(size_t i = from; i < all_msgs.size(); ++i) n += all_msgs[i].id == id;
	return n;
}
static void setup3(OCG_Duel d) { run_lua(d, "Debug.SetupDuelists(3,0,1,2)"); }
static void fill_decks(OCG_Duel d, int n, int deck) {
	for(int p = 0; p < n; ++p) {
		add_many(d, static_cast<uint8_t>(p), LOCATION_DECK, deck);
		add_many(d, static_cast<uint8_t>(p), LOCATION_EXTRA, 3, C_FUSION);
	}
}
static uint32_t u32(const std::vector<uint8_t>& v, size_t o) { uint32_t x; std::memcpy(&x, v.data() + o, 4); return x; }

// Passes chain windows that offer nothing until a prompt with id `want` (and, for chain windows, at least one
// activatable effect) shows up. Returns its index or -1.
static int to_prompt(OCG_Duel d, uint8_t want, bool need_effects = false) {
	for(int t = 0; t < 50; ++t) {
		const int k = until_prompt(d);
		if(k < 0)
			return -1;
		const Msg& m = all_msgs[k];
		if(m.id == want && (!need_effects || u32(m.d, 11) > 0))
			return k;
		if(m.id != MSG_SELECT_CHAIN)
			return k;
		respond_i(d, -1);
	}
	return -1;
}
// ---------------------------------------------------------------- scenario A: cards leave
static void check_cards() {
	OCG_Duel d = make_duel();
	run_lua(d, "Debug.SetupDuelists(4,0,1,2,3)");
	fill_decks(d, 4, 40);
	card* m_own = put(d, 3, 3, C_MONSTER, LOCATION_MZONE, 0, POS_FACEUP_ATTACK);    // p3 owns and controls
	card* m_foreign = put(d, 3, 1, C_MONSTER, LOCATION_MZONE, 1, POS_FACEUP_ATTACK); // p3 controls, p1 owns
	card* xyz = put(d, 3, 3, C_XYZ, LOCATION_MZONE, 2, POS_FACEUP_ATTACK);          // p3 Xyz
	card* mat_own = nullptr; card* mat_foreign = nullptr;
	{
		add_one(d, 3, 3, C_MONSTER, LOCATION_DECK, 0, POS_FACEDOWN_DEFENSE);
		mat_own = F(d).player[3].list_main.back();
		add_one(d, 1, 1, C_MONSTER, LOCATION_DECK, 0, POS_FACEDOWN_DEFENSE);
		mat_foreign = F(d).player[1].list_main.back();
		F(d).remove_card(mat_own); xyz->xyz_add(mat_own);
		F(d).remove_card(mat_foreign); xyz->xyz_add(mat_foreign);
	}
	card* target0 = put(d, 0, 0, C_MONSTER, LOCATION_MZONE, 0, POS_FACEUP_ATTACK);   // p0 monster
	card* equip3 = put(d, 3, 3, C_EQUIP, LOCATION_SZONE, 0, POS_FACEUP_ATTACK);      // p3 equip on p0 monster
	equip3->equip(target0, FALSE);
	card* equip0 = put(d, 0, 0, C_EQUIP, LOCATION_SZONE, 0, POS_FACEUP_ATTACK);      // p0 equip on p3 monster
	equip0->equip(m_own, FALSE);
	// Without an EFFECT_EQUIP_LIMIT the Adjust destroys an equip card at once: give both one (no script files here).
	run_lua(d,
		"for _,a in ipairs({{3,8,0},{0,8,0}}) do\n"
		"  local c=Duel.GetFieldCard(a[1],a[2],a[3])\n"
		"  local e=Effect.CreateEffect(c)\n"
		"  e:SetType(1)\n"            // EFFECT_TYPE_SINGLE
		"  e:SetCode(76)\n"           // EFFECT_EQUIP_LIMIT
		"  e:SetProperty(1024)\n"     // EFFECT_FLAG_CANNOT_DISABLE
		"  e:SetValue(function(e,c) return true end)\n"
		"  c:RegisterEffect(e)\n"
		"end\n"
		// The core returns a monster to its owner at once when no effect gives it to the controller: give the
		// foreign monster of seat 3 a control effect (EFFECT_SET_CONTROL, seat 3), the way a real control card does.
		"local fm=Duel.GetFieldCard(3,4,1)\n"   // LOCATION_MZONE, sequence 1
		"local ec=Effect.CreateEffect(fm)\n"
		"ec:SetType(1)\n"                        // EFFECT_TYPE_SINGLE
		"ec:SetCode(4)\n"                        // EFFECT_SET_CONTROL
		"ec:SetProperty(1024+131072)\n"          // CANNOT_DISABLE + SINGLE_RANGE
		"ec:SetRange(4)\n"                       // LOCATION_MZONE
		"ec:SetValue(3)\n"
		"fm:RegisterEffect(ec)\n");
	EXPECT(equip3->equiping_target == target0 && equip0->equiping_target == m_own, "equip setup");
	OCG_StartDuel(d);
	int k = until_prompt(d);
	EXPECT(k >= 0 && all_msgs[k].id == MSG_SELECT_IDLECMD && all_msgs[k].d[0] == 0, "first prompt is idle of duelist 0");
	const int expected_removed = count_owned(d, 3);
	const size_t mark = all_msgs.size();
	const int lp1 = F(d).player[1].lp;
	F(d).eliminate(3, 7);
	F(d).eliminate(3, 9); // a second call does nothing
	if(std::getenv("CHECK_DBG")) { auto& pl = F(d).player[3]; std::fprintf(stderr, "after eliminate: main %zu hand %zu extra %zu grave %zu mz0 %p szone0 %p\n", pl.list_main.size(), pl.list_hand.size(), pl.list_extra.size(), pl.list_grave.size(), (void*)pl.list_mzone[0], (void*)pl.list_szone[0]); std::fprintf(stderr, "m_own loc %d mat_own loc %d\n", m_own->current.location, mat_own->current.location); }
	auto_answer(d, k);
	const int k2 = until_prompt(d);
	(void)k2;
	// message order: 200 first, then 190
	size_t i200 = 0, i190 = 0;
	for(size_t i = mark; i < all_msgs.size(); ++i) {
		if(all_msgs[i].id == MSG_DUELIST_ELIMINATED && !i200) i200 = i;
		if(all_msgs[i].id == MSG_REMOVE_CARDS && !i190) i190 = i;
	}
	EXPECT(i200 && i190 && i200 < i190, "200 before 190 (%zu, %zu)", i200, i190);
	EXPECT(count_id(mark, MSG_DUELIST_ELIMINATED) == 1, "one 200 message");
	if(i200)
		EXPECT(all_msgs[i200].d.size() == 2 && all_msgs[i200].d[0] == 3 && all_msgs[i200].d[1] == 7, "200 payload p=3 reason=7");
	if(i190) {
		const auto& r = all_msgs[i190].d;
		const uint32_t count = u32(r, 0);
		EXPECT(r.size() == 4 + 10 * count, "190 size %zu for %u", r.size(), count);
		EXPECT(static_cast<int>(count) == expected_removed, "190 count %u, p3 owns %d", count, expected_removed);
		auto entry = [&](uint32_t n, uint8_t& con, uint8_t& loc, uint32_t& seq) {
			con = r[4 + n * 10]; loc = r[5 + n * 10]; seq = u32(r, 6 + n * 10);
		};
		uint8_t con, loc; uint32_t seq;
		entry(0, con, loc, seq);
		EXPECT(con == 3 && (loc & LOCATION_OVERLAY) && seq == 2, "entry 0 = p3's own material under the Xyz (con %d loc %d seq %u)", con, loc, seq);
		entry(1, con, loc, seq);
		EXPECT(con == 3 && loc == LOCATION_MZONE && seq == 0, "entry 1 = p3 monster zone 0");
		entry(2, con, loc, seq);
		EXPECT(con == 3 && loc == LOCATION_MZONE && seq == 2, "entry 2 = the Xyz monster");
		entry(3, con, loc, seq);
		EXPECT(con == 3 && loc == LOCATION_SZONE && seq == 0, "entry 3 = p3 equip card (con %d loc %d seq %u)", con, loc, seq);
		if(std::getenv("CHECK_DBG")) for(uint32_t n = 0; n < 60; ++n) { entry(n, con, loc, seq); std::fprintf(stderr, "entry %u: con %d loc %d seq %u\n", n, con, loc, seq); }
		entry(4, con, loc, seq);
		EXPECT(con == 3 && loc == LOCATION_DECK, "entry 4 = p3 deck");
		std::printf("ok   200(3,7) then 190 with %u cards: material, zone 0, Xyz, equip, then the pile cards\n", count);
	}
	auto& f = F(d);
	EXPECT(f.player[3].eliminated, "p3 flagged");
	bool empty = true;
	for(auto* c : f.player[3].list_mzone) empty = empty && !c;
	for(auto* c : f.player[3].list_szone) empty = empty && !c;
	empty = empty && f.player[3].list_main.empty() && f.player[3].list_hand.empty() && f.player[3].list_grave.empty()
		&& f.player[3].list_remove.empty() && f.player[3].list_extra.empty();
	EXPECT(empty, "p3 has no card left");
	for(card* c : { mat_own, xyz, m_own, equip3 })
		EXPECT(c->current.location == 0 && !in_any_list(f, c) && !c->overlay_target, "removed card is out (loc %d)", c->current.location);
	// R-FFA-RETURN-OWNED-CARDS: the living owner has a free Monster Zone.
	EXPECT(m_foreign->current.location == LOCATION_MZONE && m_foreign->current.controler == 1 && m_foreign->owner == 1
		&& m_foreign->current.position == POS_FACEUP_ATTACK
		&& m_foreign->current.sequence < f.player[1].list_mzone.size()
		&& f.player[1].list_mzone[m_foreign->current.sequence] == m_foreign,
		"foreign monster is on its owner's field in Attack Position (loc %d con %d)", m_foreign->current.location, m_foreign->current.controler);
	std::printf("ok   a monster p3 controls and p1 owns returned to p1's field in Attack Position\n");
	EXPECT(mat_foreign->current.location == LOCATION_GRAVE && mat_foreign->current.controler == 1 && !mat_foreign->overlay_target,
		"foreign material is in the GY of p1 (loc %d con %d)", mat_foreign->current.location, mat_foreign->current.controler);
	std::printf("ok   p1's Xyz material under p3's Xyz went to the GY of p1\n");
	EXPECT(target0->current.location == LOCATION_MZONE && target0->equiping_cards.empty() && !target0->equiping_target,
		"equip target of p3's equip is fine");
	std::printf("ok   p3's equip card is gone and p0's monster is fine (no equip left)\n");
	EXPECT(equip0->current.location == LOCATION_GRAVE && !equip0->equiping_target && equip0->current.controler == 0,
		"p0's equip card on p3's monster was destroyed (loc %d)", equip0->current.location);
	std::printf("ok   p0's equip card on p3's removed monster went to the GY of p0\n");
	EXPECT(f.player[1].lp == lp1, "lp of p1 unchanged");
	OCG_DestroyDuel(d);
}

// ---------------------------------------------------------------- scenario F: turns skip the eliminated duelist
// The base still crashes in a chain window of duelist 2 or 3 (opponent_of in SelectChain, T3 fixes it), so only
// the turns of duelists 0 and 1 can run: n = 3, duelist 2 is eliminated (its cards stay: remove_card treats
// controler 2 as PLAYER_NONE in this base, T9 fixes it). Turns must go 1,0,1,0 and nobody asks duelist 2.
static void check_turns() {
	OCG_Duel d = make_duel();
	setup3(d);
	fill_decks(d, 3, 40);
	OCG_StartDuel(d);
	int k = until_prompt(d);
	EXPECT(k >= 0 && all_msgs[k].id == MSG_SELECT_IDLECMD && all_msgs[k].d[0] == 0, "idle prompt");
	const size_t mark = all_msgs.size();
	F(d).eliminate(2, 1);
	std::vector<int> turns;
	int bad = 0;
	for(int t = 0; t < 60 && k >= 0 && turns.size() < 8; ++t) {
		auto_answer(d, k);
		k = until_prompt(d);
		turns.clear();
		for(size_t i = mark; i < all_msgs.size(); ++i) {
			if(all_msgs[i].id == MSG_NEW_TURN) turns.push_back(all_msgs[i].d[0]);
		}
	}
	for(size_t i = mark; i < all_msgs.size(); ++i)
		if(is_prompt(all_msgs[i].id) && !all_msgs[i].d.empty() && all_msgs[i].d[0] == 2) ++bad;
	std::string s;
	for(int t : turns) s += std::to_string(t);
	EXPECT(bad == 0, "duelist 2 was prompted %d times", bad);
	bool ok = turns.size() >= 8;
	for(size_t i = 0; i < turns.size(); ++i) ok = ok && turns[i] == (i % 2 == 0 ? 1 : 0);
	EXPECT(ok, "turn order is 1,0,1,0,...: %s", s.c_str());
	std::printf("ok   duelist 2 eliminated at turn 1: turns %s, never prompted\n", s.c_str());
	OCG_DestroyDuel(d);
}

// ---------------------------------------------------------------- scenario B: chain link and turn player
static void check_chain() {
	OCG_Duel d = make_duel();
	setup3(d);
	fill_decks(d, 3, 40);
	put(d, 0, 0, C_MONSTER, LOCATION_MZONE, 0, POS_FACEUP_ATTACK);
	run_lua(d,
		"local c=Duel.GetFieldCard(0,4,0)\n"
		"local e=Effect.CreateEffect(c)\n"
		"e:SetType(64)\n"         // EFFECT_TYPE_IGNITION
		"e:SetRange(4)\n"         // LOCATION_MZONE
		"e:SetOperation(function(e,tp) Debug.Message('T5B-OP') end)\n"
		"c:RegisterEffect(e)\n");
	OCG_StartDuel(d);
	int k = until_prompt(d);
	EXPECT(k >= 0 && all_msgs[k].id == MSG_SELECT_IDLECMD && all_msgs[k].d[0] == 0, "idle prompt of duelist 0");
	respond(d, (0u << 16) | 5u); // activate effect 0
	op_count = 0;
	k = until_prompt(d);
	EXPECT(k >= 0 && all_msgs[k].id == MSG_SELECT_CHAIN, "chain window after the activation (prompt %d)", k >= 0 ? all_msgs[k].id : -1);
	const uint8_t asked = all_msgs[k].d[0];
	std::printf("     chain window is asked to duelist %d (the base has no response cursor yet)\n", asked);
	const size_t mark = all_msgs.size();
	F(d).eliminate(0, 4);
	respond_i(d, -1);
	k = until_prompt(d);
	// The base (no T3 cursor) asks the link owner's seat next: pass every chain prompt until the turn changes.
	int chain_prompts_to_p0 = 0;
	for(int t = 0; t < 10 && k >= 0 && all_msgs[k].id == MSG_SELECT_CHAIN; ++t) {
		if(all_msgs[k].d[0] == 0) ++chain_prompts_to_p0;
		respond_i(d, -1);
		k = until_prompt(d);
	}
	EXPECT(chain_prompts_to_p0 == 0, "eliminated duelist 0 received %d chain prompts", chain_prompts_to_p0);
	int i72 = -1, i76 = -1, i73 = -1, i40 = -1, i200 = -1;
	for(size_t i = mark; i < all_msgs.size(); ++i) {
		const uint8_t id = all_msgs[i].id;
		if(id == MSG_DUELIST_ELIMINATED && i200 < 0) i200 = static_cast<int>(i);
		if(id == MSG_CHAIN_SOLVING && i72 < 0) i72 = static_cast<int>(i);
		if(id == MSG_CHAIN_DISABLED && i76 < 0) i76 = static_cast<int>(i);
		if(id == MSG_CHAIN_SOLVED && i73 < 0) i73 = static_cast<int>(i);
		if(id == MSG_NEW_TURN && i40 < 0) i40 = static_cast<int>(i);
	}
	// Rulebook v1.4, Removing players from the game (R-FFA-ELIMINATION):
	// an unstarted leaver link is removed without resolution or disable events.
	EXPECT(i200 >= 0 && i72 == -1 && i76 == -1 && i73 == -1,
		"loss reported; removed link has no SOLVING/DISABLED/SOLVED (%d %d %d %d)", i200, i72, i76, i73);
	EXPECT(op_count == 0, "the operation of the eliminated duelist ran %d times", op_count);
	EXPECT(i40 > i200 && all_msgs[i40].d[0] == 1, "NEW_TURN for duelist 1 after the loss (index %d, player %d)", i40, i40 >= 0 ? all_msgs[i40].d[0] : -1);
	bool prompted0 = false;
	for(size_t i = static_cast<size_t>(i40 > 0 ? i40 : 0); i < all_msgs.size(); ++i)
		if(is_prompt(all_msgs[i].id) && all_msgs[i].id != MSG_SELECT_CHAIN && all_msgs[i].d[0] == 0) prompted0 = true;
	EXPECT(!prompted0, "eliminated turn player got an idle/battle prompt after NEW_TURN");
	std::printf("ok   p0's link: loss, no resolution messages or operation; then NEW_TURN for duelist 1, no idle prompt for p0\n");
	OCG_DestroyDuel(d);
}

// ---------------------------------------------------------------- scenario C: direct attack on p1
static void check_attack() {
	OCG_Duel d = make_duel();
	setup3(d);
	fill_decks(d, 3, 40);
	put(d, 0, 0, C_MONSTER, LOCATION_MZONE, 0, POS_FACEUP_ATTACK);
	put(d, 1, 1, C_TRAP, LOCATION_SZONE, 0, POS_FACEDOWN);
	run_lua(d,
		"local c=Duel.GetFieldCard(1,8,0)\n"   // LOCATION_SZONE
		"local e=Effect.CreateEffect(c)\n"
		"e:SetType(16)\n"         // EFFECT_TYPE_ACTIVATE
		"e:SetCode(1002)\n"       // EVENT_FREE_CHAIN
		"e:SetOperation(function(e,tp) Debug.Message('T5B-OP') end)\n"
		"c:RegisterEffect(e)\n");
	OCG_StartDuel(d);
	// The first turn is turn 4: a battle is allowed for n = 3. Free for all waits until every living duelist
	// has had a turn (turn_id_by_player), so the three duelists get one turn each before it.
	F(d).infos.turn_id = 3;
	for(int p = 0; p < 3; ++p) F(d).infos.turn_id_by_player[p] = 1;
	int k = to_prompt(d, MSG_SELECT_IDLECMD);
	EXPECT(k >= 0 && all_msgs[k].id == MSG_SELECT_IDLECMD, "idle prompt (got %d)", k >= 0 ? all_msgs[k].id : -1);
	respond(d, 6); // battle phase
	k = to_prompt(d, MSG_SELECT_BATTLECMD);
	EXPECT(k >= 0 && all_msgs[k].id == MSG_SELECT_BATTLECMD, "battle cmd prompt (turn_id %d, got %d)", F(d).infos.turn_id, k >= 0 ? all_msgs[k].id : -1);
	if(k < 0 || all_msgs[k].id != MSG_SELECT_BATTLECMD) { OCG_DestroyDuel(d); return; }
	respond(d, (0u << 16) | 1u); // attack with the first attacker
	// A direct attack with 3 duelists asks the attacker which opponent is hit: answer duelist 1 (low byte of the option).
	k = to_prompt(d, MSG_SELECT_OPTION);
	EXPECT(k >= 0 && all_msgs[k].id == MSG_SELECT_OPTION && all_msgs[k].d[0] == 0, "defender question for duelist 0 (got %d)", k >= 0 ? all_msgs[k].id : -1);
	if(k < 0 || all_msgs[k].id != MSG_SELECT_OPTION) { OCG_DestroyDuel(d); return; }
	{
		int pick = -1;
		for(int i = 0; i < all_msgs[k].d[1]; ++i) {
			uint64_t desc = 0;
			std::memcpy(&desc, all_msgs[k].d.data() + 2 + 8 * i, 8);
			if((desc & 0xFF) == 1) pick = i;
		}
		EXPECT(pick >= 0, "duelist 1 is one of the options");
		respond(d, static_cast<uint32_t>(pick < 0 ? 0 : pick));
	}
	k = to_prompt(d, MSG_SELECT_CHAIN, true);
	EXPECT(k >= 0 && all_msgs[k].id == MSG_SELECT_CHAIN, "chain window at the attack (got %d)", k >= 0 ? all_msgs[k].id : -1);
	if(k < 0 || all_msgs[k].id != MSG_SELECT_CHAIN) { OCG_DestroyDuel(d); return; }
	auto& f = F(d);
	EXPECT(f.core.attacker && !f.core.attack_target, "a direct attack is declared");
	const uint8_t victim = all_msgs[k].d[0];
	std::printf("     attack window asked to duelist %d\n", victim);
	EXPECT(f.core.battle_defender == 1, "the core set the defender to duelist 1 (got %d)", f.core.battle_defender);
	const int lp1 = f.player[1].lp;
	const size_t mark = all_msgs.size();
	f.eliminate(1, 3);
	respond_i(d, -1);
	k = to_prompt(d, MSG_SELECT_YESNO);
	// A rollback ends in the stock "attack again?" question (desc 30) for the turn player.
	EXPECT(k >= 0 && all_msgs[k].id == MSG_SELECT_YESNO && all_msgs[k].d[0] == 0 && u32(all_msgs[k].d, 1) == 30,
		"replay question for duelist 0 (got %d)", k >= 0 ? all_msgs[k].id : -1);
	respond(d, 0);
	k = to_prompt(d, MSG_SELECT_BATTLECMD);
	EXPECT(k >= 0 && all_msgs[k].id == MSG_SELECT_BATTLECMD && all_msgs[k].d[0] == 0, "back at the battle cmd of duelist 0 (got %d)", k >= 0 ? all_msgs[k].id : -1);
	EXPECT(count_id(mark, MSG_DAMAGE) == 0, "no damage was dealt");
	EXPECT(f.player[1].lp == lp1, "lp of p1 %d, before %d", f.player[1].lp, lp1);
	EXPECT(count_id(mark, MSG_DUELIST_ELIMINATED) == 1, "one 200");
	std::printf("ok   direct attack on p1, p1 eliminated in the attack window: attack rolled back (replay question, desc 30), no damage, battle cmd of duelist 0 again\n");
	OCG_DestroyDuel(d);
}

// ---------------------------------------------------------------- scenario D: chunking (300 cards)
static void check_chunks() {
	OCG_Duel d = make_duel();
	run_lua(d, "Debug.SetupDuelists(4,0,1,2,3)");
	fill_decks(d, 4, 40);
	add_many(d, 3, LOCATION_DECK, 300);
	OCG_StartDuel(d);
	int k = until_prompt(d);
	EXPECT(k >= 0 && all_msgs[k].id == MSG_SELECT_IDLECMD, "idle prompt");
	const int owned = count_owned(d, 3);
	const size_t mark = all_msgs.size();
	F(d).eliminate(3, 0);
	auto_answer(d, k);
	until_prompt(d);
	std::vector<uint32_t> counts;
	for(size_t i = mark; i < all_msgs.size(); ++i)
		if(all_msgs[i].id == MSG_REMOVE_CARDS) counts.push_back(u32(all_msgs[i].d, 0));
	uint32_t sum = 0;
	for(auto c : counts) sum += c;
	EXPECT(counts.size() == 2 && counts[0] == 255 && sum == static_cast<uint32_t>(owned), "chunks: %zu, first %u, sum %u of %d", counts.size(), counts.empty() ? 0 : counts[0], sum, owned);
	std::printf("ok   %d cards: %zu MSG_REMOVE_CARDS of 255 and %u\n", owned, counts.size(), counts.size() > 1 ? counts[1] : 0);
	OCG_DestroyDuel(d);
}

// ---------------------------------------------------------------- scenario E: n = 2
static void check_two() {
	OCG_Duel d = make_duel();
	fill_decks(d, 2, 40);
	OCG_StartDuel(d);
	int k = until_prompt(d);
	EXPECT(k >= 0 && all_msgs[k].id == MSG_SELECT_IDLECMD, "idle prompt");
	const size_t mark = all_msgs.size();
	const size_t cards = static_cast<duel*>(d)->cards.size();
	const int hand0 = static_cast<int>(F(d).player[0].list_hand.size()), hand1 = static_cast<int>(F(d).player[1].list_hand.size());
	F(d).eliminate(1, 0);
	auto_answer(d, k);
	until_prompt(d);
	EXPECT(count_id(mark, MSG_DUELIST_ELIMINATED) == 0 && count_id(mark, MSG_REMOVE_CARDS) == 0, "n=2: no 200 or 190");
	EXPECT(static_cast<duel*>(d)->cards.size() == cards && static_cast<int>(F(d).player[1].list_hand.size()) >= hand1 - 0
		&& static_cast<int>(F(d).player[0].list_hand.size()) >= hand0 - 1, "n=2: the cards stay");
	EXPECT(!F(d).player[1].eliminated, "n=2: no flag");
	std::printf("ok   n=2: eliminate does nothing (no flag, no 200, no 190, no card moves)\n");
	OCG_DestroyDuel(d);
}

int main(int argc, char** argv) {
	const std::string mode = argc > 1 ? argv[1] : "check";
	auto reset = [] { all_msgs.clear(); };
	if(mode == "check" || mode == "cards") { reset(); check_cards(); }
	if(mode == "check" || mode == "turns") { reset(); check_turns(); }
	if(mode == "check" || mode == "chain") { reset(); check_chain(); }
	if(mode == "check" || mode == "attack") { reset(); check_attack(); }
	if(mode == "check" || mode == "chunks") { reset(); check_chunks(); }
	if(mode == "check" || mode == "two") { reset(); check_two(); }
	std::printf("%s: %d failure(s)\n", failures ? "FAIL" : "PASS", failures);
	return failures ? 1 : 0;
}
