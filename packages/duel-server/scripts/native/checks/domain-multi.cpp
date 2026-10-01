// D1 native check: the Domain layer for 3 and 4 duelists (apply-domain-multi.mjs pre/post + D1a).
// Build and run: bash packages/duel-server/scripts/native/checks/run.sh <check name> (see README.md).
// Usage: check <format> [part]
//   format: ffa3 | ffa4 | tag | two   ("two" = a 2-duelist duel without SetupDuelists, the n == 2 sanity run)
//   part:   setup | tax | flow | elim | all (default)
#include <algorithm>
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
#include "common.h"

static std::string last_log;

static const uint32_t DM_LOC = 0x4000;       // LOCATION_DECKMASTER
static const uint32_t DM_RETURNS = 0x8000;   // LOCATION_DECKMASTER_RETURNS
static const uint32_t RECALL_DESC_LO = 0x444D5243;

static uint32_t dm_code(int seat) { return 9000u + static_cast<uint32_t>(seat); }

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
static void on_log(void*, const char* text, int type) {
	last_log = text ? text : "";
	if(std::getenv("CHECK_LOG"))
		std::fprintf(stderr, "core log [%d]: %s\n", type, text);
}

struct Format {
	std::string name;
	int n;
	std::vector<int> team;
	bool tag;
};
static Format get_format(const std::string& name) {
	if(name == "ffa3") return {name, 3, {0, 1, 2}, false};
	if(name == "ffa4") return {name, 4, {0, 1, 2, 3}, false};
	if(name == "tag") return {name, 4, {0, 1, 0, 1}, true};
	if(name == "two") return {name, 2, {0, 1}, false};
	std::printf("unknown format %s\n", name.c_str());
	std::exit(2);
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
	return duel;
}
static field& F(OCG_Duel d) { return *static_cast<duel*>(d)->game_field; }
static bool run_lua(OCG_Duel d, const std::string& code) {
	last_log.clear();
	return OCG_LoadScript(d, code.c_str(), static_cast<uint32_t>(code.size()), "check.lua") != 0;
}
static void add_card(OCG_Duel d, uint8_t seat, uint32_t loc, uint32_t code, uint32_t pos = POS_FACEDOWN_DEFENSE) {
	OCG_NewCardInfo info;
	std::memset(&info, 0, sizeof(info));
	info.team = seat;
	info.duelist = 0;
	info.code = code;
	info.con = seat;
	info.loc = loc;
	info.seq = 0;
	info.pos = pos;
	OCG_DuelNewCard(d, &info);
}

// A duel with `fmt`: SetupDuelists (n > 2 or tag), 40 deck cards and one Deck Master per seat (code 9000 + seat).
static OCG_Duel make_domain_duel(const Format& fmt, uint32_t seed = 1) {
	OCG_Duel d = make_duel(seed);
	if(fmt.n > 2) {
		std::string code = "Debug.SetupDuelists(" + std::to_string(fmt.n);
		for(int t : fmt.team)
			code += "," + std::to_string(t);
		code += ")";
		if(!run_lua(d, code)) {
			std::printf("FAIL: %s: %s\n", code.c_str(), last_log.c_str());
			std::exit(2);
		}
	}
	for(int s = 0; s < fmt.n; ++s) {
		for(int i = 0; i < 40; ++i)
			add_card(d, static_cast<uint8_t>(s), LOCATION_DECK, 1);
		add_card(d, static_cast<uint8_t>(s), DM_LOC, dm_code(s), POS_FACEUP_ATTACK);
	}
	return d;
}

// ---- message stepping ----
struct Msg {
	uint8_t id;
	std::vector<uint8_t> body; // without the id
};
struct StepResult {
	int status;
	std::vector<Msg> msgs;
};
static StepResult process(OCG_Duel d) {
	StepResult r;
	r.status = OCG_DuelProcess(d);
	uint32_t length = 0;
	const auto* buffer = static_cast<const uint8_t*>(OCG_DuelGetMessage(d, &length));
	for(uint32_t offset = 0; offset + 4 <= length;) {
		uint32_t size = 0;
		std::memcpy(&size, buffer + offset, 4);
		if(size > 0) {
			Msg m;
			m.id = buffer[offset + 4];
			m.body.assign(buffer + offset + 5, buffer + offset + 4 + size);
			r.msgs.push_back(std::move(m));
		}
		offset += 4 + size;
	}
	return r;
}
static uint32_t rd32(const Msg& m, size_t off) { uint32_t v = 0; std::memcpy(&v, m.body.data() + off, 4); return v; }
static uint64_t rd64(const Msg& m, size_t off) { uint64_t v = 0; std::memcpy(&v, m.body.data() + off, 8); return v; }
static const Msg* find_msg(const StepResult& r, uint8_t id) {
	for(const auto& m : r.msgs)
		if(m.id == id) return &m;
	return nullptr;
}
static void respond(OCG_Duel d, uint32_t v) { OCG_DuelSetResponse(d, &v, sizeof(v)); }
static void respond_ints(OCG_Duel d, const std::vector<uint32_t>& v) {
	OCG_DuelSetResponse(d, v.data(), static_cast<uint32_t>(v.size() * sizeof(uint32_t)));
}
// Answers a prompt that is not the one under test. Returns false for a prompt it does not know.
static bool auto_answer(OCG_Duel d, const StepResult& r) {
	for(const auto& m : r.msgs) {
		if(m.id == MSG_SELECT_CHAIN) { respond(d, 0xFFFFFFFFu); return true; }
		if(m.id == MSG_SELECT_CARD && m.body.size() >= 6) {
			const uint32_t min = rd32(m, 2);
			std::vector<uint32_t> resp{0, min};
			for(uint32_t i = 0; i < min; ++i) resp.push_back(i);
			respond_ints(d, resp);
			return true;
		}
		if(m.id == MSG_SELECT_YESNO) { respond(d, 0); return true; }
		if(m.id == MSG_SELECT_PLACE && m.body.size() >= 6) {
			const uint32_t flag = rd32(m, 2);
			uint8_t seq = 0;
			while(seq < 5 && (flag & (1u << seq))) ++seq;
			const uint8_t resp[3] = {m.body[0], LOCATION_MZONE, seq};
			OCG_DuelSetResponse(d, resp, 3);
			return true;
		}
	}
	return false;
}
static const Msg* idle_msg(const StepResult& r) { return find_msg(r, MSG_SELECT_IDLECMD); }

// Index of the summonable card with `code` in a MSG_SELECT_IDLECMD, or -1.
static int summon_index(const Msg& idle, uint32_t code) {
	const uint32_t count = rd32(idle, 1);
	for(uint32_t i = 0; i < count; ++i)
		if(rd32(idle, 5 + i * 10) == code) return static_cast<int>(i);
	return -1;
}

struct Trace {
	std::vector<std::pair<int, uint64_t>> yesno; // (seat, desc)
	std::vector<std::pair<int, uint32_t>> paid;  // (seat, amount)
	bool saw_win = false;
};
static void scan(const StepResult& r, Trace& t) {
	for(const auto& m : r.msgs) {
		if(m.id == MSG_SELECT_YESNO) t.yesno.emplace_back(m.body[0], rd64(m, 1));
		if(m.id == MSG_PAY_LPCOST) t.paid.emplace_back(m.body[0], rd32(m, 1));
		if(m.id == MSG_WIN) t.saw_win = true;
	}
}

// Plays (end phase at every idle prompt) until the idle prompt of the wanted turn player. Leaves the prompt open.
// Returns the StepResult that holds the prompt; status < 0 when it was not reached.
static StepResult run_to_idle_of(OCG_Duel d, int seat, Trace& t, std::vector<int>* recalls = nullptr, int max_steps = 4000) {
	for(int i = 0; i < max_steps; ++i) {
		StepResult r = process(d);
		scan(r, t);
		if(t.saw_win || r.status == OCG_DUEL_STATUS_END) break;
		if(r.status != OCG_DUEL_STATUS_AWAITING) continue;
		if(const Msg* idle = idle_msg(r)) {
			if(getenv("D1_DEBUG")) std::printf("idle body0=%d turn=%d\n", idle->body[0], static_cast<int>(F(d).infos.turn_player));
			if(F(d).infos.turn_player == seat && idle->body[0] == seat) return r;
			respond(d, 7);
			continue;
		}
		if(recalls) {
			if(const Msg* y = find_msg(r, MSG_SELECT_YESNO)) {
				EXPECT(rd64(*y, 1) == RECALL_DESC_LO, "yes/no desc 0x%llx", static_cast<unsigned long long>(rd64(*y, 1)));
				recalls->push_back(y->body[0]);
				respond(d, 1);
				continue;
			}
		}
		if(!auto_answer(d, r)) {
			std::printf("FAIL: unknown prompt while running to seat %d (id %u)\n", seat, r.msgs.empty() ? 0u : r.msgs.back().id);
			++failures;
			break;
		}
	}
	std::printf("DEBUG run_to_idle_of(%d): saw_win=%d turn=%d\n", seat, t.saw_win ? 1 : 0, static_cast<int>(F(d).infos.turn_player));
	StepResult none;
	none.status = -1;
	return none;
}

// A global effect that sends the Deck Masters of `seats` to the Graveyard at the start of Main Phase 1 of turn player `tp`.
// (Duel.SendtoGrave is not allowed from LoadScript while a prompt is open, but it is inside an effect operation.)
static void register_gy_effect(OCG_Duel d, int tp, const std::vector<int>& seats, const std::string& after = "") {
	std::string ops;
	for(int s : seats) ops += "Duel.SendtoGrave(Duel.GetFieldCard(" + std::to_string(s) + ",0x4000,0),0x440) ";
	const std::string code = "local e=Effect.GlobalEffect() e:SetType(0x802) "
		"e:SetCode(" + std::string("0x2004") + ") e:SetCondition(function() return Duel.GetTurnPlayer()==" + std::to_string(tp) + " end) "
		"e:SetOperation(function(e) " + ops + after + " e:Reset() end) Duel.RegisterEffect(e,0)";
	if(!run_lua(d, code)) {
		std::printf("FAIL: gy effect: %s\n", last_log.c_str());
		std::exit(2);
	}
}

// ---- parts ----
static void part_setup(const Format& fmt) {
	OCG_Duel d = make_domain_duel(fmt);
	auto& f = F(d);
	for(int s = 0; s < fmt.n; ++s) {
		EXPECT(f.player[s].deck_master_card != nullptr, "%s: seat %d has no deck_master_card", fmt.name.c_str(), s);
		EXPECT(OCG_DuelQueryCount(d, static_cast<uint8_t>(s), DM_LOC) == 1, "%s: QueryCount(%d, DMZ) = %u", fmt.name.c_str(), s,
		       OCG_DuelQueryCount(d, static_cast<uint8_t>(s), DM_LOC));
		card* dm = f.player[s].deck_master_card;
		EXPECT(dm && f.domain_owner_of(dm) == s, "%s: domain_owner_of(dm %d) = %u", fmt.name.c_str(), s, dm ? f.domain_owner_of(dm) : 999u);
		EXPECT(dm && f.domain_is_deck_master(dm), "%s: seat %d card is not a Deck Master", fmt.name.c_str(), s);
		EXPECT(dm && dm->data.code == dm_code(s), "%s: seat %d Deck Master code", fmt.name.c_str(), s);
		EXPECT(f.player[s].deck_master_returns == 0, "%s: seat %d returns %u", fmt.name.c_str(), s, f.player[s].deck_master_returns);
		EXPECT(OCG_DuelQueryCount(d, static_cast<uint8_t>(s), DM_RETURNS) == 0, "%s: seat %d returns count query", fmt.name.c_str(), s);
	}
	// A card that is not a Deck Master is not one.
	EXPECT(!f.player[0].list_main.empty() && !f.domain_is_deck_master(f.player[0].list_main.front()), "%s: a deck card counts as Deck Master", fmt.name.c_str());
	EXPECT(f.domain_owner_of(nullptr) == f.none_id(), "%s: owner_of(nullptr) is not none_id()", fmt.name.c_str());
	std::printf("ok   %s setup: every seat has a Deck Master (QueryCount 1, owner = seat)\n", fmt.name.c_str());
	OCG_DestroyDuel(d);
}

static void part_tax(const Format& fmt) {
	OCG_Duel d = make_domain_duel(fmt);
	auto& f = F(d);
	const int last = fmt.n - 1;
	f.player[last].deck_master_returns = 2;
	EXPECT(f.domain_leave_tax_for(static_cast<uint8_t>(last)) == 1000, "%s: tax of seat %d = %u", fmt.name.c_str(), last, f.domain_leave_tax_for(static_cast<uint8_t>(last)));
	EXPECT(f.domain_leave_tax_for(0) == 0, "%s: tax of seat 0 (no returns)", fmt.name.c_str());
	EXPECT(f.domain_leave_tax_for(f.none_id()) == 0, "%s: tax of none_id()", fmt.name.c_str());
	EXPECT(!f.domain_can_pay_leave_tax(f.none_id()), "%s: can_pay(none_id()) true", fmt.name.c_str());
	if(!fmt.tag) {
		f.lp_ref(static_cast<uint8_t>(last)) = 999;
		EXPECT(!f.domain_can_pay_leave_tax(static_cast<uint8_t>(last)), "%s: LP 999 can pay 1000", fmt.name.c_str());
		f.lp_ref(static_cast<uint8_t>(last)) = 1000;
		EXPECT(f.domain_can_pay_leave_tax(static_cast<uint8_t>(last)), "%s: LP 1000 cannot pay 1000", fmt.name.c_str());
		EXPECT(f.cost[last].count == 0 && f.cost[last].amount == 0, "%s: cost state after can_pay", fmt.name.c_str());
	} else {
		// Seat 2 is on team 0. Only the team LP counts.
		f.player[2].deck_master_returns = 2;
		f.player[0].lp = 1000;
		f.player[2].lp = 0;
		EXPECT(f.domain_can_pay_leave_tax(2), "tag: team LP 1000 and own LP 0 cannot pay 1000");
		f.player[0].lp = 999;
		f.player[2].lp = 8000;
		EXPECT(!f.domain_can_pay_leave_tax(2), "tag: team LP 999 (own LP 8000) can pay 1000");
	}
	// Nested costs.
	for(int s = 0; s < fmt.n; ++s) f.player[s].lp = 1000;
	f.save_lp_cost();
	EXPECT(f.check_lp_cost(fmt.n == 2 ? 1 : 2, 600) != FALSE, "%s: nested first cost 600 refused", fmt.name.c_str());
	const bool second = f.check_lp_cost(0, 600) != FALSE;
	if(fmt.tag)
		EXPECT(!second, "tag: seat 0 (same team as seat 2) second cost 600 accepted against 1000");
	else
		EXPECT(second, "%s: seat 0 second cost 600 refused (own LP)", fmt.name.c_str());
	// Same seat twice: adds up in every format.
	EXPECT(f.check_lp_cost(fmt.n == 2 ? 1 : 2, 600) == FALSE, "%s: same seat twice 600+600 accepted against 1000", fmt.name.c_str());
	f.restore_lp_cost();
	bool clean = true;
	for(int i = 0; i < fmt.n; ++i) clean = clean && f.cost[i].count == 0 && f.cost[i].amount == 0;
	EXPECT(clean, "%s: cost state is not back to 0 after restore_lp_cost", fmt.name.c_str());
	for(int i = fmt.n; i < MAX_DUELISTS; ++i)
		EXPECT(f.cost[i].count == 0 && f.cost[i].amount == 0, "%s: cost[%d] touched", fmt.name.c_str(), i);
	std::printf("ok   %s tax: tax size, pay check against %s LP, nested costs\n", fmt.name.c_str(), fmt.tag ? "team" : "own");
	OCG_DestroyDuel(d);
}

// Seat `tp` is the turn player. The Deck Masters of the other seats in `others` go to the Graveyard.
static void part_flow(const Format& fmt) {
	if(fmt.n == 2) {
		std::printf("skip %s flow (n == 2 only runs setup and tax)\n", fmt.name.c_str());
		return;
	}
	OCG_Duel d = make_domain_duel(fmt);
	// Seat 2 is the turn player; the Deck Masters of the seats 1 and 3 (or 1 only in ffa3) go to the Graveyard in its Main Phase 1.
	std::vector<int> victims{1};
	if(fmt.n == 4) victims.push_back(3);
	register_gy_effect(d, 2, victims);
	OCG_StartDuel(d);
	auto& f = F(d);
	Trace t;
	std::vector<int> prompted;
	StepResult r = run_to_idle_of(d, 2, t, &prompted);
	if(r.status < 0) { EXPECT(false, "%s: seat 2 idle prompt not reached", fmt.name.c_str()); OCG_DestroyDuel(d); return; }
	respond(d, 7); // end the turn of seat 2 (the recall prompts came before its idle prompt)
	// Order: from the turn player (2): 3, then 0 (no), then 1. So 3 before 1.
	std::vector<int> want;
	if(fmt.n == 4) want.push_back(3);
	want.push_back(1);
	EXPECT(prompted == want, "%s: recall prompts went to seats (want 3 then 1) %s", fmt.name.c_str(), [&] { std::string s; for(int p : prompted) s += std::to_string(p) + " "; return s; }().c_str());
	for(int s : prompted) {
		EXPECT(OCG_DuelQueryCount(d, static_cast<uint8_t>(s), DM_LOC) == 1, "%s: Deck Master of seat %d is not back", fmt.name.c_str(), s);
		EXPECT(OCG_DuelQueryCount(d, static_cast<uint8_t>(s), DM_RETURNS) == 1, "%s: returns of seat %d", fmt.name.c_str(), s);
	}
	for(int s = 0; s < fmt.n; ++s) {
		if(std::find(prompted.begin(), prompted.end(), s) == prompted.end())
			EXPECT(OCG_DuelQueryCount(d, static_cast<uint8_t>(s), DM_RETURNS) == 0, "%s: returns of seat %d (not recalled)", fmt.name.c_str(), s);
	}
	// Summon each recalled Deck Master on its owner's turn and look at the payment.
	for(int s : prompted) {
		Trace t2;
		StepResult idle = run_to_idle_of(d, s, t2);
		if(idle.status < 0) { EXPECT(false, "%s: seat %d idle prompt not reached", fmt.name.c_str(), s); continue; }
		const Msg* im = idle_msg(idle);
		const int index = im ? summon_index(*im, dm_code(s)) : -1;
		EXPECT(index >= 0, "%s: seat %d Deck Master not summonable", fmt.name.c_str(), s);
		if(index < 0) continue;
		const int32_t own_before = f.player[s].lp, team_before = f.lp_ref(static_cast<uint8_t>(s));
		const int team = f.team_of(static_cast<uint8_t>(s));
		respond(d, (static_cast<uint32_t>(index) << 16) | 0u);
		bool at_idle = false;
		for(int i = 0; i < 60; ++i) {
			StepResult r2 = process(d);
			scan(r2, t2);
			if(r2.status != OCG_DUEL_STATUS_AWAITING) continue;
			if(idle_msg(r2)) { at_idle = true; break; }
			if(!auto_answer(d, r2)) break;
		}
		EXPECT(t2.paid.size() == 1 && t2.paid[0].first == s && t2.paid[0].second == 500, "%s: seat %d payment message (%zu)", fmt.name.c_str(), s, t2.paid.size());
		EXPECT(OCG_DuelQueryCount(d, static_cast<uint8_t>(s), LOCATION_MZONE) == 1, "%s: seat %d Deck Master not on the field", fmt.name.c_str(), s);
		if(!fmt.tag) {
			EXPECT(f.player[s].lp == own_before - 500, "%s: seat %d LP %d -> %d", fmt.name.c_str(), s, own_before, f.player[s].lp);
		} else {
			EXPECT(f.player[team].lp == team_before - 500, "tag: team %d LP %d -> %d", team, team_before, f.player[team].lp);
			if(team != s)
				EXPECT(f.player[s].lp == own_before, "tag: own LP of seat %d changed (%d -> %d)", s, own_before, f.player[s].lp);
		}
		// Every other team or seat is unchanged? Only the paying LP moved.
		if(at_idle) respond(d, 7); // leave the idle prompt so that the next seat can be reached
		std::printf("ok   %s flow: seat %d recalled, summoned, paid 500 (%s LP %d -> %d)\n", fmt.name.c_str(), s, fmt.tag ? "team" : "own",
		            team_before, f.lp_ref(static_cast<uint8_t>(s)));
	}
	OCG_DestroyDuel(d);
}

static void part_elim(const Format& fmt) {
	if(fmt.n == 2) {
		std::printf("skip %s elim (n == 2)\n", fmt.name.c_str());
		return;
	}
	if(fmt.tag) {
		std::printf("skip %s elim (Tag eliminates teams; host-driven per seat is FFA)\n", fmt.name.c_str());
		return;
	}
	OCG_Duel d = make_domain_duel(fmt);
	// The same effect sends the Deck Master of seat 2 to the Graveyard (recall pending) and eliminates seat 2, in Main Phase 1 of seat 0.
	register_gy_effect(d, 0, {2}, "Debug.EliminateDuelist(2,0)");
	OCG_StartDuel(d);
	auto& f = F(d);
	Trace t;
	StepResult r;
	bool saw200 = false;
	int idle_count = 0;
	for(int i = 0; i < 2500 && idle_count < fmt.n * 2; ++i) {
		r = process(d);
		scan(r, t);
		for(const auto& m : r.msgs) if(m.id == 200) saw200 = true;
		if(r.status == OCG_DUEL_STATUS_END || t.saw_win) break;
		if(r.status != OCG_DUEL_STATUS_AWAITING) continue;
		if(idle_msg(r)) { ++idle_count; respond(d, 7); continue; }
		if(!auto_answer(d, r)) { EXPECT(false, "%s: unknown prompt after elimination (id %u)", fmt.name.c_str(), r.msgs.empty() ? 0u : r.msgs.back().id); break; }
	}
	EXPECT(f.player[2].eliminated, "%s: seat 2 not eliminated", fmt.name.c_str());
	EXPECT(saw200, "%s: no MSG_DUELIST_ELIMINATED seen", fmt.name.c_str());
	EXPECT(OCG_DuelQueryCount(d, 2, DM_LOC) == 0, "%s: seat 2 Deck Master still in the zone (%u)", fmt.name.c_str(), OCG_DuelQueryCount(d, 2, DM_LOC));
	EXPECT(OCG_DuelQueryCount(d, 2, LOCATION_GRAVE) == 0, "%s: seat 2 Graveyard not empty", fmt.name.c_str());
	bool prompt2 = false;
	for(const auto& y : t.yesno) if(y.first == 2) prompt2 = true;
	EXPECT(!prompt2, "%s: the eliminated seat 2 got a recall prompt", fmt.name.c_str());
	std::printf("ok   %s elim: seat 2 Deck Master gone, no recall prompt for seat 2 (%d idle prompts after)\n", fmt.name.c_str(), idle_count);
	OCG_DestroyDuel(d);
}

int main(int argc, char** argv) {
	const std::string fname = argc > 1 ? argv[1] : "ffa4";
	const std::string part = argc > 2 ? argv[2] : "all";
	const Format fmt = get_format(fname);
	const bool all = part == "all";
	if(all || part == "setup") part_setup(fmt);
	if(all || part == "tax") part_tax(fmt);
	if(all || part == "flow") part_flow(fmt);
	if(all || part == "elim") part_elim(fmt);
	std::printf("%s %s: %d failure(s)\n", failures ? "FAIL" : "PASS", fname.c_str(), failures);
	return failures ? 1 : 0;
}
