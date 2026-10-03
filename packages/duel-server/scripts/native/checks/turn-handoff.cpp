// F9 native check: turn hand-off when the turn player is eliminated (n = 3 and n = 4).
// The turn player dies at the battle command prompt, in the attack window, or in the damage step (LP 0). After the
// 200 message, the turn must end: the next living seat in turn order gets the next turn (MSG_NEW_TURN), no prompt of
// any kind goes to a dead seat, and no idle or battle command prompt is shown to anyone before the turn changes.
// Chain windows and effect prompts of the living seats that belong to a chain already open are allowed (the chain
// resolves first, like the Flip effect of seed 102).
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

// ---------------------------------------------------------------- the hand-off checks
static uint8_t prompt_seat(const Msg& m) { return m.d.empty() ? 0xFF : m.d[0]; }

// The seats that have a MSG_DUELIST_ELIMINATED before message index `before`.
static uint32_t dead_before(size_t before) {
	uint32_t mask = 0;
	for(size_t i = 0; i < before && i < all_msgs.size(); ++i)
		if(all_msgs[i].id == MSG_DUELIST_ELIMINATED && all_msgs[i].d[0] < 32) mask |= 1u << all_msgs[i].d[0];
	return mask;
}

// Answers a prompt the way a passive player would: pass, end phase, no, first option, first legal card.
static void answer_any(OCG_Duel d, int k) {
	const Msg& m = all_msgs[k];
	if(m.id == MSG_SELECT_YESNO || m.id == MSG_SELECT_EFFECTYN || m.id == MSG_SELECT_OPTION) respond(d, 0);
	else auto_answer(d, k);
}

struct Outcome {
	bool turn_changed = false;
	uint8_t new_turn_seat = 0xFF;
	int to_dead = 0;        // prompts addressed to a seat after its MSG_DUELIST_ELIMINATED
	int living_after_loss = 0; // prompts to a living seat after the 200 of seat 0 and before the turn changed (an open chain still resolves)
	int select_card_after_loss = 0;
	int action_prompts = 0; // idle or battle command prompts after the 200 of the turn player, before the turn changed
	bool ended = false;     // the loop stopped on a prompt budget, not on the turn change
};

// Answers every prompt from `k` on until MSG_NEW_TURN. Counts prompt problems.
static Outcome drive(OCG_Duel d, int k, size_t mark) {
	Outcome out;
	for(int t = 0; t < 400; ++t) {
		for(size_t i = mark; i < all_msgs.size(); ++i) {
			if(all_msgs[i].id == MSG_NEW_TURN) {
				out.turn_changed = true;
				out.new_turn_seat = all_msgs[i].d[0];
				return out;
			}
		}
		if(k < 0) {
			out.ended = true;
			return out;
		}
		const Msg& m = all_msgs[k];
		const uint8_t seat = prompt_seat(m);
		const uint32_t dead = dead_before(static_cast<size_t>(k));
		if(seat < 32 && (dead >> seat & 1)) ++out.to_dead;
		if((dead & 1) && !(dead >> seat & 1)) {
			++out.living_after_loss;
			if(m.id == MSG_SELECT_CARD) ++out.select_card_after_loss;
		}
		if((dead & 1) && (m.id == MSG_SELECT_IDLECMD || m.id == MSG_SELECT_BATTLECMD)) ++out.action_prompts;
		answer_any(d, k);
		k = until_prompt(d);
	}
	out.ended = true;
	return out;
}

static void host_eliminate(OCG_Duel d, int seat, int reason) {
	run_lua(d, "Debug.EliminateDuelist(" + std::to_string(seat) + "," + std::to_string(reason) + ")");
}

static void arena(OCG_Duel d, int n) {
	run_lua(d, n == 3 ? "Debug.SetupDuelists(3,0,1,2)" : "Debug.SetupDuelists(4,0,1,2,3)");
	fill_decks(d, n, 40);
}

// Gets seat 0 to its battle command prompt on a turn where a battle is allowed.
static int to_battle(OCG_Duel d, int n) {
	OCG_StartDuel(d);
	F(d).infos.turn_id = static_cast<uint32_t>(n);
	for(int p = 0; p < n; ++p) F(d).infos.turn_id_by_player[p] = 1;
	int k = to_prompt(d, MSG_SELECT_IDLECMD);
	EXPECT(k >= 0 && all_msgs[k].id == MSG_SELECT_IDLECMD && all_msgs[k].d[0] == 0, "idle prompt of seat 0 (got %d)", k >= 0 ? all_msgs[k].id : -1);
	if(k < 0 || all_msgs[k].id != MSG_SELECT_IDLECMD) return -1;
	respond(d, 6); // battle phase
	k = to_prompt(d, MSG_SELECT_BATTLECMD);
	EXPECT(k >= 0 && all_msgs[k].id == MSG_SELECT_BATTLECMD && all_msgs[k].d[0] == 0, "battle command prompt of seat 0 (got %d)", k >= 0 ? all_msgs[k].id : -1);
	return k >= 0 && all_msgs[k].id == MSG_SELECT_BATTLECMD ? k : -1;
}

static void judge(const char* name, int n, const Outcome& out, uint8_t expect_seat, bool allow_action_after) {
	EXPECT(out.turn_changed, "%s (n=%d): the turn never changed (prompt budget %d)", name, n, out.ended ? 1 : 0);
	EXPECT(!out.turn_changed || out.new_turn_seat == expect_seat, "%s (n=%d): next turn is for seat %d, expected seat %d", name, n, out.new_turn_seat, expect_seat);
	EXPECT(out.to_dead == 0, "%s (n=%d): %d prompt(s) went to a dead seat", name, n, out.to_dead);
	EXPECT(allow_action_after || out.action_prompts == 0, "%s (n=%d): %d idle or battle command prompt(s) in the turn of the dead seat", name, n, out.action_prompts);
	std::printf("ok   %s (n=%d): next turn seat %d, %d dead-seat prompt(s), %d action prompt(s)\n", name, n, out.new_turn_seat, out.to_dead, out.action_prompts);
}

// A: the turn player is eliminated at the battle command prompt (the battle start step). The stale prompt is answered
// with "attack" (an engine that answers for the leaving seat may pick it) or "end phase".
static void check_battle_start(int n, bool attack_answer) {
	OCG_Duel d = make_duel();
	arena(d, n);
	put(d, 0, 0, C_MONSTER, LOCATION_MZONE, 0, POS_FACEUP_ATTACK);
	put(d, 1, 1, C_MONSTER, LOCATION_MZONE, 0, POS_FACEUP_ATTACK);
	int k = to_battle(d, n);
	if(k < 0) { OCG_DestroyDuel(d); return; }
	uint8_t expect = 1;
	if(n == 4) {
		host_eliminate(d, 1, 4); // seat 1 is already gone: the hand-off must skip it
		expect = 2;
	}
	const size_t mark = all_msgs.size();
	host_eliminate(d, 0, 4);
	if(attack_answer) respond(d, (0u << 16) | 1u);
	else respond(d, 3);
	k = until_prompt(d);
	Outcome out = drive(d, k, mark);
	int late_attacks = 0;
	for(size_t i = mark; i < all_msgs.size(); ++i)
		if(all_msgs[i].id == MSG_ATTACK && (dead_before(i) & 1)) ++late_attacks;
	EXPECT(late_attacks == 0, "battle start (n=%d): the dead seat declared %d attack(s) after its loss", n, late_attacks);
	judge(attack_answer ? "battle start, stale attack answer" : "battle start, stale end-phase answer", n, out, expect, false);
	OCG_DestroyDuel(d);
}

// B: the turn player is eliminated in the attack window (a monster attacks a monster of seat 1).
static void check_attack_window(int n) {
	OCG_Duel d = make_duel();
	arena(d, n);
	put(d, 0, 0, C_MONSTER, LOCATION_MZONE, 0, POS_FACEUP_ATTACK);
	put(d, 1, 1, C_MONSTER, LOCATION_MZONE, 0, POS_FACEUP_ATTACK);
	run_lua(d,
		"local c=Duel.GetFieldCard(1,4,0)\n"
		"local e=Effect.CreateEffect(c)\n"
		"e:SetType(16)\ne:SetCode(1002)\n" // never mind: an activation that stays free
		"e:SetRange(4)\n");
	int k = to_battle(d, n);
	if(k < 0) { OCG_DestroyDuel(d); return; }
	respond(d, (0u << 16) | 1u); // attack with the first attacker
	k = until_prompt(d);
	int guard = 0;
	while(k >= 0 && all_msgs[k].id != MSG_SELECT_CHAIN && guard++ < 6) {
		answer_any(d, k); // the direct attack question and the attack target (the first card)
		k = until_prompt(d);
	}
	EXPECT(k >= 0 && all_msgs[k].id == MSG_SELECT_CHAIN, "chain window at the attack (got %d)", k >= 0 ? all_msgs[k].id : -1);
	if(k < 0 || all_msgs[k].id != MSG_SELECT_CHAIN) { OCG_DestroyDuel(d); return; }
	EXPECT(F(d).core.attacker != nullptr, "an attack is declared");
	uint8_t expect = 1;
	if(n == 4) {
		host_eliminate(d, 1, 4);
		expect = 2;
	}
	const size_t mark = all_msgs.size();
	host_eliminate(d, 0, 4);
	respond_i(d, -1);
	k = until_prompt(d);
	Outcome out = drive(d, k, mark);
	EXPECT(count_id(mark, MSG_DAMAGE) == 0, "attack window (n=%d): damage after the attacker was eliminated", n);
	judge("attack window", n, out, expect, false);
	OCG_DestroyDuel(d);
}

// C: the turn player loses all LP in the damage step (as in fuzz seed 102 of ffa3). A Flip effect of seat 1 is
// chained after the loss and asks seat 1 for a target: that prompt is legal, the turn still has to end after it.
static void check_damage_loss(int n) {
	OCG_Duel d = make_duel();
	arena(d, n);
	put(d, 0, 0, C_MONSTER, LOCATION_MZONE, 0, POS_FACEUP_ATTACK);
	run_lua(d,
		"local a=Duel.GetFieldCard(0,4,0)\n"
		"local e=Effect.CreateEffect(a)\n"
		"e:SetType(1)\ne:SetCode(102)\n"   // EFFECT_SET_ATTACK_FINAL
		"e:SetValue(100)\n"
		"a:RegisterEffect(e)\n");
	put(d, 1, 1, C_MONSTER, LOCATION_MZONE, 0, POS_FACEDOWN_DEFENSE);
	put(d, 1, 1, C_MONSTER, LOCATION_MZONE, 1, POS_FACEUP_ATTACK);
	run_lua(d,
		"local c=Duel.GetFieldCard(1,4,0)\n"
		"local e=Effect.CreateEffect(c)\n"
		"e:SetType(1+32)\n"              // EFFECT_TYPE_SINGLE + EFFECT_TYPE_FLIP
		"e:SetCode(1001)\n"              // EVENT_FLIP
		"e:SetProperty(16)\n"            // EFFECT_FLAG_CARD_TARGET
		"e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk,chkc)\n"
		"  if chk==0 then return true end\n"
		"  Duel.SelectTarget(tp,nil,tp,4,0,1,1,nil)\n"
		"end)\n"
		"e:SetOperation(function(e,tp) Debug.Message('T9-FLIP-OP') end)\n"
		"c:RegisterEffect(e)\n");
	int k = to_battle(d, n);
	if(k < 0) { OCG_DestroyDuel(d); return; }
	F(d).player[0].lp = 300; // the 1000 damage of the flipped monster ends seat 0
	uint8_t expect = 1;
	if(n == 4) {
		host_eliminate(d, 2, 4); // seat 2 is already gone: seat 1 is next in any case, seat 3 stays alive
	}
	const size_t mark = all_msgs.size();
	respond(d, (0u << 16) | 1u);
	k = until_prompt(d);
	Outcome out = drive(d, k, mark);
	EXPECT(count_id(mark, MSG_DUELIST_ELIMINATED) >= 1, "damage loss (n=%d): seat 0 was not eliminated", n);
	EXPECT(F(d).player[0].eliminated, "damage loss (n=%d): seat 0 not flagged", n);
	// The seed 102 shape: the Flip effect of seat 1 asks seat 1 for a target after seat 0 lost, and the turn still has to end.
	EXPECT(out.select_card_after_loss >= 1, "damage loss (n=%d): the Flip effect asked no target after the loss (%d prompts to living seats)", n, out.living_after_loss);
	judge("damage loss", n, out, expect, false);
	OCG_DestroyDuel(d);
}

int main(int argc, char** argv) {
	const std::string mode = argc > 1 ? argv[1] : "check";
	auto reset = [] { all_msgs.clear(); };
	for(int n : { 3, 4 }) {
		if(mode == "check" || mode == "start") { reset(); check_battle_start(n, false); reset(); check_battle_start(n, true); }
		if(mode == "check" || mode == "attack") { reset(); check_attack_window(n); }
		if(mode == "check" || mode == "damage") { reset(); check_damage_loss(n); }
	}
	std::printf("%s: %d failure(s)\n", failures ? "FAIL" : "PASS", failures);
	return failures ? 1 : 0;
}
