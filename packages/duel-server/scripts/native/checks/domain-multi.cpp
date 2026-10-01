// D1 native check: the Domain layer for 3 and 4 duelists (apply-domain-multi.mjs pre/post + D1a).
// Build and run: bash packages/duel-server/scripts/native/checks/run.sh <check name> (see README.md).
// Usage: check <format> [part]
//   format: ffa3 | ffa4 | tag | two   ("two" = a 2-duelist duel without SetupDuelists, the n == 2 sanity run)
//   part:   setup | tax | flow | recall | elim | all (default)
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

// At the start of Main Phase 1 of turn number `turn` (Duel.GetTurnCount; seat k plays turn k + 1 in the first round),
// each seat of `seats` sends its own Deck Master to the Graveyard. Inside an effect, Lua sees the own side of the effect
// duelist as `tp` (0 in FFA, the team number in Tag) and the others as 1 (the Lua perspective fold). So there is one global
// effect for each seat, registered for that seat, and it reads its own seat as the `tp` argument of the operation. The optional
// `after` text runs once, in an effect of seat 0, after the Deck Masters went (for example Debug.EliminateDuelist).
static void register_gy_effects(OCG_Duel d, int turn, const std::vector<int>& seats, const std::string& after = "") {
	const std::string when = "e:SetCondition(function() return Duel.GetTurnCount()==" + std::to_string(turn) + " end) ";
	for(int s : seats) {
		const std::string code = "local e=Effect.GlobalEffect() e:SetType(0x802) e:SetCode(0x2004) " + when +
			"e:SetOperation(function(e,tp) Duel.SendtoGrave(Duel.GetFieldCard(tp,0x4000,0),0x440) e:Reset() end) "
			"Duel.RegisterEffect(e," + std::to_string(s) + ")";
		if(!run_lua(d, code)) {
			std::printf("FAIL: gy effect: %s\n", last_log.c_str());
			std::exit(2);
		}
	}
	if(!after.empty()) {
		const std::string code = "local e=Effect.GlobalEffect() e:SetType(0x802) e:SetCode(0x2004) " + when +
			"e:SetOperation(function(e) " + after + " e:Reset() end) Duel.RegisterEffect(e,0)";
		if(!run_lua(d, code)) {
			std::printf("FAIL: after effect: %s\n", last_log.c_str());
			std::exit(2);
		}
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

// Message text for a list of seats.
static std::string seats_text(const std::vector<int>& v) {
	std::string s;
	for(int p : v) s += std::to_string(p) + " ";
	return s;
}

// Summons the Deck Master of `s` from its idle prompt (the duel must be at the idle prompt of `s`) and checks the payment:
// 500 LP (one completed return), from the own LP in FFA and from the team LP in Tag. Leaves the next idle prompt open.
static void summon_and_check_payment(OCG_Duel d, const Format& fmt, int s, const StepResult& idle) {
	auto& f = F(d);
	Trace t2;
	const Msg* im = idle_msg(idle);
	const int index = im ? summon_index(*im, dm_code(s)) : -1;
	EXPECT(index >= 0, "%s: seat %d Deck Master not summonable", fmt.name.c_str(), s);
	if(index < 0) return;
	const int32_t own_before = f.player[s].lp, team_before = f.lp_ref(static_cast<uint8_t>(s));
	const int team = f.team_of(static_cast<uint8_t>(s));
	// Other seats keep their LP, except the paying one (the team LP in Tag).
	std::vector<int32_t> before;
	for(int p = 0; p < fmt.n; ++p) before.push_back(f.player[p].lp);
	respond(d, (static_cast<uint32_t>(index) << 16) | 0u);
	bool at_idle = false;
	for(int i = 0; i < 60; ++i) {
		StepResult r2 = process(d);
		scan(r2, t2);
		if(r2.status != OCG_DUEL_STATUS_AWAITING) continue;
		if(idle_msg(r2)) { at_idle = true; break; }
		if(!auto_answer(d, r2)) break;
	}
	EXPECT(at_idle, "%s: seat %d no idle prompt after the Deck Master summon", fmt.name.c_str(), s);
	EXPECT(t2.paid.size() == 1 && t2.paid[0].first == s && t2.paid[0].second == 500, "%s: seat %d payment message (%zu)", fmt.name.c_str(), s, t2.paid.size());
	EXPECT(OCG_DuelQueryCount(d, static_cast<uint8_t>(s), LOCATION_MZONE) == 1, "%s: seat %d Deck Master not on the field", fmt.name.c_str(), s);
	EXPECT(OCG_DuelQueryCount(d, static_cast<uint8_t>(s), DM_LOC) == 0, "%s: seat %d Deck Master still in its zone", fmt.name.c_str(), s);
	if(!fmt.tag) {
		EXPECT(f.player[s].lp == own_before - 500, "%s: seat %d LP %d -> %d", fmt.name.c_str(), s, own_before, f.player[s].lp);
	} else {
		EXPECT(f.player[team].lp == team_before - 500, "tag: team %d LP %d -> %d", team, team_before, f.player[team].lp);
		if(team != s)
			EXPECT(f.player[s].lp == own_before, "tag: own LP of seat %d changed (%d -> %d)", s, own_before, f.player[s].lp);
	}
	for(int p = 0; p < fmt.n; ++p) {
		const int paying = fmt.tag ? team : s;
		if(p != paying)
			EXPECT(f.player[p].lp == before[p], "%s: LP of seat %d changed (%d -> %d) while seat %d paid", fmt.name.c_str(), p, before[p], f.player[p].lp, s);
	}
	if(at_idle) respond(d, 7); // leave the idle prompt so that the next seat can be reached
	std::printf("ok   %s flow: seat %d recalled, summoned, paid 500 (%s LP %d -> %d)\n", fmt.name.c_str(), s, fmt.tag ? "team" : "own",
	            team_before, f.lp_ref(static_cast<uint8_t>(s)));
}

// Every seat's Deck Master goes to the Graveyard at the start of the Main Phase 1 of seat 2 (turn 3). Each owner gets one
// recall prompt, in turn order from the turn player. Then every seat summons its Deck Master from the Deck Master zone
// on its own turn and pays the tax (500 LP after one return) from its own LP (FFA) or from the team LP (Tag).
static void part_flow(const Format& fmt) {
	if(fmt.n == 2) {
		std::printf("skip %s flow (n == 2 only runs setup and tax)\n", fmt.name.c_str());
		return;
	}
	OCG_Duel d = make_domain_duel(fmt);
	std::vector<int> victims;
	for(int s = 0; s < fmt.n; ++s) victims.push_back(s);
	register_gy_effects(d, 3, victims);
	OCG_StartDuel(d);
	auto& f = F(d);
	Trace t;
	std::vector<int> prompted;
	StepResult r = run_to_idle_of(d, 2, t, &prompted);
	if(r.status < 0) { EXPECT(false, "%s: seat 2 idle prompt not reached", fmt.name.c_str()); OCG_DestroyDuel(d); return; }
	// Seat 2 is at its idle prompt: its own Deck Master came back before this prompt. Seat 2 summons first.
	std::vector<int> want;
	for(int k = 0; k < fmt.n; ++k) want.push_back((2 + k) % fmt.n);
	EXPECT(prompted == want, "%s: recall prompts went to seats (want %s) got %s", fmt.name.c_str(), seats_text(want).c_str(), seats_text(prompted).c_str());
	for(int s = 0; s < fmt.n; ++s) {
		EXPECT(OCG_DuelQueryCount(d, static_cast<uint8_t>(s), DM_LOC) == 1, "%s: Deck Master of seat %d is not back", fmt.name.c_str(), s);
		EXPECT(OCG_DuelQueryCount(d, static_cast<uint8_t>(s), DM_RETURNS) == 1, "%s: returns of seat %d", fmt.name.c_str(), s);
		EXPECT(f.player[s].deck_master_returns == 1, "%s: deck_master_returns of seat %d = %u", fmt.name.c_str(), s, f.player[s].deck_master_returns);
		EXPECT(f.domain_leave_tax_for(static_cast<uint8_t>(s)) == 500, "%s: tax of seat %d = %u", fmt.name.c_str(), s, f.domain_leave_tax_for(static_cast<uint8_t>(s)));
	}
	// Seat 2 summons now, then each other seat on its own turn (in turn order after seat 2).
	summon_and_check_payment(d, fmt, 2, r);
	for(int k = 1; k < fmt.n; ++k) {
		const int s = (2 + k) % fmt.n;
		Trace t2;
		StepResult idle = run_to_idle_of(d, s, t2);
		if(idle.status < 0) { EXPECT(false, "%s: seat %d idle prompt not reached", fmt.name.c_str(), s); continue; }
		summon_and_check_payment(d, fmt, s, idle);
	}
	OCG_DestroyDuel(d);
}

// Seat 2 is the turn player of turn 3. In Tag, seats 0 and 2 are one team (the shared LP of 16000 is in player[team]).
// Every seat sends its Deck Master to the Graveyard at the same time as the next living seat is eliminated; the prompts of the
// living seats go in turn order from the turn player and no prompt goes to the dead seat.
static void part_recall_order(const Format& fmt) {
	if(fmt.n == 2 || fmt.tag) {
		std::printf("skip %s recall-order (%s)\n", fmt.name.c_str(), fmt.n == 2 ? "n == 2" : "in Tag the loss of one seat ends the game for its team, so no later prompt exists");
		return;
	}
	const int before_failures = failures;
	OCG_Duel d = make_domain_duel(fmt);
	const int tp = fmt.n - 2;                 // ffa3: seat 1 (turn 2), ffa4: seat 2 (turn 3)
	const int dead = (tp + 1) % fmt.n;        // the seat right after the turn player in the prompt order
	std::vector<int> victims;
	for(int s = 0; s < fmt.n; ++s) victims.push_back(s);
	register_gy_effects(d, tp + 1, victims, "Debug.EliminateDuelist(" + std::to_string(dead) + ",0)");
	OCG_StartDuel(d);
	auto& f = F(d);
	Trace t;
	std::vector<int> prompted;
	StepResult r = run_to_idle_of(d, tp, t, &prompted);
	if(r.status < 0) { EXPECT(false, "%s: seat %d idle prompt not reached", fmt.name.c_str(), tp); OCG_DestroyDuel(d); return; }
	std::vector<int> want;
	for(int k = 0; k < fmt.n; ++k) {
		const int p = (tp + k) % fmt.n;
		if(p != dead) want.push_back(p);
	}
	EXPECT(prompted == want, "%s: recall prompts went to seats (want %s, seat %d is dead) got %s", fmt.name.c_str(), seats_text(want).c_str(), dead, seats_text(prompted).c_str());
	EXPECT(f.player[dead].eliminated, "%s: seat %d not eliminated", fmt.name.c_str(), dead);
	EXPECT(OCG_DuelQueryCount(d, static_cast<uint8_t>(dead), DM_LOC) == 0, "%s: dead seat %d Deck Master zone count %u", fmt.name.c_str(), dead,
	       OCG_DuelQueryCount(d, static_cast<uint8_t>(dead), DM_LOC));
	EXPECT(OCG_DuelQueryCount(d, static_cast<uint8_t>(dead), LOCATION_GRAVE) == 0, "%s: dead seat %d Graveyard count %u", fmt.name.c_str(), dead,
	       OCG_DuelQueryCount(d, static_cast<uint8_t>(dead), LOCATION_GRAVE));
	EXPECT(f.player[dead].list_deckmaster.empty() || !f.player[dead].list_deckmaster[0], "%s: dead seat %d still holds its Deck Master", fmt.name.c_str(), dead);
	for(const auto& y : t.yesno)
		EXPECT(y.first != dead, "%s: the dead seat %d got a recall prompt", fmt.name.c_str(), dead);
	for(int s : want) {
		EXPECT(OCG_DuelQueryCount(d, static_cast<uint8_t>(s), DM_LOC) == 1, "%s: living seat %d Deck Master is not back", fmt.name.c_str(), s);
	}
	if(failures == before_failures)
		std::printf("ok   %s recall-order: prompts to seats %sin turn order, dead seat %d skipped\n", fmt.name.c_str(), seats_text(prompted).c_str(), dead);
	OCG_DestroyDuel(d);
}

// A seat is eliminated while its Deck Master sits in the Deck Master zone, and another while its Deck Master waits in the
// Graveyard (a recall is pending). Both Deck Masters leave the game; no recall prompt goes to either seat.
static void part_elim(const Format& fmt) {
	if(fmt.n == 2 || fmt.tag) {
		std::printf("skip %s elim (%s)\n", fmt.name.c_str(), fmt.n == 2 ? "n == 2" : "in Tag the loss of one seat ends the game for its team: the duel is over, field::eliminate does not run");
		return;
	}
	const int before_failures = failures;
	OCG_Duel d = make_domain_duel(fmt);
	// In Main Phase 1 of seat 0 (turn 1): the Deck Master of seat 2 goes to the Graveyard (a recall is pending), then seat 2
	// is eliminated; seat 1 is eliminated with its Deck Master still in the Deck Master zone (the host removes a seat).
	// (ffa3 keeps seat 1: with two seats gone the duel would end.)
	const std::vector<int> gone = fmt.n == 4 ? std::vector<int>{1, 2} : std::vector<int>{2};
	register_gy_effects(d, 1, {2}, std::string("Debug.EliminateDuelist(2,0)") + (fmt.n == 4 ? " Debug.EliminateDuelist(1,0)" : ""));
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
	EXPECT(saw200, "%s: no MSG_DUELIST_ELIMINATED seen", fmt.name.c_str());
	for(int dead : gone) {
		EXPECT(f.player[dead].eliminated, "%s: seat %d not eliminated", fmt.name.c_str(), dead);
		EXPECT(OCG_DuelQueryCount(d, static_cast<uint8_t>(dead), DM_LOC) == 0, "%s: seat %d Deck Master still in the zone (%u)", fmt.name.c_str(), dead,
		       OCG_DuelQueryCount(d, static_cast<uint8_t>(dead), DM_LOC));
		EXPECT(OCG_DuelQueryCount(d, static_cast<uint8_t>(dead), LOCATION_GRAVE) == 0, "%s: seat %d Graveyard not empty", fmt.name.c_str(), dead);
		EXPECT(f.player[dead].list_deckmaster.empty() || !f.player[dead].list_deckmaster[0], "%s: seat %d still holds its Deck Master", fmt.name.c_str(), dead);
		for(const auto& y : t.yesno)
			EXPECT(y.first != dead, "%s: the eliminated seat %d got a recall prompt", fmt.name.c_str(), dead);
	}
	for(int s = 0; s < fmt.n; ++s) {
		if(f.player[s].eliminated) continue;
		EXPECT(OCG_DuelQueryCount(d, static_cast<uint8_t>(s), DM_LOC) == 1, "%s: living seat %d lost its Deck Master (%u)", fmt.name.c_str(), s,
		       OCG_DuelQueryCount(d, static_cast<uint8_t>(s), DM_LOC));
	}
	if(failures == before_failures)
		std::printf("ok   %s elim: Deck Masters of the eliminated seats are gone (zone and Graveyard), no recall prompt for them (%d idle prompts after)\n", fmt.name.c_str(), idle_count);
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
	if(all || part == "recall") part_recall_order(fmt);
	if(all || part == "elim") part_elim(fmt);
	std::printf("%s %s: %d failure(s)\n", failures ? "FAIL" : "PASS", fname.c_str(), failures);
	return failures ? 1 : 0;
}
